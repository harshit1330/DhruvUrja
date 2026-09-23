import json
import sqlite3
from pathlib import Path


class Store:
    """Local persistent store; ingestion batches commit atomically."""
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS records '
                       '(station TEXT, kind TEXT, key TEXT, payload TEXT NOT NULL, '
                       'PRIMARY KEY(station,kind,key))')

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def put_many(self, station, kind, entries):
        with self.connect() as db:
            db.executemany('INSERT INTO records VALUES (?,?,?,?) '
                           'ON CONFLICT(station,kind,key) DO UPDATE SET payload=excluded.payload',
                           [(station, kind, key, json.dumps(value)) for key, value in entries])

    def put(self, station, kind, value, key='current'):
        self.put_many(station, kind, [(key, value)])

    def get(self, station, kind, key='current'):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM records WHERE station=? AND kind=? AND key=?',
                             (station, kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, station, kind):
        with self.connect() as db:
            rows = db.execute('SELECT payload FROM records WHERE station=? AND kind=? ORDER BY key',
                              (station, kind)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def stations(self):
        with self.connect() as db:
            rows = db.execute("SELECT station,payload FROM records WHERE kind='station' ORDER BY station").fetchall()
        return [{'id': row[0], **json.loads(row[1])} for row in rows]
