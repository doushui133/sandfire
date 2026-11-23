// Run with node tests/simulation.js. No renderer, downloads or third-party test packages.
'use strict';
const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname,'..'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const noop = () => {};
class Element {
  constructor() {
    this.listeners={}; this.dataset={}; this.style={setProperty(key,value){this[key]=value;}}; this.children=[];
    const classes=new Set();
    this.classList={add:(...keys)=>keys.forEach(k=>classes.add(k)),remove:(...keys)=>keys.forEach(k=>classes.delete(k)),
      toggle:(key,on)=>on ? classes.add(key) : classes.delete(key),contains:key=>classes.has(key)};
    this.hidden=true;
  }
  addEventListener(type,fn) { (this.listeners[type] || (this.listeners[type]=[])).push(fn); }
  removeEventListener(type,fn) { this.listeners[type]=(this.listeners[type]||[]).filter((f)=>f!==fn); }
  emit(type,event={}) { for (const fn of this.listeners[type]||[]) fn(Object.assign({type,preventDefault:noop},event)); }
  querySelectorAll(selector) { return selector==='[data-action]' ? actions : []; }
  setAttribute(key,value) { this[key]=value; }
  closest(selector) {   // enough of Element.closest for the selectors the game uses
    const parts=selector.split(',').map((s)=>s.trim());
    for (let el=this; el; el=el.parent) for (const s of parts) {
      if ((s==='[data-action]' && el.dataset.action) || (s==='[data-slot]' && el.dataset.slot) || (s[0]==='#' && el.id===s.slice(1))) return el;
    }
    return null;
  }
  appendChild(el) { this.children.push(el); el.parent=this; }
  set textContent(value) { this.text=value; this.children.length=0; }
  get textContent() { return this.text; }
  get firstChild() { return this.children[0]; }
  getBoundingClientRect() {
    const value=key=>parseFloat(this.style[key])||0;
    return {left:value('left'),top:value('top'),width:value('width'),height:value('height')};
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
  getContext() { return new Proxy({},{get:()=>noop}); }
}
const nodes={}, actions=Array.from(html.matchAll(/data-action="([^"]+)"/g),m=>{
  const e=new Element(); e.dataset.action=m[1]; return e;
});
const elem=id=>nodes[id] || (nodes[id]=new Element());
const win=new Element(), document=Object.assign(new Element(),{
  getElementById:elem, createElement:()=>new Element(), body:new Element(),documentElement:new Element(),hidden:false,
});
elem('stick').firstElementChild=new Element();
Object.assign(global,{window:global, top:global, document, innerWidth:740,innerHeight:360,history:{},
  localStorage:{getItem:()=>null,setItem:noop}, addEventListener:win.addEventListener.bind(win),
  requestAnimationFrame:noop, matchMedia:()=>({matches:false,addEventListener:noop}),
  setTimeout:noop, clearTimeout:noop, THREE:require('../vendor/three.min.js')});
Object.defineProperty(global,'navigator',{value:{userAgent:'simulation'},configurable:true});
function load(name) { vm.runInThisContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),{filename:name+'.js'}); }
for (const id of ['look','core','audio','touch','map','mapgeo','gfx','video','geom','gunmodels','fx','weapons','nades','viewmodel','player','bots','game','hud','main']) load(id);
const G=global.G, W=G.Weapons, N=G.Nades, game=G.Game;
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
Math.random=G.seeded(20261122);
const gestures=[];
G.BotModel={create:noop,remove:noop,update:noop,updateBlobs:noop,ragdollPoint:()=>null,
  gesture:(a,kind)=>gestures.push([a,kind])};
G.scene=new THREE.Scene(); G.camera=new THREE.PerspectiveCamera(); G.sunDir=G.Gfx.U.uSunDir.value;
const tex=new THREE.Texture();
G.Tex={tex:()=>tex,gunDetail:()=>tex,detail:()=>tex};

