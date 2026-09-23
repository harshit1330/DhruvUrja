import * as THREE from './assets/three.module.js';

export const stationLocations = {
  maitri: { name: 'Maitri', lat: -70.77, lon: 11.73 },
  bharati: { name: 'Bharati', lat: -69.41, lon: 76.18 },
  himadri: { name: 'Himadri', lat: 78.92, lon: 11.93 }
};
export function stationDirection({lat,lon}) {
  const latitude=THREE.MathUtils.degToRad(lat), longitude=THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),-Math.cos(latitude)*Math.sin(longitude));
}
export function stationOrientation(location) {
  const direction=stationDirection(location);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(direction,new THREE.Vector3(),new THREE.Vector3(0,1,0))).invert();
}
export function createStationGlobe(host,initialStation) {
  let renderer;
  try { renderer=new THREE.WebGLRenderer({alpha:true,antialias:true}); }
  catch { host.textContent='3D globe unavailable'; return {setStation(){},dispose(){}}; }
  let disposed=false,frame=0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000,0);
  host.append(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(36,1,.1,20);
  camera.position.set(0,0,3.9);
  const globe=new THREE.Group();scene.add(globe);
  scene.add(new THREE.AmbientLight(0xb6d7ff,1.1));
  const sunlight=new THREE.DirectionalLight(0xffffff,2.1);sunlight.position.set(-3,4,5);scene.add(sunlight);
  const earthMaterial=new THREE.MeshPhongMaterial({color:0xffffff,shininess:12,specular:0x243647});
  const earth=new THREE.Mesh(new THREE.SphereGeometry(1,64,48),earthMaterial);globe.add(earth);
  const textures=[];
  const draw=()=>{if(!disposed)renderer.render(scene,camera);};
  const loader=new THREE.TextureLoader();
  const day=loader.load('assets/earth-day.jpg',draw);day.colorSpace=THREE.SRGBColorSpace;
  day.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.push(day);earthMaterial.map=day;
  const normal=loader.load('assets/earth-bump.jpg',draw);textures.push(normal);earthMaterial.normalMap=normal;earthMaterial.normalScale.set(.4,.4);
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.025,48,32),new THREE.MeshBasicMaterial({color:0x5faaff,side:THREE.BackSide,transparent:true,opacity:.2,depthWrite:false}));globe.add(atmosphere);
  const pinCanvas=document.createElement('canvas');pinCanvas.width=96;pinCanvas.height=128;
  const context=pinCanvas.getContext('2d');
  context.beginPath();context.moveTo(48,120);context.bezierCurveTo(42,107,12,68,12,43);context.arc(48,43,36,Math.PI,0);context.bezierCurveTo(84,68,54,107,48,120);context.closePath();
  context.fillStyle='#ee183b';context.fill();context.strokeStyle='#fff';context.lineWidth=5;context.stroke();
  context.beginPath();context.arc(48,43,12,0,Math.PI*2);context.fillStyle='#fff';context.fill();
  const pinTexture=new THREE.CanvasTexture(pinCanvas);pinTexture.colorSpace=THREE.SRGBColorSpace;textures.push(pinTexture);
  const pin=new THREE.Sprite(new THREE.SpriteMaterial({map:pinTexture,depthTest:true,depthWrite:false,toneMapped:false}));
  pin.center.set(.5,0);pin.scale.set(.23,.31,1);globe.add(pin);
  const label=document.createElement('span');label.className='station-globe-label';host.append(label);
  let selected=null;
  function setStation(id) {
    if(disposed||!stationLocations[id]||selected===id)return;
    selected=id;cancelAnimationFrame(frame);
    const location=stationLocations[id];
    host.setAttribute('aria-label',`3D Earth showing ${location.name} station at ${Math.abs(location.lat)} degrees ${location.lat<0?'south':'north'}, ${location.lon} degrees east`);
    label.textContent=location.name;
    pin.position.copy(stationDirection(location).multiplyScalar(1.015));
    const from=globe.quaternion.clone(),to=stationOrientation(location);
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:1500;
    const started=performance.now();
    function animate(now) {
      if(disposed)return;
      const progress=duration?Math.min(1,(now-started)/duration):1;
      const eased=progress*progress*(3-2*progress);
      globe.quaternion.slerpQuaternions(from,to,eased);draw();
      if(progress<1)frame=requestAnimationFrame(animate);
      else frame=0;
    }
    frame=requestAnimationFrame(animate);
  }
  function resize(){
    if(disposed)return;
    const width=host.clientWidth,height=host.clientHeight;
    if(!width||!height)return;
    camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);draw();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();setStation(initialStation);
  return {setStation,dispose(){
    disposed=true;cancelAnimationFrame(frame);observer.disconnect();
    scene.traverse(object=>{object.geometry?.dispose();if(object.material)object.material.dispose();});
    textures.forEach(texture=>texture.dispose());renderer.dispose();renderer.forceContextLoss();
  }};
}
