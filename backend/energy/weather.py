"""Open-Meteo adapter. Radiation end-of-interval stamps are aligned to our start stamps."""
from datetime import datetime, timedelta, timezone
import httpx
from pydantic import ValidationError
from .schemas import Weather, WeatherConnection, WeatherHour

URL = 'https://api.open-meteo.com/v1/forecast'


class WeatherProviderError(Exception):
    pass


def fetch_weather(connection: WeatherConnection, now, horizon=72, transport=None):
    start = now.replace(minute=0, second=0, microsecond=0)
    wind = f'wind_speed_{connection.wind_height_m}m'
    params = {'latitude': connection.latitude, 'longitude': connection.longitude,
              'hourly': f'temperature_2m,{wind},global_tilted_irradiance,cloud_cover,relative_humidity_2m',
              'temperature_unit': 'celsius', 'wind_speed_unit': 'ms', 'timezone': 'UTC',
              'tilt': connection.panel_tilt_degrees, 'azimuth': connection.panel_azimuth_degrees,
              'start_hour': start.strftime('%Y-%m-%dT%H:%M'),
              'end_hour': (start + timedelta(hours=horizon)).strftime('%Y-%m-%dT%H:%M')}
    try:
        with httpx.Client(timeout=20, transport=transport) as client:
            response = client.get(URL, params=params)
            response.raise_for_status()
            payload = response.json()
        hourly, units = payload['hourly'], payload['hourly_units']
        if payload.get('utc_offset_seconds') != 0:
            raise ValueError('Provider returned non-UTC times')
        if units[wind] != 'm/s' or units['temperature_2m'] != '°C' or units['global_tilted_irradiance'] != 'W/m²':
            raise ValueError('Unexpected provider units')
        stamps = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in hourly['time']]
        if len(set(stamps)) != len(stamps):
            raise ValueError('Duplicate provider timestamps')
        if any(len(hourly[k]) != len(stamps) for k in (wind, 'temperature_2m', 'global_tilted_irradiance')):
            raise ValueError('Mismatched provider arrays')
        lookup = {t: i for i, t in enumerate(stamps)}
        for optional in ('cloud_cover', 'relative_humidity_2m'):
            if optional in hourly and (len(hourly[optional]) != len(stamps) or units.get(optional) != '%'):
                raise ValueError('Invalid optional weather field')
        hours = []
        for step in range(horizon):
            t = start + timedelta(hours=step)
            i, end_i = lookup[t], lookup[t + timedelta(hours=1)]
            # Temp/wind are instantaneous at t; radiation at t+1 is mean over [t,t+1].
            hours.append(WeatherHour(timestamp=t, temperature_c=hourly['temperature_2m'][i],
                         wind_speed_m_s=hourly[wind][i], irradiance_w_m2=hourly['global_tilted_irradiance'][end_i],
                         cloud_cover_percent=hourly.get('cloud_cover', [None] * len(stamps))[i],
                         humidity_percent=hourly.get('relative_humidity_2m', [None] * len(stamps))[i]))
        return Weather(source='Open-Meteo / best_match', data_kind='provider', issued_at=None,
                       retrieved_at=now, hours=hours,
                       provider_metadata={'provider_url': 'https://open-meteo.com/',
                           'attribution': 'Weather data by Open-Meteo.com (CC BY 4.0)',
                           'connection': connection.model_dump(mode='json'),
                           'grid_latitude': payload['latitude'], 'grid_longitude': payload['longitude'],
                           'model': 'best_match; individual model/run identity not returned',
                           'issue_time_note': 'Provider does not report a model issue time; retrieved_at is request time only.',
                           'alignment_note': 'Panel-plane radiation is hourly mean aligned to interval start; temperature/wind are instantaneous samples.',
                           'wind_height_m': connection.wind_height_m})
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, ValidationError) as error:
        raise WeatherProviderError('Weather provider unavailable or returned incomplete/invalid data; stored weather was not replaced.') from error