// Isolated open lane. Use the live bot controller, movement, recoil, hitscan and
// armour calculation. Suppress only scenery, feedback and the end-of-round flow.
function duelMetrics() {
  const saved = { random: Math.random, time: G.time, agents: game.agents, phase: game.phase,
    frozen: game.frozen, player: G.Player.agent, bomb: game.bomb, plan: G.Bots.plan,
    fx: G.FX, ray: G.Map.raycast, query: G.Map.query, damage: game.damage };
  const rows = [];
  try {
    G.Map.raycast = () => null;
    G.Map.query = () => [];
    G.FX = { muzzle: noop, blood: noop, impact: noop, tracer: noop };
    game.phase = 'live'; game.frozen = false;
    for (const difficulty of [0, 1, 2]) {
      G.Bots.setDifficulty(difficulty);
      for (const range of [10, 25]) for (const moving of [false, true]) {
        const times = [];
        let hits = 0, shots = 0, heads = 0, expired = 0;
        game.damage = (v, a, dmg, info) => {
          if (info.head) heads++;
          hits++; v.hp -= dmg; v.alive = v.hp > 0;
          return { killed: !v.alive };
        };
        for (let trial = 0; trial < 80; trial++) {
          Math.random = G.seeded(7500 + trial);
          G.time = 0;
          const bot = game.makeAgent('atk','射手',false);
          const target = game.makeAgent('def','靶标',true);
          G.Player.agent = target; game.agents = [bot,target];
          game.bomb = { state:'carried', carrier:bot };
          bot.alive = target.alive = true;
          bot.inv.primary = W.item('ar7'); bot.cur = 'primary';
          target.armor = 100; target.helmet = true;
          target.pos.z = -range;
          G.Bots.newRound();
          for (let tick = 1; target.alive && tick <= 3600; tick++) {
            G.time = tick / 60;
            // A 4 m/s lateral strafe, reversing at +/-1.5 m.
            if (moving) target.pos.x = 1.5 - Math.abs((G.time * 4 + 1.5) % 6 - 3);
            G.Bots.update(1 / 60);
            if (bot.lastShot === G.time) shots++;
          }
          times.push(G.time);
          if (target.alive) expired++;
        }
        times.sort((a,b) => a-b);
        const median = (times[39] + times[40]) / 2;
        rows.push({ difficulty, range, moving, median, hitRate: hits / shots, heads, hits, expired });
        console.log(['新兵','老兵','精英'][difficulty], range+'m', moving?'strafe':'still',
          median.toFixed(2)+'s', (100*hits/shots).toFixed(1)+'%', 'head/hit', (100*heads/hits).toFixed(1)+'%', 'timeouts',expired);
      }
    }
  } finally {
    Math.random = saved.random; G.time = saved.time; G.Player.agent = saved.player;
    Object.assign(game,{agents:saved.agents, phase:saved.phase, frozen:saved.frozen, bomb:saved.bomb, damage:saved.damage});
    G.FX = saved.fx; G.Map.raycast = saved.ray; G.Map.query = saved.query;
    G.Bots.plan = saved.plan; G.Bots.setDifficulty(G.settings.diff);
  }
  return rows;
}
const metrics = duelMetrics();
for (const row of metrics) {
  assert(row.hitRate > 0 && row.hitRate < 1 && row.expired < 40);
  if (row.difficulty < 2) {
    assert(row.heads / row.hits <= [0.05, 0.10][row.difficulty]);
    const harder = metrics.find(r => r.difficulty === row.difficulty + 1 && r.range === row.range && r.moving === row.moving);
    assert(row.median > harder.median);
  }
}
if (process.argv.includes('--duels')) process.exit(0);
G.Gfx.preset=G.Gfx.PRESETS.low; G.FX.init(G.scene); G.VM.init(2); G.HUD.init();
for (const id of G.GunModels.IDS) {
  const model=G.GunModels.get(id);
  assert(model.whole.attributes.position.count>0 && model.whole.boundingSphere.radius>0,id);
  G.VM.setWeapon(id,'atk'); G.VM.setWeapon(id,'def');
}
assert.equal(G.GunModels.IDS.length,20);
console.log('20 model IDs built with first-person arms for both teams');

const bought=new Set(), buy=game.buy;
game.buy=function(a,id) { const ok=buy(a,id); if (ok && a.isBot) bought.add(id); return ok; };
G.startMatch('atk',true);
assert.equal(G.Player.agent.money,1000);
assert.equal(game.phaseT,8);
assert.equal(game.buyUntil-G.time,45);
const roundStart=G.time;
G.time=game.buyUntil-.001; assert(game.canBuy(G.Player.agent));
G.time=game.buyUntil; assert(!game.canBuy(G.Player.agent));
G.time=roundStart;
for (let sec=0;sec<2100 && game.phase!=='over';sec++) G.debugStep(1);
assert.equal(game.phase,'over'); assert(game.round>=8);
const newGuns=['m18','k5','u45','s8','fa2','s40','l60'];
const matchPurchases=Array.from(bought);
assert(newGuns.filter(id=>bought.has(id)).length>=3);
assert(gestures.some(([a])=>a.isBot));
console.log('Full match:',game.round,'rounds, score',game.score,'bot throws',gestures.length,'purchases',matchPurchases.join(', '));
// Additional seeded shopping trips include low-budget pistols and rare high-budget purchases.
game.phase='freeze'; game.buyUntil=Infinity; game.round=2;
for (let i=0;i<500;i++) {
  const a=game.makeAgent(i%2?'atk':'def','购置测试',false);
  a.alive=true; a.money=i%3===0 ? 800 : 9000; a.pos.copy(G.Map.spawns[a.team][0]); G.Bots.buy(a);
}
for (const id of newGuns.concat(W.grenades)) assert(bought.has(id),'bot buying '+id);
game.buy=buy;
G.startMatch('atk',true);
const me=G.Player.agent, foe=game.agents.find(a=>a.team!==me.team), ally=game.agents.find(a=>a.team===me.team && a!==me);

