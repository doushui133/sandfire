// weapons.js — weapon stats, spread/recoil, hitscan and damage, dropped weapons
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const W = G.Weapons = {};

  // Inaccuracy values are cone radii in radians.
  W.defs = {
    knife: { name: '战术匕首', slot: 'knife', melee: true, dmg: 34, dmg2: 62, rate: 0.42, rate2: 1.0, range: 1.8, speed: 6.2, kill: 1000 },
    p10: { name: 'P10 手枪', slot: 'pistol', price: 200, dmg: 34, rpm: 380, auto: false, clip: 15, reserve: 45, reload: 2.2, pen: 0.62, fall: 0.93,
      inacc: { stand: 0.005, crouch: 0.004, move: 0.03, air: 0.15, shot: 0.028, rec: 6 }, speed: 6.0, kill: 300, snd: 'pistol', model: 'pistol' },
    h50: { name: 'H50 重型手枪', slot: 'pistol', price: 650, dmg: 60, rpm: 230, auto: false, clip: 7, reserve: 35, reload: 2.2, pen: 0.93, fall: 0.86,
      inacc: { stand: 0.004, crouch: 0.003, move: 0.08, air: 0.2, shot: 0.05, rec: 5 }, speed: 5.75, kill: 300, snd: 'heavy', model: 'heavy' },
    v9: { name: 'V9 冲锋枪', slot: 'primary', price: 1250, dmg: 28, rpm: 800, auto: true, clip: 30, reserve: 120, reload: 2.4, pen: 0.6, fall: 0.82,
      inacc: { stand: 0.008, crouch: 0.006, move: 0.034, air: 0.15, shot: 0.004, rec: 6 }, speed: 5.9, kill: 600, snd: 'smg', model: 'smg' },
    ar7: { name: 'AR-7 突击步枪', slot: 'primary', team: 'atk', price: 2700, dmg: 36, rpm: 600, auto: true, clip: 30, reserve: 90, reload: 2.5, pen: 0.775, fall: 0.98,
      inacc: { stand: 0.0032, crouch: 0.0024, move: 0.115, air: 0.22, shot: 0.0026, rec: 5 }, speed: 5.4, kill: 300, snd: 'rifle', model: 'ar' },
    tr4: { name: 'TR-4 战术步枪', slot: 'primary', team: 'def', price: 2900, dmg: 34, rpm: 666, auto: true, clip: 30, reserve: 90, reload: 3.0, pen: 0.7, fall: 0.98,
      inacc: { stand: 0.0028, crouch: 0.002, move: 0.103, air: 0.22, shot: 0.0023, rec: 5.5 }, speed: 5.55, kill: 300, snd: 'rifle2', model: 'tr' },
    r90: { name: 'R-90 狙击步枪', slot: 'primary', price: 4450, dmg: 125, rpm: 48, auto: false, clip: 5, reserve: 30, reload: 3.6, pen: 0.97, fall: 0.996,
      inacc: { stand: 0.0007, crouch: 0.0005, move: 0.2, air: 0.3, shot: 0, rec: 2, unscoped: 0.085 }, speed: 5.0, scopeSpeed: 3.6, kill: 150, snd: 'sniper', model: 'sniper', scope: true },
  };
  function gun(base, stats, accuracy) {
    const d = W.defs[base];
    return Object.assign({}, d, { team: null }, stats, {
      inacc: Object.assign({}, d.inacc, accuracy),
    });
  }
  Object.assign(W.defs, {
    m18: gun('p10', { name:'M18 自动手枪', price:500, dmg:23, rpm:810, auto:true, clip:22, reserve:88, reload:1.9, snd:'m18' }, { move:0.055, shot:0.005 }),
    k5: gun('v9', { name:'K5 紧凑冲锋枪', price:1050, dmg:22, rpm:970, clip:32, speed:6.18, reload:2.05, snd:'k5' }, { move:0.027 }),
    u45: gun('v9', { name:'U45 冲锋枪', price:1200, dmg:39, rpm:525, clip:24, reserve:96, speed:5.75, snd:'u45' }, { move:0.04, shot:0.005 }),
    s8: gun('v9', { name:'S8 泵动霰弹枪', price:1150, dmg:24, rpm:68, auto:false, pellets:8, shell:true, clip:7, reserve:35, reload:0.6, pen:0.68, fall:0.25, speed:5.65, kill:900, snd:'s8', model:'pump' }, { stand:0.045, crouch:0.038, move:0.035 }),
    fa2: gun('ar7', { name:'FA-2 轻型步枪', price:2150, dmg:34, rpm:630, pen:0.72, speed:5.65, snd:'fa2' }, { stand:0.006, crouch:0.0045, shot:0.0038 }),
    s40: gun('r90', { name:'S40 轻型狙击步枪', price:3200, dmg:112, fall:0.997, rpm:36, clip:4, reserve:32, speed:5.85, scopeSpeed:4.45, reload:2.7, snd:'s40' }, { stand:0.0018, move:0.14 }),
    l60: gun('ar7', { name:'L60 轻机枪', price:4200, dmg:41, rpm:705, clip:100, reserve:200, reload:5.6, speed:4.4, snd:'l60', model:'box' }, { move:0.18, shot:0.0045 }),
  });
  W.grenades = ['he','flash','smoke','molotov','incendiary'];
  [['he','高爆手雷',300,'爆'], ['flash','闪光弹',200,'闪'], ['smoke','烟雾弹',300,'烟'],
   ['molotov','燃烧瓶',400,'燃','atk'], ['incendiary','燃烧弹',600,'燃','def']].forEach(([id,name,price,icon,team]) => {
    W.defs[id] = { name, price, icon, team, slot:'grenade', speed:6, limit:id === 'flash' ? 2 : 1, kill:300 };
  });
  W.grenadeCount = (a) => W.grenades.reduce((n, id) => n + (a.nades[id] || 0), 0);
  W.grenadeList = function (a) {
    const list = [];
    for (const id of W.grenades) {
      const count = a.nades[id];
      if (count > 0) list.push({ id, count, name: W.defs[id].name });
    }
    return list;
  };
  W.selectGrenade = function (a, id) {
    if (!W.grenades.includes(id) || !(a.nades[id] > 0)) return false;
    const selected = a.inv.grenade;
    if (a.cur !== 'grenade') {
      if (!selected || selected.id !== id) a.inv.grenade = W.item(id);
      return W.switchTo(a, 'grenade');
    }
    if (selected && selected.id === id) return true;
    G.Nades.cancel(a);
    a.inv.grenade = W.item(id);
    if (a.isPlayer) { G.Audio.click('switch'); if (G.VM) G.VM.onSwitch(); }
    return true;
  };
  W.canCarry = function (a, id) {
    const fire = id === 'molotov' || id === 'incendiary';
    return W.grenades.includes(id) && (a.nades[id] || 0) < W.defs[id].limit &&
      W.grenadeCount(a) < 4 && !(fire && (a.nades.molotov || a.nades.incendiary));
  };
  W.addGrenade = function (a, id) {
    if (!W.canCarry(a,id)) return false;
    a.nades[id] = (a.nades[id] || 0) + 1;
    if (!a.inv.grenade) a.inv.grenade = W.item(id);
    return true;
  };
  W.takeGrenade = function (a, id) {
    if (!a.nades[id]) return false;
    a.nades[id]--;
    if (!a.nades[id] && a.inv.grenade && a.inv.grenade.id === id) {
      const next = W.grenades.find((key) => a.nades[key]);
      a.inv.grenade = next ? W.item(next) : null;
      if (!next && a.cur === 'grenade') W.switchTo(a, W.bestSlot(a));
    }
    return true;
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
  // Absolute pitch and yaw in milliradians after each shot.
  const SPRAY = {
    ar7: [
      [5,0], [10,-1], [15,-2], [21,-3], [27,-4], [35,-5], [47,-6], [60,-7], [75,-6], [89,-3],
      [96,3], [100,12], [102,24], [101,36], [98,45], [94,48], [93,43], [95,32], [98,16], [101,-3],
      [103,-21], [104,-37], [102,-47], [99,-48], [96,-41], [94,-27], [95,-9], [98,10], [102,26], [106,36],
    ],
    tr4: [
      [4,1], [8,2], [13,2], [19,3], [26,4], [33,6], [43,8], [54,10], [66,11], [78,9],
      [86,4], [89,-3], [90,-13], [87,-24], [85,-32], [85,-35], [88,-31], [91,-21], [93,-8], [93,6],
      [90,19], [87,29], [86,36], [88,37], [91,31], [94,22], [95,9], [93,-4], [89,-15], [88,-23],
    ],
    fa2: [
      [6,-1], [11,0], [17,2], [23,5], [29,7], [37,9], [48,9], [61,6], [73,1], [84,-8],
      [92,-19], [96,-33], [94,-43], [91,-50], [88,-48], [90,-40], [96,-26], [101,-9], [102,9], [99,27],
      [94,41], [92,50], [95,51], [99,45], [103,32], [105,16], [102,-3], [97,-22], [94,-37], [93,-45],
    ],
    v9: [
      [4,-1], [8,2], [12,-4], [16,-1], [21,4], [24,0], [28,-6], [31,-11], [35,-5], [37,-13],
      [40,-16], [43,-10], [41,-3], [45,2], [43,-2], [46,10], [49,18], [45,15], [47,23], [49,18],
      [52,9], [47,14], [50,3], [48,-3], [45,-12], [47,-9], [50,-18], [49,-12], [51,-21], [52,-13],
    ],
    k5: [
      [3,2], [7,-1], [11,3], [14,8], [16,3], [18,9], [22,12], [25,5], [27,11], [30,2], [29,-6],
      [33,-1], [35,-12], [32,-18], [36,-11], [38,-22], [37,-14], [40,-5], [38,-9], [42,2], [40,10], [43,6],
      [45,17], [42,22], [46,14], [44,21], [43,12], [47,4], [45,9], [48,-1], [46,-10], [49,-5],
    ],
    u45: [
      [6,-3], [11,1], [16,-6], [21,-2], [27,-9], [32,-13], [37,-7], [43,-17],
      [48,-25], [51,-19], [54,-12], [57,-3], [54,-9], [58,5], [62,15], [57,11],
      [63,24], [60,30], [63,24], [58,29], [62,17], [64,8], [60,12], [65,-3],
    ],
    l60: [
      [9,1], [17,-1], [26,-4], [36,-7], [47,-7], [59,-5], [73,-1], [89,6], [106,16], [123,27],
      [137,42], [146,56], [149,67], [146,74], [143,72], [140,62], [142,47], [149,28], [155,7], [158,-16],
      [157,-36], [151,-54], [146,-67], [143,-74], [144,-71], [148,-62], [153,-46], [157,-25], [162,-4], [165,21],
      [163,41], [157,57], [151,70], [148,78], [151,74], [156,65], [162,50], [168,29], [170,6], [168,-18],
      [162,-42], [157,-60], [152,-76], [150,-83], [154,-79], [159,-68], [166,-50], [172,-29], [175,-5], [172,20],
      [167,43], [160,62], [156,76], [155,84], [158,80], [163,69], [169,52], [175,30], [177,6], [174,-21],
      [168,-45], [162,-65], [157,-81], [156,-87], [160,-84], [166,-73], [172,-53], [178,-31], [181,-6], [179,19],
      [172,44], [165,64], [160,80], [158,88], [161,85], [166,74], [173,56], [179,34], [182,9], [181,-17],
      [175,-42], [167,-64], [162,-81], [161,-90], [164,-88], [170,-77], [177,-59], [182,-35], [185,-8], [183,18],
      [176,45], [169,67], [164,85], [163,94], [166,91], [171,80], [178,61], [184,38], [186,11], [184,-15],
    ],
    m18: [
      [6,1], [12,-3], [17,2], [24,6], [28,2], [33,9], [38,15], [43,10], [46,18], [48,12], [52,5],
      [54,-3], [52,2], [56,-10], [59,-17], [55,-13], [58,-23], [61,-17], [57,-21], [61,-11], [62,-4], [64,3],
    ],
    p10: [
      [31,2], [33,-1], [32,3], [34,1], [33,-2], [32,-1], [34,2], [33,4],
      [32,2], [34,-2], [33,-3], [32,0], [34,3], [33,2], [32,-1],
    ],
    h50: [[64,-5], [68,-8], [67,4], [70,7], [66,2], [68,-6], [67,-3]],
    s8: [[82,4], [85,-3], [83,-5], [87,4], [84,1], [86,-4], [84,3]],
    r90: [[76,-3], [80,-1], [78,2], [81,3], [77,-2]],
    s40: [[62,2], [64,4], [63,-2], [65,-3]],
  };

  W.spread = function (a, it) {
    const d = it.def, ia = d.inacc;
    let s = G.lerp(ia.stand, ia.crouch, a.crouch);
    const maxSpeed = d.scope && it.zoom > 0 ? d.scopeSpeed : d.speed;
    const speed = Math.hypot(a.vel.x, a.vel.z);
    const f = G.clamp((speed / maxSpeed - 0.3) / 0.7, 0, 1);
    s += ia.move * f * f * (3 - 2 * f);
    if (!a.onGround) s += ia.air;
    if (d.scope && it.zoom === 0) s += ia.unscoped;
    return s + a.inacc;
  };
  function kick(a, it, recovery) {
    const d = it.def, pattern = SPRAY[d.id];
    const index = Math.min(pattern.length - 1, Math.floor(a.shots * recovery));
    const step = pattern[index], jitter = d.model === 'smg' ? 2.5 : 1;
    a.recoilP = a.recoilFromP = (step[0] + G.rand(-jitter, jitter)) * 0.001;
    a.recoilY = a.recoilFromY = (step[1] + G.rand(-jitter, jitter)) * 0.001;
    a.recoilItem = it;
    a.shots = index + 1;
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
    for (let i=0; i<2; i++) {
      const t=(-B + (i ? sq : -sq))/(2*A);
      if (t <= 0) continue;
      const y = oy + dy * t;
      if (y >= y0 && y <= y1) return t;
    }
    return -1;
  }
  const traceBox = {};
  W.hitboxes = function (a, out) {
    const c = a.crouch, x = a.pos.x, y = a.pos.y, z = a.pos.z;
    const h=out || {};
    h.headY=y+1.63-0.5*c; h.legTop=y+0.85-0.35*c; h.bodyTop=y+1.48-0.5*c; h.x=x; h.z=z;
    return h;
  };
  W.trace = function (shooter, ox, oy, oz, dx, dy, dz, maxDist) {
    const wh = G.Map.raycast(ox, oy, oz, dx, dy, dz, maxDist);
    let best = wh ? wh.t : maxDist;
    res.agent = null; res.world = !!wh; res.box = wh && wh.box; res.wallbang = false;
    if (wh) { res.nx = wh.nx; res.ny = wh.ny; res.nz = wh.nz; }
    for (const a of G.Game.agents) {
      if (!a.alive || a === shooter || a.team === shooter.team) continue;
      const h = W.hitboxes(a,traceBox);
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

  W.baseDamage = (def, dist) => def.dmg * Math.pow(def.fall || 1, def.shell ? Math.max(0, dist - 6) / 5 : dist / 10);
  W.applyDamage = function (target, shooter, def, group, dist, dirx, dirz, wallbang, diry) {
    let d = W.baseDamage(def, dist) * (wallbang ? 0.55 : 1);
    d *= group === 'head' ? 4 : group === 'legs' ? 0.75 : 1;
    const armored = target.armor > 0 && (group === 'body' || (group === 'head' && target.helmet));
    if (armored) {
      const after = d * def.pen;
      target.armor = Math.max(0, Math.round(target.armor - (d - after) * 0.5));
      d = after;
    }
    return G.Game.damage(target, shooter, Math.max(1, Math.round(d)), { weapon: def.id, head: group === 'head', legs: group === 'legs', helmet: armored && group === 'head', dirx, dirz, diry, wallbang });
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

  const barrel = new THREE.Vector3(), victims = [], pelletHits = new Map();
  // Only a fired rifle, LMG or scoped round can cross one wooden crate.
  // Sight, touch targeting and all other ray queries still stop at its surface.
  function bulletTrace(a, d, dir) {
    const r = W.trace(a, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 220);
    if (!r.world || !r.box || r.box.kind !== 'crate' || !(d.scope || d.model === 'ar' || d.model === 'tr' || d.model === 'box')) return r;
    const entry = Object.assign({}, r);
    const start = r.t + 0.001;
    const next = W.trace(a, eye.x + dir.x * start, eye.y + dir.y * start, eye.z + dir.z * start, dir.x, dir.y, dir.z, 220 - start);
    if (!next.agent) return entry;
    G.FX.impact(entry.wx, entry.wy, entry.wz, entry.nx, entry.ny, entry.nz);
    next.t += start; next.wallbang = true;
    return next;
  }
  function shoot(a, it, recovery) {
    const d = it.def;
    it.clip--; it.nextFire = G.time + 60 / d.rpm;
    G.eyePos(a, eye);
    const spread = W.spread(a, it) + (a.aimNoise || 0);
    const remaining = 1 - (a.recoilComp || 0);
    let aimP = a.pitch + a.recoilP * remaining;
    if (a.ai && Number.isFinite(a.ai.bodyCeiling)) {
      // A centre-mass burst from an inexperienced bot tends to pull low.
      aimP = Math.min(a.pitch - a.recoilP * remaining, a.ai.bodyCeiling - spread);
    }
    const aimY = a.yaw + a.recoilY * remaining;
    W.muzzlePos(a, muz);
    G.forward(aimY, aimP, barrel);
    right.set(Math.cos(aimY), 0, -Math.sin(aimY)); upv.crossVectors(right, barrel).normalize();
    let marked = false, head = false, killed = false;
    for (let i = 0; i < (d.pellets || 1); i++) {
      const ang = Math.random() * Math.PI * 2, rad = spread * Math.sqrt(Math.random());
      fwd.copy(barrel).addScaledVector(right, Math.cos(ang) * rad).addScaledVector(upv, Math.sin(ang) * rad).normalize();
      const r = bulletTrace(a, d, fwd);
      hitP.set(r.wx, r.wy, r.wz);
      if (r.agent) {
        const v = r.agent;
        if (d.pellets) {
          let h = pelletHits.get(v);
          if (!h) { h = { dmg:0, armor:0, head:false }; pelletHits.set(v, h); victims.push(v); }
          const raw = W.baseDamage(d, r.t) * (r.group === 'head' ? 4 : r.group === 'legs' ? 0.75 : 1);
          const covered = v.armor > 0 && (r.group === 'body' || (r.group === 'head' && v.helmet));
          h.dmg += covered ? raw * d.pen : raw;
          h.armor += covered ? raw * (1 - d.pen) * 0.5 : 0;
          h.head = h.head || r.group === 'head';
        } else {
          const out = W.applyDamage(v, a, d, r.group, r.t, fwd.x, fwd.z, r.wallbang, fwd.y);
          killed = out && out.killed;
        }
        head = head || r.group === 'head';
        if (!marked) G.FX.blood(r.wx, r.wy, r.wz, fwd, head);
        marked = true;
      } else if (r.world && i < 3) G.FX.impact(r.wx, r.wy, r.wz, r.nx, r.ny, r.nz);
      if (i === 0 && (!a.isPlayer || Math.random() < 0.5)) G.FX.tracer(muz, hitP);
    }
    for (const v of victims) {
      const h = pelletHits.get(v);
      v.armor = Math.max(0, Math.round(v.armor - h.armor));
      const out = G.Game.damage(v, a, Math.max(1, Math.round(h.dmg)), { weapon:d.id, head:h.head, helmet:h.head && v.helmet, dirx:barrel.x, diry:barrel.y, dirz:barrel.z });
      killed = killed || (out && out.killed);
    }
    victims.length = 0; pelletHits.clear();
    if (a.isPlayer && marked) G.HUD.hitmarker(head, killed);
    G.FX.muzzle(muz, barrel, d.slot === 'primary' && d.model !== 'smg', a.isPlayer);
    G.Audio.shot(d.snd, eye, a.isPlayer);
    if (G.Bots) G.Bots.hearShot(a);
    kick(a, it, recovery);
    if (a.isPlayer) {
      const heavy = d.scope || d.shell || d.model === 'heavy' || d.model === 'box';
      const punch = heavy ? 0.062 : d.slot === 'pistol' || d.model === 'smg' ? 0.027 : 0.037;
      a.viewPunch = Math.min(0.09, (a.viewPunch || 0) + punch);
      a.viewRoll = G.rand(-1, 1) * (heavy ? 0.009 : 0.005);
      if (heavy) a.viewFov = d.scope || d.shell ? 1.8 : 1.15;
    }
    a.lastShot = G.time;
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
    const it = W.current(a);
    const ia = it && it.def.inacc;
    a.inacc *= Math.exp(-dt * (ia ? ia.rec : 5));
    let recoil = 0;
    if (ia && a.shots && a.recoilItem === it) {
      const d = it.def, interval = 60 / d.rpm;
      const hold = d.auto ? interval + 0.05 : 0.025;
      const end = d.auto || d.slot !== 'pistol' ? 0.46 : interval;
      const remain = G.clamp((end - (G.time - a.lastShot)) / (end - hold), 0, 1);
      recoil = remain * remain * (3 - 2 * remain);
      a.recoilP = a.recoilFromP * recoil;
      a.recoilY = a.recoilFromY * recoil;
    } else a.recoilP = a.recoilY = 0;
    if (recoil === 0) {
      a.shots = 0;
      a.recoilItem = null;
    }
    if (!it) return;
    const d = it.def;
    if (d.slot === 'grenade') { G.Nades.control(a, ctl); return; }
    if (it.reloading && G.time >= it.reloadEnd) {
      const need = d.shell ? 1 : d.clip - it.clip, take = Math.min(need, it.reserve);
      it.clip += take; it.reserve -= take; it.reloading = false;
      if (d.shell && it.clip < d.clip && it.reserve && !ctl.fire && !ctl.firePressed) W.startReload(a, it);
      else if (a.isPlayer) G.Audio.reload(d, true);
    }
    if (d.scope && it.rezoom && G.time >= it.nextFire && !it.reloading) { it.zoom = it.rezoom; it.rezoom = 0; }
    if (G.time < a.switchEnd) return;
    if (d.melee) {
      if ((ctl.firePressed || ctl.fire) && G.time >= it.nextFire) knife(a, false);
      else if (ctl.alt && G.time >= it.nextFire) knife(a, true);
      return;
    }
    if (ctl.altPressed && d.scope && !it.reloading) { it.zoom = (it.zoom + 1) % 3; it.rezoom = 0; G.Audio.click('switch'); }
    if (d.shell && it.clip && (ctl.fire || ctl.firePressed)) it.reloading = false;
    if (ctl.reload && !it.reloading && it.clip < d.clip && it.reserve > 0) W.startReload(a, it);
    const wants = d.auto ? ctl.fire : ctl.firePressed;
    if (wants && !it.reloading && G.time >= it.nextFire) {
      if (it.clip > 0) shoot(a, it, recoil);
      else {
        it.nextFire = G.time + 0.25;
        if (a.isPlayer) G.Audio.click('empty');
        if (it.reserve > 0) W.startReload(a, it);
      }
    }
  };
  W.startReload = function (a, it) {
    it.reloading = true; it.reloadEnd = G.time + it.def.reload; it.zoom = 0; it.rezoom = 0;
    if (a.isPlayer) { G.Audio.reload(it.def, false); if (G.VM) G.VM.onReload(it.def.reload); }
  };
  W.switchTo = function (a, slot) {
    if (slot === 'bomb' ? !a.inv.bomb : !a.inv[slot]) return false;
    if (a.cur === slot) {
      if (slot !== 'grenade') return false;
      const i = W.grenades.indexOf(a.inv.grenade.id);
      for (let n = 1; n < W.grenades.length; n++) {
        const id = W.grenades[(i+n) % W.grenades.length];
        if (a.nades[id]) return W.selectGrenade(a, id);
      }
      return false;
    }
    G.Nades.cancel(a, a.cur === 'grenade' || !!a.throwLatch);
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
  const dropBounds = new THREE.Box3(), coverBox = new THREE.Box3();
  const pickupEye = new THREE.Vector3(), pickupPoint = new THREE.Vector3(), aimDir = new THREE.Vector3();
  const pickupRay = new THREE.Ray(), coverHit = new THREE.Vector3();
  function boundsFor(mesh) {
    mesh.updateMatrix();
    return dropBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrix);
  }
  function toss(a, item, scene) {
    item.reloading = false; item.zoom = item.rezoom = 0;
    const mesh = W.makeGunMesh(item.id), yaw = a.yaw + G.rand(-0.55, 0.55);
    mesh.position.copy(a.pos); mesh.position.y += 0.43;
    mesh.rotation.set(0, yaw, 0, 'YXZ');
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const def = item.def;
    (scene || G.scene).add(mesh);
    W.drops.push({ item, def, mesh, t: G.time, dropper: a, target: { item, def, mesh },
      bottom: boundsFor(mesh).min.y, vx: -Math.sin(yaw) * 1.7, vz: -Math.cos(yaw) * 1.7, vy: 1.9, floor: 0, settled: false });
  }
  W.drop = function (a, slot, scene) {
    const it = a.inv[slot];
    if (!it || slot === 'knife') return;
    if (slot === 'grenade') { if (a.cur === slot) G.Nades.cancel(a); W.takeGrenade(a, it.id); }
    else {
      a.inv[slot] = null;
      if (a.cur === slot) W.switchTo(a, W.bestSlot(a));
    }
    toss(a, it, scene);
  };

  function dropSurface(bounds, bottom, moving) {
    const lo = bounds.min, hi = bounds.max;
    const boxes = G.Map.query(lo.x, lo.z, hi.x, hi.z);
    let floor = 0;
    for (const b of boxes) {
      if (b.x0 >= hi.x || b.x1 <= lo.x || b.z0 >= hi.z || b.z1 <= lo.z) continue;
      if (b.y1 <= bottom + 0.015) floor = Math.max(floor, b.y1);
      else if (moving && b.y0 < hi.y) return Infinity;
    }
    return floor;
  }
  W.updateDrops = function (dt) {
    for (const dr of W.drops) {
      if (dr.settled) continue;
      const mesh = dr.mesh, p = mesh.position;
      for (let left = dt; left > 1e-6 && !dr.settled;) {
        const step = Math.min(left, 1 / 90), x = p.x, z = p.z;
        left -= step;
        p.x += dr.vx * step; p.z += dr.vz * step;
        p.y += dr.vy * step; dr.vy -= 16 * step;
        mesh.rotation.z += step * 13;
        let floor = dropSurface(boundsFor(mesh), dr.bottom, dr.vx !== 0 || dr.vz !== 0);
        if (floor === Infinity) {
          p.x = x; p.z = z; dr.vx = dr.vz = 0;
          floor = dropSurface(boundsFor(mesh), dr.bottom, false);
        }
        if (dropBounds.min.y <= floor + 0.012) {
          mesh.rotation.z = Math.PI / 2;
          floor = Math.max(floor, dropSurface(boundsFor(mesh), dr.bottom, false));
          p.y += floor + 0.012 - dropBounds.min.y;
          dr.floor = floor; dr.settled = true;
        } else dr.bottom = dropBounds.min.y;
      }
    }
  };

  function pickupVisible(a, p) {
    pickupRay.origin.copy(pickupEye);
    pickupRay.direction.subVectors(p, pickupEye);
    const reach = pickupRay.direction.length() - 0.025;
    pickupRay.direction.normalize();
    const boxes = G.Map.query(Math.min(a.pos.x, p.x), Math.min(a.pos.z, p.z), Math.max(a.pos.x, p.x), Math.max(a.pos.z, p.z));
    for (const b of boxes) {
      coverBox.min.set(b.x0, b.y0, b.z0); coverBox.max.set(b.x1, b.y1, b.z1);
      if (pickupRay.intersectBox(coverBox, coverHit) && pickupEye.distanceTo(coverHit) < reach) return false;
    }
    return true;
  }
  function findPickup(a, swap) {
    if (!a || !a.alive || a.planting || a.defusing || !W.drops.length) return null;
    if (swap && (G.Game.bombUse(a) || (a.isPlayer &&
        (G.paused || G.HUD.buyOpen || G.HUD.scoresOpen || G.HUD.mapOpen || G.Nades.wheel.open)))) return null;
    G.eyePos(a, pickupEye);
    if (swap) G.forward(a.yaw, a.pitch, aimDir);
    let best = null, distance = swap ? 2.1 : 1.1;
    for (const dr of W.drops) {
      if (!dr.settled) continue;
      const pos = dr.mesh.position, dx = pos.x - a.pos.x, dz = pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz), height = Math.abs(dr.floor - a.pos.y);
      const slot = dr.def.slot;
      if (!swap && dr.dropper === a) {
        if (dist < 1.1 && height < 1.05) continue;
        dr.dropper = null;
      }
      if (dist >= distance || height >= 1.05) continue;
      if (slot === 'grenade' ? swap || !W.canCarry(a, dr.item.id) : !swap && a.inv[slot]) continue;
      pickupPoint.set(pos.x, Math.max(pos.y, dr.floor + 0.05), pos.z);
      if (swap && dist >= 0.65) {
        const dy = pickupPoint.y - pickupEye.y;
        if (aimDir.x * dx + aimDir.y * dy + aimDir.z * dz < 0.45 * Math.hypot(dist, dy)) continue;
      }
      if (!pickupVisible(a, pickupPoint)) continue;
      best = dr; distance = dist;
    }
    return best;
  }
  W.pickupTarget = function (a) {
    const dr = findPickup(a, true);
    return dr ? dr.target : null;
  };
  function removeDrop(dr) { if (dr.mesh.parent) dr.mesh.parent.remove(dr.mesh); }
  W.tryPickup = function (a, swap = false) {
    const dr = findPickup(a, swap);
    if (!dr) return false;
    const slot = dr.def.slot;
    if (slot === 'grenade') W.addGrenade(a, dr.item.id);
    else {
      const old = a.inv[slot];
      if (old) toss(a, old);
      a.inv[slot] = dr.item;
      if (old && a.cur === slot) {
        a.switchEnd = G.time + 0.6; a.shots = 0;
        if (a.isPlayer && G.VM) G.VM.onSwitch();
      }
    }
    removeDrop(dr); W.drops.splice(W.drops.indexOf(dr), 1);
    if (!(slot === 'primary' && W.switchTo(a, slot)) && a.isPlayer) G.Audio.click('switch');
    return true;
  };
  W.clearDrops = function () { W.drops.forEach(removeDrop); W.drops.length = 0; };
})(window.G);
