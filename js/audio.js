// audio.js — procedural 3D sound (WebAudio). Every sound is synthesised, no files.
(function (G) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null, brownBuf = null;
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
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = G.settings.vol;
    master.connect(comp); comp.connect(ctx.destination);
    // white + brown noise buffers
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
  };
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

  // output node: positional when pos given, otherwise straight to master
  function out(pos, ref, gain) {
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref || 4;
      p.rolloffFactor = 1.1;
      p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(master);
    } else g.connect(master);
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

  const GUN = {
    pistol: { f: 2800, d: 0.16, th: 150, g: 0.75 },
    heavy: { f: 1900, d: 0.3, th: 85, g: 1.1 },
    smg: { f: 3200, d: 0.11, th: 170, g: 0.65 },
    rifle: { f: 2300, d: 0.22, th: 95, g: 1.0 },
    rifle2: { f: 2700, d: 0.19, th: 115, g: 0.9 },
    sniper: { f: 1600, d: 0.5, th: 65, g: 1.45 },
  };
  A.shot = function (kind, pos, local) {
    if (!ctx) return;
    const p = GUN[kind] || GUN.rifle, t = ctx.currentTime;
    const d = local ? 0 : dist(pos);
    const muffle = G.clamp(1 - d / 90, 0.12, 1);
    const o = out(local ? null : pos, 6, local ? 0.9 : 1.3);
    noise(o, t, p.d, { f: p.f * (0.6 + 0.6 * muffle) * G.rand(0.9, 1.1), f2: 300, g: p.g, q: 0.9 });
    noise(o, t, p.d * 3.2, { f: 900 * muffle + 200, f2: 120, g: p.g * 0.35, att: 0.01, brown: true });
    tone(o, t, 0.09, { f: p.th, f2: 40, g: p.g * 0.9, wave: 'triangle' });
    if (local) noise(o, t, 0.035, { type: 'highpass', f: 5000, g: 0.25 });
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
    const t = ctx.currentTime, o = out(null, 1, 0.5);
    if (head) {
      tone(o, t, helmet ? 0.35 : 0.18, { f: 2400, g: 0.35 });
      tone(o, t, helmet ? 0.3 : 0.15, { f: 3170, g: 0.2 });
    } else noise(o, t, 0.05, { type: 'bandpass', f: 900, q: 1, g: 0.6 });
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
