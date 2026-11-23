// icons.js — white side-view silhouettes of G.GunModels, cached as data URLs.
// Drawn with an orthographic camera once the game renderer exists, and again if a model is swapped.
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const Icons = G.Icons = { urls: Object.create(null), rev: 0, sig: '', busy: false };
  const SIZE = 128;

  function signature() {
    const ids = G.GunModels.IDS;
    let s = '';
    for (let i = 0; i < ids.length; i++) {
      const gm = G.GunModels.get(ids[i]);
      const geo = gm && gm.whole;
      const n = geo && geo.attributes && geo.attributes.position ? geo.attributes.position.count : 0;
      s += ids[i] + ':' + (geo ? geo.uuid : '') + ':' + n + ';';
    }
    return s;
  }

  Icons.get = function (id) {
    if (id && !Icons.urls[id]) Icons.ensure();
    return (id && Icons.urls[id]) || '';
  };

  Icons.ensure = function () {
    if (!G.renderer || Icons.busy || !G.GunModels) return;
    let sig = '';
    try { sig = signature(); } catch (e) { return; }
    if (sig && sig === Icons.sig) return;
    Icons.rebuild();
  };

  Icons.rebuild = function () {
    if (!G.renderer || !G.GunModels || Icons.busy) return false;
    Icons.busy = true;
    try {
      const sig = signature();
      paintAll();
      Icons.sig = sig;
      Icons.rev++;
      return true;
    } catch (e) {
      console.warn('weapon icons', e);
      return false;
    } finally {
      Icons.busy = false;
    }
  };

  let rt, scene, cam, mesh, scratch;

  function setup() {
    if (scene) return;
    rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { stencilBuffer: false });
    scene = new THREE.Scene();
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    if ('toneMapped' in mat) mat.toneMapped = false;
    mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    scratch = new Uint8Array(SIZE * SIZE * 4);
  }

  function saveState(renderer) {
    const viewport = new THREE.Vector4();
    const scissor = new THREE.Vector4();
    const clear = new THREE.Color();
    if (renderer.getViewport) renderer.getViewport(viewport);
    if (renderer.getScissor) renderer.getScissor(scissor);
    if (renderer.getClearColor) renderer.getClearColor(clear);
    return {
      target: renderer.getRenderTarget ? renderer.getRenderTarget() : null,
      viewport: viewport,
      scissor: scissor,
      scissorTest: renderer.getScissorTest ? renderer.getScissorTest() : false,
      clear: clear,
      alpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1,
      autoClear: renderer.autoClear
    };
  }

  function restoreState(renderer, s) {
    if (renderer.setRenderTarget) renderer.setRenderTarget(s.target);
    if (renderer.setViewport) renderer.setViewport(s.viewport.x, s.viewport.y, s.viewport.z, s.viewport.w);
    if (renderer.setScissor) renderer.setScissor(s.scissor.x, s.scissor.y, s.scissor.z, s.scissor.w);
    if (renderer.setScissorTest) renderer.setScissorTest(s.scissorTest);
    if (renderer.setClearColor) renderer.setClearColor(s.clear, s.alpha);
    renderer.autoClear = s.autoClear;
  }

  // Side profile: drop X, barrel (-Z) points left, +Y points up.
  function frameCamera(geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box || !isFinite(box.min.x) || !isFinite(box.max.y) || !isFinite(box.max.z)) return false;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const halfW = Math.max(0.01, (box.max.z - box.min.z) * 0.5);
    const halfH = Math.max(0.01, (box.max.y - box.min.y) * 0.5);
    let hw = halfW * 1.18, hh = halfH * 1.18;
    if (hw < hh) hw = hh; else hh = hw;
    const depth = Math.max(0.25, box.max.x - box.min.x);
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.near = 0.01; cam.far = depth + 3;
    cam.up.set(0, 1, 0);
    cam.position.set(box.min.x - 1, cy, cz);
    cam.lookAt(cx, cy, cz);
    cam.updateProjectionMatrix();
    return true;
  }

  function pixelsToURL(buf) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    let lit = 0;
    for (let y = 0; y < SIZE; y++) {
      const srcRow = (SIZE - 1 - y) * SIZE;
      const dstRow = y * SIZE;
      for (let x = 0; x < SIZE; x++) {
        const s = (srcRow + x) * 4;
        const on = buf[s] + buf[s + 1] + buf[s + 2] > 28;
        const d = (dstRow + x) * 4;
        data[d] = 255; data[d + 1] = 255; data[d + 2] = 255; data[d + 3] = on ? 255 : 0;
        if (on) lit++;
      }
    }
    if (lit < 12) return '';
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function paintGL(renderer, geo) {
    if (!frameCamera(geo)) return '';
    mesh.geometry = geo;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    scratch.fill(0);
    renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, scratch);
    return pixelsToURL(scratch);
  }

  function raster(geo) {
    const pos = geo.attributes && geo.attributes.position;
    if (!pos || !pos.count) return '';
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box || !isFinite(box.min.y)) return '';
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const half = Math.max(box.max.y - box.min.y, box.max.z - box.min.z) * 0.58 || 1;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#fff';
    const index = geo.index ? geo.index.array : null;
    const count = index ? index.length : pos.count;
    const vert = index ? function (i) { return index[i]; } : function (i) { return i; };
    for (let i = 0; i + 2 < count; i += 3) {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const vi = vert(i + k);
        const x = (pos.getZ(vi) - cz) / half * (SIZE * 0.5) + SIZE * 0.5;
        const y = (cy - pos.getY(vi)) / half * (SIZE * 0.5) + SIZE * 0.5;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    return canvas.toDataURL('image/png');
  }

  function paintAll() {
    setup();
    const renderer = G.renderer;
    const ids = G.GunModels.IDS;
    const prev = saveState(renderer);
    const drawn = Object.create(null);
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const gm = G.GunModels.get(id);
        if (!gm || !gm.whole) continue;
        try { drawn[id] = paintGL(renderer, gm.whole); } catch (e) { drawn[id] = ''; }
      }
    } finally {
      mesh.geometry = new THREE.BufferGeometry();
      restoreState(renderer, prev);
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      let url = drawn[id];
      if (!url) {
        try {
          const gm = G.GunModels.get(id);
          url = gm && gm.whole ? raster(gm.whole) : '';
        } catch (e) { url = ''; }
      }
      if (url) Icons.urls[id] = url;
    }
  }

  if (G.GunModels && G.GunModels.loadReal) {
    const orig = G.GunModels.loadReal;
    G.GunModels.loadReal = function () {
      const ret = orig.apply(this, arguments);
      const finish = function () { try { Icons.rebuild(); } catch (err) { console.warn('weapon icons', err); } };
      if (ret && typeof ret.then === 'function') {
        return ret.then(function (v) { finish(); return v; }, function (err) { finish(); throw err; });
      }
      finish();
      return ret;
    };
  }
})(window.G);
