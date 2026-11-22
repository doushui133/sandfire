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

  function release(id, cancelled) {
    const p = T.pointers.get(id);
    if (!p) return;
    T.pointers.delete(id);
    try { if (layer.hasPointerCapture(id)) layer.releasePointerCapture(id); } catch (err) { }
    if (buttons[p.action]) buttons[p.action].classList.remove('held');
    switch (p.action) {
      case 'move':
        T.joystick.x = T.joystick.y = 0;
        stick.classList.remove('held');
        stick.style.left = stick.style.top = knob.style.transform = '';
        break;
      case 'fire':
        inp.left = false;
        if (cancelled) inp.leftPressed = false;
        break;
      case 'heavy': inp.right = false; break;
      case 'use': inp.keys.KeyE = false; break;
    }
  }
  T.reset = function () {
    for (const id of T.pointers.keys()) release(id, true);
    inp.releaseAll();
    inp.endFrame();
    buttons.crouch.setAttribute('aria-pressed', 'false');
  };
  const playable = () => T.enabled && !T.portrait && inp.active && !G.paused && !G.HUD.buyOpen && !G.HUD.scoresOpen;
  T.sync = function () {
    const show = playable();
    if (layer.hidden === show) {
      layer.hidden = !show;
      document.body.classList.toggle('touch-playing', show);
      if (!show) T.reset();
    }
    if (!show) return;
    const p = G.Player.agent, it = G.Weapons.current(p);
    layer.classList.toggle('spectator', !p.alive);
    setHidden(buttons.scope, !(it && it.def.scope));
    setHidden(buttons.heavy, !(it && it.def.melee));
    setHidden(buttons.drop, p.cur === 'knife');
    setHidden(buttons.buy, !G.Game.canBuy(p));
    buttons.use.classList.toggle('available', !$('hint').hidden || p.planting || p.defusing);
  };
  function setHidden(el, hidden) { if (el.hidden !== hidden) el.hidden = hidden; }
  function moveStick(p, x, y) {
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    const fraction = G.clamp((dist - 6) / 50, 0, 1);
    const scale = fraction / (dist || 1), draw = Math.min(1, 60 / (dist || 1));
    T.joystick.x = dx * scale;
    T.joystick.y = dy * scale;
    knob.style.transform = 'translate(' + dx * draw + 'px,' + dy * draw + 'px)';
  }
  const menuActions = ['pause', 'buy', 'scores'];
  document.addEventListener('pointerdown', (e) => {
    if (!playable() || !e.target.closest('#touchLayer,#game') || e.button !== 0) return;
    const b = e.target.closest('[data-action]'), left = e.clientX < innerWidth * 0.45;
    const action = b ? b.dataset.action : left ? 'move' : 'look';
    if (menuActions.includes(action)) return; // native taps open overlays on release
    if (!G.Player.agent.alive && action !== 'look') return;
    for (const p of T.pointers.values()) if (p.action === action) return;
    e.preventDefault();
    T.pointers.set(e.pointerId, { action, x: e.clientX, y: e.clientY });
    try { layer.setPointerCapture(e.pointerId); } catch (err) { /* events still reach the layer while over it */ }
    if (b) b.classList.add('held');
    switch (action) {
      case 'move':
        stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
        stick.classList.add('held');
        break;
      case 'look': if (!G.Player.agent.alive) inp.leftPressed = true; break;
      case 'fire': inp.left = inp.leftPressed = true; break;
      case 'scope': inp.rightPressed = true; break;
      case 'heavy': inp.right = true; break;
      case 'use': inp.keys.KeyE = true; break;
      case 'jump': inp.pressed.Space = true; break;
      case 'reload': inp.pressed.KeyR = true; break;
      case 'drop': inp.pressed.KeyG = true; break;
      case 'cycle': inp.wheel = 1; break;
      case 'crouch':
        inp.keys.KeyC = !inp.keys.KeyC;
        b.setAttribute('aria-pressed', inp.keys.KeyC);
        break;
    }
  });
  layer.addEventListener('pointermove', (e) => {
    const p = T.pointers.get(e.pointerId);
    if (!p) return;
    if (p.action === 'move') moveStick(p, e.clientX, e.clientY);
    if (p.action === 'look' || p.action === 'fire') {
      inp.dx += G.clamp(e.clientX - p.x, -48, 48);
      inp.dy += G.clamp(e.clientY - p.y, -48, 48);
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    layer.addEventListener(type, (e) => release(e.pointerId, type !== 'pointerup'));
  }
  window.addEventListener('blur', () => { if (T.enabled) T.reset(); });
  buttons.pause.addEventListener('click', () => { if (playable()) G.pauseGame(); });
  buttons.buy.addEventListener('click', () => { if (playable()) G.HUD.toggleBuy(); });
  buttons.scores.addEventListener('click', () => { if (playable()) G.HUD.showScores(true); });
  $('slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (b && playable() && G.Player.agent.alive) G.Weapons.switchTo(G.Player.agent, b.dataset.slot);
  });
})(window.G);
