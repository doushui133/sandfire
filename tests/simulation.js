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
const audioSettings = Array.from(html.matchAll(/<input type="range" id="([^"]+)" data-setting="(vol|musicVol)"/g), m => {
  const el = elem(m[1]);
  el.type = 'range';
  el.dataset.setting = m[2];
  return el;
});
const win=new Element(), document=Object.assign(new Element(),{
  getElementById:elem, createElement:()=>new Element(), body:new Element(),documentElement:new Element(),hidden:false,
  querySelectorAll(selector) {
    if (selector === '[data-setting]') return audioSettings;
    if (selector === '[data-setting="musicVol"]') return audioSettings.filter(el => el.dataset.setting === 'musicVol');
    return Element.prototype.querySelectorAll.call(this, selector);
  }
});
elem('stick').firstElementChild=new Element();
Object.assign(global,{window:global, top:global, document, innerWidth:740,innerHeight:360,history:{},
  localStorage:{getItem:()=>null,setItem:noop}, addEventListener:win.addEventListener.bind(win),
  requestAnimationFrame:noop, matchMedia:()=>({matches:false,addEventListener:noop}),
  setTimeout:noop, clearTimeout:noop, THREE:require('../vendor/three.min.js')});
Object.defineProperty(global,'navigator',{value:{userAgent:'simulation'},configurable:true});
function load(name) { vm.runInThisContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),{filename:name+'.js'}); }
for (const id of ['look','core','audio','music','touch','map','mapgeo','gfx','video','geom','gunmodels','fx','weapons','nades','viewmodel','player','bots','game','hud','main']) load(id);
const G=global.G, W=G.Weapons, N=G.Nades, game=G.Game;
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
// The baked lightmap must match the map geometry, and the atlas packing must not depend on floating-point
// noise (Math.hypot differs between JS engines: a one-ulp change once shifted the whole atlas in browsers).
{
  const meta=JSON.parse(fs.readFileSync(path.join(root,'assets','lightmap.json'),'utf8'));
  const hypot=Math.hypot;
  const exact=G.MapGeo.build();
  Math.hypot=(...a)=>hypot(...a)*(1+4e-16);
  let noisy;
  try { noisy=G.MapGeo.build(); } finally { Math.hypot=hypot; }
  assert.equal(noisy.checksum,exact.checksum,'atlas packing depends on Math.hypot rounding');
  assert.equal(exact.checksum,meta.checksum,'assets/lightmap.* is stale: run node tools/bake.js . vendor/three.min.js');
  assert(exact.atlasW===meta.w && exact.atlasH===meta.h);
  console.log('Lightmap matches the map geometry, packing independent of floating-point noise');
}
Math.random=G.seeded(20261122);
const gestures=[];
G.BotModel={create:noop,remove:noop,update:noop,updateBlobs:noop,ragdollPoint:()=>null,
  gesture:(a,kind)=>gestures.push([a,kind])};
G.scene=new THREE.Scene(); G.camera=new THREE.PerspectiveCamera(); G.sunDir=G.Gfx.U.uSunDir.value;
const tex=new THREE.Texture();
G.Tex={tex:()=>tex,gunDetail:()=>tex,detail:()=>tex};

function musicChecks() {
  class Param {
    constructor() { this.value = 0; this.events = []; }
    add(type, value, time) {
      assert(Number.isFinite(value) && Number.isFinite(time) && time >= 0);
      this.events.push([type, value, time]);
    }
    setValueAtTime(value, time) { this.add('set', value, time); }
    linearRampToValueAtTime(value, time) { this.add('linear', value, time); }
    exponentialRampToValueAtTime(value, time) {
      assert(value > 0);
      this.add('exponential', value, time);
    }
    setTargetAtTime(value, time) { this.add('target', value, time); }
    cancelScheduledValues(time) { this.events = this.events.filter(event => event[2] < time); }
  }
  class AudioContext {
    constructor() {
      this.currentTime = 4;
      this.state = 'suspended';
      this.sampleRate = 48000;
      this.nodes = [];
      this.buffers = [];
    }
    node(params = []) {
      const node = { connect: noop, disconnect() { this.disconnected = true; } };
      for (const key of params) node[key] = new Param();
      this.nodes.push(node);
      return node;
    }
    source(params) {
      return Object.assign(this.node(params), {
        start(time) { this.started = time; },
        stop(time) { assert(Number.isFinite(time)); this.stopped = time; }
      });
    }
    createGain() { return this.node(['gain']); }
    createOscillator() { return this.source(['frequency', 'detune']); }
    createBufferSource() { return this.source(); }
    createBiquadFilter() { return this.node(['frequency', 'Q']); }
    createWaveShaper() { return this.node(); }
    createBuffer(channels, length) {
      assert.equal(channels, 1);
      const data = new Float32Array(length);
      const buffer = { getChannelData: () => data };
      this.buffers.push(buffer);
      return buffer;
    }
    advanceTo(time) {
      assert.equal(this.state, 'running');
      this.currentTime = time;
      for (const node of this.nodes) if (node.onended && node.stopped <= time) node.onended();
    }
  }

  const music = G.Music, audio = G.Audio;
  const originalSave = G.saveSettings;
  const names = ['roundStart', 'bombTicking', 'win', 'lose', 'mvp', 'clutch', 'practiceStart'];
  assert.equal(G.settings.musicVol, .6);
  assert.equal(audioSettings.filter(el => el.dataset.setting === 'musicVol').length, 2);
  for (const name of names) assert.equal(music.cue(name), null);
  music.stopAll();
  music.setVolume(.35);
  assert.equal(G.settings.musicVol, .35);

  const ctx = audio.ctx = new AudioContext();
  const bus = audio.musicBus = ctx.createGain();
  bus.gain.value = G.settings.musicVol;
  function cue(name, opts) {
    const first = ctx.nodes.length;
    const handle = music.cue(name, opts);
    assert.equal(typeof handle.stop, 'function');
    const nodes = ctx.nodes.slice(first);
    const sources = nodes.filter(node => 'started' in node);
    assert(sources.length > 0 && sources.every(node => node.started >= ctx.currentTime &&
      node.started === sources[0].started));
    return { handle, nodes, sources, gain: nodes[0].gain };
  }
  function ends(playing, time) {
    assert(playing.sources.every(node => Math.abs(node.stopped - time) < 1e-9));
  }

  try {
    const bounds = { roundStart: [6, 8], win: [3, 4], lose: [3, 4], mvp: [5, 7], practiceStart: [4, 5] };
    for (const name of Object.keys(bounds)) {
      const playing = cue(name);
      const duration = playing.sources[0].stopped - playing.sources[0].started;
      assert(duration >= bounds[name][0] && duration <= bounds[name][1], name);
      ends(playing, playing.sources[0].started + duration);
    }
    assert.equal(ctx.buffers.length, 1, 'finite cues share a noise buffer');
    const defaultBomb = cue('bombTicking');
    ends(defaultBomb, 14);
    const bomb = cue('bombTicking', { seconds: 2.375 });
    ends(defaultBomb, 4.08);
    ends(bomb, 6.375);
    ends(bomb, bomb.sources[0].started + 2.375);
    const shortBomb = cue('bombTicking', { seconds: .045 });
    ends(bomb, 4.08);
    ends(shortBomb, 4.045);
    assert.equal(music.cue('unknown'), null);

    let clutch = cue('clutch');
    assert(clutch.sources.every(source => source.stopped === undefined));
    const fadeInStart = clutch.sources[0].started;
    assert.deepEqual(clutch.gain.events.at(-1), ['linear', 1, fadeInStart + 1]);
    assert.equal(clutch.sources.filter(source => source.loop).length, 3);
    ctx.state = 'running';
    ctx.advanceTo(fadeInStart + .25);
    assert(defaultBomb.nodes.every(node => node.disconnected));
    clutch.handle.stop(.4);
    const fadeEnd = ctx.currentTime + .4;
    assert.deepEqual(clutch.gain.events.slice(-2), [['set', .25, ctx.currentTime], ['linear', 0, fadeEnd]]);
    clutch.handle.stop(.8);
    ends(clutch, fadeEnd);
    ctx.advanceTo(fadeEnd);
    assert(clutch.nodes.every(node => node.disconnected));

    for (const name of ['win', 'lose', 'mvp']) {
      clutch = cue('clutch');
      const ticking = cue('bombTicking');
      clutch.handle.stop(1);
      cue(name);
      ends(clutch, ctx.currentTime + .08);
      ends(ticking, ctx.currentTime + .08);
    }
    assert.equal(ctx.buffers.length, 3, 'clutch reuses its cached loop buffers');
    const cancelled = cue('practiceStart');
    cancelled.handle.stop(0);
    assert(cancelled.sources.every(node => node.stopped < node.started));
    const start = cue('roundStart');
    clutch = cue('clutch');
    music.stopAll(.2);
    const deadline = ctx.currentTime + .2;
    ends(start, deadline);
    ends(clutch, deadline);
    ctx.advanceTo(deadline);
    assert(ctx.nodes.slice(1).every(node => node.disconnected), 'all stopped graphs disconnect');

    const sliders = [elem('musicVol'), elem('musicVol2')];
    let saved;
    G.saveSettings = () => { saved = G.settings.musicVol; };
    sliders[0].value = '0.25';
    sliders[0].emit('input');
    assert.equal(sliders[1].value, .25);
    assert.equal(saved, .25);
    sliders[1].value = '0.75';
    sliders[1].emit('input');
    assert.equal(sliders[0].value, .75);
    assert.equal(saved, .75);
    assert.deepEqual(bus.gain.events.at(-1), ['target', .75, deadline]);
    music.setVolume(2);
    assert.deepEqual(bus.gain.events.at(-1), ['target', 1, deadline]);
    music.setVolume(-1);
    assert.deepEqual(bus.gain.events.at(-1), ['target', 0, deadline]);
  } finally {
    delete audio.ctx;
    delete audio.musicBus;
    G.saveSettings = originalSave;
    for (const name of ['musicVol', 'musicVol2']) elem(name).value = .6;
    music.setVolume(.6);
  }
  console.log('Music cue scheduling, countdown deadlines, fades, cleanup and volume controls passed');
}

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

