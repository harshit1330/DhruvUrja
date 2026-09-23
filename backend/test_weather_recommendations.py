from datetime import timedelta
import httpx
import pytest
from fastapi.testclient import TestClient
from energy.api import create_app
from energy.demo import seed
from energy.dispatch import compare, renewable
from energy.recommendations import explain
from energy.schemas import WeatherConnection, Weather
from energy.weather import fetch_weather, WeatherProviderError
from test_backend import NOW, KEY, config, current, hours


def test_simulation_fuel_override_does_not_change_inventory(tmp_path):
    app = create_app(tmp_path / 'db.sqlite3', KEY, clock=lambda: NOW)
    seed(app.state.store, NOW)
    with TestClient(app, headers={'X-API-Key': KEY}) as client:
        before = client.get('/api/v1/stations/demo-polar/overview').json()['snapshot']
        response = client.post('/api/v1/stations/demo-polar/simulate', json={
            'horizon_hours': 6, 'fuel_override_l': 0, 'renewable_multiplier': 0})
        assert response.status_code == 200, response.text
        assert response.json()['optimized']['fuel_used_l'] < 1e-4
        assert response.json()['optimized']['essential_unserved_kwh'] > 0
        assert client.get('/api/v1/stations/demo-polar/overview').json()['snapshot'] == before


def connection(latitude=-69.4):
    return WeatherConnection(latitude=latitude, longitude=76.2, panel_tilt_degrees=60,
                             panel_azimuth_degrees=180, wind_height_m=80)


def provider_payload():
    return {'latitude': -69.4, 'longitude': 76.2, 'utc_offset_seconds': 0,
            'hourly_units': {'temperature_2m': '°C', 'wind_speed_80m': 'm/s', 'global_tilted_irradiance': 'W/m²', 'cloud_cover': '%', 'relative_humidity_2m': '%'},
            'hourly': {'time': [(NOW + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(73)],
                       'temperature_2m': [-20] * 73, 'wind_speed_80m': [8] * 73,
                       'cloud_cover': [40] * 73, 'relative_humidity_2m': [65] * 73,
                       'global_tilted_irradiance': list(range(73))}}


def test_live_adapter_units_radiation_alignment_and_provenance():
    def serve(request):
        assert request.url.params['wind_speed_unit'] == 'ms'
        assert request.url.params['tilt'] == '60.0'
        return httpx.Response(200, json=provider_payload())
    result = fetch_weather(connection(), NOW, transport=httpx.MockTransport(serve))
    assert result.hours[0].timestamp == NOW
    assert result.hours[0].irradiance_w_m2 == 1  # t+1 mean covers [t,t+1]
    assert result.hours[-1].irradiance_w_m2 == 72
    assert result.issued_at is None
    assert result.retrieved_at == NOW
    assert result.data_kind == 'provider'
    assert result.hours[0].cloud_cover_percent == 40
    assert result.hours[0].humidity_percent == 65


@pytest.mark.parametrize('defect', ['null', 'missing_hour', 'units', 'http', 'bad_json', 'duplicate'])
def test_provider_bad_data_fails_closed(defect):
    payload = provider_payload()
    if defect == 'null':
        payload['hourly']['wind_speed_80m'][0] = None
    if defect == 'missing_hour':
        payload['hourly']['time'].pop()
    if defect == 'duplicate':
        payload['hourly']['time'][1] = payload['hourly']['time'][0]
    if defect == 'units':
        payload['hourly_units']['wind_speed_80m'] = 'km/h'
    def serve(request):
        if defect == 'http':
            return httpx.Response(503)
        if defect == 'bad_json':
            return httpx.Response(200, text='invalid')
        return httpx.Response(200, json=payload)
    with pytest.raises(WeatherProviderError):
        fetch_weather(connection(), NOW, transport=httpx.MockTransport(serve))


def test_solar_charging_explanation_matches_feasible_schedule():
    station = config().model_copy(update={'solar_capacity_kw': 400, 'wind_capacity_kw': 0})
    schedule = hours(4)
    for i, row in enumerate(schedule):
        row.update(load_kw=100, irradiance_w_m2=1000 if i < 2 else 0)
    result = compare(station, current(), schedule)
    explained = explain(station, schedule, result, NOW.isoformat(), True)
    charging = [r for r in explained['recommendations'] if r['code'] == 'charge_renewable']
    assert charging
    for recommendation in charging:
        e = recommendation['evidence']
        assert e['battery_charge_kw'] > 0
        assert e['generator_kw'] < 1e-4
        assert recommendation['placement'] == 'insights'
        assert recommendation['contains_synthetic_data']
        assert 'solar' in recommendation['title']


def test_full_battery_is_not_told_to_charge_without_headroom():
    station = config().model_copy(update={'solar_capacity_kw': 400})
    schedule = hours(2)
    for row in schedule:
        row.update(load_kw=10, irradiance_w_m2=1000)
    result = compare(station, current(battery_kwh=540), schedule)
    explained = explain(station, schedule, result, NOW.isoformat(), False)
    assert not any(r['code'] == 'charge_renewable' for r in explained['recommendations'])


def test_high_wind_cutout_is_alert_and_zero_generation():
    station = config().model_copy(update={'wind_cut_out_m_s': 20})
    schedule = hours(1)
    schedule[0]['wind_speed_m_s'] = 22
    assert renewable(station, schedule[0])[1] == 0
    result = compare(station, current(), schedule)
    explained = explain(station, schedule, result, NOW.isoformat(), False)
    assert any(a.get('code') == 'wind_cutout' and a['placement'] == 'alert_bar' for a in explained['alerts'])
    assert not any('wind' in r['title'] for r in explained['recommendations'])


def test_two_stations_refresh_cache_and_failure_isolation(tmp_path):
    calls = []
    fail = [False]
    def fetch(profile, now, horizon):
        calls.append(profile.latitude)
        if fail[0]:
            raise WeatherProviderError('Provider unavailable')
        value = fetch_weather(profile, now, horizon, transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=provider_payload())))
        return value
    app = create_app(tmp_path / 'db.sqlite3', KEY, clock=lambda: NOW, weather_fetcher=fetch)
    for station_id in ('bharati', 'maitri'):
        seed(app.state.store, NOW, station_id)
    with TestClient(app, headers={'X-API-Key': KEY}) as client:
        assert {s['id'] for s in client.get('/api/v1/stations').json()} == {'bharati', 'maitri'}
        for station_id, lat in [('bharati', -69.4), ('maitri', -70.7)]:
            assert client.put(f'/api/v1/stations/{station_id}/weather/connection', json=connection(lat).model_dump()).status_code == 200
            response = client.post(f'/api/v1/stations/{station_id}/forecast', json={'horizon_hours': 2})
            assert response.status_code == 200, response.text
            assert response.json()['weather_issued_at'] is None
            assert response.json()['weather_metadata']['connection']['latitude'] == lat
        assert calls == [-69.4, -70.7]
        assert client.post('/api/v1/stations/bharati/forecast', json={'horizon_hours': 2}).status_code == 200
        assert len(calls) == 2
        before = client.get('/api/v1/stations/maitri/weather').json()
        fail[0] = True
        assert client.post('/api/v1/stations/bharati/weather/refresh').status_code == 502
        assert client.get('/api/v1/stations/maitri/weather').json() == before
        # A changed connection must invalidate cached weather; failure cannot use old-location data.
        client.put('/api/v1/stations/bharati/weather/connection', json=connection(-68).model_dump())
        assert client.post('/api/v1/stations/bharati/forecast', json={}).status_code == 502
