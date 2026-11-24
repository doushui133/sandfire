// bots.js — bot perception, tactics (routes, holds, rotations, plant/defuse) and gunfights
(function (G) {
  'use strict';
  const THREE = G.THREE, M = G.Map, W = G.Weapons;
  const B = G.Bots = { plan: null };
  const DIFF = [
    { react: [0.90, 1.30], err: 0.10, track: 1.8, turn: 5, comp: 0.22, fov: 1.5, hs: 0.035, noise: 0.039, bloom: 0 },
    { react: [0.55, 0.80], err: 0.065, track: 2.8, turn: 6.1, comp: 0.34, fov: 1.75, hs: 0.075, noise: 0.021, bloom: 0.45 },
    { react: [0.30, 0.48], err: 0.045, track: 7, turn: 7.7, comp: 0.07, fov: 1.85, hs: 0.27, noise: 0.020, bloom: 0 },
  ];
  let level = 1, D = DIFF[1];
  const eye = new THREE.Vector3(), tv = new THREE.Vector3();
  B.setDifficulty = (i) => { level = DIFF[i] ? i : 1; D = DIFF[level]; };

  function freshAI() {
    return {
      grenadeAt:G.time + G.rand(6,11), throwGoal:new THREE.Vector3(), throwId:null, mode: 'idle', path: null, pathIdx: 0, goal: new THREE.Vector3(1e9, 0, 0), repathT: 0, route: null, routeIdx: 0, siteTarget: null,
      target: null, targetVisible: false, reactUntil: 0, errY: 0, errP: 0, aimHead: false, lastSeenPos: new THREE.Vector3(), lastSeenT: -99,
      alertPos: new THREE.Vector3(), alertT: -99, strafe: 0, strafeT: 0, stuckCheck: 1, lastPos: new THREE.Vector3(), unstickUntil: 0,
      visT: Math.random() * 0.1, burstLeft: 0, burstShots: 0, prevShotT: -1, pauseUntil: 0, guardPos: null, guardYaw: 0, guardFor: null,
      delay: 0, crouchPref: false, crouchT: 0, hold: null, rotateTo: null, stepDist: 0,
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
    if (!a.ai || a.ai.targetVisible) return;
    a.ai.alertPos.copy(pos); a.ai.alertT = G.time + dur;
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
    if (!v.isBot || !v.ai || !attacker) return;
    alert(v, attacker.pos, 3); v.ai.visT = 0;
  };

  // ---------- perception ----------
  function perceive(a) {
    const ai = a.ai;
    G.eyePos(a, eye);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), cosF = Math.cos(D.fov / 2);
    let best = null, bestD = 1e9;
    for (const e of G.Game.agents) {
      if (!e.alive || e.team === a.team) continue;
      const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 95) continue;
      const inFov = (dx * fx + dz * fz) / (d || 1) > cosF || d < 2.5 || ai.target === e || (ai.alertT > G.time && G.dist2D(ai.alertPos, e.pos) < 6);
      if (!inFov) continue;
      const h = W.hitboxes(e);
      let vis = G.Nades.visible(eye, tv.set(h.headX, h.headY, h.headZ));
      if (!vis) vis = G.Nades.visible(eye, tv.set(e.pos.x, (h.legTop + h.bodyTop) / 2, e.pos.z));
      if (!vis && d < 40) vis = G.Nades.visible(eye, tv.set(e.pos.x, e.pos.y + 0.4, e.pos.z));
      if (vis && d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      if (ai.target !== best || !ai.targetVisible) {
        ai.reactUntil = G.time + G.rand(D.react[0], D.react[1]);
        ai.aimHead = Math.random() < D.hs;
        const e = D.err * (1 + bestD / 35);
        ai.errY = G.rand(-e, e); ai.errP = G.rand(-e, e) * 0.6;
        ai.burstLeft = 0; ai.burstShots = 0;
      }
      ai.target = best; ai.targetVisible = true; ai.lastSeenPos.copy(best.pos); ai.lastSeenT = G.time;
      if (G.Player.agent && a.team === G.Player.agent.team) best.spottedUntil = G.time + 1.2;
      if (G.Game.mode !== 'practice') {
        if (a.team === 'atk') B.plan.contact = true;
        const site = M.siteAt(best.pos.x, best.pos.z) || nearSite(best.pos);
        if (site && a.team === 'def') threat(site, best);
      }
    } else ai.targetVisible = false;
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
  function steer(a, dest) {
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
    return { x: dx / n, z: dz / n };
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
  function guard(a, cmd, center, rMin, rMax, tag) {
    const ai = a.ai;
    if (!ai.guardPos || ai.guardFor !== tag) {
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * 6.28, r = G.rand(rMin, rMax);
        const c = M.colOf(center.x + Math.cos(ang) * r), rr = M.rowOf(center.z + Math.sin(ang) * r);
        if (M.walkable(c, rr)) { ai.guardPos = M.cellPos(c, rr); break; }
      }
      if (!ai.guardPos) ai.guardPos = center.clone();
      ai.guardYaw = G.yawTo(ai.guardPos.x - center.x, ai.guardPos.z - center.z);
      ai.guardFor = tag;
    }
    if (G.dist2D(a.pos, ai.guardPos) > 0.8) cmd.dest = ai.guardPos;
    else { cmd.stop = true; cmd.faceYaw = ai.guardYaw + Math.sin(G.time * 0.5 + a.id) * 0.6; cmd.facePitch = 0; }
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
        cmd.faceYaw = G.yawTo(bomb.pos.x - a.pos.x, bomb.pos.z - a.pos.z) || a.yaw; cmd.facePitch = -0.7;
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
    else { cmd.stop = true; cmd.faceYaw = h.yaw + Math.sin(G.time * 0.45 + a.id * 1.7) * 0.4; cmd.facePitch = 0; }
  }

  // ---------- gunfight ----------
  function combat(a, cmd, dt) {
    const ai = a.ai, e = ai.target, h = W.hitboxes(e), it = W.current(a);
    G.eyePos(a, eye);
    const torso = (h.legTop + h.bodyTop) / 2 + (level < 2 ? -0.12 : 0.14);
    const ay = ai.aimHead ? h.headY - 0.03 : torso;
    // aim at the animated head when going for it (the hit sphere follows the model's head)
    const tx = ai.aimHead ? h.headX : e.pos.x, tz = ai.aimHead ? h.headZ : e.pos.z;
    const dx = tx - eye.x, dz = tz - eye.z, dist = Math.hypot(dx, dz), dy = ay - eye.y;
    a.aimNoise = (D.noise + D.bloom * a.inacc) * (1 + (level === 0 ? G.clamp((dist - 12) / 20, 0, 0.75) : 0));
    // Lower tiers favour a low hold. Leave room for the weapon's full spread
    // below shoulder height, even as automatic fire climbs.
    ai.bodyCeiling = level < 2 && !ai.aimHead ? Math.atan2(h.bodyTop - 0.08 - eye.y, dist + 0.25) : null;
    if (!G.Nades.visible(eye,tv.set(tx,ay,tz))) { ai.targetVisible=false; return; }
    // Keep the initial sighting error until the bot reacts, then settle over the burst.
    if (G.time >= ai.reactUntil || level === 2) {
      const settle = Math.exp(-dt * D.track);
      ai.errY *= settle; ai.errP *= settle;
    }
    const trueYaw = G.yawTo(dx, dz), truePitch = Math.atan2(dy, dist);
    cmd.faceYaw = trueYaw + ai.errY; cmd.facePitch = truePitch + ai.errP; cmd.fast = true;
    const tol = Math.max(level < 2 ? 0.065 : 0.03, Math.atan2(0.3, dist)) * 1.4;
    const onTarget = Math.abs(G.wrapAngle(a.yaw - cmd.faceYaw)) < tol && Math.abs(a.pitch - cmd.facePitch) < tol + 0.04;
    const ready = G.time >= ai.reactUntil && onTarget && G.time >= ai.pauseUntil && !G.Game.frozen;
    if (a.lastShot !== ai.prevShotT) { ai.prevShotT = a.lastShot; ai.burstShots++; }
    if (it && it.def.slot==='grenade') return;
    if (it && !it.def.melee) {
      const d = it.def;
      if (d.scope && it.zoom === 0 && !it.rezoom && dist > 5 && G.time >= it.nextFire) cmd.altPressed = true;
      if (ready) {
        if (d.auto) {
          if (ai.burstLeft <= 0) {
            // Elite bots keep medium-range bursts ahead of the steep part of the spray.
            const mediumBurst = level === 2 ? 3 : 6;
            ai.burstLeft = dist > 28 ? G.randi(1, 2) : dist > 12 ? G.randi(3, mediumBurst) : G.randi(6, 10);
            ai.burstShots = 0;
          }
          cmd.fire = true;
          if (ai.burstShots >= ai.burstLeft) { ai.pauseUntil = G.time + (dist > 28 ? 0.38 : 0.25); ai.burstLeft = 0; cmd.fire = false; }
        } else if (G.time >= it.nextFire && (!d.scope || it.zoom > 0 || dist < 5)) {
          cmd.firePressed = true;   // pace pistol taps at range so the spread can settle
          if (!d.scope) ai.pauseUntil = G.time + (dist > 22 ? 0.38 : dist > 11 ? 0.2 : 0.04);
        }
      }
      const rifle = d.model === 'ar' || d.model === 'tr' || d.model === 'sniper' || d.model === 'heavy' || d.model === 'box';
      if (rifle && (cmd.fire || cmd.firePressed || (ready && G.time - a.lastShot < 0.3))) cmd.stop = true;
      else {
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafe = G.pick([-1, 1, 1, -1, 0]); ai.strafeT = G.rand(0.25, 0.7); }
        cmd.strafe = ai.strafe;
        cmd.walk = !rifle && (cmd.fire || cmd.firePressed);
      }
      if (dist > 18 && rifle && cmd.fire) {
        if (G.time > ai.crouchT) { ai.crouchPref = Math.random() < 0.35; ai.crouchT = G.time + 2; }
        cmd.crouch = ai.crouchPref;
      }
    } else {
      cmd.dest = e.pos; cmd.fire = ready && dist < 1.8;   // knife fight
    }
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
    if (ai.alertT > G.time && G.dist2D(a.pos, ai.alertPos) > 3) return ai.alertPos;
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
    ai.visT -= dt;
    const blind = a.blindUntil>G.time;
    if (blind) { ai.target=null; ai.targetVisible=false; ai.alertT=ai.lastSeenT=-99; }
    else if (ai.visT <= 0) { ai.visT = 0.1 + Math.random() * 0.06; perceive(a); }
    const cmd = { dest: null, walk: false, crouch: false, faceYaw: null, facePitch: 0, fire: false, firePressed: false, altPressed: false, reload: false, use: false, strafe: 0, stop: false, fast: false };
    if (ai.target && !ai.target.alive) { ai.target = null; ai.targetVisible = false; }
    if (ai.target && ai.targetVisible) combat(a, cmd, dt);
    else {
      if (G.Game.mode === 'practice') cmd.dest = roam(a);
      else objective(a, cmd, dt);
      if (ai.target && G.time - ai.lastSeenT < 1.6) {
        cmd.faceYaw = G.yawTo(ai.lastSeenPos.x - a.pos.x, ai.lastSeenPos.z - a.pos.z); cmd.facePitch = 0;
        if (!cmd.use) { cmd.dest = null; cmd.stop = true; }
      } else {
        if (ai.target) ai.target = null;
        if (ai.alertT > G.time && !cmd.use) { cmd.faceYaw = G.yawTo(ai.alertPos.x - a.pos.x, ai.alertPos.z - a.pos.z); cmd.facePitch = 0; }
        const it = W.current(a);
        if (it && !it.def.melee && it.clip < it.def.clip * 0.5 && it.reserve > 0 && G.time - ai.lastSeenT > 2.5) cmd.reload = true;
      }
    }
    if (!cmd.use || ai.throwId) useGrenade(a);
    if (a.cur==='grenade' && !ai.throwId) W.switchTo(a,W.bestSlot(a));
    // weapon choice
    const it = W.current(a);
    const empty = it && !it.def.melee && it.clip === 0 && it.reserve === 0;
    if (!cmd.use && (a.cur === 'bomb' || a.cur === 'knife' || (empty && !ai.throwId)) && G.time >= a.switchEnd) {
      const best = SLOT_ORDER.find((s) => a.inv[s] && (s === 'knife' || a.inv[s].clip + a.inv[s].reserve > 0));
      if (best && best !== a.cur) W.switchTo(a, best);
    }
    // movement
    let wx = 0, wz = 0;
    const frozen = G.Game.frozen || a.planting || a.defusing;
    if (!frozen && !cmd.stop) {
      if (cmd.dest) { const s = steer(a, cmd.dest); if (s) { wx = s.x; wz = s.z; } }
      else if (cmd.strafe) { wx = Math.cos(a.yaw) * cmd.strafe; wz = -Math.sin(a.yaw) * cmd.strafe; }
    }
    // keep a little space from teammates
    for (const o of G.Game.agents) {
      if (o === a || !o.alive) continue;
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
      }
    }
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    a.crouchWant = cmd.crouch; a.walking = cmd.walk;
    const speed = W.maxSpeed(a) * (cmd.walk ? 0.52 : 1) * G.lerp(1, 0.34, a.crouch) * (G.time < a.slowUntil ? 0.55 : 1);
    G.Phys.step(a, wx, wz, wl > 0.05 ? speed : 0, false, dt);
    if (a.landed) {
      G.HUD.soundMarker(a, a.pos, 'step');
      G.Audio.land(a.pos, false, G.Map.surfaceAt(a.pos.x, a.pos.y, a.pos.z), { mate: teammate(a), id: a.id });
      a.landed = 0;
    }
    // facing
    let fy = cmd.faceYaw, fp = cmd.facePitch;
    if (fy === null || fy === undefined) { if (wl > 0.1) { fy = G.yawTo(wx, wz); fp = 0; } else { fy = a.yaw; fp = 0; } }
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
    W.update(a, dt, { fire: cmd.fire, firePressed: cmd.firePressed, alt: false, altPressed: cmd.altPressed, reload: cmd.reload });
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
    for (const a of G.Game.agents) {
      if (a.isBot && a.alive && !(G.Game.mode === 'practice' && G.Game.frozen)) think(a, dt);
      G.BotModel.update(a, dt);   // every body, the player's too (it becomes a ragdoll on death)
    }
    G.BotModel.updateBlobs();
  };
})(window.G);