function movementMetrics(hz) {
  const a = game.makeAgent('atk', '移动测试', true);
  const rifle = a.inv.primary = W.item('ar7');
  a.cur = 'primary';
  const top = W.maxSpeed(a), dt = 1 / hz;
  const speed = () => Math.hypot(a.vel.x, a.vel.z);
  const until = (step, done) => {
    for (let i = 1; i <= hz; i++) {
      step();
      if (done()) return i * dt;
    }
    assert.fail('movement never reached the expected speed');
  };
  // CS:GO-style: full speed is approached (95% counts), a counter-strafe carries the velocity through zero.
  const full = until(() => G.Phys.step(a, 1, 0, top, false, dt), () => speed() >= 0.95 * top);
  for (let i = 0; i < hz; i++) G.Phys.step(a, 1, 0, top, false, dt);
  assert(Math.abs(speed() - top) < 1e-6, 'held key settles exactly at the weapon speed');
  const release = until(() => G.Phys.step(a, 0, 0, 0, false, dt), () => speed() === 0);
  a.vel.x = top;
  let accurateAt = 0, firstSpread;
  const reverse = () => G.Phys.step(a, -1, 0, top, false, dt);
  const counter = until(() => {
    reverse();
    if (firstSpread === undefined) {
      accurateAt += dt;
      if (speed() <= 0.3 * top + 1e-9) firstSpread = W.spread(a, rifle);
    }
  }, () => a.vel.x <= 0);
  assert.equal(firstSpread, rifle.def.inacc.stand);
  const turned = until(reverse, () => a.vel.x <= -0.95 * top);
  return { full, release, counter, accurateAt, firstSpread, turn: counter + turned };
}

function combatChecks() {
  const saved = { query: G.Map.query, ray: G.Map.raycast, fx: G.FX, time: G.time,
    agents: game.agents, damage: game.damage, random: Math.random };
  try {
    G.Map.query = () => [];
    G.Map.raycast = () => null;
    G.FX = { muzzle: noop, blood: noop, impact: noop, tracer: noop };
    for (const hz of [30, 60, 120]) {
      const row = movementMetrics(hz);
      // CS:GO reference (sv_accelerate 5.5, sv_friction 5.2, sv_stopspeed 80): ~0.45 s to 95% speed,
      // ~0.38 s released stop, ~0.13 s counter-strafe, ~0.6 s full left to full right
      assert(row.full >= 0.38 && row.full <= 0.52, 'run acceleration ' + row.full);
      assert(row.release >= 0.33 && row.release <= 0.43, 'key release stop ' + row.release);
      assert(row.counter >= 0.10 && row.counter <= 0.16, 'counter-strafe stop ' + row.counter);
      assert(row.turn >= 0.5 && row.turn <= 0.75, 'full reverse ' + row.turn);
      assert(row.counter < row.release / 2);
      if (hz === 60) {
        console.log('AR-7 at 60 Hz:', row.full.toFixed(3) + 's to 95% run,', row.release.toFixed(3) + 's release,',
          row.counter.toFixed(3) + 's counter-strafe,', row.turn.toFixed(3) + 's full reverse,', row.firstSpread.toFixed(4) +
          'rad first-shot cone at', row.accurateAt.toFixed(3) + 's into braking');
      }
    }

    function spray(id, distance, compensated) {
      G.time = 0;
      Math.random = G.seeded(7342);
      const a = game.makeAgent('atk', '扫射测试', false), target = game.makeAgent('def', '靶标', true);
      const it = a.inv.primary = W.item(id), groups = [];
      a.cur = 'primary';
      const centre = Math.atan2(1.165 - G.eyeHeight(0), distance);
      a.pitch = centre;
      target.alive = true; target.armor = 0; target.pos.z = -distance;
      game.agents = [a, target];
      let group;
      game.damage = (v, s, dmg, info) => { group = info.head ? 'head' : info.legs ? 'legs' : 'body'; };
      const dt = 1 / 120, ctl = { fire: true };
      for (let tick = 1; groups.length < 15 && tick <= 300; tick++) {
        G.time = tick * dt;
        if (compensated) {
          a.pitch = centre - a.recoilP;
          a.yaw = -a.recoilY;
        }
        group = null;
        W.update(a, dt, ctl);
        if (a.lastShot === G.time) groups.push(group);
      }
      assert.equal(groups.length, 15);
      const lastShot = a.lastShot;
      for (let tick = 1; tick <= 60; tick++) {
        G.time = lastShot + tick * dt;
        W.update(a, dt, {});
      }
      assert.equal(a.shots, 0);
      assert.equal(Math.hypot(a.recoilP, a.recoilY), 0);
      return groups;
    }

    for (const id of ['ar7', 'tr4', 'fa2']) {
      for (const distance of [15, 18, 20]) {
        const raw = spray(id, distance, false), controlled = spray(id, distance, true);
        assert.equal(raw[0], 'body');
        const miss = raw.indexOf(null) + 1, chestHits = controlled.filter(group => group === 'body').length;
        assert(miss >= 5 && miss <= 8, id + ' first uncompensated miss at ' + distance + 'm: shot ' + miss);
        assert(raw.slice(8).every(group => group === null), id + ' sustained spray should leave the target');
        assert(chestHits >= 12, id + ' compensated chest hits at ' + distance + 'm: ' + chestHits);
        if (id === 'ar7' && distance === 18) {
          console.log('AR-7 at 18m: first uncompensated miss on shot', miss + ',', chestHits + '/15 compensated chest hits');
        }
      }
    }
  } finally {
    G.Map.query = saved.query; G.Map.raycast = saved.ray; G.FX = saved.fx; G.time = saved.time;
    game.agents = saved.agents; game.damage = saved.damage; Math.random = saved.random;
  }
}

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
function crosshairChecks() {
  G.startMatch('atk',true);
  const a = G.Player.agent, it = a.inv.primary = W.item('ar7');
  const slot = a.cur, height = innerHeight, dot = G.settings.chDot;
  a.cur = 'primary';
  const dt = 1 / 60;
  const gap = () => parseFloat(elem('chR').style.left);
  innerHeight = 1080;
  G.HUD.update(dt);
  const standing = gap();
  assert.equal(standing, 4);
  assert.equal(elem('chR').style.width, '6px');
  assert.equal(elem('chR').style.height, '2px');
  a.inacc = it.def.inacc.shot;
  G.HUD.update(dt);
  assert(gap() > standing, 'a shot should briefly expand the gap');
  a.inacc = 0;
  for (let i = 0; i < 40; i++) G.HUD.update(dt);
  assert.equal(gap(), standing);
  a.vel.x = it.def.speed * 0.52;
  G.HUD.update(dt);
  assert(gap() > standing && gap() < 7, 'gap should settle over several frames');
  for (let i = 0; i < 40; i++) G.HUD.update(dt);
  const walking = gap();
  assert(walking > 10 && walking < 16);
  a.vel.x = it.def.speed;
  for (let i = 0; i < 40; i++) G.HUD.update(dt);
  const running = gap();
  assert.equal(running, 24);
  G.settings.chStatic = true;
  G.settings.chDot = false;
  G.HUD.update(dt);
  assert.equal(gap(), 4);
  assert(elem('chDot').hidden);
  innerHeight = 360;
  G.HUD.update(dt);
  assert.equal(elem('chR').style.width, '2px');
  assert.equal(gap(), 1.25);
  G.settings.chStatic = false; G.settings.chDot = dot;
  innerHeight = height;
  a.vel.x = 0; a.cur = slot; a.inv.primary = null;
  console.log('AR-7 crosshair at 1080p:', standing + 'px standing,', walking + 'px walking,', running + 'px running');
}

