// player.js — shared movement physics (player + bots) and the local player controller
(function (G) {
  'use strict';
  const THREE = G.THREE, M = G.Map;
  const GRAV = 20, STEP = 0.45, JUMP_V = 6.9, R = 0.3;
  const Ph = G.Phys = { R };

  function overlaps(b, x, y, z, h) {
    return b.x0 < x + R && b.x1 > x - R && b.z0 < z + R && b.z1 > z - R && b.y0 < y + h && b.y1 > y;
  }
  Ph.blocked = function (x, y, z, h) {
    const list = M.query(x - R - 0.05, z - R - 0.05, x + R + 0.05, z + R + 0.05);
    for (let i = 0; i < list.length; i++) if (overlaps(list[i], x, y, z, h)) return true;
    return false;
  };
  function moveAxis(a, axis, d, h) {
    if (!d) return;
    const p = a.pos;
    if (axis === 0) p.x += d; else p.z += d;
    const list = M.query(p.x - R - 0.05, p.z - R - 0.05, p.x + R + 0.05, p.z + R + 0.05).slice();
    for (const b of list) {
      if (!overlaps(b, p.x, p.y, p.z, h)) continue;
      const rise = b.y1 - p.y;
      if (a.groundish && rise > 0 && rise <= STEP && !Ph.blocked(p.x, b.y1 + 0.001, p.z, h)) { p.y = b.y1 + 0.001; a.stepUp += rise; continue; }
      if (axis === 0) { p.x = d > 0 ? b.x0 - R - 1e-4 : b.x1 + R + 1e-4; a.vel.x = 0; }
      else { p.z = d > 0 ? b.z0 - R - 1e-4 : b.z1 + R + 1e-4; a.vel.z = 0; }
    }
  }
  function moveY(a, d, h) {
    const p = a.pos;
    p.y += d;
    const list = M.query(p.x - R, p.z - R, p.x + R, p.z + R);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!overlaps(b, p.x, p.y, p.z, h)) continue;
      if (d <= 0) { p.y = b.y1; a.vel.y = 0; a.onGround = true; }
      else { p.y = b.y0 - h - 1e-4; a.vel.y = 0; }
    }
    if (p.y <= 0) { p.y = 0; if (a.vel.y < 0) a.vel.y = 0; a.onGround = true; }
  }
  function snapDown(a, h) {
    const p = a.pos;
    let best = 0;
    const list = M.query(p.x - R, p.z - R, p.x + R, p.z + R);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.x0 < p.x + R && b.x1 > p.x - R && b.z0 < p.z + R && b.z1 > p.z - R && b.y1 <= p.y + 1e-3 && b.y1 > best) best = b.y1;
    }
    if (p.y - best <= STEP + 0.05) { a.stepUp -= p.y - best; p.y = best; a.vel.y = 0; a.onGround = true; }
  }

  // crouch toward a.crouchWant, keeping the head clear of ceilings
  Ph.crouch = function (a, dt) {
    const target = a.crouchWant ? 1 : 0;
    if (target === a.crouch) return;
    const nc = target > a.crouch ? Math.min(1, a.crouch + dt / 0.18) : Math.max(0, a.crouch - dt / 0.18);
    const oldH = G.bodyHeight(a.crouch), newH = G.bodyHeight(nc);
    let ny = a.pos.y;
    if (!a.onGround) ny += oldH - newH;   // airborne: tuck legs up
    if (ny < 0) ny = 0;
    if (newH > oldH && Ph.blocked(a.pos.x, ny + 0.01, a.pos.z, newH - 0.01)) return;
    a.pos.y = ny; a.crouch = nc;
  };

  function friction(a, dt) {
    const sp = Math.hypot(a.vel.x, a.vel.z);
    if (sp < 0.02) { a.vel.x = a.vel.z = 0; return; }
    const k = Math.max(0, sp - Math.max(sp, 1.9) * 5.2 * dt) / sp;
    a.vel.x *= k; a.vel.z *= k;
  }
  function accelerate(a, wx, wz, wishSpeed, cap, accel, dt) {
    const cur = a.vel.x * wx + a.vel.z * wz, add = Math.min(wishSpeed, cap) - cur;
    if (add <= 0) return;
    const acc = Math.min(accel * wishSpeed * dt, add);
    a.vel.x += acc * wx; a.vel.z += acc * wz;
  }

  // full movement step. wx,wz: unit wish direction (or 0), wishSpeed m/s
  Ph.step = function (a, wx, wz, wishSpeed, jump, dt) {
    Ph.crouch(a, dt);
    if (a.onGround) {
      friction(a, dt);
      accelerate(a, wx, wz, wishSpeed, wishSpeed, 5.5, dt);
      if (jump && a.crouch < 0.5) { a.vel.y = JUMP_V; a.onGround = false; a.jumped = true; }
    } else accelerate(a, wx, wz, wishSpeed, 0.76, 12, dt);
    const h = G.bodyHeight(a.crouch) - 0.01;
    const wasGround = a.onGround;
    a.groundish = wasGround;
    a.vel.y -= GRAV * dt;
    // sub-step long frames to avoid tunnelling
    const steps = Math.max(1, Math.ceil(Math.hypot(a.vel.x, a.vel.z) * dt / 0.25));
    for (let i = 0; i < steps; i++) { moveAxis(a, 0, a.vel.x * dt / steps, h); moveAxis(a, 2, a.vel.z * dt / steps, h); }
    const vyBefore = a.vel.y;
    a.onGround = false;
    moveY(a, a.vel.y * dt, h);
    if (!a.onGround && wasGround && a.vel.y <= 0 && !a.jumped) snapDown(a, h);
    a.jumped = false;
    if (a.onGround && !wasGround && vyBefore < -6) a.landed = -vyBefore;
  };

  // ---------------- local player ----------------
  const FALL = 0.65, DEATHCAM = FALL + 2.5, ORBIT = 2;
  G.timeScale = 1;
  const P = G.Player = {
    agent: null, camY: 0, stepDist: 0, shadeT: 0, shadeTarget: 1,
    clock: 0, slowUntil: 0, orbit: null, specTarget: null, specY: 0, deathT: -99, killer: null,
    death: { pos: new THREE.Vector3(), floor: 0, yaw0: 0, pitch0: 0 },
  };
  const eye = new THREE.Vector3();
  const SLOTKEYS = { Digit1: 'primary', Digit2: 'pistol', Digit3: 'knife', Digit4: 'grenade', Digit5: 'bomb' };
  const setFov = (cam, fov) => { if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); } };

  // how far the visible cursor sits inside the left/right turning strip (fallback mode only), -1..1
  function edgeTurn(x) {
    const w = window.innerWidth, zone = Math.max(28, w * 0.07);
    if (x < zone) return -G.clamp(1 - x / zone, 0, 1);
    if (x > w - zone) return G.clamp((x - (w - zone)) / zone, 0, 1);
    return 0;
  }

  const assistPoint = new THREE.Vector3(), assistEye = new THREE.Vector3(), assistDir = new THREE.Vector3();
  const assist = { yaw:0, pitch:0, found:false };
  function acquire(a) {
    assist.found = false;
    let best = Math.PI * 3.5 / 180;
    G.eyePos(a,assistEye);
    for (const e of G.Game.agents) {
      if (!e.alive || e.team===a.team) continue;
      const dx=e.pos.x-assistEye.x, dz=e.pos.z-assistEye.z, horizontal=Math.hypot(dx,dz);
      const y=G.wrapAngle(G.yawTo(dx,dz)-a.yaw);
      for (let k=0;k<2;k++) {
        const height=e.pos.y+(k ? 1.165-.425*e.crouch : 1.63-.5*e.crouch);
        const pitch=Math.atan2(height-assistEye.y,horizontal)-a.pitch;
        const distance=Math.hypot(y*Math.cos(a.pitch),pitch);
        if (distance<best && G.Nades.visible(assistEye,assistPoint.set(e.pos.x,height,e.pos.z))) {
          best=distance; assist.yaw=y; assist.pitch=pitch; assist.found=true;
        }
      }
    }
    return assist.found;
  }
  // Gain from finger speed (px/s), so 60 Hz and 120 Hz screens turn the same: about 1:1 for slow
  // aiming drags, rising to ~2.1x for a fast swipe (300 px in 0.3 s turns ~113 deg at the default 1.5).
  function lookCurve(speed, scoped) {
    const t = Math.min(speed / 1100, 1);
    return scoped ? 0.9 + 0.32 * t : 0.95 + 1.15 * t;
  }
  P.touchLook = function (a, dt, sens, scoped) {
    const inp = G.input, ratio = (G.settings.vertRatio >= 0.4 && G.settings.vertRatio <= 1.8) ? G.settings.vertRatio : 1;
    // Touch samples can arrive less often than animation frames.
    const speed = Math.hypot(inp.dx, inp.dy) / (G.Touch.lookTime || dt || 1 / 60);
    G.Touch.lookTime = 0;
    let gain = lookCurve(speed, scoped);
    const active = G.Touch.enabled && G.Touch.realTouch && G.settings.aimAssist && a.blindUntil <= G.time;
    const moving = !!(inp.dx || inp.dy || G.Touch.joystick.x || G.Touch.joystick.y);
    const onTarget = active && moving && acquire(a);
    if (onTarget) gain = Math.max(0.85, gain * G.lerp(0.92, 1, Math.min(speed / 850, 1)));
    const dx = inp.dx * gain, dy = inp.dy * gain * ratio;
    a.yaw = G.wrapAngle(a.yaw - dx * sens);
    a.pitch = G.clamp(a.pitch - dy * sens, -1.53, 1.53);
    // Mild pull only while the aim is already on a visible target and the finger is not flicking.
    if (onTarget && speed < 1300 && acquire(a)) {
      const err = Math.hypot(assist.yaw, assist.pitch) || 1;
      const dragLimit = speed ? Math.hypot(dx, dy) * sens * 0.25 : Infinity;
      const pull = Math.min(0.1, Math.min(dt * 0.055, dragLimit) / err);
      a.yaw = G.wrapAngle(a.yaw + assist.yaw * pull);
      a.pitch = G.clamp(a.pitch + assist.pitch * pull, -1.53, 1.53);
    }
  };
  function autoTarget(a,it) {
    if (!G.Touch.realTouch || !G.settings.autoFire || !it || !it.def.rpm || !it.clip ||
        it.reloading || G.time<it.nextFire || G.time<a.switchEnd || G.time<a.blindUntil) return false;
    G.eyePos(a,assistEye); G.forward(a.yaw,a.pitch,assistDir);
    const hit=G.Weapons.trace(a,assistEye.x,assistEye.y,assistEye.z,assistDir.x,assistDir.y,assistDir.z,220);
    return !!hit.agent && !G.Nades.blocks(assistEye,assistPoint.set(hit.wx,hit.wy,hit.wz));
  }

  P.update = function (dt, realDt = dt) {
    const a = P.agent, inp = G.input, cam = G.camera;
    const touch = G.Touch.enabled;
    if (!a) return;
    P.clock += realDt;
    G.timeScale = P.clock < P.slowUntil ? 0.35 : 1;
    if (P.orbit && P.clock >= P.orbit.end) P.orbit = null;
    if (inp.hit('KeyB')) G.HUD.toggleBuy();
    G.HUD.showScores(touch ? G.HUD.scoresOpen : inp.down('Tab'));
    if (!a.alive) { G.HUD.edge(0); spectate(realDt); return; }
    if (P.orbit) { G.HUD.edge(0); return; }

    // look (while the buy menu is open, the mouse drives its cursor instead)
    const it = G.Weapons.current(a);
    const zoom = it && it.def.scope ? it.zoom : 0;
    const zf = zoom === 2 ? 0.2 : zoom === 1 ? 0.45 : 1;
    let scopeMul = 1;
    if (zoom > 0) {
      const n = +(touch ? G.settings.touchScope : G.settings.scopeSens);
      scopeMul = n >= 0.2 && n <= 2 ? n : 1;
    }
    const sens = 0.0022 * (touch ? G.settings.touchSens : G.settings.sens) * zf * scopeMul;
    let edge = 0;
    if (G.HUD.buyOpen) {
      if (inp.locked) G.HUD.moveCursor(inp.dx, inp.dy, inp.leftPressed);
    } else if (touch || inp.canAim()) {
      if (touch) P.touchLook(a, realDt, sens, zoom > 0);
      else { a.yaw = G.wrapAngle(a.yaw - inp.dx * sens); a.pitch = G.clamp(a.pitch - inp.dy * sens, -1.53, 1.53); }
      if (!touch && inp.freeLook && inp.cursorIn) {
        edge = edgeTurn(inp.cursorX);
        a.yaw = G.wrapAngle(a.yaw - edge * 2.6 * G.settings.sens * zf * scopeMul * Math.min(realDt, 0.05));
      }
    }
    G.HUD.edge(edge);

    // movement
    const frozen = G.Game.frozen || a.planting || a.defusing;
    let fx = 0, fz = 0;
    if (touch && !frozen) {
      fx = G.Touch.joystick.x; fz = G.Touch.joystick.y;
    } else if (!frozen) {
      if (inp.down('KeyW')) fz -= 1; if (inp.down('KeyS')) fz += 1;
      if (inp.down('KeyA')) fx -= 1; if (inp.down('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    let wx = 0, wz = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
      wx = fx * c + fz * s; wz = -fx * s + fz * c;
    }
    a.walking = touch ? len > 0 && len <= 0.33 : inp.down('ShiftLeft') || inp.down('ShiftRight');
    a.crouchWant = !frozen && (inp.down('KeyC') || (inp.keyboardLocked && document.fullscreenElement && (inp.down('ControlLeft') || inp.down('ControlRight'))));
    // Stick travel reaches walk speed at 33% and run speed at 60%.
    const pace = touch ? (len <= 0.33 ? 0.52 * Math.max(0, len - 0.05) / 0.28 : 0.52 + Math.min(1, (len - 0.33) / 0.27) * 0.48) : a.walking ? 0.52 : 1;
    let speed = G.Weapons.maxSpeed(a) * pace * G.lerp(1, 0.34, a.crouch);
    if (G.time < a.slowUntil) speed *= 0.55;
    Ph.step(a, wx, wz, len > 0 ? speed : 0, !frozen && inp.hit('Space'), dt);
    if (a.landed) { G.Audio.land(a.pos, true); G.VM.onLand(a.landed); a.landed = 0; }

    // footsteps (silent when walking or crouched)
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (a.onGround && hs > 0.5) {
      P.stepDist += hs * dt;
      if (P.stepDist > 2.1) {
        P.stepDist = 0;
        const loud = !a.walking && hs > G.Weapons.maxSpeed(a) * 0.6 && a.crouch < 0.5;
        if (loud) { G.Audio.foot(a.pos, true); G.Bots.hearStep(a); }
      }
    }

    // weapon selection
    if (!G.HUD.buyOpen) for (const k in SLOTKEYS) if (inp.hit(k)) G.Weapons.switchTo(a, SLOTKEYS[k]);
    if (inp.hit('KeyQ') && a.prevSlot) G.Weapons.switchTo(a, a.prevSlot);
    if (inp.wheel) {
      const order = ['primary', 'pistol', 'knife', 'grenade', 'bomb'].filter((s) => (s === 'bomb' ? a.inv.bomb : a.inv[s]));
      const i = order.indexOf(a.cur);
      if (order.length > 1) G.Weapons.switchTo(a, order[(i + (inp.wheel > 0 ? 1 : order.length - 1)) % order.length]);
    }
    if (inp.hit('KeyG')) {
      if (a.cur === 'bomb') G.Game.dropBomb(a);
      else G.Weapons.drop(a, a.cur);
    }
    G.Weapons.tryPickup(a);
    const blockFire = G.HUD.buyOpen || (touch && G.HUD.scoresOpen);
    const automatic = touch && !blockFire && !frozen && autoTarget(a,G.Weapons.current(a));
    a.viewPunch = (a.viewPunch || 0) * Math.exp(-dt * 14);
    G.Weapons.update(a, dt, {
      fire: (inp.left || automatic) && !blockFire && !frozen, firePressed: (inp.leftPressed || automatic) && !blockFire && !frozen,
      alt: inp.right && !blockFire && !frozen, altPressed: inp.rightPressed && !blockFire && !frozen, reload: inp.hit('KeyR'),
    });
    G.Game.handleUse(a, inp.down('KeyE'), dt);

    // camera
    const eyeH = G.eyeHeight(a.crouch);
    let targetY = a.pos.y + eyeH;
    if (a.stepUp) { P.camY -= 0; a.stepUp = 0; }
    P.camY = Math.abs(P.camY - targetY) > 1.2 ? targetY : G.lerp(P.camY, targetY, 1 - Math.exp(-dt * 18));
    cam.position.set(a.pos.x, P.camY, a.pos.z);
    const sh = G.FX.shake * 0.02 + (G.time < a.punchUntil ? 0.012 : 0);
    cam.rotation.set(a.pitch + a.recoilP * 0.5 + a.viewPunch + (Math.random() - 0.5) * sh, a.yaw + a.recoilY * 0.5 + (Math.random() - 0.5) * sh, 0, 'YXZ');
    const baseFov = zoom === 2 ? 12 : zoom === 1 ? 32 : 74;
    setFov(cam, baseFov * (1 - 0.06 * G.clamp((P.slowUntil - P.clock) / 0.4, 0, 1)));

    // is the player standing in shade? (dims the viewmodel)
    P.shadeT -= dt;
    if (P.shadeT <= 0 && G.sunDir) {
      P.shadeT = 0.12;
      G.eyePos(a, eye);
      const lit = !G.Map.raycast(eye.x, eye.y, eye.z, G.sunDir.x, G.sunDir.y, G.sunDir.z, 60);
      P.shadeTarget = lit ? 1 : 0;
    }
    G.VM.shade = G.lerp(G.VM.shade, P.shadeTarget, 1 - Math.exp(-dt * 6));
    G.Audio.updateListener(cam.position, a.yaw);
  };

  // ---------------- death camera and spectating ----------------
  P.onKill = function (victim, info) {
    if (!P.agent.alive || P.orbit) return;
    P.slowUntil = P.clock + 0.4 + (info.headshot ? 0.13 : 0) + (info.multi - 1) * 0.08;
    G.timeScale = 0.35;
    // The defenders still need their controls if the bomb is ticking.
    if (info.last && G.Game.phase === 'live' && !(P.agent.team === 'def' && G.Game.bomb.state === 'planted')) {
      P.orbit = { victim, end: P.clock + ORBIT, yaw: P.agent.yaw };
    }
  };
  P.onDeath = function (killer) {
    const a = P.agent, d = P.death, cam = G.camera;
    if (P.orbit) G.eyePos(a, d.pos);
    else d.pos.copy(cam.position);
    P.orbit = null;
    P.deathT = P.clock;
    P.slowUntil = P.clock + FALL;
    G.timeScale = 0.35;
    G.Audio.deathMix(true);
    G.FX.deathGrade(1);
    P.killer = killer && killer !== a ? killer : null;
    P.specTarget = null;
    d.floor = a.pos.y + 0.45;
    d.yaw0 = a.yaw + a.recoilY * 0.5;
    d.pitch0 = a.pitch + a.recoilP * 0.5;
  };
  P.resetSpectate = function () {
    G.timeScale = 1; P.slowUntil = 0; P.orbit = null;
    P.specTarget = null; P.deathT = -99; P.killer = null;
    G.FX.deathGrade(0); G.Audio.deathMix(false); showBodies(null);
  };
  // the body you watch from the inside is not drawn
  function showBodies(hidden) { for (const x of G.Game.agents) if (x.rig) x.rig.hidden = x === hidden; }
  P.spectateTarget = function () {
    const t = P.specTarget;
    return t && t.alive && P.clock - P.deathT >= DEATHCAM ? t : null;
  };
  // living teammates in a fixed order; enemies only once the whole team is down
  function specPool(a) {
    const alive = G.Game.agents.filter((x) => x.alive && x !== a);
    const mates = alive.filter((x) => x.team === a.team);
    return (mates.length ? mates : alive).sort((x, y) => x.id - y.id);
  }
  const focus = new THREE.Vector3(), offset = new THREE.Vector3();
  function watchPoint(point, angle, distance, height, fov) {
    const cam = G.camera;
    offset.set(Math.sin(angle) * distance, height, Math.cos(angle) * distance);
    const reach = offset.length();
    offset.divideScalar(reach);
    const hit = M.raycast(point.x, point.y, point.z, offset.x, offset.y, offset.z, reach);
    cam.position.copy(point).addScaledVector(offset, hit ? Math.max(0.025, hit.t - 0.18) : reach);
    cam.lookAt(point); setFov(cam, fov);
    G.Audio.updateListener(cam.position, G.yawTo(point.x - cam.position.x, point.z - cam.position.z));
  }
  // Sample after the ragdoll physics step so the camera follows the falling chest.
  P.orbitCamera = function () {
    const orbit = P.orbit;
    if (!orbit) return;
    const t = G.clamp(1 - (orbit.end - P.clock) / ORBIT, 0, 1);
    if (!G.BotModel.ragdollPoint(orbit.victim, 1, focus)) {
      focus.copy(orbit.victim.pos); focus.y += 0.75;
    }
    watchPoint(focus, orbit.yaw + t * 1.65, 2.5 + t * 0.55, 0.9, 56 + 5 * t);
  };
  function deathCam(since) {
    const cam = G.camera, d = P.death;
    if (since < FALL) {
      const t = G.clamp(since / FALL, 0, 1);
      cam.position.copy(d.pos);
      cam.position.y = G.lerp(d.pos.y, d.floor, t * t);
      cam.rotation.set(d.pitch0 - t * 0.22, d.yaw0, 0.34 * t, 'YXZ');
      setFov(cam, 74 - t * 5);
      G.Audio.updateListener(cam.position, d.yaw0);
    } else {
      const subject = P.killer || P.agent;
      if (!G.BotModel.ragdollPoint(subject, 1, focus)) {
        focus.copy(subject.pos); focus.y += 1.34 - subject.crouch * 0.44;
      }
      const t = G.clamp((since - FALL) / 2.5, 0, 1);
      const angle = Math.atan2(d.pos.x - focus.x, d.pos.z - focus.z);
      watchPoint(focus, angle + 0.24, 3.8 - 0.5 * t, 0.35, 63 - 21 * t);
    }
    showBodies(null);
  }
  // first-person view of a living player; changing who you watch is an instant cut
  function spectate(dt) {
    const a = P.agent, cam = G.camera, since = P.clock - P.deathT;
    G.FX.deathGrade(G.clamp((DEATHCAM - since) / 0.55, 0, 1));
    if (since >= DEATHCAM) G.Audio.deathMix(false);
    const pool = specPool(a);
    if (since < DEATHCAM || !pool.length) { deathCam(since); G.HUD.spectating(null); return; }
    let t = P.specTarget, cut = false;
    if (!t || !t.alive || pool.indexOf(t) < 0) {
      const from = t ? t.pos : P.death.pos;   // whoever is closest to the action you were watching
      t = pool.reduce((b, x) => (G.dist2D(x.pos, from) < G.dist2D(b.pos, from) ? x : b), pool[0]);
      cut = true;
    } else if (G.input.leftPressed && pool.length > 1) {
      t = pool[(pool.indexOf(t) + 1) % pool.length];
      cut = true;
    }
    P.specTarget = t;
    showBodies(t);
    G.eyePos(t, eye);
    P.specY = cut ? eye.y : G.lerp(P.specY, eye.y, 1 - Math.exp(-dt * 18));
    cam.position.set(eye.x, P.specY, eye.z);
    cam.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
    setFov(cam, 74);
    G.HUD.spectating(t);
    G.Audio.updateListener(cam.position, t.yaw);
  }
})(window.G);
