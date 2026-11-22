// weapons.js — weapon stats, spread/recoil, hitscan and damage, dropped weapons
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const W = G.Weapons = {};

  // inacc values are cone radii in radians; rc = recoil kick per shot (radians)
  W.defs = {
    knife: { name: '战术匕首', slot: 'knife', melee: true, dmg: 34, dmg2: 62, rate: 0.42, rate2: 1.0, range: 1.8, speed: 6.2, kill: 1000 },
    p10: { name: 'P10 手枪', slot: 'pistol', price: 200, dmg: 30, rpm: 380, auto: false, clip: 15, reserve: 45, reload: 2.2, pen: 0.5, fall: 0.9,
      inacc: { stand: 0.005, crouch: 0.004, move: 0.03, air: 0.15, shot: 0.032, rec: 5 }, rc: { up: 0.026, side: 0.006, decay: 0, sideStart: 99 }, speed: 6.0, kill: 300, snd: 'pistol', model: 'pistol' },
    h50: { name: 'H50 重型手枪', slot: 'pistol', price: 700, dmg: 58, rpm: 230, auto: false, clip: 7, reserve: 35, reload: 2.2, pen: 0.93, fall: 0.86,
      inacc: { stand: 0.004, crouch: 0.003, move: 0.08, air: 0.2, shot: 0.06, rec: 3 }, rc: { up: 0.06, side: 0.012, decay: 0, sideStart: 99 }, speed: 5.75, kill: 300, snd: 'heavy', model: 'heavy' },
    v9: { name: 'V9 冲锋枪', slot: 'primary', price: 1250, dmg: 26, rpm: 800, auto: true, clip: 30, reserve: 120, reload: 2.4, pen: 0.6, fall: 0.82,
      inacc: { stand: 0.008, crouch: 0.006, move: 0.028, air: 0.15, shot: 0.005, rec: 6 }, rc: { up: 0.011, side: 0.006, decay: 0.07, sideStart: 6, period: 4 }, speed: 5.9, kill: 600, snd: 'smg', model: 'smg' },
    ar7: { name: 'AR-7 突击步枪', slot: 'primary', team: 'atk', price: 2700, dmg: 36, rpm: 600, auto: true, clip: 30, reserve: 90, reload: 2.5, pen: 0.775, fall: 0.98,
      inacc: { stand: 0.0032, crouch: 0.0024, move: 0.11, air: 0.22, shot: 0.0075, rec: 4 }, rc: { up: 0.0175, side: 0.0095, decay: 0.075, sideStart: 8, period: 5 }, speed: 5.4, kill: 300, snd: 'rifle', model: 'ar' },
    tr4: { name: 'TR-4 战术步枪', slot: 'primary', team: 'def', price: 3100, dmg: 33, rpm: 666, auto: true, clip: 30, reserve: 90, reload: 3.0, pen: 0.7, fall: 0.98,
      inacc: { stand: 0.0028, crouch: 0.002, move: 0.1, air: 0.22, shot: 0.0065, rec: 4.5 }, rc: { up: 0.0145, side: 0.008, decay: 0.07, sideStart: 9, period: 5 }, speed: 5.55, kill: 300, snd: 'rifle2', model: 'tr' },
    r90: { name: 'R-90 狙击步枪', slot: 'primary', price: 4750, dmg: 115, rpm: 41, auto: false, clip: 5, reserve: 30, reload: 3.6, pen: 0.97, fall: 0.99,
      inacc: { stand: 0.0007, crouch: 0.0005, move: 0.2, air: 0.3, shot: 0, rec: 2, unscoped: 0.085 }, rc: { up: 0.05, side: 0.005, decay: 0, sideStart: 99 }, speed: 5.0, scopeSpeed: 3.6, kill: 150, snd: 'sniper', model: 'sniper', scope: true },
  };
  for (const k in W.defs) W.defs[k].id = k;
  W.equipment = {
    vest: { name: '防弹衣', price: 650 },
    vesthelm: { name: '防弹衣 + 头盔', price: 1000 },
    kit: { name: '拆弹器', price: 400, team: 'def' },
  };

  W.item = function (id) {
    const d = W.defs[id];
    return { id, def: d, clip: d.clip || 0, reserve: d.reserve || 0, nextFire: 0, reloadEnd: 0, reloading: false, zoom: 0, rezoom: 0 };
  };
  W.current = (a) => (a.cur === 'bomb' ? null : a.inv[a.cur]);
  W.maxSpeed = function (a) {
    const it = W.current(a);
    if (!it) return 5.9;
    if (it.def.scope && it.zoom > 0) return it.def.scopeSpeed;
    return it.def.speed;
  };

  // ---------- gun models (built in gunmodels.js; shared geometry, so meshes are cheap) ----------
  W.makeGunMesh = (id) => G.GunModels.mesh(id);

  // ---------- spread & recoil ----------
  W.spread = function (a, it) {
    const d = it.def, ia = d.inacc;
    let s = G.lerp(ia.stand, ia.crouch, a.crouch);
    const sp = Math.hypot(a.vel.x, a.vel.z), frac = G.clamp((sp / d.speed - 0.34) / 0.66, 0, 1);
    s += ia.move * frac;
    if (!a.onGround) s += ia.air;
    if (d.scope && it.zoom === 0) s += ia.unscoped;
    return s + a.inacc;
  };
  function kick(a, d) {
    const rc = d.rc, i = a.shots;
    const up = rc.up * Math.max(0.12, 1 - i * rc.decay);
    let side;
    if (i < rc.sideStart) side = rc.side * 0.35 * (Math.random() - 0.5);
    else side = rc.side * Math.sign(Math.sin(((i - rc.sideStart) / rc.period) * Math.PI) || 1) * (0.7 + 0.3 * Math.random());
    a.recoilP += up; a.recoilY += side;
  }

  // ---------- hitscan ----------
  const res = { t: 0, agent: null, group: null, wx: 0, wy: 0, wz: 0, nx: 0, ny: 0, nz: 0, world: false };
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : -1;
  }
  function rayCyl(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
    const lx = ox - cx, lz = oz - cz, A = dx * dx + dz * dz;
    if (A < 1e-9) return -1;
    const B = 2 * (lx * dx + lz * dz), C = lx * lx + lz * lz - r * r, disc = B * B - 4 * A * C;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      if (t <= 0) continue;
      const y = oy + dy * t;
      if (y >= y0 && y <= y1) return t;
    }
    return -1;
  }
  W.hitboxes = function (a) {
    const c = a.crouch, x = a.pos.x, y = a.pos.y, z = a.pos.z;
    return { headY: y + 1.63 - 0.5 * c, legTop: y + 0.85 - 0.35 * c, bodyTop: y + 1.48 - 0.5 * c, x, z };
  };
  W.trace = function (shooter, ox, oy, oz, dx, dy, dz, maxDist) {
    const wh = G.Map.raycast(ox, oy, oz, dx, dy, dz, maxDist);
    let best = wh ? wh.t : maxDist;
    res.agent = null; res.world = !!wh;
    if (wh) { res.nx = wh.nx; res.ny = wh.ny; res.nz = wh.nz; }
    for (const a of G.Game.agents) {
      if (!a.alive || a === shooter || a.team === shooter.team) continue;
      const h = W.hitboxes(a);
      // cheap reject
      const lx = h.x - ox, lz = h.z - oz, along = lx * dx + lz * dz;
      if (along < -1 || along > best + 1) continue;
      let t = raySphere(ox, oy, oz, dx, dy, dz, h.x, h.headY, h.z, 0.15);
      if (t > 0 && t < best) { best = t; res.agent = a; res.group = 'head'; }
      t = rayCyl(ox, oy, oz, dx, dy, dz, h.x, h.z, 0.24, h.legTop, h.bodyTop);
      if (t > 0 && t < best) { best = t; res.agent = a; res.group = 'body'; }
      t = rayCyl(ox, oy, oz, dx, dy, dz, h.x, h.z, 0.2, a.pos.y, h.legTop);
      if (t > 0 && t < best) { best = t; res.agent = a; res.group = 'legs'; }
    }
    res.t = best; res.wx = ox + dx * best; res.wy = oy + dy * best; res.wz = oz + dz * best;
    if (res.agent) res.world = false;
    return res;
  };

  W.applyDamage = function (target, shooter, def, group, dist, dirx, dirz) {
    let d = def.dmg * Math.pow(def.fall || 1, dist / 10);
    d *= group === 'head' ? 4 : group === 'legs' ? 0.75 : 1;
    const armored = target.armor > 0 && (group === 'body' || (group === 'head' && target.helmet));
    if (armored) {
      const after = d * def.pen;
      target.armor = Math.max(0, Math.round(target.armor - (d - after) * 0.5));
      d = after;
    }
    return G.Game.damage(target, shooter, Math.max(1, Math.round(d)), { weapon: def.id, head: group === 'head', legs: group === 'legs', helmet: armored && group === 'head', dirx, dirz });
  };

  // ---------- firing ----------
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), eye = new THREE.Vector3(), muz = new THREE.Vector3(), hitP = new THREE.Vector3();
  W.muzzlePos = function (a, out) {
    G.eyePos(a, out);
    G.forward(a.yaw, a.pitch, fwd);
    right.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    const dn = a.isPlayer ? 0.12 : 0.28;
    return out.addScaledVector(fwd, a.isPlayer ? 0.7 : 0.65).addScaledVector(right, a.isPlayer ? 0.16 : 0.2).add(upv.set(0, -dn, 0));
  };

  function shoot(a, it) {
    const d = it.def;
    it.clip--; it.nextFire = G.time + 60 / d.rpm;
    G.eyePos(a, eye);
    const aimP = a.pitch + a.recoilP * (a.recoilComp !== undefined ? 1 - a.recoilComp : 1);
    const aimY = a.yaw + a.recoilY * (a.recoilComp !== undefined ? 1 - a.recoilComp : 1);
    G.forward(aimY, aimP, fwd);
    const spread = W.spread(a, it) + (a.aimNoise || 0);
    const ang = Math.random() * Math.PI * 2, rad = spread * Math.sqrt(Math.random());
    right.set(Math.cos(aimY), 0, -Math.sin(aimY));
    upv.crossVectors(right, fwd).normalize();
    fwd.addScaledVector(right, Math.cos(ang) * rad).addScaledVector(upv, Math.sin(ang) * rad).normalize();
    const r = W.trace(a, eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, 220);
    hitP.set(r.wx, r.wy, r.wz);
    W.muzzlePos(a, muz);
    if (r.agent) {
      const victim = r.agent, out = W.applyDamage(victim, a, d, r.group, r.t, fwd.x, fwd.z);
      G.FX.blood(r.wx, r.wy, r.wz, fwd, r.group === 'head');
      if (a.isPlayer) { G.HUD && G.HUD.hitmarker(r.group === 'head', out && out.killed); G.Audio.hit(r.group === 'head', out && out.helmet); }
    } else if (r.world) {
      G.FX.impact(r.wx, r.wy, r.wz, r.nx, r.ny, r.nz);
    }
    if (!a.isPlayer || Math.random() < 0.5) G.FX.tracer(muz, hitP);
    G.FX.muzzle(muz, fwd, d.model === 'sniper' || d.model === 'ar' || d.model === 'heavy', a.isPlayer);
    G.Audio.shot(d.snd, eye, a.isPlayer);
    if (G.Bots) G.Bots.hearShot(a);
    kick(a, d);
    a.shots++; a.lastShot = G.time;
    a.inacc += d.inacc.shot;
    if (d.scope) { it.rezoom = it.zoom; it.zoom = 0; G.Audio.click('bolt'); }
    if (a.isPlayer && G.VM) G.VM.onShoot(d);
  }

  function knife(a, heavy) {
    const it = a.inv.knife, d = it.def;
    it.nextFire = G.time + (heavy ? d.rate2 : d.rate);
    G.eyePos(a, eye); G.forward(a.yaw, a.pitch, fwd);
    const r = W.trace(a, eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, d.range);
    let hitSomething = false;
    if (r.agent) {
      const v = r.agent, facing = G.forward(v.yaw, 0, right), back = facing.x * fwd.x + facing.z * fwd.z > 0.5;
      const dmg = (heavy ? d.dmg2 : d.dmg) * (back ? 3 : 1);
      let armorK = v.armor > 0 ? 0.85 : 1;
      const out = G.Game.damage(v, a, Math.round(dmg * armorK), { weapon: 'knife', head: false, dirx: fwd.x, dirz: fwd.z });
      G.FX.blood(r.wx, r.wy, r.wz, fwd, false);
      if (a.isPlayer) { G.HUD && G.HUD.hitmarker(false, out && out.killed); }
      hitSomething = true;
    } else if (r.world) { G.FX.impact(r.wx, r.wy, r.wz, r.nx, r.ny, r.nz); hitSomething = true; }
    G.Audio.knife(eye, a.isPlayer, hitSomething);
    if (a.isPlayer && G.VM) G.VM.onKnife(heavy);
  }

  // per-frame weapon logic shared by player and bots. ctl: {fire, firePressed, alt, reload}
  W.update = function (a, dt, ctl) {
    a.inacc *= Math.exp(-dt * (W.current(a) ? W.current(a).def.inacc ? W.current(a).def.inacc.rec : 5 : 5));
    if (G.time - a.lastShot > 0.12 + (W.current(a) && W.current(a).def.rpm ? 60 / W.current(a).def.rpm : 0)) {
      const k = Math.exp(-dt * 7);
      a.recoilP *= k; a.recoilY *= k;
      if (G.time - a.lastShot > 0.4) a.shots = 0;
    }
    const it = W.current(a);
    if (!it) return;
    const d = it.def;
    if (it.reloading && G.time >= it.reloadEnd) {
      const need = d.clip - it.clip, take = Math.min(need, it.reserve);
      it.clip += take; it.reserve -= take; it.reloading = false;
    }
    if (d.scope && it.rezoom && G.time >= it.nextFire && !it.reloading) { it.zoom = it.rezoom; it.rezoom = 0; }
    if (G.time < a.switchEnd) return;
    if (d.melee) {
      if ((ctl.firePressed || ctl.fire) && G.time >= it.nextFire) knife(a, false);
      else if (ctl.alt && G.time >= it.nextFire) knife(a, true);
      return;
    }
    if (ctl.altPressed && d.scope && !it.reloading) { it.zoom = (it.zoom + 1) % 3; it.rezoom = 0; G.Audio.click('switch'); }
    if (ctl.reload && !it.reloading && it.clip < d.clip && it.reserve > 0) W.startReload(a, it);
    const wants = d.auto ? ctl.fire : ctl.firePressed;
    if (wants && !it.reloading && G.time >= it.nextFire) {
      if (it.clip > 0) shoot(a, it);
      else {
        it.nextFire = G.time + 0.25;
        if (a.isPlayer) G.Audio.click('empty');
        if (it.reserve > 0) W.startReload(a, it);
      }
    }
  };
  W.startReload = function (a, it) {
    it.reloading = true; it.reloadEnd = G.time + it.def.reload; it.zoom = 0; it.rezoom = 0;
    if (a.isPlayer) { G.Audio.click('reload1'); setTimeout(() => G.Audio.click('reload2'), it.def.reload * 650); if (G.VM) G.VM.onReload(it.def.reload); }
  };
  W.switchTo = function (a, slot) {
    if (slot === 'bomb' ? !a.inv.bomb : !a.inv[slot]) return false;
    if (a.cur === slot) return false;
    const old = W.current(a);
    if (old) { old.reloading = false; old.zoom = 0; old.rezoom = 0; }
    a.prevSlot = a.cur; a.cur = slot; a.switchEnd = G.time + (slot === 'knife' ? 0.35 : 0.6);
    a.shots = 0;
    if (a.isPlayer) { G.Audio.click('switch'); if (G.VM) G.VM.onSwitch(); }
    return true;
  };
  W.bestSlot = (a) => (a.inv.primary ? 'primary' : a.inv.pistol ? 'pistol' : 'knife');

  // ---------- dropped weapons ----------
  W.drops = [];
  W.drop = function (a, slot, scene) {
    const it = a.inv[slot];
    if (!it || slot === 'knife') return;
    a.inv[slot] = null;
    const mesh = W.makeGunMesh(it.id);
    mesh.position.set(a.pos.x + G.rand(-0.3, 0.3), a.pos.y + 0.03, a.pos.z + G.rand(-0.3, 0.3));
    mesh.rotation.set(0, Math.random() * 6.28, Math.PI / 2, 'YXZ');
    (scene || G.scene).add(mesh);
    W.drops.push({ item: it, mesh, t: G.time });
    if (a.cur === slot) { a.cur = W.bestSlot(a); a.switchEnd = G.time + 0.5; if (a.isPlayer && G.VM) G.VM.onSwitch(); }
  };
  W.tryPickup = function (a) {
    for (let i = W.drops.length - 1; i >= 0; i--) {
      const dr = W.drops[i];
      if (G.time - dr.t < 0.8) continue;
      const slot = dr.item.def.slot;
      if (a.inv[slot]) continue;
      if (Math.hypot(dr.mesh.position.x - a.pos.x, dr.mesh.position.z - a.pos.z) < 1.1 && Math.abs(dr.mesh.position.y - a.pos.y) < 1.2) {
        a.inv[slot] = dr.item; G.scene.remove(dr.mesh); W.drops.splice(i, 1);
        if (a.isPlayer) G.Audio.click('switch');
        if (slot === 'primary' && a.cur !== 'primary') W.switchTo(a, 'primary');
        return true;
      }
    }
    return false;
  };
  W.clearDrops = function () { W.drops.forEach((d) => G.scene.remove(d.mesh)); W.drops.length = 0; };
})(window.G);
