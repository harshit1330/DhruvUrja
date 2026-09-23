"""Explain verified dispatch outputs; no invented actions or external text generator."""
from datetime import datetime, timedelta


def explain(station, hours, result, generated_at, contains_synthetic_data):
    recommendations, alerts = [], []
    schedule = result['optimized']['hours']
    for i, row in enumerate(schedule):
        weather = hours[i]
        start = row['timestamp']
        end = (datetime.fromisoformat(start) + timedelta(hours=1)).isoformat()
        solar, wind = row['solar_available_kw'], row['wind_available_kw']
        used = solar + wind - row['curtailed_kw']
        charge = row['battery_charge_kw']
        common = {'starts_at': start, 'ends_at': end, 'generated_at': generated_at,
                  'contains_synthetic_data': contains_synthetic_data,
                  'evidence': {'load_kw': row['load_kw'], 'solar_available_kw': solar,
                               'wind_available_kw': wind, 'wind_speed_m_s': weather['wind_speed_m_s'],
                               'battery_charge_kw': charge, 'battery_discharge_kw': row['battery_discharge_kw'],
                               'battery_end_kwh': row['battery_end_kwh'], 'generator_kw': row['generator_kw']}}
        def add(code, title, message):
            recommendations.append({**common, 'id': f'{code}:{start}', 'code': code,
                                    'placement': 'insights', 'title': title, 'message': message})
        sources = 'solar and wind' if solar > 0.1 and wind > 0.1 else 'solar' if solar > 0.1 else 'wind'
        if charge > 0.1 and used >= row['load_kw'] + charge - 1e-4 and row['generator_kw'] < 1e-4:
            add('charge_renewable', f'Charge the battery using {sources}',
                f'Forecast {sources} generation covers demand with surplus available. '
                f'The schedule charges at {charge:.1f} kW, reaching {row["battery_end_kwh"]:.1f} kWh by the end of this hour.')
        elif used > 0.1:
            add('use_renewables', f'Use available {sources} generation',
                f'The schedule uses {used:.1f} kW of combined renewable power. '
                f'Diesel output is {row["generator_kw"]:.1f} kW and battery discharge is {row["battery_discharge_kw"]:.1f} kW.')
        if row['generator_kw'] > 0.1 and solar + wind < row['load_kw'] * 0.25:
            add('diesel_backup', 'Plan diesel backup for low renewable output',
                f'Expected renewable availability is {solar + wind:.1f} kW against {row["load_kw"]:.1f} kW demand. '
                f'The schedule calls for {row["generator_kw"]:.1f} kW diesel output while respecting the battery target and fuel reserve.')
        if charge > 0.1 and row['generator_kw'] > 0.1:
            add('mixed_charge', 'Follow the planned battery charging schedule',
                f'Charge at {charge:.1f} kW with diesel operating at {row["generator_kw"]:.1f} kW. '
                'This is not a solar-only charging interval; the schedule accounts for generator minimum output and the terminal battery target.')
        if station.wind_capacity_kw > 0 and weather['wind_speed_m_s'] >= station.wind_cut_out_m_s:
            alerts.append({**common, 'id': f'wind_cutout:{start}', 'code': 'wind_cutout',
                           'placement': 'alert_bar', 'severity': 'warning',
                           'message': f'Forecast wind reaches {weather["wind_speed_m_s"]:.1f} m/s, at or above the configured '
                           f'{station.wind_cut_out_m_s:.1f} m/s turbine cut-out. The plan assumes zero wind generation; review backup supply.'})
    # Group-level shortage/reserve alerts already computed by the optimizer.
    for i, alert in enumerate(result['alerts']):
        alerts.append({**alert, 'id': f'plan_alert:{i}', 'placement': 'alert_bar',
                       'generated_at': generated_at, 'contains_synthetic_data': contains_synthetic_data})
    return {'recommendations': recommendations, 'alerts': alerts,
            'recommendation_note': 'Rule-based explanations of this calculated schedule, not a separately trained AI model. Times are UTC. Recalculate after input changes.'}
