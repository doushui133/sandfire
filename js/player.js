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

  function friction(a, speed, drop) {
    const left = speed - drop;
    const k = left > 1e-6 ? left / speed : 0;
    a.vel.x *= k; a.vel.z *= k;
  }
  function accelerate(a, wx, wz, wishSpeed, cap, accel, dt) {
    const cur = a.vel.x * wx + a.vel.z * wz, add = Math.min(wishSpeed, cap) - cur;
    if (add <= 0) return;
    const acc = Math.min(accel * wishSpeed * dt, add);
    a.vel.x += acc * wx; a.vel.z += acc * wz;
  }

  // brake requests a stop without an opposing input.
  Ph.step = function (a, wx, wz, wishSpeed, jump, dt, brake = false) {
    Ph.crouch(a, dt);
    if (a.onGround) {
      const speed = Math.hypot(a.vel.x, a.vel.z);
      const maxSpeed = G.Weapons.maxSpeed(a);
      const opposed = wishSpeed > 0 && a.vel.x * wx + a.vel.z * wz < -0.3 * speed * Math.hypot(wx, wz);
      if (brake || opposed) friction(a, speed, maxSpeed * 10 * dt);
      else if (wishSpeed > 0) {
        friction(a, speed, Math.max(speed, wishSpeed * 0.34) * 3.6 * dt);
        accelerate(a, wx, wz, wishSpeed, wishSpeed, 5.2, dt);
      } else friction(a, speed, Math.max(speed, maxSpeed * 0.41) * 6.3 * dt);
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
  const IMPACT = 0.15, FALL = 1.4, DEATHCAM = 3.2, ORBIT = 2;
  G.timeScale = 1;
  const P = G.Player = {
    agent: null, camY: 0, stepDist: 0, shadeT: 0, shadeTarget: 1,
    clock: 0, slowUntil: 0, orbit: null, specTarget: null, specY: 0, deathT: -99, killer: null,
    death: { pos: new THREE.Vector3(), dir: new THREE.Vector3(), pullFrom: new THREE.Vector3(), rotation: new THREE.Quaternion(),
      yaw: 0, pitch: 0, roll: 0, fov: 74, force: 0, active: false },
  };
  const eye = new THREE.Vector3();
  const SLOTKEYS = { Digit1: 'primary', Digit2: 'pistol', Digit3: 'knife', Digit5: 'bomb' };
  const GRENADEKEYS = { Digit6: 'he', Digit7: 'flash', Digit8: 'smoke' };
  const weaponControls = {};
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
    } else if (!G.Nades.wheel.open && (touch || inp.canAim())) {
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
    const deflection = Math.hypot(fx, fz);
    const touchBrake = touch && G.settings.touchBrake;
    const len = touchBrake && deflection < 0.02 ? 0 : deflection;
    const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
    let wx = 0, wz = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      wx = fx * c + fz * s; wz = -fx * s + fz * c;
    }
    a.walking = touch ? len > 0 && len <= 0.33 : inp.down('ShiftLeft') || inp.down('ShiftRight');
    a.crouchWant = !frozen && (inp.down('KeyC') || (inp.keyboardLocked && document.fullscreenElement && (inp.down('ControlLeft') || inp.down('ControlRight'))));
    // Stick travel reaches walk speed at 33% and run speed at 60%.
    const pace = touch ? (len <= 0.33 ? 0.52 * Math.max(0, len - 0.05) / 0.28 : 0.52 + Math.min(1, (len - 0.33) / 0.27) * 0.48) : a.walking ? 0.52 : 1;
    let speed = G.Weapons.maxSpeed(a) * pace * G.lerp(1, 0.34, a.crouch);
    if (G.time < a.slowUntil) speed *= 0.55;
    if (!touchBrake || frozen) a.touchMoving = false;
    else if (len > 0) a.touchMoving = true;
    const brake = a.touchMoving && len === 0;
    const vx = a.vel.x, vz = a.vel.z, grounded = a.onGround;
    Ph.step(a, wx, wz, len > 0 ? speed : 0, !frozen && inp.hit('Space'), dt, brake);
    if (brake && a.vel.x === 0 && a.vel.z === 0) a.touchMoving = false;
    const ax = grounded && dt > 0 ? (a.vel.x - vx) / dt : 0;
    const az = grounded && dt > 0 ? (a.vel.z - vz) / dt : 0;
    a.moveAccelX = ax * c - az * s;
    a.moveAccelZ = ax * s + az * c;
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
    const W = G.Weapons;
    const menu = G.HUD.buyOpen || (touch && G.HUD.scoresOpen) || G.HUD.mapOpen;
    if (!inp.left && !inp.right && !inp.leftPressed && !inp.rightPressed) a.throwLatch = false;
    const blockFire = G.Nades.updateWheel(a, inp, menu) || menu;
    if (!blockFire) {
      for (const k in SLOTKEYS) if (inp.hit(k)) W.switchTo(a, SLOTKEYS[k]);
      if (touch && inp.hit('Digit4')) W.switchTo(a, 'grenade');
      if (!touch) {
        for (const k in GRENADEKEYS) if (inp.hit(k)) W.selectGrenade(a, GRENADEKEYS[k]);
        if (inp.hit('Digit9')) W.selectGrenade(a, a.nades.molotov ? 'molotov' : 'incendiary');
      }
      if (inp.hit('KeyQ') && a.prevSlot) W.switchTo(a, a.prevSlot);
      if (inp.wheel) {
        const order = ['primary', 'pistol', 'knife', 'grenade', 'bomb'].filter((s) => (s === 'bomb' ? a.inv.bomb : a.inv[s]));
        const i = order.indexOf(a.cur);
        if (order.length > 1) W.switchTo(a, order[(i + (inp.wheel > 0 ? 1 : order.length - 1)) % order.length]);
      }
      if (inp.hit('KeyG')) {
        if (a.cur === 'bomb') G.Game.dropBomb(a);
        else W.drop(a, a.cur);
      }
    }
    G.Game.handleUse(a, !blockFire && inp.down('KeyE'), dt, !blockFire && inp.hit('KeyE'));
    if (!blockFire) W.tryPickup(a);
    const stopFire = blockFire || frozen || a.planting || a.defusing;
    const automatic = touch && !stopFire && autoTarget(a,W.current(a));
    const punchDecay = a.viewPunch ? Math.exp(-dt * 21) : 0;
    a.viewPunch = (a.viewPunch || 0) * punchDecay;
    a.viewRoll = (a.viewRoll || 0) * punchDecay;
    a.viewFov = (a.viewFov || 0) * punchDecay;
    weaponControls.fire = (inp.left || automatic) && !stopFire;
    weaponControls.firePressed = (inp.leftPressed || automatic) && !stopFire;
    weaponControls.alt = inp.right && !stopFire;
    weaponControls.altPressed = inp.rightPressed && !stopFire;
    weaponControls.reload = inp.hit('KeyR');
    weaponControls.blocked = stopFire;
    W.update(a, dt, weaponControls);

    // camera
    const eyeH = G.eyeHeight(a.crouch);
    let targetY = a.pos.y + eyeH;
    if (a.stepUp) { P.camY -= 0; a.stepUp = 0; }
    P.camY = Math.abs(P.camY - targetY) > 1.2 ? targetY : G.lerp(P.camY, targetY, 1 - Math.exp(-dt * 18));
    cam.position.set(a.pos.x, P.camY, a.pos.z);
    const lean = -G.clamp(a.moveAccelX / 48, -1, 1) * Math.PI / 300;
    a.moveRoll = G.lerp(a.moveRoll || 0, lean, 1 - Math.exp(-dt * 16));
    const shotFov = a.viewFov >= 0.01 ? a.viewFov : 0;
    const sh = G.FX.shake * 0.02 + shotFov * 0.008 + (G.time < a.punchUntil ? 0.012 : 0);
    const pitch = a.pitch + a.recoilP * 0.5 + a.viewPunch + (Math.random() - 0.5) * sh;
    cam.rotation.set(G.clamp(pitch, -1.56, 1.56), a.yaw + a.recoilY * 0.5 + (Math.random() - 0.5) * sh, a.moveRoll + a.viewRoll, 'YXZ');
    const baseFov = zoom === 2 ? 12 : zoom === 1 ? 32 : 74;
    setFov(cam, baseFov * (1 + shotFov / 74 - 0.06 * G.clamp((P.slowUntil - P.clock) / 0.4, 0, 1)));

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
    const hit = a.deathInfo || {};
    if (!P.orbit && cameraClear(cam.position, 0.12)) d.pos.copy(cam.position);
    else G.eyePos(a, d.pos);
    if (!cameraClear(d.pos, 0.12)) d.pos.set(a.pos.x, a.pos.y + 1, a.pos.z);
    d.yaw = P.orbit ? a.yaw : cam.rotation.y;
    d.pitch = P.orbit ? a.pitch : cam.rotation.x;
    d.fov = P.orbit ? 74 : cam.fov;
    P.orbit = null;
    P.deathT = P.clock;
    P.slowUntil = 0;
    G.timeScale = 0.32;
    d.active = true;
    P.killer = killer && killer !== a ? killer : null;
    P.specTarget = null;
    d.dir.set(hit.dirx || 0, hit.diry || 0, hit.dirz || 0);
    if (!d.dir.lengthSq() && P.killer) d.dir.subVectors(a.pos, P.killer.pos);
    if (!d.dir.lengthSq()) d.dir.set(Math.sin(d.yaw), -0.35, Math.cos(d.yaw));
    d.dir.normalize();
    d.force = hit.head ? 1 : 0.65;
    d.roll = (d.dir.x * Math.cos(d.yaw) - d.dir.z * Math.sin(d.yaw) < -0.04 ? -1 : 1) * d.force;
    cameraGoal.copy(d.pos); cameraGoal.y -= 0.16;
    placeCamera(d.pos, cameraGoal, d.pullFrom);
    d.rotation.setFromEuler(deathEuler.set(d.pitch - 0.12, d.yaw, d.roll * 0.13, 'YXZ'));
    G.Audio.deathMix(true);
    G.FX.deathGrade(0.85);
    G.FX.deathImpact(!!hit.head);
  };
  function endDeathCam() {
    P.death.active = false;
    G.timeScale = 1;
    G.FX.deathGrade(0);
    G.FX.deathHighlight(null);
    G.Audio.deathMix(false);
    G.HUD.deathStage('');
  }
  P.resetSpectate = function () {
    endDeathCam();
    P.slowUntil = 0; P.orbit = null;
    P.specTarget = null; P.deathT = -99; P.killer = null;
    showBodies(null);
  };
  // the body you watch from the inside is not drawn
  function showBodies(hidden) { for (const x of G.Game.agents) if (x.rig) x.rig.hidden = x === hidden; }
  P.spectateTarget = function () {
    const t = P.specTarget;
    return t && t.alive && !P.death.active ? t : null;
  };
  // living teammates in a fixed order; enemies only once the whole team is down
  const pool = [];
  const byId = (x, y) => x.id - y.id;
  function specPool(a) {
    pool.length = 0;
    let mates = false;
    for (const x of G.Game.agents) {
      if (!x.alive || x === a) continue;
      if (!mates && x.team === a.team) { pool.length = 0; mates = true; }
      if (!mates || x.team === a.team) pool.push(x);
    }
    return pool.sort(byId);
  }
  const focus = new THREE.Vector3(), offset = new THREE.Vector3(), cameraGoal = new THREE.Vector3();
  const cameraBackup = new THREE.Vector3(), deathEuler = new THREE.Euler();
  function cameraClear(p, margin) {
    if (p.y < margin) return false;
    const boxes = M.query(p.x - margin, p.z - margin, p.x + margin, p.z + margin);
    for (const b of boxes) {
      if (b.x0 < p.x + margin && b.x1 > p.x - margin && b.y0 < p.y + margin &&
          b.y1 > p.y - margin && b.z0 < p.z + margin && b.z1 > p.z - margin) return false;
    }
    return true;
  }
  function placeCamera(point, goal, pos = G.camera.position) {
    offset.subVectors(goal, point);
    const reach = offset.length();
    if (reach < 0.001) { pos.copy(point); return 0; }
    offset.divideScalar(reach);
    const hit = M.raycast(point.x, point.y, point.z, offset.x, offset.y, offset.z, reach);
    let distance = hit ? Math.max(0, hit.t - 0.18) : reach;
    pos.copy(point).addScaledVector(offset, distance);
    while (distance > 0 && !cameraClear(pos, 0.12)) {
      distance = Math.max(0, distance - 0.12);
      pos.copy(point).addScaledVector(offset, distance);
    }
    return distance;
  }
  function watchPoint(point, angle, distance, height, fov, roll = 0, from = null, pull = 1) {
    const cam = G.camera;
    let reach = -1;
    // Look along the wall when the intended side has no room.
    for (let i = 0; i < 3; i++) {
      const side = angle + (i === 0 ? 0 : i === 1 ? 1.35 : -1.35);
      cameraGoal.set(point.x + Math.sin(side) * distance, point.y + height, point.z + Math.cos(side) * distance);
      if (from) cameraGoal.lerp(from, 1 - pull);
      const room = placeCamera(point, cameraGoal);
      if (room > reach) { reach = room; cameraBackup.copy(cam.position); }
      if (reach >= 0.65 * pull) break;
    }
    cam.position.copy(cameraBackup);
    cam.lookAt(point);
    cam.rotateZ(roll);
    if (from) cam.quaternion.slerp(P.death.rotation, 1 - pull);
    setFov(cam, fov);
    G.Audio.updateListener(cam.position, cam.rotation.y);
  }
  function bodyFocus(agent, height) {
    if (G.BotModel.ragdollPoint(agent, 1, focus)) {
      focus.y = Math.max(0.13, focus.y);
      if (cameraClear(focus, 0.12)) return;
    }
    focus.copy(agent.pos); focus.y += height - agent.crouch * 0.44;
  }
  // Sample after the ragdoll physics step so the camera follows the falling chest.
  P.orbitCamera = function () {
    const orbit = P.orbit;
    if (!orbit) return;
    const t = G.clamp(1 - (orbit.end - P.clock) / ORBIT, 0, 1);
    bodyFocus(orbit.victim, 0.75);
    watchPoint(focus, orbit.yaw + (1 - (1 - t) * (1 - t)) * 1.65, 2.2 + t * 0.85, 0.9, 54 + 7 * t, 0.05 * (1 - t));
  };
  function deathCam(since) {
    const cam = G.camera, d = P.death;
    if (since < IMPACT) {
      const t = since / IMPACT;
      const kick = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.45)), 0.85) * d.force;
      cameraGoal.copy(d.pos).addScaledVector(d.dir, 0.22 * kick);
      cameraGoal.y -= 0.16 * t;
      placeCamera(d.pos, cameraGoal);
      const side = d.dir.x * Math.cos(d.yaw) - d.dir.z * Math.sin(d.yaw);
      cam.rotation.set(d.pitch + (d.dir.y * 0.18 - 0.09) * kick - 0.12 * t,
        d.yaw - side * 0.25 * kick, d.roll * (0.24 * kick + 0.13 * t), 'YXZ');
      setFov(cam, G.lerp(d.fov, 74, t) + 6 * kick);
      G.Audio.updateListener(cam.position, cam.rotation.y);
    } else if (since < FALL || !P.killer) {
      const t = G.clamp((since - IMPACT) / (FALL - IMPACT), 0, 1);
      const pull = G.clamp(t / 0.56, 0, 1), ease = pull * pull * (3 - 2 * pull);
      bodyFocus(P.agent, 1.15);
      watchPoint(focus, d.yaw + 0.65 + t * 0.92, 2.65 + t * 0.6, 0.55 + t * 0.6,
        G.lerp(74, 63, ease), d.roll * (0.17 - t * 0.05), ease < 1 ? d.pullFrom : null, ease);
    } else {
      bodyFocus(P.killer, 1.18);
      const t = G.clamp((since - FALL) / (DEATHCAM - FALL), 0, 1);
      const angle = Math.atan2(d.pos.x - focus.x, d.pos.z - focus.z);
      watchPoint(focus, angle + 0.16 + t * 0.18, 3.55 - 0.5 * t, 0.34 + 0.3 * (1 - t), 60 - 14 * t);
    }
    showBodies(null);
  }
  // first-person view of a living player; changing who you watch is an instant cut
  function spectate(dt) {
    const a = P.agent, cam = G.camera, since = P.clock - P.deathT, inp = G.input;
    if (P.death.active) {
      if (since < DEATHCAM && !inp.leftPressed && !inp.rightPressed) {
        const recovery = G.clamp((since - IMPACT) / (FALL - IMPACT), 0, 1);
        G.timeScale = G.lerp(0.32, 1, recovery * recovery * (3 - 2 * recovery));
        const reveal = since >= FALL;
        G.FX.deathGrade(reveal ? Math.min(0.38, (DEATHCAM - since) * 1.5) : 0.85);
        G.FX.deathHighlight(reveal ? P.killer : null);
        G.HUD.deathStage(reveal ? 'killer' : 'fall');
        deathCam(since);
        return;
      }
      endDeathCam();
    }
    specPool(a);
    if (!pool.length) { G.HUD.spectating(null); return; }
    let t = P.specTarget, cut = false;
    if (!t || !t.alive || pool.indexOf(t) < 0) {
      const from = t ? t.pos : P.death.pos;   // whoever is closest to the action you were watching
      t = pool[0];
      for (const x of pool) if (G.dist2D(x.pos, from) < G.dist2D(t.pos, from)) t = x;
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
