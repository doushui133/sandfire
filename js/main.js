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
  // Resizing the canvas clears it, so size changes are only flagged here (`pending`) and applied at the
  // start of the next animation frame, right before it is drawn; resizing after a frame was drawn
  // showed a blank (black) frame each time the scale moved.
  const DR = { base: 1, scale: 1, acc: 0, n: 0, t: 0, good: 0, bad: 0, auto: true, pending: false, touch: false };
  G.DR = DR;
  function baseRatio(preset) {
    // A software rasteriser stays at 1x on the low preset. Real GPUs keep the preset cap,
    // so high and ultra still fill 1x and 1.25x–1.5x displays.
    const cap = G.gpu && G.gpu.soft && preset.key === 'low' ? 1 : preset.dprMax;
    const touch = G.Touch.enabled || G.Touch.primary();
    if (DR.touch !== touch) DR.acc = DR.n = DR.t = DR.good = DR.bad = 0;
    DR.touch = touch;
    const budget = touch ? Math.sqrt(1.1e6 / (innerWidth * innerHeight)) : Infinity;
    return Math.min(window.devicePixelRatio || 1, cap, budget);
  }
  function applySize() {
    restoreMenuCanvas();
    DR.base = baseRatio(G.Gfx.preset);
    G.Video.resize(G.renderer, DR.base, G.settings.renderScale * DR.scale);
    G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
    G.VM.resize(innerWidth / innerHeight);
  }
  G.setRenderScale = function (s) { DR.acc = DR.n = DR.t = DR.good = DR.bad = 0; DR.scale = G.clamp(s, G.Gfx.preset.scaleMin, G.Gfx.preset.scaleMax); applySize(); };
  function trackFrame(ms) {
    if (!DR.auto || ms <= 0 || ms > (DR.touch ? 250 : 120) || document.hidden) return;
    DR.acc += ms; DR.n++; DR.t += ms;
    if (DR.touch ? DR.t < 400 : DR.t < 2000 || DR.n < 30) return;
    const avg = DR.acc / DR.n, p = G.Gfx.preset;
    DR.acc = DR.n = DR.t = 0;
    let s = DR.scale;
    // hysteresis: two slow windows in a row to step down, three with clear headroom to step up, so a
    // frame time hovering near the target never makes the resolution bounce
    if (avg > 19.5) { DR.good = 0; if (++DR.bad >= 2) { s = Math.max(p.scaleMin, s * Math.max(0.85, Math.sqrt(16.7 / avg))); DR.bad = 0; } }
    else if (avg < (DR.touch ? 17.3 : 15.5) && s < p.scaleMax) { DR.bad = 0; if (++DR.good >= 3) { s = Math.min(p.scaleMax, s * 1.06); DR.good = 0; } }
    else DR.good = DR.bad = 0;
    if (Math.abs(s - DR.scale) > 0.01) { DR.scale = s; DR.pending = true; }
  }

  // Compile every shader the game uses later (guns, soldiers, bomb, effects) before play, so the
  // first time one appears the frame does not stall.
  function warmUp(renderer, scene, camera) {
    const g = new THREE.Group();
    G.GunModels.IDS.forEach((id) => {
      const gun = G.GunModels.mesh(id);
      gun.layers.enable(4); g.add(gun);
    });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2a1a })));   // bomb light
    scene.add(g);
    const dummy = { team: 'atk', name: '·', inv: {}, cur: 'knife', pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    G.BotModel.warm();
    G.BotModel.create(dummy, true);
    G.FX.warm();
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    G.Gfx.drawMovingShadow(renderer, scene, camera);
    G.BotModel.remove(dummy);
    scene.remove(g);
    G.FX.clear();
    G.VM.warm(renderer);
  }

  const REAL_BUDGET = { mobile: 5.2e6, desktop: 11.5e6 };

  G.boot = async function () {
    const status = $('status');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch((e) => console.warn('service worker', e));
    }
    const det = G.Gfx.detect();
    $('gpuWarning').hidden = !det.soft;
    const touch = G.Touch.primary();
    G.gpu = det;
    G.Video.defaults(touch, det.soft);
    DR.auto = G.settings.dynamicResolution;
    const query = new URLSearchParams(location.search);
    const needGL = '需要支持 WebGL2 的浏览器（新版 Chrome / Edge / Safari）。';
    if (!det.webgl2) { status.textContent = needGL; return; }
    const q = query.get('quality') || G.settings.quality || 'auto';
    const preset = G.Gfx.preset = G.Gfx.PRESETS[q === 'auto' ? G.Gfx.autoQuality(det, touch) : q] || G.Gfx.PRESETS.high;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: preset.key === 'medium', powerPreference: 'high-performance', stencil: false }); }
    catch (e) { status.textContent = '无法启动 3D 渲染。' + needGL; return; }
    if (!renderer.capabilities.isWebGL2) { renderer.dispose(); status.textContent = needGL; return; }
    // the tone curve applies the display gamma itself (cheaper than the sRGB curve per pixel)
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.CustomToneMapping;
    renderer.toneMappingExposure = 0.71;
    renderer.info.autoReset = false;
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

    G.deferScans = preset.normals;
    const materialStart = performance.now();
    const surfaces = await G.Tex.buildWorld(preset,(i,n) => {
      status.textContent = '正在生成材质 ' + i + ' / ' + n + '…';
    });
    G.deferScans = false;
    G.Tex.buildMs = performance.now() - materialStart;
    status.textContent = '正在搭建小镇…';
    await yieldFrame();
    const geo = G.MapGeo.build();
    G.MapMesh.build(scene, geo, surfaces, preset);
    status.textContent = '正在载入光照…';
    await G.Gfx.loadLightmaps(geo);
    G.Gfx.buildShadow(renderer, scene, preset.shadow, G.MapMesh.frondTex);
    G.Gfx.makeSky(scene);
    G.FX.init(scene);
    G.VM.init(innerWidth / innerHeight);
    G.Map.radar = G.Map.buildRadar();
    G.HUD.init();
    const geoRef = geo;
    G.worldSurfaces = surfaces;
    status.textContent = '正在编译着色器…';
    await yieldFrame();
    G.Video.init(renderer, preset);
    G.Gfx.initMovingShadow(preset.movingShadow);
    applySize();
    warmUp(renderer, scene, camera);
    menuRoot = $('menu');
    menuMotion = !det.soft && preset.key !== 'low' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.addEventListener('resize', () => { DR.pending = true; });
    wireMenu();
    status.textContent = '准备就绪 · 选择阵营开始';
    $('btnAtk').disabled = $('btnDef').disabled = false;
    if (preset.key !== 'low') startRealisticLoads(preset, touch, geoRef, surfaces, status);
    if (/autostart=(atk|def)/.test(location.search)) startMatch(RegExp.$1, true);
    const view = (query.get('view') || '').split(',').map(Number);
    if (query.has('autostart') && view.length === 5 && view.every(Number.isFinite)) {
      frame(1 / 60, 0);
      camera.position.set(view[0], view[1], view[2]); camera.rotation.set(view[4], view[3], 0, 'YXZ');
      G.paused = true; G.loopOn = false; frame(0, 0);
    }
    let last = performance.now();
    requestAnimationFrame(function loop(now) {
      requestAnimationFrame(loop);
      const ms = now - last; last = now;
      // the first frame after the long boot can carry a timestamp from before it ended (ms < 0)
      const dt = G.clamp(ms / 1000, 0, 0.05);
      if (DR.pending) { DR.pending = false; applySize(); }   // clears the canvas: only right before drawing
      if (G.loopOn) {
        frame(dt, now / 1000);
        if (G.Game.phase !== 'menu') { trackFrame(ms); G.Video.stats(ms); }
      }
    });
  };

  let menuRoot, menuMotion, menuRatio = 0, menuStart = 0, nextMenuFrame = 0;
  function restoreMenuCanvas() {
    if (!menuRatio) return;
    G.renderer.setPixelRatio(menuRatio);
    menuRatio = 0;
  }
  function renderMenu(t) {
    const r = G.renderer, cam = G.camera;
    const first = !menuRatio;
    if (first) {
      menuRatio = r.getPixelRatio();
      r.setPixelRatio(Math.min(menuRatio * 0.75, 0.75, 960 / innerWidth, 540 / innerHeight));
      menuStart = t;
      nextMenuFrame = t;
    } else if (menuRoot.hidden || !menuMotion || t + 0.001 < nextMenuFrame) return;
    nextMenuFrame = Math.max(t + 1 / 120, nextMenuFrame + 1 / 30);
    const sweep = menuMotion ? (t - menuStart) * 0.048 : 0;
    const angle = 0.66 + Math.sin(sweep) * 0.44;
    cam.position.set(Math.sin(angle) * 42, 23 + Math.sin(sweep * 2) * 3, Math.cos(angle) * 42);
    cam.lookAt(-5, 2.5, -10);
    if (cam.fov !== 53) { cam.fov = 53; cam.updateProjectionMatrix(); }
    G.Gfx.U.uTime.value = t;
    G.MapMesh.updateDetail(cam);
    r.info.reset();
    r.setRenderTarget(null);
    r.clear();
    r.render(G.scene, cam);
    if (first) menuRoot.classList.add('town-ready');
  }

  let lastActiveFrame = null;
  function frame(dt, t) {
    const cam = G.camera, inp = G.input;
    if (!inp.active && G.Game.phase === 'menu' && menuRoot) {
      lastActiveFrame = null;
      renderMenu(t);
      return;
    }
    restoreMenuCanvas();
    inp.beginFrame(G.now());
    G.Gfx.U.uTime.value = t;
    if (inp.active && !G.paused) {
      const realDt = lastActiveFrame === null || t <= lastActiveFrame ? dt : t - lastActiveFrame;
      lastActiveFrame = t;
      const simDt = dt * G.timeScale;
      G.time += simDt;
      G.Game.update(simDt);
      G.Player.update(simDt, realDt);
      G.Bots.update(simDt);
      G.FX.update(simDt);
      G.VM.update(simDt, G.Player.agent, cam);
      G.Player.orbitCamera();
      G.HUD.update(realDt);
    } else {
      lastActiveFrame = null;
      G.timeScale = 1;
    }
    inp.endFrame();
    const r = G.renderer;
    r.info.reset();
    G.BotModel.updateLOD(cam);
    G.MapMesh.updateDetail(cam);
    G.Gfx.drawMovingShadow(r, G.scene, cam);
    G.Video.begin(r);
    r.clear();
    r.render(G.scene, cam);
    const p = G.Player.agent;
    if (inp.active && p && p.alive && !G.Player.orbit) G.VM.render(r);
    G.Video.end(r);
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
  let requesting = false, retryAt = 0, keyboardGeneration = 0;
  function keyboardOff() {
    keyboardGeneration++;
    G.input.keyboardLocked = false;
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) { }
  }
  function keyboardOn() {
    if (!document.fullscreenElement || !G.input.locked || !G.input.active || G.paused || G.Touch.enabled) return;
    const generation = ++keyboardGeneration;
    if (navigator.keyboard && navigator.keyboard.lock) {
      try { Promise.resolve(navigator.keyboard.lock()).then(() => {
        if (generation === keyboardGeneration) G.input.keyboardLocked = true;
      }, () => {}); } catch (e) { }
    }
  }
  function syncFallbackOffer() {
    const b = $('btnFallback');
    if (!b) return;
    const inp = G.input;
    const show = !G.embedded && !(G.Touch && G.Touch.enabled) && !inp.freeLook && !inp.locked && inp.lockFails >= 2;
    b.hidden = !show;
  }
  function showPause(kind, hint) {
    $('pause').hidden = !kind;
    if (!kind) return;
    $('pauseTitle').textContent = G.Touch.enabled ? '已暂停' : '点击继续';
    $('pauseHint').textContent = hint || (G.Touch.enabled ? '' : '虚拟机或远程桌面中，浏览器可能无法锁定鼠标。');
    $('sens2').value = G.settings.sens;
    syncFallbackOffer();
  }
  function pause(auto) {
    const inp = G.input;
    if (!inp.active || G.Game.phase === 'over' || (auto && inp.test)) return;
    requesting = false; G.paused = true; G.Audio.pause();
    keyboardOff(); G.releaseLock();
    inp.releaseAll(); inp.endFrame(); G.look.reset();
    G.Nades.cancel(G.Player.agent);
    G.HUD.toggleBuy(false); G.HUD.showScores(false); G.Touch.sync();
    showPause('pause');
  }
  G.pauseGame = () => pause(false);
  function resume() {
    const inp = G.input;
    if (!inp.active || G.Touch.portrait) return;
    inp.releaseAll(); inp.endFrame();
    if (G.Touch.enabled || inp.test) {
      if (G.Touch.enabled) { G.Audio.init(); G.Touch.enterDisplay(); }
      showPause(null); G.paused = false; G.Touch.sync();
      return;
    }
    if (G.now() < retryAt) { showPause('wait', '稍等一秒再点击。虚拟机或远程桌面可能无法锁定鼠标。'); return; }
    requesting = true; G.Audio.init();
    showPause('lock', '正在锁定鼠标…');
    G.requestLock();
    const root = document.documentElement;
    if (G.settings.fullscreen && !document.fullscreenElement && root.requestFullscreen) {
      try { Promise.resolve(root.requestFullscreen()).catch(() => {}); } catch (e) { }
    }
  }
  G.onLockResult = function (ok) {
    const inp = G.input;
    $('game').classList.toggle('freelook', inp.freeLook);
    if (!requesting || !inp.active) { if (ok) G.releaseLock(); return; }
    requesting = false;
    if (ok || inp.freeLook) {
      showPause(null); G.paused = false; keyboardOn();
    } else {
      G.paused = true;
      showPause('retry', '稍等一秒再点击。虚拟机或远程桌面可能无法锁定鼠标。');
    }
  };
  G.onFallback = () => G.HUD.message('', '当前使用普通鼠标模式，直接打开游戏可完整锁定鼠标。', 5);
  G.onUnlock = () => {
    retryAt = G.now() + 1000;
    pause(false);
    showPause('wait', '稍等一秒再点击。虚拟机或远程桌面可能无法锁定鼠标。');
  };
  G.onEscape = () => { if (G.HUD.buyOpen) G.HUD.toggleBuy(false); else pause(false); };

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
    G.paused = true; resume();
  }
  G.startMatch = startMatch;
  function toMenu() {
    const inp = G.input;
    requesting = false; keyboardOff();
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

  let bgHint = null;
  function bgLabel() {
    if (!bgHint) {
      bgHint = document.createElement('div');
      bgHint.id = 'bgAssets';
      bgHint.hidden = true;
      bgHint.style.cssText = 'position:fixed;right:10px;bottom:10px;font:12px/1.4 "Microsoft YaHei",sans-serif;color:#ddd;opacity:.82;pointer-events:none;z-index:6;text-shadow:0 1px 2px #000';
      document.body.appendChild(bgHint);
    }
    return bgHint;
  }
  function syncRealProgress(loaded, total, status, menuVisible) {
    const mb = (n) => (n / 1e6).toFixed(1);
    const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    const text = '高清素材 ' + pct + '% · ' + mb(loaded) + ' / ' + mb(total) + ' MB';
    if (menuVisible) status.textContent = text + ' · 可先开始对局';
    const hint = bgLabel();
    if (pct >= 100) { hint.hidden = true; if (menuVisible) status.textContent = '准备就绪 · 选择阵营开始'; }
    else { hint.hidden = false; hint.textContent = text; }
  }
  function startRealisticLoads(preset, touch, geo, surfaces, status) {
    const mobile = touch || preset.key === 'medium' || preset.key === 'low';
    const gunTex = mobile ? 'assets/guns/m/' : 'assets/guns/';
    const charTex = mobile ? 'assets/chars/m/' : 'assets/chars/';
    G.GunModels.setAssetBase(gunTex);
    G.BotModel.setAssetBase(touch ? 'assets/chars/m/' : 'assets/chars/');
    G.VM.setAssetBase(charTex);
    const charTextureDelta = 3.87e6; // Full-size character textures minus the phone variants.
    const budget = (mobile ? REAL_BUDGET.mobile : REAL_BUDGET.desktop) + (Number(mobile) - Number(touch)) * charTextureDelta;
    let loaded = 0;
    const onBytes = (_url, n) => {
      loaded += n;
      syncRealProgress(loaded, budget, status, G.Game.phase === 'menu');
    };
    const prog = { onBytes };
    const steps = [
      () => G.VM.loadArms(prog).then(() => G.VM.invalidateGuns()),
      () => G.GunModels.loadReal(prog).then(() => G.VM.invalidateGuns()),
      () => G.BotModel.loadReal(prog).then(() => G.BotModel.upgradeAgents()),
      () => (preset.normals ? G.Tex.upgradePhotoScans(surfaces, preset, geo, onBytes) : Promise.resolve()),
    ];
    (async () => {
      for (const step of steps) {
        try { await step(); } catch (e) { console.warn('realistic asset step', e); }
      }
      syncRealProgress(budget, budget, status, G.Game.phase === 'menu');
    })();
  }

  function wireMenu() {
    const diffBtns = [$('d0'), $('d1'), $('d2')];
    const setDiff = (i) => { G.settings.diff = i; diffBtns.forEach((b, k) => b.classList.toggle('on', k === i)); G.saveSettings(); };
    diffBtns.forEach((b, i) => b.addEventListener('click', () => setDiff(i)));
    setDiff(G.settings.diff | 0);
    const baseRound = G.Game.newRound;
    G.Game.newRound = function () {
      baseRound.call(G.Game);
      G.BotModel.upgradeAgents();
    };
    G.Video.wire();
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
    $('btnFallback').addEventListener('click', (e) => {
      if (e.stopPropagation) e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
      G.enterFallback();
      requesting = false;
      G.input.releaseAll(); G.input.endFrame();
      G.Audio.init();
      showPause(null); G.paused = false;
      $('game').classList.toggle('freelook', !!G.input.freeLook);
    });
    $('btnQuit').addEventListener('click', toMenu);
    $('btnRestart').addEventListener('click', () => startMatch(lastTeam));
    $('pause').addEventListener('click', (e) => {
      if (!G.Touch.enabled && !e.target.closest('input,label,button,.direct-address,summary,details')) resume();
    });
    document.addEventListener('pointerlockchange', () => { if (!G.input.locked) keyboardOff(); });
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) keyboardOn();
      else { keyboardOff(); if (!G.Touch.enabled && G.input.active) pause(true); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
    window.addEventListener('blur', () => pause(true));
  }
})(window.G);
