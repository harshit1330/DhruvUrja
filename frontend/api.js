const KEY = 'dhruv-fresh-tokens';
let tokens;
try { tokens = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { tokens = null; }
let refreshing;
export const hasToken = () => Boolean(tokens?.access_token);
export function clearAuth() { tokens = null; sessionStorage.removeItem(KEY); }
function save(value) { tokens = value; sessionStorage.setItem(KEY, JSON.stringify(value)); }
export async function api(path, options = {}, retry = true) {
  const response = await fetch('/api/v1' + path, {...options, signal: options.signal || AbortSignal.timeout(150000), headers:{'Content-Type':'application/json', ...(tokens ? {Authorization:`Bearer ${tokens.access_token}`} : {}), ...options.headers}});
  if (response.status === 401 && tokens?.refresh_token && retry && path !== '/auth/login') {
    refreshing ||= api('/auth/refresh', {method:'POST',body:JSON.stringify({refresh_token:tokens.refresh_token})}, false).then(save).finally(()=>{refreshing=null;});
    try { await refreshing; } catch { clearAuth(); window.dispatchEvent(new Event('auth-expired')); throw Error('Session expired. Please log in again.'); }
    return api(path, options, false);
  }
  const value = await response.json().catch(()=>null);
  if (!response.ok) {
    if(response.status===401 && path!=='/auth/login'){clearAuth();window.dispatchEvent(new Event('auth-expired'));}
    const detail = value?.detail;
    const error = Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(e=>e.msg).join('; ') : `Request failed (${response.status})`);
    error.status=response.status;
    throw error;
  }
  return value;
}
export async function signIn(username, password, station) {
  clearAuth();
  save(await api('/auth/login', {method:'POST',body:JSON.stringify({username,password,station})}));
  return api('/auth/me');
}