function touchBrakeChecks() {
  const p = G.Player.agent, touch = G.Touch, dt = 1 / 60;
  const saved = { x: touch.joystick.x, y: touch.joystick.y, enabled: touch.enabled, time: G.time,
    frozen: game.frozen, brake: G.settings.touchBrake, assist: G.settings.aimAssist, query: G.Map.query };
  try {
    assert.equal(G.settings.touchBrake, true);
    G.Map.query = () => [];
    touch.enabled = true; game.frozen = false;
    G.settings.aimAssist = false;
    touch.joystick.y = 0;
    G.input.releaseAll(); G.input.endFrame();
    for (const brake of [true, false]) {
      G.settings.touchBrake = brake;
      const step = () => { G.time += dt; G.Player.update(dt); };
      touch.joystick.x = 1;
      for (let i = 0; i < 45; i++) step();   // CS:GO acceleration settles at full speed after ~0.56 s
      const speed = Math.hypot(p.vel.x, p.vel.z), top = W.maxSpeed(p);
      assert(Math.abs(speed - top) < 1e-6, 'touch run speed ' + speed + ' m/s, expected ' + top);
      touch.joystick.x = 0;
      for (let i = 0; i < 9; i++) step();    // the centre brake is a counter-strafe (~0.12 s)
      assert.equal(Math.hypot(p.vel.x, p.vel.z) === 0, brake);
      for (let i = 0; i < 20; i++) step();   // a plain release coasts to a stop in ~0.38 s
      assert.equal(Math.hypot(p.vel.x, p.vel.z), 0);
    }
    console.log('Touch stick centre braking and setting override passed');
  } finally {
    touch.joystick.x = saved.x; touch.joystick.y = saved.y; touch.enabled = saved.enabled;
    G.time = saved.time; game.frozen = saved.frozen; G.settings.touchBrake = saved.brake;
    G.settings.aimAssist = saved.assist;
    G.Map.query = saved.query;
  }
}
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
const realPickupTarget=W.pickupTarget; W.pickupTarget=()=>W.item('p10'); G.Touch.sync();
assert(actionButton('use').classList.contains('available') && actionButton('use')['aria-label']==='拾取'+W.defs.p10.name);
W.pickupTarget=()=>null; G.Touch.sync(); assert(!actionButton('use').classList.contains('available')); W.pickupTarget=realPickupTarget;
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

ally.alive=false; me.pos.set(35,0,40); foe.pos.set(35.3,0,30); me.yaw=0; me.pitch=0;
G.Touch.realTouch=true;
G.Touch.joystick.x=.3; G.input.dx=G.input.dy=0;
G.Player.touchLook(me,.03,.002); assert(me.yaw<0 && Math.hypot(me.yaw,me.pitch)<=.03*Math.PI/30+.000001);
me.yaw=me.pitch=0; G.Touch.realTouch=false; G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
G.Touch.realTouch=true; at('smoke',V(35,.1,35)); tick(1.2); G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,0);
N.clear(); me.pos.set(cover.x-2,0,cover.z); foe.pos.set(cover.x+2,0,cover.z+.11); me.yaw=-Math.PI/2;
G.Player.touchLook(me,.03,.002); assert.equal(me.yaw,-Math.PI/2);
console.log('Aim assist speed bound, mouse exclusion, wall and smoke occlusion passed');

field(); G.input.releaseAll(); G.input.endFrame(); me.nades={}; me.inv.grenade=null;
assert.equal(G.debugGive('flash',3),2); assert.equal(G.debugGive('smoke',1),1); assert.equal(G.debugGive('he',2),1);
assert.equal(G.debugGive('molotov',1),0); assert.equal(W.grenadeCount(me),4);
assert.deepEqual(W.grenadeList(me), [
  {id:'he',count:1,name:'高爆手雷'}, {id:'flash',count:2,name:'闪光弹'}, {id:'smoke',count:1,name:'烟雾弹'},
]);
assert(!W.selectGrenade(me,'molotov')); assert.equal(me.inv.grenade.id,'he');
W.switchTo(me,'pistol'); assert(W.selectGrenade(me,'flash'));
assert.equal(me.cur,'grenade'); assert.equal(me.inv.grenade.id,'flash');
const selected=me.inv.grenade.id; W.switchTo(me,'grenade'); assert.notEqual(me.inv.grenade.id,selected);
me.switchEnd=0; const item=me.inv.grenade.id;
W.update(me,.01,{fire:true,firePressed:true}); assert(me.primed);
W.update(me,.01,{}); assert.equal(N.flying[0].id,item); assert.equal(W.grenadeCount(me),3);
assert(Math.abs(N.flying[0].vel.length()-18*.45)<1e-8);
console.log('Grenade list, direct selection, carry caps, slot cycling and quick throw passed');

