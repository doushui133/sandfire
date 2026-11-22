// Node 22+ and Chromium DevTools. Run against the working tree or an untouched baseline copy.
// EDGE_PATH may point at another Chromium executable. No packages or server required.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process'), { pathToFileURL } = require('url');
const dir = path.resolve(process.argv[2] || '.'), quality = process.argv[3] || 'high';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sandfire-edge-'));
const edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-extensions', '--disable-background-networking', '--no-first-run',
    '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let n = 0; !fs.existsSync(portFile); n++) {
    if (n > 150 || edge.exitCode !== null) throw Error('Edge did not expose a debugging port (exit ' + edge.exitCode + ')');
    await delay(100);
  }
  const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.description || a.value).join(' '));
  };
  const call = (method, params) => new Promise(resolve => {
    pending.set(++id, resolve); ws.send(JSON.stringify({id, method, params}));
  });
  async function evaluate(expression) {
    const r = (await call('Runtime.evaluate', {expression, returnByValue: true})).result;
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception.description);
    return r.result.value;
  }
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 960, height: 540, deviceScaleFactor: 1, mobile: false});
  await call('Page.addScriptToEvaluateOnNewDocument', {source:
    'try { localStorage.setItem("sandfire.settings", ' + JSON.stringify(JSON.stringify({quality,vol:0})) + '); } catch(e) {}'});
  const url = pathToFileURL(path.join(dir, 'index.html'));
  url.searchParams.set('quality', quality);
  await call('Page.navigate', {url: url.href});
  const start = Date.now();
  while (!await evaluate('!!window.G && document.getElementById("btnAtk") && !document.getElementById("btnAtk").disabled')) {
    if (Date.now() - start > 120000 || errors.length) throw Error(await evaluate('document.getElementById("status")?.textContent') + '\n' + errors);
    await delay(200);
  }
  const ready = Date.now() - start;
  const results = await evaluate('(' + sample.toString() + ')()');
  if (process.argv[4]) {
    const shot = await call('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(process.argv[4], Buffer.from(shot.result.data, 'base64'));
  }
  console.log(JSON.stringify({ready,results,errors}));
  ws.close();
  if (errors.length) process.exitCode = 1;
}
function sample() {
  G.loopOn = false; Math.random = G.seeded(731); G.startMatch('atk', true);
  G.debugStep(8); G.VM.update(1/30, G.Player.agent, G.camera); G.paused = true;
  const r = G.renderer, info = r.info, rows = [];
  info.autoReset = false;
  for (const [x,y,z,yaw] of [[0,1.62,42,0], [37,1.62,-16,0.65], [-25,1.62,-12,0.42]]) {
    G.camera.position.set(x,y,z); G.camera.rotation.set(-0.04,yaw,0,'YXZ');
    info.reset(); G.frame(0, 8);
    rows.push([info.render.calls, info.render.triangles]);
  }
  return {preset:G.Gfx.preset.key, renderer:G.gpu.name, rows, materialsMs:G.Tex.buildMs, light:G.Gfx.lightmapStatus};
}
run().catch(e => {console.error(e.message);process.exitCode = 1;}).finally(async () => {
  edge.kill();
  await delay(500);
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3}); } catch(e) {}
});