function field() {
  N.clear(); game.agents=[me,foe,ally]; game.phase='live'; game.frozen=false;
  for (const a of game.agents) { a.hp=100; a.alive=true; a.armor=0; a.blindUntil=0; a.crouch=0; a.vel.set(0,0,0); }
  me.pos.set(0,0,38); foe.pos.set(2,0,38); ally.pos.set(6,0,38);
  me.cur='pistol'; me.throwReady=0; me.switchEnd=0; G.paused=false; G.input.active=true;
}
function tick(sec) { for (let i=0;i<Math.round(sec*90);i++) { G.time+=1/90; N.update(1/90); } }
function at(id,pos) { G.debugThrow(id,{pos,dir:V(1,0,0),speed:0}); }
field(); at('he',V(0,.08,38)); tick(1.65);
assert(me.hp<foe.hp && foe.hp<ally.hp && ally.hp<100);
const fullDamage=100-foe.hp;
field(); foe.armor=100; at('he',V(0,.08,38)); tick(1.65); assert(Math.abs(100-foe.hp-fullDamage/2)<=1);
// Stack of crates at cell (29,3) blocks eyes and torso. Both positions are on open ground.
const cover=G.Map.cellPos(29,3);
field(); foe.pos.copy(cover); foe.pos.x+=1.4;
at('he',V(cover.x-1.4,.08,cover.z)); tick(1.65); assert.equal(foe.hp,100);
field(); foe.pos.set(0,0,35); ally.pos.copy(foe.pos); foe.yaw=Math.PI; ally.yaw=0;
at('flash',V(0,.08,38)); tick(1.65);
assert(foe.blindUntil-G.time>2 && (foe.blindUntil-G.time)>(ally.blindUntil-G.time)*3);
foe.ai.target=me; foe.ai.targetVisible=true; G.Bots.update(.04);
assert.equal(foe.ai.target,null);
console.log('HE falloff, armour, cover, flash angle and blind bot tracking passed');

for (const id of ['molotov','incendiary']) {
  field(); foe.pos.copy(me.pos);
  at(id,V(0,.1,38)); tick(1.05); assert(foe.hp<=70 && me.hp===foe.hp);
  at('smoke',V(0,.09,38)); tick(1.4); assert.equal(N.fires.length,0);
  const hp=foe.hp; tick(1); assert.equal(foe.hp,hp);
}
field(); me.pos.set(0,0,34); foe.pos.set(0,0,42); foe.yaw=0; ally.alive=false;
foe.ai.visT=0; G.Bots.update(.01); assert(foe.ai.targetVisible,'clear sight control');
at('smoke',V(0,.1,38)); tick(1.25);
assert(N.blocks(G.eyePos(foe),G.eyePos(me)));
foe.ai.visT=0; G.Bots.update(.01); assert(!foe.ai.targetVisible);
tick(20); assert.equal(N.smokes.length,0);
foe.ai.visT=0; G.Bots.update(.01);
assert(foe.ai.targetVisible && foe.ai.reactUntil-G.time>=.55);
assert(foe.ai.reactUntil-G.time<=.8);
console.log('Both fire grenades, area damage, extinguishing, smoke lifetime and delayed target reacquisition passed');

// Fire into a thin low wall in both directions at speeds exceeding a cell per simulation tick.
const wall=G.Map.boxes.find(b=>b.type==='lowwall' || b.kind==='lowwall') ||
  G.Map.boxes.find(b=>b.x0<0 && b.y1===1 && b.z0>0);
assert(wall);
for (let i=0;i<5000;i++) {
  const sign=i%2?1:-1, face=sign>0?wall.z0:wall.z1, gap=G.rand(.08,1.25);
  const g={pos:V(G.rand(wall.x0+.18,wall.x1-.18),G.rand(.18,.76),face-sign*gap),
    vel:V(G.rand(-.6,.6),G.rand(-.5,.5),sign*G.rand(15,640))};
  for (let j=0;j<16;j++) { N.step(g); assert((g.pos.z-face)*sign<=0,'wall penetration'); }
}
console.log('5,000 random wall throws passed');

field(); ally.alive=false; me.pos.set(0,0,42); foe.pos.set(0,0,38);
me.yaw=0; me.pitch=Math.atan2(1.18-1.62,4); me.recoilP=me.recoilY=me.inacc=0;
function pelletDamage(range) {
  me.inv.primary=W.item('s8'); me.cur='primary'; me.inacc=me.recoilP=me.recoilY=0;
  me.pitch=Math.atan2(1.18-1.62,range); foe.pos.z=42-range; foe.hp=1000;
  const random=Math.random; Math.random=()=>0;
  try { W.update(me,.033,{firePressed:true}); } finally { Math.random=random; }
  return 1000-foe.hp;
}
const close=pelletDamage(4), far=pelletDamage(14);
assert(close>=150 && far>0 && far<close/4);
const shotgun=W.current(me); shotgun.clip=0; W.startReload(me,shotgun); G.time+=.61;
W.update(me,.01,{}); assert.equal(shotgun.clip,1); assert(shotgun.reloading);
G.time+=1; W.update(me,.01,{firePressed:true}); assert(!shotgun.reloading && shotgun.clip===1);
console.log('Eight-pellet shot, 4 m / 14 m damage:',close,far,'and interruptible shell reload passed');

