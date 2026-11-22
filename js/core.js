// core.js — shared namespace, math helpers, settings, keyboard/mouse input and mouse capture
window.G = window.G || {};
(function (G) {
  'use strict';
  const THREE = window.THREE;
  G.THREE = THREE;
  G.CELL = 2;          // metres per map grid cell
  G.time = 0;          // game clock (seconds, pauses with the game)
  G.paused = true;
  G.now = () => performance.now();   // input clock in ms (tests may replace it)

  // ---------- math ----------
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  G.randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  G.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  G.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  G.seeded = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  G.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  // yaw 0 looks toward -Z, positive yaw turns left (counter-clockwise from above)
  G.forward = function (yaw, pitch, out) {
    out = out || new THREE.Vector3();
    const cp = Math.cos(pitch);
    out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return out;
  };
  G.yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  // r128 treats hex colours as linear; convert so authored sRGB colours render as intended
  G.col = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  G.fixColor = (o) => { if (typeof o.color === 'number') o.color = G.col(o.color); return o; };
  G.eyeHeight = (c) => G.lerp(1.62, 1.16, c);
  G.bodyHeight = (c) => G.lerp(1.8, 1.3, c);
  G.eyePos = function (agent, out) {
    out = out || new THREE.Vector3();
    return out.set(agent.pos.x, agent.pos.y + G.eyeHeight(agent.crouch), agent.pos.z);
  };
  G.dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  G.fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  // ---------- settings (per-viewer convenience only) ----------
  G.settings = { sens: 1, vol: 0.7, diff: 1, raw: true };
  try {
    const saved = JSON.parse(localStorage.getItem('sandfire.settings') || 'null');
    if (saved) Object.assign(G.settings, saved);
  } catch (e) { /* storage unavailable */ }
  // A quality change reloads this tab. Carry its settings across that one reload if storage failed.
  try {
    if (history.state && history.state.sandfireReload) {
      Object.assign(G.settings, history.state.sandfireReload);
      const state = Object.assign({}, history.state);
      delete state.sandfireReload;
      history.replaceState(state, '');
    }
  } catch (e) { }
  G.saveSettings = function () {
    try { localStorage.setItem('sandfire.settings', JSON.stringify(G.settings)); return true; } catch (e) { return false; }
  };

  // ---------- input ----------
  const look = G.look = new G.LookFilter();
  const input = G.input = {
    keys: Object.create(null),
    pressed: Object.create(null),
    dx: 0, dy: 0,
    left: false, right: false, leftPressed: false, rightPressed: false,
    wheel: 0,
    active: false,      // a match is on screen (running or paused)
    locked: false,      // the mouse is captured by the game view
    freeLook: false,    // fallback: this page cannot capture the mouse, so the visible cursor steers
    test: false,        // automated tests feed look input directly
    everLocked: false, lockFails: 0, suppressUntil: 0,
    cursorX: 0, cursorY: 0, cursorIn: false,
  };
  input.down = (code) => !!input.keys[code];
  input.hit = (code) => !!input.pressed[code];
  input.canAim = () => input.locked || input.freeLook || input.test;
  // move this frame's filtered mouse motion into the look delta
  input.beginFrame = function (now) {
    look.frame(now);
    input.dx += look.x; input.dy += look.y;
    look.x = look.y = 0;
  };
  input.endFrame = function () {
    for (const k in input.pressed) delete input.pressed[k];
    input.dx = input.dy = 0;
    input.leftPressed = input.rightPressed = false;
    input.wheel = 0;
  };
  input.releaseAll = function () {
    for (const k in input.keys) delete input.keys[k];
    input.left = input.right = false;
  };

  const blockKeys = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'Backquote', 'KeyB', 'KeyG']);
  const touchMode = () => G.Touch && G.Touch.enabled;
  window.addEventListener('keydown', (e) => {
    if (!input.active || touchMode()) return;
    if (!G.paused && (blockKeys.has(e.code) || e.ctrlKey)) e.preventDefault();
    if (!e.repeat) input.pressed[e.code] = true;
    input.keys[e.code] = true;
    if (e.code === 'Escape' && !input.locked && G.onEscape) G.onEscape();
  });
  window.addEventListener('keyup', (e) => { if (!touchMode()) input.keys[e.code] = false; });

  // Fallback steering by the visible cursor. The reference point is dropped whenever the cursor
  // leaves the page or the window loses focus, so coming back in somewhere else never turns the view.
  const fb = { x: 0, y: 0, has: false };
  window.addEventListener('mousemove', (e) => {
    if (!input.active || touchMode()) return;
    const now = G.now();
    if (input.locked) {
      if (now >= input.suppressUntil) look.push(e.movementX || 0, e.movementY || 0, now);
      return;
    }
    if (!input.freeLook) return;
    input.cursorX = e.clientX; input.cursorY = e.clientY; input.cursorIn = true;
    if (!fb.has) { fb.has = true; fb.x = e.clientX; fb.y = e.clientY; return; }
    const dx = e.clientX - fb.x, dy = e.clientY - fb.y;
    fb.x = e.clientX; fb.y = e.clientY;
    if (Math.abs(dx) > 160 || Math.abs(dy) > 160) return;   // the cursor reappeared somewhere else
    input.dx += dx; input.dy += dy;
  });
  const cursorLeft = () => { fb.has = false; input.cursorIn = false; };
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) cursorLeft(); });
  document.documentElement.addEventListener('mouseleave', cursorLeft);
  window.addEventListener('blur', () => { input.releaseAll(); cursorLeft(); });

  window.addEventListener('mousedown', (e) => {
    if (!input.active || touchMode() || !input.canAim()) return;   // a click that only captures the mouse never fires
    if (e.button === 0) { input.left = true; input.leftPressed = true; }
    if (e.button === 2) { input.right = true; input.rightPressed = true; }
  });
  window.addEventListener('mouseup', (e) => {
    if (touchMode()) return;
    if (e.button === 0) input.left = false;
    if (e.button === 2) input.right = false;
  });
  window.addEventListener('wheel', (e) => { if (input.active && !touchMode() && input.canAim()) input.wheel += Math.sign(e.deltaY); }, { passive: true });
  window.addEventListener('contextmenu', (e) => { if (input.active) e.preventDefault(); });

  // ---------- mouse capture ----------
  // Raw input (unadjustedMovement) reads the mouse directly; on Windows it also avoids the
  // bogus movement spikes of the normal capture path. Browsers without it fall back to the normal one.
  let attempt = null;
  G.requestLock = function () {
    if (touchMode()) return;
    const el = G.renderer && G.renderer.domElement;
    if (input.locked) { if (G.onLockResult) G.onLockResult(true); return; }
    if (!el || typeof el.requestPointerLock !== 'function') { lockFailed(null, 'unsupported'); return; }
    if (attempt) return;
    const at = attempt = { promise: false, done: false };
    at.timer = setTimeout(() => lockFailed(at, 'timeout'), 1600);
    const go = (raw) => {
      let r;
      try { r = raw ? el.requestPointerLock({ unadjustedMovement: true }) : el.requestPointerLock(); }
      catch (err) { if (raw) go(false); else lockFailed(at, err); return; }
      if (r && typeof r.then === 'function') {
        at.promise = true;
        r.then(null, (err) => {
          if (at.done) return;
          if (raw && err && err.name === 'NotSupportedError') go(false);
          else lockFailed(at, err);
        });
      }
    };
    go(G.settings.raw !== false);
  };
  function lockFailed(at, why) {
    if (at) {
      if (at.done || attempt !== at) return;
      at.done = true; clearTimeout(at.timer); attempt = null;
    }
    input.lockFails++;
    // a page that has never been allowed to capture the mouse, twice in a row, probably never will
    if (why === 'unsupported' || (!input.everLocked && input.lockFails >= 2)) enterFallback();
    if (G.onLockResult) G.onLockResult(false, why);
  }
  function enterFallback() {
    if (input.freeLook) return;
    input.freeLook = true; fb.has = false;
    if (G.onFallback) G.onFallback();
  }
  document.addEventListener('pointerlockchange', () => {
    const el = G.renderer && G.renderer.domElement;
    const was = input.locked;
    input.locked = !!el && document.pointerLockElement === el;
    if (input.locked && !was) {
      if (attempt) { attempt.done = true; clearTimeout(attempt.timer); attempt = null; }
      input.everLocked = true; input.lockFails = 0; input.freeLook = false;
      input.suppressUntil = G.now() + 90;   // the first movement after capture can be stale
      look.reset(); input.dx = input.dy = 0;
      if (G.onLockResult) G.onLockResult(true);
    } else if (!input.locked && was) {
      look.reset(); input.releaseAll();
      if (input.active && G.onUnlock) G.onUnlock();
    }
  });
  document.addEventListener('pointerlockerror', () => {
    if (attempt && !attempt.promise) lockFailed(attempt, 'error');
  });
  G.releaseLock = function () {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  };

  // ---------- small shared temporaries ----------
  G.tmp = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
    v4: new THREE.Vector3(), v5: new THREE.Vector3(),
  };
})(window.G);
