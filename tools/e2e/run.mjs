import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEdge } from './cdp.mjs';
import { serve } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..', '..');
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SCENARIO_TIMEOUT = 5 * 60 * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const scenarios = [];
  let root = defaultRoot;
  let out = null;
  let noSandbox = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
    else if (a === '--out' && argv[i + 1]) out = path.resolve(argv[++i]);
    else if (a === '--no-sandbox') noSandbox = true;
    else if (a === '--help' || a === '-h') scenarios.length = 0;
    else if (!a.startsWith('-')) scenarios.push(a);
  }
  if (!scenarios.length) scenarios.push('desktop', 'touch', 'views');
  return { scenarios, root, out, noSandbox };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function attachMonitors(page) {
  const issues = [];
  const push = (kind, detail) => issues.push({ kind, detail, at: new Date().toISOString() });
  page.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      const text = params.args?.map((a) => a.value ?? a.description ?? '').join(' ') || '(console error)';
      push('console', text);
    }
  });
  page.on('Runtime.exceptionThrown', (params) => {
    push('exception', params.exceptionDetails?.text ?? params.exceptionDetails?.exception?.description ?? 'uncaught exception');
  });
  page.on('Network.loadingFailed', (params) => {
    if (!params.canceled) push('network', (params.errorText || 'load failed') + ' ' + (params.url || params.requestId || ''));
  });
  return {
    issues,
    reset() { issues.length = 0; },
    hasErrors() { return issues.length > 0; },
  };
}

async function enablePage(page) {
  await page.send('Page.enable', {});
  await page.send('Runtime.enable', {});
  await page.send('Network.enable', {});
}

async function navigate(page, url, timeout = 120000) {
  await page.send('Page.navigate', { url });
  await page.waitFor('Page.loadEventFired', () => true, timeout);
  await pause(300);
}

async function waitUntil(page, expression, timeout = 120000, interval = 500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(expression, Math.min(15000, timeout));
    if (ok) return ok;
    await pause(interval);
  }
  throw new Error('Timed out waiting for: ' + expression.slice(0, 120));
}

async function readGame(page) {
  return page.evaluate(`(() => {
    const G = window.G;
    if (!G) return { ready: false, reason: 'window.G missing' };
    const agent = G.Player?.agent;
    const touch = G.Touch;
    const pointers = touch?.pointers;
    let pointerList = null;
    try {
      if (pointers && typeof pointers.entries === 'function') {
        pointerList = [...pointers.entries()].map(([id, p]) => ({ id, action: p.action, x: p.x, y: p.y }));
      } else if (pointers && typeof pointers === 'object') {
        pointerList = Object.entries(pointers).map(([id, p]) => ({ id: Number(id), action: p.action, x: p.x, y: p.y }));
      }
    } catch (e) { pointerList = { error: String(e) }; }
    const clip = agent ? G.Weapons?.current?.(agent)?.clip : null;
    return {
      ready: true,
      phase: G.Game?.phase ?? null,
      gamePhase: G.Game?.phase ?? null,
      frozen: G.Game?.frozen ?? null,
      inputActive: G.input?.active ?? null,
      paused: G.paused ?? null,
      touchEnabled: touch?.enabled ?? null,
      joystick: touch?.joystick ? { x: touch.joystick.x, y: touch.joystick.y } : null,
      pointers: pointerList,
      agent: agent ? {
        alive: agent.alive,
        pos: { x: agent.pos.x, y: agent.pos.y, z: agent.pos.z },
        yaw: agent.yaw,
        pitch: agent.pitch,
        vel: { x: agent.vel.x, z: agent.vel.z },
      } : null,
      clip,
      pauseVisible: document.getElementById('pause')?.hidden === false,
      touchLayerHidden: document.getElementById('touchLayer')?.hidden,
    };
  })()`);
}

async function elementCenter(page, selector) {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
}