function playerStep(sec=1/60) {
  G.time+=sec; G.Player.update(sec); G.input.endFrame();
}
field(); G.Touch.enabled=false; G.input.releaseAll(); G.input.endFrame();
me.nades={}; me.inv.grenade=null; W.addGrenade(me,'he'); W.addGrenade(me,'flash'); W.addGrenade(me,'incendiary');
const savedNow=G.now;
G.now=()=>G.time*1000;
try {
  win.emit('keydown',{code:'Digit4'}); playerStep(); assert.equal(me.cur,'pistol');
  win.emit('keyup',{code:'Digit4'}); playerStep(); assert.equal(me.inv.grenade.id,'he');
  win.emit('keydown',{code:'Digit9'}); playerStep(); assert.equal(me.inv.grenade.id,'incendiary');
  win.emit('keydown',{code:'Digit8'}); playerStep(); assert.equal(me.inv.grenade.id,'incendiary');
  win.emit('mousemove',{clientX:360,clientY:180});
  win.emit('keydown',{code:'Digit4'}); playerStep();
  playerStep(.24); assert(!N.wheel.open);
  playerStep(.02); assert(N.wheel.open);
  assert.deepEqual(N.wheel.options.map(o=>o.id),['he','flash','incendiary']);
  win.emit('mousemove',{clientX:425,clientY:215}); win.emit('keyup',{code:'Digit4'});
  playerStep(); assert(!N.wheel.open); assert.equal(me.inv.grenade.id,'flash');
  G.input.locked=true;
  win.emit('keydown',{code:'Digit4'}); playerStep(); playerStep(.26);
  const yaw=me.yaw;
  G.input.dx=-60; G.input.dy=30; playerStep();
  assert.equal(me.yaw,yaw); assert.equal(N.wheel.index,2);
  win.emit('keyup',{code:'Digit4'}); playerStep(); assert.equal(me.inv.grenade.id,'incendiary');
} finally { G.now=savedNow; G.input.locked=false; G.input.releaseAll(); G.input.endFrame(); }
console.log('Desktop grenade keys and radial selection with locked and unlocked mouse passed');

field(); me.nades={}; me.inv.grenade=null; W.addGrenade(me,'flash');
assert(W.selectGrenade(me,'flash'));
W.update(me,.01,{fire:true,firePressed:true}); G.time+=.15;
W.update(me,.01,{}); assert.equal(N.flying.length,0);
G.time=me.switchEnd+.001; W.update(me,.01,{});
assert.equal(N.flying.length,1); assert(Math.abs(N.flying[0].vel.length()-18*.45)<1e-8);

field(); me.nades={}; me.inv.grenade=null; W.addGrenade(me,'flash'); W.addGrenade(me,'flash');
assert(W.selectGrenade(me,'flash'));
W.update(me,.01,{fire:true,firePressed:true}); G.time=me.switchEnd+.001;
W.update(me,.01,{fire:true}); assert(Math.abs(me.throwPower-.45)<1e-8);
const chargeStart=G.time, dots=G.scene.children.find(obj=>obj.isPoints && obj.material.color && obj.material.color.getHex()===0xffdf92);
assert(dots.visible); G.HUD.update(.01); assert(!elem('nadeCharge').hidden);
G.time=chargeStart+.325; W.update(me,.01,{fire:true});
assert(Math.abs(me.throwPower-.8625)<1e-8);
G.time=chargeStart+.65; W.update(me,.01,{fire:true});
assert.equal(me.throwPower,1);
W.update(me,.01,{}); assert(!dots.visible); assert(Math.abs(N.flying[0].vel.length()-18)<1e-8);
W.update(me,.01,{fire:true,firePressed:true}); assert(!me.primed);
G.time=me.throwReady+.001; W.update(me,.01,{fire:true}); assert(me.primed);
W.switchTo(me,'pistol'); assert(!dots.visible && !me.primed); assert.equal(N.flying.length,1);
console.log('Charge ramp, aim preview, switch timing, cooldown and switch cancellation passed');

field(); G.Touch.enabled=true; G.Touch.portrait=false; G.input.releaseAll(); G.input.endFrame();
me.nades={}; me.inv.grenade=null; G.debugGive('flash',2);
event('touchstart',[f],[f]); playerStep(); assert(me.pendingThrow && !me.primed);
event('touchcancel',[f],[]); playerStep(.61); assert(!me.pendingThrow && !N.flying.length);
event('touchstart',[f],[f]); playerStep(); assert(me.primed && dots.visible);
event('touchcancel',[f],[]); playerStep(); assert(!me.primed && !dots.visible); assert.equal(N.flying.length,0);
event('touchstart',[f],[f]); playerStep(.05);
event('touchend',[f],[]); playerStep(); assert.equal(N.flying.length,1);
G.time=me.throwReady+.01;
const lob=touch(13,630,170,actions.find(e=>e.dataset.action==='scope'));
event('touchstart',[f,lob],[f,lob]); playerStep(); assert.equal(me.primed,3);
event('touchend',[f],[lob]); playerStep(); assert.equal(N.flying.length,2); assert(me.throwLatch);
W.addGrenade(me,'smoke'); W.selectGrenade(me,'smoke');
G.time+=1; playerStep(); assert(!me.primed);
event('touchend',[lob],[]); playerStep(); assert.equal(N.flying.length,2);
G.HUD.update(.01); assert(elem('nadeCharge').hidden);
console.log('Touch release, touch cancellation and two-button release latch passed');

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
  G.time+=.66;
  W.update(me,.01,{});
  assert(Math.abs(N.flying[N.flying.length-1].vel.clone().sub(me.vel).length()-speed)<1e-8);
}
G.debugGive('he'); G.time+=1; W.update(me,.01,{fire:true});
assert(me.primed && dots.visible);
game.damage(me,foe,999,{weapon:'fa2'}); assert(!me.primed && !dots.visible);
assert(W.drops.some(d=>d.item.id==='he'));
console.log('Lob strengths, inherited movement and held-grenade death drop passed');

field(); W.clearDrops(); G.Touch.enabled=false;
const oldRifle=W.item('fa2'), enemyRifle=W.item('ar7');
oldRifle.clip=7; oldRifle.reserve=13; enemyRifle.clip=4; enemyRifle.reserve=28;
me.inv.primary=oldRifle; me.cur='primary'; me.yaw=me.pitch=0; me.inv.bomb=false;
foe.inv.primary=enemyRifle; foe.cur='primary'; foe.pos.set(0,0,37.5); foe.yaw=0;
W.drop(foe,'primary');
let dropped=W.drops[0];
assert(!W.pickupTarget(me)); const startY=dropped.mesh.position.y;
W.updateDrops(.08); assert(dropped.mesh.position.y>startY && dropped.mesh.rotation.z>0);
W.updateDrops(.6); assert(dropped.settled && dropped.mesh.parent===G.scene);
assert.equal(dropped.mesh.rotation.z,Math.PI/2);
assert(new THREE.Box3().setFromObject(dropped.mesh).min.y>=0);
me.yaw=Math.PI; assert(!W.pickupTarget(me)); me.yaw=0;
assert.deepEqual(W.pickupTarget(me),{item:enemyRifle,def:enemyRifle.def,mesh:dropped.mesh});
G.HUD.update(.01); assert.equal(elem('hint').textContent,'按 E 拾取 '+enemyRifle.def.name);
win.emit('keydown',{code:'KeyE'}); playerStep();
assert.equal(me.inv.primary,enemyRifle); assert.deepEqual([enemyRifle.clip,enemyRifle.reserve],[4,28]);
assert.equal(W.drops.length,1); assert.equal(W.drops[0].item,oldRifle);
assert.deepEqual([oldRifle.clip,oldRifle.reserve],[7,13]);
assert(!dropped.mesh.parent);
W.updateDrops(.7); playerStep(); assert.equal(me.inv.primary,enemyRifle);
win.emit('keyup',{code:'KeyE'}); playerStep();
me.inv.primary=null; me.cur='pistol';
assert(!W.tryPickup(me),'no automatic pickup of an item just dropped by the same player');
assert(W.tryPickup(foe)); assert.equal(foe.inv.primary,oldRifle);
assert.deepEqual([foe.inv.primary.clip,foe.inv.primary.reserve],[7,13]);

