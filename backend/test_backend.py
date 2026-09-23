from datetime import datetime, timedelta, timezone
import math
import pytest
from fastapi.testclient import TestClient
from energy.api import create_app
from energy.demo import seed
from energy.dispatch import compare, solve
from energy.schemas import Station, Snapshot

NOW = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
KEY = 'test-key-for-local-backend'


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / 'test.sqlite3', api_key=KEY, clock=lambda: NOW)
    seed(app.state.store, NOW)
    with TestClient(app, headers={'X-API-Key': KEY}) as client:
        yield client


def config():
    return Station(name='Test', solar_capacity_kw=200, wind_capacity_kw=100,
                   generator_capacity_kw=240, generator_min_kw=30, generator_idle_lph=2,
                   battery_capacity_kwh=600, battery_power_kw=80, fuel_reserve_l=1200)


def current(**updates):
    return Snapshot(timestamp=NOW, load_kw=120, battery_kwh=400, fuel_l=4200,
                    source='test', data_kind='synthetic').model_copy(update=updates)


def hours(n=24, **changes):
    return [dict(timestamp=(NOW + timedelta(hours=i)).isoformat(), load_kw=130,
                 irradiance_w_m2=900 * max(0, math.sin((i-6) * math.pi / 12)),
                 wind_speed_m_s=8, **changes) for i in range(n)]


def assert_physics(station, snapshot, result):
    previous, fuel = snapshot.battery_kwh, snapshot.fuel_l
    for h in result['hours']:
        supply = h['solar_available_kw'] + h['wind_available_kw'] - h['curtailed_kw'] + h['generator_kw'] + h['battery_discharge_kw'] - h['battery_charge_kw']
        assert supply + h['essential_unserved_kw'] + h['flexible_unserved_kw'] == pytest.approx(h['load_kw'], abs=1e-5)
        assert h['battery_end_kwh'] == pytest.approx(previous + h['battery_charge_kw'] * station.battery_efficiency - h['battery_discharge_kw'] / station.battery_efficiency, abs=1e-5)
        assert h['battery_charge_kw'] * h['battery_discharge_kw'] < 1e-4
        assert station.battery_capacity_kwh * station.battery_min_fraction - 1e-5 <= h['battery_end_kwh'] <= station.battery_capacity_kwh * station.battery_max_fraction + 1e-5
        assert h['generator_kw'] <= station.generator_capacity_kw + 1e-5
        if h['generator_kw'] > 1e-5:
            assert h['generator_kw'] >= station.generator_min_kw - 1e-5
        fuel -= h['fuel_used_l']
        assert h['fuel_remaining_l'] == pytest.approx(fuel)
        previous = h['battery_end_kwh']
    assert result['fuel_remaining_l'] >= min(snapshot.fuel_l, station.fuel_reserve_l) - 1e-4
    assert result['battery_end_kwh'] >= result['terminal_target_kwh'] - 1e-4


def test_dispatch_conservation_and_fair_savings():
    station, snapshot = config(), current()
    result = compare(station, snapshot, hours())
    for name in ('optimized', 'baseline'):
        assert_physics(station, snapshot, result[name])
    assert result['fuel_saved_l'] > 0
    assert result['optimized']['essential_unserved_kwh'] < 1e-4


@pytest.mark.parametrize('scenario', ['outage', 'reserve', 'darkness', 'low_load'])
def test_extreme_scenarios(scenario):
    station, snapshot, schedule = config(), current(), hours(8)
    if scenario == 'outage':
        snapshot = current(generator_available=False)
    if scenario == 'reserve':
        snapshot = current(fuel_l=1200)
    if scenario == 'darkness':
        for h in schedule:
            h['irradiance_w_m2'] = 0
    if scenario == 'low_load':
        for h in schedule:
            h.update(load_kw=5, irradiance_w_m2=0, wind_speed_m_s=0)
    result = compare(station, snapshot, schedule)
    assert_physics(station, snapshot, result['optimized'])
    if scenario in ('outage', 'reserve'):
        assert result['fuel_saved_l'] is None
        assert result['optimized']['fuel_used_l'] == pytest.approx(0, abs=1e-5)
        assert result['alerts']


def test_authentication(client):
    assert client.get('/health', headers={'X-API-Key': ''}).status_code == 200
    assert client.get('/api/v1/stations/demo-polar', headers={'X-API-Key': 'wrong'}).status_code == 401


def test_forecast_and_persisted_plan(client):
    response = client.post('/api/v1/stations/demo-polar/plan', json={'horizon_hours': 24})
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan['contains_synthetic_data'] is True
    assert len(plan['forecast']['hours']) == 24
    assert plan['forecast']['evaluation']['holdout_hours'] == 72
    assert client.get('/api/v1/stations/demo-polar/plans/latest').json()['id'] == plan['id']


def test_simulation_does_not_change_station_or_live_plan(client):
    before = client.get('/api/v1/stations/demo-polar/overview').json()
    response = client.post('/api/v1/stations/demo-polar/simulate', json={
        'horizon_hours': 12, 'generator_failure': True, 'polar_darkness': True, 'renewable_multiplier': 0})
    assert response.status_code == 200, response.text
    assert response.json()['optimized']['essential_unserved_kwh'] > 0
    assert response.json()['fuel_saved_l'] is None
    assert client.get('/api/v1/stations/demo-polar/overview').json() == before
    assert client.get('/api/v1/stations/demo-polar/plans/latest').status_code == 404


def test_missing_weather_rejected(client):
    store = client.app.state.store
    weather = store.get('demo-polar', 'weather')
    weather['hours'] = weather['hours'][:2]
    store.put('demo-polar', 'weather', weather)
    response = client.post('/api/v1/stations/demo-polar/forecast', json={})
    assert response.status_code == 409
    assert 'every requested hour' in response.json()['detail']


@pytest.mark.parametrize('kind', ['weather', 'snapshot', 'history'])
def test_stale_inputs_rejected(client, kind):
    store = client.app.state.store
    if kind == 'history':
        with store.connect() as db:
            db.execute("DELETE FROM records WHERE kind='reading' AND key=?", ((NOW-timedelta(hours=5)).isoformat(),))
    else:
        value = store.get('demo-polar', kind)
        value['issued_at' if kind == 'weather' else 'timestamp'] = (NOW-timedelta(days=1)).isoformat()
        store.put('demo-polar', kind, value)
    assert client.post('/api/v1/stations/demo-polar/plan', json={}).status_code == 409


def test_validation_and_station_isolation(client):
    assert client.post('/api/v1/stations/missing/plan', json={}).status_code == 404
    assert client.post('/api/v1/stations/demo-polar/plan', json={'horizon_hours': 500}).status_code == 422
    snapshot = client.get('/api/v1/stations/demo-polar/overview').json()['snapshot']
    snapshot['timestamp'] = '2026-09-13T12:00:00'
    assert client.put('/api/v1/stations/demo-polar/snapshot', json=snapshot).status_code == 422


def test_infeasible_target_reported():
    with pytest.raises(ValueError, match='optimal schedule'):
        station = config().model_copy(update={'solar_capacity_kw': 0, 'wind_capacity_kw': 0})
        solve(station, current(generator_available=False), hours(1), terminal_fraction=0.9)