field(); G.Touch.enabled=true; G.Touch.portrait=false; G.HUD.buyOpen=G.HUD.scoresOpen=false;
const pad=elem('touchSurface'), touch=(id,x,y,target=pad)=>({identifier:id,clientX:x,clientY:y,target});
const actionButton=name=>actions.find(e=>e.dataset.action===name);
const event=(type,changes,touches,timeStamp)=>document.emit(type,{target:pad,changedTouches:changes,touches,timeStamp});
const a=touch(10,10,180), b=touch(11,140,190), f=touch(12,630,220,actionButton('fire'));
const look=touch(13,560,180);
event('touchstart',[a],[a]);
event('touchmove',[touch(10,12,180)],[a]); assert.equal(G.Touch.joystick.x,0);
event('touchmove',[touch(10,110,180)],[a]); assert.equal(G.Touch.joystick.x,1);
assert.equal(G.Touch.pointers.get(10).x,65);
event('touchmove',[touch(10,110,80)],[a]);
assert(G.Touch.joystick.y<-.9 && Math.abs(Math.hypot(G.Touch.joystick.x,G.Touch.joystick.y)-1)<1e-8);
event('touchstart',[b,f,look],[a,b,f,look],100);
assert(G.Touch.pointers.has(10) && !G.Touch.pointers.has(11) && G.input.left);
event('touchmove',[touch(13,580,180),touch(12,650,220,f.target)],[a,b,f,look],120);
assert.equal(G.input.dx,20); assert.equal(G.Touch.lookTime,.02);
event('touchmove',[touch(13,585,180)],[look],125);
assert.equal(G.Touch.joystick.x,0); assert(!G.input.left);
assert.equal(G.Touch.pointers.size,1);
event('touchcancel',[],[]); assert.equal(G.Touch.pointers.size,0);
G.Touch.reset();

const grenade=actionButton('grenade'), grenades=elem('grenadeFan');
const gr=grenade.getBoundingClientRect(), gx=gr.left+gr.width/2, gy=gr.top+gr.height/2;
const g=touch(14,gx,gy,grenade), use=touch(15,100,300,actionButton('use'));
me.nades={}; me.inv.grenade=null; W.addGrenade(me,'he'); W.addGrenade(me,'flash');
event('touchstart',[g],[g]); event('touchend',[g],[]); assert(G.input.hit('Digit4'));
G.Player.update(1/60); assert.equal(me.cur,'grenade');
G.input.endFrame();
event('touchstart',[g],[g]); event('touchmove',[touch(14,gx,gy-20,grenade)],[g]);
assert(!grenades.hidden && grenades.children.length===2);
const choice=grenades.children[1].getBoundingClientRect();
event('touchend',[touch(14,choice.left+choice.width/2,choice.top+choice.height/2,grenade)],[]);
assert(grenades.hidden && me.inv.grenade.id==='flash');
event('touchstart',[g],[g]); event('touchmove',[touch(14,gx,gy-20,grenade)],[g]);
event('touchcancel',[g],[]); assert(grenades.hidden && me.inv.grenade.id==='flash' && !G.input.hit('Digit4'));
const timer=setTimeout;
let openHeld;
global.setTimeout=(fn,ms)=>{ assert.equal(ms,220); openHeld=fn; };
event('touchstart',[g],[g]); assert(grenades.hidden); openHeld(); assert(!grenades.hidden);
event('touchend',[g],[]); assert(grenades.hidden && me.inv.grenade.id==='flash' && !G.input.hit('Digit4'));
global.setTimeout=timer;
event('touchstart',[use],[use]); event('touchend',[use],[]); assert(G.input.down('KeyE'));
G.Touch.sync(); assert(!G.input.down('KeyE'));
W.pickupTarget=()=>W.item('p10'); G.Touch.sync();
assert(actionButton('use').classList.contains('available') && actionButton('use')['aria-label']==='拾取'+W.defs.p10.name);
delete W.pickupTarget; G.Touch.sync(); assert(!actionButton('use').classList.contains('available'));
console.log('Follow-base stick, dual touch, lost touch recovery, grenade fan, cancel and pickup prompt passed');

