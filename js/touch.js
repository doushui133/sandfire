// touch.js — input mode, floating stick, layout editor and independent pointer ownership.
(function (G) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const matches = (query) => window.matchMedia && window.matchMedia(query).matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = ios || /Android/i.test(navigator.userAgent);
  const primary = () => mobile || matches('(pointer: coarse)');
  const inp = G.input, layer = $('touchLayer'), stick = $('stick'), knob = stick.firstElementChild;
  const surface = $('touchSurface'), fan = $('grenadeFan'), useIcon = $('touchUseIcon'), hint = $('hint');
  const buttons = {};
  layer.querySelectorAll('[data-action]').forEach((b) => { buttons[b.dataset.action] = b; });
  const modes = Array.from(document.querySelectorAll('[data-mode]'));
  const T = G.Touch = {
    enabled: false, primary, portrait: false, joystick: { x: 0, y: 0 }, pointers: new Map(), editing: false, lookTime: 0,
  };
  const settings = G.settings;
  if (!['auto', 'touch', 'mouse'].includes(settings.mode)) settings.mode = 'auto';
  if (!(settings.touchSens >= 0.5 && settings.touchSens <= 3)) settings.touchSens = 1.5;

  // Default centers are in button units from the nearest edge. Edited centers use safe-area fractions.
  const NAMES = {
    fire: '开火', leftFire: '左开火', jump: '跳', crouch: '蹲', reload: '换弹', scope: '开镜', heavy: '重击',
    grenade: '投掷', use: '使用', cycle: '武器', map: '地图', buy: '购买', scores: '比分', pause: '暂停',
  };
  const ORDER = ['fire', 'jump', 'crouch', 'reload', 'scope', 'heavy', 'grenade', 'use', 'cycle', 'leftFire', 'map', 'buy', 'scores', 'pause'];
  const DEFAULTS = {
    opacity: 0.7,
    buttons: {
      fire: { x: -0.86, y: -1.05, s: 1.52 },
      jump: { x: -2.22, y: -2.14, s: 1.08 },
      crouch: { x: -2.22, y: -0.76, s: 1.08 },
      reload: { x: -0.75, y: -2.59, s: 1 },
      scope: { x: -3.35, y: -1.18, s: 1 },
      heavy: { x: -3.35, y: -1.18, s: 1 },
      cycle: { x: -3.4, y: -2.35, s: 1 },
      grenade: { x: 0.82, y: -0.76, s: 1 },
      use: { x: 2, y: -0.76, s: 1 },
      leftFire: { x: 0.75, y: -2.65, s: 1.08 },
      map: { x: -3.35, y: 0.63, s: 0.70 },
      buy: { x: -2.45, y: 0.63, s: 0.70 },
      scores: { x: -1.55, y: 0.63, s: 0.70 },
      pause: { x: -0.65, y: 0.63, s: 0.70 },
    },
  };
  const OLD_CENTERS = {
    fire: [0.90, 0.80], jump: [0.76, 0.68], crouch: [0.76, 0.90], reload: [0.955, 0.58],
    scope: [0.63, 0.68], heavy: [0.63, 0.68], grenade: [0.30, 0.50], use: [0.43, 0.50],
    leftFire: [0.11, 0.58], buy: [0.78, 0.08], scores: [0.865, 0.08], pause: [0.95, 0.08],
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
    const out = { version: 2, opacity: num(src.opacity, 0.25, 1, DEFAULTS.opacity), buttons: {} };
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], d = DEFAULTS.buttons[k], b = buttonsIn[k] || {};
      const old = OLD_CENTERS[k], migrate = src.version !== 2 && old && b.x === old[0] && b.y === old[1];
      out.buttons[k] = {
        x: migrate || b.x == null ? null : num(b.x, 0.03, 0.97, null),
        y: migrate || b.y == null ? null : num(b.y, 0.03, 0.97, null),
        s: num(b.s, 0.6, 2, d.s),
      };
    }
    return out;
  }
  settings.touchLayout = sanitizeLayout(settings.touchLayout);
  T.layout = settings.touchLayout;

  function buttonUnit(area) {
    const size = G.clamp(+settings.buttonSize || 1, 0.8, 1.4);
    const short = Math.min(innerWidth, innerHeight);
    return Math.min(G.clamp(short * 0.085, 54, 88) * size, area.w * 0.11, area.h * 0.19);
  }
  function safeArea() {
    const probe = $('safeProbe');
    if (probe && probe.getBoundingClientRect) {
      const r = probe.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { x: 0, y: 0, w: window.innerWidth || 740, h: window.innerHeight || 360 };
  }
  let area, unit, stickRadius;
  function buttonCenter(fraction, edge, span, half) {
    const position = fraction == null ? (edge < 0 ? span : 0) + edge * unit : fraction * span;
    return G.clamp(position, half + 4, span - half - 4);
  }
  function applyLayout() {
    const L = settings.touchLayout;
    if (!L || !L.buttons) return;
    T.layout = L;
    layer.style.setProperty('--touch-opacity', String(L.opacity));
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], b = buttons[k], p = L.buttons[k], d = DEFAULTS.buttons[k];
      if (!b || !p || !b.style) continue;
      const size = Math.max(28, Math.round(unit * p.s));
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.left = (area.x + buttonCenter(p.x, d.x, area.w, size / 2) - size / 2) + 'px';
      b.style.top = (area.y + buttonCenter(p.y, d.y, area.h, size / 2) - size / 2) + 'px';
    }
  }
  function measureLayout() {
    area = safeArea();
    unit = buttonUnit(area);
    stickRadius = G.clamp(Math.min(area.w, area.h) * 0.125, 44, 100);
    document.body.style.setProperty('--button-unit', unit + 'px');
    layer.style.setProperty('--stick-radius', stickRadius + 'px');
    applyLayout();
  }
  T.applyLayout = measureLayout;

  let lastWide = innerWidth >= innerHeight;
  function resize() {
    // Browser toolbars resize the page during play (iOS Safari); only a rotation drops held touches.
    const wide = innerWidth >= innerHeight;
    if (wide !== lastWide) {
      lastWide = wide;
      if (T.pointers.size || usePulse) T.reset();
      editPts.clear(); pinch = null;
    }
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
    measureLayout();
  }
  function applyMode() {
    const wasEnabled = T.enabled;
    T.enabled = settings.mode === 'touch' || (settings.mode === 'auto' && primary());
    if (G.DR && wasEnabled !== T.enabled) G.DR.pending = true;
    document.body.classList.toggle('touch', T.enabled);
    modes.forEach((b) => {
      const selected = settings.mode === b.dataset.mode;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-pressed', selected);
    });
    $('iosTip').hidden = !ios || navigator.standalone || matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)');
    resize();
    if (wasEnabled && !T.enabled) T.sync();
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
    document.body.style.setProperty('--radar-scale', G.clamp(+settings.radarScale || 1, 0.75, 1.45));
    measureLayout();
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
  const playable = () => T.enabled && !T.portrait && !T.editing && inp.active && !G.paused && G.HUD && !G.HUD.buyOpen && !G.HUD.scoresOpen && !G.HUD.mapOpen;
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
  const altAction = (action) => action === 'heavy' || action === 'scope';
  const WEAPON_SLOTS = ['primary', 'pistol', 'knife', 'bomb'];
  const GRENADE_NAMES = { he: '高爆', flash: '闪光', smoke: '烟雾', molotov: '燃烧', incendiary: '燃烧' };
  const FAN_DELAY = 220;
  let moveId = null, lookId = null, useId = null, usePulse = false;
  let fanOwner = null, fanChoices = [], fanIndex = -1;
  let spectator, scopeLabel, useAvailable, pickupId, iconRev;

  function iconUrl(id) {
    const url = G.Icons && G.Icons.get && G.Icons.get(id);
    return typeof url === 'string' ? url : '';
  }
  function openFan(p) {
    if (p.fan || !playable() || !G.Player.agent.alive) return;
    p.fan = true;
    const a = G.Player.agent, W = G.Weapons;
    const owned = typeof W.grenadeList === 'function' ? W.grenadeList(a) :
      W.grenades.filter((id) => a.nades[id] > 0).map((id) => ({ id, count: a.nades[id] }));
    if (!owned.length) return;

    fanOwner = p;
    const rect = buttons.grenade.getBoundingClientRect();
    const size = Math.max(46, unit * 0.86), half = size / 2;
    const radius = Math.max(size * 1.8, rect.height / 2 + half + 8);
    const spread = Math.min((owned.length - 1) * 0.64, Math.PI * 0.85);
    const reach = Math.sin(spread / 2) * radius + half + 4;
    const cx = G.clamp(rect.left + rect.width / 2, area.x + reach, area.x + area.w - reach);
    const cy = rect.top + rect.height / 2;
    const direction = cy - radius - half >= area.y ? -1 : 1;
    for (let i = 0; i < owned.length; i++) {
      const item = owned[i], angle = owned.length === 1 ? 0 : spread * (i / (owned.length - 1) - 0.5);
      const x = cx + Math.sin(angle) * radius;
      const y = G.clamp(cy + direction * Math.cos(angle) * radius, area.y + half + 4, area.y + area.h - half - 4);
      const node = document.createElement('div'), url = iconUrl(item.id);
      const label = GRENADE_NAMES[item.id] || item.name || '投掷物';
      node.className = 'grenade-choice';
      node.style.left = x - half + 'px'; node.style.top = y - half + 'px';
      node.style.width = node.style.height = size + 'px';
      if (url) {
        const image = document.createElement('img');
        image.src = url; image.alt = label;
        node.appendChild(image);
      }
      const text = document.createElement('small');
      text.textContent = url ? '×' + item.count : label + ' ×' + item.count;
      node.appendChild(text); fan.appendChild(node);
      fanChoices.push({ id: item.id, x, y, half, node });
    }
    fan.hidden = false;
  }
  function pointFan(x, y) {
    let next = -1;
    for (let i = 0; i < fanChoices.length; i++) {
      const choice = fanChoices[i];
      if (Math.hypot(x - choice.x, y - choice.y) <= choice.half) { next = i; break; }
    }
    if (fanIndex === next) return;
    if (fanIndex >= 0) fanChoices[fanIndex].node.classList.remove('picked');
    fanIndex = next;
    if (next >= 0) fanChoices[next].node.classList.add('picked');
  }
  function closeFan() {
    fan.hidden = true;
    fan.textContent = '';
    fanChoices.length = 0;
    fanIndex = -1;
    fanOwner = null;
  }
  function selectGrenade(a, id) {
    const W = G.Weapons;
    if (typeof W.selectGrenade === 'function') { W.selectGrenade(a, id); return; }
    if (!a.nades[id]) return;
    if (a.cur === 'grenade') {
      if (a.inv.grenade && a.inv.grenade.id === id) return;
      G.Nades.cancel(a);
      a.inv.grenade = W.item(id);
      G.VM.onSwitch();
    } else {
      a.inv.grenade = W.item(id);
      W.switchTo(a, 'grenade');
    }
  }
  function cycleWeapon(a) {
    const current = WEAPON_SLOTS.indexOf(a.cur);
    for (let i = 1; i <= WEAPON_SLOTS.length; i++) {
      const slot = WEAPON_SLOTS[(current + i) % WEAPON_SLOTS.length];
      if (a.inv[slot]) { G.Weapons.switchTo(a, slot); return; }
    }
  }
  function release(id, cancelled) {
    const p = T.pointers.get(id);
    if (!p) return;
    T.pointers.delete(id);
    if (buttons[p.action]) buttons[p.action].classList.remove('held');
    if (p.action === 'move') {
      moveId = null;
      T.joystick.x = T.joystick.y = 0;
      stick.classList.remove('held');
    } else if (p.action === 'look') {
      lookId = null;
    } else if (fireAction(p.action)) {
      inp.left = false;
      for (const other of T.pointers.values()) if (fireAction(other.action)) inp.left = true;
      if (cancelled && !inp.left) { inp.leftPressed = false; G.Nades.cancel(G.Player.agent); }
    } else if (altAction(p.action)) {
      inp.right = false;
      for (const other of T.pointers.values()) if (altAction(other.action)) inp.right = true;
      if (cancelled && !inp.right) { inp.rightPressed = false; G.Nades.cancel(G.Player.agent); }
    } else if (p.action === 'use') {
      useId = null;
      usePulse = !cancelled && !p.used;
      inp.keys.KeyE = usePulse;
      if (cancelled) delete inp.pressed.KeyE;
    } else if (p.action === 'grenade') {
      clearTimeout(p.timer);
      if (!cancelled && playable() && G.Player.agent.alive) {
        if (!p.fan && G.now() - p.start >= FAN_DELAY) openFan(p);
        if (fanOwner === p) {
          pointFan(p.x, p.y);
          if (fanIndex >= 0) selectGrenade(G.Player.agent, fanChoices[fanIndex].id);
        } else if (!p.fan && Math.hypot(p.x - p.beginX, p.y - p.beginY) <= unit * 0.45) {
          inp.pressed.Digit4 = true;
        }
      }
      if (fanOwner === p) closeFan();
    } else if (!cancelled && playable()) {
      const a = G.Player.agent;
      if (p.action === 'cycle' && a.alive) {
        if (G.now() - p.start >= 600) inp.pressed.KeyG = true;
        else cycleWeapon(a);
      } else if (p.action === 'map') { G.HUD.toggleMap(true); T.sync(); }
      else if (p.action === 'buy') G.HUD.toggleBuy(true);
      if (p.action === 'scores') G.HUD.showScores(true);
      if (p.action === 'pause') G.pauseGame();
    }
  }
  T.reset = function () {
    for (const id of T.pointers.keys()) release(id, true);
    if (G.Nades && G.Player) G.Nades.cancel(G.Player.agent);
    T.lookTime = 0;
    usePulse = false;
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
    T.lookTime = 0;
    if (useId !== null) T.pointers.get(useId).used = true;
    else if (usePulse) { inp.keys.KeyE = false; usePulse = false; }
    const p = G.Player.agent, it = G.Weapons.current(p), nade = p.cur === 'grenade';
    if (spectator !== !p.alive) {
      spectator = !p.alive;
      layer.classList.toggle('spectator', spectator);
      if (spectator) T.reset();
    }
    setHidden(buttons.scope, !(nade || (it && it.def.scope)));
    const label = nade ? '近抛' : '开镜';
    if (label !== scopeLabel) {
      scopeLabel = label;
      setLabel(buttons.scope, label);
      buttons.scope.setAttribute('aria-label', label);
    }
    setHidden(buttons.heavy, !(it && it.def.melee));
    setHidden(buttons.leftFire, !settings.leftFire);
    setHidden(buttons.buy, !G.Game.canBuy(p));
    const target = p.alive && typeof G.Weapons.pickupTarget === 'function' && G.Weapons.pickupTarget(p);
    const item = target && (target.item || target), id = item ? item.id : '';
    const revision = G.Icons && G.Icons.rev;
    if (id !== pickupId || (id && iconRev !== revision)) {
      pickupId = id;
      const url = iconUrl(id);
      iconRev = G.Icons && G.Icons.rev;
      setHidden(useIcon, !url);
      if (url) useIcon.src = url;
      const name = item && (item.name || (item.def && item.def.name) || (G.Weapons.defs[id] || {}).name);
      setLabel(buttons.use, id ? name || '拾取' : '使用');
      buttons.use.setAttribute('aria-label', id ? '拾取' + (name || '武器') : '使用');
      buttons.use.classList.toggle('has-icon', !!url);
    }
    const available = !!(id || !hint.hidden || p.planting || p.defusing);
    if (available !== useAvailable) { useAvailable = available; buttons.use.classList.toggle('available', available); }
  };
  function setHidden(el, hide) { if (el && el.hidden !== hide) el.hidden = hide; }
  function placeStick(p) {
    stick.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0) translate(-50%,-50%)';
  }
  function moveStick(p, x, y) {
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    const scale = dist > stickRadius ? stickRadius / dist : 1;
    const kx = dx * scale, ky = dy * scale;
    if (scale < 1) {
      p.x = x - kx; p.y = y - ky;
      placeStick(p);
    }
    const gain = dist > stickRadius * 0.05 ? 1 / stickRadius : 0;
    const jx = kx * gain, jy = ky * gain;
    if (jx !== T.joystick.x || jy !== T.joystick.y) {
      knob.style.transform = gain ? 'translate3d(' + kx + 'px,' + ky + 'px,0)' : '';
      T.joystick.x = jx; T.joystick.y = jy;
    }
  }
  // The HUD weapon bar sits under the touch surface: hit-test it by hand. A tap switches at once,
  // because the switch re-renders the bar and that touch's later events may never arrive.
  function slotAt(x, y) {
    const list = document.querySelectorAll('#slots [data-slot]');
    for (let i = 0; i < list.length; i++) {
      const el = list[i], r = el.getBoundingClientRect();
      if (!el.disabled && x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) return el;
    }
    return null;
  }
  function start(id, target, x, y, real, time) {
    const b = target && target.closest && target.closest('[data-action]');
    let action = b && buttons[b.dataset.action] === b ? b.dataset.action : '';
    if (!action && target !== surface) return false;
    const slot = !action && G.Player.agent.alive && slotAt(x, y);
    if (slot) {
      const a = G.Player.agent, nade = slot.dataset.nade;
      if (nade && a.nades[nade]) selectGrenade(a, nade);
      else G.Weapons.switchTo(a, slot.dataset.slot);
      return true;
    }
    const alive = G.Player.agent.alive;
    if (!action) action = alive && x < innerWidth * 0.45 ? 'move' : 'look';
    if ((action === 'move' && moveId !== null) || (action === 'look' && lookId !== null) || T.pointers.has(id)) return true;
    for (const p of T.pointers.values()) if (p.action === action) return true;
    T.realTouch = real;
    const p = { action, x, y, time, start: G.now() };
    T.pointers.set(id, p);
    if (buttons[action]) buttons[action].classList.add('held');
    if (action === 'move') {
      moveId = id;
      placeStick(p);
      knob.style.transform = '';
      stick.classList.add('held');
    } else if (action === 'look') {
      lookId = id;
      if (!alive) inp.leftPressed = true;
    } else if (fireAction(action)) inp.left = inp.leftPressed = true;
    else if (altAction(action)) inp.right = inp.rightPressed = true;
    else if (action === 'use') { useId = id; usePulse = false; inp.keys.KeyE = inp.pressed.KeyE = true; }
    else if (action === 'jump') inp.pressed.Space = true;
    else if (action === 'reload') inp.pressed.KeyR = true;
    else if (action === 'grenade') {
      p.beginX = x; p.beginY = y;
      p.timer = setTimeout(() => { if (T.pointers.get(id) === p) openFan(p); }, FAN_DELAY);
    }
    else if (action === 'crouch') { inp.keys.KeyC = !inp.keys.KeyC; b.setAttribute('aria-pressed', inp.keys.KeyC); }
    return true;
  }
  function move(id, x, y, time) {
    const p = T.pointers.get(id);
    if (!p) return;
    if (p.action === 'move') { moveStick(p, x, y); return; }
    const dx = x - p.x, dy = y - p.y;
    if ((dx || dy) && (p.action === 'look' || (p.action === 'fire' && lookId === null))) {
      inp.dx += dx; inp.dy += dy;
      if (time > p.time) T.lookTime += (time - p.time) / 1000;
    } else if (p.action === 'grenade') {
      if (p.beginY - y >= Math.max(12, unit * 0.23)) openFan(p);
      if (fanOwner === p) pointFan(x, y);
    }
    p.x = x; p.y = y; p.time = time;
  }
  function reconcileTouches(touches) {
    // The browser's active-touch list can reveal a missed end from any subsequent event.
    for (const id of T.pointers.keys()) {
      if (typeof id !== 'number') continue;
      let i = 0;
      while (i < touches.length && touches[i].identifier !== id) i++;
      if (i === touches.length) release(id, true);
    }
  }
  function handleTouch(e) {
    if (T.editing) return;
    const play = playable(), time = e.timeStamp || G.now();
    const startOrMove = e.type === 'touchstart' || e.type === 'touchmove';
    if (startOrMove && T.pointers.size) reconcileTouches(e.touches);
    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i], id = t.identifier;
      if (e.type === 'touchstart') {
        if (play) handled = start(id, t.target || e.target, t.clientX, t.clientY, true, time) || handled;
      } else if (T.pointers.has(id)) {
        handled = true;
        if (play && e.type !== 'touchcancel') move(id, t.clientX, t.clientY, time);
        if (e.type !== 'touchmove') release(id, !play || e.type === 'touchcancel');
      }
    }
    if (!startOrMove && T.pointers.size) reconcileTouches(e.touches);
    if (handled && e.cancelable) e.preventDefault();
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(type, handleTouch, { capture: true, passive: false });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, (e) => {
    if (T.editing || !playable() || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    const id = 'p' + e.pointerId;
    if (type === 'pointerdown' && e.button === 0) {
      if (start(id, e.target, e.clientX, e.clientY, false, e.timeStamp) && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
    } else if (type === 'pointermove' && e.buttons) move(id, e.clientX, e.clientY, e.timeStamp);
    else if (type !== 'pointerdown') release(id, type !== 'pointerup');
  });
  const clearInput = () => { if (T.enabled) T.reset(); };
  window.addEventListener('blur', clearInput);
  window.addEventListener('pagehide', clearInput);
  window.addEventListener('orientationchange', clearInput);
  document.addEventListener('visibilitychange', clearInput);

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
    spectator = false; layer.classList.remove('spectator');
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
    const btn = settings.touchLayout.buttons[p.action];
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
  applyMode();
  if (window.requestAnimationFrame) requestAnimationFrame(measureLayout);
})(window.G);
