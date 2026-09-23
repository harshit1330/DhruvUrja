"""Configure station weather separately. --demo-readings explicitly refreshes synthetic readings."""
import argparse
from energy.api import create_app
from energy.demo import seed, station_config
from energy.schemas import WeatherConnection

STATIONS = {
    'bharati': ('Bharati', -69.4068333, 76.1953333),
    'maitri': ('Maitri', -70.7644444, 11.7341667),
}


def setup(store, demo_readings=False):
    for station_id, (name, latitude, longitude) in STATIONS.items():
        if demo_readings:
            seed(store, station_id=station_id, name=name)
        elif store.get(station_id, 'station') is None:
            store.put(station_id, 'station', station_config(name).model_dump(mode='json'))
        if store.get(station_id, 'weather_connection') is None:
            # Demonstration equipment assumptions, NOT verified station panel/turbine details.
            connection = WeatherConnection(latitude=latitude, longitude=longitude,
                         panel_tilt_degrees=60, panel_azimuth_degrees=180, wind_height_m=80)
            store.put(station_id, 'weather_connection', connection.model_dump(mode='json'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo-readings', action='store_true')
    args = parser.parse_args()
    setup(create_app().state.store, args.demo_readings)
    print('Configured separate Bharati and Maitri stations with live weather connections.')
    print('Equipment/panel/turbine configuration is illustrative; replace with verified specifications.')
    if args.demo_readings:
        print('Load history, battery and fuel readings are explicitly SYNTHETIC for both stations.')
