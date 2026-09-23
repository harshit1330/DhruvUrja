"""Deterministic fuel-budget assessment, not a seasonal weather prediction."""
from datetime import datetime, timedelta, timezone, time
from .schemas import ResupplyRequest, Station, Snapshot


def assess_resupply(station: Station, snapshot: Snapshot, request: ResupplyRequest, now):
    if snapshot.timestamp > now or now - snapshot.timestamp > timedelta(hours=2):
        raise ValueError('A fuel snapshot within the last two hours is required; refresh inventory first')
    if request.expected_arrival_date < now.date():
        raise ValueError('Expected arrival is in the past; update the resupply date')
    if (request.expected_arrival_date - now.date()).days > 730:
        raise ValueError('Expected arrival must be within the next 730 days')
    usable = max(0, snapshot.fuel_l - station.fuel_reserve_l)
    base = request.daily_consumption_l
    higher = base * (1 + request.higher_use_percent / 100)
    # Include the full arrival day so the plan does not assume fuel appears at midnight.
    arrival_end = datetime.combine(request.expected_arrival_date + timedelta(days=1), time(), timezone.utc)
    origin = snapshot.timestamp
    budget_days = usable / base
    stress_days = usable / higher
    scenarios = []
    for delay in [0, *request.delay_days]:
        end = arrival_end + timedelta(days=delay)
        days = (end - origin).total_seconds() / 86400
        def case(rate):
            required = rate * days
            return {'daily_consumption_l': rate, 'required_fuel_l': required,
                    'reserve_margin_l': usable - required, 'reserve_margin_days': usable / rate - days,
                    'shortfall_l': max(0, required - usable),
                    'projected_total_fuel_l': max(0, snapshot.fuel_l - required),
                    'required_reduction_percent': max(0, 100 * (1 - usable / required))}
        normal, stress = case(base), case(higher)
        status = 'shortfall' if normal['shortfall_l'] > 1e-6 else 'at_risk' if stress['shortfall_l'] > 1e-6 else 'covered'
        scenarios.append({'delay_days': delay, 'arrival_date': (request.expected_arrival_date + timedelta(days=delay)).isoformat(),
                          'coverage_through': end.isoformat(), 'days_to_cover': days,
                          'status': status, 'base': normal, 'higher_use': stress,
                          'maximum_daily_consumption_l': usable / days})
    last_day = scenarios[-1]['days_to_cover']
    steps = sorted({0.0, last_day, *[min(last_day, float(i)) for i in range(1, int(last_day)+1, max(1, int(last_day)//150))]})
    trajectory = [{'timestamp': (origin + timedelta(days=day)).isoformat(), 'elapsed_days': day,
                   'base_fuel_l': max(0, snapshot.fuel_l - base * day),
                   'higher_use_fuel_l': max(0, snapshot.fuel_l - higher * day)} for day in steps]
    alerts = []
    for s in scenarios:
        if s['status'] != 'covered':
            case_name = 'base' if s['status'] == 'shortfall' else 'higher_use'
            alerts.append({'id': f'resupply:{s["delay_days"]}', 'code': 'resupply_shortfall',
                           'severity': 'warning', 'placement': 'alert_bar', 'generated_at': now.isoformat(),
                           'message': f'Resupply {"on time" if not s["delay_days"] else str(s["delay_days"])+" days late"}: '
                           f'{s[case_name]["shortfall_l"]:.0f} L fuel-budget gap in the {"base" if case_name=="base" else "higher-use"} assumption, excluding protected reserve.'})
    if snapshot.fuel_l < station.fuel_reserve_l:
        alerts.insert(0, {'id': 'resupply:reserve', 'code': 'fuel_reserve_breached', 'severity': 'critical',
                         'placement': 'alert_bar', 'generated_at': now.isoformat(),
                         'message': 'Current fuel inventory is already below the protected reserve.'})
    return {'generated_at': now.isoformat(), 'inventory_timestamp': origin.isoformat(),
            'inventory_source': snapshot.source, 'inventory_kind': snapshot.data_kind,
            'contains_synthetic_data': snapshot.data_kind == 'synthetic' or station.configuration_kind == 'synthetic' or request.assumption_basis == 'illustrative_example',
            'settings': request.model_dump(mode='json'), 'fuel_inventory_l': snapshot.fuel_l,
            'protected_reserve_l': station.fuel_reserve_l, 'usable_fuel_l': usable,
            'base_endurance_days': budget_days, 'higher_use_endurance_days': stress_days,
            'base_reserve_reached_at': (origin + timedelta(days=min(budget_days, 100000)) ).isoformat() if budget_days <= 100000 else None,
            'scenarios': scenarios, 'trajectory': trajectory, 'alerts': alerts,
            'method_note': 'Constant daily fuel-use assumptions from the inventory timestamp through the end of each arrival date (UTC). No delivery is credited before arrival. Higher-use and delay cases are configurable stress tests, not predictions or probability bounds.',
            'action_note': 'Daily fuel limits and reduction percentages are budget targets only. Feasibility while meeting essential demand must be checked separately; never automatically shed essential loads.'}
