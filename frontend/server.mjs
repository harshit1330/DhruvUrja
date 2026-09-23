import express from 'express';
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(root, 'public');
const port = Number(process.env.PORT || 3002);
const backendUrl = (process.env.DHRUVURJA_BACKEND_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

async function loadApiKey() {
  if (process.env.DHRUVURJA_API_KEY) return process.env.DHRUVURJA_API_KEY;
  try {
    return (await readFile(resolve(root, '../backend/data/api-key.txt'), 'utf8')).trim();
  } catch {
    return 'dhruvurja-public-demo-key-2026';
  }
}

const apiKey = await loadApiKey();
const sessionSecret = process.env.DHRUVURJA_SESSION_SECRET || apiKey;
const publicWeather = new Map();
const app = express();

app.disable('x-powered-by');
app.use(express.json({limit: '20kb'}));

const equal = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

function issueSession(station) {
  const payload = Buffer.from(JSON.stringify({
    username: 'demo_operator',
    role: 'station_operator',
    station,
    expires: Date.now() + 8 * 3600000,
    nonce: randomBytes(12).toString('hex'),
  })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.expires > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function backend(path, options = {}) {
  return fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {'X-API-Key': apiKey, ...options.headers},
    signal: options.signal || AbortSignal.timeout(150000),
  });
}

async function loginWeather(station) {
  const current = publicWeather.get(station);
  if (current && current.expires > Date.now()) return current.promise;
  const entry = {expires: Date.now() + 60000};
  entry.promise = (async () => {
    const path = `/api/v1/stations/${station}/weather`;
    let response = await backend(path, {signal: AbortSignal.timeout(30000)});
    let weather = await response.json();
    const hour = Math.floor(Date.now() / 3600000) * 3600000;
    const usable = () => response.ok && weather.data_kind === 'provider' &&
      Date.now() - Date.parse(weather.retrieved_at) < 3600000 &&
      weather.hours?.some(item => Date.parse(item.timestamp) === hour);
    if (!usable()) {
      response = await backend(`${path}/refresh`, {method: 'POST', signal: AbortSignal.timeout(30000)});
      weather = await response.json();
    }
    if (!usable()) throw Error('Live weather unavailable');
    const reading = weather.hours.find(item => Date.parse(item.timestamp) === hour);
    return {station, temperature_c: reading.temperature_c, wind_speed_kmh: reading.wind_speed_m_s * 3.6,
      cloud_cover_percent: reading.cloud_cover_percent, timestamp: reading.timestamp,
      retrieved_at: weather.retrieved_at, source: 'Open-Meteo'};
  })().catch(error => {
    if (publicWeather.get(station) === entry) publicWeather.delete(station);
    throw error;
  });
  publicWeather.set(station, entry);
  return entry.promise;
}

app.get('/api/public/weather/:station', async (request, response) => {
  if (!['bharati', 'maitri'].includes(request.params.station)) {
    return response.status(404).json({detail: 'Station weather not available'});
  }
  try {
    return response.json(await loginWeather(request.params.station));
  } catch {
    return response.status(503).json({detail: 'Live weather is temporarily unavailable. Please try again.'});
  }
});

app.use('/api/v1', async (request, response) => {
  try {
    if (request.headers.origin && new URL(request.headers.origin).host !== request.get('host')) {
      return response.status(403).json({detail: 'Origin not allowed'});
    }
    const path = `/api/v1${request.path === '/' ? '' : request.path}`;
    if (path === '/api/v1/auth/login' && request.method === 'POST') {
      const {username, password, station} = request.body || {};
      if (!equal(username, 'demo_operator') || !equal(password, 'polar-demo-password')) {
        return response.status(401).json({detail: 'Incorrect operator ID or password'});
      }
      if (!['bharati', 'maitri'].includes(station)) {
        return response.status(403).json({detail: 'This preview connects Bharati and Maitri. Select one of these stations.'});
      }
      return response.json({access_token: issueSession(station), token_type: 'bearer'});
    }

    const session = readSession(request.headers.authorization?.replace(/^Bearer /, ''));
    if (!session) return response.status(401).json({detail: 'Session expired. Please log in again.'});
    if (path === '/api/v1/auth/me') return response.json(session);
    if (path === '/api/v1/auth/logout') return response.json({ok: true});

    if (path === '/api/v1/stations' && request.method === 'GET') {
      const result = await backend(path, {signal: AbortSignal.timeout(10000)});
      if (!result.ok) {
        const detail = await result.text();
        console.error(`DhruvUrja backend station list failed (${result.status}): ${detail}`);
        return response.status(result.status).json({detail: `Station list unavailable (${result.status})`});
      }
      return response.json((await result.json()).filter(station => station.id === session.station));
    }

    const match = path.match(/^\/api\/v1\/stations\/([a-z0-9_-]+)(\/.*)?$/);
    if (!match || match[1] !== session.station) {
      return response.status(403).json({detail: 'This session is scoped to the selected station'});
    }
    const tail = match[2] || '';
    const allowed = request.method === 'GET' && ['', '/overview', '/weather', '/plans/latest', '/resupply'].includes(tail) ||
      request.method === 'POST' && ['/plan', '/forecast', '/simulate', '/recommendations', '/weather/refresh', '/resupply'].includes(tail);
    if (!allowed) return response.status(403).json({detail: 'Action not available in this preview'});

    const result = await backend(path, {method: request.method, headers: {'content-type': 'application/json'},
      body: request.method === 'GET' ? undefined : JSON.stringify(request.body || {})});
    return response.status(result.status).json(await result.json());
  } catch {
    return response.status(502).json({detail: 'Backend unavailable or request timed out. Please retry.'});
  }
});

app.use(express.static(publicRoot, {index: 'index.html'}));
app.use((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return response.sendStatus(405);
  return response.sendFile(resolve(publicRoot, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(port, '127.0.0.1', () => console.log(`Connected DhruvUrja preview: http://localhost:${port}/#home`));
}

export default app;
