// main.js — boot (quality detection, world build), game loop with dynamic resolution,
// pause / mouse-capture flow and menu wiring
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const $ = (id) => document.getElementById(id);
  let lastTeam = 'atk';
  G.loopOn = true;   // tests switch the animation-frame loop off and step frames themselves
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  // ---------- resolution: fixed base, scaled down while frames run long ----------
  const DR = { base: 1, scale: 1, acc: 0, n: 0, t: 0, good: 0, auto: true };
  G.DR = DR;
  function baseRatio(preset) {
    const cap = G.Touch.primary() && preset.key === 'low' ? 1.25 : preset.dprMax;
    return Math.min(window.devicePixelRatio || 1, cap);
  }
  function applySize() {
    const r = G.renderer;
    DR.base = baseRatio(G.Gfx.preset);
    r.setPixelRatio(DR.base * DR.scale);
    r.setSize(innerWidth, innerHeight);
    G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
    G.VM.resize(innerWidth / innerHeight);
  }
  G.setRenderScale = function (s) { DR.scale = G.clamp(s, G.Gfx.preset.scaleMin, G.Gfx.preset.scaleMax); applySize(); };
  function trackFrame(ms) {
    if (!DR.auto || ms <= 0 || ms > 120) return;   // ignore stalls and hidden-tab gaps
    DR.acc += ms; DR.n++; DR.t += ms;
    if (DR.t < 1200 || DR.n < 20) return;
    const avg = DR.acc / DR.n, p = G.Gfx.preset;
    DR.acc = DR.n = DR.t = 0;
    let s = DR.scale;
    if (avg > 19.5) { s = Math.max(p.scaleMin, s * Math.max(0.8, Math.sqrt(16.7 / avg))); DR.good = 0; }
    else if (avg < 17.6 && s < p.scaleMax) { if (++DR.good >= 3) { s = Math.min(p.scaleMax, s * 1.07); DR.good = 0; } }
    else DR.good = 0;
    if (Math.abs(s - DR.scale) > 0.015) { DR.scale = s; applySize(); }
  }

  // Compile every shader the game uses later (guns, soldiers, bomb, effects) before play, so the
  // first time one appears the frame does not stall.
  function warmUp(renderer, scene, camera) {
    const g = new THREE.Group();
    ['knife', 'p10', 'h50', 'v9', 'ar7', 'tr4', 'r90', 'bomb'].forEach((id) => g.add(G.Weapons.makeGunMesh(id)));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2a1a })));   // bomb light
    scene.add(g);
    const dummy = { team: 'atk', name: '·', inv: {}, cur: 'knife', pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    G.BotModel.warm();
    G.BotModel.create(dummy, true);
    G.FX.warm();
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    G.BotModel.remove(dummy);
    scene.remove(g);
    G.FX.clear();
    G.VM.warm(renderer);
  }

  G.boot = async function () {
    const status = $('status');
    const det = G.Gfx.detect();
    const needGL = '需要支持 WebGL2 的浏览器（新版 Chrome / Edge / Safari）。';
    if (!det.webgl2) { status.textContent = needGL; return; }
    const q = G.settings.quality || 'auto';
    const preset = G.Gfx.preset = G.Gfx.PRESETS[q === 'auto' ? (det.soft || G.Touch.primary() ? 'low' : 'high') : q] || G.Gfx.PRESETS.high;
    G.gpu = det;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: preset.aa, powerPreference: 'high-performance', stencil: false }); }
    catch (e) { status.textContent = '无法启动 3D 渲染。' + needGL; return; }
    if (!renderer.capabilities.isWebGL2) { renderer.dispose(); status.textContent = needGL; return; }
    // the tone curve applies the display gamma itself (cheaper than the sRGB curve per pixel)
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.CustomToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.autoClear = false;
    renderer.setClearColor(0xbfae92, 1);
    DR.base = baseRatio(preset);
    renderer.setPixelRatio(DR.base);
    renderer.setSize(innerWidth, innerHeight);
    $('game').appendChild(renderer.domElement);
    G.renderer = renderer;

    const scene = (G.scene = new THREE.Scene());
    const camera = (G.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 900));
    camera.rotation.order = 'YXZ';
    G.Tex.init(renderer);
    G.sunDir = G.Gfx.U.uSunDir.value;
    // three.js lights for the remaining standard materials (soldiers and dropped guns)
    scene.add(new THREE.HemisphereLight(0xc9dcf2, 0xb08d5f, 0.62));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
    sun.position.copy(G.sunDir).multiplyScalar(90);
    scene.add(sun, sun.target);

    const wb = G.Tex.worldBuilder(preset.normals, preset.aniso);
    for (let i = 1; ; i++) {
      status.textContent = '正在生成材质 ' + i + ' / ' + wb.total + '…';
      await yieldFrame();
      if (wb.step()) break;
    }
    status.textContent = '正在搭建小镇…';
    await yieldFrame();
    const geo = G.MapGeo.build();
    G.MapMesh.build(scene, geo, wb.result(), preset);
    status.textContent = '正在载入光照…';
    await G.Gfx.loadLightmaps(geo);
    G.Gfx.buildShadow(renderer, scene, preset.shadow, G.MapMesh.frondTex);
    G.Gfx.makeSky(scene);
    G.FX.init(scene);
    G.VM.init(innerWidth / innerHeight);
    G.Map.radar = G.Map.buildRadar();
    G.HUD.init();
    status.textContent = '正在编译着色器…';
    await yieldFrame();
    warmUp(renderer, scene, camera);

    window.addEventListener('resize', applySize);
    wireMenu();
    status.textContent = '准备就绪 · 选择阵营开始';
    $('btnAtk').disabled = $('btnDef').disabled = false;
    if (/autostart=(atk|def)/.test(location.search)) startMatch(RegExp.$1, true);
    let last = performance.now();
    requestAnimationFrame(function loop(now) {
      requestAnimationFrame(loop);
      const ms = now - last; last = now;
      const dt = Math.min(0.05, ms / 1000);
      if (G.loopOn) { frame(dt, now / 1000); trackFrame(ms); }
    });
  };

  function frame(dt, t) {
    const cam = G.camera, inp = G.input;
    inp.beginFrame(G.now());
    G.Gfx.U.uTime.value = t;
    if (inp.active && !G.paused) {
      G.time += dt;
      G.Game.update(dt);
      G.Player.update(dt);
      G.Bots.update(dt);
      G.FX.update(dt);
      G.VM.update(dt, G.Player.agent, cam);
      G.HUD.update(dt);
    } else if (G.Game.phase === 'menu') {
      const a = t * 0.04;
      cam.position.set(Math.sin(a) * 44, 26, Math.cos(a) * 44);
      cam.lookAt(0, 2, -4);
      if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    }
    inp.endFrame();
    const r = G.renderer;
    r.clear();
    r.render(G.scene, cam);
    const p = G.Player.agent;
    if (inp.active && p && p.alive) G.VM.render(r);
  }
  G.frame = frame;

  // fixed-step simulation helper (used for automated testing in a background tab)
  G.debugStep = function (sec) {
    const dt = 1 / 30;
    for (let i = 0; i < sec * 30; i++) {
      G.input.beginFrame(G.now());
      G.time += dt; G.Game.update(dt); G.Player.update(dt); G.Bots.update(dt); G.FX.update(dt); G.input.endFrame();
    }
  };

  // ---------- pause and mouse capture ----------
  const PAUSE_TEXT = {
    pause: ['已暂停', ''],
    lockfail: ['点击「继续游戏」开始', '游戏需要锁定鼠标来转动视角。刚按过 Esc 的话，浏览器会要求等一秒左右再点。'],
  };
  function showPause(kind, hint) {
    if (!kind) { $('pause').hidden = true; return; }
    $('pauseTitle').textContent = PAUSE_TEXT[kind][0];
    $('pauseHint').textContent = hint !== undefined ? hint : PAUSE_TEXT[kind][1];
    $('sens2').value = G.settings.sens;
    $('pause').hidden = false;
  }
  function pause(auto) {
    const inp = G.input;
    if (!inp.active || G.paused || G.Game.phase === 'over' || (auto && inp.test && !G.Touch.enabled)) return;
    G.paused = true;
    inp.releaseAll();
    G.HUD.toggleBuy(false);
    if (G.Touch.enabled) { G.HUD.showScores(false); G.Touch.sync(); }
    showPause('pause', !G.Touch.enabled && inp.freeLook ? '当前是普通鼠标模式（这个环境不允许锁定鼠标）。' : '');
  }
  G.pauseGame = () => pause(false);
  function resume() {
    const inp = G.input;
    if (!inp.active || G.Touch.portrait) return;
    if (G.Touch.enabled) {
      G.Audio.init(); G.Touch.enterDisplay();
      showPause(null); G.paused = false; G.Touch.sync();
      return;
    }
    inp.left = inp.right = inp.leftPressed = inp.rightPressed = false;   // the click on the button is not a shot
    if (inp.locked || inp.freeLook || inp.test) {
      showPause(null); G.paused = false;
      if (inp.freeLook) G.requestLock();   // switches to full capture if it has become possible
      return;
    }
    $('pauseHint').textContent = '正在锁定鼠标…';
    G.requestLock();
  }
  G.onLockResult = function (ok) {
    $('game').classList.toggle('freelook', G.input.freeLook);
    if (!G.input.active) return;
    if (ok || G.input.freeLook) { showPause(null); G.paused = false; return; }
    G.paused = true;
    showPause('lockfail');
  };
  G.onFallback = function () {
    $('game').classList.add('freelook');
    G.HUD.message('', '这个环境不允许锁定鼠标，已改用普通鼠标模式：移动鼠标转动视角，鼠标停在画面左右边缘会持续转身。用 Chrome 或 Edge 浏览器直接打开本页可获得完整的鼠标锁定。', 9);
  };
  G.onUnlock = () => pause(false);
  // Esc while the mouse is not captured (fallback mode, or the buy menu there)
  G.onEscape = function () {
    if (G.HUD.buyOpen) { G.HUD.toggleBuy(false); return; }
    if (!G.input.freeLook) return;
    if (G.paused) resume(); else pause(false);
  };

  function startMatch(team, test) {
    if (G.Touch.portrait) return;
    lastTeam = team;
    G.Audio.init(); G.Audio.setVolume(G.settings.vol);
    if (G.Touch.enabled && !test) G.Touch.enterDisplay();
    $('menu').hidden = true; $('endScreen').hidden = true; showPause(null);
    $('hud').hidden = false;
    G.input.active = true; G.input.test = !!test;
    G.Game.start(team, G.settings.diff);
    if (G.Touch.enabled) { G.paused = false; G.Touch.sync(); return; }
    if (test) { G.paused = false; return; }
    if (G.input.freeLook) { G.paused = false; G.requestLock(); return; }
    G.paused = true;   // the round starts once the mouse is captured
    G.requestLock();
  }
  G.startMatch = startMatch;
  function toMenu() {
    const inp = G.input;
    inp.active = false; inp.test = false; G.paused = true;
    if (G.Touch.enabled) G.Touch.sync();
    showPause(null); G.HUD.toggleBuy(false); G.HUD.showScores(false);
    G.Game.agents.forEach((a) => G.BotModel.remove(a));
    G.Game.agents = []; G.Player.agent = null; G.Game.phase = 'menu';
    G.Game.clearScene(); G.Weapons.clearDrops(); G.FX.clear();
    $('hud').hidden = true; $('endScreen').hidden = true; $('menu').hidden = false;
    G.releaseLock();
    G.Touch.refreshMode();
  }

  function wireMenu() {
    const diffBtns = [$('d0'), $('d1'), $('d2')];
    const setDiff = (i) => { G.settings.diff = i; diffBtns.forEach((b, k) => b.classList.toggle('on', k === i)); G.saveSettings(); };
    diffBtns.forEach((b, i) => b.addEventListener('click', () => setDiff(i)));
    setDiff(G.settings.diff | 0);
    const qBtns = { auto: $('qAuto'), low: $('qLow'), high: $('qHigh') }, cur = G.settings.quality || 'auto';
    for (const k in qBtns) {
      qBtns[k].classList.toggle('on', k === cur);
      qBtns[k].addEventListener('click', () => {
        if ((G.settings.quality || 'auto') === k) return;
        G.settings.quality = k;
        if (!G.saveSettings()) {
          try { history.replaceState(Object.assign({}, history.state, { sandfireReload: G.settings }), ''); } catch (e) { }
        }
        $('status').textContent = '正在切换画质…';
        setTimeout(() => location.reload(), 60);
      });
    }
    const p = G.Gfx.preset;
    $('qNote').textContent = (p.key === 'low' ? '当前：流畅' : '当前：高') + (G.gpu.soft ? ' · 检测到没有可用显卡（软件渲染），推荐「流畅」' : '');
    const sens = $('sens'), sens2 = $('sens2'), sv = $('sensVal'), vol = $('vol'), raw = $('raw');
    const setSens = (v) => { G.settings.sens = +v; sv.textContent = (+v).toFixed(2); sens.value = v; sens2.value = v; G.saveSettings(); };
    sens.addEventListener('input', () => setSens(sens.value));
    sens2.addEventListener('input', () => setSens(sens2.value));
    setSens(G.settings.sens);
    vol.value = G.settings.vol;
    vol.addEventListener('input', () => { G.settings.vol = +vol.value; G.Audio.setVolume(+vol.value); G.saveSettings(); });
    raw.checked = G.settings.raw !== false;
    raw.addEventListener('change', () => { G.settings.raw = raw.checked; G.saveSettings(); });
    $('btnAtk').addEventListener('click', () => startMatch('atk'));
    $('btnDef').addEventListener('click', () => startMatch('def'));
    $('btnResume').addEventListener('click', resume);
    $('btnQuit').addEventListener('click', toMenu);
    $('btnRestart').addEventListener('click', () => startMatch(lastTeam));
    // safety net: a click on the view captures the mouse if a running match somehow lost it
    G.renderer.domElement.addEventListener('click', () => {
      const inp = G.input;
      if (!G.Touch.enabled && inp.active && !G.paused && !inp.locked && !inp.freeLook && !inp.test) G.requestLock();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
    window.addEventListener('blur', () => { if (G.Touch.enabled || G.input.freeLook) pause(true); });
  }
})(window.G);