async function touchAt(page, id, type, x, y) {
  await page.touch(type, [{ id, x, y, radiusX: 11, radiusY: 11, force: 1 }]);
}

async function tapSelector(page, selector, id = 1) {
  const pt = await elementCenter(page, selector);
  if (!pt) throw new Error('No tappable rect for ' + selector);
  await touchAt(page, id, 'touchStart', pt.x, pt.y);
  await pause(40);
  await touchAt(page, id, 'touchEnd', pt.x, pt.y);
  return pt;
}

async function tapAction(page, action, id = 1) {
  return tapSelector(page, '[data-action="' + action + '"]', id);
}

async function mouseClick(page, selector) {
  const pt = await elementCenter(page, selector);
  if (!pt) throw new Error('No clickable rect for ' + selector);
  const { x, y } = pt;
  await page.mouse('mouseMoved', { x, y });
  await pause(30);
  await page.mouse('mousePressed', { x, y, button: 'left', clickCount: 1 });
  await pause(30);
  await page.mouse('mouseReleased', { x, y, button: 'left', clickCount: 1 });
  return pt;
}

function matchStarted(state) {
  return !!(
    state?.ready &&
    state.gamePhase && state.gamePhase !== 'menu' &&
    state.agent &&
    state.paused === false
  );
}

const TOUCH_PLAY_EXPR = `(() => {
  const G = window.G;
  if (!G?.Game || G.Game.phase === 'menu' || !G.Player?.agent || G.paused) return false;
  if (G.Game.phase === 'freeze' || G.Game.frozen) return false;
  const layer = document.getElementById('touchLayer');
  if (!layer || layer.hidden) return false;
  return !!(G.Touch?.enabled);
})()`;

function assertion(assertions, name, data) {
  assertions.push({ name, ...data });
}

async function waitForMatchStart(page, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (matchStarted(await readGame(page))) return true;
    await pause(250);
  }
  return false;
}

async function startMatchFromMenu(page) {
  const attempts = [];
  const methods = [
    {
      name: 'touch-tap',
      run: () => tapSelector(page, '#btnAtk', 1),
    },
    {
      name: 'cdp-mouse',
      run: () => mouseClick(page, '#btnAtk'),
    },
    {
      name: 'dom-click',
      run: () => page.evaluate(`(() => {
        const b = document.getElementById('btnAtk');
        if (!b || b.disabled) return { clicked: false, reason: 'btnAtk missing or disabled' };
        b.click();
        return { clicked: true };
      })()`),
    },
  ];
  for (const method of methods) {
    const attempt = { method: method.name, started: true };
    try {
      await method.run();
      attempt.clicked = true;
    } catch (error) {
      attempt.clicked = false;
      attempt.error = error.message;
      attempts.push(attempt);
      continue;
    }
    const started = await waitForMatchStart(page, 45000);
    attempt.stateAfter = await readGame(page);
    attempt.matchStarted = started;
    attempts.push(attempt);
    if (started) {
      return { ok: true, method: method.name, attempts };
    }
    await pause(500);
  }
  const last = attempts.at(-1)?.stateAfter ?? await readGame(page);
  const reason = !last?.ready
    ? 'window.G not ready'
    : last.gamePhase === 'menu'
      ? 'still on menu after touch-tap, cdp-mouse, and dom-click'
      : !last.agent
        ? 'match phase changed but G.Player.agent is null'
        : last.paused !== false
          ? 'match started but G.paused is still true (touch UI not armed)'
          : 'match did not reach playable state';
  return { ok: false, method: null, reason, attempts, state: last };
}

function invalidTouchResult(reason, steps, monitor, extra = {}) {
  return {
    pass: false,
    invalid: true,
    status: 'INVALID',
    reason,
    steps,
    assertions: [],
    browserErrors: monitor.issues,
    ...extra,
  };
}

