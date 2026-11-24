// bots.js — bot perception, tactics (routes, holds, rotations, plant/defuse) and gunfights
(function (G) {
  'use strict';
  const THREE = G.THREE, M = G.Map, W = G.Weapons;
  const B = G.Bots = { plan: null };
  const DIFF = [
    { react: [0.48, 0.67], err: 0.065, track: 3.5, turn: 16, comp: 0.22, fov: 1.5, hs: 0.025, noise: 0.032, bloom: 0.50 },
    { react: [0.30, 0.41], err: 0.038, track: 5.5, turn: 21, comp: 0.52, fov: 1.75, hs: 0.075, noise: 0.016, bloom: 0.25 },
    { react: [0.19, 0.26], err: 0.021, track: 8, turn: 27, comp: 0.79, fov: 1.85, hs: 0.27, noise: 0.009, bloom: 0 },
  ];
  let level = 1, D = DIFF[1];
  const eye = new THREE.Vector3(), tv = new THREE.Vector3();
  const SIGHT_INTERVAL = 0.10, SIGHT_AGE = 0.30, MEMORY = 1.5;
  let sightCursor = 0, angleChecks = 0, shotChecks = 0, cuePaths = 0;
  B.setDifficulty = (i) => { level = DIFF[i] ? i : 1; D = DIFF[level]; };

  function freshAI() {
    return {
      grenadeAt:G.time + G.rand(6,11), throwGoal:new THREE.Vector3(), throwId:null, mode: 'idle', path: null, pathIdx: 0, goal: new THREE.Vector3(1e9, 0, 0), repathT: 0, route: null, routeIdx: 0, siteTarget: null,
      target: null, targetVisible: false, danger: 0, reactUntil: 0, sightAt: -99, errY: 0, errP: 0, flickY: 0, flickP: 0, aimHead: false,
      aimPart: 0, aimPos: new THREE.Vector3(), aimVel: new THREE.Vector3(), lastSeenPos: new THREE.Vector3(), lastSeenT: -99,
      alertPos: new THREE.Vector3(), alertAt: -99, alertT: -99, cueGoal: new THREE.Vector3(), cueFrom: new THREE.Vector3(), cuePoint: null, cueValid: false,
      strafe: 0, strafeT: 0, stuckCheck: 1, lastPos: new THREE.Vector3(), unstickUntil: 0,
      visT: Math.random() * SIGHT_INTERVAL, scanIdx: 0, scanTarget: true, burstLeft: 0, pauseUntil: 0,
      scopeReady: 0, repositionUntil: 0, sidearm: false, guardPos: null, guardYaw: 0, guardFor: null,
      lookAt: 0, lookYaw: null, lookTry: 0, lookBase: null, lookPoint: null,
      delay: 0, hold: null, rotateTo: null, stepDist: 0,
    };
  }
  B.resetPractice = function (a) {
    a.ai = freshAI();
    a.ai.roam = new THREE.Vector3();
    a.ai.roamUntil = 0;
    a.recoilComp = D.comp; a.aimNoise = D.noise;
  };

  // ---------- round setup and buying ----------
  B.newRound = function () {
    sightCursor = 0;
    const site = Math.random() < 0.5 ? 'A' : 'B';
    B.plan = { site, contact: false, rotated: { A: false, B: false }, seen: { A: [], B: [] } };
    const atk = G.Game.agents.filter((a) => a.isBot && a.team === 'atk');
    const routes = M.routes[site];
    atk.forEach((a, i) => {
      a.ai = freshAI();
      const ri = i < Math.ceil(atk.length * 0.6) ? 0 : 1 + (i % (routes.length - 1));
      a.ai.route = routes[Math.min(ri, routes.length - 1)];
      a.ai.siteTarget = M.randomSiteCell(site, 6);
      a.ai.delay = G.rand(0, 2.5);
    });
    const def = G.Game.agents.filter((a) => a.isBot && a.team === 'def');
    const pools = { A: G.shuffle(M.holds.filter((h) => h.site === 'A')), B: G.shuffle(M.holds.filter((h) => h.site === 'B')), M: G.shuffle(M.holds.filter((h) => h.site === 'M')) };
    const order = G.shuffle(['A', 'B', 'A', 'B', 'M']);
    def.forEach((a, i) => {
      a.ai = freshAI();
      a.ai.hold = pools[order[i % 5]].shift() || G.pick(M.holds);
      a.ai.delay = G.rand(0, 1.2);
    });
    G.Game.agents.forEach((a) => { if (a.isBot) { a.recoilComp = D.comp; a.aimNoise = D.noise; } });
  };
  B.buy = function (a) {
    const Gm = G.Game, rifle = a.team === 'atk' ? 'ar7' : 'tr4';
    if (!a.inv.primary && Gm.round>1) {
      const options = ['k5','u45','s8','v9','fa2','s40',rifle,'r90','l60'].filter((id) => W.defs[id].price<=a.money);
      if (options.length) {
        const preferred=options.filter((id) => W.defs[id].price>=Math.min(2700,a.money*.45));
        Gm.buy(a,G.pick(preferred.length && Math.random()<.72 ? preferred : options));
      }
    }
    if (!a.inv.primary && a.inv.pistol.id==='p10' && Math.random()<.38) Gm.buy(a,G.pick(['h50','m18']));
    if (a.armor<70 || !a.helmet) { if (a.money>=1000) Gm.buy(a,'vesthelm'); else if (a.armor<70) Gm.buy(a,'vest'); }
    if (a.team==='def' && !a.kit && Math.random()<.45) Gm.buy(a,'kit');
    const choices=G.shuffle(['he','flash','smoke',a.team==='atk' ? 'molotov' : 'incendiary']);
    for (const id of choices) { if (W.grenadeCount(a)>=level+1) break; Gm.buy(a,id); }
  };

  // ---------- hearing / damage reactions ----------
  function alert(a, pos, dur) {
    if (!a.ai || a.ai.targetVisible || a.blindUntil > G.time) return;
    a.ai.alertPos.copy(pos); a.ai.alertAt = G.time; a.ai.alertT = G.time + dur;
  }
  B.hearShot = function (s) {
    G.HUD.soundMarker(s, s.pos, 'shot');
    for (const a of G.Game.agents) if (a.isBot && a.alive && a.team !== s.team && G.dist2D(a.pos, s.pos) < 55) alert(a, s.pos, 2.5);
  };
  B.hearStep = function (s) {
    G.HUD.soundMarker(s, s.pos, 'step');
    for (const a of G.Game.agents) if (a.isBot && a.alive && a.team !== s.team && G.dist2D(a.pos, s.pos) < 15) alert(a, s.pos, 2);
  };
  B.onDamaged = function (v, attacker) {
    if (!v.isBot || !v.ai || !attacker || attacker.team === v.team) return;
    alert(v, attacker.pos, 3); v.ai.visT = 0;
  };

  // ---------- perception ----------
  const box = {}, facing = new THREE.Vector3(), PARTS = [1, 2, 4], TORSO = [0.28, 0.42, 0.60];
  function aimPoint(e, part, out) {
    const h = W.hitboxes(e, box);
    if (part === 1) return out.set(h.headX, h.headY, h.headZ);
    const y = part === 2 ? G.lerp(h.legTop, h.bodyTop, TORSO[level]) : (e.pos.y + h.legTop) / 2;
    return out.set(h.x, y, h.z);
  }
  function sightDot(e) {
    const x = e.pos.x - eye.x, y = e.pos.y + G.eyeHeight(e.crouch) - eye.y, z = e.pos.z - eye.z;
    const d = Math.hypot(x, y, z);
    return d > 95 ? -1 : (x * facing.x + y * facing.y + z * facing.z) / (d || 1);
  }
  function perceive(a, agents) {
    const ai = a.ai;
    G.eyePos(a, eye); G.forward(a.yaw, a.pitch, facing);
    const cosF = Math.cos(D.fov / 2);
    if (ai.targetVisible && (!ai.target.alive || sightDot(ai.target) < cosF || G.time - ai.lastSeenT > SIGHT_AGE)) ai.targetVisible = false;
    let e = ai.scanTarget && ai.targetVisible ? ai.target : null;
    ai.scanTarget = !ai.scanTarget;
    if (!e) {
      for (let i = 0; i < agents.length; i++) {
        const other = agents[ai.scanIdx++ % agents.length];
        if (!other.alive || other.team === a.team || (ai.targetVisible && other === ai.target) || sightDot(other) < cosF) continue;
        e = other; break;
      }
    }
    if (!e && ai.targetVisible) e = ai.target;
    if (!e) return false;
    let mask = 0;
    for (const part of PARTS) if (G.Nades.visible(eye, aimPoint(e, part, tv))) mask |= part;
    if (mask === 0) {
      if (ai.target === e) ai.targetVisible = false;
      return true;
    }
    // Only one of head, chest and legs shows (a head over a box, legs under a gap): seen, but noticed later.
    const partial = (mask & (mask - 1)) === 0;
    if (G.Player.agent && a.team === G.Player.agent.team) e.spottedUntil = G.time + 1.2;
    if (B.plan && G.Game.mode !== 'practice') {
      if (a.team === 'atk') B.plan.contact = true;
      else {
        const site = M.siteAt(e.pos.x, e.pos.z) || nearSite(e.pos);
        if (site) threat(site, e);
      }
    }
    const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    const threatFacing = (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / (d || 1);
    const danger = (1 + 0.55 * Math.max(0, threatFacing) ** 4 + 0.25 * (1 - e.hp / 100)) / (1 + d / 16);
    if (ai.targetVisible && ai.target !== e && danger <= ai.danger * 1.10) return true;
    if (ai.target !== e || !ai.targetVisible) {
      const angle = Math.acos(G.clamp(sightDot(e), -1, 1));
      const peripheral = angle / (D.fov / 2);
      const preaim = G.clamp(1 - angle / 0.14, 0, 1);
      ai.sightAt = G.time;
      ai.reactUntil = G.time + G.rand(D.react[0], D.react[1]) + 0.20 * peripheral ** 2 - 0.02 * preaim + (partial ? 0.12 : 0);
      ai.aimHead = Math.random() < D.hs;
      ai.errY = G.rand(-D.err, D.err); ai.errP = G.rand(-D.err, D.err) * 0.55;
      aimPoint(e, mask & 2 ? 2 : 1, tv);
      ai.flickY = G.clamp(G.wrapAngle(G.yawTo(dx, dz) - a.yaw) * 0.16, -0.065, 0.065);
      ai.flickP = G.clamp((Math.atan2(tv.y - eye.y, d) - a.pitch) * 0.16, -0.035, 0.035);
      ai.burstLeft = 0;
    }
    ai.target = e; ai.targetVisible = true; ai.danger = danger;
    ai.aimPart = ai.aimHead && (mask & 1) ? 1 : mask & 2 ? 2 : mask & 1 ? 1 : 4;
    aimPoint(e, ai.aimPart, ai.aimPos); ai.aimVel.copy(e.vel);
    ai.lastSeenPos.copy(e.pos); ai.lastSeenT = G.time;
    return true;
  }
  function nearSite(p) {
    for (const k in M.sites) if (G.dist2D(p, M.sites[k].center) < 22) return k;
    return null;
  }
  function threat(site, enemy) {
    const pl = B.plan;
    if (!pl || pl.rotated[site]) return;
    const list = pl.seen[site];
    if (!list.includes(enemy)) list.push(enemy);
    if (list.length >= 2 || G.Game.bomb.carrier === enemy) {
      pl.rotated[site] = true;
      const helpers = G.Game.agents.filter((x) => x.isBot && x.alive && x.team === 'def' && x.ai && x.ai.hold && x.ai.hold.site !== site)
        .sort((x, y) => (x.ai.hold.site === 'M' ? -1 : 0) - (y.ai.hold.site === 'M' ? -1 : 0)).slice(0, 2);
      helpers.forEach((h) => { h.ai.rotateTo = M.randomSiteCell(site); h.ai.rotateSite = site; });
    }
  }

  // ---------- path following ----------
  function steer(a, dest, lookAhead) {
    const ai = a.ai;
    if (!ai.path || ai.goal.distanceToSquared(dest) > 2.25 || G.time > ai.repathT) {
      ai.path = M.findPath(a.pos, dest); ai.pathIdx = 1; ai.goal.copy(dest); ai.repathT = G.time + 4 + Math.random() * 2;
      if (!ai.path) return null;
    }
    while (ai.pathIdx < ai.path.length && G.dist2D(a.pos, ai.path[ai.pathIdx]) < 0.55) ai.pathIdx++;
    if (ai.pathIdx >= ai.path.length) return null;
    const p = ai.path[ai.pathIdx];
    let dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (G.time < ai.unstickUntil) { const ox = dx; dx += -dz * ai.strafe * 0.9; dz += ox * ai.strafe * 0.9; }
    const n = Math.hypot(dx, dz) || 1;
    let yaw = G.yawTo(dx, dz);
    const bend = ai.path[ai.pathIdx + 1];
    if (lookAhead && bend && l <= 5 && G.time >= ai.unstickUntil) {
      if (G.time >= ai.lookAt && angleChecks > 0) {
        angleChecks--; ai.lookAt = G.time + 0.22; ai.lookBase = null;
        ai.lookPoint = routeAngleOpen(a, bend) ? bend : null;
      }
      if (ai.lookPoint === bend) yaw = G.yawTo(bend.x - a.pos.x, bend.z - a.pos.z);
    }
    return { x: dx / n, z: dz / n, yaw };
  }
  function followRoute(a, cmd, dt) {
    const ai = a.ai;
    if (ai.delay > 0) { ai.delay -= dt; return false; }
    if (!ai.route || ai.routeIdx >= ai.route.length) return true;
    const wp = ai.route[ai.routeIdx];
    if (G.dist2D(a.pos, wp) < 1.6) { ai.routeIdx++; return ai.routeIdx >= ai.route.length; }
    cmd.dest = wp;
    cmd.walk = ai.routeIdx === ai.route.length - 1 && !B.plan.contact && G.Game.timeLeft > 35;
    return false;
  }
  const LOOK_OFFSETS = [0, 0.40, -0.40, 0.80, -0.80, 1.3, -1.3];
  function holdAngleOpen(a, yaw) {
    G.eyePos(a, eye); G.forward(yaw, 0, tv).multiplyScalar(7).add(eye);
    return M.clearLine(eye, tv);
  }
  function routeAngleOpen(a, bend) {
    G.eyePos(a, eye);
    const d = G.dist2D(a.pos, bend), fraction = Math.min(1, 8 / (d || 1));
    tv.set(bend.x, bend.y + G.eyeHeight(a.crouch), bend.z).lerpVectors(eye, tv, fraction);
    return M.clearLine(eye, tv);
  }
  // If the cue is behind cover, face the first open leg of its walking route.
  function cueAngle(a, pos) {
    G.eyePos(a, eye); tv.copy(pos); tv.y += 1.35;
    if (M.clearLine(eye, tv)) return { point: pos.clone(), rays: 1, path: 0 };
    const path = M.findPath(a.pos, pos);
    const p = path && path.find((p, i) => i > 0 && G.dist2D(p, a.pos) > 0.7);
    if (!p) return { point: null, rays: 1, path: 1 };
    tv.copy(p); tv.y += G.eyeHeight(a.crouch);
    return { point: M.clearLine(eye, tv) ? p : null, rays: 2, path: 1 };
  }
  function guard(a, cmd, center, rMin, rMax, tag) {
    const ai = a.ai;
    if (!ai.guardPos || ai.guardFor !== tag) {
      ai.guardPos = null;
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * 6.28, r = G.rand(rMin, rMax);
        const c = M.colOf(center.x + Math.cos(ang) * r), rr = M.rowOf(center.z + Math.sin(ang) * r);
        if (M.walkable(c, rr)) {
          const p = M.cellPos(c, rr);
          if (!G.Phys.blocked(p.x, p.y + 0.01, p.z, G.bodyHeight(0) - 0.01)) { ai.guardPos = p; break; }
        }
      }
      if (!ai.guardPos) ai.guardPos = center.clone();
      const site = G.Game.bomb.site || B.plan.site;
      const entry = M.holds.filter((h) => h.site === site || h.site === 'M')
        .reduce((best, h) => G.dist2D(ai.guardPos, h.pos) < G.dist2D(ai.guardPos, best) ? h.pos : best, M.spawns.def[0]);
      ai.guardYaw = G.yawTo(entry.x - ai.guardPos.x, entry.z - ai.guardPos.z);
      ai.guardFor = tag;
    }
    if (G.dist2D(a.pos, ai.guardPos) > 0.8) cmd.dest = ai.guardPos;
    else { cmd.stop = true; cmd.watchYaw = ai.guardYaw + Math.sin(G.time * 0.5 + a.id) * 0.18; }
  }

  // ---------- objectives ----------
  function objective(a, cmd, dt) {
    const ai = a.ai, bomb = G.Game.bomb;
    if (a.team === 'atk') {
      if (bomb.state === 'planted') {
        if (bomb.timer < 7.5) { cmd.dest = M.spawns.atk[0]; return; }   // clear the blast radius
        guard(a, cmd, bomb.pos, 3, 9, 'bomb'); return;
      }
      if (bomb.state === 'dropped') {
        const atk = G.Game.agents.filter((x) => x.isBot && x.alive && x.team === 'atk');
        const nearest = atk.sort((x, y) => G.dist2D(x.pos, bomb.pos) - G.dist2D(y.pos, bomb.pos))[0];
        if (nearest === a) { cmd.dest = bomb.pos; return; }
      }
      const rush = G.Game.timeLeft < 30;
      if (a.inv.bomb) {
        if (rush || followRoute(a, cmd, dt)) {
          if (M.siteAt(a.pos.x, a.pos.z) && G.dist2D(a.pos, ai.siteTarget) < 1.3) { cmd.use = true; cmd.stop = true; }
          else cmd.dest = ai.siteTarget;
        }
        return;
      }
      if (rush || followRoute(a, cmd, dt)) guard(a, cmd, M.sites[B.plan.site].center, 2, 10, 'site');
      return;
    }
    // defenders
    if (bomb.state === 'planted') {
      const need = (a.kit ? 5 : 10) - (a.defusing ? a.defuseT : 0) + (a.defusing ? 0 : G.dist2D(a.pos, bomb.pos) / 5.2 + 0.4);
      if (bomb.timer < need) { cmd.dest = M.spawns.def[0]; return; }   // can't make it: save yourself
      if (G.dist2D(a.pos, bomb.pos) < 1.3 && Math.abs(a.pos.y - bomb.pos.y) < 1) {
        cmd.use = true; cmd.stop = true; cmd.crouch = true;
        cmd.faceYaw = G.yawTo(bomb.pos.x - a.pos.x, bomb.pos.z - a.pos.z); cmd.facePitch = -0.7;
      } else cmd.dest = bomb.pos;
      return;
    }
    if (ai.delay > 0) { ai.delay -= dt; return; }
    if (ai.rotateTo) {
      if (G.dist2D(a.pos, ai.rotateTo) > 1.2) { cmd.dest = ai.rotateTo; return; }
      const hs = M.holds.filter((h) => h.site === ai.rotateSite);
      ai.hold = hs.length ? G.pick(hs) : ai.hold; ai.rotateTo = null;
    }
    const h = ai.hold;
    if (!h) return;
    if (G.dist2D(a.pos, h.pos) > 0.7) cmd.dest = h.pos;
    else { cmd.stop = true; cmd.watchYaw = h.yaw + Math.sin(G.time * 0.45 + a.id * 1.7) * 0.18; }
  }

  // ---------- gunfight ----------
  const MID_RANGE = 12, LONG_RANGE = 28, HITSCAN_RANGE = 220;
  const AIM_TOL = [0.050, 0.035, 0.023];
  function trackingAngles(a, range) {
    const ai = a.ai;
    G.eyePos(a, eye);
    // Extrapolate briefly from the last visible sample, plus a small lead for a moving target.
    const lead = Math.min(G.time - ai.lastSeenT, 0.13) + Math.min(range * 0.001, 0.03);
    tv.copy(ai.aimPos).addScaledVector(ai.aimVel, lead);
    const dx = tv.x - eye.x, dz = tv.z - eye.z;
    const age = (G.time - ai.sightAt) / 0.065;
    const overshoot = age * Math.exp(1 - age);
    return { yaw: G.yawTo(dx, dz) + ai.errY + ai.flickY * overshoot,
      pitch: Math.atan2(tv.y - eye.y, Math.hypot(dx, dz)) + ai.errP + ai.flickP * overshoot };
  }

  const shotDir = new THREE.Vector3(), shotEnd = new THREE.Vector3();
  function teammateInLine(a, dir, range, spread) {
    const horizontal = Math.hypot(dir.x, dir.z);
    const reach = range * horizontal;
    for (const mate of G.Game.agents) {
      if (mate === a || !mate.alive || mate.team !== a.team) continue;
      const dx = mate.pos.x - eye.x, dz = mate.pos.z - eye.z;
      const forward = (dx * dir.x + dz * dir.z) / (horizontal || 1);
      if (forward < -0.35 || forward > reach + 0.4) continue;
      const h = W.hitboxes(mate, box);
      const radius = Math.max(0.27, Math.hypot(h.headX - h.x, h.headZ - h.z) + 0.15);
      const top = Math.max(h.headY + 0.15, h.bodyTop);
      if (horizontal < 0.001) {
        const endY = eye.y + dir.y * range, pad = Math.abs((mate.pos.y + top) / 2 - eye.y) * spread;
        if (Math.hypot(dx, dz) <= radius + pad && Math.max(eye.y, endY) >= mate.pos.y && Math.min(eye.y, endY) <= top) return true;
        continue;
      }
      const side = Math.abs(dx * dir.z - dz * dir.x) / horizontal;
      const pad = 0.07 + Math.max(0, forward) * spread / (horizontal * horizontal);
      const y = eye.y + forward * dir.y / horizontal, rise = pad + radius * Math.abs(dir.y) / horizontal;
      if (side <= radius + pad && y + rise >= mate.pos.y && y - rise <= top) return true;
    }
    return false;
  }
  function firingRecoil(a, it) {
    if (!a.shots || a.recoilItem !== it) return 0;
    // Match W.update's recovery at the instant it will trace the shot.
    const d = it.def, interval = 60 / d.rpm;
    const hold = d.auto ? interval + 0.05 : 0.025, end = d.auto || d.slot !== 'pistol' ? 0.46 : interval;
    const remain = G.clamp((end - (G.time - a.lastShot)) / (end - hold), 0, 1);
    return remain * remain * (3 - 2 * remain) * (1 - a.recoilComp);
  }
  function combat(a, cmd, it, dt) {
    const ai = a.ai, d = it && it.def;
    if (!d || cmd.use || G.Game.frozen || a.planting || a.defusing || a.blindUntil > G.time || G.time < a.switchEnd || d.slot === 'grenade') return;
    const fighting = ai.targetVisible && ai.target.alive && G.time - ai.lastSeenT <= SIGHT_AGE && it === cmd.weapon;
    const range = cmd.range, yawError = Math.abs(G.wrapAngle(a.yaw - cmd.faceYaw)), pitchError = Math.abs(a.pitch - cmd.facePitch);
    const steady = a.onGround && Math.hypot(a.vel.x, a.vel.z) <= W.maxSpeed(a) * 0.30;
    if (d.scope && !it.zoom && !it.reloading && it.clip && steady && G.time >= it.nextFire && G.time >= ai.repositionUntil &&
        ((fighting && yawError < 0.22 && pitchError < 0.22) || (!fighting && !cmd.dest && cmd.faceYaw !== null && yawError < 0.15))) {
      cmd.altPressed = true;
      ai.scopeReady = G.time + (fighting && range <= MID_RANGE ? 0.10 : 0.17);
    }
    if (!fighting || G.time < ai.reactUntil || G.time < ai.pauseUntil || G.time < it.nextFire) return;
    if (!d.melee && it.clip === 0) { cmd.reload = it.reserve > 0; return; }
    if ((it.reloading && !d.shell) || (d.scope && (!it.zoom || G.time < ai.scopeReady)) ||
        ((range > MID_RANGE || d.scope) && !steady) || (d.melee && range >= d.range)) return;
    const tol = Math.max(AIM_TOL[level], Math.atan2(0.32, range));
    if (yawError > tol || pitchError > tol || shotChecks <= 0) return;
    G.eyePos(a, eye);
    const recoil = d.melee ? 0 : firingRecoil(a, it);
    const spread = d.melee ? 0 : W.spread(a, it) + a.aimNoise - a.inacc * (1 - Math.exp(-dt * d.inacc.rec));
    aimPoint(ai.target, ai.aimPart, tv);
    const depth = G.dist2D(eye, tv), length = Math.hypot(depth, tv.y - eye.y);
    // Use the weapon's low body hold for the easier tiers, including in the safety check.
    ai.bodyCeiling = !d.melee && !d.scope && level < 2 && ai.aimPart === 2 ? Math.atan2(box.bodyTop - 0.08 - eye.y, depth + 0.25) : null;
    const pitchKick = a.recoilFromP * recoil || 0, yawKick = a.recoilFromY * recoil || 0;
    const pitch = ai.bodyCeiling === null ? a.pitch + pitchKick : Math.min(a.pitch - pitchKick, ai.bodyCeiling - spread);
    G.forward(a.yaw + yawKick, pitch, shotDir);
    if (teammateInLine(a, shotDir, d.melee ? d.range : HITSCAN_RANGE, spread + 0.004)) return;
    shotEnd.copy(eye).addScaledVector(shotDir, length);
    if (G.Nades.blocks(eye, shotEnd)) return;
    shotChecks--;
    if (!G.Nades.visible(eye, tv)) { ai.targetVisible = false; return; }
    cmd.fire = d.auto || d.melee; cmd.firePressed = !cmd.fire;
  }

  // Check the actual bounced landing point before committing a teammate's utility.
  const flight={pos:new THREE.Vector3(),vel:new THREE.Vector3()}, velocity=new THREE.Vector3();
  function useGrenade(a) {
    const ai=a.ai, bomb=G.Game.bomb;
    if (ai.throwId && (a.blindUntil>G.time || !a.nades[ai.throwId] || G.Game.phase!=='live')) {
      ai.throwId=null; W.switchTo(a,W.bestSlot(a)); return;
    }
    if (G.Game.phase!=='live' || G.time<ai.grenadeAt || !a.inv.grenade || a.planting || a.defusing || a.blindUntil>G.time) return;
    ai.grenadeAt=G.time+G.rand(1,2.4)/(1+level*.4);
    if (level === 0 && !ai.throwId) {
      ai.grenadeAt = G.time + G.rand(10, 16);
      if (Math.random() > 0.18) return;
    }
    const known=G.time-ai.lastSeenT<4 ? ai.lastSeenPos : ai.alertT>G.time ? ai.alertPos : null;
    const site=B.plan && a.team==='atk' ? M.sites[B.plan.site].center : bomb.state==='planted' ? bomb.pos : null;
    let goal=known, id;
    if (ai.throwId) { id=ai.throwId; goal=ai.throwGoal; ai.throwId=null; }
    else if (site && a.nades.smoke && G.dist2D(a.pos,site)<24) { id='smoke'; goal=site; }
    else if (known) {
      const fire=a.team==='atk' ? 'molotov' : 'incendiary';
      if (a.nades.flash && a.team==='atk' && ai.targetVisible) id='flash';
      else id=a.nades[fire] ? fire : a.nades.he ? 'he' : a.nades.flash ? 'flash' : null;
    }
    if (!id || !goal) return;
    const distance=G.dist2D(a.pos,goal);
    if (distance<6 || distance>26) return;
    G.eyePos(a,eye);
    const t=G.clamp(distance/15,.65,1.35);
    velocity.set((goal.x-eye.x)/t,(goal.y+.15-eye.y)/t+7*t,(goal.z-eye.z)/t);
    flight.pos.copy(eye); flight.vel.copy(velocity); flight.rest=flight.groundHit=false;
    const fire=id==='incendiary' || id==='molotov';
    for (let i=0;i<(id==='he' || id==='flash' ? 144 : 180);i++) {
      G.Nades.step(flight);
      if (flight.rest || (fire && flight.groundHit)) break;
    }
    if (G.dist2D(flight.pos,goal)>5 || G.dist2D(flight.pos,a.pos)<5) return;
    for (const mate of G.Game.agents) {
      if (mate===a || !mate.alive || mate.team!==a.team) continue;
      const radius=id==='smoke' ? 2 : id==='he' ? 8.5 : id==='flash' ? 10 : 4.5;
      if (G.dist2D(mate.pos,flight.pos)<radius || G.dist2D(mate.pos,goal)<radius) return;
    }
    if (a.cur!=='grenade') {
      ai.throwId=id; ai.throwGoal.copy(goal); ai.grenadeAt=G.time+.62;
      a.inv.grenade=W.item(id); W.switchTo(a,'grenade');
      return;
    }
    if (G.Nades.throw(a,id,eye,velocity)) {
      if (a.cur==='grenade') W.switchTo(a,W.bestSlot(a));
      ai.grenadeAt=G.time+G.rand(8,16)/(1+level*.35);
      a.switchEnd=G.time+.65;
    }
  }

  // ---------- main update ----------
  const SLOT_ORDER = ['primary', 'pistol', 'knife'];
  function roam(a) {
    const ai = a.ai;
    if (ai.roamUntil > G.time && G.dist2D(a.pos, ai.roam) > 2) return ai.roam;
    for (let i = 0; i < 16; i++) {
      const c = Math.floor(Math.random() * M.W), r = Math.floor(Math.random() * M.H);
      if (!M.walkable(c, r)) continue;
      const p = M.cellPos(c, r, ai.roam);
      if (G.dist2D(a.pos, p) < 14 || G.Phys.blocked(p.x, p.y + 0.01, p.z, G.bodyHeight(0) - 0.01)) continue;
      ai.roamUntil = G.time + 12;
      return p;
    }
    ai.roamUntil = 0;
    return null;
  }
  function think(a, dt) {
    const ai = a.ai;
    if (!ai) return;
    const blind = a.blindUntil>G.time;
    if (blind) { ai.target = null; ai.targetVisible = ai.cueValid = false; ai.alertT = ai.lastSeenT = -99; }
    if (ai.target && (!ai.target.alive || G.time - ai.lastSeenT > SIGHT_AGE)) ai.targetVisible = false;
    const cmd = { dest: null, walk: false, crouch: false, faceYaw: null, facePitch: 0, watchYaw: null,
      fire: false, firePressed: false, altPressed: false, reload: false, use: false, strafe: 0, stop: false, brake: false, fast: false };
    if (a.cur === 'primary' && ai.targetVisible && G.dist2D(a.pos, ai.lastSeenPos) <= MID_RANGE &&
        a.inv.primary && !a.inv.primary.clip && a.inv.pistol && a.inv.pistol.clip && G.time >= a.switchEnd) {
      ai.sidearm = W.switchTo(a, 'pistol'); ai.burstLeft = 0;
    } else if (a.cur === 'pistol' && ai.sidearm && !ai.targetVisible && G.time - ai.lastSeenT > MEMORY && G.time >= a.switchEnd) {
      ai.sidearm = false;
      if (a.inv.primary && a.inv.primary.clip + a.inv.primary.reserve > 0) W.switchTo(a, 'primary');
    }
    if (ai.target && ai.targetVisible) {
      const it = W.current(a), d = it && it.def, range = G.dist2D(a.pos, ai.aimPos);
      const settle = Math.exp(-dt * D.track);
      ai.errY *= settle; ai.errP *= settle;
      const angles = trackingAngles(a, range);
      cmd.faceYaw = angles.yaw; cmd.facePitch = angles.pitch;
      cmd.fast = true; cmd.weapon = it; cmd.range = range;
      a.aimNoise = (D.noise + D.bloom * a.inacc) * (1 + (level === 0 ? G.clamp((range - 12) / 30, 0, 0.55) : 0));
      if (d && d.melee) cmd.dest = ai.lastSeenPos;
      else if (d && d.slot !== 'grenade') {
        cmd.brake = (range > MID_RANGE || d.scope) && G.time >= ai.reactUntil - 0.16 && G.time >= ai.repositionUntil;
        if (cmd.brake) cmd.stop = true;
        else {
          ai.strafeT -= dt;
          if (ai.strafeT <= 0) { ai.strafe = G.pick([-1, 1, 1, -1, 0]); ai.strafeT = G.rand(0.25, 0.7); }
          cmd.strafe = G.time < ai.repositionUntil ? ai.strafe || 1 : ai.strafe;
          cmd.walk = range <= MID_RANGE && !d.scope;
        }
      }
    } else {
      const recent = G.time - ai.lastSeenT < MEMORY;
      const heard = ai.alertT > G.time && (!recent || ai.alertAt > ai.lastSeenT);
      const cue = heard ? ai.alertPos : recent ? ai.lastSeenPos : null;
      if (G.Game.mode === 'practice') cmd.dest = heard && G.dist2D(a.pos, cue) > 3 ? cue : roam(a);
      else objective(a, cmd, dt);
      if (!recent) ai.target = null;
      if (!cue) { ai.cueValid = false; ai.cuePoint = null; }
      const it = W.current(a);
      const repositioning = it && it.def.scope && G.time < ai.repositionUntil && !cmd.use;
      if (cue && !cmd.use) {
        const moved = !ai.cueValid || ai.cueGoal.distanceToSquared(cue) > 0.64 || ai.cueFrom.distanceToSquared(a.pos) > 2.25;
        if (moved && angleChecks >= 2 && cuePaths > 0 && G.time >= ai.lookAt) {
          const angle = cueAngle(a, cue);
          ai.lookAt = G.time + 0.22; angleChecks -= angle.rays; cuePaths -= angle.path;
          ai.cuePoint = angle.point; ai.cueGoal.copy(cue); ai.cueFrom.copy(a.pos); ai.cueValid = true;
        }
        const p = ai.cuePoint, distance = p && G.dist2D(a.pos, p);
        if (distance > 0.5) {
          cmd.faceYaw = G.yawTo(p.x - a.pos.x, p.z - a.pos.z); cmd.facePitch = Math.atan2(p.y - a.pos.y, distance);
          if (recent && !heard && !repositioning) { cmd.dest = null; cmd.stop = true; }
        }
      }
      if (repositioning && !cmd.dest) { cmd.stop = false; cmd.strafe = ai.strafe; }
      if (it && it.def.scope && cmd.dest) it.zoom = 0;
      if (!cmd.use && !blind && it && it.clip <= it.def.clip * 0.35 && it.reserve > 0 && G.time - ai.lastSeenT > 0.45) cmd.reload = true;
    }
    if (!cmd.use || ai.throwId) useGrenade(a);
    if (a.cur==='grenade' && !ai.throwId) W.switchTo(a,W.bestSlot(a));
    // weapon choice
    const it = W.current(a);
    const empty = it && !it.def.melee && it.clip === 0 && it.reserve === 0;
    if (!cmd.use && (a.cur === 'bomb' || a.cur === 'knife' || (empty && !ai.throwId)) && G.time >= a.switchEnd) {
      const best = SLOT_ORDER.find((s) => a.inv[s] && (s === 'knife' || a.inv[s].clip + a.inv[s].reserve > 0));
      if (best && best !== a.cur) { W.switchTo(a, best); ai.burstLeft = 0; }
    }
    // movement
    let wx = 0, wz = 0, routeYaw = null;
    const frozen = G.Game.frozen || a.planting || a.defusing;
    if (!frozen && !cmd.stop) {
      if (cmd.dest) {
        const s = steer(a, cmd.dest, cmd.faceYaw === null);
        if (s) { wx = s.x; wz = s.z; routeYaw = s.yaw; }
      }
      else if (cmd.strafe) { wx = Math.cos(a.yaw) * cmd.strafe; wz = -Math.sin(a.yaw) * cmd.strafe; }
    }
    // keep a little space from teammates
    for (const o of G.Game.agents) {
      if (frozen || cmd.brake || o === a || !o.alive) continue;
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 0.001) { wx += dx / d * 0.6; wz += dz / d * 0.6; }
    }
    if (!frozen && G.Nades.fires.length) {
      const hot = G.Nades.hot(a.pos) || G.Nades.hot(tv.set(a.pos.x+wx*1.5,a.pos.y,a.pos.z+wz*1.5));
      if (hot) {
        const x=a.pos.x-hot.pos.x, z=a.pos.z-hot.pos.z, d=Math.hypot(x,z);
        wx=d>.05 ? x/d : 1; wz=d>.05 ? z/d : 0;
        if (G.Phys.blocked(a.pos.x+wx*.6,a.pos.y+.02,a.pos.z+wz*.6,1.4)) { const t=wx; wx=-wz; wz=t; }
        cmd.walk=cmd.crouch=cmd.use=false;
        cmd.brake = false; routeYaw = null;
      }
    }
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    a.crouchWant = cmd.crouch; a.walking = cmd.walk;
    const speed = W.maxSpeed(a) * (cmd.walk ? 0.52 : 1) * G.lerp(1, 0.34, a.crouch) * (G.time < a.slowUntil ? 0.55 : 1);
    G.Phys.step(a, wx, wz, wl > 0.05 ? speed : 0, false, dt, cmd.brake);
    if (a.landed) {
      G.HUD.soundMarker(a, a.pos, 'step');
      G.Audio.land(a.pos, false, G.Map.surfaceAt(a.pos.x, a.pos.y, a.pos.z), { mate: teammate(a), id: a.id });
      a.landed = 0;
    }
    // facing
    let fy = cmd.faceYaw, fp = cmd.facePitch;
    if (fy === null && cmd.watchYaw !== null) {
      if (ai.lookBase === null || Math.abs(G.wrapAngle(cmd.watchYaw - ai.lookBase)) > 0.25) {
        ai.lookBase = cmd.watchYaw; ai.lookTry = 0; ai.lookYaw = null;
      }
      if (G.time >= ai.lookAt && angleChecks > 0) {
        angleChecks--; ai.lookAt = G.time + 0.22;
        const yaw = ai.lookYaw === null ? ai.lookBase + LOOK_OFFSETS[ai.lookTry] : ai.lookYaw;
        if (holdAngleOpen(a, yaw)) { ai.lookYaw = yaw; ai.lookTry = 0; ai.lookAt = G.time + 0.65; }
        else { ai.lookYaw = null; ai.lookTry = (ai.lookTry + 1) % LOOK_OFFSETS.length; }
      }
      fy = cmd.faceYaw = ai.lookYaw;
    }
    if (fy === null) fy = wl > 0.1 ? routeYaw ?? G.yawTo(wx, wz) : a.yaw;
    const rate = cmd.fast ? D.turn : 5;
    a.yaw = G.wrapAngle(a.yaw + G.wrapAngle(fy - a.yaw) * (1 - Math.exp(-dt * rate)));
    a.pitch += (fp - a.pitch) * (1 - Math.exp(-dt * rate));
    // stuck detection
    ai.stuckCheck -= dt;
    if (ai.stuckCheck <= 0) {
      ai.stuckCheck = 1;
      if (wl > 0.3 && G.dist2D(a.pos, ai.lastPos) < 0.35) { ai.path = null; ai.strafe = G.pick([-1, 1]); ai.unstickUntil = G.time + 0.7; }
      ai.lastPos.copy(a.pos);
    }
    // footsteps: the sound plays where a foot lands in the walk cycle (onStep below); the bots' hearing runs on
    // this fixed stride, and so does the sound of a soldier you watch in first person (no body drawn)
    if (G.Game.loudSteps(a)) {
      ai.stepDist += Math.hypot(a.vel.x, a.vel.z) * dt;
      if (ai.stepDist > 2.1) {
        ai.stepDist = 0; B.hearStep(a);
        if (!a.rig || a.rig.hidden) {
          ai.stepFoot = 1 - (ai.stepFoot | 0);
          G.Audio.step(a.pos, G.Map.surfaceAt(a.pos.x, a.pos.y, a.pos.z), ai.stepFoot,
            { local: !!(a.rig && a.rig.hidden), mate: teammate(a), id: a.id });
        }
      }
    }
    const weapon = W.current(a), lastShot = a.lastShot;
    if (weapon !== it) cmd.reload = false;
    combat(a, cmd, weapon, dt);
    W.update(a, dt, cmd);
    if (a.lastShot !== lastShot) {
      if (G.time - lastShot > 0.46) ai.burstLeft = 0;
      const d = weapon.def, range = cmd.range;
      if (d.scope) {
        weapon.rezoom = 0;
        ai.repositionUntil = G.time + 0.40;
        ai.strafe = ai.strafe === 1 ? -1 : 1; ai.strafeT = 0.40;
      } else if (d.auto) {
        if (!ai.burstLeft) ai.burstLeft = range > LONG_RANGE ? G.randi(1, 2) : range > MID_RANGE ? G.randi(3, 5) : G.randi(7, 10);
        if (--ai.burstLeft === 0) ai.pauseUntil = G.time + (range > LONG_RANGE ? 0.48 : range > MID_RANGE ? 0.32 : 0.23);
      } else ai.pauseUntil = G.time + (range > LONG_RANGE ? 0.38 : range > MID_RANGE ? 0.22 : 0.06);
    }
    G.Game.handleUse(a, cmd.use, dt);
    if (G.Game.mode !== 'practice') W.tryPickup(a);
  }

  const teammate = (a) => { const me = G.Player.agent; return !!me && me.team === a.team; };
  // called by the walk cycle (soldier.js) each time a foot lands
  B.onStep = function (a, foot, pos) {
    if (a.isPlayer || !G.Game.loudSteps(a)) return;
    G.Audio.step(pos, G.Map.surfaceAt(pos.x, pos.y, pos.z), foot, { mate: teammate(a), id: a.id });
  };

  B.update = function (dt) {
    const agents = G.Game.agents, active = !(G.Game.mode === 'practice' && G.Game.frozen);
    angleChecks = 6; shotChecks = 10; cuePaths = 1;
    // At most four three-ray samples. Rotate the first slot so busy frames can't starve a bot.
    if (active) {
      for (const a of agents) if (a.isBot && a.alive && a.ai) a.ai.visT -= dt;
      let samples = 4, i = 0;
      for (; i < agents.length && samples > 0; i++) {
        const a = agents[(sightCursor + i) % agents.length];
        if (!a.isBot || !a.alive || !a.ai || a.ai.visT > 1e-6 || a.blindUntil > G.time) continue;
        a.ai.visT = SIGHT_INTERVAL;
        if (perceive(a, agents)) samples--;
      }
      if (agents.length) sightCursor = (sightCursor + (i === agents.length ? 1 : i)) % agents.length;
    }
    for (const a of agents) {
      if (a.isBot && a.alive && active) think(a, dt);
      G.BotModel.update(a, dt);   // every body, the player's too (it becomes a ragdoll on death)
    }
    G.BotModel.updateBlobs();
  };
})(window.G);
