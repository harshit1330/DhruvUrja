import {api} from './api.js';
export const backend={stationId:null,data:null,loading:false,error:null,errorStatus:null};
let revision=0,pending;
export function resetBackend(){revision++;Object.assign(backend,{stationId:null,data:null,loading:false,error:null,errorStatus:null});pending=null;}
export async function loadBackend(stationId){
  if(backend.stationId===stationId&&pending)return pending;
  const ticket=++revision;Object.assign(backend,{stationId,loading:true,error:null,errorStatus:null});
  pending=(async()=>{try{
    const [overview,plan]=await Promise.all([api('/stations/'+stationId+'/overview'),api('/stations/'+stationId+'/plan',{method:'POST',body:JSON.stringify({horizon_hours:24})})]);
    if(ticket!==revision)return null;
    const station=overview.station,snapshot=overview.snapshot,hour=plan.optimized.hours[0],weather=plan.forecast.hours[0];
    const type=snapshot.data_kind.toUpperCase();
    const sources=[{id:'solar',source_type:'solar',name:'Solar array',capacity_kw:station.solar_capacity_kw},{id:'wind',source_type:'wind',name:'Wind',capacity_kw:station.wind_capacity_kw},{id:'diesel',source_type:'diesel',name:'Equivalent generator',capacity_kw:station.generator_capacity_kw,status:snapshot.generator_available?'Available · demo configuration':'Unavailable'}];
    const energy=plan.optimized.hours.flatMap(h=>[['solar',h.solar_available_kw],['wind',h.wind_available_kw],['diesel',h.generator_kw]].map(([source_id,generation_kw])=>({source_id,generation_kw,timestamp:h.timestamp,data_type:'PLANNED'})));
    const fuelRecord={fuel_type:'Diesel',level_litres:snapshot.fuel_l,consumption_litres:null,timestamp:snapshot.timestamp,data_type:type,generator_status:'Recorded inventory'};
    backend.data={plan,rawOverview:overview,overview:{latest_weather:{timestamp:plan.forecast.weather_retrieved_at||plan.forecast.weather_issued_at,temperature_c:weather.temperature_c,wind_speed_mps:weather.wind_speed_m_s},energy_sources:sources,latest_energy_readings:energy.slice(0,3),battery_status:[{soc:snapshot.battery_kwh/station.battery_capacity_kwh*100,charge_kw:hour.battery_charge_kw,discharge_kw:hour.battery_discharge_kw}],fuel_status:[fuelRecord]},consumption:[{timestamp:snapshot.timestamp,load_kw:snapshot.load_kw,data_type:type}],energy,fuelHistory:[fuelRecord],loadForecast:{horizon_hours:plan.forecast.hours.length,model_name:plan.forecast.model,forecast_values:plan.forecast.hours.map(h=>({forecast_time:h.timestamp,predicted_value:h.load_kw}))},optimization:{created_at:plan.generated_at,results:plan.optimized.hours.map(h=>({time_slot:h.timestamp,generation_kw:h.load_kw-h.essential_unserved_kw-h.flexible_unserved_kw}))},alerts:plan.alerts.map(a=>({...a,alert_type:a.code||'energy_reserve',created_at:a.starts_at||a.generated_at,status:'active'})),survival:null};
    return backend.data;
  }catch(error){if(ticket===revision){backend.data=null;backend.error=error.message;backend.errorStatus=error.status??null;}throw error;}finally{if(ticket===revision){backend.loading=false;pending=null;}}})();return pending;
}
export function stationValues(){const d=backend.data,p=d?.plan,h=p?.optimized.hours[0],o=d?.rawOverview;return {load:o?.snapshot.load_kw??NaN,solar:h?.solar_available_kw??NaN,windPower:h?.wind_available_kw??NaN,diesel:h?.generator_kw??NaN,temp:p?.forecast.hours[0].temperature_c??NaN,wind:p?Math.round(p.forecast.hours[0].wind_speed_m_s*36)/10:NaN,cloud:p?.forecast.hours[0].cloud_cover_percent??NaN,humidity:p?.forecast.hours[0].humidity_percent??NaN,battery:o?o.snapshot.battery_kwh/o.station.battery_capacity_kwh*100:NaN,charge:h?h.battery_charge_kw-h.battery_discharge_kw:NaN,fuel:o?.snapshot.fuel_l??NaN,burn:p?.optimized.fuel_used_l??NaN,days:NaN};}
export function recordDate(value){return value?new Date(value):null;}
export function latestDate(){return recordDate(backend.data?.plan.generated_at);}
export function dataLabel(){return backend.loading?'CONNECTING':backend.error?(backend.errorStatus===409?'INPUTS NEED UPDATE':backend.errorStatus?'DATA UNAVAILABLE':'OFFLINE'):backend.data?'LIVE WEATHER · DEMO ENERGY':'NO DATA';}
export function metricHistory(key){const d=backend.data;if(!d)return [];if(key==='load')return [d.rawOverview.snapshot.load_kw];if(key==='fuel')return [d.rawOverview.snapshot.fuel_l];if(key==='battery')return [stationValues().battery];return d.plan.optimized.hours.map(h=>key==='solar'?h.solar_available_kw:key==='wind'?h.wind_available_kw:h.solar_available_kw+h.wind_available_kw);}
let baselineCache;
export async function simulatorBaseline(hours){
  const data=backend.data,id=backend.stationId;
  if(!data||backend.error)throw Error('Refresh station data to see forecast amounts.');
  const key=id+':'+data.plan.generated_at;
  let rows=data.plan.optimized.hours;
  if(hours>rows.length){
    if(baselineCache?.key!==key)baselineCache={key,promise:api('/stations/'+id+'/simulate',{method:'POST',body:JSON.stringify({horizon_hours:72,load_multiplier:1,renewable_multiplier:1})}).then(r=>r.optimized.hours).catch(error=>{if(baselineCache?.key===key)baselineCache=null;throw error;})};
    rows=await baselineCache.promise;
  }
  if(backend.stationId!==id||backend.data!==data)throw Error('Station data changed. Refresh the simulator.');
  const selected=rows.slice(0,hours),mean=key=>selected.reduce((sum,h)=>sum+h[key],0)/selected.length;
  return {hours:selected.length,load:mean('load_kw'),solar:mean('solar_available_kw'),wind:mean('wind_available_kw')};
}
export async function runBackendScenario(inputs){
  const stationId=backend.stationId;if(!backend.data||backend.error)throw Error('Refresh station data before running a scenario.');
  const result=await api('/stations/'+stationId+'/simulate',{method:'POST',body:JSON.stringify({horizon_hours:inputs.hours,load_multiplier:inputs.demand/100,renewable_multiplier:inputs.renewable/100,fuel_override_l:inputs.fuel===''?null:Number(inputs.fuel)})});
  const p=result.optimized,n=p.hours.length,avg=fn=>p.hours.reduce((sum,h)=>sum+fn(h),0)/n;
  const unserved=p.essential_unserved_kwh+p.flexible_unserved_kwh;
  return {backend:true,feasible:unserved<1e-4,reason:result.alerts.map(a=>a.message).join(' '),load:avg(h=>h.load_kw),clean:avg(h=>h.solar_available_kw+h.wind_available_kw-h.curtailed_kw),residual:avg(h=>h.generator_kw),needed:p.fuel_used_l,remaining:p.fuel_remaining_l,unserved,shortfall:0,coverage:null,hours:n,series:p.hours.map(h=>h.load_kw)};
}
