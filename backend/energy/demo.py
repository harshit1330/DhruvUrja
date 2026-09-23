"""Explicit synthetic demo seed. Never accesses the old ZIP/backend."""
import math
from datetime import datetime, timedelta, timezone
from .schemas import Reading, Snapshot, Station, Weather, WeatherHour


def station_config(name='Polar demonstration station'):
    return Station(name=name, solar_capacity_kw=180, wind_capacity_kw=100,
                   generator_capacity_kw=240, generator_min_kw=30, generator_idle_lph=2,
                   battery_capacity_kwh=600, battery_power_kw=80, fuel_reserve_l=1200,
                   configuration_kind='synthetic', configuration_source='Example hardware; not actual station specifications')


def seed(store, now=None, station_id='demo-polar', name='Polar demonstration station'):
    now = now or datetime.now(timezone.utc)
    start = now.replace(minute=0, second=0, microsecond=0)
    source = {'source': 'deterministic-demo-generator', 'data_kind': 'synthetic'}
    station = station_config(name)
    def temperature(t):
        return -25 + 5 * math.sin(t.timestamp() / 86400 * 0.3)
    def demand(t):
        return 85 + max(0, -temperature(t)) * 2 + 18 * math.sin((t.hour - 6) * math.tau / 24) + 3 * math.sin(t.timestamp() / 3600)
    rows = [Reading(timestamp=start - timedelta(hours=960-i), load_kw=demand(start - timedelta(hours=960-i)),
                    temperature_c=temperature(start - timedelta(hours=960-i)), **source) for i in range(960)]
    weather = Weather(issued_at=now, hours=[WeatherHour(timestamp=start + timedelta(hours=i),
                      temperature_c=temperature(start + timedelta(hours=i)),
                      irradiance_w_m2=900 * max(0, math.sin(((start.hour+i) % 24 - 6) * math.pi / 12)),
                      wind_speed_m_s=8 + 3 * math.sin(i / 8)) for i in range(72)], **source)
    snapshot = Snapshot(timestamp=now, load_kw=demand(now), battery_kwh=400, fuel_l=4200, **source)
    store.put(station_id, 'station', station.model_dump(mode='json'))
    store.put_many(station_id, 'reading', [(r.timestamp.isoformat(), r.model_dump(mode='json')) for r in rows])
    store.put(station_id, 'weather', weather.model_dump(mode='json'))
    store.put(station_id, 'snapshot', snapshot.model_dump(mode='json'))
    return station_id


if __name__ == '__main__':
    from .api import create_app
    app = create_app()
    print('Seeded SYNTHETIC station:', seed(app.state.store))
