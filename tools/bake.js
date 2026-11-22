// Offline light baker for the town: indirect light (sky + one bounce of sun and sky light) for every
// lightmap texel, plus a grid of ambient probes for moving objects. Run with Node:
//   node bake.js <projectDir> <three.js path>
// Writes assets/lightmap.png, assets/probes.png and assets/lightmap.json into the project.
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const loadGame = require('./loadgame.js');

const RAYS = 64, PROBE_RAYS = 128, MAXD = 70, EMAX = 2.0;
const PROBE_N = 200, PROBE_Y = 1.0;

function setup(projectDir, threePath) {
  const G = loadGame(projectDir, threePath);
  const geo = G.MapGeo.build();
  const L = G.MapGeo.LIGHT;
  // occluders: all colliders plus decorative boxes
  const boxes = [];
  for (const b of G.Map.boxes) boxes.push([b.x0, b.y0, b.z0, b.x1, b.y1, b.z1]);
  for (const b of geo.occ) boxes.push(b);
  // 2D grid acceleration, 1 m cells
  const GX0 = -56, GZ0 = -56, GN = 112, CS = 1;
  const cells = Array.from({ length: GN * GN }, () => []);
  boxes.forEach((b, i) => {
    const c0 = Math.max(0, Math.floor((b[0] - GX0) / CS)), c1 = Math.min(GN - 1, Math.floor((b[3] - GX0 - 1e-6) / CS));
    const r0 = Math.max(0, Math.floor((b[2] - GZ0) / CS)), r1 = Math.min(GN - 1, Math.floor((b[5] - GZ0 - 1e-6) / CS));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * GN + c].push(i);
  });
  const quadsOcc = geo.occQuads.map((q) => {
    const n = cross(q.u, q.v), nl = Math.hypot(n[0], n[1], n[2]);
    return { o: q.o, u: q.u, v: q.v, n: [n[0] / nl, n[1] / nl, n[2] / nl], uu: dot(q.u, q.u), vv: dot(q.v, q.v), uv: dot(q.u, q.v) };
  });
  const marks = new Uint32Array(boxes.length); let stamp = 1;
  const MAXY = 12;
  const hit = { t: 0, nx: 0, ny: 0, nz: 0 };

  function rayBox(b, ox, oy, oz, dx, dy, dz, tmax) {
    let t0 = 0, t1 = tmax, ax = -1, sg = 0;
    for (let a = 0; a < 3; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
      const lo = b[a], hi = b[a + 3];
      if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return -1; continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d, s = -1;
      if (ta > tb) { const tt = ta; ta = tb; tb = tt; s = 1; }
      if (ta > t0) { t0 = ta; ax = a; sg = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    if (ax < 0) return -1;   // started inside
    hit.nx = ax === 0 ? sg : 0; hit.ny = ax === 1 ? sg : 0; hit.nz = ax === 2 ? sg : 0;
    return t0;
  }
  // nearest hit: returns t or -1; normal in `hit`
  function trace(ox, oy, oz, dx, dy, dz, maxd) {
    let best = maxd, bn0 = 0, bn1 = 0, bn2 = 0, found = false;
    if (dy < -1e-9) { const tg = -oy / dy; if (tg > 0 && tg < best) { best = tg; bn0 = 0; bn1 = 1; bn2 = 0; found = true; } }
    for (const q of quadsOcc) {
      const den = dot3(q.n, dx, dy, dz);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q.o[0] - ox) * q.n[0] + (q.o[1] - oy) * q.n[1] + (q.o[2] - oz) * q.n[2]) / den;
      if (t <= 1e-4 || t >= best) continue;
      const px = ox + dx * t - q.o[0], py = oy + dy * t - q.o[1], pz = oz + dz * t - q.o[2];
      const pu = px * q.u[0] + py * q.u[1] + pz * q.u[2], pv = px * q.v[0] + py * q.v[1] + pz * q.v[2];
      const det = q.uu * q.vv - q.uv * q.uv, a = (pu * q.vv - pv * q.uv) / det, b = (pv * q.uu - pu * q.uv) / det;
      if (a < 0 || a > 1 || b < 0 || b > 1) continue;
      best = t; found = true; const s = den > 0 ? -1 : 1; bn0 = q.n[0] * s; bn1 = q.n[1] * s; bn2 = q.n[2] * s;
    }
    stamp++;
    let c = Math.floor((ox - GX0) / CS), r = Math.floor((oz - GZ0) / CS);
    const sc = dx > 0 ? 1 : -1, sr = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? CS / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? CS / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-12 ? ((dx > 0 ? GX0 + (c + 1) * CS : GX0 + c * CS) - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-12 ? ((dz > 0 ? GZ0 + (r + 1) * CS : GZ0 + r * CS) - oz) / dz : Infinity;
    let tEnter = 0;
    for (let it = 0; it < 600; it++) {
      if (c >= 0 && r >= 0 && c < GN && r < GN) {
        const list = cells[r * GN + c];
        for (let k = 0; k < list.length; k++) {
          const i = list[k]; if (marks[i] === stamp) continue; marks[i] = stamp;
          const t = rayBox(boxes[i], ox, oy, oz, dx, dy, dz, best);
          if (t > 0 && t < best) { best = t; bn0 = hit.nx; bn1 = hit.ny; bn2 = hit.nz; found = true; }
        }
      } else if (tEnter > 0) break;
      const tExit = Math.min(tmx, tmz);
      if (best <= tExit || tExit > maxd) break;
      const yAt = oy + dy * tExit;
      if (yAt > MAXY && dy > 0) break;
      tEnter = tExit;
      if (tmx < tmz) { c += sc; tmx += tdx; } else { r += sr; tmz += tdz; }
    }
    if (!found) return -1;
    hit.t = best; hit.nx = bn0; hit.ny = bn1; hit.nz = bn2;
    return best;
  }
  function inside(x, y, z) {
    if (y < 0) return true;
    const c = Math.floor((x - GX0) / CS), r = Math.floor((z - GZ0) / CS);
    if (c < 0 || r < 0 || c >= GN || r >= GN) return false;
    for (const i of cells[r * GN + c]) {
      const b = boxes[i];
      if (x > b[0] + 1e-4 && x < b[3] - 1e-4 && y > b[1] + 1e-4 && y < b[4] - 1e-4 && z > b[2] + 1e-4 && z < b[5] - 1e-4) return true;
    }
    return false;
  }
  const sd = L.sunDir;
  const skyAvg = [0, 1, 2].map((k) => L.skyHorizon[k] * 0.45 + L.skyTop[k] * 0.55);
  function sky(dx, dy, dz, out) {
    const h = Math.max(0, dy), k = Math.sqrt(h);
    const sunAmt = Math.pow(Math.max(0, dx * sd[0] + dy * sd[1] + dz * sd[2]), 6) * 0.35;
    for (let i = 0; i < 3; i++) out[i] = L.skyHorizon[i] + (L.skyTop[i] - L.skyHorizon[i]) * k + sunAmt * L.sun[i] * 0.12;
  }
  // radiance leaving a surface hit by a ray (one bounce of sun and sky)
  const tmp = [0, 0, 0];
  function bounce(px, py, pz, nx, ny, nz, out) {
    const alb = py < 0.02 && ny > 0.9 ? [0.48, 0.37, 0.24] : [0.54, 0.45, 0.33];
    const ndl = nx * sd[0] + ny * sd[1] + nz * sd[2];
    let vis = 0;
    if (ndl > 0) vis = trace(px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02, sd[0], sd[1], sd[2], MAXD) < 0 ? 1 : 0;
    for (let i = 0; i < 3; i++) out[i] = alb[i] * (L.sun[i] * Math.max(0, ndl) * vis + skyAvg[i] * (0.45 + 0.25 * ny));
  }
  // cosine-weighted irradiance at a point with normal n (stratified), in shader units
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function irradiance(px, py, pz, n, rays, out) {
    const t1 = Math.abs(n[1]) < 0.9 ? norm(cross(n, [0, 1, 0])) : norm(cross(n, [1, 0, 0]));
    const t2 = cross(n, t1);
    const side = Math.round(Math.sqrt(rays));
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
      const u1 = (i + rnd()) / side, u2 = (j + rnd()) / side;
      const rr = Math.sqrt(u1), ph = 2 * Math.PI * u2, lx = rr * Math.cos(ph), ly = rr * Math.sin(ph), lz = Math.sqrt(1 - u1);
      const dx = t1[0] * lx + t2[0] * ly + n[0] * lz, dy = t1[1] * lx + t2[1] * ly + n[1] * lz, dz = t1[2] * lx + t2[2] * ly + n[2] * lz;
      const t = trace(px, py, pz, dx, dy, dz, MAXD);
      if (t < 0) sky(dx, dy, dz, tmp);
      else bounce(px + dx * t, py + dy * t, pz + dz * t, hit.nx, hit.ny, hit.nz, tmp);
      r += tmp[0]; g += tmp[1]; b += tmp[2];
    }
    const k = 1 / (side * side);
    out[0] = r * k; out[1] = g * k; out[2] = b * k;
  }
  return { G, geo, L, trace, inside, irradiance, sky, bounce, hit };
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function dot3(a, x, y, z) { return a[0] * x + a[1] * y + a[2] * z; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

// ---------------- worker: bakes a list of quads or probe rows ----------------
if (!isMainThread) {
  const S = setup(workerData.projectDir, workerData.threePath);
  const out = [0, 0, 0];
  if (workerData.kind === 'quads') {
    const res = [];
    for (const qi of workerData.list) {
      const q = S.geo.quads[qi];
      const n = norm(cross(q.u, q.v));
      const data = new Float32Array(q.tw * q.th * 3), valid = new Uint8Array(q.tw * q.th);
      for (let j = 0; j < q.th; j++) for (let i = 0; i < q.tw; i++) {
        let s = i / (q.tw - 1), t = j / (q.th - 1);
        // pull edge samples slightly inward so they do not start inside neighbouring geometry
        const lu = Math.hypot(q.u[0], q.u[1], q.u[2]), lv = Math.hypot(q.v[0], q.v[1], q.v[2]);
        const es = Math.min(0.5, 0.03 / Math.max(lu, 1e-3)), et = Math.min(0.5, 0.03 / Math.max(lv, 1e-3));
        s = Math.min(1 - es, Math.max(es, s)); t = Math.min(1 - et, Math.max(et, t));
        const px = q.o[0] + q.u[0] * s + q.v[0] * t + n[0] * 0.03;
        const py = q.o[1] + q.u[1] * s + q.v[1] * t + n[1] * 0.03;
        const pz = q.o[2] + q.u[2] * s + q.v[2] * t + n[2] * 0.03;
        const k = j * q.tw + i;
        if (S.inside(px, py, pz)) continue;
        S.irradiance(px, py, pz, n, RAYS, out);
        data[k * 3] = out[0]; data[k * 3 + 1] = out[1]; data[k * 3 + 2] = out[2]; valid[k] = 1;
      }
      res.push({ qi, data, valid });
    }
    parentPort.postMessage(res);
  } else {
    const res = [];
    const dirs = [];
    for (let i = 0; i < PROBE_RAYS; i++) {   // Fibonacci sphere
      const y = 1 - (i + 0.5) / PROBE_RAYS * 2, r = Math.sqrt(1 - y * y), ph = i * 2.399963;
      dirs.push([Math.cos(ph) * r, y, Math.sin(ph) * r]);
    }
    const M = S.G.Map;
    for (const row of workerData.list) {
      const data = new Float32Array(PROBE_N * 3), valid = new Uint8Array(PROBE_N);
      for (let i = 0; i < PROBE_N; i++) {
        const x = -50 + (i + 0.5) * (100 / PROBE_N), z = -50 + (row + 0.5) * (100 / PROBE_N);
        const c = M.colOf(x), r = M.rowOf(z);
        const y = (M.walkable(c, r) ? M.floorH(c, r) : 0) + PROBE_Y;
        if (S.inside(x, y, z)) continue;
        let R = 0, Gg = 0, B = 0;
        for (const d of dirs) {
          const t = S.trace(x, y, z, d[0], d[1], d[2], MAXD);
          if (t < 0) { if (d[1] >= 0) S.sky(d[0], d[1], d[2], out); else { out[0] = 0.3; out[1] = 0.24; out[2] = 0.16; } }
          else S.bounce(x + d[0] * t, y + d[1] * t, z + d[2] * t, S.hit.nx, S.hit.ny, S.hit.nz, out);
          R += out[0]; Gg += out[1]; B += out[2];
        }
        data[i * 3] = R / dirs.length; data[i * 3 + 1] = Gg / dirs.length; data[i * 3 + 2] = B / dirs.length; valid[i] = 1;
      }
      res.push({ row, data, valid });
    }
    parentPort.postMessage(res);
  }
  return;
}

// ---------------- main ----------------
const projectDir = path.resolve(process.argv[2]), threePath = path.resolve(process.argv[3]);
const NW = Math.max(1, Math.min(8, os.cpus().length));
const S = setup(projectDir, threePath);
const geo = S.geo;
console.log('quads', geo.quads.length, 'atlas', geo.atlasW, 'x', geo.atlasH, 'workers', NW);

function runWorkers(kind, items, weight) {
  // split items into NW lists of similar total weight
  const lists = Array.from({ length: NW * 3 }, () => []), load = new Array(NW * 3).fill(0);
  items.map((it) => [it, weight(it)]).sort((a, b) => b[1] - a[1]).forEach(([it, w]) => {
    let m = 0; for (let i = 1; i < load.length; i++) if (load[i] < load[m]) m = i;
    lists[m].push(it); load[m] += w;
  });
  let next = 0, done = 0;
  const results = [];
  return new Promise((resolve, reject) => {
    const start = () => {
      if (next >= lists.length) return false;
      const list = lists[next++];
      const w = new Worker(__filename, { workerData: { projectDir, threePath, kind, list } });
      w.on('message', (m) => { results.push(...m); });
      w.on('error', reject);
      w.on('exit', () => { done++; process.stdout.write('.'); if (!start() && done === lists.length) resolve(results); });
      return true;
    };
    for (let i = 0; i < NW; i++) start();
  });
}

function encode(v) { return Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, v / EMAX)))); }
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// fill texels that started inside geometry from their valid neighbours, then smooth lightly
function finishChart(tw, th, data, valid) {
  const v = Uint8Array.from(valid);
  for (let pass = 0; pass < 64; pass++) {
    let changed = false, missing = false;
    const nv = Uint8Array.from(v), nd = Float32Array.from(data);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const k = j * tw + i; if (v[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= tw || jj >= th) continue;
        const kk = jj * tw + ii; if (!v[kk]) continue;
        r += data[kk * 3]; g += data[kk * 3 + 1]; b += data[kk * 3 + 2]; n++;
      }
      if (n) { nd[k * 3] = r / n; nd[k * 3 + 1] = g / n; nd[k * 3 + 2] = b / n; nv[k] = 1; changed = true; } else missing = true;
    }
    v.set(nv); data.set(nd);
    if (!missing || !changed) break;
  }
  for (let k = 0; k < tw * th; k++) if (!v[k]) { data[k * 3] = 0.12; data[k * 3 + 1] = 0.11; data[k * 3 + 2] = 0.1; }
  // 3x3 smoothing inside the chart (sampling noise)
  const out = new Float32Array(data.length);
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= tw || jj >= th) continue;
      const kk = jj * tw + ii, w = di === 0 && dj === 0 ? 2 : 1;
      r += data[kk * 3] * w; g += data[kk * 3 + 1] * w; b += data[kk * 3 + 2] * w; wsum += w;
    }
    const k = j * tw + i; out[k * 3] = r / wsum; out[k * 3 + 1] = g / wsum; out[k * 3 + 2] = b / wsum;
  }
  return out;
}

