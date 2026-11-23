// Structural check with the real r128 renderer and a no-op GL context. Traversal, frustum
// culling, instance counts and renderer.info are real. No pixels are rasterized.
// node tools/scene-check.js <project> low|medium|high|ultra [rounds]
'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert');
const dir=path.resolve(process.argv[2]||'.'), quality=process.argv[3]||'high', noop=()=>{};
const G=require('./loadgame')(dir,path.join(dir,'vendor/three.min.js')), THREE=G.THREE;
const started=performance.now();
const ctx=new Proxy({
  getImageData(x,y,w,h){return {data:new Uint8ClampedArray(w*h*4)};},
  createLinearGradient(){return {addColorStop:noop};},
  createRadialGradient(){return {addColorStop:noop};}
},{get:(o,k)=>k in o?o[k]:noop});
function canvas(){return {width:1,height:1,style:{},getContext:()=>ctx,addEventListener:noop,removeEventListener:noop,setAttribute:noop};}
document.createElement=document.createElementNS=canvas;
const elements=new Map();
document.getElementById=id=>{if(!elements.has(id)) elements.set(id,{hidden:true});return elements.get(id);};
global.innerWidth=960; global.innerHeight=540;
const script=name=>vm.runInThisContext(fs.readFileSync(path.join(dir,'js',name+'.js'),'utf8'),{filename:name+'.js'});
for(const name of ['textures','gfx','geom','gunmodels','mapmesh','fx','weapons','nades','viewmodel','player','ragdoll','soldier','bots','game','main']) script(name);
if(fs.existsSync(path.join(dir,'js/video.js'))) script('video');
const p=G.Gfx.preset=G.Gfx.PRESETS[quality];
assert(p,'unknown preset');
G.Touch={enabled:false,primary:()=>false};
G.Audio=new Proxy({},{get:()=>noop});
const ends=[], plants=[];
G.HUD=new Proxy({buyOpen:false,scoresOpen:false,
  roundEnd:(winner,reason)=>ends.push(reason),
  message:()=>{if(G.Game.bomb.state==='planted') plants.push(G.Game.bomb.site);}
},{get:(o,k)=>k in o?o[k]:noop});

