// ragdoll.js — death physics: a particle-and-stick body (Verlet integration with distance
// constraints, joint limits and a knee hinge) that collides with the town's boxes and floors,
// then sleeps once it has settled. Soldiers' bones follow the particles.
(function (G) {
  'use strict';
  const THREE = G.THREE, M = G.Map;
  const RD = G.Ragdoll = {};
  // particles
  const PEL = 0, CHE = 1, NEC = 2, HEA = 3, SHL = 4, ELL = 5, HAL = 6, SHR = 7, ELR = 8, HAR = 9, HIL = 10, KNL = 11, FOL = 12, HIR = 13, KNR = 14, FOR = 15;
  const TOL = 16, HLL = 17, TOR = 18, HLR = 19;
  RD.P = { PEL, CHE, NEC, HEA, SHL, ELL, HAL, SHR, ELR, HAR, HIL, KNL, FOL, HIR, KNR, FOR, TOL, HLL, TOR, HLR };
  const RADIUS = [.14, .135, .07, .116, .077, .058, .071, .077, .058, .071,
    .085, .07, .062, .085, .07, .062, .046, .046, .046, .046];
  const INVM = [.5, .45, .75, .75, .8, 1, 1, .8, 1, 1, .72, 1, .86, .72, 1, .86, 1, 1, 1, 1];
  const STICKS = [
    [PEL, CHE, 1], [CHE, NEC, 1], [NEC, HEA, 1], [NEC, SHL, 1], [NEC, SHR, 1], [SHL, SHR, 1],
    [SHL, ELL, 1], [ELL, HAL, 1], [SHR, ELR, 1], [ELR, HAR, 1],
    [PEL, HIL, 1], [PEL, HIR, 1], [HIL, HIR, 1], [HIL, KNL, 1], [KNL, FOL, 1], [HIR, KNR, 1], [KNR, FOR, 1],
    // keep the torso a rigid-ish block
    [CHE, SHL, 1], [CHE, SHR, 1], [CHE, HIL, 0.9], [CHE, HIR, 0.9], [PEL, SHL, 0.9], [PEL, SHR, 0.9],
    [SHL, HIL, 0.8], [SHR, HIR, 0.8], [SHL, HIR, 0.6], [SHR, HIL, 0.6], [PEL, NEC, 0.9],
    [CHE, HEA, .48], [SHL, HEA, .32], [SHR, HEA, .32],
    [FOL, TOL, 1], [FOL, HLL, 1], [TOL, HLL, 1], [KNL, HLL, .94],
    [FOR, TOR, 1], [FOR, HLR, 1], [TOR, HLR, 1], [KNR, HLR, .94],
  ];
  const LIMITS = [[HIL, FOL, .29], [HIR, FOR, .29], [SHL, HAL, .14], [SHR, HAR, .14],
    [HEA, CHE, .22], [KNL, KNR, .09], [FOL, FOR, .085]];
  const GRAV = -12.5, STEP = 1 / 90, ITERS = 8, WALL_ITERS = 5;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), fwd = new THREE.Vector3();
  function restLengths(p, constraints, minimum) {
    const n = p.length / 3;
    return constraints.filter(([a, b]) => a < n && b < n).map(([a, b, value]) => {
      const len = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      return minimum ? [a, b, Math.min(len, value), 1] : [a, b, len, value];
    });
  }

  RD.create = function (points, vel, hit) {
    const n = points.length, p = new Float64Array(n * 3), q = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      p[o] = points[i].x; p[o + 1] = points[i].y; p[o + 2] = points[i].z;
      q[o] = p[o] - vel.x * STEP; q[o + 1] = p[o + 1] - vel.y * STEP; q[o + 2] = p[o + 2] - vel.z * STEP;
    }
    const rd = {
      p, q, prev: p.slice(), normal: new Float64Array(n * 3), acc: 0, alpha: 1, t: 0, still: 0, asleep: false,
      sticks: restLengths(p, STICKS, false), limits: restLengths(p, LIMITS, true),
    };
    if (hit) RD.push(rd, hit.index, hit.v, hit.spread);
    return rd;
  };
  function addVelocity(rd, i, v, k) {
    const o = i * 3, s = STEP * k;
    rd.q[o] -= v.x * s; rd.q[o + 1] -= v.y * s; rd.q[o + 2] -= v.z * s;
  }
  RD.push = function (rd, index, v, spread) {
    addVelocity(rd, index, v, 1);
    if (spread) {
      for (let i = 0; i < rd.sticks.length; i++) {
        const stick = rd.sticks[i], a = stick[0], b = stick[1];
        if (a === index) addVelocity(rd, b, v, spread * stick[3]);
        else if (b === index) addVelocity(rd, a, v, spread * stick[3]);
      }
    }
    rd.asleep = false; rd.still = 0;
  };

  function collide(rd, i, boxes) {
    const p = rd.p, o = i * 3, r = RADIUS[i], normal = rd.normal;
    let x = p[o], y = p[o + 1], z = p[o + 2], wall = false;
    if (y < r) { y = r; normal[o] = 0; normal[o + 1] = 1; normal[o + 2] = 0; }
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (x + r < b.x0 || x - r > b.x1 || y + r < b.y0 || y - r > b.y1 || z + r < b.z0 || z - r > b.z1) continue;
      const dx = x - G.clamp(x, b.x0, b.x1), dy = y - G.clamp(y, b.y0, b.y1), dz = z - G.clamp(z, b.z0, b.z1);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), s = r - d;
        normal[o] = dx / d; normal[o + 1] = dy / d; normal[o + 2] = dz / d;
        x += normal[o] * s; y += normal[o + 1] * s; z += normal[o + 2] * s;
        if (Math.abs(normal[o + 1]) < .6 && s > .005) wall = true;
      } else {
        // Prefer the entry face for a fast impact, or the nearest face when starting inside.
        let depth = x - b.x0, face = 0;
        if (b.x1 - x < depth) { depth = b.x1 - x; face = 1; }
        if (y - b.y0 < depth) { depth = y - b.y0; face = 2; }
        if (b.y1 - y < depth) { depth = b.y1 - y; face = 3; }
        if (z - b.z0 < depth) { depth = z - b.z0; face = 4; }
        if (b.z1 - z < depth) face = 5;
        const old = rd.prev;
        if (old[o + 1] >= b.y1) face = 3;
        else if (old[o] <= b.x0) face = 0;
        else if (old[o] >= b.x1) face = 1;
        else if (old[o + 2] <= b.z0) face = 4;
        else if (old[o + 2] >= b.z1) face = 5;
        else if (old[o + 1] <= b.y0 && b.y0 >= r * 2) face = 2;
        normal[o] = normal[o + 1] = normal[o + 2] = 0;
        normal[o + (face >> 1)] = (face & 1) ? 1 : -1;
        if (face < 2 || face > 3) wall = true;
        if (face === 0) x = b.x0 - r;
        else if (face === 1) x = b.x1 + r;
        else if (face === 2) y = b.y0 - r;
        else if (face === 3) y = b.y1 + r;
        else if (face === 4) z = b.z0 - r;
        else z = b.z1 + r;
      }
    }
    p[o] = x; p[o + 1] = Math.max(r, y); p[o + 2] = z;
    return wall;
  }

  function stepOnce(rd) {
    const p = rd.p, q = rd.q, prev = rd.prev, normal = rd.normal;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    prev.set(p);
    normal.fill(0);
    for (let o = 0; o < p.length; o += 3) {
      const vx = (p[o] - q[o]) * .989, vy = (p[o + 1] - q[o + 1]) * .989, vz = (p[o + 2] - q[o + 2]) * .989;
      p[o] += vx; p[o + 1] += vy + GRAV * STEP * STEP; p[o + 2] += vz;
      x0 = Math.min(x0, p[o], prev[o]); x1 = Math.max(x1, p[o], prev[o]);
      z0 = Math.min(z0, p[o + 2], prev[o + 2]); z1 = Math.max(z1, p[o + 2], prev[o + 2]);
    }
    const boxes = M.query(x0 - .35, z0 - .35, x1 + .35, z1 + .35);
    let iterations = ITERS;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < rd.sticks.length; i++) {
        const s = rd.sticks[i]; solve(p, s[0], s[1], s[2], s[3], false);
      }
      for (let i = 0; i < rd.limits.length; i++) {
        const s = rd.limits[i]; solve(p, s[0], s[1], s[2], s[3], true);
      }
      hinge(p, HIL, KNL, FOL); hinge(p, HIR, KNR, FOR);
      for (let i = 0; i < p.length / 3; i++) {
        if (collide(rd, i, boxes)) iterations = ITERS + WALL_ITERS;
      }
    }
    let maxMove = 0, supported = 0;
    for (let o = 0; o < p.length; o += 3) {
      const vx = p[o] - prev[o], vy = p[o + 1] - prev[o + 1], vz = p[o + 2] - prev[o + 2];
      const nx = normal[o], ny = normal[o + 1], nz = normal[o + 2];
      const dot = vx * nx + vy * ny + vz * nz;
      const friction = ny > .45 ? .68 : nx || ny || nz ? .82 : .99;
      supported += ny > .45 ? 1 : 0;
      const correction = dot * friction - Math.max(0, dot) * .5;
      q[o] = p[o] - vx * friction + correction * nx;
      q[o + 1] = p[o + 1] - vy * friction + correction * ny;
      q[o + 2] = p[o + 2] - vz * friction + correction * nz;
      maxMove = Math.max(maxMove, vx * vx + vy * vy + vz * vz);
    }
    return supported >= 2 && maxMove < .0016 * .0016;
  }
  function solve(p, a, b, len, k, minOnly) {
    const ax = a * 3, bx = b * 3;
    const dx = p[bx] - p[ax], dy = p[bx + 1] - p[ax + 1], dz = p[bx + 2] - p[ax + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (minOnly && d >= len) return;
    const wa = INVM[a], wb = INVM[b], s = (d - len) / d * k / (wa + wb);
    p[ax] += dx * s * wa; p[ax + 1] += dy * s * wa; p[ax + 2] += dz * s * wa;
    p[bx] -= dx * s * wb; p[bx + 1] -= dy * s * wb; p[bx + 2] -= dz * s * wb;
  }
  // knees only bend forwards: push a knee that has gone behind the hip-foot line back in front
  function hinge(p, hip, knee, foot) {
    tmp.set(p[HIR * 3] - p[HIL * 3], p[HIR * 3 + 1] - p[HIL * 3 + 1], p[HIR * 3 + 2] - p[HIL * 3 + 2]);
    tmp2.set(p[CHE * 3] - p[PEL * 3], p[CHE * 3 + 1] - p[PEL * 3 + 1], p[CHE * 3 + 2] - p[PEL * 3 + 2]);
    fwd.crossVectors(tmp2, tmp).normalize();
    const mx = (p[hip * 3] + p[foot * 3]) / 2, my = (p[hip * 3 + 1] + p[foot * 3 + 1]) / 2, mz = (p[hip * 3 + 2] + p[foot * 3 + 2]) / 2;
    const off = (p[knee * 3] - mx) * fwd.x + (p[knee * 3 + 1] - my) * fwd.y + (p[knee * 3 + 2] - mz) * fwd.z;
    if (off < -.018) {
      const push = (-.018 - off) * .4;
      p[knee * 3] += fwd.x * push; p[knee * 3 + 1] += fwd.y * push; p[knee * 3 + 2] += fwd.z * push;
    }
  }

  // Advance fixed physics steps and interpolate the pose at render time.
  RD.update = function (rd, dt) {
    if (rd.asleep) return false;
    rd.acc += Math.min(dt, .1);
    while (rd.acc >= STEP) {
      rd.acc -= STEP;
      rd.t += STEP;
      rd.still = stepOnce(rd) && rd.t > .55 ? rd.still + 1 : 0;
      if (rd.still >= 27) { rd.asleep = true; rd.q.set(rd.p); break; }
    }
    rd.alpha = rd.asleep ? 1 : rd.acc / STEP;
    return true;
  };
  RD.point = function (rd, i, out) {
    const o = i * 3, a = rd.prev, b = rd.p, t = rd.alpha;
    return out.set(G.lerp(a[o], b[o], t), G.lerp(a[o + 1], b[o + 1], t), G.lerp(a[o + 2], b[o + 2], t));
  };
})(window.G);