async function stickGesture(page, touchId, x0, y0, steps = 6, dyPerStep = -55 / 6, holdMs = 1500) {
  const samples = [];
  let x = x0;
  let y = y0;
  await touchAt(page, touchId, 'touchStart', x, y);
  await pause(50);
  samples.push({ t: 'start', state: await readGame(page) });
  for (let i = 0; i < steps; i++) {
    y += dyPerStep;
    await touchAt(page, touchId, 'touchMove', x, y);
    await pause(80);
  }
  const mid = await readGame(page);
  samples.push({ t: 'moved', state: mid });
  await pause(holdMs);
  const held = await readGame(page);
  samples.push({ t: 'held', state: held });
  await touchAt(page, touchId, 'touchEnd', x, y);
  await pause(100);
  const end = await readGame(page);
  samples.push({ t: 'end', state: end });
  return { samples, posDelta: held.agent && samples[0].state.agent ? {
    dx: held.agent.pos.x - samples[0].state.agent.x,
    dz: held.agent.pos.z - samples[0].state.agent.z,
    dist: Math.hypot(held.agent.pos.x - samples[0].state.agent.x, held.agent.pos.z - samples[0].state.agent.z),
  } : null };
}

async function dragTouch(page, touchId, x0, y0, x1, y1, steps = 8, stepMs = 50) {
  await touchAt(page, touchId, 'touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touchAt(page, touchId, 'touchMove', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    await pause(stepMs);
  }
  const after = await readGame(page);
  await touchAt(page, touchId, 'touchEnd', x1, y1);
  return after;
}

async function setViewpoint(page, view) {
  return page.evaluate(`(async () => {
    const v = ${JSON.stringify(view)};
    const G = window.G;
    if (!G?.Player) return { ok: false, reason: 'G.Player missing' };
    if (typeof G.debugView === 'function') {
      G.debugView(v.x, v.y, v.z, v.yaw, v.pitch);
      return { ok: true, method: 'debugView' };
    }
    const agent = G.Player.agent;
    const bodyY = v.y - (typeof G.eyeHeight === 'function' ? G.eyeHeight(0) : 1.6);
    if (agent) {
      agent.pos.set(v.x, Math.max(0, bodyY), v.z);
      agent.vel.set(0, 0, 0);
      agent.yaw = v.yaw;
      agent.pitch = v.pitch;
      agent.alive = true;
    }
    const cam = G.camera;
    if (cam) {
      cam.position.set(v.x, v.y, v.z);
      cam.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
      if (cam.fov !== 74) { cam.fov = 74; cam.updateProjectionMatrix(); }
    }
    G.loopOn = false;
    if (typeof G.frame === 'function') G.frame(0, G.time || 0);
    return { ok: true, method: 'manual', hasDebugView: false };
  })()`);
}

function checkStick(samples, posDelta) {
  const notes = [];
  let pass = true;
  const held = samples.find((s) => s.t === 'held')?.state;
  const end = samples.find((s) => s.t === 'end')?.state;
  if (!held?.joystick) {
    notes.push('G.Touch.joystick not available');
    pass = false;
  } else {
    const mag = Math.hypot(held.joystick.x, held.joystick.y);
    if (mag < 0.05) {
      notes.push('joystick near zero after stick drag — suspected pointer capture bug on #touchLayer');
      pass = false;
    }
    if (held.joystick.y >= -0.02) notes.push('expected joystick.y negative when dragging up, got ' + held.joystick.y);
  }
  if (posDelta && posDelta.dist < 0.3) {
    notes.push('player barely moved (dist=' + posDelta.dist.toFixed(2) + 'm) while stick held');
    pass = false;
  }
  if (end?.joystick && (Math.abs(end.joystick.x) > 0.01 || Math.abs(end.joystick.y) > 0.01)) {
    notes.push('joystick did not reset after touchEnd');
    pass = false;
  }
  if (held?.pointers?.length) notes.push('active pointers after hold: ' + JSON.stringify(held.pointers));
  return { pass, notes };
}

