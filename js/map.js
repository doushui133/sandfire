// map.js — original desert town "烈沙镇": grid layout, colliders, ray casts, navigation, radar image
(function (G) {
  'use strict';
  const THREE = G.THREE, CELL = 2, W = 50, H = 50, OX = -50, OZ = -50;
  const M = G.Map = { W, H, CELL, boxes: [] };

  // ---------- layout (cell = 2 m; col → +x east, row → +z south) ----------
  const g = [];
  for (let r = 0; r < H; r++) g.push(new Array(W).fill('#'));
  const R = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ch; };
  const P = (c, r, ch) => { g[r][c] = ch; };
  const RIF = (c0, r0, c1, r1, from, to) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g[r][c] === from) g[r][c] = to; };

  R(18, 2, 30, 6, 'D');                                // defender spawn (north)
  R(5, 2, 17, 4, ','); R(5, 5, 7, 7, ',');             // back corridor → B
  R(31, 2, 44, 4, ','); R(42, 5, 44, 6, ',');          // back corridor → A
  R(2, 8, 15, 19, 'B');                                // site B: colonnade courtyard
  R(31, 7, 46, 16, 'A');                               // site A: market square
  R(23, 7, 26, 14, ',');                               // upper mid
  P(24, 15, '='); P(25, 15, '=');                      // mid gate
  R(22, 16, 27, 40, ',');                              // mid street
  R(16, 17, 21, 18, ','); P(16, 17, '='); P(16, 18, '='); // mid → B alley
  R(28, 20, 32, 21, ','); R(31, 17, 32, 19, ',');      // mid → A connector
  R(16, 41, 33, 47, 'T');                              // attacker spawn (south)
  R(34, 42, 45, 46, '.'); R(40, 34, 45, 41, '.');      // east street
  R(39, 26, 46, 33, 'h');                              // covered bazaar hall
  R(40, 17, 45, 25, '.');                              // bazaar → A street
  R(3, 42, 15, 46, '.'); R(3, 26, 8, 41, '.');         // west street
  R(6, 30, 8, 33, '%');                                // west street pinch
  R(3, 20, 5, 25, 'u');                                // tunnel into B
  R(9, 36, 21, 37, ',');                               // lower alley mid ↔ west

  // site B dressing
  R(12, 8, 15, 11, '^'); R(12, 12, 15, 12, 's');
  P(6, 11, '+'); P(9, 11, '+'); P(6, 15, '+'); P(9, 15, '+');
  P(3, 9, 'c'); P(3, 10, 'C'); P(13, 16, 'C'); P(14, 16, 'c'); P(10, 18, 'c'); R(7, 13, 8, 13, 'w');
  // site A dressing
  R(36, 9, 41, 12, '^'); R(37, 13, 40, 13, 's'); R(35, 10, 35, 11, 's');
  P(32, 8, 'C'); P(33, 8, 'c'); P(45, 8, 'c'); P(45, 9, 'C'); P(44, 14, 'c'); R(34, 14, 35, 14, 'w'); P(46, 16, 'p');
  // spawns, mid, streets
  P(19, 3, 'c'); P(29, 3, 'C'); P(13, 2, 'b'); P(36, 2, 'c');
  P(26, 12, 'c'); P(22, 22, 'C'); P(27, 25, 'c'); R(23, 29, 24, 29, 'w');
  P(17, 42, 'C'); P(32, 46, 'c'); P(20, 46, 'b'); P(29, 42, 'b'); P(16, 47, 'p'); P(33, 41, 'p');
  P(3, 27, 'b'); P(45, 36, 'b'); P(8, 40, 'b'); P(8, 27, 'c'); P(4, 38, 'C'); P(3, 46, 'p'); P(45, 46, 'p');
  P(44, 22, 'c'); P(41, 23, 'C'); R(40, 17, 42, 17, 'H');
  P(41, 28, '+'); P(44, 28, '+'); P(41, 31, '+'); P(44, 31, '+');
  P(13, 37, 'c'); P(19, 36, 'b');
  // lower inner blocks use the plaster style
  RIF(9, 20, 21, 35, '#', '%'); RIF(28, 22, 38, 40, '#', '%'); RIF(16, 7, 22, 16, '#', '%');
  M.grid = g;

  const FLOOR = { '.': 'sand', ',': 'paved', A: 'tiles', B: 'tiles', T: 'sand', D: 'paved', '=': 'paved', u: 'paved', h: 'tiles', s: 'step', '^': 'plat' };
  const FH = { s: 0.4, '^': 0.8 };
  M.FLOOR = FLOOR;
  M.inside = (c, r) => c >= 0 && r >= 0 && c < W && r < H;
  M.ch = (c, r) => (M.inside(c, r) ? g[r][c] : '#');
  M.walkable = (c, r) => FLOOR[M.ch(c, r)] !== undefined;
  M.floorH = (c, r) => FH[M.ch(c, r)] || 0;
  M.cellX = (c) => OX + c * CELL + CELL / 2;
  M.cellZ = (r) => OZ + r * CELL + CELL / 2;
  M.colOf = (x) => Math.floor((x - OX) / CELL);
  M.rowOf = (z) => Math.floor((z - OZ) / CELL);
  M.cellPos = (c, r, out) => (out || new THREE.Vector3()).set(M.cellX(c), M.floorH(c, r), M.cellZ(r));
  M.tallH = function (c, r) {   // building height with a little skyline variety
    const ch = M.ch(c, r);
    if (ch === '%') return 5.5;
    if (ch === 'H') return 3;
    const bx = Math.floor(c / 4), bz = Math.floor(r / 4), hsh = (bx * 73856093 ^ bz * 19349663) >>> 0;
    return 6.5 + (hsh % 3) * 1.0;
  };

  // ---------- sites, spawns, tactical spots ----------
  M.sites = {
    A: { c0: 31, r0: 7, c1: 46, r1: 16, center: M.cellPos(38, 14) },
    B: { c0: 2, r0: 8, c1: 15, r1: 19, center: M.cellPos(9, 13) },
  };
  M.siteAt = function (x, z) {
    const c = M.colOf(x), r = M.rowOf(z);
    if (!M.walkable(c, r)) return null;
    for (const k in M.sites) { const s = M.sites[k]; if (c >= s.c0 && c <= s.c1 && r >= s.r0 && r <= s.r1) return k; }
    return null;
  };
  M.randomSiteCell = function (site, maxR) {
    const s = M.sites[site];
    for (let i = 0; i < 300; i++) {
      const c = G.randi(s.c0, s.c1), r = G.randi(s.r0, s.r1);
      if (maxR && Math.hypot(M.cellX(c) - s.center.x, M.cellZ(r) - s.center.z) > maxR) continue;
      if (M.walkable(c, r) && M.walkable(c + 1, r) && M.walkable(c - 1, r) && M.walkable(c, r + 1) && M.walkable(c, r - 1)) return M.cellPos(c, r);
    }
    return s.center.clone();
  };
  const cp = (a) => a.map(([c, r]) => M.cellPos(c, r));
  M.spawns = {
    atk: cp([[19, 44], [22, 45], [25, 44], [28, 45], [31, 44]]),
    def: cp([[20, 4], [23, 3], [25, 5], [27, 3], [29, 5]]),
  };
  const hold = (site, c, r, lc, lr) => ({ site, pos: M.cellPos(c, r), yaw: G.yawTo(M.cellX(lc) - M.cellX(c), M.cellZ(lr) - M.cellZ(r)) });
  M.holds = [
    hold('A', 38, 10, 43, 19), hold('A', 32, 10, 31, 18), hold('A', 45, 13, 43, 19), hold('A', 43, 8, 38, 15),
    hold('B', 10, 9, 4, 20), hold('B', 13, 14, 17, 17), hold('B', 3, 15, 4, 21), hold('B', 14, 9, 16, 18),
    hold('M', 24, 12, 24, 22), hold('M', 25, 9, 25, 20),
  ];
  M.routes = {
    A: [cp([[42, 44], [42, 37], [42, 30], [42, 21]]), cp([[24, 35], [24, 25], [30, 20], [31, 17]])],
    B: [cp([[6, 44], [5, 35], [4, 27], [4, 22]]), cp([[24, 35], [23, 25], [19, 18]]), cp([[15, 37], [5, 33], [4, 23]])],
  };

  // ---------- colliders ----------
  function addBox(x0, y0, z0, x1, y1, z1, kind, extra) {
    const b = { x0, y0, z0, x1, y1, z1, kind };
    if (extra) Object.assign(b, extra);
    M.boxes.push(b);
    return b;
  }
  M.addBox = addBox;
  const SOLID = { '#': 1, '%': 1, H: 1, w: 1, '^': 1, s: 1, '=': 1, u: 1, h: 1 };
  function key(c, r) {
    const ch = g[r][c];
    if (!SOLID[ch]) return null;
    if (ch === '#' || ch === '%' || ch === 'H') return ch + M.tallH(c, r);
    return ch;
  }
  (function greedy() {
    const seen = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const k = key(c, r);
      if (!k || seen[r * W + c]) continue;
      let w = 1; while (c + w < W && !seen[r * W + c + w] && key(c + w, r) === k) w++;
      let h = 1;
      outer: while (r + h < H) { for (let i = 0; i < w; i++) if (seen[(r + h) * W + c + i] || key(c + i, r + h) !== k) break outer; h++; }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[(r + j) * W + c + i] = 1;
      const ch = g[r][c], x0 = OX + c * CELL, z0 = OZ + r * CELL, x1 = x0 + w * CELL, z1 = z0 + h * CELL;
      if (ch === '#' || ch === '%' || ch === 'H') addBox(x0, 0, z0, x1, M.tallH(c, r), z1, ch === '#' ? 'wallA' : ch === '%' ? 'wallB' : 'wallC', { building: true });
      else if (ch === 'w') addBox(x0 + 0.25, 0, z0 + 0.25, x1 - 0.25, 1.0, z1 - 0.25, 'lowwall');
      else if (ch === '^') addBox(x0, 0, z0, x1, 0.8, z1, 'plat');
      else if (ch === 's') addBox(x0, 0, z0, x1, 0.4, z1, 'step');
      else if (ch === '=') addBox(x0, 3.4, z0, x1, 7.2, z1, 'roof');
      else if (ch === 'u') addBox(x0, 3.0, z0, x1, 5.5, z1, 'roof');
      else if (ch === 'h') addBox(x0, 4.4, z0, x1, 7.0, z1, 'roof');
    }
  })();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = g[r][c], x0 = OX + c * CELL, z0 = OZ + r * CELL;
    if (ch === 'c') addBox(x0 + 0.15, 0, z0 + 0.15, x0 + 1.85, 1.05, z0 + 1.85, 'crate');
    else if (ch === 'C') { addBox(x0 + 0.15, 0, z0 + 0.15, x0 + 1.85, 1.05, z0 + 1.85, 'crate'); addBox(x0 + 0.4, 1.05, z0 + 0.3, x0 + 1.7, 2.05, z0 + 1.6, 'crate'); }
    else if (ch === 'b') addBox(x0 + 0.55, 0, z0 + 0.55, x0 + 1.45, 1.15, z0 + 1.45, 'barrel');
    else if (ch === '+') { const top = M.ch(c + 1, r) === 'h' || M.ch(c - 1, r) === 'h' ? 4.4 : 4.6; addBox(x0 + 0.5, 0, z0 + 0.5, x0 + 1.5, top, z0 + 1.5, 'pillar'); }
    else if (ch === 'p') addBox(x0 + 0.78, 0, z0 + 0.78, x0 + 1.22, 6, z0 + 1.22, 'palm');
  }

  // spatial hash: cell → box indices
  const bins = Array.from({ length: W * H }, () => []);
  M.boxes.forEach((b, i) => {
    const c0 = Math.max(0, M.colOf(b.x0 + 1e-4)), c1 = Math.min(W - 1, M.colOf(b.x1 - 1e-4));
    const r0 = Math.max(0, M.rowOf(b.z0 + 1e-4)), r1 = Math.min(H - 1, M.rowOf(b.z1 - 1e-4));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) bins[r * W + c].push(i);
  });
  let stamp = 1; const marks = new Uint32Array(M.boxes.length + 1);
  const qOut = [];
  M.query = function (x0, z0, x1, z1) {
    qOut.length = 0; stamp++;
    const c0 = Math.max(0, M.colOf(x0)), c1 = Math.min(W - 1, M.colOf(x1));
    const r0 = Math.max(0, M.rowOf(z0)), r1 = Math.min(H - 1, M.rowOf(z1));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const bin = bins[r * W + c];
      for (let k = 0; k < bin.length; k++) { const i = bin[k]; if (marks[i] !== stamp) { marks[i] = stamp; qOut.push(M.boxes[i]); } }
    }
    return qOut;
  };

  // ---------- ray cast against boxes and the ground (grid DDA) ----------
  const hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };
  function rayBox(b, ox, oy, oz, dx, dy, dz, tmax) {
    let t0 = 0, t1 = tmax, n = 0, sgn = 0;
    const ax = [[b.x0, b.x1, ox, dx], [b.y0, b.y1, oy, dy], [b.z0, b.z1, oz, dz]];
    for (let a = 0; a < 3; a++) {
      const [lo, hi, o, d] = ax[a];
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d, s = -1;
      if (ta > tb) { const tt = ta; ta = tb; tb = tt; s = 1; }
      if (ta > t0) { t0 = ta; n = a; sgn = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    if (t0 <= 0) return -1;
    hit.nx = n === 0 ? sgn : 0; hit.ny = n === 1 ? sgn : 0; hit.nz = n === 2 ? sgn : 0;
    return t0;
  }
  M.raycast = function (ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist, bn = [0, 0, 0], bb = null;
    if (dy < -1e-6) { const tg = -oy / dy; if (tg > 0 && tg < best) { best = tg; bn = [0, 1, 0]; } }
    let c = M.colOf(ox), r = M.rowOf(oz);
    const stepC = dx > 0 ? 1 : -1, stepR = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? OX + (c + 1) * CELL : OX + c * CELL) - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? OZ + (r + 1) * CELL : OZ + r * CELL) - oz) / dz : Infinity;
    stamp++;
    let tEnter = 0;
    for (let iter = 0; iter < 400; iter++) {
      if (c >= 0 && r >= 0 && c < W && r < H) {
        const bin = bins[r * W + c];
        for (let k = 0; k < bin.length; k++) {
          const i = bin[k]; if (marks[i] === stamp) continue; marks[i] = stamp;
          const t = rayBox(M.boxes[i], ox, oy, oz, dx, dy, dz, best);
          if (t > 0 && t < best) { best = t; bn = [hit.nx, hit.ny, hit.nz]; bb = M.boxes[i]; }
        }
      } else if (tEnter > 0) break;
      const tExit = Math.min(tmx, tmz);
      if (best <= tExit || tExit > maxDist) break;
      tEnter = tExit;
      if (tmx < tmz) { c += stepC; tmx += tdx; } else { r += stepR; tmz += tdz; }
    }
    if (best >= maxDist) return null;
    return { t: best, nx: bn[0], ny: bn[1], nz: bn[2], box: bb, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
  };
  M.clearLine = function (a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !M.raycast(a.x, a.y, a.z, dx / len, dy / len, dz / len, len - 0.05);
  };

  // ---------- navigation (A* on cells + string pulling) ----------
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  const nearWall = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let n = 0; for (const [dc, dr] of DIRS) if (!M.walkable(c + dc, r + dr)) n++;
    nearWall[r * W + c] = n ? 0.35 : 0;
  }
  const canStep = (c0, r0, c1, r1) => M.walkable(c1, r1) && Math.abs(M.floorH(c0, r0) - M.floorH(c1, r1)) <= 0.45;
  M.nearestWalkable = function (c, r) {
    if (M.walkable(c, r)) return [c, r];
    for (let d = 1; d < 6; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) if (M.walkable(c + dc, r + dr)) return [c + dc, r + dr];
    return [c, r];
  };
  M.findPath = function (from, to) {
    const [sc, sr] = M.nearestWalkable(M.colOf(from.x), M.rowOf(from.z));
    const [ec, er] = M.nearestWalkable(M.colOf(to.x), M.rowOf(to.z));
    const start = sr * W + sc, goal = er * W + ec;
    const gs = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
    const heap = [];
    const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, rr = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
    const hfn = (c, r) => { const dx = Math.abs(c - ec), dz = Math.abs(r - er); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    gs[start] = 0; push(start, hfn(sc, sr));
    let found = false;
    while (heap.length) {
      const i = pop(); if (closed[i]) continue; closed[i] = 1;
      if (i === goal) { found = true; break; }
      const c = i % W, r = (i / W) | 0;
      for (const [dc, dr, cost] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (!canStep(c, r, nc, nr)) continue;
        if (dc && dr && (!canStep(c, r, c + dc, r) || !canStep(c, r, c, r + dr))) continue;
        const j = nr * W + nc; if (closed[j]) continue;
        const ng = gs[i] + cost + nearWall[j];
        if (ng < gs[j]) { gs[j] = ng; came[j] = i; push(j, ng + hfn(nc, nr)); }
      }
    }
    if (!found) return null;
    const cells = []; for (let i = goal; i !== -1; i = came[i]) cells.push(i); cells.reverse();
    const pts = cells.map((i) => M.cellPos(i % W, (i / W) | 0));
    pts[pts.length - 1].set(to.x, M.floorH(ec, er), to.z);
    return smooth(pts);
  };
  function walkLine(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const px = -dz / len * 0.45, pz = dx / len * 0.45, n = Math.ceil(len / 0.4);
    let prevH = M.floorH(M.colOf(a.x), M.rowOf(a.z));
    for (let i = 1; i <= n; i++) {
      const x = a.x + dx * i / n, z = a.z + dz * i / n, c = M.colOf(x), r = M.rowOf(z);
      if (!M.walkable(c, r) || !M.walkable(M.colOf(x + px), M.rowOf(z + pz)) || !M.walkable(M.colOf(x - px), M.rowOf(z - pz))) return false;
      const h = M.floorH(c, r); if (Math.abs(h - prevH) > 0.45) return false; prevH = h;
    }
    return true;
  }
  function smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !walkLine(pts[i], pts[j])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }

  // ---------- radar image (5 px per cell), built when the HUD starts ----------
  M.buildRadar = function () {
    const px = 5, c = document.createElement('canvas'); c.width = W * px; c.height = H * px;
    const x = c.getContext('2d');
    const col = { sand: '#7c6a4c', paved: '#6f6250', tiles: '#7a6a52', step: '#8a7a5c', plat: '#93825f' };
    for (let r = 0; r < H; r++) for (let cc = 0; cc < W; cc++) {
      const ch = g[r][cc], f = FLOOR[ch];
      if (f) x.fillStyle = col[f];
      else if ('cCbw+p'.includes(ch)) x.fillStyle = '#4b3f2e';
      else continue;
      x.fillRect(cc * px, r * px, px, px);
    }
    x.strokeStyle = 'rgba(255,174,66,.55)'; x.lineWidth = 2;
    for (const k in M.sites) {
      const s = M.sites[k];
      x.strokeRect(s.c0 * px + 1, s.r0 * px + 1, (s.c1 - s.c0 + 1) * px - 2, (s.r1 - s.r0 + 1) * px - 2);
      x.fillStyle = 'rgba(255,174,66,.9)'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(k, (s.c0 + s.c1 + 1) / 2 * px, (s.r0 + s.r1 + 1) / 2 * px);
    }
    return c;
  };
  M.toRadar = (x, z) => [((x - OX) / CELL) * 5, ((z - OZ) / CELL) * 5];
})(window.G);