const lookAngles=[60,120,30].map(hz=>{
  const dt=1/hz;
  me.yaw=me.pitch=0; G.Touch.realTouch=false;
  for (let i=0;i<.3*hz;i++) { G.input.dx=1000*dt; G.Player.touchLook(me,dt,.0022*G.settings.touchSens,false); }
  return -me.yaw*180/Math.PI;
});
// 300 px at 1000 px/s: gain 0.95 + 1.15 * 1000/1100, same at every frame rate
const expectedLook=300*(0.95+1.15*1000/1100)*0.0022*G.settings.touchSens*180/Math.PI;
for (const angle of lookAngles) assert(Math.abs(angle-expectedLook)<1e-4, angle+' vs '+expectedLook);
const mediumAngles=[false,true].map(sparse=>{
  me.yaw=0;
  const dt=1/120;
  for (let i=0;i<36;i++) {
    const sample=!sparse || i%2===1;
    G.input.dx=sample ? 500*dt*(sparse ? 2 : 1) : 0;
    G.Touch.lookTime=sample && sparse ? 2*dt : 0;
    G.Player.touchLook(me,dt,.0022*G.settings.touchSens,false);
  }
  return me.yaw;
});
assert(Math.abs(mediumAngles[0]-mediumAngles[1])<1e-8);
G.input.endFrame();
console.log('300 px drag at 30, 60 and 120 Hz:',lookAngles[0].toFixed(2),'degrees; sparse 60 Hz touch sampling on 120 Hz render passed');

const physicalStep=G.Phys.step;
let touchSpeed;
G.Phys.step=(_agent,_x,_z,speed)=>{ touchSpeed=speed; };
for (const [deflection,expected,walking] of [[.2,.52*.15/.28,true],[.33,.52,true],[.6,1,false],[1,1,false]]) {
  G.Touch.joystick.x=deflection;
  G.Player.update(1/60);
  assert(Math.abs(touchSpeed-W.maxSpeed(me)*expected)<1e-8 && me.walking===walking);
}
G.Phys.step=physicalStep;

ally.alive=false; me.pos.set(0,0,40); foe.pos.set(.3,0,30); me.yaw=0; me.pitch=0;
G.Touch.realTouch=true;
G.Touch.joystick.x=.3; G.input.dx=G.input.dy=0;
G.Player.touchLook(me,.03,.002); assert(me.yaw<0 && Math.hypot(me.yaw,me.pitch)<=.03*Math.PI/30+.000001);
me.yaw=me.pitch=0; G.Touch.realTouch=false; G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
G.Touch.realTouch=true; at('smoke',V(0,.1,35)); tick(1.2); G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
N.clear(); me.pos.set(cover.x-2,0,cover.z); foe.pos.set(cover.x+2,0,cover.z+.11); me.yaw=-Math.PI/2;
G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,-Math.PI/2);
console.log('Aim assist speed bound, mouse exclusion, wall and smoke occlusion passed');

field(); me.nades={}; me.inv.grenade=null;
assert.equal(G.debugGive('flash',3),2); assert.equal(G.debugGive('smoke',1),1); assert.equal(G.debugGive('he',2),1);
assert.equal(G.debugGive('molotov',1),0); assert.equal(W.grenadeCount(me),4);
const selected=me.inv.grenade.id; W.switchTo(me,'grenade'); assert.notEqual(me.inv.grenade.id,selected);
me.switchEnd=0; const item=me.inv.grenade.id;
W.update(me,.01,{fire:true,firePressed:true}); assert(me.primed);
W.update(me,.01,{}); assert.equal(N.flying[0].id,item); assert.equal(W.grenadeCount(me),3);
console.log('Carry caps, slot cycling and release-to-throw passed');

field(); me.pos.set(0,0,42); foe.pos.set(0,0,34); ally.alive=false;
G.Touch.realTouch=true; G.Touch.joystick.x=0; G.input.releaseAll(); G.input.endFrame();
me.yaw=me.pitch=0; me.cur='pistol'; me.inv.pistol=W.item('m18'); G.settings.autoFire=true;
const clip=me.inv.pistol.clip;
G.Player.update(1/30); assert.equal(me.inv.pistol.clip,clip-1);
at('smoke',V(0,.1,38)); tick(1.3); G.Player.update(1/30); assert.equal(me.inv.pistol.clip,clip-1);
N.clear(); me.pos.set(cover.x-2,0,cover.z); foe.pos.set(cover.x+2,0,cover.z); me.yaw=-Math.PI/2;
G.Player.update(1/30); assert.equal(me.inv.pistol.clip,clip-1);
console.log('Touch auto fire fired on exposed target and stopped behind cover and smoke');

field(); me.nades={}; me.inv.grenade=null; G.debugGive('flash',2); me.switchEnd=0;
me.vel.set(2,0,-1); me.yaw=me.pitch=0;
for (const [alt,both,speed] of [[true,false,6.5],[true,true,12]]) {
  G.time+=1;
  W.update(me,.01,{fire:both,alt});
  W.update(me,.01,{});
  assert(Math.abs(N.flying[N.flying.length-1].vel.clone().sub(me.vel).length()-speed)<1e-8);
}
G.debugGive('he'); game.damage(me,foe,999,{weapon:'fa2'});
assert(W.drops.some(d=>d.item.id==='he'));
console.log('Lob strengths, inherited movement and held-grenade death drop passed');