const step=G.Map.boxes.find(box=>box.kind==='step' || box.kind==='plat');
assert(step);
foe.pos.set((step.x0+step.x1)/2,step.y1,(step.z0+step.z1)/2);
W.drop(foe,'primary'); W.updateDrops(.7);
dropped=W.drops[0];
assert(dropped.settled && Math.abs(dropped.floor-step.y1)<1e-8);
assert(new THREE.Box3().setFromObject(dropped.mesh).min.y>=step.y1);
me.pos.set(dropped.mesh.position.x,step.y1,dropped.mesh.position.z);
assert(W.tryPickup(me)); assert.equal(me.inv.primary,oldRifle);

W.clearDrops(); me.pos.copy(G.Map.sites.A.center); me.onGround=true; me.inv.bomb=true; me.useHeld=false;
foe.pos.copy(me.pos); foe.inv.primary=enemyRifle;
W.drop(foe,'primary'); W.updateDrops(.7);
me.pos.x=W.drops[0].mesh.position.x; me.pos.z=W.drops[0].mesh.position.z;
assert.equal(game.bombUse(me),'A'); assert(!W.pickupTarget(me));
game.handleUse(me,true,.1,true); assert(me.planting && me.plantT===.1); assert.equal(me.inv.primary,oldRifle);
game.handleUse(me,false,.1); assert(!me.planting);
const savedBomb=game.bomb;
game.bomb={state:'planted',pos:me.pos.clone(),defuser:null};
foe.pos.copy(me.pos); foe.onGround=true; foe.useHeld=false;
assert.equal(game.bombUse(foe),'defuse'); assert(!W.pickupTarget(foe));
game.handleUse(foe,true,.1,true); assert(foe.defusing && foe.defuseT===.1);
game.handleUse(foe,false,.1); assert(!foe.defusing);
game.bomb=savedBomb;
me.inv.bomb=false; me.cur='primary'; G.Touch.enabled=true;
const useButton=touch(14,630,120,actions.find(e=>e.dataset.action==='use'));
event('touchstart',[useButton],[useButton]); event('touchcancel',[useButton],[]); playerStep();
assert.equal(me.inv.primary,oldRifle);
event('touchstart',[useButton],[useButton]); event('touchend',[useButton],[]); playerStep();
assert.equal(me.inv.primary,enemyRifle); W.clearDrops();
console.log('Pickup aim and hint, E swap with ammo, touch use tap, flat floor and step settling, automatic pickup and plant/defuse priority passed');

field(); G.Touch.enabled=false; me.money=16000; game.buyUntil=Infinity;
me.pos.copy(G.Map.spawns.atk[0]); G.HUD.toggleBuy(true);
const key=(n)=>win.emit('keydown',{key:String(n),code:'Digit'+n});
key(5); assert(elem('buymenu').innerHTML.includes('AR-7') && !elem('buymenu').innerHTML.includes('TR-4'));
key(1); assert.equal(me.inv.primary.id,'fa2');
key(0); key(7); assert(!elem('buymenu').innerHTML.includes('燃烧弹'));
key(2); assert((me.nades.flash||0)>0); G.onEscape(); assert(!G.HUD.buyOpen);
W.selectGrenade(me,'flash'); G.time=me.switchEnd+.01;
G.input.left=true; W.update(me,.01,{fire:true}); assert(dots.visible);
G.HUD.toggleBuy(true); assert(!me.primed && !dots.visible); G.HUD.toggleBuy(false);
W.update(me,.01,{fire:true}); assert(!me.primed);
G.input.left=false; W.update(me,.01,{}); assert.equal(N.flying.length,0);
console.log('Keyboard category/item buying, team restrictions and Esc close passed');

// Fire across a real wooden crate; optical targeting still stops at its surface.
field(); ally.alive=false; me.pos.copy(cover); me.pos.x-=2;
foe.pos.copy(cover); foe.pos.x+=2; foe.hp=1;
me.yaw=-Math.PI/2; me.pitch=Math.atan2(1.18-G.eyeHeight(0),4);
me.inv.primary=W.item('ar7'); me.cur='primary'; me.inacc=me.recoilP=me.recoilY=0;
const killEvents=[], hudKillFx=G.HUD.killFx;
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
G.HUD.killFx=hudKillFx;
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
    setPixelRatio(ratio) { this.ratio=ratio; }
    getPixelRatio() { return this.ratio; }
    render() { this.draws=(this.draws || 0)+1; }
  }
  for (const method of ['setSize','setClearColor','compile','clear','clearDepth','setRenderTarget','setViewport','setScissor','setScissorTest','dispose','initTexture']) Renderer.prototype[method]=noop;
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
  elem('btnQuit').emit('click');
  const ratio=G.renderer.getPixelRatio(), draws=G.renderer.draws;
  G.frame(0,0); G.frame(0,.1);
  assert.equal(G.renderer.draws,draws+1);
  assert(G.renderer.getPixelRatio()<ratio);
  let clock=10000, pointerCalls=0, fullCalls=0, keyCalls=0;
  const canvas=G.renderer.domElement, overlay=elem('pause'), rootEl=document.documentElement;
  G.now=()=>clock; G.settings.fullscreen=true; G.embedded=false;
  canvas.requestPointerLock=()=>{pointerCalls++; throw Error('test denial');};
  rootEl.requestFullscreen=()=>{fullCalls++; return Promise.reject(Error('windowed'));};
  G.startMatch('def'); assert(G.paused && !overlay.hidden && !G.input.freeLook);
  G.frame(0,.2); assert.equal(G.renderer.getPixelRatio(),ratio);
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
  const timers={set:global.setTimeout,clear:global.clearTimeout,now:G.now};
  let time=0, pending;
  global.setTimeout=(fn,delay)=>(pending={fn,time:time+delay});
  global.clearTimeout=id=>{ if (pending===id) pending=null; };
  G.now=()=>time;
  function nextTimer() {
    const tick=pending;
    pending=null; time=tick.time; tick.fn();
  }
  try {
    G.HUD.killFx({multi:1,wallbang:true});
    assert(elem('killBanner').className.includes('wallbang') && pending.time===1600);
    G.HUD.killFx({multi:2,knife:true});
    G.HUD.killFx({multi:5,ace:true,headshot:true});
    assert(pending.time===450 && elem('killBanner').className.includes('wallbang'));
    nextTimer(); nextTimer();
    assert(elem('killBanner').className.includes('knife') && elem('killPips').innerHTML.match(/<svg/g).length===2);
    nextTimer(); nextTimer();
    assert(elem('killBanner').className.includes('ace headshot') && elem('killPips').innerHTML.match(/<svg/g).length===5);
    nextTimer(); nextTimer(); assert(elem('killBanner').hidden);
  } finally {
    global.setTimeout=timers.set; global.clearTimeout=timers.clear; G.now=timers.now;
  }
  G.HUD.killFx=info=>kills.push(info); G.HUD.hitFx=info=>hits.push(info);
  const deathFx=G.HUD.deathFx;
  G.HUD.deathFx=info=>{ deaths.push(info); deathFx(info); };
  const roundEnd=G.HUD.roundEnd;
  G.HUD.roundEnd=(...args)=>{ banners.push(args); roundEnd(...args); };
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
  const impactFrom=G.camera.position.clone();
  game.damage(player,foes[0],200,{weapon:'fa2',head:true,dirx:1});
  assert.deepEqual(deaths.pop(),{killer:foes[0].name,weapon:'fa2',headshot:true,killerHp:foes[0].hp});
  advance(.05);
  assert(G.timeScale===.32 && G.camera.position.x>impactFrom.x && Math.abs(G.camera.rotation.z)>.1);
  assert(elem('deathCard').hidden && !elem('death').hidden);
  G.paused=true; advance(.3); assert.equal(G.timeScale,1);
  G.paused=false; advance(.85);
  assert(G.timeScale>.32 && G.timeScale<1 && !p.spectateTarget() && G.renderer.domElement.style.filter);
  assert(player.rig.rd && G.camera.position.distanceTo(impactFrom)>1 && elem('deathCard').hidden);
  advance(.65);
  const wide=G.camera.fov, killerMesh=foes[0].rig.mesh;
  assert(G.timeScale===1 && !elem('deathCard').hidden && killerMesh.children.some(o=>o.isSkinnedMesh));
  game.damage(foes[0],mate,200,{weapon:'p10'});
  advance(1.35);
  assert(foes[0].rig.rd && G.camera.fov<wide && !p.spectateTarget() && elem('deathCard').innerHTML.includes('剩余生命 0'));
  advance(.4);
  assert(p.spectateTarget() && G.camera.fov===74 && !G.renderer.domElement.style.filter && elem('deathCard').hidden);
  assert(!killerMesh.children.some(o=>o.isSkinnedMesh));
  game.newRound();
  const wall=G.Map.query(cover.x-.1,cover.z-.1,cover.x+.1,cover.z+.1).find(b=>b.y1>1);
  assert(wall);
  player.pos.set(wall.x0-.32,0,(wall.z0+wall.z1)/2);
  player.yaw=Math.PI/2-.65;
  advance(.05);
  game.damage(player,null,200,{weapon:'bomb'});
  for (let i=0;i<15;i++) {
    advance(.1);
    const {x,y,z}=G.camera.position;
    assert(!G.Map.query(x-.06,z-.06,x+.06,z+.06).some(b=>
      x+.06>b.x0 && x-.06<b.x1 && y+.06>b.y0 && y-.06<b.y1 && z+.06>b.z0 && z-.06<b.z1));
  }
  assert(!p.killer && !elem('deathCard').hidden && !p.spectateTarget());
  G.input.rightPressed=true; advance(.05);
  assert(p.spectateTarget() && G.timeScale===1 && elem('deathCard').hidden);
  game.newRound(); game.phase='end'; game.phaseT=.001; game.over='atk';
  game.damage(player,null,200,{weapon:'bomb'}); advance(.05);
  assert(game.phase==='over' && G.timeScale===1 && !G.renderer.domElement.style.filter);
  G.startMatch('atk',true);
  game.damage(p.agent,null,200,{weapon:'bomb'});
  elem('btnQuit').emit('click');
  assert(G.timeScale===1 && !p.orbit && !G.renderer.domElement.style.filter);
  G.HUD.roundEnd=roundEnd; G.HUD.update=hudUpdate;
  console.log('Kill tiers, HUD payloads, last-kill orbit, death impact and pullback, killer outline, bomb death, skip, pause and menu still frame passed');
}

