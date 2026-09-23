"""Opt-in synthetic telemetry clock for the local presentation preview."""
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from threading import Event

SOURCE = 'deterministic-demo-generator'


def refresh_demo(store, now=None):
    now = now or datetime.now(timezone.utc)
    hour = now.replace(minute=0, second=0, microsecond=0)
    count = 0
    # Check provenance and update in one transaction, so real ingestion cannot
    # slip between the guard and a demo write.
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        for station_id in ('bharati', 'maitri'):
            records = db.execute('SELECT kind,key,payload FROM records WHERE station=?', (station_id,)).fetchall()
            station = next((json.loads(p) for k, _, p in records if k == 'station'), {})
            snapshot = next((json.loads(p) for k, _, p in records if k == 'snapshot'), {})
            readings = [json.loads(p) for k, _, p in records if k == 'reading']
            synthetic = lambda r: r.get('data_kind') == 'synthetic' and r.get('source') == SOURCE
            if station.get('configuration_kind') != 'synthetic' or not synthetic(snapshot) or not readings or not all(map(synthetic, readings)):
                continue
            if datetime.fromisoformat(snapshot['timestamp']) > now:
                continue
            def sample(t):
                temperature = -25 + 5 * math.sin(t.timestamp() / 86400 * 0.3)
                load = 85 + max(0, -temperature) * 2 + 18 * math.sin((t.hour - 6) * math.tau / 24) + 3 * math.sin(t.timestamp() / 3600)
                return {'timestamp': t.isoformat(), 'load_kw': load, 'temperature_c': temperature,
                        'source': SOURCE, 'data_kind': 'synthetic'}
            existing = {datetime.fromisoformat(r['timestamp']) for r in readings}
            for offset in range(960, 0, -1):
                timestamp = hour - timedelta(hours=offset)
                if timestamp not in existing:
                    row = sample(timestamp)
                    db.execute('INSERT OR IGNORE INTO records VALUES (?,?,?,?)',
                               (station_id, 'reading', row['timestamp'], json.dumps(row)))
            # Demo fuel and battery remain scenario inputs, not simulated
            # physical consumption. Preserve their configured values.
            snapshot.update(timestamp=now.isoformat(), load_kw=sample(now)['load_kw'])
            db.execute("UPDATE records SET payload=? WHERE station=? AND kind='snapshot' AND key='current'",
                       (json.dumps(snapshot), station_id))
            count += 1
    return count


def run_feed(store, stop):
    while not stop.wait(30):
        try:
            refresh_demo(store)
        except Exception:
            logging.exception('Synthetic preview telemetry refresh failed')
