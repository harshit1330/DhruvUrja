from datetime import datetime, timedelta, timezone
from energy.demo import seed
from energy.demo_feed import refresh_demo
from energy.store import Store


def test_demo_feed_crosses_hour_without_resetting_inventory_or_weather(tmp_path):
    store = Store(tmp_path / 'test.sqlite3')
    start = datetime(2026, 9, 13, 10, 30, tzinfo=timezone.utc)
    seed(store, now=start, station_id='bharati')
    snapshot = store.get('bharati', 'snapshot')
    snapshot.update(fuel_l=3100, battery_kwh=250)
    store.put('bharati', 'snapshot', snapshot)
    weather = store.get('bharati', 'weather')
    store.put('bharati', 'resupply', {'arrival': '2027-01-01'})
    later = start + timedelta(hours=4)
    assert refresh_demo(store, later) == 1
    current = store.get('bharati', 'snapshot')
    assert current['fuel_l'] == 3100 and current['battery_kwh'] == 250
    assert datetime.fromisoformat(current['timestamp']) == later
    rows = store.all('bharati', 'reading')
    latest = max(datetime.fromisoformat(r['timestamp']) for r in rows)
    assert latest == later.replace(minute=0) - timedelta(hours=1)
    assert all(r['data_kind'] == 'synthetic' for r in rows)
    assert store.get('bharati', 'weather') == weather
    assert store.get('bharati', 'resupply') == {'arrival': '2027-01-01'}
    refresh_demo(store, later)
    assert store.all('bharati', 'reading') == rows


def test_demo_feed_does_not_change_operator_records(tmp_path):
    store = Store(tmp_path / 'test.sqlite3')
    start = datetime(2026, 9, 13, 10, 30, tzinfo=timezone.utc)
    seed(store, now=start, station_id='maitri')
    snapshot = store.get('maitri', 'snapshot')
    snapshot.update(data_kind='operator', source='station operator')
    store.put('maitri', 'snapshot', snapshot)
    rows = store.all('maitri', 'reading')
    assert refresh_demo(store, start + timedelta(hours=3)) == 0
    assert store.get('maitri', 'snapshot') == snapshot
    assert store.all('maitri', 'reading') == rows
