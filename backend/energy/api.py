import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path as ApiPath
from fastapi.security import APIKeyHeader
from pydantic import Field
from .dispatch import compare
from .forecast import forecast
from .schemas import Reading, Snapshot, Station, Weather, WeatherConnection, PlanRequest, SimulationRequest
from .weather import fetch_weather, WeatherProviderError
from .recommendations import explain
from .store import Store
from .schemas import ResupplyRequest
from .resupply import assess_resupply

ROOT = Path(__file__).resolve().parents[1]
StationID = Annotated[str, ApiPath(pattern=r'^[a-zA-Z0-9_-]{1,64}$')]


def create_app(db_path=None, api_key=None, clock=None, weather_fetcher=None):
    path = Path(db_path or os.getenv('DHRUVURJA_DB', str(ROOT / 'data' / 'energy.sqlite3')))
    store = Store(path)
    now = clock or (lambda: datetime.now(timezone.utc))
    fetch = weather_fetcher or fetch_weather
    key = api_key or os.getenv('DHRUVURJA_API_KEY')
    if not key:
        key_path = path.parent / 'api-key.txt'
        try:
            with key_path.open('x', encoding='utf-8') as f:
                f.write(secrets.token_urlsafe(32))
        except FileExistsError:
            pass
        key = key_path.read_text(encoding='utf-8').strip()
    if len(key) < 16:
        raise ValueError('API key must be at least 16 characters')
    header = APIKeyHeader(name='X-API-Key', auto_error=False)

    def authorize(value=Depends(header)):
        if not value or not secrets.compare_digest(value, key):
            raise HTTPException(401, 'Valid X-API-Key required')

    app = FastAPI(title='Dhruvurja Fresh Backend', version='0.2.0',
                  description='Station-specific live weather, load forecasting, advisory dispatch and explanations.')
    router = APIRouter(prefix='/api/v1', dependencies=[Depends(authorize)])
    app.state.store = store

    def station_for(station_id):
        value = store.get(station_id, 'station')
        if value is None:
            raise HTTPException(404, 'Station not found')
        return Station.model_validate(value)

    def required(station_id, kind, schema):
        value = store.get(station_id, kind)
        if value is None:
            raise HTTPException(409, f'Missing {kind} input')
        return schema.model_validate(value)

    def refresh_weather(station_id, connection):
        try:
            weather = fetch(connection, now(), 72)
        except WeatherProviderError as error:
            raise HTTPException(502, str(error)) from error
        store.put(station_id, 'weather', weather.model_dump(mode='json'))
        return weather

    def make_forecast(station_id, horizon):
        station_for(station_id)
        connection_value = store.get(station_id, 'weather_connection')
        if connection_value and connection_value['enabled']:
            connection = WeatherConnection.model_validate(connection_value)
            cached_value = store.get(station_id, 'weather')
            cached = Weather.model_validate(cached_value) if cached_value else None
            start = now().replace(minute=0, second=0, microsecond=0)
            needed = {start + timedelta(hours=i) for i in range(horizon)}
            usable = (cached and cached.data_kind == 'provider' and cached.retrieved_at
                      and timedelta(0) <= now() - cached.retrieved_at < timedelta(hours=1)
                      and needed.issubset({h.timestamp for h in cached.hours})
                      and cached.provider_metadata.get('connection') == connection.model_dump(mode='json'))
            if not usable:
                refresh_weather(station_id, connection)
        weather = required(station_id, 'weather', Weather)
        readings = [Reading.model_validate(r) for r in store.all(station_id, 'reading')]
        try:
            return forecast(readings, weather, now(), horizon)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @app.get('/health')
    def health():
        return {'status': 'ok', 'service': 'dhruvurja-fresh', 'version': '0.2.0'}

    @router.get('/stations')
    def list_stations():
        return store.stations()

    @router.put('/stations/{station_id}')
    def put_station(station_id: StationID, value: Station):
        store.put(station_id, 'station', value.model_dump(mode='json'))
        return {'id': station_id, **value.model_dump()}

    @router.get('/stations/{station_id}')
    def get_station(station_id: StationID):
        return {'id': station_id, **station_for(station_id).model_dump()}

    @router.post('/stations/{station_id}/readings')
    def readings(station_id: StationID, values: Annotated[list[Reading], Field(min_length=1, max_length=2160)]):
        station_for(station_id)
        if len({r.timestamp for r in values}) != len(values):
            raise HTTPException(422, 'Duplicate reading timestamps within batch')
        if any(r.timestamp + timedelta(hours=1) > now() for r in values):
            raise HTTPException(422, 'Only completed hourly averages can be ingested')
        store.put_many(station_id, 'reading', [(r.timestamp.isoformat(), r.model_dump(mode='json')) for r in values])
        return {'upserted': len(values)}

    @router.put('/stations/{station_id}/snapshot')
    def snapshot(station_id: StationID, value: Snapshot):
        station = station_for(station_id)
        if value.timestamp > now():
            raise HTTPException(422, 'Snapshot cannot be in the future')
        if value.battery_kwh > station.battery_capacity_kwh:
            raise HTTPException(422, 'Battery energy exceeds installed capacity')
        previous = store.get(station_id, 'snapshot')
        if previous and value.timestamp < Snapshot.model_validate(previous).timestamp:
            raise HTTPException(409, 'Snapshot is older than the current stored reading')
        store.put(station_id, 'snapshot', value.model_dump(mode='json'))
        return value

    @router.put('/stations/{station_id}/weather')
    def weather(station_id: StationID, value: Weather):
        station_for(station_id)
        if any(t and t > now() for t in (value.issued_at, value.retrieved_at)):
            raise HTTPException(422, 'Weather issue/retrieval time cannot be in the future')
        previous = store.get(station_id, 'weather')
        if previous and value.freshness_time < Weather.model_validate(previous).freshness_time:
            raise HTTPException(409, 'Weather forecast is older than the stored forecast')
        store.put(station_id, 'weather', value.model_dump(mode='json'))
        return {'stored_hours': len(value.hours), 'source': value.source, 'issued_at': value.issued_at}

    @router.put('/stations/{station_id}/weather/connection')
    def put_weather_connection(station_id: StationID, value: WeatherConnection):
        station_for(station_id)
        store.put(station_id, 'weather_connection', value.model_dump(mode='json'))
        return value

    @router.get('/stations/{station_id}/weather/connection')
    def get_weather_connection(station_id: StationID):
        station_for(station_id)
        return required(station_id, 'weather_connection', WeatherConnection)

    @router.post('/stations/{station_id}/weather/refresh')
    def refresh_weather_endpoint(station_id: StationID):
        station_for(station_id)
        connection = required(station_id, 'weather_connection', WeatherConnection)
        if not connection.enabled:
            raise HTTPException(409, 'Live weather connection is disabled')
        return refresh_weather(station_id, connection)

    @router.get('/stations/{station_id}/weather')
    def get_weather(station_id: StationID):
        station_for(station_id)
        return required(station_id, 'weather', Weather)

    @router.get('/stations/{station_id}/overview')
    def overview(station_id: StationID):
        station = station_for(station_id)
        current = required(station_id, 'snapshot', Snapshot)
        today = now().date()
        rows = [Reading.model_validate(r) for r in store.all(station_id, 'reading')]
        rows = [r for r in rows if r.timestamp.date() == today and r.timestamp + timedelta(hours=1) <= now()]
        return {'station': station, 'snapshot': current,
                'snapshot_age_minutes': (now() - current.timestamp).total_seconds() / 60,
                'today_utc_energy_kwh': sum(r.load_kw for r in rows) if rows else None,
                'completed_hours_received_today': len(rows), 'completed_hours_expected_today': now().hour,
                'note': 'Today totals cover received completed UTC hours only; current load is an instantaneous kW reading.'}

    @router.post('/stations/{station_id}/forecast')
    def get_forecast(station_id: StationID, request: PlanRequest):
        return make_forecast(station_id, request.horizon_hours)

    def plan(station_id, request, simulation=False):
        station = station_for(station_id)
        snapshot = required(station_id, 'snapshot', Snapshot)
        timestamp = now()
        if timestamp - snapshot.timestamp > timedelta(hours=2) or snapshot.timestamp > timestamp:
            raise HTTPException(409, 'A station snapshot within the last two hours is required')
        predictions = make_forecast(station_id, request.horizon_hours)
        hours = [dict(h) for h in predictions['hours']]
        effective_station, effective_snapshot = station, snapshot
        if simulation:
            for hour in hours:
                hour['load_kw'] *= request.load_multiplier
                if request.polar_darkness:
                    hour['irradiance_w_m2'] = 0
            effective_station = station.model_copy(update={
                'solar_capacity_kw': station.solar_capacity_kw * request.renewable_multiplier,
                'wind_capacity_kw': station.wind_capacity_kw * request.renewable_multiplier})
            effective_snapshot = snapshot.model_copy(update={
                'generator_available': snapshot.generator_available and not request.generator_failure,
                'fuel_l': snapshot.fuel_l if request.fuel_override_l is None else request.fuel_override_l})
        try:
            result = compare(effective_station, effective_snapshot, hours, request.terminal_battery_fraction)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        run_id = str(uuid4())
        result.update(explain(effective_station, hours, result, timestamp.isoformat(),
                              predictions['contains_synthetic_data'] or snapshot.data_kind == 'synthetic' or station.configuration_kind == 'synthetic'))
        result.update({'id': run_id, 'station_id': station_id, 'generated_at': timestamp.isoformat(),
                       'simulation': simulation, 'request': request.model_dump(mode='json'),
                       'forecast': predictions, 'station_configuration': station.model_dump(mode='json'),
                       'snapshot': snapshot.model_dump(mode='json'),
                       'contains_synthetic_data': predictions['contains_synthetic_data'] or snapshot.data_kind == 'synthetic' or station.configuration_kind == 'synthetic',
                       'time_step_hours': 1,
                       'note': 'Advisory hourly-average schedule from the current UTC hour. Refresh after input changes. Forecast uncertainty is reported but not probabilistically optimized.'})
        if not simulation:
            store.put(station_id, 'plan', result, run_id)
            store.put(station_id, 'latest_plan', result)
        return result

    @router.post('/stations/{station_id}/recommendations')
    def get_recommendations(station_id: StationID, request: PlanRequest):
        result = plan(station_id, request)
        return {k: result[k] for k in ('id', 'station_id', 'generated_at', 'contains_synthetic_data',
                                      'recommendations', 'alerts', 'recommendation_note', 'forecast')}

    @router.post('/stations/{station_id}/plan')
    def get_plan(station_id: StationID, request: PlanRequest):
        return plan(station_id, request)

    @router.post('/stations/{station_id}/simulate')
    def simulate(station_id: StationID, request: SimulationRequest):
        return plan(station_id, request, simulation=True)

    @router.get('/stations/{station_id}/plans/latest')
    def latest_plan(station_id: StationID):
        station_for(station_id)
        result = store.get(station_id, 'latest_plan')
        if result is None:
            raise HTTPException(404, 'No plan has been generated')
        return result

    @router.get('/stations/{station_id}/resupply')
    def get_resupply(station_id: StationID):
        station = station_for(station_id)
        snapshot = required(station_id, 'snapshot', Snapshot)
        saved = store.get(station_id, 'resupply')
        response = {'station_id': station_id, 'settings': saved['settings'] if saved else None,
                    'inventory': snapshot.model_dump(mode='json'), 'protected_reserve_l': station.fuel_reserve_l,
                    'assessment': None, 'error': None}
        if saved:
            try:
                response['assessment'] = assess_resupply(station, snapshot, ResupplyRequest.model_validate(saved['settings']), now())
            except ValueError as error:
                response['error'] = str(error)
        return response

    @router.post('/stations/{station_id}/resupply')
    def set_resupply(station_id: StationID, request: ResupplyRequest):
        station = station_for(station_id)
        snapshot = required(station_id, 'snapshot', Snapshot)
        try:
            result = assess_resupply(station, snapshot, request, now())
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        store.put(station_id, 'resupply', {'settings': request.model_dump(mode='json'), 'assessment': result})
        return {'station_id': station_id, 'settings': request.model_dump(mode='json'),
                'inventory': snapshot.model_dump(mode='json'), 'protected_reserve_l': station.fuel_reserve_l,
                'assessment': result, 'error': None}

    app.include_router(router)
    return app
