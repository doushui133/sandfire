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
  const windows = new Map();
  function windowCell(c, r, sill, head) {
    P(c, r, 'W');
    windows.set(r * W + c, { sill, head, top: 5.5 });
  }

  R(18, 2, 30, 6, 'D');                                // defender spawn (north)
  R(5, 2, 17, 4, ','); R(5, 5, 7, 7, ',');             // back corridor → B
  R(31, 2, 44, 4, ','); R(42, 5, 44, 6, ',');          // back corridor → A
  R(2, 8, 15, 19, 'B');                                // site B: colonnade courtyard
  R(31, 7, 46, 16, 'A');                               // site A: market square
  R(23, 7, 26, 14, ',');                               // upper mid
  P(24, 15, '=');                                      // mid gate
  R(22, 16, 27, 40, ',');                              // mid street
  R(17, 17, 20, 20, 'u'); R(16, 17, 16, 18, '=');     // B dye house, open west doorway
  windowCell(16, 19, 1.04, 2.35); R(19, 21, 22, 22, 'u'); // loom window and offset mid entrance
  R(28, 20, 32, 21, ','); R(31, 17, 32, 19, ',');      // mid → A connector
  R(16, 41, 33, 47, 'T');                              // attacker spawn (south)
  R(34, 42, 45, 46, '.'); R(40, 34, 45, 41, '.');      // east street
  R(39, 26, 46, 33, 'h');                              // covered bazaar hall
  R(40, 17, 45, 25, '.');                              // bazaar → A street
  R(3, 42, 15, 46, '.'); R(3, 26, 8, 41, '.');         // west street
  R(6, 30, 8, 33, '%');                                // west street pinch
  R(3, 20, 5, 25, 'u');                                // tunnel into B
  R(9, 36, 21, 37, ',');                               // lower alley mid ↔ west
  R(22, 38, 27, 41, '%');                              // loading yard divides the lower street
  R(14, 38, 15, 42, ','); R(14, 38, 21, 39, ',');
  R(28, 36, 35, 37, ','); R(34, 38, 35, 42, ',');
  R(26, 31, 27, 34, '%'); R(22, 24, 23, 27, '%');    // stagger the mid street frontage
  R(26, 18, 27, 19, '#'); R(20, 30, 21, 32, ',');    // recessed stall court
  R(36, 27, 38, 28, 'h'); R(36, 22, 37, 26, ',');    // bazaar side passage
  R(34, 21, 37, 22, ','); R(34, 17, 35, 20, ',');
  // A's south arcade branches off the bazaar street, between its two old approaches.
  R(37, 17, 38, 19, '='); R(37, 20, 39, 21, ',');
  // B's second tunnel bends around the stone pier before reaching the colonnade.
  R(7, 20, 8, 23, 'u'); R(6, 22, 8, 23, 'u');

  // West market house, with a bend into the recessed mid stall court.
  R(10, 25, 14, 29, 'h'); P(9, 28, 'h');
  P(12, 26, 'K'); P(10, 29, 'k');                    // crates under the hall roof
  R(15, 28, 21, 28, ','); P(15, 28, 'h'); P(21, 29, ',');
  windowCell(22, 28, 1.04, 2.35);

  // Well court, with separate doors to mid and the bazaar.
  R(30, 28, 34, 32, ','); R(35, 29, 35, 32, ',');
  R(28, 30, 29, 30, ','); R(36, 31, 38, 31, 'h');
  R(32, 30, 33, 31, 'o'); P(34, 28, 'C'); P(35, 32, 'c');
  // Offset crosscut from exposed mid to the bazaar side passage and north of the well.
  R(28, 25, 32, 26, ','); R(31, 26, 35, 27, ',');

  // Defender overlook. The slit is shorter than a fully crouched player.
  R(17, 9, 20, 11, 'u'); R(21, 10, 22, 10, 'u');
  windowCell(16, 10, 1.24, 2.10);

  // Loading dock, with one door in each end wall.
  R(25, 39, 30, 40, 'h'); P(26, 38, 'h');
  P(28, 41, 'h'); R(29, 41, 30, 41, '%');

  // site B dressing
  R(12, 8, 15, 11, '^'); R(12, 12, 15, 12, 's');
  P(6, 11, '+'); P(9, 11, '+'); P(6, 15, '+'); P(9, 15, '+');
  P(3, 9, 'c'); P(3, 10, 'C'); P(13, 16, 'C'); P(14, 16, 'c'); P(10, 18, 'c'); R(7, 13, 8, 13, 'w');
  P(8, 17, 'w'); P(6, 19, 'C');
  // site A dressing
  R(36, 9, 41, 12, '^'); R(37, 13, 40, 13, 's'); R(35, 10, 35, 11, 's');
  R(37, 10, 40, 10, 't'); R(37, 8, 40, 9, 'L');      // dyers' drying terrace
  P(41, 8, 't'); P(42, 8, '^'); P(43, 8, 's');        // side stairs from the north arcade
  P(32, 8, 'C'); P(33, 8, 'c'); P(45, 8, 'c'); P(45, 9, 'C'); P(44, 14, 'c'); R(34, 14, 35, 14, 'w'); P(46, 16, 'p');
  P(41, 15, 'C'); P(37, 15, 's');
  const raisedCrate = { c: 37, r: 15 };
  // spawns, mid, streets
  P(19, 3, 'c'); P(29, 3, 'C'); P(13, 2, 'b'); P(36, 2, 'c');
  P(26, 12, 'c'); P(23, 19, 'C'); P(27, 23, 'c'); P(25, 26, 'w'); R(23, 29, 24, 29, 'w');
  P(21, 31, 'c'); P(25, 35, 'w'); P(11, 17, 'C'); P(36, 15, 'C');
  P(17, 42, 'C'); P(32, 46, 'c'); P(20, 46, 'b'); P(29, 42, 'b'); P(16, 47, 'p'); P(33, 41, 'p');
  P(3, 27, 'b'); P(45, 36, 'b'); P(8, 40, 'b'); P(8, 27, 'c'); P(4, 38, 'C'); P(3, 46, 'p'); P(45, 46, 'p');
  P(44, 22, 'c'); P(41, 23, 'C'); R(40, 17, 42, 17, 'H');
  P(41, 28, '+'); P(44, 28, '+'); P(41, 31, '+'); P(44, 31, '+');
  P(13, 37, 'c'); P(19, 36, 'b');
  // Stagger cover so each street keeps a two-cell lane.
  P(6, 26, 'C'); P(5, 32, 'C'); P(7, 41, 'w');
  P(43, 18, 'C'); P(42, 25, 'b'); P(43, 38, 'C');
  P(10, 4, 'C'); P(16, 2, 'b'); P(39, 4, 'C'); P(42, 2, 'w');
  // lower inner blocks use the plaster style
  RIF(9, 20, 21, 35, '#', '%'); RIF(28, 22, 38, 40, '#', '%'); RIF(16, 7, 22, 16, '#', '%');
  M.grid = g;

  const FLOOR = { '.': 'sand', ',': 'paved', A: 'tiles', B: 'tiles', T: 'sand', D: 'paved', '=': 'paved', u: 'paved', h: 'tiles', s: 'step', '^': 'plat', t: 'stair', L: 'terrace' };
  const FH = { s: 0.4, '^': 0.8, t: 1.2, L: 1.6 };
  M.FLOOR = FLOOR;
  M.inside = (c, r) => c >= 0 && r >= 0 && c < W && r < H;
  M.ch = (c, r) => (M.inside(c, r) ? g[r][c] : '#');
  M.windowAt = (c, r) => M.ch(c, r) === 'W' ? windows.get(r * W + c) : undefined;
  const hasRaisedCrate = (c, r) => c === raisedCrate.c && r === raisedCrate.r;
  M.walkable = (c, r) => FLOOR[M.ch(c, r)] !== undefined && !hasRaisedCrate(c, r);
  M.floorH = (c, r) => FH[M.ch(c, r)] || 0;
  // what a foot lands on: the town's sand (open ground at floor level) or stone (paving, tiles, steps, crates)
  M.surfaceAt = (x, y, z) => {
    const c = M.colOf(x), r = M.rowOf(z);
    return FLOOR[M.ch(c, r)] === 'sand' && y <= M.floorH(c, r) + 0.2 ? 'sand' : 'stone';
  };
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
    atk: cp([[23, 46], [24, 45], [25, 46], [26, 45], [27, 46]]),
    def: cp([[22, 3], [23, 4], [24, 3], [25, 4], [26, 3]]),
  };
  const hold = (site, c, r, lc, lr) => ({ site, pos: M.cellPos(c, r), yaw: G.yawTo(M.cellX(lc) - M.cellX(c), M.cellZ(lr) - M.cellZ(r)) });
  M.holds = [
    hold('A', 39, 8, 44, 18), hold('A', 35, 9, 34, 17), hold('A', 45, 13, 44, 19), hold('A', 39, 12, 37, 18),
    hold('B', 10, 8, 4, 20), hold('B', 13, 14, 16, 17), hold('B', 8, 16, 8, 21), hold('B', 13, 9, 16, 18),
    hold('M', 24, 12, 25, 24), hold('M', 17, 10, 13, 10),
  ];
  M.routes = {
    A: [cp([[42, 44], [42, 30], [43, 21]]), cp([[42, 33], [38, 27], [38, 21], [38, 18]]), cp([[28, 41], [26, 38], [27, 26], [32, 26], [36, 27], [37, 22], [34, 18]])],
    B: [cp([[6, 44], [5, 35], [4, 27], [4, 22]]), cp([[14, 39], [24, 35], [24, 24], [19, 21], [18, 17]]), cp([[25, 36], [21, 29], [16, 28], [9, 28], [4, 23], [7, 22], [8, 20]])],
  };

  // ---------- colliders ----------
  function addBox(x0, y0, z0, x1, y1, z1, kind, extra) {
    const b = { x0, y0, z0, x1, y1, z1, kind };
    if (extra) Object.assign(b, extra);
    M.boxes.push(b);
    return b;
  }
  M.addBox = addBox;
  const SOLID = { '#': 1, '%': 1, H: 1, w: 1, o: 1, '^': 1, s: 1, t: 1, L: 1, '=': 1, u: 1, h: 1, k: 1, K: 1 };
  function key(c, r) {
    const ch = g[r][c];
    if (!SOLID[ch]) return null;
    if (ch === '#' || ch === '%' || ch === 'H') return ch + M.tallH(c, r);
    return ch === 'k' || ch === 'K' ? 'h' : ch;
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
      const ch = k[0], x0 = OX + c * CELL, z0 = OZ + r * CELL, x1 = x0 + w * CELL, z1 = z0 + h * CELL;
      if (ch === '#' || ch === '%' || ch === 'H') addBox(x0, 0, z0, x1, M.tallH(c, r), z1, ch === '#' ? 'wallA' : ch === '%' ? 'wallB' : 'wallC', { building: true });
      else if (ch === 'w') addBox(x0 + 0.25, 0, z0 + 0.25, x1 - 0.25, 1.0, z1 - 0.25, 'lowwall');
      else if (ch === 'o') {
        const left = x0 + .25, right = x1 - .25, north = z0 + .25, south = z1 - .25, rim = .4;
        addBox(left, 0, north, right, 1, north + rim, 'wellWall');
        addBox(left, 0, south - rim, right, 1, south, 'wellWall');
        addBox(left, 0, north + rim, left + rim, 1, south - rim, 'wellWall');
        addBox(right - rim, 0, north + rim, right, 1, south - rim, 'wellWall');
      }
      else if (FH[ch]) addBox(x0, 0, z0, x1, FH[ch], z1, ch === 's' ? 'step' : 'plat');
      else if (ch === '=') addBox(x0, 3.4, z0, x1, 7.2, z1, 'roof');
      else if (ch === 'u') addBox(x0, 3.0, z0, x1, 5.5, z1, 'roof');
      else if (ch === 'h') addBox(x0, 4.4, z0, x1, 7.0, z1, 'roof');
    }
  })();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = g[r][c], x0 = OX + c * CELL, z0 = OZ + r * CELL;
    if ('cCkK'.includes(ch) || hasRaisedCrate(c, r)) {
      const y = M.floorH(c, r);
      addBox(x0 + 0.15, y, z0 + 0.15, x0 + 1.85, y + 1.05, z0 + 1.85, 'crate');
      if (ch === 'C' || ch === 'K') addBox(x0 + 0.4, 1.05, z0 + 0.3, x0 + 1.7, 2.05, z0 + 1.6, 'crate');
    } else if (ch === 'W') {
      const { sill, head, top } = M.windowAt(c, r);
      addBox(x0, 0, z0, x0 + CELL, sill, z0 + CELL, 'windowSill');
      addBox(x0, head, z0, x0 + CELL, top, z0 + CELL, 'windowHead');
    }
    else if (ch === 'b') addBox(x0 + 0.55, 0, z0 + 0.55, x0 + 1.45, 1.15, z0 + 1.45, 'barrel');
    else if (ch === '+') { const top = M.ch(c + 1, r) === 'h' || M.ch(c - 1, r) === 'h' ? 4.4 : 4.6; addBox(x0 + 0.5, 0, z0 + 0.5, x0 + 1.5, top, z0 + 1.5, 'pillar'); }
    else if (ch === 'p') addBox(x0 + 0.78, 0, z0 + 0.78, x0 + 1.22, 6, z0 + 1.22, 'palm');
  }

  // Small fixtures are bolted above door height. Collision and rendering use these same bounds.
  // The feet of the stalls occupy existing blocked crate cells along the edge of the market.
  M.lamps = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (!'#%'.includes(M.ch(c,r)) || (c * 13 + r * 17) % 11) continue;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (!M.walkable(c+dx,r+dz) || M.floorH(c+dx,r+dz)) continue;
      const x = M.cellX(c) + dx*1.15, z = M.cellZ(r) + dz*1.15;
      M.lamps.push(addBox(x-.12,2.78,z-.12,x+.12,3.18,z+.12,'lamp'));
      break;
    }
  }
  for (const [c,r] of [[45,8],[33,8],[21,31]]) {
    const x=M.cellX(c), z=M.cellZ(r);
    for (const s of [-1,1]) addBox(x+s*.72-.035,1.05,z-.75,x+s*.72+.035,2.43,z-.68,'stallPost');
    addBox(x-.84,2.43,z-.84,x+.84,2.53,z+.84,'stallCanopy');
  }

  // Stone reveals and a leaf swung south from its western hinge.
  const gateX = M.cellX(24), gateZ = M.cellZ(15);
  for (const side of [-1, 1]) {
    const edge = gateX + side * .96;
    addBox(edge - .06, 0, gateZ - 1.07, edge + .06, 2.62, gateZ + 1.07, 'gateStone');
  }
  addBox(gateX - 1.18, 2.62, gateZ - 1.07, gateX + 1.18, 3.4, gateZ + 1.07, 'gateStone');
  for (let i = 0; i < 6; i++) {
    const x = gateX - .90 + i * .08, z = gateZ + .75 + i * .175;
    addBox(x, .025, z, x + .14, 2.53, z + .177, 'gateBoard');
  }
  const terraceX = M.cellX(37) - 1, terraceZ = M.cellZ(8) - 1;
  for (const [x0, z0, x1, z1] of [
    [terraceX, terraceZ, terraceX + 8, terraceZ + .13],
    [terraceX, terraceZ + .13, terraceX + .13, terraceZ + 4],
    [terraceX + 7.87, terraceZ + 2, terraceX + 8, terraceZ + 4],
  ]) addBox(x0, 1.6, z0, x1, 2.49, z1, 'terraceRail');

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
    let t0 = -Infinity, t1 = tmax, n = 0, sgn = 0;
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
    if (t0 <= 0 && !(ox > b.x0 && ox < b.x1 && oy > b.y0 && oy < b.y1 && oz > b.z0 && oz < b.z1)) return -1;
    hit.nx = n === 0 ? sgn : 0; hit.ny = n === 1 ? sgn : 0; hit.nz = n === 2 ? sgn : 0;
    return Math.max(0, t0);
  }
  // A ray that starts inside a solid box hits it at t = 0; `skip` is a box the ray has already passed into
  // (a bullet continuing through the crate it pierced).
  M.raycast = function (ox, oy, oz, dx, dy, dz, maxDist, skip) {
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
          const b = M.boxes[i];
          if (b === skip) continue;
          const t = rayBox(b, ox, oy, oz, dx, dy, dz, best);
          if (t >= 0 && t < best) { best = t; bn = [hit.nx, hit.ny, hit.nz]; bb = b; }
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
  const CLEARANCE = .32;
  function clearAt(x, z, h) {
    for (const b of M.query(x - CLEARANCE, z - CLEARANCE, x + CLEARANCE, z + CLEARANCE)) {
      if (b.y0 >= h + 1.7 || b.y1 <= h + .45) continue;
      if (x + CLEARANCE > b.x0 && x - CLEARANCE < b.x1 && z + CLEARANCE > b.z0 && z - CLEARANCE < b.z1) return false;
    }
    return true;
  }
  function startCell(pos) {
    const c = M.colOf(pos.x), r = M.rowOf(pos.z);
    if (M.walkable(c, r)) return [c, r];
    // A bot can stand in the open margin of a prop cell. Rejoin from that side.
    let best = null, distance = Infinity;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (!M.walkable(nc, nr) || Math.abs(M.floorH(nc, nr) - pos.y) > .45) continue;
      const dx = M.cellX(nc) - pos.x, dz = M.cellZ(nr) - pos.z, d = Math.hypot(dx, dz);
      if (d >= distance) continue;
      const samples = Math.ceil(d / .22);
      let i = 1;
      for (; i <= samples; i++) if (!clearAt(pos.x + dx * i / samples, pos.z + dz * i / samples, pos.y)) break;
      if (i > samples) { best = [nc, nr]; distance = d; }
    }
    return best || M.nearestWalkable(c, r);
  }
  M.findPath = function (from, to) {
    const [sc, sr] = startCell(from);
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
    if (ec === M.colOf(to.x) && er === M.rowOf(to.z)) pts[pts.length - 1].set(to.x, M.floorH(ec, er), to.z);
    if (pts.length === 1) return [from.clone(), pts[0]];
    const path = smooth(pts);
    if (!walkLine(from, path[1])) path.unshift(from.clone());
    return path;
  };
  function walkLine(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const px = -dz / len * 0.45, pz = dx / len * 0.45, n = Math.ceil(len / 0.4);
    let prevH = M.floorH(M.colOf(a.x), M.rowOf(a.z));
    for (let i = 1; i <= n; i++) {
      const x = a.x + dx * i / n, z = a.z + dz * i / n, c = M.colOf(x), r = M.rowOf(z);
      if (!M.walkable(c, r) || !M.walkable(M.colOf(x + px), M.rowOf(z + pz)) || !M.walkable(M.colOf(x - px), M.rowOf(z - pz))) return false;
      const h = M.floorH(c, r);
      if (Math.abs(h - prevH) > 0.45) return false;
      prevH = h;
      if (!clearAt(x, z, h)) return false;
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
    const col = { sand: '#7c6a4c', paved: '#6f6250', tiles: '#7a6a52', step: '#8a7a5c', plat: '#93825f', stair: '#ab976d', terrace: '#c4ae82' };
    for (let r = 0; r < H; r++) for (let cc = 0; cc < W; cc++) {
      const ch = g[r][cc], f = FLOOR[ch];
      if (hasRaisedCrate(cc, r)) x.fillStyle = '#4b3f2e';
      else if (f) x.fillStyle = col[f];
      else if ('cCkKbow+pW'.includes(ch)) x.fillStyle = '#4b3f2e';
      else continue;
      x.fillRect(cc * px, r * px, px, px);
      if (ch === 'W') {
        x.fillStyle = '#afa184';
        x.fillRect(cc * px + 2, r * px, 1, px);
      }
    }
    x.fillStyle = '#4b3f2e';
    for (const b of M.boxes) if (b.kind === 'gateBoard' || b.kind === 'terraceRail') {
      x.fillRect((b.x0 - OX) / CELL * px, (b.z0 - OZ) / CELL * px,
        Math.max(1, (b.x1 - b.x0) / CELL * px), Math.max(1, (b.z1 - b.z0) / CELL * px));
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