// The renderer talks to WebGL2 through this minimal context for submission counting.
class WebGL2RenderingContext {
  getContextAttributes(){return {alpha:false, stencil:false};}
  getExtension(){return null;}
  getParameter(p){
    if(p===7938) return 'WebGL 2.0';
    if(p===2978||p===3088) return [0,0,960,540];
    if(p===34921) return 16;
    if(p===36183) return 4;
    if(p===3379||p===34076) return 16384;
    return 16;
  }
  getShaderPrecisionFormat(){return {precision:23,rangeMin:127,rangeMax:127};}
  // r128 discovers an InstancedBufferGeometry's maximum instance count while binding
  // its active attributes. Preserve that path for the effect pools as well.
  shaderSource(shader,src){shader.src=src;}
  attachShader(program,shader){
    if (!shader.src.includes('gl_Position')) return;
    program.inputs=Array.from(new Set(Array.from(shader.src.matchAll(/\battribute\s+\w+\s+(\w+)/g),m=>m[1]))).filter(name=>['position','iA','iPos'].includes(name));
  }
  getProgramParameter(prog,param){return param===35718 ? 0 : param===35721 ? (prog.inputs||[]).length : true;}
  getActiveAttrib(prog,i){return {name:prog.inputs[i],type:35665,size:1};}
  getAttribLocation(prog,name){return prog.inputs.indexOf(name);}
  getProgramInfoLog(){return '';}
  getShaderInfoLog(){return '';}
  getShaderParameter(){return true;}
  getError(){return 0;}
}
global.WebGL2RenderingContext=WebGL2RenderingContext;
const gl=new Proxy(new WebGL2RenderingContext(),{get:(o,k)=>{
  if(k in o) return o[k];
  if(typeof k!=='string') return;
  if(k.startsWith('create')) return ()=>({});
  if(k==='getUniformLocation') return ()=>null;
  if(k===k.toUpperCase()) return ({VERSION:7938,SCISSOR_BOX:3088,VIEWPORT:2978,ACTIVE_UNIFORMS:35718,ACTIVE_ATTRIBUTES:35721,
    MAX_TEXTURE_SIZE:3379,MAX_VERTEX_ATTRIBS:34921,MAX_SAMPLES:36183,LINK_STATUS:35714,COMPILE_STATUS:35713})[k];
  return noop;
}});
const r=G.renderer=new THREE.WebGLRenderer({canvas:canvas(),context:gl});
r.info.autoReset=false; r.autoClear=false; r.toneMapping=THREE.CustomToneMapping;
G.scene=new THREE.Scene(); G.sunDir=G.Gfx.U.uSunDir.value; G.camera=new THREE.PerspectiveCamera(74,16/9,.05,900);
G.camera.rotation.order='YXZ'; G.Tex.init(r);
const materialStart=performance.now(), wb=G.Tex.worldBuilder(p.normals,p.aniso);
while(!wb.step()) {}
const surfaces=wb.result(), materialMs=Math.round(performance.now()-materialStart);
const geo=G.MapGeo.build(), meta=JSON.parse(fs.readFileSync(path.join(dir,'assets/lightmap.json')));
assert.equal(meta.checksum,geo.checksum); assert.equal(meta.w,geo.atlasW); assert.equal(meta.h,geo.atlasH);
let paths=0;
for(const spawn of [...G.Map.spawns.atk,...G.Map.spawns.def]) for(const site of Object.values(G.Map.sites)){
  const route=G.Map.findPath(spawn,site.center); assert(route && route.length);
  assert(route[route.length-1].distanceTo(site.center)<.01); paths++;
}
for(const b of G.Map.boxes){
  assert(b.x1>b.x0 && b.y1>b.y0 && b.z1>b.z0);
  assert(G.Map.query(b.x0,b.z0,b.x1,b.z1).includes(b));
}
G.MapMesh.build(G.scene,geo,surfaces,p);
G.Gfx.buildShadow(r,G.scene,p.shadow,G.MapMesh.frondTex);
G.Gfx.makeSky(G.scene); G.FX.init(G.scene); G.VM.init(16/9); G.BotModel.warm();
if(G.Video){G.Video.defaults(false); G.Video.init(r,p); G.Video.resize(r,1,1); G.Gfx.initMovingShadow(p.movingShadow);}
G.input.active=true; G.input.test=true; G.paused=false;
Math.random=G.seeded(731); G.Game.start('atk',1);
G.debugStep(8); G.VM.update(1/30,G.Player.agent,G.camera); G.paused=true;
const rows=[];
for(const [x,y,z,yaw] of [[0,1.62,42,0],[37,1.62,-16,.65],[-25,1.62,-12,.42]]){
  G.camera.position.set(x,y,z); G.camera.rotation.set(-.04,yaw,0,'YXZ');
  r.info.reset(); G.frame(0,8); rows.push([r.info.render.calls,r.info.render.triangles]);
}
for(const [calls,tris] of rows) assert(calls>0 && Number.isFinite(tris) && tris>0);
const models={};
for(const a of [G.Game.agents[1],G.Game.agents[5]]){
  function count(distance){
    G.camera.position.copy(a.pos);G.camera.position.z+=distance;
    if(G.BotModel.updateLOD) G.BotModel.updateLOD(G.camera);
    return a.rig.mesh.geometry.index.count/3;
  }
  models[a.team]=[count(1),count(60)];
  if(G.BotModel.updateLOD){assert(models[a.team][0]<=12000);assert(models[a.team][1]<=3000);}
  if(G.BotModel.gesture){
    G.BotModel.gesture(a,'throw'); G.BotModel.update(a,.2); assert(a.rig.gestureT>0);
    G.BotModel.gesture(a,'reload'); G.BotModel.update(a,.2);
    G.BotModel.gesture(a,'ignore'); assert.equal(a.rig.gestureName,'reload');
    const old=a.crouch; a.crouch=1; G.BotModel.update(a,1/30);
    const head=a.rig.bones[3], pos=new THREE.Vector3(0,.115,.006).applyQuaternion(head.quaternion).add(head.position);
    assert(Math.abs(pos.y+a.pos.y-G.Weapons.hitboxes(a).headY)<1e-5);
    a.crouch=old;
  }
}
const readyMs=Math.round(performance.now()-started);
console.log(JSON.stringify({quality,paths,colliders:G.Map.boxes.length,quads:geo.quads.length,materialMs,readyMs,models,rows}));
if(process.argv.includes('rounds')){
  G.paused=false;
  for(let i=0;i<3000 && (!ends.includes('defuse') || new Set(plants).size<2);i++){
    if(G.Game.phase==='over') G.Game.start(i%2 ? 'atk' : 'def',1);
    G.debugStep(1);
  }
  console.log(JSON.stringify({rounds:ends.length,ends,sites:Array.from(new Set(plants))}));
  assert(ends.includes('defuse'));assert(plants.includes('A')&&plants.includes('B'));
}