field(); G.Touch.enabled=false; me.money=16000; game.buyUntil=Infinity;
me.pos.copy(G.Map.spawns.atk[0]); G.HUD.toggleBuy(true);
const key=(n)=>win.emit('keydown',{key:String(n),code:'Digit'+n});
key(5); assert(elem('buymenu').innerHTML.includes('AR-7') && !elem('buymenu').innerHTML.includes('TR-4'));
key(1); assert.equal(me.inv.primary.id,'fa2');
key(0); key(7); assert(!elem('buymenu').innerHTML.includes('燃烧弹'));
key(2); assert((me.nades.flash||0)>0); G.onEscape(); assert(!G.HUD.buyOpen);
console.log('Keyboard category/item buying, team restrictions and Esc close passed');

// Fire across a real wooden crate; optical targeting still stops at its surface.
field(); ally.alive=false; me.pos.copy(cover); me.pos.x-=2;
foe.pos.copy(cover); foe.pos.x+=2; foe.hp=1;
me.yaw=-Math.PI/2; me.pitch=Math.atan2(1.18-G.eyeHeight(0),4);
me.inv.primary=W.item('ar7'); me.cur='primary'; me.inacc=me.recoilP=me.recoilY=0;
const killEvents=[];
G.HUD.killFx=info=>killEvents.push(info);
W.update(me,.016,{fire:true});
assert(!foe.alive && killEvents.pop().wallbang);
for (const id of ['r90','s40']) for (const range of [1,25,220]) {
  field(); foe.armor=100;
  W.applyDamage(foe,me,W.defs[id],'legs',range,0,-1);
  assert(foe.alive, id+' leg');
  foe.hp=100;
  W.applyDamage(foe,me,W.defs[id],'body',range,0,-1);
  assert(!foe.alive, id+' armored body');
}
delete G.HUD.killFx;
console.log('Crate penetration kill and armored sniper body / leg boundaries passed');

// Exercise the original third-person holding-pose lookup as well as the new model builders.
load('ragdoll'); load('soldier');
const mannequin=game.makeAgent('def','模型测试',false);
mannequin.alive=true; G.BotModel.create(mannequin,false);
for (const id of G.GunModels.IDS) {
  mannequin.cur=id==='bomb' ? id : W.defs[id].slot;
  mannequin.inv[mannequin.cur]=id==='bomb' ? true : W.item(id);
  G.BotModel.update(mannequin,1/60);
  assert.equal(mannequin.rig.gunId,id);
  G.VM.update(1/60,mannequin,G.camera);
}
G.BotModel.remove(mannequin);
console.log('All 20 IDs animated by the original third-person soldier and first-person viewmodel');

// Check the actual button rectangles produced by the layout code.
const probe=elem('safeProbe');
for (const [width,height] of [[640,360],[740,360],[844,390],[1024,768],[1180,820],[1280,800]]) {
  Object.assign(global,{innerWidth:width,innerHeight:height});
  for (const size of [.8,1,1.4]) for (const notch of [0,44]) {
    G.settings.buttonSize=size;
    probe.style={left:notch,width:width-2*notch,height:height-notch/2};
    G.Touch.applyLayout();
    const rects=actions.filter(el=>el.dataset.action!=='heavy').map(el=>el.getBoundingClientRect());
    for (const [i,rect] of rects.entries()) {
      assert(rect.left>=notch && rect.top>=0);
      assert(rect.left+rect.width<=width-notch && rect.top+rect.height<=height-notch/2);
      for (const other of rects.slice(i+1)) {
        const dx=(rect.left+rect.width/2)-(other.left+other.width/2);
        const dy=(rect.top+rect.height/2)-(other.top+other.height/2);
        assert(Math.hypot(dx,dy)>=(rect.width+other.width)/2,'default touch buttons overlap');
      }
    }
    if (size===1 && !notch && width===740) assert.equal(document.body.style['--button-unit'],'54px');
    if (size===1 && !notch && width===1180) assert.equal(document.body.style['--button-unit'],'69.7px');
  }
}
probe.style={}; G.settings.buttonSize=1;
Object.assign(global,{innerWidth:740,innerHeight:360}); G.Touch.applyLayout();
console.log('36 touch layouts passed at six phone and tablet viewports, three scales and two safe-area settings');

