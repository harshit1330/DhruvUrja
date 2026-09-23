from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from energy.api import create_app
from energy.demo import seed
from energy.resupply import assess_resupply
from energy.schemas import ResupplyRequest
from test_backend import config, current, KEY

NOW = datetime(2026, 9, 13, tzinfo=timezone.utc)


def inputs(**updates):
    values = dict(expected_arrival_date=(NOW+timedelta(days=119)).date(), daily_consumption_l=100,
                  higher_use_percent=0, delay_days=[15,30], assumption_note='Operator estimate')
    values.update(updates)
    return ResupplyRequest(**values)


def snapshot(**updates):
    return current(timestamp=NOW, fuel_l=15200, **updates)


def test_reserve_and_delay_margins():
    result = assess_resupply(config(), snapshot(), inputs(), NOW)
    assert result['usable_fuel_l'] == 14000
    assert result['base_endurance_days'] == 140
    assert [s['days_to_cover'] for s in result['scenarios']] == [120,135,150]
    assert [s['base']['reserve_margin_days'] for s in result['scenarios']] == [20,5,-10]
    assert result['scenarios'][2]['base']['shortfall_l'] == 1000
    assert result['scenarios'][2]['base']['projected_total_fuel_l'] == 200
    assert result['scenarios'][2]['maximum_daily_consumption_l'] == pytest.approx(14000/150)
    assert len(result['alerts']) == 1


def test_higher_use_case_flags_risk_without_claiming_prediction():
    result = assess_resupply(config(), snapshot(), inputs(higher_use_percent=20), NOW)
    assert result['scenarios'][0]['status'] == 'at_risk'
    assert result['scenarios'][0]['base']['shortfall_l'] == 0
    assert result['scenarios'][0]['higher_use']['shortfall_l'] == 400
    assert 'not predictions' in result['method_note']


def test_exact_boundary_preserves_reserve():
    result = assess_resupply(config(), current(timestamp=NOW, fuel_l=13200), inputs(delay_days=[]), NOW)
    assert result['scenarios'][0]['status'] == 'covered'
    assert result['scenarios'][0]['base']['reserve_margin_l'] == 0
    assert result['scenarios'][0]['base']['projected_total_fuel_l'] == 1200


def test_arrival_today_and_reserve_already_breached():
    result = assess_resupply(config(), current(timestamp=NOW, fuel_l=500), inputs(expected_arrival_date=NOW.date()), NOW)
    assert result['usable_fuel_l'] == 0
    assert result['scenarios'][0]['days_to_cover'] == 1
    assert result['scenarios'][0]['status'] == 'shortfall'
    assert result['alerts'][0]['severity'] == 'critical'


@pytest.mark.parametrize('changes', [{'daily_consumption_l':0},{'daily_consumption_l':1e-300},
    {'delay_days':[15,15]}, {'delay_days':[-1]}, {'delay_days':[181]}, {'higher_use_percent':-5}])
def test_invalid_assumptions(changes):
    with pytest.raises(ValidationError):
        inputs(**changes)


def test_past_date_and_stale_inventory_rejected():
    with pytest.raises(ValueError, match='past'):
        assess_resupply(config(), snapshot(), inputs(expected_arrival_date=(NOW-timedelta(days=1)).date()), NOW)
    with pytest.raises(ValueError, match='snapshot'):
        assess_resupply(config(), snapshot(), inputs(), NOW+timedelta(hours=3))


def test_station_scoped_persistence_and_no_inventory_mutation(tmp_path):
    clock=[NOW]
    app=create_app(tmp_path/'db.sqlite3', KEY, clock=lambda:clock[0])
    for station_id in ('bharati','maitri'):
        seed(app.state.store, NOW, station_id)
    with TestClient(app,headers={'X-API-Key':KEY}) as client:
        assert client.get('/api/v1/stations/bharati/resupply').json()['settings'] is None
        before=client.get('/api/v1/stations/bharati/overview').json()['snapshot']
        response=client.post('/api/v1/stations/bharati/resupply',json=inputs().model_dump(mode='json'))
        assert response.status_code==200,response.text
        assert response.json()['assessment']['contains_synthetic_data']
        assert client.get('/api/v1/stations/bharati/resupply').json()['settings']['daily_consumption_l']==100
        assert client.get('/api/v1/stations/maitri/resupply').json()['settings'] is None
        assert client.get('/api/v1/stations/bharati/overview').json()['snapshot']==before
        clock[0]+=timedelta(hours=3)
        stale=client.get('/api/v1/stations/bharati/resupply').json()
        assert stale['assessment'] is None and stale['settings'] is not None
        assert 'snapshot' in stale['error']