function gameplayChecks() {
  const H = G.HUD, P = G.Player, M = G.Map, touch = G.Touch;
  function hit(victim, attacker, damage) {
    return game.damage(victim, attacker, damage, {weapon:'p10'});
  }
  G.startMatch('atk', true, 'competitive');
  const me = P.agent, mates = game.agents.filter(a => a.team === 'atk' && a !== me);
  const enemies = game.agents.filter(a => a.team === 'def');
  const [enemy, other] = enemies;
  const [mate, assist] = mates;
  const markers = () => elem('soundMarkers').children.filter(node => !node.hidden);
  game.phase = 'live'; game.frozen = false;
  me.pos.set(0, 0, 0); me.yaw = 0;
  enemy.pos.set(10, 0, 0);
  G.settings.soundMarkers = null; touch.enabled = false;
  G.Bots.hearShot(enemy); H.update(0); assert.equal(markers().length, 0);
  touch.enabled = true;
  G.Bots.hearShot(enemy); H.update(0);
  assert.equal(markers().length, 1);
  const marker = markers()[0];
  assert.equal(marker.style.transform, 'rotate(90deg)');
  assert.equal(marker.style.color, '#ff984e');
  enemy.pos.set(3, 0, 0);
  W.startReload(enemy, enemy.inv.pistol);
  H.update(0);
  assert.deepEqual(markers(), [marker]);
  assert.equal(marker.style.color, '#fff');
  me.yaw = -Math.PI / 2; H.update(0);
  assert.equal(marker.style.transform, 'rotate(0deg)');
  const alpha = marker.style.opacity;
  P.clock += 0.6; H.update(0);
  assert(marker.style.opacity < alpha && marker.style.opacity > 0);
  P.clock += 0.61; H.update(0); assert.equal(markers().length, 0);
  enemy.pos.set(80, 0, 0); G.Bots.hearShot(enemy);
  mate.pos.set(1, 0, 0); G.Bots.hearStep(mate);
  H.update(0); assert.equal(markers().length, 0);
  for (const owner of game.agents.filter(a => a !== me).slice(0, 7)) H.soundMarker({owner}, V(-3, 0, -3), 'bounce');
  H.update(0);
  assert.equal(markers().length, 6);
  assert(markers().every(node => node.style.color === '#ffe25c'));
  touch.enabled = false;

  hit(enemy, me, 25); hit(enemy, me, 42);
  hit(me, enemy, 20); hit(me, enemy, 30); hit(me, enemy, 20); hit(me, enemy, 200);
  assert.deepEqual(game.damageBetween(me, enemy), {damage:67, hits:2});
  assert.deepEqual(game.damageBetween(enemy, me), {damage:100, hits:4});
  H.deathStage('killer');
  assert(elem('deathCard').innerHTML.includes('你 → 对方 67 (2)'));
  assert(elem('deathCard').innerHTML.includes('对方 → 你 100 (4)'));
  game.newRound(); game.phase = 'live'; game.frozen = false;
  assert.equal(game.damageBetween(me, enemy), undefined);
  hit(enemy, me, 100);
  hit(other, assist, 90);
  hit(other, mate, 100);
  hit(enemies[2], me, 15); hit(enemies[3], assist, 40);
  for (const foe of enemies.slice(2)) hit(foe, mates[2], 100);
  game.update(0);
  assert(elem('roundMvp').innerHTML.includes(mates[2].name), 'kills outweigh damage');
  game.newRound(); game.phase = 'live'; game.frozen = false;
  hit(enemy, me, 100); hit(other, mate, 100);
  hit(enemies[2], me, 50);
  for (const foe of enemies.slice(2)) hit(foe, null, 100);
  game.update(0);
  assert(elem('roundMvp').classList.contains('mine'));
  assert(elem('roundMvp').innerHTML.includes('1 杀 · 150 伤害'), 'damage breaks a kill tie');
  H.update(3.01); assert(elem('roundMvp').hidden);
  game.newRound(); game.phase = 'live'; game.frozen = false;
  game.bomb.state = 'planted'; game.bomb.pos.copy(enemies[0].pos);
  game.handleUse(enemies[0], true, game.CFG.defuse);
  assert(elem('roundMvp').innerHTML.includes('拆除炸弹') && elem('roundMvp').innerHTML.includes(enemy.name));

  function checkSpawn(a) {
    const {x, y, z} = a.pos;
    assert(M.walkable(M.colOf(x), M.rowOf(z)));
    assert(!G.Phys.blocked(x, y + 0.01, z, G.bodyHeight(0) - 0.01));
    for (const foe of game.agents.filter(o => o.alive && o.team !== a.team)) {
      assert(G.dist2D(foe.pos, a.pos) >= 10);
      for (const height of [0.25, 0.9, G.eyeHeight(0)]) {
        assert(!M.clearLine(G.eyePos(foe), V(x, y + height, z)), 'spawn exposed to a living enemy');
      }
    }
  }
  elem('modePractice').checked = true;
  G.startMatch('atk', true);
  let p = P.agent, foe = game.agents.find(a => a.team === 'def');
  assert(game.agents.every(a => a.alive));
  assert.equal(game.alive('atk'), 5); assert.equal(game.alive('def'), 5);
  assert.equal(game.phase, 'live'); assert.equal(game.bomb.state, 'none'); assert.equal(game.timeLeft, 480);
  assert(!game.canBuy(p) && !game.bombUse(p) && !G.Bots.plan);
  for (const a of game.agents) checkSpawn(a);
  assert.equal(hit(p, foe, 200), null);
  assert.equal(p.hp, 100);
  G.input.pressed.Digit3 = true;
  game.update(0);
  assert.equal(p.practiceLoadout, 0);   // alive: 1-4 keep switching weapons
  assert(G.input.pressed.Digit3); delete G.input.pressed.Digit3;
  for (let i = 0; i < 2; i++) { G.input.pressed.KeyB = true; game.update(0); }
  assert.equal(p.practiceLoadout, 2);
  assert.equal(W.current(p).id, 'ar7');
  assert(!G.input.pressed.KeyB);
  const clip = W.current(p).clip;
  W.update(p, 0, {fire:true, firePressed:true});
  assert.equal(W.current(p).clip, clip - 1);
  assert(!game.spawnProtected(p));
  hit(p, foe, 200);
  assert(!p.alive && game.score.def === 1);
  assert.equal(W.drops.length, 0);
  game.update(1.99); assert(!p.alive);
  H.update(0); assert.equal(elem('practiceStatus').textContent, '1 秒后复活');
  game.update(.01);
  assert(p.alive && p.hp === 100);
  checkSpawn(p);
  assert.equal(W.current(p).id, 'r90');
  assert.deepEqual(p.nades, {he:1, flash:1});
  game.update(1.49); assert.equal(hit(p, foe, 200), null);
  game.update(.01); assert(!game.spawnProtected(p));
  touch.enabled = true;
  elem('practicePistol').emit('click');
  assert.equal(p.practiceLoadout, 3);
  assert.equal(W.current(p).id, 'r90');
  touch.enabled = false;
  hit(p, foe, 200);
  const line = M.clearLine;
  try {
    M.clearLine = () => true;
    game.update(2); assert(!p.alive, 'wait when every spawn is exposed');
  } finally { M.clearLine = line; }
  game.update(.21);
  assert(p.alive && W.current(p).id === 'h50');
  checkSpawn(p);

  const origins = game.agents.map(a => a.pos.clone());
  G.debugStep(15);
  assert(game.agents.filter((a, i) => a.isBot && a.pos.distanceTo(origins[i]) > 8).length >= 6);
  game.score.atk = 49;
  foe = game.agents.find(a => a.alive && a.team === 'def' && !game.spawnProtected(a));
  hit(foe, p, 200);
  assert.equal(game.score.atk, 50);
  assert.equal(game.over, 'atk'); assert.equal(game.phase, 'end');
  game.phaseT = 0;
  G.frame(1/60, 100);
  assert(game.phase === 'menu' && !P.agent && game.agents.length === 0 && elem('practicePick').hidden);
  assert.equal(game.bomb.state, 'none');
  G.startMatch('def', true, 'practice');
  game.score.atk = 4; game.score.def = 5;
  game.update(0, 479.99); assert.equal(game.phase, 'live');
  game.update(0, .02);
  assert(game.phase === 'end' && game.over === 'def' && game.timeLeft === 0);
  G.startMatch('atk', true, 'practice');
  game.update(0, 480); assert.equal(game.over, 'draw');
  elem('modePractice').checked = false;
  G.startMatch('def', true);
  assert(game.phase === 'freeze' && game.bomb.state === 'carried' && game.canBuy(P.agent));
  elem('btnQuit').emit('click');
  console.log('Sound marker direction, expiry and pool; safe practice respawns, protection, loadouts and scoring; round MVP and death damage summary passed');
}
function ragdollChecks() {
  const bm=G.BotModel, mapQuery=G.Map.query, time=G.time;
  const limbs=[[4,5,'lUarm'],[5,6,'lFarm'],[7,8,'lUarm'],[8,9,'lFarm'],
    [10,11,'lThigh'],[11,12,'lShin'],[13,14,'lThigh'],[14,15,'lShin']];
  const right=V(), up=V(), back=V(), cross=V();
  function checkMatrix(elements, label) {
    assert(elements.every(Number.isFinite), label+' finite matrix');
    right.fromArray(elements,0); up.fromArray(elements,4); back.fromArray(elements,8);
    for (const axis of [right,up,back]) assert(Math.abs(axis.lengthSq()-1)<1e-3, label+' unit axis');
    assert(Math.abs(right.dot(up))<1e-3 && Math.abs(up.dot(back))<1e-3 && Math.abs(back.dot(right))<1e-3,
      label+' orthogonal axes');
    assert(Math.abs(cross.crossVectors(right,up).dot(back)-1)<1e-3, label+' right-handed rotation');
  }

  function makeRagdoll(pose, weapon, head) {
    const a=game.makeAgent('atk','布娃娃测试',true);
    a.alive=true; a.inv.primary=W.item('ar7'); a.cur='primary';
    a.yaw=.37;
    a.crouch=pose==='crouched' ? 1 : 0;
    a.onGround=pose!=='mid-air';
    a.pos.set(2,a.onGround ? 0 : 1.35,3);
    if (pose==='running' || pose==='mid-air') a.vel.set(-1.7,a.onGround ? 0 : 2.8,-4.6);
    bm.create(a,false);
    a.rig.idleSeed=1;
    for (let i=0;i<12;i++) {
      G.time+=1/60;
      a.pos.addScaledVector(a.vel,1/60);
      bm.update(a,1/60);
    }
    a.deathInfo={weapon,head,dirx:Math.sin(a.yaw),diry:weapon==='bomb' ? .6 : 0,dirz:Math.cos(a.yaw)};
    bm.prepareDeath(a);
    a.alive=false; a.vel.set(0,0,0);
    bm.update(a,0);
    return a;
  }

  try {
    G.Map.query=()=>[];
    const a=makeRagdoll('standing','ar7',true);
    try {
      const { bones, rd }=a.rig;
      const turn=new THREE.Quaternion().setFromAxisAngle(V(.85,.25,.3).normalize(),2.21);
      const shift=V(.4,-.2,1.1);
      const expected=bones.map(b=>[b.position.clone().applyQuaternion(turn).add(shift),turn.clone().multiply(b.quaternion)]);
      const point=V();
      // A rigid tumble must preserve the relative twist of jacket and limb bones.
      for (const buffer of [rd.p,rd.prev]) {
        for (let i=0;i<buffer.length;i+=3) point.fromArray(buffer,i).applyQuaternion(turn).add(shift).toArray(buffer,i);
      }
      bm.update(a,0);
      bones.forEach((bone,i)=>{
        assert(bone.position.distanceTo(expected[i][0])<1e-6, 'rigid tumble joint '+i);
        assert(Math.abs(1-Math.abs(bone.quaternion.dot(expected[i][1])))<1e-6, 'rigid tumble bone roll '+i);
      });
    } finally { bm.remove(a); }

    for (const pose of ['standing','running','crouched','mid-air']) {
      for (const [weapon,head] of [['ar7',true],['ar7',false],['s8',false],['bomb',false]]) {
        const a=makeRagdoll(pose,weapon,head), {root,mesh,bones,P}=a.rig;
        const joints=bones.map(()=>V());
        const dt=[1/60,1/120,1/40];
        try {
          // Every three increments advance .05 seconds, exercising fixed-step interpolation.
          for (let frame=0;frame<=90;frame++) {
            if (frame) bm.update(a,dt[(frame-1)%dt.length]);
            root.updateMatrixWorld(true);
            mesh.skeleton.update();
            const label=pose+' '+weapon+(head ? ' headshot' : '')+' frame '+frame;
            bones.forEach((bone,i)=>{
              checkMatrix(bone.matrixWorld.elements,label+' bone '+i);
              checkMatrix(mesh.skeleton.boneMatrices.subarray(i*16,i*16+16),label+' skinning bone '+i);
              joints[i].setFromMatrixPosition(bone.matrixWorld);
            });
            for (const [from,to,length] of limbs) {
              const ratio=joints[from].distanceTo(joints[to])/P[length];
              assert(Math.abs(ratio-1)<=.05,label+' limb '+from+'–'+to+' length ratio '+ratio);
            }
          }
        } finally { bm.remove(a); }
      }
    }
  } finally {
    G.Map.query=mapQuery; G.time=time;
  }
  console.log('Ragdoll rigid tumble and 16 deaths passed bone matrix and limb length checks');
}
// Recorded gun sounds, announcer and match-moment hooks, against a fake AudioContext and fetch.
async function soundChecks() {
  const A = G.Audio, made = [];
  class P {
    constructor(v) { this.value = v; this.events = []; }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }
    linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); }
    exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); }
    setTargetAtTime(v, t) { this.events.push(['target', v, t]); }
    cancelScheduledValues(t) { this.events = this.events.filter((e) => e[2] < t); }
  }
  const PARAMS = ['gain', 'frequency', 'Q', 'detune', 'playbackRate', 'delayTime', 'threshold', 'knee', 'ratio',
    'attack', 'release', 'positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'];
  function node() {
    const n = { connect: noop, disconnect: noop, setPosition: noop, setOrientation: noop,
      start(t) { n.started = t; }, stop(t) { n.stopped = t; } };
    for (const k of PARAMS) n[k] = new P(k === 'gain' || k === 'playbackRate' ? 1 : 0);
    made.push(n);
    return n;
  }
  class FakeContext {
    constructor() { this.currentTime = 10; this.state = 'running'; this.sampleRate = 8000; this.destination = node(); this.listener = node(); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d, duration: len / 8000 }; }
    decodeAudioData(data, ok) { ok({ duration: 1.2, url: data.url }); }
  }
  for (const m of ['createGain', 'createBiquadFilter', 'createBufferSource', 'createConvolver', 'createDelay',
    'createDynamicsCompressor', 'createOscillator', 'createPanner', 'createWaveShaper']) FakeContext.prototype[m] = node;
  const saved = { ac: global.AudioContext, fetch: global.fetch, cue: G.Music.cue, ann: G.settings.announcer };
  global.AudioContext = FakeContext;
  global.fetch = async (url) => ({ ok: true, arrayBuffer: async () => ({ url }) });
  try {
    A.init();
    for (let i = 0; i < 1000 && !A.sfxReady('v_team_deathmatch'); i++) await new Promise((r) => setImmediate(r));
    assert(A.sfxReady('g_762') && A.sfxReady('m_ak_in') && A.sfxReady('v_team_deathmatch'), 'recordings loaded');
    const ctx = A.ctx, src = (tag) => made.filter((n) => n.buffer && n.buffer.url && n.buffer.url.includes(tag));
    const gainOf = (s) => made[made.indexOf(s) + 1].gain;

    // the AR-7 plays its real recording; the next shot of a burst ducks the previous tail
    A.shot('rifle', null, true);
    const first = src('g_762');
    assert.equal(first.length, 1);
    ctx.currentTime += 0.1;
    A.shot('rifle', null, true);
    assert.equal(src('g_762').length, 2);
    assert(gainOf(first[0]).events.some((e) => e[0] === 'target' && Math.abs(e[1] - 0.22) < 1e-9), 'burst tail duck');

    // announcer: multi-kills outrank headshots, the setting turns it off
    G.settings.announcer = true;
    ctx.currentTime += 3;
    A.killSting({ multi: 2, streak: 2 });
    assert.equal(src('v_double_kill').length, 1);
    A.killSting({ multi: 1, headshot: true, streak: 3 });
    assert.equal(src('v_headshot').length, 0, 'a smaller moment never cuts a bigger line');
    ctx.currentTime += 3;
    A.killSting({ multi: 1, headshot: true, streak: 4 });
    assert.equal(src('v_headshot').length, 1);
    ctx.currentTime += 3;
    A.killSting({ multi: 5, ace: true, streak: 5 });
    assert.equal(src('v_annihilation').length, 1);
    ctx.currentTime += 3;
    G.settings.announcer = false;
    A.killSting({ multi: 3, streak: 3 });
    assert.equal(src('v_triple_kill').length, 0);
    G.settings.announcer = true;

    // reloads: magazine out, then in; a weapon switch cuts the pending magazine sound
    ctx.currentTime += 3;
    A.reload(W.defs.ar7, false);
    const magOut = src('m_ak_out'), magIn = src('m_ak_in');
    assert(magOut.length === 1 && magIn.length === 1 && magIn[0].started > magOut[0].started);
    A.click('switch');
    assert(gainOf(magIn[0]).events.some((e) => e[0] === 'target' && e[1] === 0), 'switch cancels the reload sound');
    A.reload(W.defs.ar7, true); assert.equal(src('m_ak_rack').length, 1);
    A.reload(W.defs.p10, false); assert.equal(src('m_pistol_out').length, 1);
    A.reload(W.defs.s8, false); assert.equal(src('m_shell').length, 1);
    A.reload(W.defs.s8, true); assert.equal(src('m_pump').length, 1);
    A.click('empty'); assert.equal(src('m_dry').length, 1);

    // match moments drive the music cues and the announcer
    const cues = [];
    G.Music.cue = (name) => { cues.push(name); return { stop() { cues.push('stop:' + name); } }; };
    ctx.currentTime += 3;
    A.roundLive();
    assert.deepEqual(cues, ['roundStart']); assert.equal(src('v_start').length, 1);
    ctx.currentTime += 3;
    A.clutch(); A.clutch();
    assert.equal(cues.filter((c) => c === 'clutch').length, 1); assert.equal(src('v_last_man_standing').length, 1);
    A.roundEnd(true, true);
    assert(cues.includes('mvp')); assert.equal(src('v_round_winner').length, 1, 'round end outranks the clutch line');
    A.bombTen(10); assert(cues.includes('bombTicking'));
    ctx.currentTime += 3;
    A.practiceStart(); assert(cues.includes('practiceStart')); assert.equal(src('v_team_deathmatch').length, 1);
    console.log('Recorded gunshots, burst tail duck, announcer ranks and toggle, reload sounds and match-moment music passed');
  } finally {
    global.AudioContext = saved.ac; global.fetch = saved.fetch; G.Music.cue = saved.cue; G.settings.announcer = saved.ann;
  }
}
mapChecks();
botRoundChecks();
musicChecks();
captureChecks().then(() => {
  combatChecks();
  crosshairChecks();
  touchBrakeChecks();
  gameplayChecks();
  ragdollChecks();
}).then(soundChecks).catch(err=>{console.error(err);process.exitCode=1;});

