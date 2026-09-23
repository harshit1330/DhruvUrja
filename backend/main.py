"""Vercel entrypoint for the DhruvUrja demonstration backend."""

import os
from pathlib import Path

from starlette.concurrency import run_in_threadpool

from energy.api import create_app
from energy.demo_feed import refresh_demo
from setup_stations import setup


database = os.getenv('DHRUVURJA_DB')
if not database:
    database = str(Path('/tmp/dhruvurja.sqlite3') if os.getenv('VERCEL') else Path(__file__).parent / 'data' / 'energy.sqlite3')

api_key = os.getenv('DHRUVURJA_API_KEY', 'dhruvurja-public-demo-key-2026')
app = create_app(db_path=database, api_key=api_key)
setup(app.state.store, demo_readings=True)


@app.middleware('http')
async def current_demo_inputs(request, call_next):
    if request.url.path.startswith('/api/v1/stations/'):
        await run_in_threadpool(refresh_demo, app.state.store)
    return await call_next(request)

