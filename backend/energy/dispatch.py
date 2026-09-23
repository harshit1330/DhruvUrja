"""Hourly mixed-integer advisory scheduling, with lexicographic reliability priorities."""
import numpy as np
from scipy.optimize import linprog
from .schemas import Station, Snapshot


def renewable(station, hour):
    # Generic, uncalibrated curves. Input irradiance must be panel-plane and wind hub-height.
    solar = station.solar_capacity_kw * min(1, hour['irradiance_w_m2'] / 1000) * 0.85
    speed = hour['wind_speed_m_s']
    factor = (0 if speed < station.wind_cut_in_m_s or speed >= station.wind_cut_out_m_s else
              min(1, (speed**3 - station.wind_cut_in_m_s**3) /
                  (station.wind_rated_m_s**3 - station.wind_cut_in_m_s**3)))
    return solar, station.wind_capacity_kw * factor


def solve(station: Station, snapshot: Snapshot, hours, terminal_fraction=None, diesel_only=False):
    n = len(hours)
    # Per-hour variables: diesel, charge, discharge, end SOC, curtailed renewable,
    # essential shortfall, flexible shortfall, battery charging binary, generator-on binary.
    size = n * 9
    idx = lambda h, k: 9 * h + k
    bounds, integrality, equality, rhs, inequalities, upper = [], np.zeros(size), [], [], [], []
    available = [renewable(station, h) if not diesel_only else (0, 0) for h in hours]
    minimum = station.battery_min_fraction * station.battery_capacity_kwh
    maximum = station.battery_max_fraction * station.battery_capacity_kwh
    target = snapshot.battery_kwh if terminal_fraction is None else terminal_fraction * station.battery_capacity_kwh
    if not minimum <= snapshot.battery_kwh <= maximum:
        raise ValueError('Current battery energy is outside configured operating limits')
    if not minimum <= target <= maximum:
        raise ValueError('Terminal battery target is outside operating limits')
    generator_limit = station.generator_capacity_kw if snapshot.generator_available else 0
    fuel = np.zeros(size)
    for t, hour in enumerate(hours):
        demand = hour['load_kw']
        essential = demand * station.essential_load_fraction
        bounds.extend([(0, generator_limit), (0, station.battery_power_kw),
                       (0, station.battery_power_kw), (minimum, maximum),
                       (0, sum(available[t])), (0, essential), (0, demand - essential), (0, 1), (0, 1)])
        integrality[idx(t, 7)] = integrality[idx(t, 8)] = 1
        row = np.zeros(size)
        for k, coefficient in [(0, 1), (1, -1), (2, 1), (4, -1), (5, 1), (6, 1)]:
            row[idx(t, k)] = coefficient
        equality.append(row)
        rhs.append(demand - sum(available[t]))
        row = np.zeros(size)
        row[idx(t, 3)] = 1
        row[idx(t, 1)] = -station.battery_efficiency
        row[idx(t, 2)] = 1 / station.battery_efficiency
        if t:
            row[idx(t - 1, 3)] = -1
        equality.append(row)
        rhs.append(snapshot.battery_kwh if t == 0 else 0)
        # Battery cannot charge and discharge at the same time.
        for terms, limit in [([(1, 1), (7, -station.battery_power_kw)], 0),
                             ([(2, 1), (7, station.battery_power_kw)], station.battery_power_kw),
                             ([(0, 1), (8, -generator_limit)], 0),
                             ([(0, -1), (8, station.generator_min_kw)], 0)]:
            row = np.zeros(size)
            for k, coefficient in terms:
                row[idx(t, k)] = coefficient
            inequalities.append(row)
            upper.append(limit)
        fuel[idx(t, 0)] = station.generator_l_per_kwh
        fuel[idx(t, 8)] = station.generator_idle_lph
    row = np.zeros(size)
    row[idx(n - 1, 3)] = -1
    inequalities.extend([row, fuel.copy()])
    upper.extend([-target, max(0, snapshot.fuel_l - station.fuel_reserve_l)])

    objectives = []
    for shortfall in (5, 6):
        objective = np.zeros(size)
        objective[shortfall::9] = 1
        objectives.append(objective)
    objectives.append(fuel)
    # Minimize essential shortage, then flexible shortage, then fuel; no arbitrary penalty tradeoff.
    for objective in objectives:
        result = linprog(objective, A_ub=np.array(inequalities), b_ub=np.array(upper),
                         A_eq=np.array(equality), b_eq=np.array(rhs), bounds=bounds,
                         integrality=integrality, method='highs', options={'time_limit': 15, 'mip_rel_gap': 0})
        if not result.success:
            raise ValueError('No optimal schedule found within limits; check terminal battery target and equipment availability')
        inequalities.append(objective.copy())
        upper.append(float(result.fun) + 1e-7)
    # Among equal fuel schedules avoid unnecessary battery cycling.
    throughput = np.zeros(size)
    throughput[1::9] = throughput[2::9] = 1
    result = linprog(throughput, A_ub=np.array(inequalities), b_ub=np.array(upper),
                     A_eq=np.array(equality), b_eq=np.array(rhs), bounds=bounds,
                     integrality=integrality, method='highs', options={'time_limit': 15, 'mip_rel_gap': 0})
    if not result.success:
        raise ValueError('Schedule solver could not verify an optimal result')
    values = result.x.reshape(n, 9)
    remaining = snapshot.fuel_l
    output = []
    for hour, source, v in zip(hours, available, values):
        burn = v[0] * station.generator_l_per_kwh + v[8] * station.generator_idle_lph
        remaining -= burn
        output.append({'timestamp': hour['timestamp'], 'load_kw': hour['load_kw'],
                       'solar_available_kw': source[0], 'wind_available_kw': source[1],
                       'generator_kw': float(v[0]), 'battery_charge_kw': float(v[1]),
                       'battery_discharge_kw': float(v[2]), 'battery_end_kwh': float(v[3]),
                       'curtailed_kw': float(v[4]), 'essential_unserved_kw': float(v[5]),
                       'flexible_unserved_kw': float(v[6]), 'fuel_used_l': float(burn),
                       'fuel_remaining_l': float(remaining)})
    return {'hours': output, 'fuel_used_l': float(snapshot.fuel_l - remaining),
            'essential_unserved_kwh': float(values[:, 5].sum()),
            'flexible_unserved_kwh': float(values[:, 6].sum()),
            'battery_start_kwh': snapshot.battery_kwh, 'battery_end_kwh': float(values[-1, 3]),
            'terminal_target_kwh': target, 'fuel_remaining_l': float(remaining),
            'fuel_reserve_l': station.fuel_reserve_l}