(async function () {
  const t0 = Date.now();
  const qres = await runWorkers('quads', geo.quads.map((q, i) => i), (i) => geo.quads[i].tw * geo.quads[i].th);
  console.log('\nquads baked in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const W = geo.atlasW, H = geo.atlasH, atlas = Buffer.alloc(W * H * 3);
  // neutral fill for gaps between charts
  for (let i = 0; i < W * H; i++) { atlas[i * 3] = encode(0.4); atlas[i * 3 + 1] = encode(0.4); atlas[i * 3 + 2] = encode(0.42); }
  let maxE = 0, sumE = 0, cnt = 0;
  for (const { qi, data, valid } of qres) {
    const q = geo.quads[qi];
    const d = finishChart(q.tw, q.th, data, valid);
    for (let j = 0; j < q.th; j++) for (let i = 0; i < q.tw; i++) {
      const k = j * q.tw + i, o = ((q.ly + j) * W + q.lx + i) * 3;
      for (let c = 0; c < 3; c++) { atlas[o + c] = encode(d[k * 3 + c]); maxE = Math.max(maxE, d[k * 3 + c]); }
      sumE += d[k * 3 + 1]; cnt++;
    }
    // one texel of padding copied from the chart edge
    for (let j = -1; j <= q.th; j++) for (let i = -1; i <= q.tw; i++) {
      if (i >= 0 && j >= 0 && i < q.tw && j < q.th) continue;
      const si = Math.min(q.tw - 1, Math.max(0, i)), sj = Math.min(q.th - 1, Math.max(0, j));
      const ax = q.lx + i, ay = q.ly + j; if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      const k = sj * q.tw + si, o = (ay * W + ax) * 3;
      for (let c = 0; c < 3; c++) atlas[o + c] = encode(d[k * 3 + c]);
    }
  }
  console.log('max E', maxE.toFixed(2), 'mean G', (sumE / cnt).toFixed(3));
  const t1 = Date.now();
  const pres = await runWorkers('probes', Array.from({ length: PROBE_N }, (_, i) => i), () => 1);
  console.log('\nprobes baked in', ((Date.now() - t1) / 1000).toFixed(1), 's');
  const pdata = new Float32Array(PROBE_N * PROBE_N * 3), pvalid = new Uint8Array(PROBE_N * PROBE_N);
  for (const { row, data, valid } of pres) { pdata.set(data, row * PROBE_N * 3); pvalid.set(valid, row * PROBE_N); }
  const pfin = finishChart(PROBE_N, PROBE_N, pdata, pvalid);
  const pbuf = Buffer.alloc(PROBE_N * PROBE_N * 3);
  for (let i = 0; i < pfin.length; i++) pbuf[i] = encode(pfin[i]);
  const outDir = path.join(projectDir, 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'lightmap.png'), png(W, H, atlas));
  fs.writeFileSync(path.join(outDir, 'probes.png'), png(PROBE_N, PROBE_N, pbuf));
  fs.writeFileSync(path.join(outDir, 'lightmap.json'), JSON.stringify({ w: W, h: H, checksum: geo.checksum, quads: geo.quads.length, emax: EMAX, probes: PROBE_N, probeY: PROBE_Y }));
  console.log('written', fs.statSync(path.join(outDir, 'lightmap.png')).size, 'bytes lightmap,', fs.statSync(path.join(outDir, 'probes.png')).size, 'bytes probes');
})();
