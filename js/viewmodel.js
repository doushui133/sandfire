// viewmodel.js — first-person arms and weapon, drawn in their own pass over the world.
// The view camera copies the world camera's rotation (with its position at the origin), so the
// weapon reflects the real sky and the sun comes from the right direction.
(function (G) {
  'use strict';
  const THREE = G.THREE, K = G.Geo;
  const VM = G.VM = { shade: 1 };
  let scene, cam, holder, gunMesh, magMesh, armsMesh, flash, flash2, gunMat, armMats = {};
  const guns = {};
  let curId = null, curTeam = null;
  const st = { bob: 0, swayX: 0, swayY: 0, kick: 0, kickRot: 0, kickSide: 0, reloadT: -1, reloadDur: 1, drawT: 1, swingT: -1, heavy: false, flashT: 0, land: 0, amb: new THREE.Color(0.5, 0.5, 0.5) };
  // where the gun sits in view (x right, y up, z forward is negative)
  const BASE = {
    ar7: [0.14, -0.19, -0.41], tr4: [0.14, -0.19, -0.4], v9: [0.135, -0.172, -0.37], r90: [0.15, -0.2, -0.4],
    k5:[.12,-.16,-.35], u45:[.14,-.175,-.37], fa2:[.14,-.18,-.4], s8:[.145,-.18,-.39],
    s40:[.15,-.19,-.39], l60:[.165,-.21,-.38], m18:[.09,-.12,-.40],
    p10: [0.085, -0.112, -0.41], h50: [0.085, -0.117, -0.43], knife: [0.15, -0.16, -0.3], bomb: [0.0, -0.22, -0.36],
  };
  const SLEEVE = { atk: { c: 0x5e533c, r: 0.88, z: 1 }, def: { c: 0x2b323d, r: 0.86, z: 1, w: 1 } };
  const GLOVE = { atk: { c: 0x2b2723, r: 0.66, z: 0.35 }, def: { c: 0x26282c, r: 0.66, z: 0.35 } };
  const CUFF = { atk: { c: 0x5a4a33, r: 0.8, z: 0.6 }, def: { c: 0x1a1c20, r: 0.8, z: 0.6 } };

  VM.init = function (aspect) {
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(62, aspect, 0.01, 10);
    scene.add(cam);
    holder = new THREE.Group(); cam.add(holder);
    gunMat = G.Gfx.litMaterial({ detail: 'gun', viewmodel: true });
    gunMat.uniforms.uSunDir = { value: new THREE.Vector3() };
    gunMat.uniforms.uSunDir.value.copy(G.sunDir);
    const fmat = (tex) => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 });
    flash = new THREE.Sprite(fmat(G.Tex.tex('flash'))); flash.visible = false;
    flash2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: G.Tex.tex('flashSide'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: 0xffd9a0 }));
    flash2.visible = false;
    VM.cam = cam;
  };
  VM.resize = function (aspect) { if (cam) { cam.aspect = aspect; cam.updateProjectionMatrix(); } };

  // ---------- hands: gloves with curled fingers, and the forearms ----------
  // A gripping hand built around a local axis: the grip runs along local Y, the palm sits on +X,
  // fingers wrap round the front (-Z) to the left, the thumb lies along the left side.
  function gripHand(b, surf, cuffSurf, gripR) {
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z), Y = new THREE.Vector3(0, 1, 0);
    const seam = { c: surf.c, r: surf.r, z: surf.z, w: surf.w, dark: true };
    seam.c = (typeof surf.c === 'number' ? K.lin(surf.c) : surf.c).map((v) => v * 0.45);
    b.add(K.at(K.rbox(0.034, 0.088, 0.074, 0.015, 2), gripR + 0.015, -0.002, 0.012), surf);         // palm and back of the hand
    // the four fingers as one curled band around the grip, with shallow seams between them
    const r = gripR + 0.0085, arc = [];
    for (let k = 0; k <= 10; k++) { const a = 0.15 - k / 10 * 2.55; arc.push(v3(Math.cos(a) * r, -0.005, Math.sin(a) * r)); }
    b.add(K.tube(arc, arc.map((_, k) => [0.0088 - k * 0.0003, 0.037 - k * 0.0012]), 12, Y), surf);
    for (let s = -1; s <= 1; s++) {
      const line = arc.slice(1, 10).map((p) => v3(p.x * (r + 0.0083) / r, -0.005 + s * 0.0185, p.z * (r + 0.0083) / r));
      b.add(K.tube(line, line.map(() => 0.0014), 4), seam);
    }
    // knuckle ridge on the back of the hand, and the thumb along the far side
    b.add(K.tube([v3(gripR + 0.027, 0.03, 0.0), v3(gripR + 0.027, -0.04, 0.0)], [0.009, 0.009], 8), surf);
    b.add(K.tube([v3(gripR + 0.012, 0.04, 0.026), v3(0.003, 0.047, -0.008), v3(-gripR - 0.004, 0.044, -0.028), v3(-gripR - 0.006, 0.041, -0.046)], [0.0115, 0.0105, 0.0095, 0.0085], 8), surf);
    b.add(K.at(K.cyl(0.036, 0.034, 0.03, 12, 'y'), gripR * 0.5 + 0.012, -0.074, 0.024, 0, 0, 0.15), cuffSurf);
  }
  function forearm(b, surf, cuffSurf, from, dir, len) {
    const d = dir.clone().normalize(), pts = [], rad = [];
    // slightly creased fabric: the radius ripples a little along the sleeve
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(from.clone().addScaledVector(d, len * t)); rad.push((0.03 + 0.013 * Math.pow(t, 0.8)) * (1 + 0.06 * Math.sin(t * 23))); }
    b.add(K.tube(pts, rad, 12), surf);
    b.add(K.tube([from.clone().addScaledVector(d, 0.015), from.clone().addScaledVector(d, 0.045)], [0.035, 0.036], 12), cuffSurf);
  }
  // hand placement per weapon: [position from the gun data, Euler of the grip axis, forearm direction]
  function buildArms(id, team) {
    const gm = G.GunModels.get(id), b = new K.Builder(), sv = SLEEVE[team], gv = GLOVE[team], cf = CUFF[team];
    const place = (geoFn, pos, eu) => {
      const sub = new K.Builder(); geoFn(sub);
      const g = sub.build(), k = eu[3] || 1;
      g.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(eu[0], eu[1], eu[2], 'XYZ')), new THREE.Vector3(k, k, k)));
      b.parts.push(g);
    };
    const rh = gm.rightHand, lh = gm.leftHand;
    if (gm.hold === 'rifle' || gm.hold === 'pistol') {
      place((s) => gripHand(s, gv, cf, 0.017), rh, [-0.28, 0, 0, 1.12]);
      const wristR = rh.clone().add(new THREE.Vector3(0.02, -0.07, 0.045));
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.28, -0.42, 1), 0.55), wristR, [0, 0, 0]);
      if (gm.hold === 'rifle') {
        // support hand under the handguard: grip axis along the barrel, palm below
        place((s) => gripHand(s, gv, cf, 0.027), lh, [Math.PI / 2, 0, -Math.PI / 2 - 0.35, 1.12]);
        place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.78, -0.4, 0.48), 0.62), lh.clone().add(new THREE.Vector3(-0.05, -0.035, 0.025)), [0, 0, 0]);
      } else {
        place((s) => gripHand(s, gv, cf, 0.026), lh, [-0.28, Math.PI, 0, 0.92]);
        place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.42, -0.4, 0.8), 0.6), lh.clone().add(new THREE.Vector3(-0.03, -0.06, 0.05)), [0, 0, 0]);
      }
    } else if (gm.hold === 'knife') {
      place((s) => gripHand(s, gv, cf, 0.015), rh, [Math.PI / 2 - 0.2, 0, 0]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.3, -0.5, 1), 0.55), rh.clone().add(new THREE.Vector3(0.02, -0.035, 0.06)), [0, 0, 0]);
    } else {
      place((s) => gripHand(s, gv, cf, 0.02), new THREE.Vector3(0.1, 0.02, 0.0), [0, 0, -0.3]);
      place((s) => gripHand(s, gv, cf, 0.02), new THREE.Vector3(-0.1, 0.02, 0.0), [0, Math.PI, 0.3]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.3, -0.45, 0.8), 0.55), new THREE.Vector3(0.12, -0.05, 0.04), [0, 0, 0]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.3, -0.45, 0.8), 0.55), new THREE.Vector3(-0.12, -0.05, 0.04), [0, 0, 0]);
    }
    return b.build();
  }
  function armMat(team) {
    if (!armMats[team]) {
      const camo = team === 'atk' ? [K.lin(0x8d7b57), K.lin(0x4a4532)] : [K.lin(0x46505d), K.lin(0x1d2229)];
      const m = G.Gfx.litMaterial({ detail: 'cloth', camo, viewmodel: true, detailScale: 5 });
      m.uniforms.uSunDir = gunMat.uniforms.uSunDir;
      armMats[team] = m;
    }
    return armMats[team];
  }

  VM.setWeapon = function (id, team) {
    if (id === curId && team === curTeam) return;
    const key = id + '|' + team;
    if (!guns[key]) {
      const gm = G.GunModels.get(id);
      const body = new THREE.Mesh(gm.body, gunMat), mag = gm.mag ? new THREE.Mesh(gm.mag, gunMat) : null;
      const arms = new THREE.Mesh(buildArms(id, team), armMat(team));
      [body, mag, arms].forEach((m) => { if (m) m.frustumCulled = false; });
      const action = gm.action && new THREE.Mesh(gm.action,gunMat);
      guns[key] = { body, mag, arms, gm, action };
    }
    while (holder.children.length) holder.remove(holder.children[0]);
    const g = guns[key];
    if (g.action) holder.add(g.action);
    holder.add(g.body); if (g.mag) holder.add(g.mag); holder.add(g.arms);
    holder.add(flash); holder.add(flash2);
    flash.position.copy(g.gm.muzzle); flash2.position.copy(g.gm.muzzle);
    gunMesh = g.body; magMesh = g.mag; armsMesh = g.arms;
    VM.cur = g;
    curId = id; curTeam = team;
  };
  // build every weapon for both sides and compile the shaders up front
  VM.warm = function (renderer) {
    for (const team of ['atk', 'def']) for (const id of G.GunModels.IDS) VM.setWeapon(id, team);
    for (const k in guns) { holder.add(guns[k].body); if (guns[k].mag) holder.add(guns[k].mag); holder.add(guns[k].arms); }
    flash.visible = flash2.visible = true;
    renderer.compile(scene, cam);
    flash.visible = flash2.visible = false;
    curId = null; VM.setWeapon('knife', 'atk');
  };

  VM.onShoot = function (d) {
    const m = d.model;
    st.kick += m === 'sniper' ? 0.07 : m === 'heavy' ? 0.05 : m === 'pistol' ? 0.03 : 0.022;
    st.kickRot += m === 'sniper' ? 0.16 : m === 'heavy' ? 0.18 : m === 'pistol' ? 0.1 : 0.045;
    st.kickSide = (Math.random() - 0.5) * 0.02;
    st.flashT = 0.05;
    flash.material.rotation = Math.random() * 6.28;
    const big = m === 'ar' || m === 'sniper' || m === 'heavy';
    flash.scale.setScalar((big ? 0.13 : 0.09) * (0.85 + Math.random() * 0.3));
    flash2.scale.set(big ? 0.2 : 0.13, big ? 0.07 : 0.05, 1);
    flash2.rotation.set(0, Math.PI / 2, Math.random() * 0.4 - 0.2);
    G.FX.shell(VM.ejectWorld(), d.model);
  };
  VM.onThrow = function (id) { st.thrown = id; st.thrownAt = G.time; };
  VM.onKnife = function (heavy) { st.swingT = 0; st.heavy = heavy; };
  VM.onReload = function (dur) { st.reloadT = 0; st.reloadDur = dur; };
  VM.onSwitch = function () { st.drawT = 0; st.reloadT = -1; };
  VM.onLand = function (v) { st.land = Math.min(0.06, v * 0.006); };
  // ejection port in world space (for brass leaving the first-person gun)
  const ej = new THREE.Vector3();
  VM.ejectWorld = function () {
    if (!VM.cur) return null;
    ej.copy(VM.cur.gm.eject);
    holder.updateMatrixWorld(true);
    ej.applyMatrix4(holder.matrix);                         // holder space → view space
    return ej.applyMatrix4(G.camera.matrixWorld);           // view space → world
  };

  VM.update = function (dt, p, mainCam) {
    if (!scene || !p) return;
    const it = G.Weapons.current(p);
    const throwing = st.thrown && G.time-st.thrownAt < 0.28;
    const id = throwing ? st.thrown : p.cur === 'bomb' ? 'bomb' : it ? it.id : 'knife';
    VM.setWeapon(id, p.team);
    const scoped = it && it.def.scope && it.zoom > 0;
    holder.visible = p.alive && !scoped;
    cam.quaternion.copy(mainCam.quaternion);
    // light on the weapon: sun visibility at the eye and the ambient probe there
    gunMat.uniforms.uSunVis.value = VM.shade;
    G.Gfx.probeAt(p.pos.x, p.pos.z, tmpC);
    st.amb.lerp(tmpC, 1 - Math.exp(-dt * 5));
    gunMat.uniforms.uAmbient.value.copy(st.amb);
    const am = armMat(p.team); am.uniforms.uSunVis.value = VM.shade; am.uniforms.uAmbient.value.copy(st.amb);
    if (!holder.visible) return;
    const base = BASE[id] || grenadeBase;
    // bob + sway
    const sp = Math.hypot(p.vel.x, p.vel.z), f = p.onGround ? G.clamp(sp / 6, 0, 1) : 0;
    st.bob += dt * (3.6 + sp * 1.5);
    const ldx = G.HUD.buyOpen ? 0 : G.input.dx, ldy = G.HUD.buyOpen ? 0 : G.input.dy;
    st.swayX = G.clamp(st.swayX - ldx * 0.00016, -0.035, 0.035) * Math.exp(-dt * 10);
    st.swayY = G.clamp(st.swayY + ldy * 0.00016, -0.035, 0.035) * Math.exp(-dt * 10);
    st.kick *= Math.exp(-dt * 18); st.kickRot *= Math.exp(-dt * 15); st.kickSide *= Math.exp(-dt * 15);
    st.land *= Math.exp(-dt * 9);
    let x = base[0] + Math.sin(st.bob) * 0.009 * f + st.swayX;
    let y = base[1] - Math.abs(Math.cos(st.bob)) * 0.01 * f + st.swayY - p.crouch * 0.008 - st.land - (p.onGround ? 0 : 0.012);
    let z = base[2] + st.kick;
    let rx = 0.04 + st.kickRot, ry = 0.045 + st.swayX * 1.5 + st.kickSide, rz = st.swayX * 2 + Math.sin(st.bob) * 0.012 * f;
    if (st.drawT < 1) {
      st.drawT = Math.min(1, st.drawT + dt / 0.45);
      const e = 1 - Math.pow(1 - st.drawT, 3);
      y -= 0.2 * (1 - e); rx -= 0.8 * (1 - e); rz += 0.3 * (1 - e);
    }
    let magDrop = 0;
    if (st.reloadT >= 0) {
      st.reloadT += dt / st.reloadDur;
      if (st.reloadT >= 1 || !it || !it.reloading) st.reloadT = -1;
      else {
        const t = st.reloadT, s = Math.sin(Math.PI * Math.min(1, t * 1.15));
        rx += 0.32 * s; rz += 0.42 * s; y -= 0.035 * s; x -= 0.02 * s;
        // magazine out and back in
        magDrop = t < 0.25 ? t / 0.25 : t < 0.55 ? 1 : t < 0.8 ? 1 - (t - 0.55) / 0.25 : 0;
      }
    }
    if (magMesh) { magMesh.position.set(0, -magDrop * 0.16, magDrop * 0.03); magMesh.rotation.set(magDrop * 0.3, 0, 0); magMesh.visible = magDrop < 0.98; }
    if (id === 's8' && magMesh) { magMesh.visible = st.reloadT >= 0; magMesh.position.y=-0.09*(1-Math.max(0,st.reloadT)); }
    if (VM.cur.action) {
      const t=G.clamp((G.time-p.lastShot-0.07)/0.45,0,1), travel=Math.sin(t*Math.PI);
      VM.cur.action.position.z=travel*(id==='s8' ? 0.095 : 0.058);
      if (id==='s40') VM.cur.action.rotation.z=travel*0.45;
    }
    if (id === 'l60' && st.reloadT>=0) rz+=0.32*Math.sin(st.reloadT*Math.PI);
    if (G.Weapons.defs[id] && G.Weapons.defs[id].slot==='grenade') {
      const pull=p.primed ? 1 : 0, swing=throwing ? (G.time-st.thrownAt)/0.28 : 0;
      rx+=pull*.44-swing*1.18; y+=pull*.025+swing*.06; z-=swing*.17;
      magMesh.position.set(-pull*.06,pull*.026,0); magMesh.visible=!throwing;
      gunMesh.visible=!throwing || swing<0.26;
    } else gunMesh.visible=true;
    if (st.swingT >= 0) {
      st.swingT += dt / (st.heavy ? 0.45 : 0.3);
      if (st.swingT >= 1) st.swingT = -1;
      else { const s = Math.sin(Math.PI * st.swingT); ry += (st.heavy ? 1.0 : 0.8) * s; rz -= 0.5 * s; x -= 0.12 * s; z -= 0.1 * s; rx -= st.heavy ? 0.35 * s : 0.1 * s; }
    }
    if (id === 'knife') { rx += -0.25; ry += 0.35; }
    if (p.planting || p.defusing) { y -= 0.06; rx -= 0.5; }
    holder.position.set(x, y, z); holder.rotation.set(rx, ry, rz);
    // muzzle flash
    st.flashT -= dt;
    flash.visible = flash2.visible = st.flashT > 0 && id !== 'knife' && id !== 'bomb';
  };
  const grenadeBase = [.105,-.15,-.34];
  const tmpC = new THREE.Color();
  VM.render = function (renderer) {
    if (!scene || !holder.visible) return;
    renderer.clearDepth();
    renderer.render(scene, cam);
  };
})(window.G);
