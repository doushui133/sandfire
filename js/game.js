// game.js — match flow: rounds, economy, buying, bomb plant/defuse, damage and kills
(function (G) {
  'use strict';
  const THREE = G.THREE, W = G.Weapons, M = G.Map;
  const CFG = {
    freeze: 8, buyTime: 45, roundTime: 115, bombTime: 40, plant: 3.2, defuse: 10, defuseKit: 5, endDelay: 5, winRounds: 8,
    startMoney: 1000, maxMoney: 16000, win: { elim: 3000, bomb: 3300, defuse: 3300, time: 3000 }, loss: [1700, 2100, 2500, 2900, 3300], plantBonus: 300, defuseBonus: 300,
  };
  const Gm = G.Game = { CFG, mode: 'competitive', agents: [], round: 0, score: { atk: 0, def: 0 }, phase: 'menu', frozen: true, timeLeft: CFG.roundTime, phaseT: 0, buyUntil: 0, lossStreak: { atk: 0, def: 0 }, bomb: { state: 'none' } };
  const PRACTICE = { duration: 480, target: 50, respawn: 2, shield: 1.5 };
  const practiceKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  const spawnCells = [], spawnEnemies = [], spawnEyes = [], spawnPoint = new THREE.Vector3(), spawnEye = new THREE.Vector3();
  const spawnHeights = [0.25, 0.9, G.eyeHeight(0)];
  const NAMES = { atk: ['猎鹰', '蝎子', '沙狐', '铁砧', '游隼'], def: ['灰狼', '雷鸣', '堡垒', '哨兵', '北极星'] };
  let nextId = 1, bombMesh = null, bombLed = null;

  Gm.makeAgent = function (team, name, isPlayer) {
    return {
      id: nextId++, name, team, isPlayer: !!isPlayer, isBot: !isPlayer, alive: false, hp: 100, armor: 0, helmet: false, kit: false, money: CFG.startMoney,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, crouch: 0, crouchWant: false, walking: false,
      nades: {}, blindUntil:0, throwReady:0, inv: { grenade:null, primary: null, pistol: W.item('p10'), knife: W.item('knife'), bomb: false }, cur: 'pistol', prevSlot: 'knife', switchEnd: 0,
      recoilP: 0, recoilY: 0, inacc: 0, shots: 0, lastShot: -9, kills: 0, deaths: 0, slowUntil: 0, punchUntil: 0,
      planting: false, plantT: 0, defusing: false, defuseT: 0, stepUp: 0, spottedUntil: 0,
      roundKills: 0, roundDamage: 0, clutchKills: 0, damageTo: new Map(),
      // this match: trigger pulls, pulls that hit an enemy, headshot kills, best streak, damage dealt
      match: { shots: 0, hits: 0, shot: 0, hitShot: -1, headKills: 0, bestStreak: 0, damage: 0 },
    };
  };
  Gm.alive = (team) => Gm.agents.filter((a) => a.alive && a.team === team).length;
  // footsteps are heard while running; walking (shift) and crouching are silent, as in CS
  Gm.loudSteps = (a) => a.alive && a.onGround && !a.walking && a.crouch < 0.5 &&
    Math.hypot(a.vel.x, a.vel.z) > W.maxSpeed(a) * 0.6;
  Gm.clearScene = function () {
    G.Audio.stopMusic();
    G.Player.resetSpectate(); G.Nades.clear(); G.HUD.clearMatch();
    if (bombMesh) { G.scene.remove(bombMesh); bombMesh = null; }
    bombLed = null; Gm.bomb = { state: 'none' };
    Gm.pendingBanner = Gm.over = G.Bots.plan = null;
  };

  Gm.start = function (team, diff, mode) {
    Gm.clearScene();
    Gm.agents.forEach((a) => G.BotModel.remove(a));
    Gm.agents = [];
    Gm.mode = mode === 'practice' ? 'practice' : 'competitive';
    G.Bots.setDifficulty(diff);
    const me = Gm.makeAgent(team, '你', true);
    G.Player.agent = me;
    Gm.agents.push(me);
    const mine = NAMES[team].slice(0, 4), theirs = NAMES[team === 'atk' ? 'def' : 'atk'];
    mine.forEach((n) => Gm.agents.push(Gm.makeAgent(team, n, false)));
    theirs.forEach((n) => Gm.agents.push(Gm.makeAgent(team === 'atk' ? 'def' : 'atk', n, false)));
    // every soldier gets a body; the player's own is only drawn once dead (for the ragdoll)
    Gm.agents.forEach((a) => G.BotModel.create(a, a.team === team && !a.isPlayer));
    Gm.score = { atk: 0, def: 0 }; Gm.round = 0; Gm.lossStreak = { atk: 0, def: 0 }; Gm.over = null;
    if (Gm.mode === 'practice') startPractice();
    else Gm.newRound();
  };

  function resetLoadout(a) {
    a.nades = {}; a.inv.grenade = null;
    a.inv.primary = null; a.inv.pistol = W.item('p10'); a.armor = 0; a.helmet = false; a.kit = false;
  }
  function resetRoundStats() {
    Gm.roundKills = 0; Gm.playerKills = 0; Gm.recentKills = []; Gm.pendingBanner = null;
    for (const a of Gm.agents) {
      a.roundKills = a.roundDamage = a.clutchKills = 0;
      a.damageTo.clear();
    }
  }
  Gm.newRound = function () {
    Gm.round++;
    resetRoundStats();
    G.Nades.clear(); G.FX.clear(); W.clearDrops();
    if (bombMesh) { G.scene.remove(bombMesh); bombMesh = null; }
    const spawns = { atk: G.shuffle(M.spawns.atk.slice()), def: G.shuffle(M.spawns.def.slice()) };
    for (const a of Gm.agents) {
      if (!a.alive && Gm.round > 1) resetLoadout(a);
      a.primed = 0; a.throwReady = a.blindUntil = 0;
      a.alive = true; a.hp = 100;
      a.pos.copy(spawns[a.team].pop()); a.vel.set(0, 0, 0);
      a.yaw = a.team === 'atk' ? 0 : Math.PI; a.pitch = 0; a.crouch = 0; a.crouchWant = false;
      a.inv.bomb = false; a.planting = a.defusing = false; a.plantT = a.defuseT = 0;
      a.recoilP = a.recoilY = a.inacc = a.viewPunch = 0; a.shots = 0; a.slowUntil = 0;
      for (const s of ['primary', 'pistol', 'knife']) { const it = a.inv[s]; if (it) { it.clip = it.def.clip || 0; it.reserve = it.def.reserve || 0; it.reloading = false; it.zoom = 0; it.rezoom = 0; it.nextFire = 0; } }
      a.cur = W.bestSlot(a); a.switchEnd = 0;
    }
    const atk = Gm.agents.filter((a) => a.team === 'atk');
    const carrier = G.pick(atk);
    carrier.inv.bomb = true;
    Gm.bomb = { state: 'carried', carrier, pos: new THREE.Vector3(), timer: CFG.bombTime, beepT: 0, site: null, defuser: null };
    Gm.phase = 'freeze'; Gm.frozen = true; Gm.phaseT = CFG.freeze; Gm.timeLeft = CFG.roundTime;
    Gm.buyUntil = G.time + CFG.buyTime;
    Gm.agents.forEach((a) => { if (a.isBot) G.Bots.buy(a); a.cur = W.bestSlot(a); });
    G.Bots.newRound();
    G.Player.camY = G.Player.agent.pos.y + G.eyeHeight(0);
    G.Player.resetSpectate();
    G.HUD.roundStart(Gm.round, carrier === G.Player.agent);
  };

  // ---------- team deathmatch ----------
  function cacheSpawnCells() {
    for (let r = 0; r < M.H; r++) for (let c = 0; c < M.W; c++) {
      if (!M.walkable(c, r)) continue;
      const p = M.cellPos(c, r, spawnPoint);
      if (!G.Phys.blocked(p.x, p.y + 0.01, p.z, G.bodyHeight(0) - 0.01)) spawnCells.push(p.clone());
    }
  }
  function findSpawn(a) {
    let enemies = 0;
    for (const other of Gm.agents) {
      if (!other.alive || other === a || other.team === a.team) continue;
      if (!spawnEyes[enemies]) spawnEyes[enemies] = new THREE.Vector3();
      spawnEnemies[enemies] = other.pos;
      G.eyePos(other, spawnEyes[enemies++]);
    }
    const start = Math.floor(Math.random() * spawnCells.length);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < spawnCells.length; i++) {
      const p = spawnCells[(start + i) % spawnCells.length];
      let enemyDist = Infinity, allyDist = Infinity;
      for (const other of Gm.agents) {
        if (!other.alive || other === a) continue;
        const dx = p.x - other.pos.x, dz = p.z - other.pos.z, d = dx * dx + dz * dz;
        if (other.team === a.team) allyDist = Math.min(allyDist, d);
        else enemyDist = Math.min(enemyDist, d);
      }
      if (enemyDist < 100 || allyDist < 4) continue;
      const score = Math.min(enemyDist, allyDist * 2.25) - Math.random() * 20;
      if (best && score <= bestScore) continue;
      let covered = true;
      spawnEye.set(p.x, p.y + G.eyeHeight(0), p.z);
      for (let j = 0; j < enemies && covered; j++) {
        const other = spawnEnemies[j];
        for (const h of spawnHeights) {
          spawnPoint.set(p.x, p.y + h, p.z);
          if (M.clearLine(spawnEyes[j], spawnPoint)) { covered = false; break; }
          spawnPoint.set(other.x, other.y + h, other.z);
          if (M.clearLine(spawnEye, spawnPoint)) { covered = false; break; }
        }
      }
      if (covered) { best = p; bestScore = score; if (score === Infinity) break; }
    }
    return best;
  }
  Gm.choosePracticeLoadout = function (choice) {
    const p = G.Player.agent;
    if (!p || Gm.mode !== 'practice' || Gm.phase !== 'live' ||
        !Number.isInteger(choice) || choice < 0 || choice >= practiceKeys.length) return false;
    p.practiceLoadout = choice;
    return true;
  };
  Gm.spawnProtected = (a) => Gm.mode === 'practice' && a.protectedUntil > Gm.practiceTime;
  Gm.breakSpawnProtection = function (a) {
    if (Gm.mode === 'practice') a.protectedUntil = 0;
  };
  function respawn(a) {
    const spawn = findSpawn(a);
    if (!spawn) { a.spawnCheckAt = Gm.practiceTime + 0.2; return; }
    resetLoadout(a);
    const id = [a.team === 'atk' ? 'ar7' : 'tr4', 'v9', 'r90', 'h50'][a.practiceLoadout];
    a.inv[W.defs[id].slot] = W.item(id);
    W.addGrenade(a, 'he'); W.addGrenade(a, 'flash');
    a.cur = W.bestSlot(a); a.prevSlot = 'knife'; a.inv.knife = W.item('knife');
    a.pos.copy(spawn); a.vel.set(0, 0, 0);
    a.yaw = Math.atan2(spawn.x, spawn.z); a.pitch = 0;
    a.alive = a.onGround = true; a.hp = 100;
    a.crouchWant = a.walking = a.touchMoving = a.useHeld = false;
    a.crouch = a.stepUp = a.landed = a.spottedUntil = 0;
    a.blindUntil = a.throwReady = a.slowUntil = a.punchUntil = a.switchEnd = 0;
    a.recoilP = a.recoilY = a.inacc = a.shots = a.viewPunch = a.viewRoll = a.viewFov = 0;
    a.lastShot = -9; a.deathInfo = null;
    a.protectedUntil = Gm.practiceTime + PRACTICE.shield;
    if (a.isPlayer) {
      Gm.playerKills = 0; Gm.recentKills.length = 0;
      G.Player.camY = a.pos.y + G.eyeHeight(0);
      G.Player.stepDist = 0;
      G.Player.resetSpectate();
      G.HUD.clearSoundMarkers();
      if (G.Touch.enabled) G.Touch.reset();
      if (G.VM) G.VM.onSwitch();
    } else G.Bots.resetPractice(a);
  }
  function startPractice() {
    if (!spawnCells.length) cacheSpawnCells();
    G.FX.clear(); W.clearDrops();
    resetRoundStats();
    Gm.phase = 'live'; Gm.frozen = false; Gm.buyUntil = 0;
    Gm.practiceTime = 0; Gm.timeLeft = PRACTICE.duration;
    for (const a of Gm.agents) {
      a.practiceLoadout = a.isPlayer ? 0 : Math.floor(Math.random() * 4);
      a.respawnAt = a.spawnCheckAt = 0;
      respawn(a);
    }
    G.HUD.practiceStart();
    G.Audio.practiceStart();
  }
  function endPractice() {
    const s = Gm.score;
    Gm.over = s.atk === s.def ? 'draw' : s.atk > s.def ? 'atk' : 'def';
    Gm.phase = 'end'; Gm.phaseT = 3; Gm.frozen = true;
    G.HUD.practiceEnd(Gm.over);
  }
  function updatePractice(dt, elapsed) {
    if (Gm.phase === 'end') {
      Gm.phaseT -= elapsed;
      if (Gm.phaseT <= 0) { Gm.phase = 'over'; G.Player.resetSpectate(); G.Nades.clear(); G.HUD.matchOver(Gm.over); }
      return;
    }
    Gm.practiceTime += elapsed;
    Gm.timeLeft = Math.max(0, PRACTICE.duration - Gm.practiceTime);
    if (Gm.timeLeft <= 0) { endPractice(); return; }
    // 1-4 pick the next loadout only while waiting to respawn (alive they switch weapons as usual);
    // B, unused without buying, cycles it at any time
    const me = G.Player.agent;
    if (!G.Touch.enabled && me && !me.alive) {
      for (let i = 0; i < practiceKeys.length; i++) {
        if (!G.input.hit(practiceKeys[i])) continue;
        Gm.choosePracticeLoadout(i);
        delete G.input.pressed[practiceKeys[i]];
      }
    }
    if (me && G.input.hit('KeyB')) {
      Gm.choosePracticeLoadout(((me.practiceLoadout | 0) + 1) % practiceKeys.length);
      delete G.input.pressed.KeyB;
    }
    for (const a of Gm.agents) {
      if (!a.alive && Gm.practiceTime >= a.respawnAt && Gm.practiceTime >= a.spawnCheckAt) respawn(a);
    }
    G.Nades.update(dt);
    W.updateDrops(dt);
    // weapons dropped by the dead pile up over an eight-minute match: keep the newest few
    if (W.drops.length > 14) W.trimDrops(14);
  }

  Gm.update = function (dt, elapsed = dt) {
    if (Gm.phase === 'menu' || Gm.phase === 'over') return;
    if (Gm.mode === 'practice') { updatePractice(dt, elapsed); return; }
    G.Nades.update(dt);
    W.updateDrops(dt);
    const b = Gm.bomb;
    if (Gm.phase === 'freeze') {
      Gm.phaseT -= dt;
      if (Gm.phaseT <= 0) { Gm.phase = 'live'; Gm.frozen = false; G.Audio.roundLive(); G.HUD.message('', ''); }
    } else if (Gm.phase === 'live') {
      if (b.state === 'planted') {
        b.timer -= dt; b.beepT -= dt;
        if (b.timer <= 10 && b.timer + dt > 10) G.Audio.bombTen(b.timer);   // 10-second warning music
        if (b.beepT <= 0) {
          b.beepT = Math.max(0.1, (b.timer / CFG.bombTime) * 1.0);
          G.Audio.beep(b.pos, b.timer < 10); if (bombLed) bombLed.visible = true;
          setTimeout(() => { if (bombLed) bombLed.visible = false; }, 90);
        }
        if (b.timer <= 0) explode();
        else if (Gm.alive('def') === 0) end('atk', 'elim');
      } else {
        Gm.timeLeft -= dt;
        if (Gm.alive('atk') === 0) end('def', 'elim');
        else if (Gm.alive('def') === 0) end('atk', 'elim');
        else if (Gm.timeLeft <= 0) end('def', 'time');
      }
    } else if (Gm.phase === 'end') {
      if (b.state === 'planted') { b.timer -= dt; if (b.timer <= 0) explode(true); }
      if (Gm.pendingBanner) {
        if (G.Player.orbit) return;
        announceEnd(Gm.pendingBanner.winner, Gm.pendingBanner.reason, Gm.pendingBanner.mvp);
        Gm.pendingBanner = null;
      }
      Gm.phaseT -= dt;
      if (Gm.phaseT <= 0) {
        if (Gm.over) { Gm.phase = 'over'; G.Player.resetSpectate(); G.Nades.clear(); G.HUD.matchOver(Gm.over); }
        else Gm.newRound();
      }
    }
    // dropped bomb pickup
    if (b.state === 'dropped') {
      for (const a of Gm.agents) {
        if (a.alive && a.team === 'atk' && G.dist2D(a.pos, b.pos) < 1.0 && Math.abs(a.pos.y - b.pos.y) < 1.2) {
          a.inv.bomb = true; b.state = 'carried'; b.carrier = a;
          if (bombMesh) { G.scene.remove(bombMesh); bombMesh = null; }
          if (a.isPlayer) G.HUD.message('', '你捡起了炸弹', 2);
          break;
        }
      }
    }
  };

  let ledMesh = null;
  function placeBombMesh(pos, planted) {
    if (bombMesh) G.scene.remove(bombMesh);
    bombMesh = W.makeGunMesh('bomb'); bombMesh.scale.setScalar(1.3);
    bombMesh.position.set(pos.x, pos.y + 0.005, pos.z); bombMesh.rotation.y = Math.random() * 6;
    bombLed = null;
    if (planted) {
      if (!ledMesh) ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      bombLed = ledMesh;
      bombLed.position.set(0.04, 0.085, -0.03); bombLed.visible = false; bombMesh.add(bombLed);
    }
    G.scene.add(bombMesh);
  }

  Gm.bombUse = function (a) {
    if (Gm.mode === 'practice' || Gm.phase !== 'live' || !a.onGround) return null;
    if (a.inv.bomb) return M.siteAt(a.pos.x, a.pos.z);
    const b = Gm.bomb;
    if (a.team === 'def' && b.state === 'planted' && (!b.defuser || b.defuser === a) &&
        G.dist2D(a.pos, b.pos) < 1.6 && Math.abs(a.pos.y - b.pos.y) < 1.2) return 'defuse';
    return null;
  };
  Gm.handleUse = function (a, held, dt, pressed) {
    if (!a.alive) return;
    const b = Gm.bomb, action = Gm.bombUse(a);
    const use = pressed || (held && !a.useHeld);
    a.useHeld = held;
    if (held && action === 'defuse') {
      if (!a.defusing) { G.Nades.cancel(a); a.defusing = true; a.defuseT = 0; b.defuser = a; G.Audio.click('reload1', a.isPlayer ? null : a.pos); }
      a.defuseT += dt;
      if (a.defuseT >= (a.kit ? CFG.defuseKit : CFG.defuse)) defuse(a);
      return;
    }
    if (held && action) {
      if (!a.planting) {
        G.Nades.cancel(a); a.planting = true; a.plantT = 0;
        if (a.cur !== 'bomb') { a.prevSlot = a.cur; a.cur = 'bomb'; }
        G.Audio.click('tick', a.isPlayer ? null : a.pos);
      }
      const before = a.plantT; a.plantT += dt;
      if (Math.floor(before / 0.6) !== Math.floor(a.plantT / 0.6)) G.Audio.beep(a.pos, false);
      if (a.plantT >= CFG.plant) plant(a, action);
      return;
    }
    if (a.planting) { a.planting = false; a.plantT = 0; }
    if (a.defusing) { a.defusing = false; a.defuseT = 0; if (b.defuser === a) b.defuser = null; }
    if (!action && use && a.isPlayer) W.tryPickup(a, true);
  };
  function plant(a, site) {
    const b = Gm.bomb;
    a.inv.bomb = false; a.planting = false; a.plantT = 0; a.cur = W.bestSlot(a); a.switchEnd = G.time + 0.5;
    b.state = 'planted'; b.pos.copy(a.pos); b.site = site; b.timer = CFG.bombTime; b.beepT = 0; b.carrier = null; b.planter = a;
    a.money = Math.min(CFG.maxMoney, a.money + CFG.plantBonus);
    placeBombMesh(b.pos, true);
    G.Audio.radio('planted');
    G.HUD.message('炸弹已安放', site + ' 点 · 40 秒后爆炸', 3);
    if (a.isPlayer && G.VM) G.VM.onSwitch();
  }
  function defuse(a) {
    const b = Gm.bomb;
    b.state = 'defused'; b.defuser = a; a.defusing = false;
    a.money = Math.min(CFG.maxMoney, a.money + CFG.defuseBonus);
    G.Audio.radio('defused');
    end('def', 'defuse');
  }
  function explode(silent) {
    const b = Gm.bomb;
    b.state = 'exploded';
    if (bombMesh) { G.scene.remove(bombMesh); bombMesh = null; }
    G.FX.explosion(b.pos); G.Audio.explosion(b.pos);
    for (const a of Gm.agents) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(b.pos);
      let dmg = d < 22 ? 420 * Math.pow(1 - d / 22, 1.6) : 0;
      if (a.armor > 0) dmg *= 0.7;
      if (dmg >= 1) Gm.damage(a, null, Math.round(dmg), { weapon: 'bomb', head: false, from: b.pos.clone() });
    }
    if (!silent && Gm.phase === 'live') end('atk', 'bomb');
  }
  Gm.dropBomb = function (a, silent) {
    if (!a.inv.bomb) return;
    a.inv.bomb = false; a.planting = false;
    const b = Gm.bomb;
    b.state = 'dropped'; b.carrier = null;
    const c = M.colOf(a.pos.x), r = M.rowOf(a.pos.z);
    b.pos.set(a.pos.x, M.walkable(c, r) ? Math.max(a.pos.y, M.floorH(c, r)) : a.pos.y, a.pos.z);
    placeBombMesh(b.pos, false);
    if (a.cur === 'bomb') a.cur = W.bestSlot(a);
    if (!silent && a.isPlayer) G.HUD.message('', '你丢下了炸弹', 2);
  };

  // ---------- damage / kills ----------
  Gm.damageBetween = (attacker, victim) => attacker && victim && attacker.damageTo.get(victim.id);
  Gm.damage = function (v, attacker, dmg, info) {
    if (!v.alive || Gm.spawnProtected(v) || (Gm.mode === 'practice' && Gm.phase !== 'live')) return null;
    if (attacker && attacker !== v && attacker.team === v.team && !info.area) return null;
    if (attacker && attacker !== v && dmg > 0) {
      let stats = Gm.damageBetween(attacker, v);
      if (!stats) { stats = { damage: 0, hits: 0 }; attacker.damageTo.set(v.id, stats); }
      const applied = Math.min(v.hp, dmg);
      stats.damage += applied; stats.hits++;
      if (attacker.team !== v.team) {
        attacker.roundDamage += applied;
        const m = attacker.match;
        m.damage += applied;
        // accuracy counts trigger pulls: a shotgun blast that lands any pellet is one hit
        if (!info.area && info.weapon !== 'knife' && m.hitShot !== m.shot) { m.hits++; m.hitShot = m.shot; }
      }
    }
    if (attacker && attacker.isPlayer && attacker.team !== v.team) {
      const hit = { head: !!info.head, kill: dmg >= v.hp, dmg: Math.min(v.hp, dmg) };
      if (G.HUD.hitFx) G.HUD.hitFx(hit);
      if (!hit.kill) G.Audio.hit(hit.head, info.helmet);
      if (info.area) G.HUD.hitmarker(hit.head, hit.kill);
    }
    v.hp -= dmg; v.slowUntil = G.time + 0.35; v.punchUntil = G.time + 0.12;
    if (v.isPlayer) { G.HUD.hurt(attacker ? attacker.pos : null, dmg); G.Audio.hurt(); }
    G.Bots.onDamaged(v, attacker);
    if (v.hp <= 0) { kill(v, attacker, info); return { killed: true, helmet: info.helmet }; }
    if (dmg > 0 && G.BotModel.flinch) {
      const source = info.from || (attacker && attacker.pos);
      if (info.dirx || info.dirz) G.BotModel.flinch(v, info.dirx || 0, info.dirz || 0);
      else G.BotModel.flinch(v, source ? v.pos.x - source.x : 0, source ? v.pos.z - source.z : 0);
    }
    return { killed: false, helmet: info.helmet };
  };
  function kill(v, attacker, info) {
    // how the body falls: the ragdoll takes the hit direction and the weapon's punch
    const dir = new THREE.Vector3(info.dirx || 0, info.diry || 0, info.dirz || 0);
    if (info.from) dir.set(v.pos.x - info.from.x, 0.65, v.pos.z - info.from.z).normalize();
    v.deathInfo = { weapon: info.weapon, head: !!info.head, legs: !!info.legs, dirx: dir.x, diry: dir.y, dirz: dir.z };
    G.FX.deathBurst(v, dir, info.head);
    if (v.rig && G.BotModel.prepareDeath) G.BotModel.prepareDeath(v);
    v.alive = false; v.hp = 0; v.deaths++; v.planting = v.defusing = false; v.vel.set(0, 0, 0); v.crouch = Math.min(v.crouch, 0.5);
    // the player left as the last one standing: clutch music and announcer
    const me = G.Player.agent;
    if (v === me) G.Audio.stopClutch();
    else if (Gm.mode !== 'practice' && Gm.phase === 'live' && me && me.alive && v.team === me.team &&
      Gm.alive(me.team) === 1 && Gm.alive(me.team === 'atk' ? 'def' : 'atk') > 0) G.Audio.clutch();
    if (Gm.bomb.defuser === v) Gm.bomb.defuser = null;
    const practice = Gm.mode === 'practice';
    if (practice) v.respawnAt = Gm.practiceTime + PRACTICE.respawn;
    if (attacker && attacker.team !== v.team) {
      attacker.kills++; attacker.roundKills++;
      if (info.head) attacker.match.headKills++;
      if (!practice && attacker.alive && Gm.alive(attacker.team) === 1) attacker.clutchKills++;
      const d = W.defs[info.weapon];
      if (practice) Gm.score[attacker.team]++;
      else attacker.money = Math.min(CFG.maxMoney, attacker.money + (d ? d.kill : 300));
      Gm.roundKills++;
      if (attacker.isPlayer) {
        Gm.playerKills++;
        attacker.match.bestStreak = Math.max(attacker.match.bestStreak, Gm.playerKills);
        const now = G.Player.clock;
        Gm.recentKills = Gm.recentKills.filter(t => now - t <= 4);
        Gm.recentKills.push(now);
        const fx = { victim: v.name, weapon: info.weapon, headshot: !!info.head,
          multi: Math.min(5, Gm.recentKills.length), streak: Gm.playerKills,
          knife: info.weapon === 'knife', grenade: !!d && d.slot === 'grenade',
          wallbang: !!info.wallbang, first: Gm.roundKills === 1, last: !practice && Gm.alive(v.team) === 0,
          ace: !practice && Gm.playerKills === 5 };
        if (G.HUD.killFx) G.HUD.killFx(fx);
        G.Audio.killSting(fx);
        G.Player.onKill(v, fx);
      }
    }
    G.Nades.cancel(v);
    if (!practice) {
      if (v.cur === 'grenade') W.drop(v, 'grenade');
      if (v.inv.bomb) Gm.dropBomb(v, true);
      if (v.inv.primary) W.drop(v, 'primary'); else if (v.inv.pistol) W.drop(v, 'pistol');
    }
    const wname = info.weapon === 'bomb' ? '爆炸' : (W.defs[info.weapon] ? W.defs[info.weapon].name : '');
    G.HUD.killfeed(attacker, v, wname, info.head);
    if (v.isPlayer) {
      const other = attacker !== v ? attacker : null;
      G.Player.onDeath(attacker); G.HUD.died(attacker, wname, info.head,
        Gm.damageBetween(v, other), Gm.damageBetween(other, v));
      if (G.HUD.deathFx) G.HUD.deathFx({ killer: attacker ? attacker.name : '爆炸', weapon: info.weapon,
        headshot: !!info.head, killerHp: attacker ? attacker.hp : 0 });
    }
    if (practice && attacker && Gm.score[attacker.team] >= PRACTICE.target) endPractice();
  }

  function roundMvp(winner, reason) {
    let best = null;
    const objective = reason === 'defuse' ? Gm.bomb.defuser : Gm.bomb.planter;
    for (const a of Gm.agents) {
      if (a.team !== winner) continue;
      if (!best || a.roundKills > best.roundKills ||
          (a.roundKills === best.roundKills && (a.roundDamage > best.roundDamage ||
           (a.roundDamage === best.roundDamage && a === objective)))) best = a;
    }
    if (!best) return null;
    let badge = 'kills';
    if (reason === 'defuse' && Gm.bomb.defuser === best) badge = 'defused';
    else if (Gm.bomb.planter === best) badge = 'planted';
    else if (best.alive && best.clutchKills >= 2) badge = 'clutch';
    return { name: best.name, kills: best.roundKills, damage: best.roundDamage, badge, mine: best.isPlayer };
  }
  function end(winner, reason) {
    if (Gm.phase !== 'live') return;
    Gm.phase = 'end'; Gm.phaseT = CFG.endDelay; Gm.frozen = false;
    const loser = winner === 'atk' ? 'def' : 'atk';
    Gm.score[winner]++;
    const lossPay = CFG.loss[Math.min(Gm.lossStreak[loser], CFG.loss.length - 1)];
    for (const a of Gm.agents) {
      const pay = a.team === winner ? CFG.win[reason] : lossPay;
      a.money = Math.min(CFG.maxMoney, a.money + pay);
      if (a.isPlayer) G.HUD.moneyDelta(pay);
    }
    Gm.lossStreak[loser]++; Gm.lossStreak[winner] = Math.max(0, Gm.lossStreak[winner] - 1);
    if (Gm.score[winner] >= CFG.winRounds) Gm.over = winner;
    const mvp = roundMvp(winner, reason);
    if (G.Player.orbit) Gm.pendingBanner = { winner, reason, mvp };
    else announceEnd(winner, reason, mvp);
  }
  function announceEnd(winner, reason, mvp) {
    const mine = G.Player.agent.team === winner;
    G.Audio.roundEnd(mine, !!(mvp && mvp.mine), mine && Gm.over === winner);
    G.HUD.roundEnd(winner, reason, mvp);
  }

  // ---------- buying ----------
  Gm.canBuy = function (a) {
    if (Gm.mode === 'practice' || !a.alive || (Gm.phase !== 'freeze' && Gm.phase !== 'live') || G.time >= Gm.buyUntil) return false;
    const sp = M.spawns[a.team];
    return sp.some((p) => G.dist2D(p, a.pos) < 14);
  };
  Gm.priceOf = function (a, id) {
    if (id === 'vesthelm' && a.armor >= 100 && !a.helmet) return 350;
    const d = W.defs[id] || W.equipment[id];
    return d ? d.price : 0;
  };
  Gm.owns = function (a, id) {
    if (id === 'vest') return a.armor >= 100;
    if (id === 'vesthelm') return a.armor >= 100 && a.helmet;
    if (id === 'kit') return a.kit;
    const d = W.defs[id];
    if (d && d.slot === 'grenade') return (a.nades[id] || 0) >= d.limit;
    return !!(d && a.inv[d.slot] && a.inv[d.slot].id === id);
  };
  Gm.buy = function (a, id) {
    const d = W.defs[id] || W.equipment[id];
    if (!d || !Gm.canBuy(a) || (d.team && d.team !== a.team) || Gm.owns(a, id)) return false;
    const price = Gm.priceOf(a, id);
    if (a.money < price) return false;
    if (d.slot === 'grenade') { if (!W.addGrenade(a, id)) return false; }
    else if (W.defs[id]) {
      const slot = d.slot;
      if (a.inv[slot]) { if (slot === 'pistol') a.inv[slot] = null; else W.drop(a, slot); }
      a.inv[slot] = W.item(id);
      a.cur = slot; a.switchEnd = G.time + 0.5;
      if (a.isPlayer && G.VM) G.VM.onSwitch();
    } else if (id === 'vest') a.armor = 100;
    else if (id === 'vesthelm') { a.armor = 100; a.helmet = true; }
    else if (id === 'kit') a.kit = true;
    a.money -= price;
    if (a.isPlayer) G.Audio.click('buy');
    return true;
  };
})(window.G);
