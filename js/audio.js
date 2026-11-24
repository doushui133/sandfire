// audio.js — 3D sound (WebAudio): recorded guns, voices and the victory fanfare (assets/sfx), the rest synthesised.
(function (G) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null, brownBuf = null;
  let mix, gunBus, gunTail, filter, deathFilter, heartbeat, sting, crackleBuf;
  const listenerPos = { x: 0, y: 0, z: 0 };

  const A = G.Audio = {};

  function resume() {
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  }
  A.init = function () {
    if (ctx) { resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    resume();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -17; comp.knee.value = 18; comp.ratio.value = 3.5;
    comp.attack.value = 0.0015; comp.release.value = 0.13;
    const headroom = ctx.createGain(), ceiling = ctx.createWaveShaper();
    headroom.gain.value = 0.5;
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = 0.94 * Math.tanh((i / 256 - 2) / 0.94);
    ceiling.curve = curve;
    master = ctx.createGain();
    master.gain.value = G.settings.vol;
    mix = ctx.createGain();
    gunBus = ctx.createGain();
    gunBus.connect(mix);
    // music cues (js/music.js) get their own bus so they can be turned down separately
    A.ctx = ctx;
    A.musicBus = ctx.createGain();
    A.musicBus.gain.value = G.clamp(+G.settings.musicVol >= 0 ? +G.settings.musicVol : 0.6, 0, 1);
    A.musicBus.connect(mix);
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000;
    deathFilter = ctx.createBiquadFilter(); deathFilter.type = 'lowpass'; deathFilter.frequency.value = 20000;
    mix.connect(filter); filter.connect(deathFilter); deathFilter.connect(comp);
    comp.connect(headroom); headroom.connect(ceiling); ceiling.connect(master); master.connect(ctx.destination);
    // white + brown noise buffers
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    crackleBuf = ctx.createBuffer(1,len,ctx.sampleRate);
    const crackle = crackleBuf.getChannelData(0);
    let pop = 0;
    const w = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      if (r > 0.998) pop = 1;
      crackle[i] = r * (0.04 + pop); pop *= 0.992;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }

    // Shared short room response and a single outdoor reflection.
    const impulse = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.24), ctx.sampleRate);
    const ir = impulse.getChannelData(0), start = Math.round(ctx.sampleRate * 0.012);
    last = 0;
    for (let i = start; i < ir.length; i++) {
      last = last * 0.65 + w[i] * 0.35;
      ir[i] = last * Math.pow((ir.length - i) / (ir.length - start), 2.8);
    }
    gunTail = ctx.createGain();
    const verb = ctx.createConvolver(), wet = ctx.createGain();
    verb.buffer = impulse; wet.gain.value = 0.28;
    gunTail.connect(verb); verb.connect(wet); wet.connect(gunBus);
    const delay = ctx.createDelay(0.2), echo = ctx.createBiquadFilter();
    delay.delayTime.value = 0.105;
    echo.type = 'lowpass'; echo.frequency.value = 1450; echo.Q.value = 0.7;
    const slap = ctx.createGain(); slap.gain.value = 0.19;
    gunTail.connect(delay); delay.connect(echo); echo.connect(slap); slap.connect(gunBus);
    loadSfx();
  };
  A.pause = function () { if (ctx && ctx.state==='running') ctx.suspend().catch(() => {}); };
  A.setVolume = function (v) { if (master) master.gain.value = v; };

  A.updateListener = function (pos, yaw) {
    if (!ctx) return;
    const L = ctx.listener;
    listenerPos.x = pos.x; listenerPos.y = pos.y; listenerPos.z = pos.z;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  };

  // Route dry sound and any effects send through the same panner.
  function out(pos, ref, gain, bus = mix, tail = null) {
    const g = ctx.createGain();
    g.gain.value = gain;
    let send = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref || 4;
      p.rolloffFactor = 1.1;
      p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); send = p;
    }
    send.connect(bus);
    if (tail) send.connect(tail);
    return g;
  }
  function dist(pos) {
    if (!pos) return 0;
    return Math.hypot(pos.x - listenerPos.x, pos.y - listenerPos.y, pos.z - listenerPos.z);
  }
  function noise(dest, t, dur, opts) {
    const src = ctx.createBufferSource();
    src.buffer = opts.brown ? brownBuf : noiseBuf;
    src.playbackRate.value = opts.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type || 'lowpass';
    f.frequency.setValueAtTime(opts.f || 3000, t);
    if (opts.f2) f.frequency.exponentialRampToValueAtTime(opts.f2, t + dur);
    f.Q.value = opts.q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.g || 1, t + (opts.att || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(dest, t, dur, opts) {
    const o = ctx.createOscillator();
    o.type = opts.wave || 'sine';
    o.frequency.setValueAtTime(opts.f, t);
    if (opts.f2) o.frequency.exponentialRampToValueAtTime(opts.f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.g || 0.5, t + (opts.att || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Body band, crack cutoff, thump pitch/resonance, and relative weight.
  const GUN = {
    pistol: { f: 1850, d: 0.092, crack: 3750, th: 137, end: 55, q: 1.15, g: 0.8 },
    heavy:  { f: 1220, d: 0.165, crack: 3050, th: 112, end: 43, q: 0.78, g: 1.3 },
    m18:    { f: 2670, d: 0.073, crack: 4460, th: 148, end: 60, q: 1.35, g: 0.7 },
    k5:     { f: 3210, d: 0.065, crack: 5270, th: 146, end: 56, q: 1.55, g: 0.72 },
    smg:    { f: 2130, d: 0.088, crack: 4640, th: 132, end: 51, q: 1.05, g: 0.82 },
    u45:    { f: 1460, d: 0.126, crack: 3490, th: 115, end: 47, q: 1.2, g: 0.99 },
    rifle:  { f: 1950, d: 0.145, crack: 3990, th: 118, end: 42, q: 0.82, g: 1.15 },
    rifle2: { f: 2580, d: 0.114, crack: 4910, th: 128, end: 49, q: 1.05, g: 1.05 },
    fa2:    { f: 2270, d: 0.103, crack: 3540, th: 126, end: 53, q: 1.3, g: 0.95 },
    l60:    { f: 1430, d: 0.181, crack: 2870, th: 107, end: 43, q: 0.75, g: 1.24 },
    s8:     { f:  925, d: 0.232, crack: 2410, th: 102, end: 40, q: 0.62, g: 1.38 },
    s40:    { f: 1720, d: 0.202, crack: 5550, th: 124, end: 45, q: 0.83, g: 1.28 },
    sniper: { f: 1120, d: 0.285, crack: 4320, th: 110, end: 39, q: 0.65, g: 1.52 },
  };
  // synthesised gunshot: used until the recordings have loaded
  function synthShot(kind, pos, local) {
    const p = GUN[kind] || GUN.rifle;
    const d = local ? 0 : dist(pos);
    const t = ctx.currentTime + Math.min(d / 343, 0.23);
    const o = out(local ? null : pos, 7, local ? 1 : 0.85 / (1 + d / 125), gunBus, gunTail);
    let shot = o;
    if (!local) {
      shot = ctx.createBiquadFilter();
      shot.type = 'lowpass';
      shot.frequency.value = 820 + 15000 / (1 + Math.pow(d / 11, 1.65));
      shot.Q.value = 0.7;
      shot.connect(o);
    }
    const variation = G.rand(0.92, 1.08);
    noise(shot, t, 0.02 + p.d * 0.045, { type: 'highpass', f: p.crack * variation, g: p.g * 1.05, att: 0.0006 });
    noise(shot, t + 0.001, p.d, { type: 'bandpass', f: p.f * variation, f2: p.f * 0.24, q: p.q, g: p.g * 2.2, att: 0.0015 });
    tone(shot, t + 0.002, 0.055 + p.d * 0.42, { f: p.th, f2: p.end, g: p.g * 0.93, wave: 'triangle', att: 0.002 });
  }

  // ---------- recorded sounds (assets/sfx, built by tools/sfx-build.js) ----------
  // Real gunshot and gun-handling recordings (Snake's Authentic Gun Sounds packs) and an English announcer
  // (WARLORD by VoiceBosch, CC BY-SA 4.0). Until a file has loaded, the synthesised version plays instead.
  const SFX = ['g_9mm', 'g_556', 'g_762', 'g_308', 'g_762r', 'g_20ga',
    'f_sand_l1', 'f_sand_l2', 'f_sand_l3', 'f_sand_r1', 'f_sand_r2', 'f_sand_r3',
    'f_stone_l1', 'f_stone_l2', 'f_stone_l3', 'f_stone_r1', 'f_stone_r2', 'f_stone_r3',
    'm_dry', 'm_bolt', 'm_pump', 'm_shell',
    'm_ar_out', 'm_ar_in', 'm_ar_bolt', 'm_ak_out', 'm_ak_in', 'm_ak_rack', 'm_pistol_out', 'm_pistol_in', 'm_pistol_slide',
    'v_headshot', 'v_double_kill', 'v_triple_kill', 'v_rampage', 'v_unstoppable', 'v_annihilation', 'v_first_blood',
    'v_dominating', 'v_start', 'v_round_winner', 'v_mission_failed', 'v_last_man_standing', 'v_team_deathmatch',
    'mu_roundstart', 'mu_victory'];
  const sfx = {};
  let sfxLoading = false;
  function loadSfx() {
    if (sfxLoading || !ctx || typeof fetch !== 'function') return;
    sfxLoading = true;
    (async () => {
      for (const name of SFX) {   // one at a time, guns first: keeps phones responsive
        try {
          const res = await fetch('assets/sfx/' + name + '.wav');
          if (!res.ok) continue;
          const data = await res.arrayBuffer();
          sfx[name] = await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
        } catch (e) { /* keep the synthesised fallback */ }
      }
    })();
  }
  A.sfxReady = (name) => !!sfx[name];
  function play(name, dest, t, rate, gain) {
    const b = sfx[name];
    if (!b) return null;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate || 1; g.gain.value = gain == null ? 1 : gain;
    src.connect(g); g.connect(dest); src.start(t);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    return g;
  }

  // weapon sound → [recording, playback rate, gain]
  const SHOT = {
    pistol: ['g_9mm', 1.0, 0.92], m18: ['g_9mm', 1.07, 0.86], heavy: ['g_308', 1.18, 1.0],
    smg: ['g_9mm', 1.1, 0.86], k5: ['g_9mm', 1.18, 0.8], u45: ['g_9mm', 0.9, 0.96],
    rifle: ['g_762', 1.0, 1.0], rifle2: ['g_556', 1.0, 0.98], fa2: ['g_556', 1.06, 0.94],
    l60: ['g_308', 0.94, 1.0], s8: ['g_20ga', 1.0, 1.05], sniper: ['g_762r', 1.0, 1.1], s40: ['g_308', 1.0, 1.06],
  };
  const lastShot = new Map();
  A.shot = function (kind, pos, local) {
    if (!ctx) return;
    const s = SHOT[kind];
    if (!s || !sfx[s[0]]) { synthShot(kind, pos, local); return; }
    const d = local ? 0 : dist(pos);
    const t = ctx.currentTime + Math.min(d / 343, 0.23);
    const o = out(local ? null : pos, 7, local ? 1.05 : 1 / (1 + d / 95), gunBus, local ? null : gunTail);
    let dest = o;
    if (!local) {
      dest = ctx.createBiquadFilter();
      dest.type = 'lowpass';
      dest.frequency.value = 900 + 16000 / (1 + Math.pow(d / 12, 1.6));
      dest.Q.value = 0.7;
      dest.connect(o);
    }
    // Automatic fire: duck the previous report's tail so every shot stays crisp instead of smearing.
    const key = local ? 'me' : Math.round(pos.x * 2) + ',' + Math.round(pos.z * 2);
    const prev = lastShot.get(key);
    if (prev && prev.g && t - prev.t < 0.6) prev.g.gain.setTargetAtTime(prev.v * 0.22, t, 0.02);
    const v = s[2], g = play(s[0], dest, t, s[1] * G.rand(0.97, 1.03), v);
    lastShot.set(key, { g, t, v });
    if (lastShot.size > 40) for (const [k, e] of lastShot) if (t - e.t > 1) lastShot.delete(k);
    if (local) {
      // a short sub-bass kick under your own shots: the punch big shooters lean on
      const heavy = kind === 's8' || kind === 'sniper' || kind === 's40';
      tone(o, t, 0.075, { f: heavy ? 70 : 95, f2: 42, g: 0.6, wave: 'sine', att: 0.001 });
      if (kind === 's8' && sfx.m_pump) play('m_pump', out(null, 1, 0.55), t + 0.34, 1.08, 1);
    }
  };
  A.foot = function (pos, local, loud) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(local ? null : pos, 2.5, local ? 0.22 : 0.55 * (loud || 1));
    noise(o, t, 0.06, { type: 'bandpass', f: G.rand(700, 1300), q: 1.2, g: 0.9 });
    noise(o, t + 0.012, 0.09, { type: 'lowpass', f: 400, g: 0.7, brown: true });
  };
  // ---------- footsteps ----------
  // Recorded single steps (Fantozzi, CC0) on sand or stone, left and right feet, with a little pitch and level
  // variation. An enemy's steps are HRTF-panned (left/right, front/back and some height on headphones), carry to
  // ~30 m, grow darker with distance and are muffled through walls; a teammate's are quieter and plainly panned,
  // so the enemy's stand out. Each soldier has one 3D voice that every step moves (HRTF is costly: a handful of
  // voices instead of one panner per step); phones pan every voice plainly. Whether a step is heard at all
  // (running) or silent (walking, crouching) is the caller's call (G.Game.loudSteps).
  const STEP_RANGE = 31;
  const smooth = (a, b, v) => { const x = G.clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  let lastStep = '';
  function stepSample(surface, foot) {
    const base = 'f_' + (surface === 'sand' ? 'sand' : 'stone') + (foot ? '_r' : '_l');
    const names = [base + 1, base + 2, base + 3].filter((n) => sfx[n] && n !== lastStep);
    return names.length ? (lastStep = names[Math.floor(Math.random() * names.length)]) : null;
  }
  // the straight line from your ears to the step crosses a wall, crate or roof
  function occluded(pos) {
    const dx = pos.x - listenerPos.x, dy = pos.y + 0.15 - listenerPos.y, dz = pos.z - listenerPos.z;
    const d = Math.hypot(dx, dy, dz);
    return d > 0.6 && !!G.Map.raycast(listenerPos.x, listenerPos.y, listenerPos.z, dx / d, dy / d, dz / d, d - 0.35);
  }
  const voices = new Map();
  // the soldier's voice, placed at pos with this step's brightness: returns its input
  function stepVoice(id, pos, cutoff, mate, t) {
    const hrtf = !mate && !(G.Touch && G.Touch.enabled);
    let v = voices.get(id);
    if (!v || v.hrtf !== hrtf) {
      if (v) { v.g.disconnect(); v.p.disconnect(); }
      const g = ctx.createGain(), f = ctx.createBiquadFilter(), p = ctx.createPanner();
      f.type = 'lowpass'; f.Q.value = 0.7; f.frequency.value = cutoff;
      p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0;
      g.connect(f); f.connect(p); p.connect(mix);
      v = { g, f, p, hrtf };
      voices.delete(id); voices.set(id, v);
      // old matches' soldiers: drop the least recently heard voice
      if (voices.size > 16) { const [old, ov] = voices.entries().next().value; ov.g.disconnect(); ov.p.disconnect(); voices.delete(old); }
    } else { voices.delete(id); voices.set(id, v); }
    const p = v.p;
    if (p.positionX) { p.positionX.setValueAtTime(pos.x, t); p.positionY.setValueAtTime(pos.y + 0.1, t); p.positionZ.setValueAtTime(pos.z, t); }
    else p.setPosition(pos.x, pos.y + 0.1, pos.z);
    v.f.frequency.setTargetAtTime(cutoff, t, 0.01);
    return v.g;
  }
  // how loud and how bright another soldier's step is at pos: null when out of earshot
  function stepLevel(pos, opts) {
    const d = dist(pos);
    if (d > STEP_RANGE) return null;
    const blocked = occluded(pos);
    return { d, blocked, gain: Math.pow(1 - smooth(2.5, STEP_RANGE, d), 1.3) * (blocked ? 0.55 : 1) * (opts.mate ? 0.5 : 1),
      cutoff: blocked ? 700 : 2000 + 16000 / (1 + d / 8) };
  }
  A.step = function (pos, surface, foot, opts) {
    if (!ctx) return false;
    const o = opts || {}, name = stepSample(surface, foot);
    if (!name) { A.foot(pos, !!o.local); return true; }   // synthesised until the recordings have loaded
    const t = ctx.currentTime, rate = G.rand(0.95, 1.05), level = G.rand(0.86, 1);
    if (o.local) { play(name, out(null, 1, 0.3 * level), t, rate, 1); return true; }
    const s = stepLevel(pos, o);
    if (!s) return false;
    const at = t + Math.min(s.d / 343, 0.09);
    play(name, stepVoice(o.id || 0, pos, s.cutoff, !!o.mate, at), at, rate, 1.25 * s.gain * level);
    return true;
  };
  // landing from a jump or a drop: both feet at once, lower and heavier
  A.land = function (pos, local, surface, opts) {
    if (!ctx) return;
    const o = opts || {}, t = ctx.currentTime, left = stepSample(surface, 0), right = stepSample(surface, 1);
    if (!left || !right) {
      const g = out(local ? null : pos, 3, local ? 0.35 : 0.7);
      noise(g, t, 0.14, { type: 'lowpass', f: 700, g: 1, brown: true });
      return;
    }
    let dest, level = 1;
    if (local) dest = out(null, 1, 0.42);
    else {
      const s = stepLevel(pos, o);
      if (!s) return;
      dest = stepVoice(o.id || 0, pos, Math.min(s.cutoff, 6000), !!o.mate, t);
      level = 1.5 * s.gain;
    }
    play(left, dest, t, 0.84, level);
    play(right, dest, t + 0.014, 0.8, 0.9 * level);
    noise(dest, t, 0.12, { type: 'lowpass', f: 300, g: 0.7 * level, brown: true });
  };
  // Handling and UI clicks. With a position (another soldier's bolt, plant or defuse) the sound comes from
  // there and fades with distance; without one it is yours (these used to sound in your ears for every bot).
  A.click = function (kind, pos) {
    if (!ctx) return;
    const t = ctx.currentTime, o = pos ? out(pos, 2.5, 0.8) : out(null, 1, 0.5);
    if (kind === 'switch' && !pos) cancelReload();
    if (kind === 'empty' && sfx.m_dry) { play('m_dry', o, t, 1, 1.3); return; }
    if (kind === 'bolt' && sfx.m_bolt) { play('m_bolt', o, t + 0.26, 1.05, pos ? 1.1 : 1.4); return; }
    if (kind === 'empty') noise(o, t, 0.03, { type: 'highpass', f: 3500, g: 0.5 });
    else if (kind === 'reload1') { noise(o, t, 0.05, { type: 'bandpass', f: 2200, q: 2, g: 0.6 }); tone(o, t, 0.04, { f: 600, g: 0.15, wave: 'square' }); }
    else if (kind === 'reload2') { noise(o, t, 0.07, { type: 'bandpass', f: 1500, q: 2, g: 0.8 }); noise(o, t + 0.07, 0.05, { type: 'highpass', f: 3000, g: 0.5 }); }
    else if (kind === 'switch') noise(o, t, 0.06, { type: 'bandpass', f: 1800, q: 1.5, g: 0.45 });
    else if (kind === 'buy') { tone(o, t, 0.08, { f: 880, g: 0.2 }); tone(o, t + 0.07, 0.1, { f: 1320, g: 0.2 }); }
    else if (kind === 'deny') tone(o, t, 0.15, { f: 220, g: 0.25, wave: 'square' });
    else if (kind === 'bolt') { noise(o, t, 0.06, { type: 'bandpass', f: 1200, q: 2, g: 0.7 }); noise(o, t + 0.18, 0.06, { type: 'bandpass', f: 1700, q: 2, g: 0.7 }); }
    else if (kind === 'tick') tone(o, t, 0.03, { f: 1500, g: 0.12, wave: 'square' });
    else if (kind === 'zoom') noise(o, t, 0.028, { type: 'bandpass', f: 2600, q: 2.2, g: 0.3 });
    else if (kind === 'pickup') {
      noise(o, t, 0.05, { type: 'bandpass', f: 1250, q: 1.3, g: 0.34 });
      noise(o, t + 0.045, 0.04, { type: 'highpass', f: 3300, g: 0.18 });
    }
  };
  A.hit = function (head, helmet) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(null, 1, 0.58);
    if (head && helmet) {
      noise(o, t, 0.025, { type: 'highpass', f: 3300, g: 0.7, att: 0.0008 });
      tone(o, t, 0.22, { f: 2120, g: 0.56, att: 0.001 });
      tone(o, t, 0.095, { f: 3640, g: 0.29, att: 0.001 });
    } else if (head) {
      noise(o, t, 0.072, { type: 'bandpass', f: 2150, f2: 420, q: 0.9, g: 1.1, att: 0.001 });
      tone(o, t, 0.065, { f: 205, f2: 82, g: 0.39, wave: 'triangle' });
    } else {
      noise(o, t, 0.082, { f: 750, f2: 190, g: 0.82 });
      tone(o, t, 0.075, { f: 145, f2: 57, g: 0.46, wave: 'triangle' });
    }
  };
  // Kill confirmation: a small struck-metal "ting" (pure partials at bell-like ratios, each with its own
  // natural decay, a slow 3-cent shimmer) over a soft punch, with a short bright reverb. Each kill of a
  // multi-kill climbs a major pentatonic step (A5 B5 C#6 E6 F#6); a headshot adds a fifth above.
  const KILL_NOTES = [880, 987.77, 1108.73, 1318.51, 1479.98];
  const BELL = [[1, 1, 0.16], [2, 0.3, 0.11], [2.76, 0.38, 0.07], [4.07, 0.13, 0.045], [5.4, 0.09, 0.03]];
  let killVerb = null;
  function killReverb() {
    if (killVerb) return killVerb;
    const len = Math.round(ctx.sampleRate * 0.7), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.35;
    }
    killVerb = ctx.createConvolver(); killVerb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.2;
    killVerb.connect(wet); wet.connect(mix);
    return killVerb;
  }
  function partial(dest, t, f, level, tau) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.0015);
    g.gain.setTargetAtTime(0, t + 0.0015, tau);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.0015 + tau * 7);
  }
  A.killSting = function (info) {
    if (!ctx) return;
    const t = ctx.currentTime, duck = gunBus.gain;
    duck.cancelScheduledValues(t);
    duck.setTargetAtTime(0.72, t, 0.004);
    duck.setTargetAtTime(1, t + 0.14, 0.03);
    if (sting) sting.gain.setTargetAtTime(0, t, 0.008);
    sting = out(null, 1, 0.55, mix, killReverb());

    const tier = G.clamp(info.multi | 0, 1, 5);
    const f0 = KILL_NOTES[tier - 1] * (info.knife ? 0.94 : 1), ring = info.headshot ? 1.2 : 1;
    tone(sting, t, info.grenade ? 0.16 : 0.09, { f: info.grenade ? 110 : 150, f2: info.grenade ? 40 : 62, g: 0.7, att: 0.002 });
    noise(sting, t, 0.012, { type: 'highpass', f: 4800, g: 0.2, att: 0.0005 });
    for (const [ratio, level, tau] of BELL) partial(sting, t + 0.003, f0 * ratio, level * 0.5, tau * ring);
    partial(sting, t + 0.003, f0 * 1.0018, 0.24, 0.16 * ring);
    if (info.headshot) {
      partial(sting, t + 0.045, f0 * 1.5, 0.22, 0.14);
      noise(sting, t, 0.006, { type: 'highpass', f: 7500, g: 0.28, att: 0.0003 });
    }
    if (tier >= 3) partial(sting, t + 0.07, f0 * 2, 0.15, 0.12);
    if (info.knife) noise(sting, t, 0.13, { type: 'bandpass', f: 6000, f2: 2200, q: 3, g: 0.38 });
    if (info.grenade) noise(sting, t + 0.01, 0.2, { f: 420, f2: 70, g: 0.6, brown: true });
    const line = killLine(info);
    if (line) A.announce(line[0], line[1], 0.13);
  };

  // ---------- announcer and match moments ----------
  let voice = null, voiceUntil = 0, voiceRank = 0, clutch = null;
  // rank: a bigger moment (a triple kill) is never cut off by a smaller one (a headshot)
  A.announce = function (name, rank, delay) {
    if (!ctx || !sfx[name] || G.settings.announcer === false) return false;
    const now = ctx.currentTime, t = now + (delay || 0);
    if (now < voiceUntil && (rank || 0) <= voiceRank) return false;
    if (voice) voice.gain.setTargetAtTime(0, now, 0.03);
    voice = ctx.createGain(); voice.gain.value = 1.1; voice.connect(mix);
    play(name, voice, t, 1, 1);
    const len = sfx[name].duration;
    voiceUntil = t + len; voiceRank = rank || 0;
    // the voice cuts through: gunfire and music duck underneath it
    const duck = gunBus.gain;
    duck.cancelScheduledValues(t);
    duck.setTargetAtTime(0.55, t, 0.03); duck.setTargetAtTime(1, t + len * 0.85, 0.2);
    if (A.musicBus) {
      const m = A.musicBus.gain, level = G.clamp(+G.settings.musicVol >= 0 ? +G.settings.musicVol : 0.6, 0, 1);
      m.cancelScheduledValues(t); m.setTargetAtTime(level * 0.45, t, 0.05); m.setTargetAtTime(level, t + len, 0.3);
    }
    return true;
  };
  function killLine(info) {
    const m = info.multi | 0;
    if (info.ace) return ['v_annihilation', 6];
    if (m >= 5) return ['v_unstoppable', 5];
    if (m === 4) return ['v_rampage', 4];
    if (m === 3) return ['v_triple_kill', 3];
    if (m === 2) return ['v_double_kill', 2];
    if (G.Game.mode === 'practice' && info.streak >= 5 && info.streak % 5 === 0) return [info.streak >= 10 ? 'v_unstoppable' : 'v_dominating', 3];
    if (info.headshot) return ['v_headshot', 1];
    if (info.first) return ['v_first_blood', 1];
    return null;
  }
  const cue = (name, opts) => (G.Music && G.Music.cue ? G.Music.cue(name, opts) : null);
  // Round and practice start: the first four bars of "Battle Theme A" by cynicmusic (CC0), kept under the
  // footsteps (the synthesised cue only plays until the recording has loaded).
  let startCue = null;
  function stopStart(fade) {
    if (!startCue) return;
    const g = startCue; startCue = null;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime, fade);
    setTimeout(() => g.disconnect(), 1500);
  }
  function playStart() {
    if (!ctx || !A.musicBus || !sfx.mu_roundstart) return false;
    stopStart(0.05);
    const t = ctx.currentTime + 0.03, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = sfx.mu_roundstart; src.connect(g); g.connect(A.musicBus);
    g.gain.value = 0.5;
    src.start(t);
    src.onended = () => { src.disconnect(); g.disconnect(); if (startCue === g) startCue = null; };
    startCue = g;
    return true;
  }
  A.roundLive = function () {
    A.stopClutch();
    if (!playStart()) cue('roundStart');
    A.announce('v_start', 1, 0.25);
  };
  // ---------- round and match outcome music ----------
  // Victory: "Victory Fanfare Short" by cynicmusic (CC0); its first ~6.6 s for a won round, all of it for
  // your MVP round or a won match. Defeat: a falling low hit under a dark minor swell, no melody.
  let outcome = null;
  function stopOutcome(fade) {
    if (!outcome) return;
    const g = outcome; outcome = null;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime, fade);
    setTimeout(() => g.disconnect(), 1500);
  }
  A.victory = function (full) {
    if (!ctx || !A.musicBus || !sfx.mu_victory) return false;
    stopOutcome(0.05);
    const t = ctx.currentTime + 0.04, b = sfx.mu_victory, len = full ? b.duration : Math.min(b.duration, 6.6);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.connect(g); g.connect(A.musicBus);
    g.gain.setValueAtTime(0.62, t);
    if (!full) { g.gain.setValueAtTime(0.62, t + len - 1.5); g.gain.linearRampToValueAtTime(0, t + len); }
    src.start(t, 0, len);
    src.onended = () => { src.disconnect(); g.disconnect(); if (outcome === g) outcome = null; };
    outcome = g;
    return true;
  };
  let defeatVerb = null;
  A.defeat = function () {
    if (!ctx || !A.musicBus) return false;
    stopOutcome(0.05);
    const t = ctx.currentTime + 0.04, g = ctx.createGain();
    g.gain.value = 0.9; g.connect(A.musicBus);
    if (!defeatVerb) {
      const len = Math.round(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * 0.22;
      }
      defeatVerb = ctx.createConvolver(); defeatVerb.buffer = ir;
    }
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    defeatVerb.connect(wet); wet.connect(g);
    // a falling low hit
    tone(g, t, 1.7, { f: 62, f2: 33, g: 0.75, att: 0.004 });
    noise(g, t, 1.1, { f: 260, f2: 55, g: 0.42, brown: true, att: 0.003 });
    // D minor (D2 A2 D3 F3 A3): detuned saw pairs under a dark low-pass that opens a little and closes
    const lp = ctx.createBiquadFilter(), pad = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(360, t); lp.frequency.linearRampToValueAtTime(880, t + 0.9);
    lp.frequency.linearRampToValueAtTime(380, t + 3.4);
    pad.gain.setValueAtTime(0, t); pad.gain.linearRampToValueAtTime(0.075, t + 0.7);
    pad.gain.setTargetAtTime(0, t + 1.9, 0.55);
    lp.connect(pad); pad.connect(g); pad.connect(defeatVerb);
    for (const f of [73.42, 110, 146.83, 174.61, 220]) for (const cents of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
      o.connect(lp); o.start(t); o.stop(t + 4.6);
    }
    setTimeout(() => { wet.disconnect(); if (outcome === g) outcome = null; g.disconnect(); }, 7000);
    outcome = g;
    return true;
  };
  A.roundEnd = function (won, mvpMine, matchWon) {
    if (clutch && clutch.stop) clutch.stop(0.25);
    clutch = null;
    if (G.Music && G.Music.stopAll) G.Music.stopAll(0.25);   // the bomb countdown and clutch end with the round
    if (ctx) stopStart(0.3);
    if (!(won ? A.victory(mvpMine || matchWon) : A.defeat())) A.radio(won ? 'win' : 'lose');
    A.announce(won ? 'v_round_winner' : 'v_mission_failed', 7, 0.3);   // always heard, even after a clutch line
  };
  // practice deathmatch result (no round-end call): the full fanfare or the defeat cue
  A.matchEnd = function (won) {
    if (!(won ? A.victory(true) : A.defeat())) A.radio(won ? 'win' : 'lose');
  };
  // the player is the last one standing on their team: tension music until the round is decided
  A.clutch = function () {
    if (clutch) return;
    clutch = cue('clutch');
    A.announce('v_last_man_standing', 4, 0.2);
  };
  A.stopClutch = function () { if (clutch) { clutch.stop(0.6); clutch = null; } };
  A.bombTen = function (seconds) { cue('bombTicking', { seconds }); };
  A.practiceStart = function () { if (!playStart()) cue('practiceStart'); A.announce('v_team_deathmatch', 2, 0.3); };
  A.stopMusic = function () {
    clutch = null;
    if (G.Music && G.Music.stopAll) G.Music.stopAll(0.4);
    if (ctx) { stopOutcome(0.3); stopStart(0.3); }
  };
  A.deathMix = function (enabled) {
    if (!ctx || !!heartbeat === enabled) return;
    const t = ctx.currentTime;
    deathFilter.frequency.setTargetAtTime(enabled ? 680 : 20000, t, 0.045);
    if (!enabled) { heartbeat.disconnect(); heartbeat = null; return; }
    heartbeat = out(null, 1, 0.85);
    for (let i = 0; i < 4; i++) {
      tone(heartbeat, t + i * 0.76, 0.19, { f: 97, f2: 41, g: 0.78 });
      tone(heartbeat, t + i * 0.76 + 0.2, 0.14, { f: 76, f2: 39, g: 0.5 });
    }
  };
  A.hurt = function () {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(null, 1, 0.6);
    noise(o, t, 0.18, { type: 'lowpass', f: 500, g: 1, brown: true });
    tone(o, t, 0.12, { f: 110, f2: 60, g: 0.5 });
  };
  A.knife = function (pos, local, hit) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(local ? null : pos, 3, 0.5);
    noise(o, t, 0.12, { type: 'bandpass', f: 2500, f2: 900, q: 1.5, g: 0.6 });
    if (hit) noise(o, t + 0.05, 0.1, { type: 'lowpass', f: 600, g: 0.9, brown: true });
  };
  A.shell = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(pos, 1.5, 0.25);
    tone(o, t, 0.05, { f: G.rand(3800, 5200), g: 0.25, wave: 'triangle' });
    tone(o, t + 0.06, 0.04, { f: G.rand(4200, 5600), g: 0.12, wave: 'triangle' });
  };
  A.impact = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(pos, 2, 0.35);
    noise(o, t, 0.05, { type: 'bandpass', f: G.rand(1500, 3500), q: 2, g: 0.6 });
  };
  A.beep = function (pos, urgent) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(pos, 6, 0.9);
    tone(o, t, 0.09, { f: urgent ? 2100 : 1800, g: 0.45, wave: 'square' });
  };
  A.explosion = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(pos, 25, 2.2);
    noise(o, t, 2.6, { brown: true, f: 1200, f2: 80, g: 1.6, att: 0.01 });
    noise(o, t, 0.6, { f: 4000, f2: 300, g: 0.8 });
    tone(o, t, 1.6, { f: 70, f2: 25, g: 1.2 });
  };
  // reload: magazine out at the start, magazine in a little past half-way, then the bolt / rack / slide
  const RELOAD = {
    ak: ['m_ak_out', 'm_ak_in', 'm_ak_rack', 1], ar: ['m_ar_out', 'm_ar_in', 'm_ar_bolt', 1],
    smg: ['m_ar_out', 'm_ar_in', 'm_ar_bolt', 1.12], pistol: ['m_pistol_out', 'm_pistol_in', 'm_pistol_slide', 1],
    sniper: ['m_ar_out', 'm_ar_in', 'm_bolt', 0.95],
  };
  let reloadVoices = [];
  function cancelReload() {
    if (!ctx) return;
    for (const g of reloadVoices) if (g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    reloadVoices = [];
  }
  function reloadSet(d) {
    if (d.slot === 'pistol') return RELOAD.pistol;
    if (d.scope) return RELOAD.sniper;
    if (d.model === 'smg') return RELOAD.smg;
    return d.snd === 'rifle' || d.snd === 'l60' ? RELOAD.ak : RELOAD.ar;
  }
  A.reload = function (d, finish) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (sfx.m_ar_out) {
      const o = out(null, 1, 0.8);
      if (d.shell) { play(finish ? 'm_pump' : 'm_shell', o, t, 1.05, 1); return; }
      const set = reloadSet(d);
      if (finish) { reloadVoices = []; play(set[2], o, t, set[3], 1); return; }
      cancelReload();
      reloadVoices = [play(set[0], o, t + 0.06, set[3], 0.9), play(set[1], o, t + Math.max(0.35, d.reload * 0.55), set[3], 1)];
      return;
    }
    const p=GUN[d.snd], o=out(null,1,0.45);
    noise(o,t,d.shell ? 0.06 : 0.14,{type:'bandpass',f:p.f*(finish ? 0.7 : 1),q:1.6});
    tone(o,t+0.04,0.07,{f:p.th*4,g:0.14,wave:'triangle'});
  };
  A.grenade = function (id,pos) {
    if (!ctx) return;
    if (id==='he') { A.explosion(pos); return; }
    const o=out(pos,4,0.7), t=ctx.currentTime;
    if (id==='flash') { noise(o,t,0.17,{f:5600,g:1.3}); tone(o,t,0.12,{f:1600,f2:600,g:0.35}); }
    else if (id==='smoke') noise(o,t,1.3,{type:'highpass',f:1600,g:0.6});
    else if (id==='throw') noise(o,t,0.13,{type:'bandpass',f:850,f2:2000,g:0.45});
    else noise(o,t,0.5,{f: id==='molotov' ? 4500 : 2000,f2:550,g:0.9});
  };
  A.ring = function (dur) {
    if (!ctx) return;
    const t=ctx.currentTime, f=filter.frequency;
    f.cancelScheduledValues(t); f.setValueAtTime(750,t); f.exponentialRampToValueAtTime(20000,t+dur);
    tone(mix,t,dur,{f:2600,f2:1600,g:0.2});
  };
  A.fireLoop = function (pos) {
    if (!ctx) return null;
    const o=out(pos,3,0.3), src=ctx.createBufferSource(), f=ctx.createBiquadFilter();
    f.type='highpass'; f.frequency.value=850;
    src.buffer=crackleBuf; src.loop=true; src.connect(f); f.connect(o); src.start();
    return () => { src.stop(); src.disconnect(); f.disconnect(); o.disconnect(); };
  };
  A.radio = function (kind) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(null, 1, 0.3);
    const seq = {
      start: [[660, 0], [880, 0.12]],
      win: [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36]],
      lose: [[440, 0], [370, 0.15], [294, 0.3]],
      planted: [[1200, 0], [900, 0.18], [1200, 0.36], [900, 0.54]],
      defused: [[784, 0], [1046, 0.14]],
      buy: [[990, 0]],
    }[kind] || [];
    seq.forEach(([f, dt]) => tone(o, t + dt, 0.16, { f, g: 0.4, wave: 'triangle' }));
  };
})(window.G);
