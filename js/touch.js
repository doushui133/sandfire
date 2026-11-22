// touch.js — input mode, floating stick and independent pointer ownership.
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
    enabled: false, primary, portrait: false, joystick: { x: 0, y: 0 }, pointers: new Map(),
  };
  const settings = G.settings;
  if (!['auto', 'touch', 'mouse'].includes(settings.mode)) settings.mode = 'auto';
  if (!(settings.touchSens >= 0.5 && settings.touchSens <= 3)) settings.touchSens = 1.5;

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
  function syncOptions() {
    options.forEach((el) => {
      if (el.type === 'range') el.value = settings[el.dataset.setting];
      else el.checked = !!settings[el.dataset.setting];
    });
    document.body.style.setProperty('--button-size', G.clamp(settings.buttonSize, 0.8, 1.4));
  }
  options.forEach((el) => el.addEventListener(el.type === 'range' ? 'input' : 'change', async () => {
    const key = el.dataset.setting;
    settings[key] = el.type === 'range' ? +el.value : el.checked;
    if (key === 'fullscreen' && !settings.fullscreen && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (e) { }
    }
    if (key === 'gyro' && el.checked) {
      const motion = window.DeviceMotionEvent;
      try { if (motion && motion.requestPermission) settings.gyro = (await motion.requestPermission()) === 'granted'; }
      catch (e) { settings.gyro = false; }
    }
    syncOptions(); G.saveSettings();
  }));
  syncOptions();
  document.querySelectorAll('.direct-address').forEach((el) => { el.hidden = !G.embedded; });
  const playable = () => T.enabled && !T.portrait && inp.active && !G.paused && !G.HUD.buyOpen && !G.HUD.scoresOpen;
  window.addEventListener('devicemotion', (e) => {
    if (!settings.gyro || !playable() || !e.rotationRate) return;
    const r = e.rotationRate, dt = G.clamp((e.interval || 16) / 1000, 0, 0.05);
    const angle = screen.orientation ? screen.orientation.angle : window.orientation || 0;
    const sin = Math.sin(angle*Math.PI/180), cos = Math.cos(angle*Math.PI/180);
    inp.dx -= ((r.beta || 0)*sin + (r.gamma || 0)*cos)*dt*6;
    inp.dy += ((r.gamma || 0)*sin - (r.beta || 0)*cos)*dt*6;
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
      if (cancelled) { inp.rightPressed=false; G.Nades.cancel(G.Player.agent); }
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
    buttons.crouch.setAttribute('aria-pressed', 'false');
  };
  T.sync = function () {
    const show = playable();
    if (layer.hidden === show) {
      layer.hidden = !show; document.body.classList.toggle('touch-playing', show);
      if (!show) T.reset();
    }
    if (!show) return;
    const p = G.Player.agent, it = G.Weapons.current(p), nade = p.cur === 'grenade';
    layer.classList.toggle('spectator', !p.alive);
    setHidden(buttons.scope, !(nade || (it && it.def.scope)));
    const label = nade ? '近抛' : '开镜';
    if (buttons.scope.textContent !== label) buttons.scope.textContent = label;
    setHidden(buttons.heavy, !(it && it.def.melee));
    setHidden(buttons.leftFire, !settings.leftFire);
    setHidden(buttons.buy, !G.Game.canBuy(p));
    buttons.use.classList.toggle('available', !$('hint').hidden || p.planting || p.defusing);
  };
  function setHidden(el, hide) { if (el.hidden !== hide) el.hidden = hide; }
  function moveStick(p, x, y) {
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    const scale = dist <= 5.8 ? 0 : Math.min(1, dist / 58) / dist;
    T.joystick.x = dx * scale; T.joystick.y = dy * scale;
    knob.style.transform = 'translate(' + (58 * T.joystick.x) + 'px,' + (58 * T.joystick.y) + 'px)';
  }
  function start(id, target, x, y, real) {
    const b = target.closest('[data-action],[data-slot]');
    let action = b ? b.dataset.action || 'slot' : x < innerWidth * 0.45 ? 'move' : 'look';
    if (!G.Player.agent.alive && !['pause','scores','buy'].includes(action)) action = 'look';
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
      inp.dx += G.clamp(x - p.x, -48, 48); inp.dy += G.clamp(y - p.y, -48, 48);
      p.x = x; p.y = y;
    }
  }
  function handleTouch(e) {
    if (!playable()) return;
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
  for (const type of ['touchstart','touchmove','touchend','touchcancel']) document.addEventListener(type, handleTouch, { passive:false });
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) window.addEventListener(type, (e) => {
    if (!playable() || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    const id = 'p' + e.pointerId;
    if (type === 'pointerdown' && e.button === 0) start(id, e.target, e.clientX, e.clientY, false);
    else if (type === 'pointermove') move(id, e.clientX, e.clientY);
    else if (type !== 'pointerdown') release(id, type === 'pointercancel');
  });
  window.addEventListener('blur', () => { if (T.enabled) T.reset(); });
  document.addEventListener('visibilitychange', () => { if (T.enabled) T.reset(); });
})(window.G);