async function runDesktop(page, ctx, monitor) {
  const steps = [];
  const fail = (msg) => { steps.push({ name: 'fail', error: msg }); throw new Error(msg); };
  monitor.reset();
  await page.viewport({ width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(page, ctx.baseUrl + 'index.html');
  await waitUntil(page, `(() => {
    const b = document.getElementById('btnAtk');
    return !!(b && !b.disabled && window.G?.renderer);
  })()`, 180000);
  const menuShot = path.join(ctx.outDir, 'desktop-menu.png');
  await page.screenshot(menuShot);
  steps.push({ name: 'menu-ready', screenshot: menuShot });
  await navigate(page, ctx.baseUrl + 'index.html?autostart=atk');
  await waitUntil(page, `(() => window.G?.Game?.phase && G.Game.phase !== 'menu')()`, 180000);
  await pause(4000);
  const playShot = path.join(ctx.outDir, 'desktop-ingame.png');
  await page.screenshot(playShot);
  const state = await readGame(page);
  steps.push({ name: 'ingame', screenshot: playShot, state });
  if (monitor.hasErrors()) fail('browser errors: ' + JSON.stringify(monitor.issues));
  return { pass: true, steps };
}

async function runTouch(page, ctx, monitor) {
  const steps = [];
  const assertions = [];
  monitor.reset();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      try {
        const raw = localStorage.getItem('sandfire.settings');
        const base = raw ? JSON.parse(raw) : {};
        base.mode = 'touch';
        localStorage.setItem('sandfire.settings', JSON.stringify(base));
      } catch (e) {}
    })();`,
  });
  await page.viewport({ width: 740, height: 360, deviceScaleFactor: 2, mobile: true });
  await page.touchDevice(ANDROID_UA);
  await navigate(page, ctx.baseUrl + 'index.html');
  await waitUntil(page, `(() => {
    const b = document.getElementById('btnAtk');
    return !!(b && !b.disabled && window.G?.renderer);
  })()`, 180000);

  const start = await startMatchFromMenu(page);
  steps.push({ name: 'start-match', startMethod: start.method, attempts: start.attempts, state: start.state });
  if (!start.ok) {
    await page.screenshot(path.join(ctx.outDir, 'touch-menu-stuck.png'));
    return invalidTouchResult(start.reason, steps, monitor, { startAttempts: start.attempts });
  }
  steps.push({ name: 'start-match-ok', startMethod: start.method });

  let playState = null;
  try {
    await waitUntil(page, TOUCH_PLAY_EXPR, 90000);
    playState = await readGame(page);
  } catch (error) {
    playState = await readGame(page);
    await page.screenshot(path.join(ctx.outDir, 'touch-not-playable.png'));
    return invalidTouchResult(
      'timed out waiting for freeze to end and touch layer to show: ' + error.message,
      steps,
      monitor,
      { startMethod: start.method, state: playState },
    );
  }
  steps.push({ name: 'touch-playable', state: playState, startMethod: start.method });
  await page.screenshot(path.join(ctx.outDir, 'touch-ingame.png'));

  let touchId = 2;
  for (let round = 1; round <= 3; round++) {
    const result = await stickGesture(page, touchId++, 150, 270);
    const check = checkStick(result.samples, result.posDelta);
    assertion(assertions, 'stick-' + round, { ...check, posDelta: result.posDelta });
    await page.screenshot(path.join(ctx.outDir, 'touch-stick-' + round + '.png'));
    steps.push({ name: 'stick-' + round, ...check, samples: result.samples.map((s) => ({ t: s.t, joystick: s.state?.joystick, pointers: s.state?.pointers })) });
    await pause(400);
  }

  const yawBefore = (await readGame(page)).agent?.yaw;
  const afterLook = await dragTouch(page, touchId++, 560, 180, 640, 180, 10, 60);
  const yawAfter = afterLook.agent?.yaw;
  const lookPass = yawBefore != null && yawAfter != null && Math.abs(G_wrap(yawAfter - yawBefore)) > 0.02;
  assertion(assertions, 'look-drag', { pass: lookPass, yawBefore, yawAfter });
  steps.push({ name: 'look-drag', pass: lookPass, yawBefore, yawAfter });
  await page.screenshot(path.join(ctx.outDir, 'touch-look.png'));

  const idStick = touchId++;
  const idLook = touchId++;
  await touchAt(page, idStick, 'touchStart', 150, 270);
  await pause(30);
  await touchAt(page, idLook, 'touchStart', 560, 180);
  for (let i = 1; i <= 6; i++) {
    await touchAt(page, idStick, 'touchMove', 150, 270 - i * 9);
    await touchAt(page, idLook, 'touchMove', 560 + i * 12, 180);
    await pause(70);
  }
  await pause(1200);
  const dual = await readGame(page);
  const dualPass = dual.joystick && Math.hypot(dual.joystick.x, dual.joystick.y) > 0.05;
  assertion(assertions, 'dual-touch', { pass: !!dualPass, state: dual });
  steps.push({ name: 'dual-touch', pass: dualPass, joystick: dual.joystick });
  await touchAt(page, idStick, 'touchEnd', 150, 220);
  await touchAt(page, idLook, 'touchEnd', 640, 180);
  await page.screenshot(path.join(ctx.outDir, 'touch-dual.png'));

  const buttonActions = ['jump', 'crouch', 'reload', 'cycle', 'fire'];
  for (const action of buttonActions) {
    const rect = await elementCenter(page, '[data-action="' + action + '"]');
    if (!rect) {
      steps.push({ name: 'button-' + action, skipped: true, reason: 'not visible' });
      continue;
    }
    const before = await readGame(page);
    if (action === 'crouch') {
      const pressedBefore = await page.evaluate(`document.querySelector('[data-action=crouch]')?.getAttribute('aria-pressed')`);
      await tapAction(page, action, touchId++);
      const pressedAfter = await page.evaluate(`document.querySelector('[data-action=crouch]')?.getAttribute('aria-pressed')`);
      const ok = pressedBefore !== pressedAfter;
      assertion(assertions, 'button-crouch', { pass: ok, pressedBefore, pressedAfter });
      steps.push({ name: 'button-crouch', pass: ok, pressedBefore, pressedAfter });
    } else if (action === 'fire') {
      const clipBefore = before.clip;
      await tapAction(page, action, touchId++);
      await pause(200);
      const clipAfter = (await readGame(page)).clip;
      const ok = clipBefore != null && clipAfter != null && clipAfter < clipBefore;
      assertion(assertions, 'button-fire', { pass: ok, clipBefore, clipAfter });
      steps.push({ name: 'button-fire', pass: ok, clipBefore, clipAfter });
    } else {
      await tapAction(page, action, touchId++);
      steps.push({ name: 'button-' + action, tapped: true });
    }
    await pause(300);
  }

  const pauseRect = await elementCenter(page, '[data-action=pause]');
  if (pauseRect) {
    await tapAction(page, 'pause', touchId++);
    await pause(400);
    const paused = await readGame(page);
    const pauseOk = paused.pauseVisible === true;
    assertion(assertions, 'pause-overlay', { pass: pauseOk });
    steps.push({ name: 'pause-overlay', pass: pauseOk });
    await page.screenshot(path.join(ctx.outDir, 'touch-pause.png'));
    await tapSelector(page, '#btnResume', touchId++);
    await pause(500);
    const resumed = await readGame(page);
    const resumeOk = resumed.pauseVisible === false && resumed.paused === false;
    assertion(assertions, 'resume', { pass: resumeOk });
    steps.push({ name: 'resume', pass: resumeOk });
  } else {
    steps.push({ name: 'pause-overlay', skipped: true });
  }

  const failedAssertions = assertions.filter((a) => a.pass === false);
  const pass = failedAssertions.length === 0 && !monitor.hasErrors();
  if (monitor.hasErrors()) steps.push({ browserErrors: monitor.issues });
  return {
    pass,
    status: pass ? 'PASS' : 'FAIL',
    steps,
    assertions,
    failedAssertions,
    startMethod: start.method,
    browserErrors: monitor.issues,
  };
}

function G_wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

async function runViews(page, ctx, monitor) {
  const steps = [];
  monitor.reset();
  const viewsPath = path.join(here, 'views.json');
  const views = JSON.parse(await fs.readFile(viewsPath, 'utf8'));
  await page.viewport({ width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(page, ctx.baseUrl + 'index.html?autostart=atk');
  await waitUntil(page, `(() => window.G?.Game?.phase && G.Game.phase !== 'menu' && G.Player?.agent)`, 180000);
  await pause(3000);
  for (const view of views) {
    const placed = await setViewpoint(page, view);
    await pause(200);
    const shot = path.join(ctx.outDir, 'view-' + view.id + '.png');
    await page.screenshot(shot);
    steps.push({ name: view.id, view, placed, screenshot: shot });
  }
  if (monitor.hasErrors()) return { pass: false, steps, browserErrors: monitor.issues };
  return { pass: true, steps };
}

async function launchWithAngle(noSandbox, signal) {
  for (const angle of ['swiftshader', 'd3d11']) {
    try {
      return { ...(await launchEdge({ angle, noSandbox, signal })), angle };
    } catch (error) {
      if (angle === 'd3d11') throw error;
    }
  }
  throw new Error('Could not launch Edge');
}

async function main() {
  const { scenarios, root, out, noSandbox } = parseArgs(process.argv.slice(2));
  const outDir = out ?? path.join(here, 'out', stamp());
  await fs.mkdir(outDir, { recursive: true });
  const server = await serve(root);
  const baseUrl = server.url;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('overall harness timeout')), SCENARIO_TIMEOUT * scenarios.length + 60000);
  const report = {
    startedAt: new Date().toISOString(),
    root,
    baseUrl,
    outDir,
    scenarios: {},
    graphics: null,
    angle: null,
  };
  let browser;
  try {
    browser = await launchWithAngle(noSandbox, controller.signal);
    report.graphics = browser.graphics;
    report.angle = browser.angle;
    const page = browser.page;
    await enablePage(page);
    const monitor = attachMonitors(page);
    const ctx = { baseUrl, outDir, root };

    for (const name of scenarios) {
      const started = Date.now();
      try {
        if (name === 'desktop') report.scenarios.desktop = await runDesktop(page, ctx, monitor);
        else if (name === 'touch') report.scenarios.touch = await runTouch(page, ctx, monitor);
        else if (name === 'views') report.scenarios.views = await runViews(page, ctx, monitor);
        else report.scenarios[name] = { pass: false, error: 'unknown scenario' };
        report.scenarios[name].durationMs = Date.now() - started;
        if (report.scenarios[name].pass === undefined) report.scenarios[name].pass = true;
      } catch (error) {
        report.scenarios[name] = { pass: false, error: error.message, durationMs: Date.now() - started };
      }
    }
  } finally {
    clearTimeout(deadline);
    if (browser) await browser.close();
    await server.close();
  }

  const reportPath = path.join(outDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const rows = [['Scenario', 'Result']];
  let failed = 0;
  for (const [name, result] of Object.entries(report.scenarios)) {
    const ok = result.pass === true;
    let label = ok ? 'PASS' : (result.invalid || result.status === 'INVALID' ? 'INVALID' : 'FAIL');
    if (!ok) failed++;
    rows.push([name, label]);
  }
  const col = Math.max(...rows.map((r) => r[0].length), 8);
  for (const [a, b] of rows) console.log(a.padEnd(col + 2) + b);
  console.log('\nReport: ' + reportPath);
  console.log('Renderer: ' + (report.graphics?.renderer ?? '(unknown)'));
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});