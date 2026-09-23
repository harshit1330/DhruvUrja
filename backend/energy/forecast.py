"""Chronological load forecasting. No fabricated input/weather fallback."""
import math
from datetime import timedelta
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from .schemas import Reading, Weather


def features(timestamp, temperature, previous_day):
    angle = timestamp.hour * math.tau / 24
    return [math.sin(angle), math.cos(angle), timestamp.weekday(), temperature, previous_day]


def predict_sequence(model, hours, known, seasonal=False):
    known = dict(known)
    result = []
    for hour in hours:
        previous = known[hour.timestamp - timedelta(hours=24)]
        value = previous if seasonal else float(model.predict([
            features(hour.timestamp, hour.temperature_c, previous)])[0])
        result.append(max(0, value))
        known[hour.timestamp] = max(0, value)
    return np.array(result)


def forecast(readings: list[Reading], weather: Weather, now, horizon):
    start = now.replace(minute=0, second=0, microsecond=0)
    # Only completed historical hours; avoid partial current-hour leakage.
    rows = sorted((r for r in readings if r.timestamp < start), key=lambda r: r.timestamp)
    if len(rows) < 24 * 28:
        raise ValueError('At least 28 days of contiguous hourly load/temperature history required')
    rows = rows[-24 * 90:]
    if rows[-1].timestamp != start - timedelta(hours=1):
        raise ValueError('Load history must extend through the last completed hour')
    if any(b.timestamp - a.timestamp != timedelta(hours=1) for a, b in zip(rows, rows[1:])):
        raise ValueError('Load history has gaps or duplicate hours')
    if weather.freshness_time > now or now - weather.freshness_time > timedelta(hours=12):
        raise ValueError('Weather issue/retrieval time must be within the last 12 hours')
    weather_map = {h.timestamp: h for h in weather.hours}
    stamps = [start + timedelta(hours=i) for i in range(horizon)]
    if any(t not in weather_map for t in stamps):
        raise ValueError('Weather forecast does not cover every requested hour')
    future = [weather_map[t] for t in stamps]

    def fit(history):
        known = {r.timestamp: r.load_kw for r in history}
        x = [features(r.timestamp, r.temperature_c, known[r.timestamp - timedelta(hours=24)])
             for r in history[24:]]
        model = RandomForestRegressor(n_estimators=60, min_samples_leaf=3, random_state=26061, n_jobs=1)
        model.fit(x, [r.load_kw for r in history[24:]])
        return model, known

    # Last 72 hours held out chronologically; recursive lag24, no true future load leakage.
    train, holdout = rows[:-72], rows[-72:]
    candidate, known = fit(train)
    predictions = predict_sequence(candidate, holdout, known)
    baseline = predict_sequence(candidate, holdout, known, seasonal=True)
    actual = np.array([r.load_kw for r in holdout])
    rf_mae = float(np.mean(abs(predictions - actual)))
    baseline_mae = float(np.mean(abs(baseline - actual)))
    seasonal = baseline_mae <= rf_mae
    errors = abs((baseline if seasonal else predictions) - actual)
    spread = float(np.quantile(errors, 0.9))
    model, known = fit(rows)
    values = predict_sequence(model, future, known, seasonal=seasonal)
    return {
        'model': 'seasonal_previous_day' if seasonal else 'random_forest_weather_lag24',
        'generated_at': now.isoformat(), 'history_through': rows[-1].timestamp.isoformat(),
        'weather_issued_at': weather.issued_at.isoformat() if weather.issued_at else None,
        'weather_retrieved_at': weather.retrieved_at.isoformat() if weather.retrieved_at else None,
        'weather_metadata': weather.provider_metadata, 'weather_source': weather.source,
        'contains_synthetic_data': weather.data_kind == 'synthetic' or any(r.data_kind == 'synthetic' for r in rows),
        'training_sources': sorted({r.source for r in rows}),
        'evaluation': {'holdout_hours': 72, 'random_forest_mae_kw': rf_mae,
                       'seasonal_baseline_mae_kw': baseline_mae,
                       'selected_mae_kw': float(np.mean(errors)),
                       'note': 'Model selection uses this holdout; not an independent test. Historical observed weather used; not archived weather forecasts.'},
        'interval_note': 'Plus/minus 90th percentile absolute holdout error; empirical band, not calibrated coverage.',
        'hours': [{'timestamp': h.timestamp.isoformat(), 'load_kw': float(v),
                   'low_kw': max(0, float(v) - spread), 'high_kw': float(v) + spread,
                   'temperature_c': h.temperature_c, 'irradiance_w_m2': h.irradiance_w_m2,
                   'wind_speed_m_s': h.wind_speed_m_s, 'cloud_cover_percent': h.cloud_cover_percent,
                   'humidity_percent': h.humidity_percent} for h, v in zip(future, values)]}