// Boot with a renderer stub so wireMenu registers its actual capture and settings listeners.
async function captureChecks() {
  class Renderer {
    constructor(){ this.domElement=new Element(); this.capabilities={isWebGL2:true,maxSamples:4,getMaxAnisotropy:()=>16}; this.info={autoReset:true,render:{calls:0,triangles:0},memory:{},reset:noop}; this.shadowMap={}; }
  }
  for (const method of ['setPixelRatio','setSize','setClearColor','compile','render','clear','clearDepth','setRenderTarget','setViewport','setScissor','setScissorTest','dispose','initTexture']) Renderer.prototype[method]=noop;
  THREE.WebGLRenderer=Renderer; G.Gfx.detect=()=>({webgl2:true,soft:true});
  G.Gfx.loadLightmaps=G.Gfx.buildShadow=G.Gfx.makeSky=noop;
  G.MapMesh={build:noop, updateDetail:noop}; G.MapGeo.build=()=>({}); G.Map.buildRadar=()=>elem('radar');
  G.Tex.init=noop; G.Tex.worldBuilder=()=>({total:1,step:()=>true,result:()=>({})}); G.Tex.buildWorld=async()=>({});
  G.Video.init=noop; G.Gfx.initMovingShadow=noop;
  G.HUD.init=noop; global.location={search:'',href:'http://localhost/'};
  global.setTimeout=(fn,ms)=>{ if (!ms) queueMicrotask(fn); };
  let animationFrame;
  const raf=requestAnimationFrame;
  global.requestAnimationFrame=fn=>{ animationFrame=fn; };
  await G.boot();
  global.requestAnimationFrame=raf;
  const oldGpu=G.gpu, oldPreset=G.Gfx.preset, oldPause=G.paused;
  G.Touch.enabled=true; G.paused=true; G.gpu={soft:false}; G.Gfx.preset=G.Gfx.PRESETS.high;
  Object.assign(global,{innerWidth:1280,innerHeight:800,devicePixelRatio:2});
  G.setRenderScale(1);
  assert.equal(G.Video.width*G.Video.height,1099254);
  let ts=performance.now();
  for (let i=0;i<29;i++) { ts+=30; animationFrame(ts); }
  assert.equal(G.DR.scale,.85); assert(G.Video.width*G.Video.height<800000);
  for (let i=0;i<90;i++) { ts+=1000/60; animationFrame(ts); }
  assert(G.DR.scale>.85 && G.Video.width*G.Video.height<=1.1e6);
  G.Touch.enabled=false; G.paused=oldPause; G.gpu=oldGpu; G.Gfx.preset=oldPreset;
  Object.assign(global,{innerWidth:740,innerHeight:360,devicePixelRatio:1}); G.setRenderScale(1);
  console.log('Tablet starts at 1,099,254 render pixels, downshifts within 870 ms and recovers on faster frames');
  let clock=10000, pointerCalls=0, fullCalls=0, keyCalls=0;
  const canvas=G.renderer.domElement, overlay=elem('pause'), rootEl=document.documentElement;
  G.now=()=>clock; G.settings.fullscreen=true; G.embedded=false;
  canvas.requestPointerLock=()=>{pointerCalls++; throw Error('test denial');};
  rootEl.requestFullscreen=()=>{fullCalls++; return Promise.reject(Error('windowed'));};
  G.startMatch('def'); assert(G.paused && !overlay.hidden && !G.input.freeLook);
  overlay.emit('click',{target:overlay}); assert.equal(pointerCalls,4); assert.equal(fullCalls,2);
  assert(G.paused && !G.input.freeLook);
  canvas.requestPointerLock=()=>{pointerCalls++;};
  rootEl.requestFullscreen=()=>{fullCalls++; document.fullscreenElement=rootEl;};
  navigator.keyboard={lock:()=>{keyCalls++; return Promise.resolve();},unlock:noop};
  document.exitPointerLock=()=>{document.pointerLockElement=null; document.emit('pointerlockchange');};
  overlay.emit('click',{target:overlay}); assert(G.paused);
  document.pointerLockElement=canvas; document.emit('pointerlockchange'); await Promise.resolve();
  assert(!G.paused && G.input.locked && G.input.keyboardLocked && keyCalls);
  game.frozen=false; win.emit('keydown',{code:'ControlLeft'}); G.Player.update(.03); assert(G.Player.agent.crouchWant);
  win.emit('keydown',{code:'Escape'}); assert(G.paused && !G.input.locked && !G.input.keyboardLocked);
  const before=pointerCalls; overlay.emit('click',{target:overlay});
  assert.equal(pointerCalls,before); assert(elem('pauseHint').textContent.includes('稍等一秒再点击'));
  clock+=1100; document.fullscreenElement=null; document.emit('fullscreenchange'); G.settings.fullscreen=false;
  overlay.emit('click',{target:overlay}); document.pointerLockElement=canvas; document.emit('pointerlockchange');
  win.emit('keydown',{code:'ControlLeft'}); G.Player.update(.03); assert(!G.Player.agent.crouchWant);
  win.emit('keydown',{code:'KeyC'}); G.Player.update(.03); assert(G.Player.agent.crouchWant);
  document.exitPointerLock(); assert(G.paused && !G.input.freeLook);
  clock+=1100; G.embedded=true; canvas.requestPointerLock=()=>{throw Error('embedded');};
  overlay.emit('click',{target:overlay}); assert(!G.paused && G.input.freeLook);
  console.log('Top-level refusal, retry cooldown, fullscreen keyboard lock, crouch gating and embedded fallback passed');
  momentChecks();
}
function momentChecks() {
  const p=G.Player, kills=[], hits=[], deaths=[], banners=[], hudSteps=[];
  G.HUD.killFx=info=>kills.push(info); G.HUD.hitFx=info=>hits.push(info);
  G.HUD.deathFx=info=>deaths.push(info); G.HUD.roundEnd=(...args)=>banners.push(args);
  const hudUpdate=G.HUD.update;
  G.HUD.update=dt=>{ hudSteps.push(dt); hudUpdate(dt); };
  let t=0;
  function advance(seconds) {
    const count=Math.round(seconds*60);
    for (let i=0;i<count;i++) { t+=1/60; G.frame(1/60,t); }
  }
  G.startMatch('def',true);
  const player=p.agent, foes=game.agents.filter(a=>a.team!==player.team);
  const mate=game.agents.find(a=>a!==player && a.team===player.team);
  game.phase='live'; game.frozen=false;
  game.damage(foes[0],player,7,{weapon:'p10'});
  assert.deepEqual(hits.pop(),{head:false,kill:false,dmg:7});
  game.damage(foes[0],player,999,{weapon:'p10',head:true});
  assert.deepEqual(hits.pop(),{head:true,kill:true,dmg:93});
  assert(kills[0].first && kills[0].headshot && !kills[0].last);
  const start=G.time;
  advance(.1);
  assert(Math.abs(G.time-start-.1*.35)<1e-8);
  assert(Math.abs(hudSteps.pop()-1/60)<1e-8);
  assert(G.camera.fov<74);
  advance(.5); assert.equal(G.timeScale,1);
  for (let i=1;i<5;i++) game.damage(foes[i],player,999,{weapon:i===1?'knife':'he'});
  assert.deepEqual(kills.map(e=>e.multi),[1,2,3,4,5]);
  assert.deepEqual(kills.map(e=>e.streak),[1,2,3,4,5]);
  assert(kills[1].knife && kills[2].grenade && kills[4].last && kills[4].ace);
  advance(.25); const firstPos=G.camera.position.clone();
  assert(p.orbit && foes[4].rig.rd && game.phase==='end' && !banners.length);
  advance(1.65);
  assert(p.orbit && !banners.length && firstPos.distanceTo(G.camera.position)>.2);
  advance(.15);
  assert(!p.orbit && G.timeScale===1 && banners.length===1);

  game.newRound(); game.phase='live'; game.frozen=false;
  game.damage(foes[0],mate,200,{weapon:'tr4'});
  game.damage(foes[1],player,200,{weapon:'tr4'});
  assert(!kills[kills.length-1].first && kills[kills.length-1].streak===1);
  const before=G.time; G.debugStep(.1);
  assert(Math.abs(G.time-before-.1)<1e-8);
  advance(4.1);
  game.damage(foes[2],player,200,{weapon:'tr4'});
  assert.equal(kills[kills.length-1].multi,1);
  game.bomb.state='planted';
  for (const enemy of foes.slice(3)) game.damage(enemy,player,200,{weapon:'tr4'});
  assert(kills[kills.length-1].last && !kills[kills.length-1].ace && !p.orbit);
  game.newRound(); assert.equal(G.timeScale,1);

  advance(.05);
  const height=G.camera.position.y;
  game.damage(player,foes[0],200,{weapon:'fa2',head:true});
  assert.deepEqual(deaths.pop(),{killer:foes[0].name,weapon:'fa2',headshot:true,killerHp:foes[0].hp});
  advance(.3);
  assert(G.timeScale===.35 && G.camera.position.y<height && G.camera.rotation.z>.1);
  G.paused=true; advance(.3); assert.equal(G.timeScale,1);
  G.paused=false; advance(.4);
  const wide=G.camera.fov;
  assert(G.timeScale===1 && !p.spectateTarget() && G.renderer.domElement.style.filter);
  advance(2.2); assert(G.camera.fov<wide && !p.spectateTarget());
  advance(.3); assert(p.spectateTarget() && G.camera.fov===74 && !G.renderer.domElement.style.filter);
  game.newRound(); game.phase='end'; game.phaseT=.001; game.over='atk';
  game.damage(player,null,200,{weapon:'bomb'}); advance(.05);
  assert(game.phase==='over' && G.timeScale===1 && !G.renderer.domElement.style.filter);
  G.startMatch('atk',true);
  game.damage(p.agent,null,200,{weapon:'bomb'});
  elem('btnQuit').emit('click');
  assert(G.timeScale===1 && !p.orbit && !G.renderer.domElement.style.filter);
  console.log('Kill tiers, HUD payloads, wall-clock window, orbit before banner, planted-bomb control, death fall, killer zoom, spectating, pause and menu cleanup passed');
}
captureChecks().catch(err=>{console.error(err);process.exitCode=1;});

