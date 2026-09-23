import {simulatorBaseline} from './backend-data.js';
const drafts = new Map();
let baselineTicket=0,baselineTimer;
const amount=v=>Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:1}):'—';
async function updateAmounts(){
 const section=document.querySelector('.simulator');if(!section)return;
 const key=section.dataset.simStation,d=drafts.get(key),ticket=++baselineTicket;
 const base=document.getElementById('sim-baseline'),demand=document.getElementById('sim-demand-amount'),renewable=document.getElementById('sim-renewable-amount');
 demand.textContent='Loading forecast amount…';renewable.textContent='Loading forecast amount…';
 try{
  const b=await simulatorBaseline(d.hours);
  if(ticket!==baselineTicket||!section.isConnected||d.hours!==b.hours)return;
  const total=b.solar+b.wind;
  demand.textContent=amount(b.load*d.demand/100)+' kW average demand';
  renewable.textContent=amount(total*d.renewable/100)+' kW average available';
  document.getElementById('sim-demand-help').textContent='100% = '+amount(b.load)+' kW average';
  document.getElementById('sim-renewable-help').textContent=d.renewable>100?'Above forecast · hypothetical increase':'';
  base.textContent='100%: Solar '+amount(b.solar)+' kW · Wind '+amount(b.wind)+' kW';
  document.getElementById('sim-demand').setAttribute('aria-valuetext',amount(b.load*d.demand/100)+' kilowatts average, '+d.demand+' percent of forecast');
  document.getElementById('sim-renewable').setAttribute('aria-valuetext',amount(total*d.renewable/100)+' kilowatts average available, '+d.renewable+' percent of forecast');
 }catch(error){if(ticket===baselineTicket&&section.isConnected){demand.textContent='Amount unavailable';renewable.textContent='Amount unavailable';base.textContent=error.message;document.getElementById('sim-demand-help').textContent='A current forecast is required to convert percentages to kW.';document.getElementById('sim-renewable-help').textContent='A current forecast is required to convert percentages to kW.';}}
}
const escapeText = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function resetSimulator(){drafts.clear();baselineTicket++;clearTimeout(baselineTimer);}
const defaults = () => ({demand:100, renewable:100, hours:24, fuel:'', result:null});
const flask = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 3h6m-5 0v7L4 20q0 1 2 1h12q2 0 2-1l-6-10V3M7 16h10"/></svg>';
export function calculateScenario(station, inputs) {
  const {demand, renewable, hours}=inputs;
  const fuel=inputs.fuel===''?station.fuel:Number(inputs.fuel);
  if(![demand,renewable,hours,fuel].every(Number.isFinite)||demand<50||demand>200||renewable<0||renewable>200||hours<6||hours>72||fuel<0)throw Error('Enter a valid, non-negative fuel level and values within the slider ranges.');
  const load=station.load*demand/100;
  const clean=Math.min(load,(station.solar+station.windPower)*renewable/100);
  const residual=Math.max(0,load-clean);
  const baseline=Math.max(1,station.load-station.solar-station.windPower);
  const hourly=station.burn/24*residual/baseline;
  const needed=hourly*hours, remaining=Math.max(0,fuel-needed);
  return {load,clean,residual,needed,remaining,shortfall:Math.max(0,needed-fuel),coverage:hourly?fuel/hourly:null,hours};
}
function resultView(r) {
  if(!r)return `<div class="sim-empty"><div class="sim-orbit">${flask}</div><h3>Configure and run a scenario</h3><p>Adjust operating conditions to explore demand, renewable contribution and fuel reserves over your selected horizon.</p></div>`;
  const short=r.backend?!r.feasible:r.shortfall>0;
  return `<div class="sim-results"><div class="sim-verdict ${short?'sim-warning':''}"><span>${r.backend?(short?'UNSERVED DEMAND':'SCENARIO FEASIBLE'):(short?'FUEL SHORTFALL':'FUEL COVERS HORIZON')}</span><h3>${r.backend?(short?'Available resources do not cover demand':'Resources support this scenario'):(short?'Additional fuel is required':'Fuel reserve supports this scenario')}</h3><p>${r.hours}-hour outlook under your selected conditions.${r.reason?' '+escapeText(r.reason):''}</p></div><div class="sim-metrics">${[['Average station demand',r.load,'kW'],['Average renewable power used',r.clean,'kW'],[r.backend?'Average diesel supply':'Backup supply required',r.residual,'kW'],['Estimated fuel required',r.needed,'L'],['Fuel remaining',r.remaining,'L'],r.backend?['Unserved energy',r.unserved,'kWh']:[short?'Fuel shortfall':'Estimated fuel coverage',short?r.shortfall:r.coverage,short?'L':'hours']].map(([label,value,unit])=>`<div><span>${label}</span><strong>${value===null?'No fuel needed':value.toLocaleString('en-IN',{maximumFractionDigits:1})}<small>${value===null?'':unit}</small></strong></div>`).join('')}</div><div class="sim-mix" aria-label="Renewable share ${Math.round(r.load>0?(r.load>0?r.clean/r.load*100:0):0)} percent"><i style="width:${(r.load>0?r.clean/r.load*100:0)}%"></i></div><p class="sim-mix-label">${Math.round(r.load>0?(r.load>0?r.clean/r.load*100:0):0)}% renewable supply / ${Math.round(r.load>0?r.residual/r.load*100:0)}% backup supply</p><p class="sim-assumption">${r.backend?'Backend dispatch estimate using stored forecasts, battery limits, diesel capacity and fuel reserves. Fuel remaining includes protected reserves; this simulation does not control equipment.':'Planning estimate using steady conditions and proportional fuel use.'}</p></div>`;
}
export function simulatorPage(station, key) {
  if(!drafts.has(key))drafts.set(key,defaults());
  const d=drafts.get(key);
  clearTimeout(baselineTimer);baselineTimer=setTimeout(updateAmounts,0);
  const slider=(id,label,min,max,step,unit)=>`<div class="sim-control"><div class="sim-control-heading"><h4><label for="sim-${id}">${label}</label></h4><output id="sim-${id}-value" for="sim-${id}">${d[id]}${unit}</output></div><input id="sim-${id}" name="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${d[id]}" style="--fill:${(d[id]-min)/(max-min)*100}%"><div class="sim-range"><span>${min}${unit}</span><span>${max}${unit}</span></div>${id!=='hours'?`<p id="sim-${id}-amount" class="sim-amount" aria-live="polite">Loading forecast amount…</p><p id="sim-${id}-help" class="sim-amount-help"></p>${id==='renewable'?'<p id="sim-baseline" class="sim-amount-help"></p>':''}`:''}</div>`;
  return `<section class="simulator" data-sim-station="${key}"><div class="sim-heading"><div><h2>What-if Simulator</h2><p>Stress-test the station energy plan before conditions change in the real world.</p></div><button type="submit" form="sim-form" class="button primary sim-run">Run scenario ${flask}</button></div><div class="sim-grid"><form id="sim-form" class="panel sim-inputs"><div class="sim-panel-head"><span>SCENARIO INPUTS</span><h3>Change operating conditions</h3></div><div class="sim-fields">${slider('demand','Station demand',50,200,5,'%')}${slider('renewable','Renewable availability',0,200,5,'%')}${slider('hours','Simulation horizon',6,72,1,'h')}<label class="sim-fuel-label" for="sim-fuel">Override fuel level <span>Optional</span></label><div class="sim-fuel"><input id="sim-fuel" name="fuel" type="number" min="0" step="any" placeholder="${Number.isFinite(station.fuel)?station.fuel:'Unavailable'}" value="${d.fuel}" aria-describedby="sim-fuel-help"><span>L</span></div><p id="sim-fuel-help">Leave blank to use station inventory: ${Number.isFinite(station.fuel)?station.fuel.toLocaleString('en-IN'):'—'} L.</p><div class="sim-presets">${[['storm','Storm event'],['peak','Peak science load'],['conserve','Conservation mode']].map(([id,label])=>`<button type="button" data-sim-preset="${id}">${label}</button>`).join('')}</div></div></form><article class="panel sim-output"><div class="sim-panel-head"><span>SCENARIO OUTPUT</span><h3>Scenario viability</h3></div><div id="sim-result" aria-live="polite">${resultView(d.result)}</div></article></div></section>`;
}
export function setupSimulator(getStation,runScenario) {
  document.addEventListener('input',e=>{
    if(!e.target.closest('#sim-form'))return;
    const el=e.target, key=el.closest('.simulator').dataset.simStation,d=drafts.get(key);
    d[el.name]=el.name==='fuel'?el.value:Number(el.value);d.result=null;
    if(el.type==='range'){document.getElementById(el.id+'-value').textContent=el.value+(el.name==='hours'?'h':'%');el.style.setProperty('--fill',(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100+'%');}
    document.getElementById('sim-result').innerHTML=resultView(null);
    if(el.type==='range'){baselineTicket++;clearTimeout(baselineTimer);baselineTimer=setTimeout(updateAmounts,el.name==='hours'?250:0);}
  });
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-sim-preset]');if(!button)return;
    const values={storm:[130,35,48],peak:[160,100,24],conserve:[75,100,72]}[button.dataset.simPreset];
    ['demand','renewable','hours'].forEach((name,i)=>{const el=document.getElementById('sim-'+name);el.value=values[i];el.dispatchEvent(new Event('input',{bubbles:true}));});
  });
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='sim-form')return;e.preventDefault();
    const d=drafts.get(e.target.closest('.simulator').dataset.simStation);
    const output=document.getElementById('sim-result'),button=document.querySelector('.sim-run');
    const inputs={demand:d.demand,renewable:d.renewable,hours:d.hours,fuel:d.fuel},signature=JSON.stringify(inputs);
    button.disabled=true;output.setAttribute('aria-busy','true');output.innerHTML='<div class="sim-loading" role="status"><span>Running scenario</span><div class="sim-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div></div>';
    try{
      const result=runScenario?await runScenario(inputs):calculateScenario(getStation(),inputs);
      if(!output.isConnected || signature!==JSON.stringify({demand:d.demand,renewable:d.renewable,hours:d.hours,fuel:d.fuel}))return;
      d.result=result;output.innerHTML=resultView(result);
    }catch(error){if(output.isConnected)output.textContent=error.message;}
    finally{button.disabled=false;output.removeAttribute('aria-busy');}
  });
}