def compare(station, snapshot, hours, terminal_fraction=None):
    optimized = solve(station, snapshot, hours, terminal_fraction)
    baseline = solve(station, snapshot, hours, terminal_fraction, diesel_only=True)
    reliable = all(p['essential_unserved_kwh'] + p['flexible_unserved_kwh'] < 1e-4 for p in (optimized, baseline))
    savings = baseline['fuel_used_l'] - optimized['fuel_used_l'] if reliable else None
    return {'optimized': optimized, 'baseline': baseline, 'fuel_saved_l': savings,
            'fuel_saved_percent': 100 * savings / baseline['fuel_used_l'] if reliable and baseline['fuel_used_l'] > 1e-6 else None,
            'comparison_note': 'Same demand, fuel stock, battery start and terminal target; baseline disables renewables. Savings withheld if either schedule leaves demand unmet.',
            'renewable_model_note': 'Generic solar derating and cubic wind curve; not calibrated for a specific station. No icing, wake or snow model.',
            'alerts': ([{'severity': 'critical', 'message': 'Essential demand cannot be fully served under these constraints.'}]
                       if optimized['essential_unserved_kwh'] > 1e-4 else [])
                      + ([{'severity': 'warning', 'message': 'Flexible demand has a shortfall; operator action required.'}]
                         if optimized['flexible_unserved_kwh'] > 1e-4 else [])
                      + ([{'severity': 'warning', 'message': 'Fuel is at or below the configured reserve.'}]
                         if optimized['fuel_remaining_l'] <= station.fuel_reserve_l + 1e-4 else [])}
