// mapgeo.js — the town's static geometry as plain data: textured quads, each with its own
// lightmap chart, plus the boxes that block light. Deterministic and free of rendering code, so
// the offline light baker rebuilds exactly the same surfaces and lightmap layout.
(function (G) {
  'use strict';
  const M = G.Map;
  const MG = G.MapGeo = {};
  MG.TEXEL = 4;          // lightmap texels per metre
  MG.ATLAS_W = 1024;

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  // Lighting shared with the baker. Linear "shader units": surface colour = albedo × irradiance.
  MG.LIGHT = {
    sunDir: norm([-0.5, 0.62, 0.6]),
    sun: [3.1, 2.7, 2.15],
    skyTop: [0.26, 0.4, 0.72],
    skyHorizon: [0.8, 0.76, 0.68],
    ground: [0.42, 0.33, 0.22],
  };

  // Layers of the world texture array. alb = average linear albedo, used for bounce light.
  MG.MATS = {
    sand: { layer: 0, tile: 5, alb: [0.5, 0.38, 0.24], spec: 0.05 },
    cobble: { layer: 1, tile: 4, alb: [0.42, 0.36, 0.28], spec: 0.12 },
    tiles: { layer: 2, tile: 4, alb: [0.5, 0.4, 0.3], spec: 0.25 },
    blocks: { layer: 3, tile: 4, alb: [0.52, 0.42, 0.3], spec: 0.06 },
    plaster: { layer: 4, tile: 6, alb: [0.62, 0.55, 0.44], spec: 0.05 },
    rubble: { layer: 5, tile: 3, alb: [0.45, 0.38, 0.3], spec: 0.05 },
    trim: { layer: 6, tile: 2.5, alb: [0.64, 0.56, 0.45], spec: 0.1 },
    roof: { layer: 7, tile: 6, alb: [0.5, 0.45, 0.38], spec: 0.04 },
    wood: { layer: 8, tile: 2, alb: [0.33, 0.23, 0.14], spec: 0.12 },
    crate: { layer: 9, unit: true, alb: [0.4, 0.28, 0.16], spec: 0.08 },
    door: { layer: 10, unit: true, alb: [0.3, 0.2, 0.12], spec: 0.15 },
    window: { layer: 11, unit: true, alb: [0.06, 0.06, 0.07], spec: 0.9 },
    metal: { layer: 12, tile: 2, alb: [0.34, 0.36, 0.37], spec: 0.45 },
    cloth: { layer: 13, unit: true, alb: [0.5, 0.33, 0.24], spec: 0.03 },
    sign: { layer: 14, unit: true, alb: [0.42, 0.33, 0.24], spec: 0.12 },
    decal: { layer: 15, unit: true, alb: [0.3, 0.25, 0.2], spec: 0.05 },
  };
  MG.LAYERS = 16;
  // sub-rectangles of the sign and decal atlases [u0, v0, u1, v1]
  MG.SIGNS = [[0, 0, 0.5, 0.25], [0.5, 0, 1, 0.25], [0, 0.25, 0.5, 0.5], [0.5, 0.25, 1, 0.5], [0, 0.5, 0.5, 0.75], [0.5, 0.5, 1, 0.75], [0, 0.75, 0.5, 1], [0.5, 0.75, 1, 1]];
  MG.DECALS = { A: [0, 0.5, 0.5, 1], B: [0.5, 0.5, 1, 1], dirt: [0, 0, 0.5, 0.5], oil: [0.5, 0, 1, 0.5] };

  function rand(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash3 = (a, b, c) => ((Math.round(a * 97) * 73856093) ^ (Math.round(b * 89) * 19349663) ^ (Math.round(c * 13) * 83492791)) >>> 0;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // occupied height intervals of a grid cell
  const ROOF = { '=': [3.4, 7.2], u: [3.0, 5.5], h: [4.4, 7.0] };
  const OUT = [{ y0: 0, y1: 99, k: 'out' }];
  function column(c, r) {
    if (!M.inside(c, r)) return OUT;
    const ch = M.ch(c, r);
    if (ch === '#' || ch === '%' || ch === 'H') return [{ y0: 0, y1: M.tallH(c, r), k: ch }];
    if (ch === '^') return [{ y0: 0, y1: 0.8, k: '^' }];
    if (ch === 's') return [{ y0: 0, y1: 0.4, k: 's' }];
    if (ROOF[ch]) return [{ y0: ROOF[ch][0], y1: ROOF[ch][1], k: ch }];
    return [];
  }
  MG.column = column;
  function subtract(a0, a1, list) {
    let parts = [[a0, a1]];
    for (const iv of list) {
      const next = [];
      for (const [p0, p1] of parts) {
        if (iv.y1 <= p0 || iv.y0 >= p1) { next.push([p0, p1]); continue; }
        if (iv.y0 > p0) next.push([p0, iv.y0]);
        if (iv.y1 < p1) next.push([iv.y1, p1]);
      }
      parts = next;
    }
    return parts.filter(([p0, p1]) => p1 - p0 > 0.01);
  }
  const SIDE_MAT = { '#': 'blocks', '%': 'plaster', H: 'rubble', '^': 'trim', s: 'trim', '=': 'blocks', u: 'rubble', h: 'plaster' };
  const PLASTER_TINTS = [[1, 1, 1], [1, 0.95, 0.86], [1, 0.9, 0.78], [0.97, 0.86, 0.8], [1, 0.97, 0.92], [0.93, 0.9, 0.84]];
  const STONE_TINTS = [[1, 1, 1], [1.04, 1.0, 0.95], [0.95, 0.93, 0.9], [1.02, 0.97, 0.9]];
  function tintOf(c, r, k) {
    const h = ((Math.floor(c / 4) * 7919) ^ (Math.floor(r / 4) * 104729)) >>> 0;
    if (k === '%' || k === 'h') return PLASTER_TINTS[h % PLASTER_TINTS.length];
    return STONE_TINTS[h % STONE_TINTS.length];
  }
  // sides: dc, dr, outward normal n, along-face direction t (u of the quad), face id of the back side
  const DIRS = [
    { dc: 1, dr: 0, n: [1, 0, 0], t: [0, 0, -1], back: 'nx' },
    { dc: -1, dr: 0, n: [-1, 0, 0], t: [0, 0, 1], back: 'px' },
    { dc: 0, dr: 1, n: [0, 0, 1], t: [1, 0, 0], back: 'nz' },
    { dc: 0, dr: -1, n: [0, 0, -1], t: [-1, 0, 0], back: 'pz' },
  ];
  const FLOOR_MAT = { sand: 'sand', paved: 'cobble', tiles: 'tiles' };

  MG.build = function () {
    const quads = [], occ = [], occQuads = [], props = [];
    const WHITE = [1, 1, 1];
    function Q(m, o, u, v, opt) {
      const q = { m, o, u, v, tint: (opt && opt.tint) || WHITE, uv: (opt && opt.uv) || null, wall: (opt && opt.wall) || null, decal: m === 'decal' };
      quads.push(q);
      return q;
    }
    function box(m, x0, y0, z0, x1, y1, z1, opt) {
      opt = opt || {};
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, sk = opt.skip || '';
      if (dx <= 0.001 || dy <= 0.001 || dz <= 0.001) return;
      if (opt.occ !== false) occ.push([x0, y0, z0, x1, y1, z1]);
      const o2 = { tint: opt.tint, uv: opt.uv, wall: opt.wall }, mt = opt.top || m;
      if (!sk.includes('px')) Q(m, [x1, y0, z1], [0, 0, -dz], [0, dy, 0], o2);
      if (!sk.includes('nx')) Q(m, [x0, y0, z0], [0, 0, dz], [0, dy, 0], o2);
      if (!sk.includes('pz')) Q(m, [x0, y0, z1], [dx, 0, 0], [0, dy, 0], o2);
      if (!sk.includes('nz')) Q(m, [x1, y0, z0], [-dx, 0, 0], [0, dy, 0], o2);
      if (!sk.includes('py')) Q(mt, [x0, y1, z1], [dx, 0, 0], [0, 0, -dz], o2);
      if (!sk.includes('ny')) Q(opt.bottom || m, [x0, y0, z0], [dx, 0, 0], [0, 0, dz], o2);
    }

    // ---------- vertical faces of buildings, roofs, platforms ----------
    const segs = new Map();
    const groundEdge = new Set();   // "dir|c|r" of cell sides open at ground level
    const faceEdge = new Set();     // "dir|c|r" of cell sides with any exposed face
    for (let r = -1; r <= M.H; r++) for (let c = -1; c <= M.W; c++) {
      if (!M.inside(c, r)) continue;
      const col = column(c, r);
      if (!col.length) continue;
      DIRS.forEach((d, di) => {
        const nb = column(c + d.dc, r + d.dr);
        for (const iv of col) {
          for (const [y0, y1] of subtract(iv.y0, iv.y1, nb)) {
            const plane = d.dc ? M.cellX(c) + d.dc : M.cellZ(r) + d.dr;
            const along = d.dc ? M.cellZ(r) - 1 : M.cellX(c) - 1;
            const tint = tintOf(c, r, iv.k);
            const key = di + '|' + plane + '|' + r3(y0) + '|' + r3(y1) + '|' + iv.k + '|' + tint.join(',') + '|' + r3(iv.y1);
            if (!segs.has(key)) segs.set(key, { di, plane, y0, y1, k: iv.k, tint, top: iv.y1, base: iv.y0, runs: [] });
            segs.get(key).runs.push(along);
            faceEdge.add(di + '|' + c + '|' + r);
            if (y0 < 0.01 && nb.every((v) => v.y0 > 0.01)) groundEdge.add(di + '|' + c + '|' + r);
          }
        }
      });
    }
    const merged = [];
    for (const s of segs.values()) {
      s.runs.sort((a, b) => a - b);
      let start = s.runs[0], prev = start;
      for (let i = 1; i <= s.runs.length; i++) {
        const a = s.runs[i];
        if (a !== undefined && Math.abs(a - (prev + 2)) < 1e-6) { prev = a; continue; }
        merged.push(Object.assign({}, s, { w0: start, w1: prev + 2 }));
        start = prev = a;
      }
    }
    merged.sort((a, b) => a.di - b.di || a.plane - b.plane || a.w0 - b.w0 || a.y0 - b.y0);
    // a quad (or local box) on the face of segment s: s along t from the segment start, d outward
    function frame(s) {
      const d = DIRS[s.di];
      let ox, oz;
      if (d.dc === 1) { ox = s.plane; oz = s.w1; } else if (d.dc === -1) { ox = s.plane; oz = s.w0; }
      else if (d.dr === 1) { ox = s.w0; oz = s.plane; } else { ox = s.w1; oz = s.plane; }
      const L = s.w1 - s.w0;
      const at = (a, dd) => [ox + d.t[0] * a + d.n[0] * dd, oz + d.t[2] * a + d.n[2] * dd];
      return {
        d, L,
        quad(m, a0, a1, y0, y1, dd, opt) {
          const p = at(a0, dd);
          return Q(m, [p[0], y0, p[1]], [d.t[0] * (a1 - a0), 0, d.t[2] * (a1 - a0)], [0, y1 - y0, 0], opt);
        },
        box(m, a0, a1, y0, y1, d0, d1, opt) {
          const p = at(a0, d0), q = at(a1, d1);
          opt = Object.assign({}, opt);
          if (d0 <= 0.001) opt.skip = (opt.skip || '') + d.back;
          box(m, Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), opt);
        },
        point(a, dd) { return at(a, dd); },
      };
    }
    for (const s of merged) {
      const f = frame(s);
      f.quad(SIDE_MAT[s.k], 0, f.L, s.y0, s.y1, 0, { tint: s.tint, wall: [s.y0 < 0.01 ? 0 : s.base, s.top] });
    }

    // ---------- tops, ceilings, floors (greedy rectangles) ----------
    function greedy(keyAt, emit) {
      const W = M.W, H = M.H, seen = new Uint8Array(W * H);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const k = keyAt(c, r);
        if (k === null || seen[r * W + c]) continue;
        let w = 1; while (c + w < W && !seen[r * W + c + w] && keyAt(c + w, r) === k) w++;
        let h = 1;
        outer: while (r + h < H) { for (let i = 0; i < w; i++) if (seen[(r + h) * W + c + i] || keyAt(c + i, r + h) !== k) break outer; h++; }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[(r + j) * W + c + i] = 1;
        emit(k, M.cellX(c) - 1, M.cellZ(r) - 1, M.cellX(c + w - 1) + 1, M.cellZ(r + h - 1) + 1, c, r);
      }
    }
    const topMat = (k, c, r) => (k === '^' || k === 's' ? (M.siteAt(M.cellX(c), M.cellZ(r)) ? 'tiles' : 'cobble') : 'roof');
    greedy((c, r) => {
      const col = column(c, r);
      if (!col.length) return null;
      const iv = col[col.length - 1];
      return topMat(iv.k, c, r) + '|' + iv.y1 + '|' + tintOf(c, r, iv.k).join(',');
    }, (k, x0, z0, x1, z1) => {
      const [m, y, t] = k.split('|');
      Q(m, [x0, +y, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], { tint: m === 'roof' ? t.split(',').map(Number) : WHITE });
    });
    greedy((c, r) => {
      const ch = M.ch(c, r);
      return ROOF[ch] ? 'wood|' + ROOF[ch][0] : null;
    }, (k, x0, z0, x1, z1) => {
      Q('wood', [x0, +k.split('|')[1], z0], [x1 - x0, 0, 0], [0, 0, z1 - z0]);
    });
    // floor material of prop cells comes from their open neighbours
    function floorOf(c, r) {
      const ch = M.ch(c, r);
      if (column(c, r).some((iv) => iv.y0 < 0.01)) return null;
      const f = M.FLOOR[ch];
      if (f && FLOOR_MAT[f]) return FLOOR_MAT[f];
      if (f) return null;
      const votes = {};
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nf = M.FLOOR[M.ch(c + dc, r + dr)];
        if (nf && FLOOR_MAT[nf]) votes[FLOOR_MAT[nf]] = (votes[FLOOR_MAT[nf]] || 0) + 1;
      }
      let best = 'sand', bv = 0;
      for (const k in votes) if (votes[k] > bv) { bv = votes[k]; best = k; }
      return best;
    }
    greedy(floorOf, (m, x0, z0, x1, z1) => Q(m, [x0, 0, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)]));

    // ---------- facade trim and detail ----------
    // does the same wall carry on past this end of the segment (so trim must not stick out there)?
    // end = true checks past w1, false past w0 (world order along the face)
    const continues = (set, s, end) => {
      const d = DIRS[s.di], a = end ? s.w1 + 1 : s.w0 - 1;
      const c = d.dc ? M.colOf(s.plane - d.dc * 0.5) : M.colOf(a), r = d.dc ? M.rowOf(a) : M.rowOf(s.plane - d.dr * 0.5);
      return set.has(s.di + '|' + c + '|' + r);
    };
    // trim run along the face, sticking out past open ends only (t order: start at a = 0)
    const run = (set, s, f, ext) => {
      const flip = s.di === 0 || s.di === 3;   // these faces run from w1 to w0
      const w0Open = !continues(set, s, false), w1Open = !continues(set, s, true);
      return [-((flip ? w1Open : w0Open) ? ext : 0), f.L + ((flip ? w0Open : w1Open) ? ext : 0)];
    };
    const signPick = rand(991);
    for (const s of merged) {
      const f = frame(s), d = f.d, L = f.L;
      const isBuilding = s.k === '#' || s.k === '%' || s.k === 'H';
      if (!isBuilding) continue;
      const ground = s.y0 < 0.01;
      if (ground && s.k !== 'H') {
        const [a0, a1] = run(groundEdge, s, f, 0.05);
        f.box(s.k === '%' ? 'blocks' : 'trim', a0, a1, 0, 0.4, 0, 0.05, { skip: 'ny', tint: s.tint });
      }
      if (Math.abs(s.y1 - s.top) < 0.01 && s.top > 2) {
        const [a0, a1] = run(faceEdge, s, f, 0.12);
        f.box('trim', a0, a1, s.top - 0.22, s.top + 0.04, 0, 0.12, { tint: s.k === '%' ? WHITE : s.tint });
      }
      // bays of 2 m: doors, windows, signs, AC units, pipes
      const nb = Math.round(L / 2);
      for (let i = 0; i < nb; i++) {
        const c = 2 * i + 1;
        const pc = f.point(c, 1.0);
        const oc = M.colOf(pc[0]), orow = M.rowOf(pc[1]), outCh = M.ch(oc, orow);
        const open = M.walkable(oc, orow) || 'cCbw+p'.includes(outCh);
        const covered = ROOF[outCh] !== undefined;
        const rng = rand(hash3(pc[0], pc[1], s.di + 1));
        const roll = rng();
        const inY = (y0, y1) => y0 >= s.y0 - 0.001 && y1 <= s.y1 + 0.001;
        let usedGround = false;
        if (ground && open && s.top > 2.8) {
          if (roll < 0.17 && !covered && outCh !== '^' && outCh !== 's' && inY(0, 2.6)) {
            usedGround = true;
            f.quad('door', c - 0.5, c + 0.5, 0.12, 2.24, 0.035, { uv: [0, 0, 1, 1] });
            f.box('trim', c - 0.66, c - 0.5, 0, 2.24, 0, 0.13);
            f.box('trim', c + 0.5, c + 0.66, 0, 2.24, 0, 0.13);
            f.box('trim', c - 0.76, c + 0.76, 2.24, 2.48, 0, 0.16);
            f.box('trim', c - 0.7, c + 0.7, 0, 0.12, 0, 0.4, { skip: 'ny' });
            if (rng() < 0.55 && inY(0, 2.95)) awning(f, c, 2.9, 0.98, rng);
          } else if (roll < 0.43 && inY(0.9, 2.3)) {
            usedGround = true;
            win(f, c, 1.1, 0.8, 1.0, rng, true);
            if (rng() < 0.25 && inY(0, 2.65)) awning(f, c, 2.55, 0.7, rng);
          } else if (roll < 0.5 && inY(2.4, 3.0)) {
            usedGround = true;
            f.box('wood', c - 0.72, c + 0.72, 2.45, 2.95, 0, 0.06, { skip: d.n[0] > 0 ? 'px' : d.n[0] < 0 ? 'nx' : d.n[2] > 0 ? 'pz' : 'nz' });
            f.quad('sign', c - 0.72, c + 0.72, 2.45, 2.95, 0.06, { uv: MG.SIGNS[Math.floor(signPick() * MG.SIGNS.length)] });
          }
        }
        if (s.top > 5 && rng() < 0.62) {
          const wy = s.top > 6.9 ? 3.6 : 3.3;
          if (inY(wy - 0.2, wy + 1.4)) {
            win(f, c, wy, 0.9, 1.25, rng, false);
            if (s.top > 7.6 && rng() < 0.4 && inY(wy + 1.9, wy + 3.0)) win(f, c, Math.min(wy + 2.0, s.top - 1.5), 0.8, 0.9, rng, false);
          }
        } else if (s.top > 4.5 && rng() < 0.1 && inY(s.top - 2.4, s.top - 1.6)) {
          f.box('metal', c - 0.36, c + 0.36, s.top - 2.3, s.top - 1.8, 0, 0.4, { tint: [0.95, 0.95, 0.93] });
          f.box('metal', c - 0.3, c + 0.3, s.top - 2.36, s.top - 2.3, 0.05, 0.3);
        }
        if (!usedGround && rng() < 0.08 && s.top > 3 && inY(0.3, s.top - 0.15)) {
          const a = c - 0.85;
          f.box('metal', a - 0.06, a + 0.06, 0.25, s.top - 0.15, 0.03, 0.14, { tint: [0.8, 0.78, 0.74] });
          f.box('metal', a - 0.08, a + 0.08, 0.2, 0.32, 0.03, 0.22);
        }
        if (ground && open && !usedGround && rng() < 0.08 && inY(1.4, 2.0)) {
          f.box('metal', c - 0.18, c + 0.18, 1.45, 1.9, 0, 0.12, { tint: [0.78, 0.8, 0.82] });
        }
      }
    }
    function win(f, c, y, w, h, rng, low) {
      const hw = w / 2;
      f.quad('window', c - hw, c + hw, y, y + h, 0.02, { uv: [0, 0, 1, 1] });
      f.box('trim', c - hw - 0.08, c - hw, y - 0.04, y + h + 0.06, 0, 0.1);
      f.box('trim', c + hw, c + hw + 0.08, y - 0.04, y + h + 0.06, 0, 0.1);
      f.box('trim', c - hw - 0.08, c + hw + 0.08, y + h, y + h + 0.1, 0, 0.12);
      f.box('trim', c - hw - 0.14, c + hw + 0.14, y - 0.12, y, 0, 0.18);
      if (low && rng() < 0.6) for (let k = -1; k <= 1; k++) f.box('metal', c + k * w * 0.27 - 0.014, c + k * w * 0.27 + 0.014, y, y + h, 0.07, 0.095, { occ: false });
      if (rng() < 0.45) {
        const sw = w * 0.55, tint = [[0.55, 0.75, 0.85], [0.6, 0.85, 0.6], [1, 0.9, 0.75], [0.85, 0.62, 0.5]][Math.floor(rng() * 4)];
        f.box('wood', c - hw - 0.1 - sw, c - hw - 0.1, y - 0.02, y + h + 0.02, 0, 0.05, { tint });
        f.box('wood', c + hw + 0.1, c + hw + 0.1 + sw, y - 0.02, y + h + 0.02, 0, 0.05, { tint });
      } else if (!low && rng() < 0.22) {
        f.box('trim', c - hw - 0.3, c + hw + 0.3, y - 0.3, y - 0.12, 0, 0.75);
        f.box('metal', c - hw - 0.3, c + hw + 0.3, y + 0.6, y + 0.65, 0.69, 0.75, { occ: false });
        for (let a = -hw - 0.25; a <= hw + 0.26; a += 0.25) f.box('metal', c + a - 0.015, c + a + 0.015, y - 0.12, y + 0.6, 0.7, 0.73, { occ: false });
      }
    }
    function awning(f, c, y, hw, rng) {
      const depth = 1.0 + rng() * 0.25, drop = 0.42;
      const pa = f.point(c + hw, 0), pb = f.point(c - hw, 0);
      const t = f.d.t, n = f.d.n, w = 2 * hw;
      const uvs = [[0, 0, 1, 0.5], [0, 0.5, 1, 1]][Math.floor(rng() * 2)];
      // top surface and underside are separate quads so each gets its own light
      Q('cloth', [pa[0], y, pa[1]], [-t[0] * w, 0, -t[2] * w], [n[0] * depth, -drop, n[2] * depth], { uv: uvs });
      Q('cloth', [pb[0], y - 0.02, pb[1]], [t[0] * w, 0, t[2] * w], [n[0] * depth, -drop, n[2] * depth], { uv: uvs, tint: [0.8, 0.8, 0.8] });
      occQuads.push({ o: [pb[0], y - 0.01, pb[1]], u: [t[0] * w, 0, t[2] * w], v: [n[0] * depth, -drop, n[2] * depth] });
      const tip = f.point(c - hw, depth), tip2 = f.point(c + hw, depth);
      props.push({ type: 'rod', a: [tip[0], y - drop, tip[1]], b: [pb[0] + n[0] * 0.02, y - 1.0, pb[1] + n[2] * 0.02] });
      props.push({ type: 'rod', a: [tip2[0], y - drop, tip2[1]], b: [pa[0] + n[0] * 0.02, y - 1.0, pa[1] + n[2] * 0.02] });
    }

    // ---------- props ----------
    for (const b of M.boxes) {
      const { x0, y0, z0, x1, y1, z1, kind } = b;
      if (kind === 'crate') {
        box('crate', x0, y0, z0, x1, y1, z1, { skip: 'ny', uv: [0, 0, 1, 1] });
      } else if (kind === 'lowwall') {
        box('rubble', x0, 0, z0, x1, y1 - 0.12, z1, { skip: 'ny' });
        box('trim', x0 - 0.05, y1 - 0.12, z0 - 0.05, x1 + 0.05, y1, z1 + 0.05);
      } else if (kind === 'pillar') {
        box('trim', x0, 0, z0, x1, y1, z1, { skip: 'ny' });
        box('trim', x0 - 0.16, 0, z0 - 0.16, x1 + 0.16, 0.34, z1 + 0.16, { skip: 'ny' });
        box('trim', x0 - 0.06, 0.34, z0 - 0.06, x1 + 0.06, 0.44, z1 + 0.06);
        box('trim', x0 - 0.2, y1 - 0.32, z0 - 0.2, x1 + 0.2, y1, z1 + 0.2);
        box('trim', x0 - 0.08, y1 - 0.44, z0 - 0.08, x1 + 0.08, y1 - 0.32, z1 + 0.08);
      } else if (kind === 'barrel') {
        props.push({ type: 'barrel', x: (x0 + x1) / 2, z: (z0 + z1) / 2, seed: hash3(x0, z0, 5) });
        occ.push([x0 + 0.05, 0, z0 + 0.05, x1 - 0.05, 1.15, z1 - 0.05]);
      } else if (kind === 'palm') {
        props.push({ type: 'palm', x: (x0 + x1) / 2, z: (z0 + z1) / 2, seed: hash3(x0, z0, 9) });
        occ.push([x0 + 0.08, 0, z0 + 0.08, x1 - 0.08, 6, z1 - 0.08]);
      }
    }
    // sagging cables between rooftops
    [[22, 28, 18], [22, 28, 27], [22, 28, 34], [39, 46, 37], [39, 46, 21], [2, 9, 29], [2, 9, 40], [15, 34, 44]].forEach(([c0, c1, row]) => {
      props.push({ type: 'cable', a: [M.cellX(c0) - 1, 5.4, M.cellZ(row)], b: [M.cellX(c1) + 1, 5.4, M.cellZ(row)], sag: 1.4 });
    });

    // ---------- decals (own lightmap charts, drawn blended over the floor) ----------
    // flat square facing up, turned by rot about the vertical axis
    const decal = (key, x, y, z, size, rot) => {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const u = [size * cs, 0, -size * sn], v = [-size * sn, 0, -size * cs];
      Q('decal', [x - u[0] / 2 - v[0] / 2, y, z - u[2] / 2 - v[2] / 2], u, v, { uv: MG.DECALS[key] });
    };
    decal('A', 28, 0.812, -28, 3.4, 0.1);
    decal('B', -28, 0.012, -20, 3.4, -0.15);
    const dr = rand(77);
    for (let i = 0; i < 46; i++) {
      const c = Math.floor(dr() * M.W), r = Math.floor(dr() * M.H);
      const size = 1.6 + dr() * 2.6, rot = dr() * 6.28, oil = dr() < 0.3;
      if (!M.walkable(c, r) || M.floorH(c, r) > 0 || ROOF[M.ch(c, r)]) continue;
      decal(oil ? 'oil' : 'dirt', M.cellX(c) + dr() - 0.5, 0.006 + i * 0.0002, M.cellZ(r) + dr() - 0.5, size, rot);
    }

    // ---------- lightmap charts (shelf packing) ----------
    const T = MG.TEXEL;
    for (const q of quads) {
      const lu = Math.hypot(q.u[0], q.u[1], q.u[2]), lv = Math.hypot(q.v[0], q.v[1], q.v[2]);
      q.tw = Math.max(2, Math.ceil(lu * T) + 1);
      q.th = Math.max(2, Math.ceil(lv * T) + 1);
      if (q.tw > MG.ATLAS_W - 2) q.tw = MG.ATLAS_W - 2;
    }
    const order = quads.map((q, i) => i).sort((a, b) => quads[b].th - quads[a].th || quads[b].tw - quads[a].tw || a - b);
    let x = 1, y = 1, rowH = 0;
    for (const i of order) {
      const q = quads[i];
      if (x + q.tw + 1 > MG.ATLAS_W) { x = 1; y += rowH + 1; rowH = 0; }
      q.lx = x; q.ly = y;
      x += q.tw + 1; rowH = Math.max(rowH, q.th);
    }
    const atlasH = Math.ceil((y + rowH + 1) / 4) * 4;
    let sum = quads.length;
    for (const q of quads) sum = (sum * 31 + q.lx * 7 + q.ly * 13 + q.tw * 17 + q.th * 19) % 2147483647;
    return { quads, occ, occQuads, props, atlasW: MG.ATLAS_W, atlasH, checksum: sum };
  };
})(window.G);
