import uvicorn
import argparse
import os
from pathlib import Path
from threading import Event, Thread

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo-feed', action='store_true', help='Keep explicitly synthetic Bharati/Maitri demo telemetry current')
    args = parser.parse_args()
    stop = Event()
    application = 'energy.api:create_app'
    if args.demo_feed:
        from energy.demo_feed import refresh_demo, run_feed
        from energy.store import Store
        store = Store(os.getenv('DHRUVURJA_DB', str(Path(__file__).parent / 'data' / 'energy.sqlite3')))
        refresh_demo(store)
        Thread(target=run_feed, args=(store, stop), daemon=True).start()
        from energy.api import create_app
        from starlette.concurrency import run_in_threadpool
        application = create_app()
        @application.middleware('http')
        async def current_demo_inputs(request, call_next):
            if request.url.path.startswith('/api/v1/stations/'):
                await run_in_threadpool(refresh_demo, store)
            return await call_next(request)
        print('Synthetic presentation telemetry enabled; real/operator records are excluded.')
    try:
        uvicorn.run(application, factory=not args.demo_feed, host='127.0.0.1', port=8001)
    finally:
        stop.set()
