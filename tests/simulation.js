// Run with node tests/simulation.js. No renderer, downloads or third-party test packages.
'use strict';
const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname,'..'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const noop = () => {};
class Element {
  constructor() {
    this.listeners={}; this.dataset={}; this.style={setProperty:noop}; this.children=[];
    this.classList={add:noop,remove:noop,toggle:noop}; this.hidden=true;
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
  get firstChild() { return this.children[0]; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
  getContext() { return new Proxy({},{get:()=>noop}); }
}
const nodes={}, actions=Array.from(html.matchAll(/data-action="([^"]+)"/g),m=>{
  const e=new Element(); e.dataset.action=m[1]; return e;
});
const elem=id=>nodes[id] || (nodes[id]=new Element());
const win=new Element(), document=Object.assign(new Element(),{
  getElementById:elem, createElement:()=>new Element(), body:new Element(),documentElement:new Element(),
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

field(); ally.alive=false; me.pos.set(35,0,43); foe.pos.set(35,0,39);
me.yaw=0; me.pitch=Math.atan2(1.18-1.62,4); me.recoilP=me.recoilY=me.inacc=0;
function pelletDamage(range) {
  me.inv.primary=W.item('s8'); me.cur='primary'; me.inacc=me.recoilP=me.recoilY=0;
  me.pitch=Math.atan2(1.18-1.62,range); foe.pos.z=me.pos.z-range; foe.hp=1000;
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
const pad=elem('game'), touch=(id,x,y,target=pad)=>({identifier:id,clientX:x,clientY:y,target});
const event=(type,changes,touches)=>document.emit(type,{target:pad,changedTouches:changes,touches});
let a=touch(10,120,180), b=touch(11,140,190), f=touch(12,630,220,actions.find(e=>e.dataset.action==='fire'));
event('touchstart',[a],[a]); event('touchmove',[touch(10,180,180)],[a]);
assert.equal(G.Touch.joystick.x,1);
event('touchstart',[b,f],[b,f]); assert(!G.Touch.pointers.has(10)); assert(G.input.left);
event('touchmove',[touch(11,153,190)],[b,f]); assert(G.Touch.joystick.x>0 && G.Touch.joystick.x<.6);
event('touchend',[f],[]); assert.equal(G.Touch.pointers.size,0); assert.equal(G.Touch.joystick.x,0); assert(!G.input.left);
event('touchstart',[a],[a]); event('touchcancel',[],[]); assert.equal(G.Touch.pointers.size,0);
console.log('Document touch movement, replacement, simultaneous fire, end reconciliation and cancel passed');

ally.alive=false; me.pos.set(35,0,40); foe.pos.set(35.3,0,30); me.yaw=0; me.pitch=0;
G.Touch.joystick.x=.3; G.input.dx=G.input.dy=0;
G.Player.touchLook(me,.03,.002); assert(me.yaw<0 && Math.hypot(me.yaw,me.pitch)<=.03*Math.PI/30+.000001);
me.yaw=me.pitch=0; G.Touch.realTouch=false; G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
G.Touch.realTouch=true; at('smoke',V(35,.1,35)); tick(1.2); G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
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

field(); me.pos.set(35,0,42); foe.pos.set(35,0,34); ally.alive=false;
G.Touch.realTouch=true; G.Touch.joystick.x=0; G.input.releaseAll(); G.input.endFrame();
me.yaw=me.pitch=0; me.cur='pistol'; me.inv.pistol=W.item('m18'); G.settings.autoFire=true;
const clip=me.inv.pistol.clip;
G.Player.update(1/30); assert.equal(me.inv.pistol.clip,clip-1);
at('smoke',V(35,.1,38)); tick(1.3); G.Player.update(1/30); assert.equal(me.inv.pistol.clip,clip-1);
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

// Resolve the dimensions from touch.css for the requested safe-area layouts. This checks
// bounding boxes; native event delivery, text rendering and GPU throughput need device testing.
const css=fs.readFileSync(path.join(root,'touch.css'),'utf8');
function prop(selector,key) {
  let result;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim()!==selector) continue;
    for (const rule of m[2].split(';')) {
      const colon=rule.indexOf(':');
      if (colon>0 && rule.slice(0,colon).trim()===key) result=rule.slice(colon+1).trim();
    }
  }
  assert(result,selector+' '+key); return result;
}
for (const [width,height] of [[640,360],[740,360],[844,390],[1024,768]]) {
  for (const size of [.8,1,1.4]) for (const notch of [0,44]) {
    const vars={'--button-size':size,'--right':8+notch,'--left':8+notch,'--bottom':5+notch/2};
    function pixels(expr) {
      const code=expr.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/g,(_,k)=>String(vars[k]))
        .replace(/([.\d]+)(vw|vh|px|%)/g,(_,v,u)=>String(+v*(u==='vw'||u==='%'?width/100:u==='vh'?height/100:1)))
        .replace(/calc\(/g,'(').replace(/min\(/g,'Math.min(');
      assert(/^[\d.\s,()+*/-]+$/.test(code.replace(/Math\.min/g,'')),code);
      return vm.runInNewContext(code);
    }
    const unit=vars['--button-unit']=pixels(prop('.touch','--button-unit'));
    const big=pixels(prop('#touchLayer [data-action=fire]','width'));
    const grid=2*unit+big+8;
    const left=pixels(prop('.touch #slots','left')), right=pixels(prop('.touch #slots','right'));
    const slots=pixels(prop('.touch #slots','max-width'));
    assert(width-left-right>=slots-.01 && slots>=160);
    assert(right>=grid+vars['--right']+4);
    assert(height-grid-vars['--bottom']>=36+5+8);
    assert(left>vars['--left']+132);
  }
}
console.log('24 calculated control layouts passed at four viewports, three scales and two safe-area settings');

function mapChecks() {
  const M = G.Map, dt = 1 / 30, runSpeed = W.defs.ar7.speed;
  function runRoute(from, stops) {
    const runner = game.makeAgent('atk', '路线测试', false);
    runner.pos.copy(from);
    let elapsed = 0;
    for (const stop of stops) {
      assert(M.walkable(M.colOf(stop.x), M.rowOf(stop.z)));
      const path = M.findPath(runner.pos, stop);
      assert(path && path[path.length - 1].distanceTo(stop) < .01, 'Missing route to ' + stop.toArray());
      for (const p of path.slice(1)) {
        for (let ticks = 0; G.dist2D(runner.pos, p) > .32; ticks++) {
          assert(ticks < 1200, 'Blocked route at ' + runner.pos.toArray() + ' toward ' + p.toArray());
          const dx = p.x - runner.pos.x, dz = p.z - runner.pos.z, d = Math.hypot(dx, dz);
          G.Phys.step(runner, dx / d, dz / d, runSpeed, false, dt);
          elapsed += dt;
        }
      }
      // Let the ground settle before checking the final elevation.
      for (let i = 0; i < 8 && Math.abs(runner.pos.y - stop.y) > .08; i++) G.Phys.step(runner, 0, 0, 0, false, dt);
      assert(Math.abs(runner.pos.y - stop.y) <= .08, 'Wrong floor at ' + runner.pos.toArray());
    }
    return elapsed;
  }
  const gate = M.cellPos(24, 15);
  assert(!M.walkable(25, 15));
  assert(!M.raycast(gate.x, 1.62, gate.z + 3, 0, 0, -1, 6));
  assert.equal(M.raycast(gate.x - .62, 1.62, gate.z + 3, 0, 0, -1, 6).box.kind, 'gateBoard');
  runRoute(M.cellPos(24, 18), [M.cellPos(24, 13)]);
  runRoute(M.cellPos(24, 22), [M.cellPos(19, 20), M.cellPos(18, 19), M.cellPos(15, 18)]);
  assert(M.clearLine(V(-15, 1.65, -11), V(-19, 1.65, -11)));
  assert.equal(M.raycast(-15, .8, -11, -1, 0, 0, 5).box.kind, 'windowSill');
  const terrace = M.cellPos(38, 9);
  assert.equal(terrace.y, 1.6);
  assert.equal(M.raycast(terrace.x, 4, terrace.z, 0, -1, 0, 5).y, 1.6);
  runRoute(M.sites.A.center, [terrace, M.cellPos(44, 8)]);
  runRoute(V(32.65, 0, 7.8001), [M.cellPos(43, 21)]);
  const createElement = document.createElement, radarColors = new Map();
  const ctx = { fillRect(x, y, w, h) { if (w === 5 && h === 5) radarColors.set(x + ',' + y, this.fillStyle); },
    strokeRect: noop, fillText: noop };
  try {
    document.createElement = () => ({ getContext: () => ctx });
    const radar = M.buildRadar();
    assert.equal(radar.width, M.W * 5);
    const stairs = [8, 10, 11, 13].map(r => radarColors.get(38 * 5 + ',' + r * 5));
    assert(stairs.every(Boolean) && new Set(stairs).size === 4, 'Radar shades for all four raised levels');
    assert(radarColors.has('120,75') && !radarColors.has('125,75'), 'Single-cell gate on radar');
  } finally {
    document.createElement = createElement;
  }
  const times = {};
  for (const site of ['A', 'B']) {
    const atk = M.routes[site].map(route => runRoute(M.spawns.atk[2], [...route, M.sites[site].center]));
    const def = M.holds.filter(h => h.site === site).map(h => runRoute(M.spawns.def[2], [h.pos]));
    times[site] = { atk: atk.map(t => +t.toFixed(1)), def: def.map(t => +t.toFixed(1)) };
    assert(atk.every(t => t >= 17.5 && t <= 24.5), 'Attacker timing ' + JSON.stringify(times));
    assert(def.every(t => t >= 7.5 && t <= 12.5), 'Defender timing ' + JSON.stringify(times));
  }
  const rotation = runRoute(M.sites.A.center, [M.sites.B.center]);
  console.log('Run times at ' + runSpeed + ' m/s:', JSON.stringify(times), 'A–B rotation', rotation.toFixed(1) + 's');
}

function botRoundChecks() {
  const M = G.Map, dt = 1 / 30, rounds = 12;
  const random = Math.random, physics = G.Phys.step, findPath = M.findPath;
  const visits = { atk: new Set(), def: new Set() }, plants = { A: 0, B: 0 }, stuck = [];
  const progress = new Map();
  const failedPaths = new Set();
  M.findPath = function (from, to) {
    const path = findPath(from, to);
    if (!path) failedPaths.add(from);
    return path;
  };
  G.Phys.step = function (a, x, z, speed, jump, elapsed) {
    physics(a, x, z, speed, jump, elapsed);
    if (game.phase !== 'live') return;
    let p = progress.get(a);
    if (!p) progress.set(a, p = { pos: a.pos.clone(), lastMove: G.time, duration: 0 });
    if (G.dist2D(a.pos, p.pos) >= .85 || G.time - p.lastMove > 1) {
      p.pos.copy(a.pos); p.duration = 0;
    }
    // Standing guard, using the bomb and pausing during a fight are intentional.
    if (!failedPaths.delete(a.pos) && (speed <= 0 || !a.ai.path || a.ai.pathIdx >= a.ai.path.length)) return;
    p.lastMove = G.time;
    p.duration += elapsed;
    if (p.duration > 8 && p.duration <= 8 + elapsed) {
      stuck.push({ round: game.round, name: a.name, team: a.team, pos: a.pos.toArray(), goal: a.ai.goal.toArray(),
        cell: [M.colOf(a.pos.x), M.rowOf(a.pos.z)] });
    }
  };
  try {
    Math.random = G.seeded(217);
    game.start('atk', 1);
    G.Player.agent.isPlayer = false;
    G.Player.agent.isBot = true;
    G.Bots.newRound();
    for (let round = 1; round <= rounds; round++) {
      progress.clear();
      failedPaths.clear();
      let planted = false;
      for (let tick = 0; game.phase !== 'end' && tick < 6000; tick++) {
        G.time += dt;
        game.update(dt); G.Bots.update(dt); G.FX.update(dt);
        if (game.phase !== 'live') continue;
        for (const a of game.agents) {
          if (!a.alive) continue;
          const site = M.siteAt(a.pos.x, a.pos.z);
          if (site) visits[a.team].add(site);
        }
        if (game.bomb.state === 'planted' && !planted) {
          plants[game.bomb.site]++;
          planted = true;
        }
      }
      assert.equal(game.phase, 'end', 'Bot round ' + round + ' did not finish');
      if (round < rounds) {
        game.over = null;
        game.newRound();
      }
    }
  } finally {
    Math.random = random;
    G.Phys.step = physics;
    M.findPath = findPath;
  }
  if (stuck.length) console.error('Bot movement blocked for >8s:', JSON.stringify(stuck));
  assert.deepEqual(stuck, []);
  for (const team of ['atk', 'def']) assert.deepEqual(visits[team], new Set(['A', 'B']));
  assert(plants.A > 0 && plants.B > 0, 'Expected plants at both sites: ' + JSON.stringify(plants));
  console.log(rounds + ' full 5v5 bot rounds:', plants, 'plants, both teams reached both sites, no stalls >8s');
}

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
  await G.boot();
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
  if (game.bomb.carrier) game.bomb.carrier.inv.bomb=false;
  game.bomb.state='planted'; game.bomb.carrier=null;
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
mapChecks();
botRoundChecks();
captureChecks().catch(err=>{console.error(err);process.exitCode=1;});

