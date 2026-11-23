// textures.js — scanned and procedural world texture arrays, detail maps for soldiers and guns,
// and procedural FX sprites.
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const T = G.Tex = { cache: {} };
  const S = 512;

  // ---------- noise ----------
  const rngOf = G.seeded || function (seed) {
    return function () {
      seed=(seed+0x6D2B79F5)>>>0;
      let t=Math.imul(seed^(seed>>>15),seed|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  };
  function vnoise(size, cells, seed) {
    const out = new Float32Array(size * size), r = rngOf(seed), lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const fr = new Float32Array(size), ix = new Int32Array(size);
    for (let x = 0; x < size; x++) { const g = x / size * cells, i = Math.floor(g); let f = g - i; f = f * f * f * (f * (f * 6 - 15) + 10); fr[x] = f; ix[x] = i; }
    for (let y = 0; y < size; y++) {
      const fy = fr[y], y0 = (ix[y] % cells) * cells, y1 = ((ix[y] + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const f = fr[x], x0 = ix[x] % cells, x1 = (ix[x] + 1) % cells;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * f, b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * f;
        out[y * size + x] = a + (b - a) * fy;
      }
    }
    return out;
  }
  function fbm(size, cells, oct, seed, gain) {
    gain = gain || 0.5;
    const out = new Float32Array(size * size);
    let amp = 1, tot = 0;
    for (let o = 0; o < oct && (cells << o) <= size; o++) {
      const n = vnoise(size, cells << o, seed * 31 + o * 7 + 1);
      for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
      tot += amp; amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  // tileable Voronoi: distance to nearest point, edge measure (F2 - F1) and cell id, in cell units
  function voronoi(size, nx, ny, seed, jit, warp, wamt) {
    const r = rngOf(seed), px = new Float32Array(nx * ny), py = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { px[j * nx + i] = (i + 0.5 + (r() - 0.5) * jit) / nx; py[j * nx + i] = (j + 0.5 + (r() - 0.5) * jit) / ny; }
    const f1 = new Float32Array(size * size), edge = new Float32Array(size * size), id = new Int32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v0 = (y + 0.5) / size;
      for (let x = 0; x < size; x++) {
        let u = (x + 0.5) / size, v = v0;
        if (warp) { u += (warp[y * size + x] - 0.5) * wamt; v += (warp[((y + 97) % size) * size + ((x + 131) % size)] - 0.5) * wamt; u -= Math.floor(u); v -= Math.floor(v); }
        const ci = Math.floor(u * nx), cj = Math.floor(v * ny);
        let d1 = 1e9, d2 = 1e9, best = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          let i = ci + di, j = cj + dj, ox = 0, oy = 0;
          if (i < 0) { i += nx; ox = -1; } else if (i >= nx) { i -= nx; ox = 1; }
          if (j < 0) { j += ny; oy = -1; } else if (j >= ny) { j -= ny; oy = 1; }
          const k = j * nx + i, dx = (px[k] + ox - u) * nx, dy = (py[k] + oy - v) * ny, d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
        const o = y * size + x;
        f1[o] = Math.sqrt(d1); edge[o] = Math.sqrt(d2) - Math.sqrt(d1); id[o] = best;
      }
    }
    return { f1, edge, id };
  }
  function blur(src, size, rad) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = 1 / (2 * rad + 1);
    for (let y = 0; y < size; y++) {
      let acc = 0;
      for (let x = -rad; x <= rad; x++) acc += src[y * size + ((x + size) % size)];
      for (let x = 0; x < size; x++) {
        tmp[y * size + x] = acc * k;
        acc += src[y * size + ((x + rad + 1) % size)] - src[y * size + ((x - rad + size) % size)];
      }
    }
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += tmp[((y + size) % size) * size + x];
      for (let y = 0; y < size; y++) {
        out[y * size + x] = acc * k;
        acc += tmp[((y + rad + 1) % size) * size + x] - tmp[((y - rad + size) % size) * size + x];
      }
    }
    return out;
  }
  const lin = (hex) => [Math.pow(((hex >> 16) & 255) / 255, 2.2), Math.pow(((hex >> 8) & 255) / 255, 2.2), Math.pow((hex & 255) / 255, 2.2)];
  const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };

  // a layer: linear colour, height (for normals and cavity shading), gloss / alpha
  function layer() { return { c: new Float32Array(S * S * 3), h: new Float32Array(S * S), a: new Float32Array(S * S) }; }
  function setC(L, i, col, k) { k = k === undefined ? 1 : k; L.c[i * 3] = col[0] * k; L.c[i * 3 + 1] = col[1] * k; L.c[i * 3 + 2] = col[2] * k; }
  // stamp a soft round feature with wrap-around (for tiling)
  function splat(cx, cy, rad, fn) {
    const r0 = Math.ceil(rad);
    for (let dy = -r0; dy <= r0; dy++) for (let dx = -r0; dx <= r0; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) / rad;
      if (d > 1) continue;
      const x = ((Math.round(cx) + dx) % S + S) % S, y = ((Math.round(cy) + dy) % S + S) % S;
      fn(y * S + x, d);
    }
  }
  function fillRect(L, x0, y0, w, h, fn) {
    for (let y = Math.max(0, y0 | 0); y < Math.min(S, (y0 + h) | 0); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(S, (x0 + w) | 0); x++) fn(y * S + x, x, y);
  }

  // ---------- world materials (row 0 = v 0, i.e. the bottom of the texture) ----------
  const gen = {};
  gen.sand = function () {
    const L = layer(), n1 = fbm(S, 4, 5, 11), n2 = fbm(S, 24, 3, 12), warp = fbm(S, 3, 3, 13), r = rngOf(14);
    const A = lin(0xd8b98a), B = lin(0xb98f5c), C = lin(0xe6cfa6);
    for (let i = 0; i < S * S; i++) {
      const y = (i / S) | 0, rip = Math.sin(((y / S) * 14 + warp[i] * 2.2 + n1[i] * 0.6) * Math.PI * 2);
      L.h[i] = 0.32 * n1[i] + 0.14 * n2[i] + 0.1 * (rip * 0.5 + 0.5);
      let col = mix3(B, A, sstep(0.3, 0.7, n1[i]));
      col = mix3(col, C, sstep(0.55, 0.9, n2[i]) * 0.35 + (rip > 0.6 ? 0.08 : 0));
      setC(L, i, col, 0.92 + n2[i] * 0.16);
      // A pair of shallow wheel grooves with interrupted chevrons pressed into the dust.
      const u=(i%S)/S, v=y/S, bend=.015*Math.sin(v*Math.PI*2);
      const edge=Math.min(Math.abs(u-.32-bend),Math.abs(u-.66-bend));
      const rut=1-sstep(.017,.032,edge);
      const tread=.5+.5*Math.cos((v*32+edge*18)*Math.PI*2);
      const mark=rut*(.36+.64*tread)*(1-sstep(.54,.71,n1[i]));
      for(let ch=0;ch<3;ch++) L.c[i*3+ch]*=1-.17*mark;
      L.h[i]-=.105*mark;
      L.a[i] = 0.05+.09*mark;
    }
    for (let k = 0; k < 1300; k++) {
      const x = r() * S, y = r() * S, rad = 1.2 + Math.pow(r(), 3) * 5, tone = r();
      const col = tone < 0.4 ? lin(0x8c7a62) : tone < 0.7 ? lin(0xa07850) : lin(0xe8dcc4);
      splat(x, y, rad, (i, d) => { const dome = Math.sqrt(1 - d * d); L.h[i] = Math.max(L.h[i], 0.5 + dome * 0.4); setC(L, i, col, 0.75 + dome * 0.35); L.a[i] = 0.12; });
    }
    return L;
  };
  gen.cobble = function () {
    const L = layer(), vo = voronoi(S, 9, 9, 21, 0.85), n = fbm(S, 8, 4, 22), g = fbm(S, 32, 2, 23), r = rngOf(24);
    const tones = []; for (let k = 0; k < 81; k++) tones.push(scl(mix3(lin(0xb8a688), lin(0x8e7f6a), r()), 0.85 + r() * 0.3));
    const joint = lin(0xa88b62);
    for (let i = 0; i < S * S; i++) {
      const e = vo.edge[i], top = sstep(0.04, 0.26, e);
      const dome = 1 - Math.min(1, vo.f1[i] * 0.9);
      L.h[i] = top * (0.55 + 0.25 * dome + 0.12 * n[i]) + (1 - top) * 0.12 * g[i];
      const col = mix3(joint, tones[vo.id[i]], top);
      setC(L, i, col, (0.86 + g[i] * 0.22) * (0.9 + 0.1 * n[i]));
      L.a[i] = 0.06 + 0.22 * top;
    }
    return L;
  };
  gen.tiles = function () {
    const L = layer(), n = fbm(S, 8, 4, 31), g = fbm(S, 48, 2, 32), cr = fbm(S, 16, 3, 33), r = rngOf(34);
    const N = 8, sz = S / N, grout = lin(0x9a8466);
    const cells = [];
    for (let k = 0; k < N * N; k++) {
      const terr = ((k % N) + ((k / N) | 0)) % 4 === 0, miss = r() < 0.05;
      cells.push({ col: scl(terr ? lin(0xb56e48) : lin(0xd9c39a), 0.85 + r() * 0.25), miss, chip: r() });
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, cx = (x / sz) | 0, cy = (y / sz) | 0, c = cells[cy * N + cx];
      const lx = x - cx * sz, ly = y - cy * sz, ed = Math.min(lx, ly, sz - 1 - lx, sz - 1 - ly);
      const corner = Math.min(Math.hypot(lx, ly), Math.hypot(sz - lx, ly), Math.hypot(lx, sz - ly), Math.hypot(sz - lx, sz - ly));
      const chipped = c.chip > 0.6 && corner < 6 + c.chip * 10 + n[i] * 6;
      const isTile = ed > 2.5 && !chipped && !c.miss;
      if (isTile) {
        const crack = Math.abs(cr[i] - 0.5) < 0.006 && c.chip > 0.75;
        L.h[i] = 0.6 + 0.05 * n[i] - (crack ? 0.25 : 0) - (ed < 5 ? (5 - ed) * 0.03 : 0);
        setC(L, i, c.col, (0.82 + 0.25 * n[i]) * (crack ? 0.6 : 1) * (0.94 + g[i] * 0.12));
        L.a[i] = 0.28 + 0.15 * n[i];
      } else {
        L.h[i] = 0.12 + 0.1 * g[i];
        setC(L, i, c.miss ? lin(0xc4a072) : grout, 0.8 + g[i] * 0.3);
        L.a[i] = 0.05;
      }
    }
    return L;
  };
  gen.blocks = function () {
    const L = layer(), n = fbm(S, 6, 5, 41), ch = fbm(S, 64, 2, 42), big = fbm(S, 2, 3, 43), r = rngOf(44);
    const rows = 8, rh = S / rows, mortar = lin(0xa48a66);
    const id = new Int32Array(S * S).fill(-1), dist = new Float32Array(S * S), tones = [];
    for (let row = 0; row < rows; row++) {
      let x = r() * 60;
      const end = x + S;
      while (x < end) {
        const w = 70 + r() * 90, k = tones.length;
        tones.push(scl(mix3(lin(0xd8b98a), lin(0xc49a68), r()), 0.88 + r() * 0.2));
        for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < w; xx++) {
          const px = ((Math.floor(x + xx)) % S + S) % S, py = row * rh + yy;
          const d = Math.min(xx, w - 1 - xx, yy, rh - 1 - yy);
          id[py * S + px] = k; dist[py * S + px] = d;
        }
        x += w;
      }
    }
    for (let i = 0; i < S * S; i++) {
      const d = dist[i], face = sstep(2, 7 + n[i] * 5, d);
      L.h[i] = face * (0.62 + 0.16 * ch[i] + 0.1 * n[i]) + (1 - face) * 0.18;
      const col = face > 0.02 ? mix3(mortar, tones[id[i]], face) : mortar;
      setC(L, i, col, (0.84 + 0.22 * n[i]) * (0.9 + 0.2 * big[i]) * (0.95 + 0.1 * ch[i]));
      L.a[i] = 0.05;
    }
    return L;
  };
  gen.plaster = function () {
    const L = layer(), n = fbm(S, 3, 5, 51), fine = fbm(S, 48, 2, 52), stain = fbm(S, 5, 4, 53), hole = fbm(S, 6, 4, 54), r = rngOf(55);
    const base = lin(0xdfcba7), dirt = lin(0xb59a74), brickA = lin(0xa8643f), brickB = lin(0x8f5636), mort = lin(0xb9a383);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, fall = hole[i] + .08*(fine[i]-.5) > .708;
      if (fall) {
        const by = (y / 14) | 0, bx = ((x + (by % 2) * 14) / 28) | 0, lx = (x + (by % 2) * 14) % 28, ly = y % 14;
        const brick = lx > 2 && ly > 2;
        L.h[i] = brick ? 0.3 + 0.05 * fine[i] : 0.18;
        setC(L, i, brick ? ((bx * 7 + by * 3) % 5 < 2 ? brickB : brickA) : mort, 0.85 + 0.25 * fine[i]);
        L.a[i] = 0.04;
      } else {
        const edge = sstep(.71,.64,hole[i]);
        L.h[i] = 0.6 + 0.06 * n[i] + 0.03 * fine[i] + (1 - edge) * 0.08;
        let col = mix3(base, dirt, sstep(0.45, 0.85, stain[i]) * 0.55);
        setC(L, i, col, (0.9 + 0.12 * n[i]) * (0.96 + 0.08 * fine[i]) * (0.75 + 0.25 * edge));
        L.a[i] = 0.06;
      }
    }
    for (let k = 0; k < 7; k++) {   // hairline cracks
      let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
      for (let s = 0; s < 70; s++) {
        a += (r() - 0.5) * 0.9; x += Math.cos(a) * 2; y += Math.sin(a) * 2;
        splat(x, y, 0.9, (i) => { L.h[i] -= 0.06; L.c[i * 3] *= 0.86; L.c[i * 3 + 1] *= 0.86; L.c[i * 3 + 2] *= 0.86; });
      }
    }
    return L;
  };
  gen.rubble = function () {
    const wp = fbm(S, 8, 3, 64), L = layer(), vo = voronoi(S, 7, 12, 61, 0.9, wp, 0.035), n = fbm(S, 12, 4, 62), fine = fbm(S, 64, 2, 65), r = rngOf(63);
    const tones = []; for (let k = 0; k < 60; k++) tones.push(scl(mix3(lin(0xc6ad86), lin(0x8d7c66), r()), 0.85 + r() * 0.3));
    const mort = lin(0x9c8a6c);
    for (let i = 0; i < S * S; i++) {
      const top = sstep(0.04 + fine[i] * 0.06, 0.22, vo.edge[i]);
      L.h[i] = top * (0.5 + 0.18 * (1 - vo.f1[i] * 0.8) + 0.2 * n[i] + 0.08 * fine[i]) + 0.1;
      setC(L, i, mix3(mort, tones[vo.id[i] % tones.length], top), (0.78 + 0.3 * n[i]) * (0.9 + 0.2 * fine[i]));
      L.a[i] = 0.05;
    }
    return L;
  };
  gen.trim = function () {
    const L = layer(), n = fbm(S, 4, 5, 71), pits = fbm(S, 96, 1, 72), band = fbm(S, 2, 3, 73);
    const A = lin(0xeadcbf), B = lin(0xcfb994);
    for (let i = 0; i < S * S; i++) {
      const pit = pits[i] > 0.9 ? 1 : 0;
      L.h[i] = 0.6 + 0.08 * n[i] - pit * 0.05;
      setC(L, i, mix3(A, B, sstep(0.3, 0.8, n[i] * 0.7 + band[i] * 0.3)), 0.92 + 0.1 * n[i] - pit * 0.08);
      L.a[i] = 0.08;
    }
    return L;
  };
  gen.roof = function () {
    const L = layer(), n = fbm(S, 4, 5, 81), g = fbm(S, 40, 2, 82), st = fbm(S, 6, 4, 83);
    const A = lin(0xb8a688), B = lin(0x8a7a66);
    for (let i = 0; i < S * S; i++) {
      L.h[i] = 0.5 + 0.1 * n[i] + 0.05 * g[i];
      setC(L, i, mix3(A, B, sstep(0.4, 0.8, st[i])), 0.85 + 0.2 * g[i]);
      L.a[i] = 0.04;
    }
    return L;
  };
  function planks(L, count, vertical, seed, palette, gapCol) {
    const grain = fbm(S, 4, 4, seed), fine = fbm(S, 64, 2, seed + 1), r = rngOf(seed + 2);
    const tones = []; for (let k = 0; k < count; k++) tones.push(scl(palette[(r() * palette.length) | 0], 0.8 + r() * 0.35));
    const pw = S / count;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, a = vertical ? x : y, b = vertical ? y : x, k = (a / pw) | 0, la = a - k * pw;
      const gap = la < 2 || la > pw - 2;
      const gi = vertical ? ((y * 0.15 + grain[i] * 40) | 0) : ((x * 0.15 + grain[i] * 40) | 0);
      const ring = Math.sin((a * 0.9 + grain[(b * S + a) % (S * S)] * 30 + k * 13) * 0.6) * 0.5 + 0.5;
      L.h[i] = gap ? 0.1 : 0.55 + 0.08 * ring + 0.05 * fine[i];
      setC(L, i, gap ? gapCol : tones[k], gap ? 1 : (0.82 + 0.18 * ring) * (0.92 + 0.12 * fine[i]) * (gi % 7 === 0 ? 0.93 : 1));
      L.a[i] = gap ? 0.02 : 0.12;
    }
  }
  gen.wood = function () {
    const L = layer();
    planks(L, 6, true, 91, [lin(0x8a6440), lin(0x7a5434), lin(0x96704a)], lin(0x2a1c10));
    const wear=fbm(S,9,4,93), pigment=lin(0x537876);
    for(let i=0;i<L.h.length;i++) {
      if(L.h[i]<.48 || wear[i]<.39) continue;
      const coat=sstep(.39,.47,wear[i])*.85;
      for(let k=0;k<3;k++) L.c[i*3+k]=L.c[i*3+k]*(1-coat)+pigment[k]*(.68+L.h[i]*.60)*coat;
      L.a[i]+=.08*coat;
    }
    return L;
  };
  gen.crate = function (markBraces) {
    const L = layer();
    planks(L, 5, false, 101, [lin(0xa77a48), lin(0x93683c), lin(0xb48654)], lin(0x3a2612));
    const frame = lin(0x7c5530), r = rngOf(102);
    const brace = (i, height, tone) => {
      L.h[i] = height; setC(L, i, frame, tone);
      if (markBraces) L.a[i] = .24;
    };
    const fr = (x, y, w, h) => fillRect(L, x, y, w, h, i => brace(i, .8, .9 + r() * .12));
    fr(0, 0, S, 46); fr(0, S - 46, S, 46); fr(0, 0, 46, S); fr(S - 46, 0, 46, S);
    for (let t = -230; t < 230; t++) {   // diagonal brace
      const cx = S / 2 + t * 0.707 * 1.414, cy = S / 2 + t * 0.707 * 1.414;
      splat(cx, cy, 22, i => brace(i, .78, .95));
    }
    [[23, 23], [S - 23, 23], [23, S - 23], [S - 23, S - 23]].forEach(([x, y]) => splat(x, y, 6, (i, d) => { L.h[i] = 0.9 + (1 - d) * 0.1; setC(L, i, lin(0x2a2a2a), 1); L.a[i] = 0.5; }));
    return L;
  };
  gen.door = function () {
    const L = layer(), paint = fbm(S, 6, 4, 111), r = rngOf(112);
    planks(L, 5, true, 113, [lin(0x6e5236)], lin(0x1e140c));
    const blue = lin(0x3f6f86);
    for (let i = 0; i < S * S; i++) {
      if (paint[i] > 0.38 && L.h[i] > 0.2) { setC(L, i, blue, 0.85 + 0.25 * paint[i]); L.a[i] = 0.2; }
    }
    [0.18, 0.78].forEach((f) => fillRect(L, 20, f * S - 14, S - 40, 28, (i) => { L.h[i] = 0.85; setC(L, i, lin(0x3a3633), 0.8 + r() * 0.15); L.a[i] = 0.35; }));
    [0.18, 0.78].forEach((f) => { for (let x = 40; x < S - 30; x += 70) splat(x, f * S, 7, (i, d) => { L.h[i] = 0.95; setC(L, i, lin(0x22201e), 1.1 - d * 0.4); L.a[i] = 0.5; }); });
    splat(S * 0.82, S * 0.48, 13, (i, d) => { L.h[i] = 1; setC(L, i, lin(0x6b5a3a), 1.2 - d * 0.5); L.a[i] = 0.7; });
    return L;
  };
  gen.window = function () {
    const L = layer(), n = fbm(S, 4, 3, 121);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, v = y / S;
      const mull = Math.abs(x - S / 2) < 7 || Math.abs(y - S * 0.62) < 7;
      if (mull) { L.h[i] = 0.9; setC(L, i, lin(0x4a3524), 0.9 + n[i] * 0.2); L.a[i] = 0.1; continue; }
      const curtain = x < S * 0.22 + Math.sin(y * 0.08) * 6 && n[i] > 0.3;
      const glass = mix3(lin(0x0c0d10), lin(0x2a2c30), v * 0.8 + n[i] * 0.3);
      setC(L, i, curtain ? lin(0x5a2a22) : glass, curtain ? 0.6 + 0.3 * Math.sin(x * 0.5) : 1);
      L.h[i] = 0.5; L.a[i] = curtain ? 0.05 : 0.95;
    }
    return L;
  };
  gen.metal = function () {
    const L = layer(), n = fbm(S, 6, 4, 131), rust = fbm(S, 10, 5, 132), scr = fbm(S, 128, 1, 133);
    const paint = lin(0x8c9a9c), rustC = lin(0x7a4628), rustD = lin(0x4a2a18);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, seam = (x % 128) < 3 || (y % 256) < 3;
      const rr = sstep(0.62, 0.75, rust[i] + (1 - y / S) * 0.08);
      L.h[i] = seam ? 0.3 : 0.6 - rr * 0.05;
      let col = mix3(paint, mix3(rustC, rustD, n[i]), rr);
      setC(L, i, col, (seam ? 0.6 : 1) * (0.88 + 0.18 * n[i]) * (scr[i] > 0.85 ? 1.15 : 1));
      L.a[i] = 0.55 * (1 - rr) + 0.1;
    }
    return L;
  };
  gen.cloth = function () {
    const L = layer(), n = fbm(S, 6, 4, 141), weave = fbm(S, 256, 1, 142);
    const sets = [[lin(0xb8432f), lin(0xe8dcc0)], [lin(0x2f5f8a), lin(0xe4d8bc)]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, half = y < S / 2 ? 0 : 1, stripe = ((x / 48) | 0) % 2;
      const col = sets[half][stripe];
      const yy = (y % (S / 2)) / (S / 2), dirt = sstep(0.4, 0.0, yy) * 0.25 + sstep(0.6, 1.0, yy) * 0.15;
      L.h[i] = 0.5 + 0.1 * weave[i];
      setC(L, i, col, (0.82 + 0.2 * n[i]) * (0.92 + 0.1 * weave[i]) * (1 - dirt));
      L.a[i] = 0.03;
    }
    return L;
  };
  // canvas content (text) is drawn top-down; copy it so the canvas top lands at v = 1
  function fromCanvas(cvs, L, alphaToA) {
    const d = cvs.getContext('2d').getImageData(0, 0, S, S).data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const s = ((S - 1 - y) * S + x) * 4, i = y * S + x;
      L.c[i * 3] = Math.pow(d[s] / 255, 2.2); L.c[i * 3 + 1] = Math.pow(d[s + 1] / 255, 2.2); L.c[i * 3 + 2] = Math.pow(d[s + 2] / 255, 2.2);
      if (alphaToA) L.a[i] = d[s + 3] / 255;
    }
  }
  function canvas(w, h) { const c = typeof document === 'undefined' ? new OffscreenCanvas(w,h||w) : document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  gen.sign = function () {
    const L = layer(), c = canvas(S), g = c.getContext('2d'), r = rngOf(151);
    const names = ['沙棠茶社', '南井杂货', '风栈客舍', '双砧五金', '石榴药房', '早炉饼坊', '苇梭织坊', '绛砂染坊'];
    const boards = ['#7a2e22', '#2d4a5e', '#3e5a2e', '#6a4a24', '#1f3c4a', '#7a5a1e', '#4a2a3a', '#5a5248'];
    names.forEach((name, k) => {
      const x = (k % 2) * 256, y = ((k / 2) | 0) * 128;
      g.fillStyle = boards[k]; g.fillRect(x, y, 256, 128);
      g.strokeStyle = 'rgba(240,220,170,.8)'; g.lineWidth = 5; g.strokeRect(x + 8, y + 8, 240, 112);
      g.fillStyle = '#f0e2bd'; g.font = 'bold 48px "Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, x + 128, y + 68);
      for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(40,25,10,' + (r() * 0.35) + ')'; g.fillRect(x + r() * 256, y + r() * 128, 1 + r() * 3, 1 + r() * 3); }
    });
    fromCanvas(c, L);
    for (let i = 0; i < S * S; i++) { L.h[i] = 0.5; L.a[i] = 0.15; }
    return L;
  };
  gen.decal = function () {
    const L = layer(), c = canvas(S), g = c.getContext('2d'), r = rngOf(161);
    const letter = (ch, x) => {
      g.save(); g.fillStyle = '#b3342a'; g.font = 'bold 230px Impact,"Arial Black",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ch, x + 128, 136); g.restore();
    };
    letter('A', 0); letter('B', 256);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2200; i++) { g.globalAlpha = r() * 0.8; g.fillRect(r() * 512, r() * 256, 1 + r() * 4, 1 + r() * 4); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const blob = (cx, cy, color, k) => {
      const n = fbm(256, 6, 4, k);
      const img = g.getImageData(cx - 128, cy - 128, 256, 256), d = img.data;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const dd = Math.hypot(x - 128, y - 128) / 128, a = sat((1 - dd) * 1.6 + (n[y * 256 + x] - 0.5) * 1.4);
        const o = (y * 256 + x) * 4; d[o] = color[0]; d[o + 1] = color[1]; d[o + 2] = color[2]; d[o + 3] = 255 * a * a * (k === 163 ? 0.85 : 0.6);
      }
      g.putImageData(img, cx - 128, cy - 128);
    };
    blob(128, 384, [92, 70, 46], 162); blob(384, 384, [22, 18, 14], 163);
    fromCanvas(c, L, true);
    return L;
  };
  const ORDER = ['sand', 'cobble', 'tiles', 'blocks', 'plaster', 'rubble', 'trim', 'roof', 'wood', 'crate', 'door', 'window', 'metal', 'cloth', 'sign', 'decal'];
  T.ORDER = ORDER;

  // finishes a layer: cavity darkening, optional baked relief shading, packing into RGBA bytes
  function pack(L, out, off, relief) {
    const cav = blur(L.h, S, 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = L.h[y * S + ((x + 1) % S)] - L.h[y * S + ((x + S - 1) % S)];
      const dy = L.h[((y + 1) % S) * S + x] - L.h[((y + S - 1) % S) * S + x];
      let k = 1 - sat((cav[i] - L.h[i]) * 1.6) * 0.45;
      if (relief) k *= 1 + Math.min(.22,Math.max(-.22,(-dx*.6+dy*.9)*relief*2));
      const o = off + i * 4;
      out[o] = Math.round(255 * Math.sqrt(sat(L.c[i * 3] * k)));
      out[o + 1] = Math.round(255 * Math.sqrt(sat(L.c[i * 3 + 1] * k)));
      out[o + 2] = Math.round(255 * Math.sqrt(sat(L.c[i * 3 + 2] * k)));
      out[o + 3] = Math.round(255 * sat(L.a[i]));
    }
  }
  function packNormal(L, out, off, strength) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = (L.h[y * S + ((x + 1) % S)] - L.h[y * S + ((x + S - 1) % S)]) * strength;
      const dy = (L.h[((y + 1) % S) * S + x] - L.h[((y + S - 1) % S) * S + x]) * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1), o = off + i * 2;
      out[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      // The shader reconstructs positive tangent-space Z from XY.
    }
  }
  const NSTR = { sand: 3, cobble: 7, tiles: 5, blocks: 6, plaster: 3, rubble: 8, trim: 3, roof: 3, wood: 4, crate: 4, door: 4, window: 2, metal: 3, cloth: 2, sign: 1, decal: 1 };

  // Keep the authored stone courses, boards and lettering at a consistent physical scale.
  // Large surfaces get another octave of relief at the destination texel density. XY normals
  // occupy RG8. Roughness is packed as gloss in the albedo alpha (coverage for decals).
  function resizeLayer(src, channels, dst, offset, size, grain, normal) {
    if (size === S) { dst.set(src,offset); return; }
    const ratio=S/size, mask=S-1;
    for(let y=0;y<size;y++) {
      const py=(y+.5)*ratio-.5, iy=Math.floor(py), fy=py-iy;
      const row0=(iy&mask)*S, row1=((iy+1)&mask)*S;
      for(let x=0;x<size;x++) {
        const px=(x+.5)*ratio-.5, ix=Math.floor(px), fx=px-ix;
        const a=(row0+(ix&mask))*channels, b=(row0+((ix+1)&mask))*channels;
        const c=(row1+(ix&mask))*channels, d=(row1+((ix+1)&mask))*channels;
        const o=offset+(y*size+x)*channels;
        const g=(y&255)*256+(x&255), relief=grain ? grain[g] : 0;
        for(let k=0;k<channels;k++) {
          const top=src[a+k]+fx*(src[b+k]-src[a+k]), bottom=src[c+k]+fx*(src[d+k]-src[c+k]);
          let value=top+fy*(bottom-top);
          if (grain) {
            if(normal) value+=(relief-grain[k ? ((g+256)&65535) : (g&65280)|((x+1)&255)])*.80;
            else value+=relief*(k===3 ? .20 : .55);
          }
          dst[o+k]=Math.max(0,Math.min(255,Math.round(value)));
        }
      }
    }
  }
  const SCANS = {
    sand_01: [1, .9], gravelly_sand: [1.35, .7], rocky_trail_02: [1.25, .8],
    plastered_wall: [1, 1], beige_wall_001: [1.08, .9], red_brick_03: [1.12, .85],
    sandstone_blocks_05: [1, 1], stone_tiles_02: [1.08, 1],
    weathered_planks: [1.25, .95], rusty_metal_02: [1, .65],
  };
  const SANDSTONE = ['sandstone_blocks_05', 1.95], PAVING = ['stone_tiles_02', 2.4];
  // Tile widths in metres. The optional third value selects the blend in the world shader.
  const SCAN_SURFACES = {
    sand: [['sand_01', 2.6, 1]], cobble: [['rocky_trail_02', 2.7], PAVING], tiles: [PAVING],
    blocks: [SANDSTONE], trim: [SANDSTONE],
    plaster: [['plastered_wall', 3.4, 2], ['beige_wall_001', 3.4, 2]],
    wood: [['weathered_planks', 1.6]], metal: [['rusty_metal_02', 1.5]],
    crate: [['weathered_planks', 1.6, 3]], door: [['weathered_planks', 1.6, 3]],
  };
  T.surfaceScan = function (q, layers) {
    const choices = layers && SCAN_SURFACES[q.m];
    if (!choices) return null;
    const variant = q.m === 'cobble' ? q.o[1] > .01 : q.m === 'plaster' && q.tint[1] < .95;
    const [id, tile, mode = 0] = choices[Number(variant)], layer = layers[id];
    return layer === undefined ? null : { layer, tile, mode };
  };
  const scanLinear = Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  });
  async function scanImage(file) {
    if (typeof document === 'undefined') {
      const response = await fetch('../' + file);
      if (!response.ok) throw Error(file);
      return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = file;
    });
  }
  async function loadScans(size) {
    const ids = Object.keys(SCANS), count = ids.length, stride = size * size * 4;
    const data = { size, count, layers: {}, albedo: new Uint8Array(count * stride), normal: new Uint8Array(count * stride) };
    const ctx = canvas(size).getContext('2d', { willReadFrequently: true });
    function pixels(image) {
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, size, size).data;
    }
    async function load(id, layer) {
      const maps = await Promise.all(['Diffuse', 'nor_gl', 'arm'].map(map =>
        scanImage('assets/textures/' + size + '/' + id + '_' + map + '_1k.jpg').catch(() => null)));
      try {
        if (!maps.every(map => map && map.width === size && map.height === size)) return;
        const [diffuse, normal, arm] = maps.map(pixels), [exposure, saturation] = SCANS[id];
        const a = data.albedo, n = data.normal;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          // Canvas rows start at the top. Array row 0 is v=0, with +Y OpenGL normals.
          const i = ((size - 1 - y) * size + x) * 4, o = layer * stride + (y * size + x) * 4;
          const r = scanLinear[diffuse[i]], g = scanLinear[diffuse[i + 1]], b = scanLinear[diffuse[i + 2]];
          const gray = (r * .2126 + g * .7152 + b * .0722) * (1 - saturation);
          a[o] = 255 * Math.sqrt(sat((gray + r * saturation) * exposure));
          a[o + 1] = 255 * Math.sqrt(sat((gray + g * saturation) * exposure));
          a[o + 2] = 255 * Math.sqrt(sat((gray + b * saturation) * exposure));
          a[o + 3] = arm[i + 1]; // roughness
          n[o] = normal[i]; n[o + 1] = normal[i + 1];
          n[o + 2] = arm[i]; n[o + 3] = arm[i + 2]; // AO and metalness
        }
        data.layers[id] = layer;
      } finally {
        for (const map of maps) if (map && map.close) map.close();
      }
    }
    // Keep only three sets of decoded JPGs in memory at a time.
    for (let i = 0; i < count; i += 3) await Promise.all(ids.slice(i, i + 3).map((id, j) => load(id, i + j)));
    return Object.keys(data.layers).length ? data : null;
  }
  // The worker and the main-thread fallback use the same packing and layer layout.
  T.worldBuilder = function (withNormals, aniso, surfaceSize, scans) {
    const large=surfaceSize || (G.Gfx && G.Gfx.preset.surfaceSize) || S;
    const split=!scans && large>S, small=Math.min(S,large);
    const layers = {};
    const names = scans ? ORDER.filter(name => {
      const choices = SCAN_SURFACES[name];
      return !choices || choices.some(([id, , mode]) => mode === 3 || scans.layers[id] === undefined);
    }) : ORDER;
    names.forEach((name, i) => { layers[name] = i; });
    function bank(size,count) {
      return {size,count,albedo:new Uint8Array(size*size*4*count),
        normal:withNormals ? new Uint8Array(size*size*2*count) : null};
    }
    const data={base:bank(small,split ? names.length-5 : names.length), large:split ? bank(large,5) : null, scans, layers};
    const markBraces = scans && scans.layers.weathered_planks !== undefined;
    let k=0;
    return {total:names.length, data,
      step() {
        const name=names[k], L=gen[name](markBraces), useLarge=split && k<5;
        const dest=useLarge ? data.large : data.base, index=k-(split&&!useLarge ? 5 : 0);
        const grain=useLarge ? new Int8Array(65536) : null;
        if (grain) {
          const rng=rngOf(901+k), pores=vnoise(256,k===0 ? 64 : 90,124+k);
          for(let i=0;i<grain.length;i++) grain[i]=(rng()-.5)*10+(pores[i]-.5)*16;
        }
        const alb=new Uint8Array(S*S*4); pack(L,alb,0,withNormals ? .25 : .7);
        resizeLayer(alb,4,dest.albedo,index*dest.size*dest.size*4,dest.size,grain,false);
        if (withNormals) {
          const norm=new Uint8Array(S*S*2); packNormal(L,norm,0,NSTR[name]*2);
          resizeLayer(norm,2,dest.normal,index*dest.size*dest.size*2,dest.size,grain,true);
        }
        return ++k===names.length;
      },
      result() {return T.worldArrays(data,aniso);}
    };
  };
  T.worldArrays = function (data,aniso) {
    const finish = (bank,key) => {
      if (!bank || !bank[key]) return null;
      const t=new THREE.DataTexture2DArray(bank[key],bank.size,bank.size,bank.count);
      t.format=key==='normal' && bank!==data.scans ? THREE.RGFormat : THREE.RGBAFormat;
      t.wrapS=t.wrapT=THREE.RepeatWrapping;
      t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter;
      t.generateMipmaps=true; t.anisotropy=Math.min(aniso,T.aniso||1); t.needsUpdate=true;
      t.onUpdate=()=>{ t.image.data=null; };
      return t;
    };
    return {albedo:finish(data.base,'albedo'), normal:finish(data.base,'normal'),
      largeAlbedo:finish(data.large,'albedo'), largeNormal:finish(data.large,'normal'),
      scanAlbedo:finish(data.scans,'albedo'), scanNormal:finish(data.scans,'normal'),
      scanLayers:data.scans && data.scans.layers, layers:data.layers,
      barrelMaps: data.scans && barrelMaps(data.scans)};
  };
  // The instanced barrels use the probe-lit material's 2D maps and keep their paint colors.
  function barrelMaps(scans) {
    const layer = scans.layers.rusty_metal_02;
    if (layer === undefined) return null;
    const size = 256, step = scans.size / size, samples = step * step;
    const map = new Uint8Array(size * size * 4), normal = new Uint8Array(map.length), arm = new Uint8Array(map.length);
    const start = layer * scans.size * scans.size * 4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let gray = 0, nx = 0, ny = 0, roughness = 0;
      for (let v = 0; v < step; v++) for (let u = 0; u < step; u++) {
        const i = start + ((y * step + v) * scans.size + x * step + u) * 4;
        gray += scans.albedo[i] * .21 + scans.albedo[i + 1] * .72 + scans.albedo[i + 2] * .07;
        nx += scans.normal[i]; ny += scans.normal[i + 1]; roughness += scans.albedo[i + 3];
      }
      const i = (y * size + x) * 4, a = (nx / samples / 127.5 - 1) * .65, b = (ny / samples / 127.5 - 1) * .65;
      map[i] = map[i + 1] = map[i + 2] = 145 + gray * .43 / samples;
      map[i + 3] = normal[i + 3] = arm[i + 3] = 255;
      normal[i] = (1 + a) * 127.5; normal[i + 1] = (1 + b) * 127.5;
      normal[i + 2] = (1 + Math.sqrt(Math.max(0, 1 - a * a - b * b))) * 127.5;
      arm[i + 1] = roughness / samples;
    }
    return { map: dataTex(map, size), normalMap: dataTex(normal, size), roughnessMap: dataTex(arm, size) };
  }
  T.buildWorldData = async function (p,progress,yieldStep) {
    let scans;
    if (p.normals && !p.deferScans) {
      progress(0,ORDER.length);
      try { scans=await loadScans(Math.min(p.surfaceSize,1024)); }
      catch (e) { /* Use procedural layers if the canvas cannot read the scans. */ }
    }
    const wb=T.worldBuilder(p.normals,p.aniso,p.surfaceSize,scans);
    for(let i=1;i<=wb.total;i++) {
      progress(i,wb.total);
      if (yieldStep) await yieldStep();
      wb.step();
    }
    return wb.data;
  };
  T.buildWorld = async function (p,progress) {
    if (typeof Worker!=='undefined' && typeof OffscreenCanvas!=='undefined' && location.protocol!=='file:') {
      let worker;
      try {
        const data=await new Promise((resolve,reject)=>{
          worker=new Worker('js/surfaces-worker.js');
          worker.onerror=reject;
          worker.onmessage=e=>{if(e.data.error) reject(Error(e.data.error)); else if(e.data.bank) resolve(e.data.bank); else progress(e.data.step,e.data.total);};
          worker.postMessage({surfaceSize:p.surfaceSize,normals:p.normals,deferScans:!!G.deferScans});
        });
        return T.worldArrays(data,p.aniso);
      } catch(e) { /* Restricted workers and missing worker canvas support use the yielding builder. */ }
      finally { if(worker) worker.terminate(); }
    }
    const data=await T.buildWorldData({surfaceSize:p.surfaceSize,normals:p.normals,aniso:p.aniso,deferScans:!!G.deferScans},progress,()=>new Promise(resolve=>setTimeout(resolve,0)));
    return T.worldArrays(data,p.aniso);
  };

  function patchScanMeshes(geo, tex) {
    if (!tex.scanLayers || !G.MapMesh || !G.MapMesh.root) return;
    const buckets = new Map();
    for (const q of geo.quads) {
      const cx = q.o[0] + (q.u[0] + q.v[0]) / 2, cz = q.o[2] + (q.u[2] + q.v[2]) / 2;
      const key = q.decal ? 'decal' : Math.min(3, Math.max(0, Math.floor((cx + 50) / 25))) + ',' + Math.min(3, Math.max(0, Math.floor((cz + 50) / 25)));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(q);
    }
    const townMeshes = G.MapMesh.root.children.filter((c) => c.isMesh && c.geometry.attributes.position);
    for (const [key, list] of buckets) {
      if (key === 'decal') continue;
      const mesh = townMeshes.find((m) => m.geometry.attributes.position.count === list.length * 4);
      if (!mesh) continue;
      const g = mesh.geometry;
      let scan = g.attributes.scan;
      if (!scan) {
        scan = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4);
        g.setAttribute('scan', scan);
      }
      list.forEach((q, k) => {
        const lu = Math.hypot(q.u[0], q.u[1], q.u[2]), lv = Math.hypot(q.v[0], q.v[1], q.v[2]);
        const uh = [q.u[0] / lu, q.u[1] / lu, q.u[2] / lu], vh = [q.v[0] / lv, q.v[1] / lv, q.v[2] / lv];
        let nx = q.u[1] * q.v[2] - q.u[2] * q.v[1], ny = q.u[2] * q.v[0] - q.u[0] * q.v[2], nz = q.u[0] * q.v[1] - q.u[1] * q.v[0];
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const picked = T.surfaceScan(q, tex.scanLayers);
        const phase = picked ? (q.o[0] * nx + q.o[1] * ny + q.o[2] * nz) * .317 + q.tint[1] * 11.7 : 0;
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([s, t], c) => {
          const v = k * 4 + c;
          const x = q.o[0] + q.u[0] * s + q.v[0] * t, y = q.o[1] + q.u[1] * s + q.v[1] * t, z = q.o[2] + q.u[2] * s + q.v[2] * t;
          scan.array[v * 4 + 2] = picked ? picked.layer : -1;
          if (picked) {
            scan.array[v * 4] = (x * uh[0] + y * uh[1] + z * uh[2]) / picked.tile + phase;
            scan.array[v * 4 + 1] = (x * vh[0] + y * vh[1] + z * vh[2]) / picked.tile + phase * .63;
            scan.array[v * 4 + 3] = picked.mode;
          }
        });
      });
      scan.needsUpdate = true;
    }
  }
  function enableScanMaterials(tex, preset) {
    if (!G.MapMesh || !G.MapMesh.materials || !tex.scanAlbedo) return;
    const layers = tex.scanLayers || {};
    for (const m of G.MapMesh.materials) {
      if (!m.uniforms.uScanAlbedo) continue;
      m.defines.SCAN_SURFACES = '';
      m.uniforms.uScanAlbedo.value = tex.scanAlbedo;
      m.uniforms.uScanNormal.value = tex.scanNormal;
      m.uniforms.uGravelLayer.value = layers.gravelly_sand === undefined ? -1 : layers.gravelly_sand;
      m.uniforms.uBrickLayer.value = layers.red_brick_03 === undefined ? -1 : layers.red_brick_03;
      m.needsUpdate = true;
    }
    if (tex.barrelMaps && G.MapMesh.propMat) {
      for (const k of ['map','normalMap','roughnessMap']) {
        if (tex.barrelMaps[k] && G.MapMesh.propMat.uniforms[k]) G.MapMesh.propMat.uniforms[k].value = tex.barrelMaps[k];
      }
    }
  }
  T.upgradePhotoScans = async function (surfaces, preset, geo, onBytes) {
    const size = Math.min(preset.surfaceSize, 1024);
    const track = onBytes || null;
    const scanImageTracked = async (file) => {
      const path = 'assets/textures/' + size + '/' + file;
      const r = await fetch(path);
      if (!r.ok) throw Error(file);
      const buf = await r.arrayBuffer();
      if (track) track(path, buf.byteLength);
      const blob = new Blob([buf]);
      if (typeof document === 'undefined') return createImageBitmap(blob, { colorSpaceConversion: 'none' });
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = URL.createObjectURL(blob);
      });
    };
    try {
      const ids = Object.keys(SCANS);
      const stride = size * size * 4;
      const data = { size, count: ids.length, layers: {}, albedo: new Uint8Array(ids.length * stride), normal: new Uint8Array(ids.length * stride) };
      const ctx = canvas(size).getContext('2d', { willReadFrequently: true });
      function pixels(image) {
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, size, size).data;
      }
      async function load(id, layer) {
        const maps = await Promise.all(['Diffuse', 'nor_gl', 'arm'].map(map =>
          scanImageTracked(id + '_' + map + '_1k.jpg').catch(() => null)));
        if (!maps.every(map => map && map.width === size && map.height === size)) return;
        const [diffuse, normal, arm] = maps.map(pixels), [exposure, saturation] = SCANS[id];
        const a = data.albedo, n = data.normal;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = ((size - 1 - y) * size + x) * 4, o = layer * stride + (y * size + x) * 4;
          const r = scanLinear[diffuse[i]], g = scanLinear[diffuse[i + 1]], b = scanLinear[diffuse[i + 2]];
          const gray = (r * .2126 + g * .7152 + b * .0722) * (1 - saturation);
          a[o] = 255 * Math.sqrt(sat((gray + r * saturation) * exposure));
          a[o + 1] = 255 * Math.sqrt(sat((gray + g * saturation) * exposure));
          a[o + 2] = 255 * Math.sqrt(sat((gray + b * saturation) * exposure));
          a[o + 3] = arm[i + 1];
          n[o] = normal[i]; n[o + 1] = normal[i + 1];
          n[o + 2] = arm[i]; n[o + 3] = arm[i + 2];
        }
        data.layers[id] = layer;
        for (const map of maps) if (map && map.close) map.close();
      }
      for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map((id, j) => load(id, i + j)));
      if (!Object.keys(data.layers).length) return;
      const added = T.worldArrays({ scans: data, layers: surfaces.layers, base: null, large: null }, preset.aniso);
      surfaces.scanAlbedo = added.scanAlbedo;
      surfaces.scanNormal = added.scanNormal;
      surfaces.scanLayers = added.scanLayers;
      surfaces.barrelMaps = added.barrelMaps;
      enableScanMaterials(surfaces, preset);
      patchScanMeshes(geo, surfaces);
    } catch (e) { console.warn('photo scans unavailable', e); }
  };

  // ---------- small detail maps (RGBA, tiled, linear data) ----------
  function dataTex(data, size, opt) {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    t.anisotropy=T.aniso || 1;
    if (opt && opt.srgb) t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }
  // soldiers: R weave, G grunge, B wear, A camouflage pattern
  T.detail = function () {
    if (T.cache.detail) return T.cache.detail;
    const N = 256, weave = new Float32Array(N * N), g = fbm(N, 8, 4, 171), w2 = fbm(N, 4, 3, 172), camo1 = fbm(N, 4, 4, 173), camo2 = fbm(N, 6, 3, 174), sc = fbm(N, 64, 1, 175);
    const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      weave[i] = 0.5 + 0.25 * Math.sin((x + y) * 1.6) * Math.sin((x - y) * 0.8) + 0.1 * Math.sin(x * 3.1);
      const camo = camo1[i] > 0.56 ? 1 : camo2[i] > 0.58 ? 0.5 : 0;
      d[i * 4] = 255 * sat(weave[i]); d[i * 4 + 1] = 255 * sat(g[i] * 0.8 + w2[i] * 0.2);
      d[i * 4 + 2] = 255 * sat((sc[i] - 0.6) * 3); d[i * 4 + 3] = 255 * camo;
    }
    return (T.cache.detail = dataTex(d, N));
  };
  // guns: R micro roughness, G smudges, B scratches, A edge-wear noise
  T.gunDetail = function () {
    if (T.cache.gun) return T.cache.gun;
    const N = 256, m = fbm(N, 64, 2, 181), sm = fbm(N, 6, 4, 182), ww = fbm(N, 16, 3, 184), r = rngOf(185);
    const scr = new Float32Array(N * N);
    for (let k = 0; k < 90; k++) {
      let x = r() * N, y = r() * N; const a = r() * Math.PI, len = 6 + r() * 40, s = 0.3 + r() * 0.7;
      for (let t = 0; t < len; t++) { const px = ((x + Math.cos(a) * t) % N + N) % N | 0, py = ((y + Math.sin(a) * t) % N + N) % N | 0; scr[py * N + px] = Math.max(scr[py * N + px], s); }
    }
    const d = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { d[i * 4] = 255 * m[i]; d[i * 4 + 1] = 255 * sm[i]; d[i * 4 + 2] = 255 * scr[i]; d[i * 4 + 3] = 255 * ww[i]; }
    return (T.cache.gun = dataTex(d, N));
  };
  // large-scale variation for the world (R), streaks (G), sand drift mask (B)
  T.macro = function () {
    if (T.cache.macro) return T.cache.macro;
    const N = 256, a = fbm(N, 4, 5, 191), b = fbm(N, 32, 2, 192), c = fbm(N, 6, 4, 193);
    const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, streak = sat((fbm1d(x) - 0.45) * 2.5);
      d[i * 4] = 255 * a[i]; d[i * 4 + 1] = 255 * streak * (0.6 + 0.4 * b[i]); d[i * 4 + 2] = 255 * c[i]; d[i * 4 + 3] = 255;
    }
    function fbm1d(x) { return a[(x * 7) % N] * 0.6 + b[(x * 3) % N] * 0.4; }
    const t = dataTex(d, N);
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;   // smooth data: plain bilinear is enough and cheaper
    return (T.cache.macro = t);
  };

  // ---------- FX sprites (canvas) ----------
  function cv(w, h) { return canvas(w, h); }
  const fx = {
    puff() {
      const s = 128, c = cv(s), g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      const n = fbm(s, 4, 4, 201), d = g.getImageData(0, 0, s, s), p = d.data;
      for (let i = 0; i < s * s; i++) p[i * 4 + 3] *= 0.35 + n[i] * 1.1;
      g.putImageData(d, 0, 0);
      return c;
    },
    flash() {
      const s = 128, c = cv(s), g = c.getContext('2d'), r = rngOf(202);
      g.translate(64, 64);
      for (let i = 0; i < 9; i++) {
        g.rotate(Math.PI * 2 / 9 + r() * 0.3);
        const gr = g.createLinearGradient(0, 0, 62, 0);
        gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.5, 'rgba(255,190,90,.7)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, -6 - r() * 4); g.lineTo(44 + r() * 18, 0); g.lineTo(0, 6 + r() * 4); g.fill();
      }
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, 'rgba(255,255,245,1)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill();
      return c;
    },
    flashSide() {
      const c = cv(128, 64), g = c.getContext('2d'), r = rngOf(203);
      for (let k = 0; k < 4; k++) {
        const gr = g.createLinearGradient(0, 0, 128, 0);
        gr.addColorStop(0, 'rgba(255,245,215,1)'); gr.addColorStop(0.35, 'rgba(255,190,90,.8)'); gr.addColorStop(1, 'rgba(255,110,30,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 32 - 8); g.quadraticCurveTo(60, 32 - 22 * r(), 110 + r() * 18, 32 + (r() - 0.5) * 10); g.quadraticCurveTo(60, 32 + 22 * r(), 0, 32 + 8); g.fill();
      }
      return c;
    },
    hole() {
      const s = 64, c = cv(s), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
      gr.addColorStop(0, 'rgba(8,6,5,1)'); gr.addColorStop(0.2, 'rgba(20,15,10,.95)'); gr.addColorStop(0.42, 'rgba(60,45,30,.55)'); gr.addColorStop(1, 'rgba(70,52,34,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      return c;
    },
    blood() {
      const s = 128, c = cv(s), g = c.getContext('2d'), r = rngOf(204);
      g.fillStyle = 'rgba(110,8,6,.95)';
      for (let i = 0; i < 26; i++) { const a = r() * 6.28, d = Math.pow(r(), 1.5) * 50, rad = 3 + r() * (16 - d * 0.22); g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, Math.max(1.5, rad), 0, 7); g.fill(); }
      for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 30 + r() * 30; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + r() * 2, 0, 7); g.fill(); }
      return c;
    },
    scorch() {
      const s = 256, c = cv(s), g = c.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(12,9,7,.95)'); gr.addColorStop(0.55, 'rgba(28,20,14,.65)'); gr.addColorStop(1, 'rgba(30,22,15,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      return c;
    },
    blob() {
      const s = 64, c = cv(s), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      return c;
    },
    spark() {
      const c = cv(32, 8), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 32, 0);
      gr.addColorStop(0, 'rgba(255,200,120,0)'); gr.addColorStop(0.7, 'rgba(255,230,170,1)'); gr.addColorStop(1, 'rgba(255,255,230,1)');
      g.fillStyle = gr; g.fillRect(0, 2, 32, 4);
      return c;
    },
  };
  T.tex = function (name) {
    const key = 'fx_' + name;
    if (T.cache[key]) return T.cache[key];
    const t = new THREE.CanvasTexture(fx[name]());
    t.encoding = THREE.sRGBEncoding;
    return (T.cache[key] = t);
  };
  T.init = function (renderer) {
    T.aniso = Math.min(G.Gfx.preset.aniso, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
  };
})(typeof window === 'undefined' ? self.G : window.G);
