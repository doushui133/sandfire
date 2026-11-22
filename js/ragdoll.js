// ragdoll.js — death physics: a particle-and-stick body (Verlet integration with distance
// constraints, joint limits and a knee hinge) that collides with the town's boxes and floors,
// then sleeps once it has settled. Soldiers' bones follow the particles.
(function (G) {
  'use strict';
  const THREE = G.THREE, M = G.Map;
  const RD = G.Ragdoll = {};
  // particles
  const PEL = 0, CHE = 1, NEC = 2, HEA = 3, SHL = 4, ELL = 5, HAL = 6, SHR = 7, ELR = 8, HAR = 9, HIL = 10, KNL = 11, FOL = 12, HIR = 13, KNR = 14, FOR = 15;
  RD.P = { PEL, CHE, NEC, HEA, SHL, ELL, HAL, SHR, ELR, HAR, HIL, KNL, FOL, HIR, KNR, FOR };
  const RADIUS = [0.13, 0.13, 0.07, 0.11, 0.07, 0.05, 0.045, 0.07, 0.05, 0.045, 0.08, 0.06, 0.06, 0.08, 0.06, 0.06];
  const INVM = [0.5, 0.5, 0.8, 0.8, 0.8, 1, 1, 0.8, 1, 1, 0.7, 1, 1, 0.7, 1, 1];
  const STICKS = [
    [PEL, CHE, 1], [CHE, NEC, 1], [NEC, HEA, 1], [NEC, SHL, 1], [NEC, SHR, 1], [SHL, SHR, 1],
    [SHL, ELL, 1], [ELL, HAL, 1], [SHR, ELR, 1], [ELR, HAR, 1],
    [PEL, HIL, 1], [PEL, HIR, 1], [HIL, HIR, 1], [HIL, KNL, 1], [KNL, FOL, 1], [HIR, KNR, 1], [KNR, FOR, 1],
    // keep the torso a rigid-ish block
    [CHE, SHL, 1], [CHE, SHR, 1], [CHE, HIL, 0.9], [CHE, HIR, 0.9], [PEL, SHL, 0.9], [PEL, SHR, 0.9],
    [SHL, HIL, 0.8], [SHR, HIR, 0.8], [SHL, HIR, 0.6], [SHR, HIL, 0.6], [PEL, NEC, 0.9],
    [CHE, HEA, 0.35], [SHL, HEA, 0.25], [SHR, HEA, 0.25],
  ];
  // [a, b, minimum distance]: joints cannot fold flat
  const LIMITS = [[HIL, FOL, 0.3], [HIR, FOR, 0.3], [SHL, HAL, 0.17], [SHR, HAR, 0.17], [HEA, PEL, 0.46], [HEA, CHE, 0.27], [KNL, KNR, 0.1], [FOL, FOR, 0.1]];
  const GRAV = -11.5, STEP = 1 / 60, ITERS = 7;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), fwd = new THREE.Vector3();

  RD.create = function (points, vel, hit) {
    const n = points.length, p = new Float32Array(n * 3), q = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = points[i].x; p[i * 3 + 1] = points[i].y; p[i * 3 + 2] = points[i].z;
      q[i * 3] = p[i * 3] - vel.x * STEP; q[i * 3 + 1] = p[i * 3 + 1] - vel.y * STEP; q[i * 3 + 2] = p[i * 3 + 2] - vel.z * STEP;
    }
    const sticks = STICKS.map(([a, b, k]) => [a, b, Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]), k]);
    const rd = { p, q, sticks, acc: 0, t: 0, still: 0, asleep: false, contact: new Uint8Array(n) };
    if (hit) RD.push(rd, hit.index, hit.v, hit.spread);
    return rd;
  };
  // add a velocity to one particle (and less to its neighbours)
  RD.push = function (rd, index, v, spread) {
    const add = (i, k) => { rd.q[i * 3] -= v.x * STEP * k; rd.q[i * 3 + 1] -= v.y * STEP * k; rd.q[i * 3 + 2] -= v.z * STEP * k; };
    add(index, 1);
    for (const [a, b] of STICKS) { if (a === index) add(b, spread); else if (b === index) add(a, spread); }
  };

  function collide(rd, i) {
    const p = rd.p, r = RADIUS[i];
    let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], hitGround = false;
    if (y < r) { y = r; hitGround = true; }
    const list = M.query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cy = Math.max(b.y0, Math.min(y, b.y1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      const dx = x - cx, dy = y - cy, dz = z - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), s = (r - d) / d;
        x += dx * s; y += dy * s; z += dz * s;
        if (dy > 0.7 * d) hitGround = true;
      } else {
        // centre inside the box: leave by the shallowest side
        const pen = [x - b.x0 + r, b.x1 - x + r, y - b.y0 + r, b.y1 - y + r, z - b.z0 + r, b.z1 - z + r];
        let m = 0; for (let j = 1; j < 6; j++) if (pen[j] < pen[m]) m = j;
        if (m === 0) x = b.x0 - r; else if (m === 1) x = b.x1 + r; else if (m === 2) y = b.y0 - r; else if (m === 3) { y = b.y1 + r; hitGround = true; } else if (m === 4) z = b.z0 - r; else z = b.z1 + r;
      }
    }
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    rd.contact[i] = hitGround ? 1 : 0;
  }

  function stepOnce(rd) {
    const p = rd.p, q = rd.q, n = p.length / 3;
    let maxMove = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const damp = rd.contact[i] ? 0.82 : 0.995;   // friction while touching something
      const vx = (p[o] - q[o]) * damp, vy = (p[o + 1] - q[o + 1]) * 0.995, vz = (p[o + 2] - q[o + 2]) * damp;
      q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
      p[o] += vx; p[o + 1] += vy + GRAV * STEP * STEP; p[o + 2] += vz;
      maxMove = Math.max(maxMove, Math.abs(vx) + Math.abs(vy) + Math.abs(vz));
    }
    for (let it = 0; it < ITERS; it++) {
      for (const [a, b, len, k] of rd.sticks) solve(p, a, b, len, k, false);
      for (const [a, b, min] of LIMITS) solve(p, a, b, min, 1, true);
      hinge(p, HIL, KNL, FOL); hinge(p, HIR, KNR, FOR);
      for (let i = 0; i < n; i++) collide(rd, i);
    }
    return maxMove;
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
    if (off < 0.02) {
      const push = (0.02 - off) * 0.6;
      p[knee * 3] += fwd.x * push; p[knee * 3 + 1] += fwd.y * push; p[knee * 3 + 2] += fwd.z * push;
    }
  }

  // advance with a fixed step; returns false once asleep
  RD.update = function (rd, dt) {
    if (rd.asleep) return false;
    rd.acc += Math.min(dt, 0.1); rd.t += dt;
    let steps = 0;
    while (rd.acc >= STEP && steps < 6) {
      rd.acc -= STEP; steps++;
      const mv = stepOnce(rd);
      if (rd.t > 0.8 && mv < 0.0025) rd.still++; else rd.still = 0;
    }
    if (rd.still > 40 || rd.t > 7) rd.asleep = true;
    return true;
  };
  RD.point = function (rd, i, out) { return out.set(rd.p[i * 3], rd.p[i * 3 + 1], rd.p[i * 3 + 2]); };
})(window.G);
