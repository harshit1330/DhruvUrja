import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url));
const assets=resolve(root,'assets');
const key=(await readFile(resolve(root,'../backend/data/api-key.txt'),'utf8')).trim();
const sessions=new Map(),port=3002;
const publicWeather=new Map();
async function loginWeather(station){
  const current=publicWeather.get(station);
  if(current&&current.expires>Date.now())return current.promise;
  const entry={expires:Date.now()+60000};
  entry.promise=(async()=>{
    const url='http://127.0.0.1:8001/api/v1/stations/'+station+'/weather';
    const options={headers:{'X-API-Key':key},signal:AbortSignal.timeout(30000)};
    let response=await fetch(url,options),weather=await response.json();
    const hour=Math.floor(Date.now()/3600000)*3600000;
    const usable=()=>response.ok&&weather.data_kind==='provider'&&Date.now()-Date.parse(weather.retrieved_at)<3600000&&weather.hours?.some(h=>Date.parse(h.timestamp)===hour);
    if(!usable()){
      response=await fetch(url+'/refresh',{...options,method:'POST'});weather=await response.json();
    }
    if(!usable())throw Error('Live weather unavailable');
    const reading=weather.hours.find(h=>Date.parse(h.timestamp)===hour);
    return {station,temperature_c:reading.temperature_c,wind_speed_kmh:reading.wind_speed_m_s*3.6,cloud_cover_percent:reading.cloud_cover_percent,timestamp:reading.timestamp,retrieved_at:weather.retrieved_at,source:'Open-Meteo'};
  })().catch(error=>{if(publicWeather.get(station)===entry)publicWeather.delete(station);throw error;});
  publicWeather.set(station,entry);return entry.promise;
}
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.json':'application/json','.webp':'image/webp','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1:'+port).pathname);
    if(path.startsWith('/api/public/weather/')){
      const station=path.slice('/api/public/weather/'.length);
      if(req.method!=='GET')return json(res,405,{detail:'Method not allowed'});
      if(!['bharati','maitri'].includes(station))return json(res,404,{detail:'Station weather not available'});
      try{return json(res,200,await loginWeather(station));}
      catch{return json(res,503,{detail:'Live weather is temporarily unavailable. Please try again.'});}
    }
    if(path.startsWith('/api/v1/')){
      if(req.headers.origin&&!['http://localhost:3002','http://127.0.0.1:3002'].includes(req.headers.origin))return json(res,403,{detail:'Origin not allowed'});
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)return json(res,413,{detail:'Request too large'});}
      if(path==='/api/v1/auth/login'&&req.method==='POST'){
        let body;try{body=JSON.parse(raw);}catch{return json(res,400,{detail:'Invalid JSON'});}
        if(!equal(body.username,'demo_operator')||!equal(body.password,'polar-demo-password'))return json(res,401,{detail:'Incorrect operator ID or password'});
        if(!['bharati','maitri'].includes(body.station))return json(res,403,{detail:'This preview connects Bharati and Maitri. Select one of these stations.'});
        const token=randomBytes(32).toString('hex');
        for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id);
        sessions.set(token,{username:'demo_operator',role:'station_operator',station:body.station,expires:Date.now()+8*3600000});
        return json(res,200,{access_token:token,token_type:'bearer'});
      }
      const token=req.headers.authorization?.replace(/^Bearer /,''),session=sessions.get(token);
      if(!session||session.expires<Date.now())return json(res,401,{detail:'Session expired. Please log in again.'});
      if(path==='/api/v1/auth/me')return json(res,200,{username:session.username,role:session.role,station:session.station});
      if(path==='/api/v1/auth/logout'){sessions.delete(token);return json(res,200,{ok:true});}
      if(path==='/api/v1/stations'&&req.method==='GET'){
        const response=await fetch('http://127.0.0.1:8001/api/v1/stations',{headers:{'X-API-Key':key},signal:AbortSignal.timeout(10000)});
        if(!response.ok)return json(res,response.status,{detail:'Station list unavailable'});
        return json(res,200,(await response.json()).filter(s=>s.id===session.station));
      }
      const match=path.match(/^\/api\/v1\/stations\/([a-z0-9_-]+)(\/.*)?$/);
      if(!match||match[1]!==session.station)return json(res,403,{detail:'This session is scoped to the selected station'});
      const tail=match[2]||'';
      const allowed=req.method==='GET'&&['','/overview','/weather','/plans/latest','/resupply'].includes(tail)||req.method==='POST'&&['/plan','/forecast','/simulate','/recommendations','/weather/refresh','/resupply'].includes(tail);
      if(!allowed)return json(res,403,{detail:'Action not available in this preview'});
      const response=await fetch('http://127.0.0.1:8001'+path,{method:req.method,headers:{'X-API-Key':key,'content-type':'application/json'},body:req.method==='GET'?undefined:raw||'{}',signal:AbortSignal.timeout(150000)});
      return json(res,response.status,await response.json());
    }
    if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
    const base=path.startsWith('/assets/')?assets:root;
    const target=resolve(base,'.'+(path.startsWith('/assets/')?path.slice(7):path==='/'?'/index.html':path));
    if(!target.startsWith(resolve(base)+sep))return res.writeHead(403).end();
    if(base===root&&!['.html','.css','.js','.png'].includes(extname(target)))return res.writeHead(404).end();
    const info=await stat(target),headers={'content-type':mime[extname(target)]||'application/octet-stream','cache-control':'no-store','accept-ranges':'bytes'};
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):info.size-1,info.size-1);if(start>end)return res.writeHead(416).end();res.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${info.size}`,'content-length':end-start+1});if(req.method==='HEAD')return res.end();createReadStream(target,{start,end}).pipe(res);}
    else{res.writeHead(200,{...headers,'content-length':info.size});if(req.method==='HEAD')return res.end();createReadStream(target).pipe(res);}
  }catch(error){if(!res.headersSent)json(res,error.code==='ENOENT'?404:502,{detail:error.code==='ENOENT'?'Not found':'Backend unavailable or request timed out. Please retry.'});else res.end();}
}).listen(port,'127.0.0.1',()=>console.log('Connected Dhruvurja preview: http://localhost:3002/#home'));
