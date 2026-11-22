import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function websocketTransport(url, signal) {
  signal.throwIfAborted();
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      const timeout = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out')), 5000);
      const finish = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('DevTools WebSocket connection failed')), { once: true });
      socket.addEventListener('close', () => reject(new Error('DevTools WebSocket closed during connection')), { once: true });
      socket.addEventListener('open', finish, { once: true });
      socket.addEventListener('close', finish, { once: true });
    });
  } catch (error) {
    socket.close();
    throw error;
  }
  return {
    bind(receive, close) {
      socket.addEventListener('message', (event) => receive(event.data));
      socket.addEventListener('close', () => close(new Error('DevTools WebSocket closed')));
      socket.addEventListener('error', () => close(new Error('DevTools WebSocket error')));
    },
    write: (message) => socket.send(message),
    close: () => socket.close(),
  };
}

export class CDP {
  #transport;
  #signal;
  #abort;
  #closed;
  #lastId = 0;
  #pending = new Map();
  #listeners = new Set();

  constructor(transport, signal = new AbortController().signal) {
    this.#transport = transport;
    this.#signal = signal;
    this.#abort = () => this.close(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener('abort', this.#abort, { once: true });
    transport.bind((message) => this.#receive(message), (error) => this.close(error));
  }

  #receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.close(new Error('Invalid DevTools message', { cause: error }));
      return;
    }
    if (message.id !== undefined) {
      this.#pending.get(message.id)?.(message.error ? new Error(message.error.message) : null, message.result);
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  send(method, params = {}, { sessionId, timeout = 30000 } = {}) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = ++this.#lastId;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        this.#pending.delete(id);
        if (error) reject(new Error(method + ': ' + error.message, { cause: error }));
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('timed out')), timeout);
      this.#pending.set(id, finish);
      try {
        this.#transport.write(JSON.stringify({ id, method, params, sessionId }));
      } catch (error) {
        finish(error);
      }
    });
  }

  on(method, listener, sessionId) {
    const filter = (message) => {
      if (message.method === method && message.sessionId === sessionId) listener(message.params);
    };
    this.#listeners.add(filter);
    return () => this.#listeners.delete(filter);
  }

  waitFor(method, predicate = () => true, { sessionId, timeout = 30000 } = {}) {
    if (this.#closed) return Promise.reject(this.#closed);
    return new Promise((resolve, reject) => {
      const finish = (error, params) => {
        clearTimeout(timer);
        unsubscribe();
        unsubscribeClose();
        if (error) reject(error);
        else resolve(params);
      };
      const unsubscribe = this.on(method, (params) => {
        try {
          if (predicate(params)) finish(null, params);
        } catch (error) {
          finish(error);
        }
      }, sessionId);
      const unsubscribeClose = this.on('closed', (error) => finish(error));
      const timer = setTimeout(() => finish(new Error(method + ' event timed out')), timeout);
    });
  }

  close(error = new Error('DevTools connection closed')) {
    if (this.#closed) return;
    this.#closed = error;
    this.#signal.removeEventListener('abort', this.#abort);
    for (const finish of this.#pending.values()) finish(error);
    for (const listener of this.#listeners) listener({ method: 'closed', params: error });
    this.#listeners.clear();
    this.#transport.close();
  }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params, timeout) {
    return this.cdp.send(method, params, { sessionId: this.sessionId, timeout });
  }

  on(method, listener) {
    return this.cdp.on(method, listener, this.sessionId);
  }

  waitFor(method, predicate, timeout) {
    return this.cdp.waitFor(method, predicate, { sessionId: this.sessionId, timeout });
  }

  async evaluate(expression, timeout) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, timeout);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async screenshot(filename) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await fs.writeFile(filename, Buffer.from(data, 'base64'));
  }

  async viewport({ width, height, deviceScaleFactor = 1, mobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile,
      screenOrientation: { type: 'landscapePrimary', angle: 90 },
    });
  }

  async touchDevice(userAgent) {
    await this.send('Emulation.setUserAgentOverride', { userAgent, platform: 'Android' });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  touch(type, touchPoints = []) {
    return this.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  mouse(type, params) {
    return this.send('Input.dispatchMouseEvent', { type, ...params });
  }

  key(type, params) {
    return this.send('Input.dispatchKeyEvent', { type, ...params });
  }
}

async function devToolsAddress(profile, running, signal) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    running();
    try {
      const info = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      const [port, endpoint] = info.trim().split(/\r?\n/);
      if (/^\d+$/.test(port) && endpoint?.startsWith('/devtools/browser/')) {
        return 'ws://127.0.0.1:' + port + endpoint;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await pause(100);
  }
  throw new Error('DevToolsActivePort was not created within 8 seconds');
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: 4500,
    });
    killer.once('error', reject);
    killer.once('exit', (code) => {
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error('taskkill failed for Edge PID ' + child.pid + ' (exit ' + code + ')'));
    });
  });
}

export async function launchEdge({ angle, noSandbox, signal }) {
  signal.throwIfAborted();
  const temp = await fs.realpath(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(temp, 'sandfire-e2e-'));
  let child;
  let cdp;
  let stderr = '';
  let childError;
  let shuttingDown;
  const running = () => {
    if (childError) throw childError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Edge exited early (code ' + child.exitCode + ', signal ' + child.signalCode + ')');
    }
  };
  async function close() {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      try {
        await killTree(child);
      } finally {
        cdp?.close();
        if (child?.exitCode === null && child?.pid) child.kill();
        if (path.dirname(profile) === temp && path.basename(profile).startsWith('sandfire-e2e-')) {
          await fs.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
        }
      }
    })();
    return shuttingDown;
  }

  try {
    const flags = [
      '--headless=new', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-extensions',
      '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--use-angle=' + angle,
      '--remote-debugging-port=0',
    ];
    if (angle === 'swiftshader') flags.push('--enable-unsafe-swiftshader');
    if (noSandbox) flags.push('--no-sandbox');
    child = spawn(edge, [...flags, 'about:blank'], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', (error) => {
      childError = error;
      cdp?.close(error);
    });
    child.on('exit', (code, exitSignal) => {
      cdp?.close(new Error('Edge exited (code ' + code + ', signal ' + exitSignal + ')'));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2500); });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const wire = await websocketTransport(await devToolsAddress(profile, running, signal), signal);
    cdp = new CDP(wire, signal);
    running();
    const { targetInfos } = await cdp.send('Target.getTargets', {}, { timeout: 7000 });
    let targetId = targetInfos.find((target) => target.type === 'page')?.targetId;
    if (!targetId) ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId);
    const graphics = await page.evaluate('(' + (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        webgl2: !!gl,
        renderer: gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null,
      };
    }) + ')()');
    if (!graphics.webgl2) throw new Error('Edge opened but could not create a WebGL2 context');
    return { page, graphics, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new Error(error.message + '; Edge cleanup failed: ' + cleanup.message, { cause: error });
    }
    throw new Error(error.message + (stderr.trim() ? '\n' + stderr.trim() : ''), { cause: error });
  }
}