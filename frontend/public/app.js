import { simulatorPage, setupSimulator, resetSimulator } from './simulator.js?v=1';
import { createStationGlobe } from './station-globe.js?v=1';
import { signIn, api, clearAuth, hasToken } from './api.js';
import { backend, resetBackend, loadBackend, stationValues, dataLabel, latestDate, recordDate, metricHistory, runBackendScenario } from './backend-data.js';
import {resupplyPanel, mountResupply, loadResupply, resupplyState, resupplyAlerts} from './resupply.js';
let stationGlobe=null;
const $ = (s, p = document) => p.querySelector(s);
const iconPaths = {
  flask: '<path d="M9 3h6m-5 0v7L4 20q0 1 2 1h12q2 0 2-1l-6-10V3M7 16h10"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  mountain: '<path d="m2 20 8-15 5 8 3-5 5 12H2Zm5-9 3 3 3-3"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M3 3v18h18M6 15l5-6 4 3 6-8"/>',
  fuel: '<path d="M3 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M2 21h14M3 10h11m0 3h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V8l-4-4m2 2-2 2 4 4"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 16h4a3 3 0 1 1-3 3"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .5-10 7 7 0 0 1 13 3A4 4 0 0 1 19 19H7"/>',
  temp: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 8v10"/>',
  battery: '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M23 10v4M6 9v6m4-6v6m4-6v6"/>',
  drop: '<path d="M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13ZM8 15a4 4 0 0 0 4 4"/>',
  shield: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Z"/><path d="m8 11 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  exit: '<path d="M9 3H4v18h5m5-15 6 6-6 6m-6-6h12"/>',
  leaf: '<path d="M20 3C9 1 2 8 6 16c8 5 16-2 14-13ZM3 21 16 8"/>',
  chevron: '<path d="m8 4 8 8-8 8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  generator: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 6V3h10v3M7 11h4m-4 4h4m5-4h1m-1 4h1M6 20v2m12-2v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.bolt}</svg>`;
const stations = {
  bharati: { name:'Bharati', region:'Antarctica', location:'Larsemann Hills', coords:'69.41° S, 76.18° E', temp:-24, wind:32, cloud:28, humidity:64, load:186, solar:24, windPower:48, battery:78, fuel:42500, burn:680, color:'blue', desc:'A home for science at the edge of the world. Connect to the Bharati station energy workspace.' },
  maitri: { name:'Maitri', region:'Antarctica', location:'Schirmacher Oasis', coords:'70.77° S, 11.73° E', temp:-18, wind:26, cloud:42, humidity:58, load:148, solar:18, windPower:36, battery:64, fuel:31800, burn:590, color:'teal', desc:'Science powered by resilience. Explore the Maitri station energy workspace.' },
  himadri: { name:'Himadri', region:'Arctic', location:'Ny-Ålesund, Svalbard', coords:'78.92° N, 11.93° E', temp:-8, wind:18, cloud:61, humidity:73, load:62, solar:8, windPower:12, battery:86, fuel:12600, burn:210, color:'violet', desc:'A window into the changing Arctic. Explore an illustrative energy scenario for Himadri.' },
};
const readSession = () => { try { return JSON.parse(sessionStorage.getItem('dhruv-session') || 'null'); } catch { return null; } };
const readTheme = () => { try { return localStorage.getItem('dhruv-theme') === 'night' ? 'night' : 'day'; } catch { return 'day'; } };
const state = { theme:readTheme(), station:'bharati', session:readSession(), period:'24h', scenario:'normal', menu:false, dismissed:[], saved:[], alertFilter:'all' };
if (state.session && stations[state.session.station]) state.station = state.session.station;
else state.session = null;
if (!hasToken()) state.session = null;
const current = () => state.session ? {...stations[state.station],...stationValues()} : stations[state.station];
const num = (n) => Number.isFinite(n) ? n.toLocaleString('en-IN',{maximumFractionDigits:1}) : '—';
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand = (subtitle=true) => `<a href="#home" class="brand" aria-label="DhruvUrja home"><img src="assets/dhruvurja-logo.png" alt="" width="43" height="43"><span>DhruvUrja${subtitle?'<small>POLAR ENERGY INTELLIGENCE</small>':''}</span></a>`;
const badge = (text, type='green') => `<span class="badge ${type}"><i></i>${text}</span>`;
const footer = () => `<footer class="site-footer"><div class="institution-footer"><div><strong>Government of India</strong></div><div><strong>DhruvUrja</strong></div><div><strong>Ministry of Earth Sciences</strong></div></div></footer>`;
const themeToggle = () => `<div class="landing-theme-toggle" role="group" aria-label="Page appearance"><button type="button" data-theme="day" aria-pressed="${state.theme==='day'}">Day</button><button type="button" data-theme="night" aria-pressed="${state.theme==='night'}">Night</button></div>`;
const publicHeader = () => `<header class="public-header">${brand()}<div class="header-program"><span>POLAR STATION ENERGY MANAGEMENT</span></div><div class="ministry-brand"><img class="national-emblem" src="assets/national-emblem.svg" alt="National Emblem of India" width="40" height="64"><strong>Ministry of Earth Sciences</strong><span>Government of India</span><i></i><small>Our planet. Our responsibility.</small></div></header>`;

function globe() {
  return `<div class="globe-wrap"><div class="globe-orbit orbit-one"></div><div class="globe-orbit orbit-two"></div><div class="globe-label top">${icon('globe')} ONE PLANET. CONNECTED SCIENCE.</div><svg class="globe" viewBox="0 0 400 400" role="img" aria-label="Illustrative globe showing the Arctic and Antarctic research network"><defs><radialGradient id="ocean" cx="30%" cy="25%"><stop stop-color="#fff"/><stop offset=".55" stop-color="#d7ecfc"/><stop offset="1" stop-color="#91bfe8"/></radialGradient><clipPath id="sphere"><circle cx="200" cy="200" r="162"/></clipPath></defs><circle cx="200" cy="200" r="174" fill="none" stroke="#9dbfe5" stroke-opacity=".35"/><circle cx="200" cy="200" r="162" fill="url(#ocean)"/><g clip-path="url(#sphere)" stroke="#6e9ccc" stroke-width=".6" fill="none" opacity=".5"><ellipse cx="200" cy="200" rx="67" ry="162"/><ellipse cx="200" cy="200" rx="129" ry="162"/><ellipse cx="200" cy="200" rx="162" ry="47"/><ellipse cx="200" cy="200" rx="162" ry="108"/><path d="M38 200h324M200 38v324"/></g><g clip-path="url(#sphere)" fill="#f3f9ff" stroke="#7fadd5" stroke-width="1"><path d="m206 84 28-11 10 12 25-4 7 19 33 4 17 19-7 17 25 22-3 21-31-6-18 13-21-9-6 21-20-9-11-27-23-2-15-21-15 2-9-19 13-10Z"/><path d="m194 154 33 1 17 28 25 8-8 38-18 17-7 35-15 12-13-26-5-24-17-21-11-42Z"/><path d="m102 68 26 10 11 21 26 6-5 25-16 12-20-7-4 20-21-3-18-22-21-13Z"/><path d="m118 163 24 16 9 25 28 10 2 24-17 17-4 22-16 29-9-10-4-31-12-21 4-30-12-20Z"/><path d="m302 252 23-8 31 12-8 26-34 6-16-14Z"/><path d="m64 320 48-13 43 13 33-10 26 12 40-9 33 8 33-5 34 32-106 33-149-28Z"/></g><g fill="#0864d9" stroke="white" stroke-width="4"><circle cx="222" cy="80" r="7"/><circle cx="206" cy="328" r="7"/><circle cx="254" cy="324" r="7"/></g><path d="M222 80Q322 206 254 324" fill="none" stroke="#277cdb" stroke-dasharray="4 5" opacity=".7"/></svg><span class="map-label arctic">${badge('Himadri','blue')}<small>ARCTIC</small></span><span class="map-label antarctic">${badge('Maitri · Bharati','blue')}<small>ANTARCTICA</small></span><div class="globe-caption">INDIA'S POLAR RESEARCH NETWORK <span>03 STATIONS</span></div></div>`;
}

function landing() {
  const order=['maitri','bharati','himadri'];
  return `${publicHeader()}<main id="main" class="sketch-landing"><video class="landing-background-video" autoplay muted loop playsinline preload="auto" aria-hidden="true" tabindex="-1"><source src="${state.theme==='night'?'assets/night-background.mp4':'assets/background.mp4'}" type="video/mp4"></video><section class="station-nav-row"><fieldset class="station-selector"><legend>CHOOSE YOUR RESEARCH STATION</legend>${order.map(id=>`<label class="station-radio station-${id} ${state.station===id?'selected':''}"><input type="radio" name="landing-station" value="${id}" ${state.station===id?'checked':''}><span>${stations[id].name}</span><small>${stations[id].region}</small></label>`).join('')}</fieldset><div class="nav-globe station-globe" role="img" aria-label="Selected research station on Earth"></div></section><section class="centered-intro">${themeToggle()}<h1><span>DhruvUrja</span><br>Polar Energy Command Center</h1><a class="button primary landing-login" href="#login">${icon('lock')}<span class="landing-login-label">Login to ${current().name} Station</span>${icon('arrow')}</a></section><section class="station-section" id="stations"><div class="section-heading"><div><h2>Science at the ends of the Earth.</h2></div></div><div class="station-cards">${order.map((id,i)=>{const s=stations[id];return `<article class="station-card station-${id} ${state.station===id?'selected':''}"><div class="station-card-top"><span class="station-region">${icon('pin')}${s.region.toUpperCase()}</span><span class="station-number">0${i+1}</span></div><div class="station-title"><h3>${s.name}</h3>${icon('mountain')}</div><p class="station-place">${s.location}</p><p class="station-description">${{maitri:'An Antarctic research outpost in the Schirmacher Oasis.',bharati:'A coastal Antarctic research station in the Larsemann Hills.',himadri:'India’s Arctic research station in Ny-Ålesund, Svalbard.'}[id]}</p><div class="station-card-bottom"><span>${s.coords}</span><button class="text-link" data-station="${id}" aria-label="Access ${s.name} station">Access station ${icon('arrow')}</button></div></article>`;}).join('')}</div></section><div class="landing-bottom-space" aria-hidden="true"></div></main>${footer()}`;
}

function login() {
  const s=current();
  return `${publicHeader()}<main id="main" class="login-page"><video class="landing-background-video" autoplay muted loop playsinline preload="auto" aria-hidden="true" tabindex="-1"><source src="${state.theme==='night'?'assets/night-background.mp4':'assets/background.mp4'}" type="video/mp4"></video><div class="login-page-heading">${themeToggle()}<h1><span>DhruvUrja</span> Polar Energy Command Center</h1><p>${s.name} Station · Workspace Login</p></div><div class="login-layout"><section class="station-story"><div class="eyebrow">POLAR RESEARCH NETWORK</div><h2>${s.name} Station<span>${s.region.toUpperCase()}</span></h2><div class="story-location">${icon('pin')}<div><strong>${s.location}</strong><span>${s.coords}</span></div></div><div class="login-weather"><div>${icon('temp')}<span>Temperature</span><strong>${s.temp}°C</strong></div><div>${icon('wind')}<span>Wind speed</span><strong>${s.wind}<small> km/h</small></strong></div><div>${icon('cloud')}<span>Cloud cover</span><strong>${s.cloud}%</strong></div></div></section><section class="login-panel"><div class="secure-heading"><div class="login-lock">${icon('lock')}</div><div><h2>Secure Network Access</h2><p>Access ${s.name} Station systems</p></div></div><form id="login-form"><label for="login-station-name">Station</label><div class="input-wrap">${icon('pin')}<input id="login-station-name" value="${s.name} Station" readonly aria-readonly="true"></div><label for="role">Role</label><div class="input-wrap">${icon('shield')}<select id="role" name="role"><option>Station Operator</option><option>Station Manager</option><option>Research Admin</option></select></div><label for="operator">Operator ID</label><div class="input-wrap">${icon('user')}<input id="operator" name="operator" placeholder="Enter your operator ID" autocomplete="off" required maxlength="60" value="demo.operator"></div><label for="password">Password</label><div class="input-wrap">${icon('lock')}<input id="password" name="password" type="password" placeholder="Enter your password" autocomplete="off" required minlength="4" value="demo2026"><button type="button" class="icon-button" id="toggle-password" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></div><button type="submit" class="button primary full">Login to dashboard ${icon('arrow')}</button></form></section></div></main>${footer()}`;
}

const stationOptions = () => Object.entries(stations).map(([id,s])=>`<option value="${id}" ${id===state.station?'selected':''}>${s.name} Station</option>`).join('');
const navItems = [['dashboard','grid','Overview'],['forecast','chart','Load forecast'],['fuel','fuel','Fuel & logistics'],['simulator','flask','What-if Simulator'],['insights','spark','AI insights'],['alerts','bell','Alerts & notifications']];
function workspace(page) {
  const s=current(), role=({station_operator:'Station Operator',energy_manager:'Station Manager',admin:'Research Admin',analyst:'Analyst',viewer:'Viewer'}[state.session?.role] || 'Station Operator');
  const titles={simulator:'What-if Simulator',forecast:'Load forecast',fuel:'Fuel & logistics',insights:'AI insights',alerts:'Alerts & notifications'};
  return `<div class="workspace ${state.menu?'menu-open':''}"><aside id="workspace-navigation" class="sidebar" ${state.menu?'':'inert'} aria-label="Station menu"><div class="drawer-heading">${brand(false)}<button class="icon-button" data-action="menu" aria-label="Close navigation">${icon('close')}</button></div><div class="workspace-label">STATION WORKSPACE</div><div class="sidebar-station"><div class="station-symbol">${icon('mountain')}</div><div><strong>${s.name} Station</strong><small>${s.region} · Demo scenario</small></div></div><div class="workspace-label">NAVIGATION</div><nav aria-label="Workspace navigation">${navItems.map(([id,ic,label])=>`<a href="#${id}" ${page===id?'aria-current="page"':''} class="sidebar-link ${page===id?'active':''} ${id==='alerts'&&activeAlerts().length?'has-alerts':''}">${icon(ic)}<span>${id==='dashboard'?'Dashboard':label}</span>${id==='alerts'?`<span class="count">${activeAlerts().length}</span>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><button class="sidebar-link" data-action="logout">${icon('exit')} Leave workspace</button><div class="sidebar-version"><span>DhruvUrja</span></div></div></aside><button class="sidebar-scrim" aria-label="Dismiss navigation" data-action="menu"></button><div class="workspace-body"><header class="workspace-header"><div class="header-start"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation" aria-controls="workspace-navigation" aria-expanded="${state.menu}">${icon('menu')}</button><div class="dashboard-date">${icon('clock')}<span><strong>11 Sep 2026</strong><small>12:00 UTC</small></span></div></div><div class="header-welcome"><span>DhruvUrja</span><h1>${page==='dashboard'?'Welcome to '+s.name+' Station':titles[page]}</h1></div><div class="workspace-tools"><a href="#alerts" class="icon-button notification-button ${activeAlerts().length?'has-alerts':''}" aria-label="View alerts">${icon('bell')}${activeAlerts().length?`<i aria-label="${activeAlerts().length} active alerts"></i>`:''}</a><div class="role-card">${icon('user')}<span><small>YOUR ROLE</small><strong>${escapeHtml(role)}</strong></span></div></div></header><main id="main" class="dashboard-main"><div class="workspace-theme-bar">${themeToggle()}</div>${page==='dashboard'?overview():`<div class="page-context"><span>${icon('pin')} ${s.name} Station · ${s.region}</span>${liveBadge()}</div>${page==='forecast'?forecastPage():page==='fuel'?fuelPage():page==='simulator'?simulatorPage(s,state.station):page==='insights'?insightsPage():alertsPage()}`}</main>${footer()}</div></div>`;
}

const liveBadge = () => `<span class="demo-pill live-demo" title="${escapeHtml(backend.error || 'Backend record provenance; latest available readings')}"><i class="live-dot" aria-hidden="true"></i><span>${route()==='fuel'?'DEMO FUEL INVENTORY':dataLabel()}</span></span>`;
const activeAlerts = () => getAlerts().filter(a=>!state.dismissed.includes(a.id));
function weatherStrip() {
  const s=current();
  return `<div class="weather-strip">${[['temp',num(s.temp)+'°C','Forecast · Temperature'],['wind',num(s.wind)+' km/h','Wind speed'],['cloud',Number.isFinite(s.cloud)?num(s.cloud)+'%':'—','Cloud cover'],['drop',Number.isFinite(s.humidity)?num(s.humidity)+'%':'—','Humidity']].map(([ic,v,l])=>`<div class="weather-item">${icon(ic)}<span><small>${l}</small><strong>${v}</strong></span></div>`).join('')}${liveBadge()}</div>`;
}

function metricCards() {
  const s=current(), renewable=s.solar+s.windPower;
  const metrics=[
    {key:'load',label:'Current load',value:s.load,unit:'kW',note:dataLabel()+' · Latest recorded load',values:[.93,.96,.92,.98,.95,1.02,.97,1].map(v=>Math.round(v*s.load))},
    {key:'renewable',label:'Forecast renewables',value:renewable,unit:'kW',note:'First forecast hour · available power',values:[.76,.81,.78,.90,.84,.94,.92,1].map(v=>Math.round(v*renewable))},
    {key:'battery',label:'Battery charge',value:s.battery,unit:'%',note:'Reserve available',icon:null,values:[6,5,4,5,3,2,1,0].map(v=>Math.min(100,s.battery+v))},
    {key:'fuel',label:'Fuel remaining',value:s.fuel,unit:'L',note:'Snapshot · protected reserve '+num(backend.data?.rawOverview.station.fuel_reserve_l)+' L',icon:null,values:[1,.86,.73,.57,.44,.28,.14,0].map(v=>Math.round(s.fuel+v*s.burn))}
  ];
  return `<div class="metric-grid">${metrics.map((m,i)=>{m.values=metricHistory(m.key);const delta=m.values.length>1&&m.values[0]!==0?(m.values.at(-1)-m.values[0])/m.values[0]*100:NaN;return `<article class="metric-card metric-${m.key}"><div class="metric-top"><span>${m.label}</span>${m.icon?`<div class="metric-icon">${icon(m.icon)}</div>`:''}</div><div class="metric-reading"><div class="metric-value">${num(m.value)}<span>${m.unit}</span></div>${trendChart(m.values,i,m.label)}</div><div class="metric-bottom"><span class="metric-description">${m.note}</span><span class="trend-change ${delta>=0?'rising':'falling'}" title="Change across available data points">${Number.isFinite(delta)?(delta>=0?'↑':'↓')+' '+num(Math.abs(delta))+'%':'—'}</span></div></article>`;}).join('')}</div>`;
}
function trendChart(values,id,label) {
  if(values.length<2)return '<svg class="metric-trend" viewBox="0 0 120 48" role="img" aria-label="Not enough recorded samples for a trend"><text x="60" y="28" text-anchor="middle" fill="#7790a9" font-size="11">No trend data</text></svg>';
  const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const points=values.map((v,i)=>[4+i*112/(values.length-1),39-(v-min)/range*32]);
  const path=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const up=values.at(-1)>=values[0],color=up?'#149472':'#d16b37',last=points.at(-1);
  return `<svg class="metric-trend" viewBox="0 0 120 48" role="img" aria-label="${label}: ${up?'increasing':'decreasing'} across recorded samples"><defs><linearGradient id="trend-${id}" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs><path d="${path}L116,46H4Z" fill="url(#trend-${id})"/><path d="${path}" stroke="${color}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3.4" fill="${color}" stroke="white" stroke-width="1.5"/></svg>`;
}

const panelHeader = (title,subtitle,right='') => `<div class="panel-heading"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${right}</div>`;
function series() {
  return state.scenarioSeries || backend.data?.loadForecast?.forecast_values.map(v=>v.predicted_value) || [];
}

function chart(large=false) {
  const values=series(); const renewable=current().solar+current().windPower; const W=700,H=230,left=40,right=680,top=24,bottom=184,max=Math.max(50,Math.ceil(Math.max(0,...values)/50)*50);
  const points=values.map((v,i)=>[left+i*(right-left)/Math.max(1,values.length-1),bottom-v/max*(bottom-top)]);
  const planned=new Map();
  (backend.data?.optimization?.results || []).forEach(r=>planned.set(r.time_slot,(planned.get(r.time_slot)||0)+r.generation_kw));
  const opt=state.scenario==='normal'?(backend.data?.loadForecast?.forecast_values || []).flatMap((v,i)=>planned.has(v.forecast_time)?[[left+i*(right-left)/Math.max(1,values.length-1),bottom-planned.get(v.forecast_time)/max*(bottom-top)]]:[]):[];
  const path=arr=>arr.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const forecastValues=backend.data?.loadForecast?.forecast_values || [];
  const labels=Array.from({length:7},(_,i)=>{const v=forecastValues[Math.round(i*(forecastValues.length-1)/6)];return v?recordDate(v.forecast_time).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'}):'—';});
  return `<div class="chart-legend"><span><i class="legend-line demand"></i>Forecast demand</span><span><i class="legend-line optimised"></i>Planned supply</span><span class="chart-unit">kW · ${backend.data?.loadForecast?.horizon_hours || '—'}-hour outlook</span></div><svg class="forecast-chart ${large?'large':''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Backend load forecast. Peak demand ${num(Math.max(...values))} kilowatts."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#9852c8" stop-opacity=".17"/><stop offset="1" stop-color="#9852c8" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3,4].map(i=>{const y=bottom-i*(bottom-top)/4;return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#e8eef5" stroke-dasharray="4 4"/><text x="${left-10}" y="${y+4}" text-anchor="end">${Math.round(max*i/4)}</text>`;}).join('')}<path d="${path(points)} L${right},${bottom} L${left},${bottom}Z" fill="url(#chart-fill)"/><path d="${path(points)}" fill="none" stroke="#8b43b5" stroke-width="3" stroke-linejoin="round"/><path d="${path(opt)}" fill="none" stroke="#de862e" stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="#8b43b5" stroke-width="2"><title>${forecastValues[i]?recordDate(forecastValues[i].forecast_time).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC':'Forecast interval'}: ${num(values[i])} kW</title></circle>`).join('')}${labels.map((l,i)=>`<text x="${left+i*(right-left)/6}" y="214" text-anchor="middle">${l}</text>`).join('')}</svg><div class="chart-foot"><span>${icon('spark')} ${backend.data?.loadForecast?escapeHtml(backend.data.loadForecast.model_name)+' · FORECAST':'Forecast unavailable'}</span><span>Forecast renewables <strong>${num(renewable)} kW</strong></span></div>`;
}
const periodToggle=()=>`<div class="segmented" aria-label="Forecast period"><button class="${state.period==='24h'?'active':''}" data-period="24h" aria-pressed="${state.period==='24h'}">24h</button><button class="${state.period==='7d'?'active':''}" data-period="7d" aria-pressed="${state.period==='7d'}">7 days</button></div>`;
function flow() {
  const s=current(), supply=s.diesel,shared=state.station==='himadri';
  return `<div class="flow-canvas"><svg class="flow-lines" viewBox="0 0 500 234" preserveAspectRatio="none" aria-hidden="true"><path class="flow-solar" d="M100 40H190Q210 40 210 65V117H250"/><path class="flow-wind" d="M100 117H250"/><path class="flow-diesel" d="M100 194H190Q210 194 210 169V117H250"/><path class="flow-load" d="M300 117H368Q380 117 380 95V65H422"/><path class="flow-battery" d="M300 117H368Q380 117 380 140V175H422"/></svg><div class="flow-sources"><div class="flow-node solar-node">${icon('sun')}<span>Solar<strong>${num(s.solar)} <small>kW</small></strong></span></div><div class="flow-node wind-node">${icon('wind')}<span>Wind<strong>${num(s.windPower)} <small>kW</small></strong></span></div><div class="flow-node diesel">${icon(shared?'grid':'generator')}<span>${shared?'Shared supply':'Diesel / CHP'}<strong>${num(supply)} <small>kW</small></strong></span></div></div><div class="flow-center"><img src="assets/dhruvurja-logo.png" width="39" height="39" alt=""><strong>Energy bus</strong><small>${num(s.solar+s.windPower+s.diesel)} kW</small></div><div class="flow-destinations"><div class="flow-node load-node">${icon('mountain')}<span>Station load<strong>${num(backend.data?.plan.optimized.hours[0].load_kw)} <small>kW</small></strong></span></div><div class="flow-node battery-node">${icon('battery')}<span>Battery<strong>${num(s.charge)} <small>kW</small></strong><em>${s.charge>0?'Charging':s.charge<0?'Discharging':'Idle'} · ${num(s.battery)}%</em></span></div></div></div><div class="flow-foot"><span><i></i> Planned supply</span><span>${dataLabel()}</span></div>`;
}

function fuelPanel() {
 const s=current(),p=backend.data?.plan, reserve=p?.optimized.fuel_reserve_l;
 return `<article class="panel fuel-panel">${panelHeader('Fuel reserve','24-hour plan',`<span class="icon-tile amber">${icon('fuel')}</span>`)}<div class="endurance-value">${num(p?.optimized.fuel_remaining_l)}<span>litres after plan</span></div><div class="fuel-meter"><i style="width:${s.fuel>0?Math.min(100,p.optimized.fuel_remaining_l/s.fuel*100):0}%"></i><span style="left:${s.fuel>0?Math.min(100,reserve/s.fuel*100):0}%"></span></div><div class="meter-labels"><span>0 L</span><span>${num(reserve)} L reserve</span><span>${num(s.fuel)} L</span></div><div class="fuel-facts"><div><span>Planned 24-hour use</span><strong>${num(s.burn)} L</strong></div><div><span>Fuel in storage</span><strong>${num(s.fuel)} L</strong></div></div><a href="#fuel" class="panel-link">View fuel & logistics ${icon('arrow')}</a></article>`;
}

function renewablePanel() {
  const s=current();
  return `<div class="renewable-pair">${[['sun','Solar',s.solar,'Next 24 hours · forecast availability',[22,32,46,57,66,79,91,84,72,56,39,27]],['wind','Wind',s.windPower,s.wind+' km/h wind speed',[56,72,44,65,84,68,94,75,65,86,68,78]]].map(([ic,title,value,note,bars])=>{const history=metricHistory(ic==='sun'?'solar':'wind');const peak=Math.max(1,...history);bars=history.map(v=>v/peak*100);return `<article class="panel renewable-single ${ic==='sun'?'solar-panel':'wind-panel'}">${panelHeader(title,'Forecast availability',icon(ic))}<div class="renewable-reading"><strong>${num(value)}</strong><span>kW</span>${badge(value>0?'Forecast':Number.isFinite(value)?'No output':'Unavailable')}</div><div class="mini-bars ${ic==='wind'?'wind-bars':''}">${bars.map(h=>`<i style="height:${h}%"></i>`).join('')}</div><p>${note}</p></article>`;}).join('')}</div>`;
}

const recommendations=()=>{
 const p=backend.data?.plan;
 const selected=[];
 for(const r of p?.recommendations || []){if(selected.length>=6)break;if(!selected.some(x=>x.code===r.code&&x.title===r.title))selected.push(r);}
 if(!selected.length)return [{id:'pending',title:backend.error?'Recommendation unavailable':'Preparing the energy plan',desc:backend.error || 'Reading station forecasts and calculating the supply combination.',saving:null,tag:'Station planning',reason:'A current successful backend calculation is required.',action:'Review',time:'Awaiting data'}];
 return selected.map(r=>({id:r.id,title:r.title,desc:r.message,saving:null,tag:r.code==='charge_renewable'?'Battery charging':r.code==='diesel_backup'?'Backup planning':'Renewable planning',reason:'Based on forecast weather, demand, battery limits and the calculated dispatch. Weather is provider data; energy inputs are labelled demonstration values.',action:'Add to my plan',time:recordDate(r.starts_at).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' UTC'}));
};
function recommendationPanel() {
  const r=recommendations()[0];
  return `<article class="panel ai-panel"><div class="ai-heading"><span>${icon('spark')} AI RECOMMENDATION</span><span class="ai-tag">DHRUVURJA AI</span></div><h2>${escapeHtml(r.title)}</h2><p>${escapeHtml(r.desc)}</p><div class="ai-recommendation-bottom"><div class="ai-savings"><strong>${r.saving==null?'Hourly plan':'~'+num(r.saving)+' L'}</strong><span>Weather-aware guidance<small>Demo energy inputs</small></span></div><a href="#insights" class="button ai-button">View recommendation ${icon('arrow')}</a></div></article>`;
}

const generatorRecords={
  bharati:{count:3,prefix:'CHP',title:'3 CHP generators',detail:'100 kVA each · Jet A-1',year:'NCPOR · 2022',url:'https://ncpor.res.in/upload/tenders/OMRC_Tender_Document_20220113%20%281%29.PDF',note:'Published inventory: 3 combined heat and power units. Operating states below are simulated.'},
  maitri:{count:6,prefix:'DG',title:'6 generators documented',detail:'Historical station inventory',year:'Inspection · 2013',url:'https://documents.ats.aq/ATCM36/att/ATCM36_att145_e.pdf',note:'Six generators recorded in the 2013 inspection. Current installed count is unconfirmed; operating states below are simulated.'},
  himadri:{count:null,title:'Shared power supply',year:'Kings Bay · 2024–2027',url:'https://kingsbay.no/wp-content/uploads/2024/04/Kings-Bay-strategi-2024-2027_vedtatt-29.02.2023_EN.pdf',note:'Kings Bay provides power for the Ny-Ålesund research community. A dedicated Himadri generator count is not verified.'}
};
function generators() {
  const s=current(),sources=backend.data?.overview.energy_sources.filter(source=>source.source_type==='diesel') || [];
  const g={count:sources.length,prefix:'DG',title:'Equivalent generator model',detail:'Backend configuration',note:'Demonstration hardware configuration · first-hour planned output.'};
  const total=s.diesel,perUnit=NaN;
  return `<article class="panel generator-panel">${panelHeader(state.station==='himadri'?'Station power supply':'Diesel / CHP generator status',g.title,`<span class="badge blue">${g.count?g.count+' units':'Shared'}</span>`)}<p class="generator-source-note">${g.note}</p>${g.count?`<div class="generator-grid">${Array.from({length:g.count},(_,i)=>{const source=sources[i],reading=backend.data.overview.latest_energy_readings.find(r=>r.source_id===source.id),running=reading?.generation_kw>0,service=false,status=reading?(running?'Planned on':'Planned off'):'No reading',color=running?'green':'blue';return `<div class="generator-item"><div class="generator-asset">${icon('generator')}<div><strong>${escapeHtml(source.name)}</strong><span>${num(source.capacity_kw)} kW · ${escapeHtml(source.status)}</span></div></div>${badge(status,color)}<span class="generator-detail">${num(reading?.generation_kw)} kW</span></div>`;}).join('')}</div>`:`<div class="shared-supply"><span>${icon('grid')}</span><div><strong>No generator records</strong><p>Dedicated inventory unavailable</p><small>No operating reading available</small></div></div>`}</article>`;
}

function overview() {
  return `<section class="dashboard-first-screen" aria-label="Station overview">${weatherStrip()}${metricCards()}<div class="primary-panels"><article class="panel">${panelHeader('Load forecast','Forecast demand & planned supply',periodToggle())}${chart()}</article><article class="panel">${panelHeader('Planned energy flow','First forecast hour · available generation')}${flow()}</article></div></section><section id="station-details" class="sketch-lower" aria-label="Fuel and operational insights"><div class="lower-left">${fuelPanel()}${generators()}</div><div class="lower-right">${renewablePanel()}${recommendationPanel()}</div></section>`;
}

function forecastPage() {
  const values=series();
  return `<div class="info-banner">${icon('info')} Stored backend forecasts and dispatch scenarios. Source: ${escapeHtml(backend.data?.loadForecast?.model_name || 'unavailable')}.</div><div class="forecast-toolbar"><div class="scenario-control"><label for="scenario">Operating scenario</label><select id="scenario"><option value="normal" ${state.scenario==='normal'?'selected':''}>Normal conditions</option><option value="storm" ${state.scenario==='storm'?'selected':''}>Storm · Higher heating demand</option><option value="low" ${state.scenario==='low'?'selected':''}>Low renewable availability</option></select></div><button class="button secondary" data-action="export">${icon('download')} Export forecast</button></div><article class="panel forecast-full">${panelHeader('Station demand outlook','Forecast and planned supply',periodToggle())}${chart(true)}</article><div class="forecast-summary"><article class="panel"><span>Peak forecast demand</span><strong>${num(Math.max(...values))} <small>kW</small></strong><p>Size dispatch around the peak window.</p></article><article class="panel"><span>Average forecast demand</span><strong>${num(values.reduce((a,b)=>a+b,0)/values.length)} <small>kW</small></strong><p>Across the selected forecast period.</p></article><article class="panel"><span>Operating scenario</span><strong class="scenario-title">${{normal:'Normal',storm:'Storm',low:'Low renewables'}[state.scenario]}</strong><p>${state.scenario==='normal'?'Baseline demand profile.':state.scenario==='storm'?'Backend dispatch with higher demand.':'Backend dispatch with reduced renewables.'}</p></article></div>`;
}
function fuelPage() {
  const s=current(); const endurance=s.days;
  return `${resupplyPanel(state.session.stationId)}<div class="info-banner">${icon('info')} Fuel inventory is demonstration data. Resupply dates are operator planning inputs; no shipment is automatically confirmed.</div><div class="fuel-page-grid">${fuelPanel()}<article class="panel logistics-panel">${panelHeader('Resupply planning','Logistics timeline',badge(escapeHtml(backend.data?.survival?.risk_level || 'Unavailable')))}<div class="timeline"><div><i></i><span class="eyebrow">${latestDate()?.toLocaleDateString('en-GB',{timeZone:'UTC'}) || '—'} · LATEST RECORD</span><h3>${num(s.fuel)} litres available</h3><p>Planned 24-hour use: ${num(s.burn)} L. Longer-term endurance is not calculated.</p></div><div><i></i><span class="eyebrow" data-resupply-date>${resupplyState(state.session.stationId)?.settings?'EXPECTED · '+resupplyState(state.session.stationId).settings.expected_arrival_date:'RESUPPLY DATE NOT ENTERED'}</span><h3>Review resupply readiness</h3><p>Confirm transport availability, weather window, and receiving capacity.</p></div><div><i></i><span class="eyebrow">CONFIGURED RESERVE THRESHOLD</span><h3>${num(backend.data?.rawOverview.station.fuel_reserve_l)} L protected reserve</h3><p>The optimizer protects this fuel quantity. No delivery date is assumed.</p></div></div></article></div>${generators()}<article class="panel storage-panel">${panelHeader('Storage inventory','Recorded fuel inventory',`<button class="text-link" data-action="export-fuel">${icon('download')} Export inventory</button>`)}<div class="table-scroll"><table><thead><tr><th>Fuel type</th><th>Available fuel</th><th>Share of inventory</th><th>Status</th></tr></thead><tbody>${(backend.data?.overview.fuel_status || []).map((record,i)=>{const v=s.fuel>0?record.level_litres/s.fuel:0;return `<tr><td><strong>${escapeHtml(record.fuel_type)}</strong><small>${escapeHtml(record.data_type || 'Unspecified')}</small></td><td>${num(record.level_litres)} L</td><td><div class="table-meter"><i style="width:${v*100}%"></i></div>${v*100}%</td><td>${badge(escapeHtml(record.generator_status),'blue')}</td></tr>`;}).join('')}</tbody></table></div></article>`;
}
function insightsPage() {
  return `<div class="insight-intro"><div class="insight-emblem">${icon('spark')}</div><div><span class="eyebrow">AI COPILOT</span><h2>Optimise station energy use</h2><p>Explore recommendations and choose actions for your plan.</p></div><div class="insight-counter" role="status"><span>Your plan</span><div><strong>${state.saved.length}</strong><span>${state.saved.length===1?'action selected':'actions selected'}</span></div></div></div><div class="recommendations">${recommendations().map(r=>`<article class="panel recommendation"><div class="recommendation-top"><span class="badge blue">${r.tag}</span><span>${icon('clock')}${r.time}</span></div><h2>${escapeHtml(r.title)}</h2><p>${escapeHtml(r.desc)}</p><div class="reason"><strong>${icon('spark')} Why this recommendation?</strong><p>${escapeHtml(r.reason)}</p></div><div class="recommendation-bottom"><div>${r.saving?`<strong>~${num(r.saving)} L</strong><span>Estimated saving / forecast</span>`:`<strong>Hourly guidance</strong><span>Based on the dispatch plan</span>`}</div><button class="button ${state.saved.includes(r.id)?'secondary':'primary'}" data-save="${r.id}" ${state.saved.includes(r.id)?'disabled':''}>${icon(state.saved.includes(r.id)?'check':'arrow')}${state.saved.includes(r.id)?'Added to plan':r.action}</button></div></article>`).join('')}</div><div class="info-banner">${icon('info')} Recommendations use live provider weather and calculated dispatch. Your selected plan is local to this session; adding an action does not control equipment.</div>`;
}
function getAlerts() {
  return [...(backend.data?.alerts || []),...resupplyAlerts(state.session?.stationId)].map(a=>({id:String(a.id),severity:['warning','critical'].includes(a.severity)?'warning':'info',icon:(a.alert_type||a.code||'').includes('fuel')?'fuel':'bell',title:escapeHtml((a.alert_type||a.code||'resupply risk').replaceAll('_',' ')),desc:escapeHtml(a.message),time:recordDate(a.created_at||a.generated_at).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC',tag:escapeHtml(a.severity)}));
}

function alertsPage() {
  const alerts=getAlerts().filter(a=>state.alertFilter==='acknowledged'?state.dismissed.includes(a.id):!state.dismissed.includes(a.id)&&(state.alertFilter!=='warning'||a.severity==='warning'));
  return `<div class="alerts-toolbar"><div class="segmented">${[['all','Active'],['warning','Warnings'],['acknowledged','Acknowledged']].map(([id,l])=>`<button data-filter="${id}" class="${state.alertFilter===id?'active':''}" aria-pressed="${state.alertFilter===id}">${l}</button>`).join('')}</div><span>${alerts.length} ${alerts.length===1?'event':'events'} · Backend alerts</span></div><div class="alert-list">${alerts.length?alerts.map(a=>`<article class="panel alert-item ${a.severity}"><span class="alert-symbol">${icon(a.icon)}</span><div class="alert-content"><div><span class="badge ${a.severity==='warning'?'red':'blue'}">${a.tag}</span><small>${a.time}</small></div><h2>${a.title}</h2><p>${a.desc}</p></div>${state.dismissed.includes(a.id)?`<span class="acknowledged">${icon('check')} Acknowledged</span>`:`<button class="button secondary small" data-ack="${a.id}">Acknowledge</button>`}</article>`).join(''):`<div class="panel empty-state">${icon('check')}<h2>${state.alertFilter==='acknowledged'?'No acknowledged alerts yet':'You’re all caught up'}</h2><p>${state.alertFilter==='acknowledged'?'Acknowledged events will appear here.':'No active events in this view.'}</p></div>`}</div>`;
}

function notify(message) { const toast=$('#toast'); toast.textContent=message; toast.classList.add('visible'); clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.classList.remove('visible'),4000); }
function route() { return location.hash.slice(1).split('?')[0] || 'home'; }
// Station clock configuration: Bharati (IST), Maitri (UTC+03:00).
// https://en.wikipedia.org/wiki/Research_stations_in_Antarctica
// https://dateandtime.info/city.php?id=6620766
const stationTimeZones={bharati:'Asia/Kolkata',maitri:'Etc/GMT-3',himadri:'Europe/Oslo'};
function updateStationClock(){
  const clock=document.querySelector('.dashboard-date');if(!clock)return;
  const now=new Date(),timeZone=stationTimeZones[state.station]||'UTC';
  const options={timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'};
  const offset=new Intl.DateTimeFormat('en-GB',{timeZone,timeZoneName:'longOffset'}).formatToParts(now).find(p=>p.type==='timeZoneName').value.replace('GMT','UTC');
  clock.querySelector('strong').textContent=now.toLocaleDateString('en-GB',{timeZone,day:'2-digit',month:'short',year:'numeric'});
  clock.querySelector('small').textContent=now.toLocaleTimeString('en-GB',options)+' · '+offset;
  clock.title=current().name+' station local time';
}
setInterval(updateStationClock,1000);
document.addEventListener('visibilitychange',updateStationClock);
async function loadLoginWeather(station){
  const panel=document.querySelector('.login-weather');if(!panel)return;
  panel.setAttribute('aria-busy','true');panel.title='Loading station weather…';
  panel.querySelectorAll('strong').forEach(el=>el.textContent='…');
  try{
    const response=await fetch('/api/public/weather/'+encodeURIComponent(station),{signal:AbortSignal.timeout(35000)});
    const data=await response.json();if(!response.ok)throw Error(data.detail||'Weather unavailable');
    if(!panel.isConnected||state.station!==station)return;
    const values=[[data.temperature_c,'°C'],[data.wind_speed_kmh,' km/h'],[data.cloud_cover_percent,'%']];
    panel.querySelectorAll('strong').forEach((el,i)=>{const [value,unit]=values[i];el.textContent=Number.isFinite(value)?Number(value.toFixed(1))+unit:'—';});
    panel.title='Open-Meteo · Current-hour forecast · Retrieved '+new Date(data.retrieved_at).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC';
  }catch(error){
    if(panel.isConnected&&state.station===station){panel.querySelectorAll('strong').forEach(el=>el.textContent='—');panel.title=error.message;}
  }finally{if(panel.isConnected)panel.setAttribute('aria-busy','false');}
}
function sizePublicBackground(){
  const video=document.querySelector('.public-background-video'),main=document.querySelector('#main');
  if(!video||!main)return;
  const rect=main.getBoundingClientRect();
  Object.assign(video.style,{top:(rect.top+scrollY)+'px',left:(rect.left+scrollX)+'px',width:rect.width+'px',height:rect.height+'px'});
}
const publicBackgroundObserver=new ResizeObserver(sizePublicBackground);
window.addEventListener('resize',sizePublicBackground);
function render({preserveScroll=false}={}) {
  if(!preserveScroll){clearTimeout(notify.timer);$('#toast').classList.remove('visible');}
  const oldY=window.scrollY; let page=route();
  if (!['home','login',...navItems.map(n=>n[0])].includes(page)) {location.hash='home';return;}
  if (page!=='home'&&page!=='login'&&!state.session) {location.replace('#login');return;}
  document.body.className=page==='home'?'home-body':page==='login'?'login-body':'dashboard-body';
  document.body.dataset.theme=state.theme;
  stationGlobe?.dispose();stationGlobe=null;
  $('#app').innerHTML=page==='home'?landing():page==='login'?login():workspace(page);
  publicBackgroundObserver.disconnect();
  const incoming=document.querySelector('#app .landing-background-video');
  let background=document.querySelector('.public-background-video');
  if(incoming){
    if(background)incoming.remove();
    else{background=incoming;background.classList.add('public-background-video');document.body.prepend(background);}
    sizePublicBackground();publicBackgroundObserver.observe($('#main'));
    background.play().catch(()=>{});
  }else background?.remove();
  if(page!=='home' && page!=='login') syncBackendUI();
  if(page==='login'){
    document.querySelectorAll('.login-weather strong').forEach(el=>el.textContent='—'); $('#operator').value='demo_operator'; $('#password').value='polar-demo-password'; $('#password').minLength=8;
    $('.secure-heading p').textContent='Local demo account · '+current().name; $('#role').innerHTML='<option>Station Operator</option>'; $('#role').title='Local preview operator account';
    $('#login-form').insertAdjacentHTML('beforeend','<p id="login-error" role="alert"></p>');
    void loadLoginWeather(state.station);
  }
  if(page==='home' && document.querySelector('.station-globe'))stationGlobe=createStationGlobe(document.querySelector('.station-globe'),state.station);
  document.title=`${page==='home'?'Polar Energy Intelligence':page==='login'?current().name+' · Login':navItems.find(n=>n[0]===page)?.[2]} | DhruvUrja`;
  if(preserveScroll)window.scrollTo(0,oldY);else window.scrollTo(0,0);
}
async function refreshBackend(){
  const stationId=state.session?.stationId;
  if(!stationId)return;
  try{
    const [data]=await Promise.all([loadBackend(stationId),loadResupply(stationId)]);
    if(!data || state.session?.stationId!==stationId)return;
    state.dismissed=state.dismissed.filter(id=>[...data.alerts,...resupplyAlerts(stationId)].some(a=>String(a.id)===id));
    if(!['home','login'].includes(route()))render({preserveScroll:true});
  }catch(error){
    if(state.session?.stationId!==stationId)return;
    if(!['home','login'].includes(route())){render({preserveScroll:true});notify(error.message);}
  }
}
function syncBackendUI(){
  if(route()==='fuel')void mountResupply(state.session.stationId);
  updateStationClock();
  $('.sidebar-station small').textContent=current().region+' · '+dataLabel();
  $('.dashboard-main').setAttribute('aria-busy',String(backend.loading));
  document.querySelectorAll('.live-demo').forEach(el=>{el.title=backend.error || 'Backend records · Click to refresh';el.setAttribute('role','button');el.tabIndex=0;el.onclick=refreshBackend;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();refreshBackend();}};});
  document.querySelectorAll('[data-period="7d"]').forEach(button=>{button.title=(backend.data?.loadForecast?.horizon_hours || 0)<168?'A 7-day backend forecast is not available':'7-day forecast';});
  document.querySelectorAll('[data-ack]').forEach(button=>{button.disabled=!['admin','energy_manager','station_operator'].includes(state.session?.role);});
  const walker=document.createTreeWalker($('.dashboard-main'),NodeFilter.SHOW_TEXT);
  while(walker.nextNode())if(/NaN|Infinity/.test(walker.currentNode.textContent))walker.currentNode.textContent=walker.currentNode.textContent.replace(/-?Infinity|NaN/g,'—');
  if(!backend.data&&!backend.loading&&!backend.error)void refreshBackend();
}
function resetStation(id) {
  if (!stations[id]) return;
  if(state.session && state.session.station!==id){state.session=null;clearAuth();sessionStorage.removeItem('dhruv-session');}
  state.station=id; state.saved=[]; state.dismissed=[]; state.scenario='normal'; state.scenarioSeries=null;
  resetSimulator();
  resetBackend();
  if(state.session) {state.session.station=id;try{sessionStorage.setItem('dhruv-session',JSON.stringify(state.session));}catch{}}
}
function downloadCsv(filename,rows) {
  const csv=rows.map(row=>row.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('Backend records exported.');
}
document.addEventListener('click', async e=>{
  const target=e.target.closest('button,a');if(!target)return;
  if(target.dataset.theme){
    state.theme=target.dataset.theme==='night'?'night':'day';
    document.body.dataset.theme=state.theme;
    try{localStorage.setItem('dhruv-theme',state.theme);}catch{}
    document.querySelectorAll('[data-theme]').forEach(button=>{
      if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.theme===state.theme));
    });
    const video=document.querySelector('.landing-background-video');
    const source=video?.querySelector('source');
    const path=state.theme==='night'?'assets/night-background.mp4':'assets/background.mp4';
    if(source && source.getAttribute('src')!==path){
      source.setAttribute('src',path);video.load();video.play().catch(()=>{});
    }
  }
  if(target.dataset.action==='scroll-details'){document.getElementById('station-details')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  if(target.dataset.station){resetStation(target.dataset.station);location.hash='login';}
  if(target.dataset.scroll){e.preventDefault();const id=target.dataset.scroll;if(route()!=='home'){location.hash='home';setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'}),50);}else document.getElementById(id)?.scrollIntoView({behavior:'smooth'});}
  if(target.id==='toggle-password'){const p=$('#password');p.type=p.type==='password'?'text':'password';target.setAttribute('aria-pressed',String(p.type==='text'));target.setAttribute('aria-label',p.type==='text'?'Hide password':'Show password');}
  if(target.dataset.period){if(target.dataset.period==='7d'&&(backend.data?.loadForecast?.horizon_hours || 0)<168){notify('The backend currently provides a '+(backend.data?.loadForecast?.horizon_hours || 0)+'-hour forecast.');return;}state.period=target.dataset.period;render({preserveScroll:true});}
  if(target.dataset.filter){state.alertFilter=target.dataset.filter;render({preserveScroll:true});}
  if(target.dataset.save&&target.dataset.save!=='pending'&&!state.saved.includes(target.dataset.save)){state.saved.push(target.dataset.save);render({preserveScroll:true});notify('Added to your session plan. No equipment settings changed.');}
  if(target.dataset.ack&&!state.dismissed.includes(target.dataset.ack)){state.dismissed.push(target.dataset.ack);render({preserveScroll:true});notify('Acknowledged for this session. The underlying condition is unchanged.');}
  if(target.dataset.action==='menu'){setMenu(!state.menu);}
  if(target.dataset.action==='logout'){await api('/auth/logout',{method:'POST'}).catch(()=>{});state.session=null;state.menu=false;try{sessionStorage.removeItem('dhruv-session');}catch{}location.hash='home';notify('You have left the workspace.');}
  if(target.dataset.action==='export'){if(!backend.data?.loadForecast){notify('No forecast available.');return;}downloadCsv(`${state.station}-forecast.csv`,[['Station','Data type','Scenario','Timestamp UTC','Demand kW'],...series().map((v,i)=>[current().name,state.scenario==='normal'?'FORECAST':'SIMULATED',state.scenario,backend.data.loadForecast.forecast_values[i]?.forecast_time,v])]);}
  if(target.dataset.action==='export-fuel'){if(!backend.data){notify('No fuel records available.');return;}downloadCsv(`${state.station}-fuel.csv`,[['Station','Data type','Fuel type','Fuel litres','Consumption in record L','Timestamp UTC'],...backend.data.overview.fuel_status.map(r=>[current().name,r.data_type,r.fuel_type,r.level_litres,r.consumption_litres,r.timestamp])]);}
});
document.addEventListener('change', async e=>{
  if(e.target.name==='landing-station'){
    resetStation(e.target.value);
    document.querySelectorAll('input[name="landing-station"]').forEach(input=>{
      input.checked=input.value===state.station;
      input.closest('.station-radio').classList.toggle('selected',input.checked);
    });
    document.querySelectorAll('.station-card').forEach(card=>{
      card.classList.toggle('selected',card.querySelector('[data-station]').dataset.station===state.station);
    });
    document.querySelector('.landing-login-label').textContent=`Login to ${current().name} Station`;
    stationGlobe?.setStation(state.station);
  }
  if(e.target.id==='station'||e.target.id==='workspace-station'){resetStation(e.target.value);render({preserveScroll:true});}
  if(e.target.id==='scenario'){
    const scenario=e.target.value,stationId=state.session?.stationId;
    if(scenario==='normal'){state.scenario='normal';state.scenarioSeries=null;render({preserveScroll:true});return;}
    e.target.disabled=true;
    try{const result=await runBackendScenario({demand:scenario==='storm'?116:100,renewable:scenario==='low'?50:100,hours:24,fuel:''});
      if(state.session?.stationId!==stationId)return;
      state.scenario=scenario;state.scenarioSeries=result.series;render({preserveScroll:true});
    }catch(error){e.target.disabled=false;e.target.value=state.scenario;notify(error.message);}
  }
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='login-form')return;e.preventDefault();
  const form=new FormData(e.target);const operator=String(form.get('operator')).trim();if(!operator){$('#operator').setCustomValidity('Enter a demo operator ID.');$('#operator').reportValidity();return;}
  const button=e.target.querySelector('[type="submit"]');button.disabled=true;
  $('#login-error').textContent='Connecting…';
  try {
    const user=await signIn(operator,String(form.get('password')),state.station);
    const accessible=await api('/stations');
    const matches=accessible.filter(s=>s.name.toLowerCase().includes(state.station));
    const station=matches.find(s=>s.id===state.station) || matches[0];
    if(!station)throw Error(`No accessible ${current().name} station is available in this backend. Select Bharati or Maitri on the home page.`);
    state.session={operator:user.username,role:user.role,station:state.station,stationId:station.id};
    sessionStorage.setItem('dhruv-session',JSON.stringify(state.session));resetBackend();resetSimulator();state.scenario='normal';state.scenarioSeries=null;
    location.hash='dashboard';
  }catch(error){clearAuth();state.session=null;$('#login-error').textContent=error.message;}
  finally{button.disabled=false;}
});
document.addEventListener('input',e=>{if(e.target.id==='operator')e.target.setCustomValidity('');});
function setMenu(open) {
  state.menu=open;
  $('.workspace')?.classList.toggle('menu-open',open);
  $('.mobile-menu')?.setAttribute('aria-expanded',String(open));
  if($('.sidebar')) $('.sidebar').inert=!open;
  if(open) $('.drawer-heading button')?.focus(); else $('.mobile-menu')?.focus();
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&state.menu){setMenu(false);}
  if(e.key==='Tab'&&state.menu){
    const focusable=[...$('.sidebar').querySelectorAll('a,button,select')].filter(el=>!el.disabled);
    const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
window.addEventListener('hashchange',()=>{state.menu=false;render();$('#main')?.setAttribute('tabindex','-1');$('#main')?.focus({preventScroll:true});});
render();

setupSimulator(current, runBackendScenario);
window.addEventListener('auth-expired',()=>{state.session=null;sessionStorage.removeItem('dhruv-session');resetBackend();resetSimulator();location.hash='login';});
document.addEventListener('click',e=>{if(e.target.closest('[data-action="logout"]')){clearAuth();resetBackend();resetSimulator();}});
document.addEventListener('resupply-updated',e=>{
 if(state.session?.stationId!==e.detail.stationId)return;
 const count=activeAlerts().length,button=document.querySelector('.notification-button');
 if(button){button.classList.toggle('has-alerts',count>0);button.querySelector('i')?.remove();if(count)button.insertAdjacentHTML('beforeend','<i aria-label="'+count+' active alerts"></i>');}
 const counter=document.querySelector('.sidebar-link .count');if(counter)counter.textContent=count;
});
