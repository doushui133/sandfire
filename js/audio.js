// audio.js — procedural 3D sound (WebAudio). Every sound is synthesised, no files.
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
  const SFX = ['g_9mm', 'g_556', 'g_762', 'g_308', 'g_762r', 'g_20ga', 'm_dry', 'm_bolt', 'm_pump', 'm_shell',
    'm_ar_out', 'm_ar_in', 'm_ar_bolt', 'm_ak_out', 'm_ak_in', 'm_ak_rack', 'm_pistol_out', 'm_pistol_in', 'm_pistol_slide',
    'v_headshot', 'v_double_kill', 'v_triple_kill', 'v_rampage', 'v_unstoppable', 'v_annihilation', 'v_first_blood',
    'v_dominating', 'v_start', 'v_round_winner', 'v_mission_failed', 'v_last_man_standing', 'v_team_deathmatch'];
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
  A.land = function (pos, local) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(local ? null : pos, 3, local ? 0.35 : 0.7);
    noise(o, t, 0.14, { type: 'lowpass', f: 700, g: 1, brown: true });
  };
  A.click = function (kind) {
    if (!ctx) return;
    const t = ctx.currentTime, o = out(null, 1, 0.5);
    if (kind === 'switch') cancelReload();
    if (kind === 'empty' && sfx.m_dry) { play('m_dry', o, t, 1, 1.3); return; }
    if (kind === 'bolt' && sfx.m_bolt) { play('m_bolt', o, t + 0.26, 1.05, 1.4); return; }
    if (kind === 'empty') noise(o, t, 0.03, { type: 'highpass', f: 3500, g: 0.5 });
    else if (kind === 'reload1') { noise(o, t, 0.05, { type: 'bandpass', f: 2200, q: 2, g: 0.6 }); tone(o, t, 0.04, { f: 600, g: 0.15, wave: 'square' }); }
    else if (kind === 'reload2') { noise(o, t, 0.07, { type: 'bandpass', f: 1500, q: 2, g: 0.8 }); noise(o, t + 0.07, 0.05, { type: 'highpass', f: 3000, g: 0.5 }); }
    else if (kind === 'switch') noise(o, t, 0.06, { type: 'bandpass', f: 1800, q: 1.5, g: 0.45 });
    else if (kind === 'buy') { tone(o, t, 0.08, { f: 880, g: 0.2 }); tone(o, t + 0.07, 0.1, { f: 1320, g: 0.2 }); }
    else if (kind === 'deny') tone(o, t, 0.15, { f: 220, g: 0.25, wave: 'square' });
    else if (kind === 'bolt') { noise(o, t, 0.06, { type: 'bandpass', f: 1200, q: 2, g: 0.7 }); noise(o, t + 0.18, 0.06, { type: 'bandpass', f: 1700, q: 2, g: 0.7 }); }
    else if (kind === 'tick') tone(o, t, 0.03, { f: 1500, g: 0.12, wave: 'square' });
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
  const killPitch = [960, 1080, 1215, 1365, 1540];
  A.killSting = function (info) {
    if (!ctx) return;
    const t = ctx.currentTime, duck = gunBus.gain;
    duck.cancelScheduledValues(t);
    duck.setTargetAtTime(0.708, t, 0.004);
    duck.setTargetAtTime(1, t + 0.15, 0.026);
    if (sting) sting.gain.setTargetAtTime(0, t, 0.008);
    sting = out(null, 1, 1.1);

    const tier = G.clamp(info.multi | 0, 1, 5);
    const pitch = killPitch[tier - 1] * (info.knife ? 0.88 : info.headshot ? 1.14 : 1);
    tone(sting, t, 0.12, { f: info.grenade ? 128 : 163, f2: 46, g: 0.99, wave: 'triangle', att: 0.002 });
    tone(sting, t + 0.006, 0.14, { f: pitch, g: 0.85, wave: 'triangle', att: 0.002 });
    tone(sting, t + 0.005, 0.066, { f: pitch * 2.31, f2: pitch * 2.18, g: 0.55, att: 0.001 });
    tone(sting, t + 0.047, 0.15, { f: pitch * 1.34, g: 0.47, att: 0.003 });
    if (tier > 1) tone(sting, t + 0.09, 0.18, { f: pitch * (tier >= 4 ? 2 : 1.68), g: 0.46, wave: 'triangle' });
    if (info.headshot) tone(sting, t + 0.017, 0.19, { f: pitch * 3.15, f2: pitch * 2.82, g: 0.38 });
    if (info.knife) noise(sting, t, 0.092, { type: 'bandpass', f: 4550, f2: 1270, q: 2.8, g: 0.82 });
    if (info.grenade) noise(sting, t + 0.016, 0.17, { f: 560, f2: 84, g: 0.89, brown: true });
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
  A.roundLive = function () {
    A.radio('start');
    A.stopClutch();
    cue('roundStart');
    A.announce('v_start', 1, 0.25);
  };
  A.roundEnd = function (won, mvpMine) {
    clutch = null;
    if (!cue(mvpMine ? 'mvp' : won ? 'win' : 'lose')) A.radio(won ? 'win' : 'lose');
    A.announce(won ? 'v_round_winner' : 'v_mission_failed', 7, 0.3);   // always heard, even after a clutch line
  };
  // the player is the last one standing on their team: tension music until the round is decided
  A.clutch = function () {
    if (clutch) return;
    clutch = cue('clutch');
    A.announce('v_last_man_standing', 4, 0.2);
  };
  A.stopClutch = function () { if (clutch) { clutch.stop(0.6); clutch = null; } };
  A.bombTen = function (seconds) { cue('bombTicking', { seconds }); };
  A.practiceStart = function () { cue('practiceStart'); A.announce('v_team_deathmatch', 2, 0.3); };
  A.stopMusic = function () { clutch = null; if (G.Music && G.Music.stopAll) G.Music.stopAll(0.4); };
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
