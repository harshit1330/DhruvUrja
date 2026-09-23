# DhruvUrja

DhruvUrja is an intelligent energy-management prototype for polar research stations. It combines station telemetry, weather-aware load forecasting, renewable-energy dispatch planning, operational recommendations, scenario simulation, and fuel-resupply assessment in one dashboard.

## Highlights

- Interactive dashboards for the Bharati, Maitri, and Himadri research stations
- FastAPI backend with API-key authentication and SQLite persistence
- Weather-aware energy-demand forecasting
- Solar, wind, battery, and diesel dispatch optimization
- Scenario simulator and resupply-risk assessment
- Demo data feed for local evaluation

## Technology

- Frontend: HTML, CSS, and JavaScript served by Node.js
- Backend: Python, FastAPI, NumPy, SciPy, and scikit-learn
- Storage: SQLite

## Run locally

Requirements: Python 3.14 and Node.js.

On Windows, run `Start Backend.cmd`, wait for the API to start, and then run `Start Frontend.cmd`.

Alternatively, start each service manually:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py --demo-feed
```

In a second terminal:

```powershell
cd frontend
npm start
```

Open <http://localhost:3002>. API documentation is available at <http://localhost:8001/docs>.

The backend creates its local database and API key under `backend/data/`; these runtime files are intentionally excluded from version control.

