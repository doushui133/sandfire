// touch.js — input mode, floating stick, layout editor and independent pointer ownership.
(function (G) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const matches = (query) => window.matchMedia && window.matchMedia(query).matches;
  const primary = () => matches('(pointer: coarse)') && (!matches('(pointer: fine)') || matches('(hover: none)'));
  const inp = G.input, layer = $('touchLayer'), stick = $('stick'), knob = stick.firstElementChild;
  const buttons = {};
  layer.querySelectorAll('[data-action]').forEach((b) => { buttons[b.dataset.action] = b; });
  const modes = Array.from(document.querySelectorAll('[data-mode]'));
  const T = G.Touch = {
    enabled: false, primary, portrait: false, joystick: { x: 0, y: 0 }, pointers: new Map(), editing: false,
  };
  const settings = G.settings;
  if (!['auto', 'touch', 'mouse'].includes(settings.mode)) settings.mode = 'auto';
  if (!(settings.touchSens >= 0.5 && settings.touchSens <= 3)) settings.touchSens = 1.5;

  // Centers are fractions of the safe area (0,0 top-left). s multiplies the 56px button unit.
  const NAMES = {
    fire: '开火', leftFire: '左开火', jump: '跳', crouch: '蹲', reload: '换弹', scope: '开镜', heavy: '重击',
    grenade: '投掷', use: '使用', buy: '购买', scores: '比分', pause: '暂停',
  };
  const ORDER = ['fire', 'jump', 'crouch', 'reload', 'scope', 'heavy', 'grenade', 'use', 'leftFire', 'buy', 'scores', 'pause'];
  const DEFAULTS = {
    opacity: 0.7,
    buttons: {
      fire: { x: 0.90, y: 0.80, s: 1.52 },
      jump: { x: 0.76, y: 0.68, s: 1.08 },
      crouch: { x: 0.76, y: 0.90, s: 1.08 },
      reload: { x: 0.955, y: 0.58, s: 1 },
      scope: { x: 0.63, y: 0.68, s: 1 },
      heavy: { x: 0.63, y: 0.68, s: 1 },
      grenade: { x: 0.30, y: 0.50, s: 1 },
      use: { x: 0.43, y: 0.50, s: 1 },
      leftFire: { x: 0.11, y: 0.58, s: 1.08 },
      buy: { x: 0.78, y: 0.08, s: 0.70 },
      scores: { x: 0.865, y: 0.08, s: 0.70 },
      pause: { x: 0.95, y: 0.08, s: 0.70 },
    },
  };
  function num(v, a, b, d) {
    v = +v;
    if (v < a) return a;
    if (v > b) return b;
    return v === v ? v : d;
  }
  function sanitizeLayout(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const buttonsIn = src.buttons && typeof src.buttons === 'object' ? src.buttons : {};
    const out = { opacity: num(src.opacity, 0.25, 1, DEFAULTS.opacity), buttons: {} };
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], d = DEFAULTS.buttons[k], b = buttonsIn[k] || {};
      out.buttons[k] = { x: num(b.x, 0.03, 0.97, d.x), y: num(b.y, 0.03, 0.97, d.y), s: num(b.s, 0.6, 2, d.s) };
    }
    return out;
  }
  settings.touchLayout = sanitizeLayout(settings.touchLayout);
  T.layout = settings.touchLayout;

  function buttonUnit() {
    const probe = $('unitProbe');
    if (probe && probe.offsetWidth > 0) return probe.offsetWidth;
    const size = G.clamp(+settings.buttonSize || 1, 0.8, 1.4);
    const w = window.innerWidth || 740, h = window.innerHeight || 360;
    return Math.min(56 * size, w * 0.09, h * 0.16);
  }
  function safeArea() {
    const probe = $('safeProbe');
    if (probe && probe.getBoundingClientRect) {
      const r = probe.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { x: 0, y: 0, w: window.innerWidth || 740, h: window.innerHeight || 360 };
  }
  function applyLayout() {
    const L = settings.touchLayout;
    if (!L || !L.buttons) return;
    T.layout = L;
    const area = safeArea(), unit = buttonUnit();
    if (layer && layer.style && layer.style.setProperty) layer.style.setProperty('--touch-opacity', String(L.opacity));
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], b = buttons[k], p = L.buttons[k];
      if (!b || !p || !b.style) continue;
      const size = Math.max(28, Math.round(unit * p.s));
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.left = (area.x + p.x * area.w - size / 2) + 'px';
      b.style.top = (area.y + p.y * area.h - size / 2) + 'px';
    }
  }
  T.applyLayout = applyLayout;

  function resize() {
    const portrait = innerHeight > innerWidth && (T.enabled || (primary() && innerWidth <= 600));
    T.portrait = portrait;
    document.body.classList.toggle('rotate-needed', portrait);
    const style = document.body.style;
    style.setProperty('--view-width', innerWidth + 'px');
    style.setProperty('--view-height', innerHeight + 'px');
    if (portrait && inp.active && G.pauseGame) {
      G.pauseGame();
      if (inp.locked) G.releaseLock();
    }
    applyLayout();
  }
  function applyMode() {
    T.enabled = settings.mode === 'touch' || (settings.mode === 'auto' && primary());
    document.body.classList.toggle('touch', T.enabled);
    modes.forEach((b) => {
      const selected = settings.mode === b.dataset.mode;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-pressed', selected);
    });
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('iosTip').hidden = !ios || navigator.standalone || matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)');
    resize();
  }
  modes.forEach((b) => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode;
    G.saveSettings();
    applyMode();
  }));
  function showSensitivity() {
    $('touchSens').value = $('touchSens2').value = settings.touchSens;
    $('touchSensVal').textContent = Number(settings.touchSens).toFixed(2);
  }
  for (const slider of [$('touchSens'), $('touchSens2')]) slider.addEventListener('input', () => {
    settings.touchSens = Number(slider.value);
    showSensitivity();
    G.saveSettings();
  });
  applyMode();
  T.refreshMode = applyMode;
  if (window.matchMedia) {
    const media = matchMedia('(pointer: coarse)');
    const changed = () => { if (!$('menu').hidden) applyMode(); };
    if (media.addEventListener) media.addEventListener('change', changed);
    else if (media.addListener) media.addListener(changed);
  }
  showSensitivity();
  window.addEventListener('resize', resize);

  // A failed fullscreen request must still allow play and an orientation-lock attempt.
  T.enterDisplay = async function () {
    const root = document.documentElement;
    try {
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (request && !document.fullscreenElement && !document.webkitFullscreenElement) await request.call(root);
    } catch (e) { }
    try { await screen.orientation.lock('landscape'); } catch (e) { }
  };
  // On iOS the first touch-up is an audio activation gesture, including a tap on a menu chip.
  function unlockAudio() {
    if (!T.enabled) return;
    G.Audio.init();
    document.removeEventListener('pointerup', unlockAudio, true);
  }
  document.addEventListener('pointerup', unlockAudio, true);
  document.addEventListener('gesturestart', (e) => { if (T.enabled) e.preventDefault(); }, { passive: false });

  const options = document.querySelectorAll('[data-setting]');
  function readSetting(el) {
    if (el.type === 'range') return +el.value;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }
  function syncOptions() {
    options.forEach((el) => {
      const v = settings[el.dataset.setting];
      if (el.type === 'range' || el.type === 'color') el.value = v;
      else if (el.type === 'checkbox') el.checked = !!v;
    });
    document.body.style.setProperty('--button-size', G.clamp(+settings.buttonSize || 1, 0.8, 1.4));
    document.body.style.setProperty('--radar-scale', G.clamp(+settings.radarScale || 1, 0.75, 1.45));
    applyLayout();
  }
  options.forEach((el) => el.addEventListener(el.type === 'range' || el.type === 'color' ? 'input' : 'change', async () => {
    const key = el.dataset.setting;
    settings[key] = readSetting(el);
    if (key === 'fullscreen' && !settings.fullscreen && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (e) { }
    }
    if (key === 'gyro' && el.checked) {
      const motion = window.DeviceMotionEvent;
      try { if (motion && motion.requestPermission) settings.gyro = (await motion.requestPermission()) === 'granted'; }
      catch (e) { settings.gyro = false; }
    }
    if (key === 'chColor' && (typeof settings.chColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(settings.chColor))) settings.chColor = '#7dff6a';
    syncOptions(); G.saveSettings();
  }));
  syncOptions();
  document.querySelectorAll('.direct-address').forEach((el) => { el.hidden = !G.embedded; });
  const playable = () => T.enabled && !T.portrait && !T.editing && inp.active && !G.paused && G.HUD && !G.HUD.buyOpen && !G.HUD.scoresOpen;
  window.addEventListener('devicemotion', (e) => {
    if (!settings.gyro || !playable() || !e.rotationRate) return;
    const r = e.rotationRate, dt = G.clamp((e.interval || 16) / 1000, 0, 0.05);
    const angle = screen.orientation ? screen.orientation.angle : window.orientation || 0;
    const sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
    const gSens = (settings.gyroSens >= 0.2 && settings.gyroSens <= 3) ? settings.gyroSens : 1;
    const scale = dt * 6 * gSens;
    inp.dx -= ((r.beta || 0) * sin + (r.gamma || 0) * cos) * scale;
    inp.dy += ((r.gamma || 0) * sin - (r.beta || 0) * cos) * scale;
  });
  const fireAction = (action) => action === 'fire' || action === 'leftFire';
  function release(id, cancelled) {
    const p = T.pointers.get(id);
    if (!p) return;
    T.pointers.delete(id);
    if (buttons[p.action]) buttons[p.action].classList.remove('held');
    if (p.action === 'move') {
      T.joystick.x = T.joystick.y = 0;
      stick.classList.remove('held');
      stick.style.left = stick.style.top = knob.style.transform = '';
    } else if (fireAction(p.action)) {
      inp.left = false;
      for (const other of T.pointers.values()) if (fireAction(other.action)) inp.left = true;
      if (cancelled && !inp.left) { inp.leftPressed = false; G.Nades.cancel(G.Player.agent); }
    } else if (p.action === 'heavy' || p.action === 'scope') {
      inp.right = false;
      if (cancelled) { inp.rightPressed = false; G.Nades.cancel(G.Player.agent); }
    } else if (p.action === 'use') inp.keys.KeyE = false;
    else if (!cancelled && p.action === 'slot' && playable()) {
      const a = G.Player.agent;
      if (a.cur === p.slot && G.now() - p.start >= 600) inp.pressed.KeyG = true;
      else G.Weapons.switchTo(a, p.slot);
    } else if (!cancelled && playable()) {
      if (p.action === 'buy') G.HUD.toggleBuy(true);
      if (p.action === 'scores') G.HUD.showScores(true);
      if (p.action === 'pause') G.pauseGame();
    }
  }
  T.reset = function () {
    for (const id of T.pointers.keys()) release(id, true);
    if (G.Nades && G.Player) G.Nades.cancel(G.Player.agent);
    inp.releaseAll(); inp.endFrame();
    if (buttons.crouch) buttons.crouch.setAttribute('aria-pressed', 'false');
  };
  function setLabel(btn, text) {
    if (!btn) return;
    const s = btn.querySelector ? btn.querySelector('small') : null;
    if (s) { if (s.textContent !== text) s.textContent = text; }
    else if (btn.textContent !== text) btn.textContent = text;
  }
  T.sync = function () {
    if (T.editing) return;
    const show = playable();
    if (layer.hidden === show) {
      layer.hidden = !show; document.body.classList.toggle('touch-playing', show);
      if (!show) T.reset();
    }
    if (!show) return;
    const p = G.Player.agent, it = G.Weapons.current(p), nade = p.cur === 'grenade';
    layer.classList.toggle('spectator', !p.alive);
    setHidden(buttons.scope, !(nade || (it && it.def.scope)));
    setLabel(buttons.scope, nade ? '近抛' : '开镜');
    setHidden(buttons.heavy, !(it && it.def.melee));
    setHidden(buttons.leftFire, !settings.leftFire);
    setHidden(buttons.buy, !G.Game.canBuy(p));
    buttons.use.classList.toggle('available', !$('hint').hidden || p.planting || p.defusing);
  };
  function setHidden(el, hide) { if (el && el.hidden !== hide) el.hidden = hide; }
  const STICK_R = 58;
  function moveStick(p, x, y) {
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    const dead = STICK_R * 0.08;
    if (dist < 0.5) {
      T.joystick.x = T.joystick.y = 0;
      knob.style.transform = '';
      return;
    }
    const vis = dist > STICK_R ? STICK_R : dist;
    knob.style.transform = 'translate(' + (dx / dist * vis) + 'px,' + (dy / dist * vis) + 'px)';
    if (dist <= dead) { T.joystick.x = T.joystick.y = 0; return; }
    let u = (dist - dead) / (STICK_R - dead);
    if (u > 1) u = 1;
    const smooth = u * u * (3 - 2 * u);
    const mag = u * 0.65 + smooth * 0.35;
    T.joystick.x = dx / dist * mag;
    T.joystick.y = dy / dist * mag;
  }
  function hudBlocked(target) {
    return !!(target && target.closest && target.closest('#radar,#mapOverlay,#layoutEditor,#mapFull'));
  }
  function start(id, target, x, y, real) {
    if (!target || !target.closest || hudBlocked(target)) return;
    const b = target.closest('[data-action],[data-slot]');
    let action = b ? b.dataset.action || 'slot' : x < innerWidth * 0.45 ? 'move' : 'look';
    if (!G.Player.agent.alive && !['pause', 'scores', 'buy'].includes(action)) action = 'look';
    T.realTouch = real;
    for (const [key, p] of T.pointers) if (key === id || (action !== 'look' && p.action === action)) release(key, true);
    T.pointers.set(id, { action, x, y, start: G.now(), slot: b && b.dataset.slot });
    if (buttons[action]) buttons[action].classList.add('held');
    if (action === 'move') {
      stick.style.left = 'clamp(calc(var(--left) + 61px),' + x + 'px,calc(100% - var(--right) - 61px))';
      stick.style.top = 'clamp(calc(var(--top) + 61px),' + y + 'px,calc(100% - var(--bottom) - 61px))';
      stick.classList.add('held');
    } else if (fireAction(action)) inp.left = inp.leftPressed = true;
    else if (action === 'look' && !G.Player.agent.alive) inp.leftPressed = true;
    else if (action === 'scope' || action === 'heavy') inp.right = inp.rightPressed = true;
    else if (action === 'use') inp.keys.KeyE = true;
    else if (action === 'jump') inp.pressed.Space = true;
    else if (action === 'reload') inp.pressed.KeyR = true;
    else if (action === 'grenade') inp.pressed.Digit4 = true;
    else if (action === 'crouch') { inp.keys.KeyC = !inp.keys.KeyC; b.setAttribute('aria-pressed', inp.keys.KeyC); }
  }
  function move(id, x, y) {
    const p = T.pointers.get(id);
    if (!p) return;
    if (p.action === 'move') moveStick(p, x, y);
    if (p.action === 'look' || p.action === 'fire') {
      inp.dx += G.clamp(x - p.x, -120, 120); inp.dy += G.clamp(y - p.y, -120, 120);
      p.x = x; p.y = y;
    }
  }
  function handleTouch(e) {
    if (T.editing || !playable()) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i], id = t.identifier;
      if (e.type === 'touchstart') start(id, t.target || e.target, t.clientX, t.clientY, true);
      else if (e.type === 'touchmove') move(id, t.clientX, t.clientY);
      else release(id, e.type === 'touchcancel');
    }
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      for (const id of T.pointers.keys()) {
        if (typeof id !== 'number') continue;
        let present = false;
        for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === id) present = true;
        if (!present) release(id, true);
      }
    }
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(type, handleTouch, { passive: false });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, (e) => {
    if (T.editing || !playable() || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    const id = 'p' + e.pointerId;
    if (type === 'pointerdown' && e.button === 0) start(id, e.target, e.clientX, e.clientY, false);
    else if (type === 'pointermove') move(id, e.clientX, e.clientY);
    else if (type !== 'pointerdown') release(id, type === 'pointercancel');
  });
  window.addEventListener('blur', () => { if (T.enabled) T.reset(); });
  document.addEventListener('visibilitychange', () => { if (T.enabled) T.reset(); });

  // ---------- layout editor ----------
  let editFrom = null, editSel = 'fire', pinch = null;
  const editPts = new Map();
  function selectAction(name) {
    if (!settings.touchLayout.buttons[name]) return;
    editSel = name;
    const nodes = layer.querySelectorAll('[data-action]');
    for (let i = 0; i < nodes.length; i++) nodes[i].classList.toggle('picked', nodes[i].dataset.action === name);
    const pick = $('lePick');
    if (pick) pick.value = name;
    const size = $('leSize');
    if (size) size.value = settings.touchLayout.buttons[name].s;
  }
  function fillPicker() {
    const pick = $('lePick');
    if (!pick || !pick.appendChild || pick._filled) return;
    pick._filled = true;
    for (let i = 0; i < ORDER.length; i++) {
      const o = document.createElement('option');
      o.value = ORDER[i];
      o.textContent = NAMES[ORDER[i]];
      pick.appendChild(o);
    }
  }
  function startEdit(from) {
    fillPicker();
    editFrom = from;
    T.editing = true;
    settings.touchLayout = sanitizeLayout(settings.touchLayout);
    if (from === 'menu' && $('menu')) $('menu').hidden = true;
    if (from === 'pause' && $('pause')) $('pause').hidden = true;
    if ($('layoutEditor')) $('layoutEditor').hidden = false;
    layer.hidden = false;
    layer.classList.add('editing');
    layer.classList.remove('spectator');
    for (let i = 0; i < ORDER.length; i++) if (buttons[ORDER[i]]) buttons[ORDER[i]].hidden = false;
    const op = $('leOpacity');
    if (op) op.value = settings.touchLayout.opacity;
    selectAction(editSel);
    applyLayout();
  }
  function stopEdit(save) {
    T.editing = false;
    editPts.clear(); pinch = null;
    if (save) G.saveSettings();
    if ($('layoutEditor')) $('layoutEditor').hidden = true;
    layer.classList.remove('editing');
    for (let i = 0; i < ORDER.length; i++) if (buttons[ORDER[i]]) buttons[ORDER[i]].classList.remove('picked', 'held');
    if (editFrom === 'menu' && $('menu')) $('menu').hidden = false;
    if (editFrom === 'pause' && $('pause')) $('pause').hidden = false;
    editFrom = null;
    applyLayout();
    T.sync();
  }
  T.startEdit = startEdit;
  function bind(id, ev, fn) { const n = $(id); if (n) n.addEventListener(ev, fn); }
  bind('btnLayout', 'click', () => startEdit('menu'));
  bind('btnLayout2', 'click', () => startEdit('pause'));
  bind('leSave', 'click', () => stopEdit(true));
  bind('leReset', 'click', () => {
    settings.touchLayout = sanitizeLayout(null);
    T.layout = settings.touchLayout;
    applyLayout();
    selectAction(editSel);
    const op = $('leOpacity');
    if (op) op.value = settings.touchLayout.opacity;
    G.saveSettings();
  });
  bind('lePick', 'change', () => { const n = $('lePick'); if (n) selectAction(n.value); });
  bind('leSize', 'input', () => {
    const n = $('leSize');
    if (!n || !settings.touchLayout.buttons[editSel]) return;
    settings.touchLayout.buttons[editSel].s = num(+n.value, 0.6, 2, 1);
    applyLayout();
  });
  bind('leOpacity', 'input', () => {
    const n = $('leOpacity');
    if (!n) return;
    settings.touchLayout.opacity = num(+n.value, 0.25, 1, DEFAULTS.opacity);
    applyLayout();
  });
  function editDown(e) {
    if (!T.editing || !e.target || !e.target.closest || !e.target.closest('#touchLayer')) return;
    const b = e.target.closest('[data-action]');
    const action = b && buttons[b.dataset.action] ? b.dataset.action : null;
    if (action) selectAction(action);
    editPts.set(e.pointerId, { x: e.clientX, y: e.clientY, action: action });
    if (editPts.size >= 2) {
      const pts = Array.from(editPts.values());
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinch = d >= 28 ? { d: d, s: settings.touchLayout.buttons[editSel].s } : null;
    }
    if (e.cancelable) e.preventDefault();
  }
  function editMove(e) {
    if (!T.editing || !editPts.has(e.pointerId)) return;
    const p = editPts.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
    if (editPts.size >= 2) {
      if (!pinch) return;
      const pts = Array.from(editPts.values());
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      settings.touchLayout.buttons[editSel].s = num(pinch.s * d / pinch.d, 0.6, 2, 1);
      applyLayout();
      const size = $('leSize');
      if (size) size.value = settings.touchLayout.buttons[editSel].s;
      return;
    }
    if (!p.action) return;
    const area = safeArea(), btn = settings.touchLayout.buttons[p.action];
    btn.x = num((e.clientX - area.x) / area.w, 0.04, 0.96, btn.x);
    btn.y = num((e.clientY - area.y) / area.h, 0.04, 0.96, btn.y);
    applyLayout();
  }
  function editUp(e) {
    editPts.delete(e.pointerId);
    if (editPts.size < 2) pinch = null;
  }
  window.addEventListener('pointerdown', editDown);
  window.addEventListener('pointermove', editMove);
  window.addEventListener('pointerup', editUp);
  window.addEventListener('pointercancel', editUp);
  layer.addEventListener('touchmove', (e) => { if (T.editing) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (!T.editing || e.repeat || e.code !== 'Escape') return;
    e.preventDefault();
    stopEdit(true);
  });
  if (window.requestAnimationFrame) requestAnimationFrame(applyLayout);
})(window.G);
