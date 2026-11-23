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
  const GLOVE = { atk: { c: 0x2b2723, r: 0.66, z: 0.35 }, def: { c: 0x1e2126, r: 0.62, z: 0.45 } };
  const CUFF = { atk: { c: 0x5a4a33, r: 0.8, z: 0.6 }, def: { c: 0x1a1c20, r: 0.8, z: 0.6 } };
  const SKIN = { c: 0xc48b62, r: 0.72, m: 0 };

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
  function gripHand(b, surf, cuffSurf, gripR, team) {
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z), Y = new THREE.Vector3(0, 1, 0);
    const fingerless = team === 'atk', bulk = fingerless ? 1 : 1.08;
    const seam = { c: (typeof surf.c === 'number' ? K.lin(surf.c) : surf.c).map((v) => v * 0.45), r: surf.r, z: surf.z };
    b.add(K.at(K.rbox(0.036 * bulk, 0.09, 0.076 * bulk, 0.012, 1), gripR + 0.016, -0.002, 0.012), surf);
    const r = gripR + 0.0085;
    for (let f = 0; f < 4; f++) {
      const y = -0.02 + f * 0.0132;
      const arc = [], n = fingerless ? 4 : 6;
      for (let k = 0; k <= n; k++) {
        const a = 0.22 - k / n * (fingerless ? 1.65 : 2.4);
        arc.push(v3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      b.add(K.tube(arc, arc.map((_, k) => 0.0074 * bulk - k * 0.0003), 6, Y), surf);
      if (fingerless) {
        const tip = [];
        for (let k = 0; k <= 3; k++) {
          const a = 0.22 - 1.65 - k / 3 * 0.75;
          tip.push(v3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        b.add(K.tube(tip, tip.map((_, k) => 0.0064 - k * 0.0004), 5, Y), SKIN);
      } else if (f > 0) {
        const seamLine = arc.slice(1, 5).map((p) => v3(p.x * (r + 0.006) / r, y - 0.0066, p.z * (r + 0.006) / r));
        b.add(K.tube(seamLine, seamLine.map(() => 0.0013), 4, Y), seam);
      }
      b.add(K.at(K.sphere(0.009 * bulk, 0.008, 0.011, 6, 4), gripR + 0.03, y, 0.01), surf);
    }
    if (!fingerless) b.add(K.at(K.rbox(0.016, 0.052, 0.012, 0.004, 1), gripR + 0.034, -0.004, 0.02), surf);
    b.add(K.tube([v3(gripR + 0.012, 0.042, 0.026), v3(0.004, 0.048, -0.006), v3(-gripR * 0.4, 0.046, -0.03), v3(-gripR - 0.006, 0.04, -0.048)], [0.011 * bulk, 0.01, 0.009, 0.0075], 6, Y), surf);
    b.add(K.at(K.sphere(0.01, 0.009, 0.01, 6, 4), gripR * 0.15, 0.046, -0.02), surf);
    if (fingerless) b.add(K.at(K.cyl(0.032, 0.03, 0.014, 8, 'y'), gripR * 0.45 + 0.01, -0.068, 0.02, 0, 0, 0.12), cuffSurf);
    else {
      b.add(K.at(K.cyl(0.04, 0.042, 0.042, 10, 'y'), gripR * 0.45 + 0.01, -0.084, 0.022, 0, 0, 0.12), cuffSurf);
      b.add(K.at(K.cyl(0.044, 0.044, 0.008, 10, 'y'), gripR * 0.45 + 0.01, -0.066, 0.022), { c: 0x121316, r: 0.75 });
    }
  }
  function forearm(b, surf, cuffSurf, from, dir, len, team) {
    const d = dir.clone().normalize(), rolled = team === 'atk';
    const bare = rolled ? 0.1 : 0, L = rolled ? len * 0.78 : len;
    if (rolled) b.add(K.tube([from.clone(), from.clone().addScaledVector(d, bare)], [0.026, 0.031], 8), SKIN);
    const pts = [], rad = [], steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(from.clone().addScaledVector(d, bare + (L - bare) * t));
      let radius = (0.03 + 0.012 * Math.pow(t, 0.75)) * (1 + 0.04 * Math.sin(t * 21));
      radius *= 1 + 0.08 * Math.exp(-Math.pow((t - 0.38) * 7, 2)) + 0.06 * Math.exp(-Math.pow((t - 0.66) * 7, 2));
      if (rolled && t < 0.16) radius *= 1.22;
      rad.push(radius);
    }
    b.add(K.tube(pts, rad, 10), surf);
    const cuffAt = rolled ? bare + 0.012 : 0.012;
    b.add(K.tube([from.clone().addScaledVector(d, cuffAt), from.clone().addScaledVector(d, cuffAt + (rolled ? 0.045 : 0.05))], rolled ? [0.046, 0.04] : [0.038, 0.04], 10), cuffSurf);
    if (!rolled) b.add(K.tube([from.clone().addScaledVector(d, 0.055), from.clone().addScaledVector(d, 0.078)], [0.034, 0.033], 8), cuffSurf);
  }
  // hand placement per weapon: [position from the gun data, Euler of the grip axis, forearm direction]
  function proceduralArms(id, team) {
    const gm = G.GunModels.get(id), b = new K.Builder(), sv = SLEEVE[team], gv = GLOVE[team], cf = CUFF[team];
    const place = (geoFn, pos, eu) => {
      const sub = new K.Builder(); geoFn(sub);
      const g = sub.build(), k = eu[3] || 1;
      g.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(eu[0], eu[1], eu[2], 'XYZ')), new THREE.Vector3(k, k, k)));
      b.parts.push(g);
    };
    const rh = gm.rightHand, lh = gm.leftHand;
    if (gm.hold === 'rifle' || gm.hold === 'pistol') {
      place((s) => gripHand(s, gv, cf, 0.017, team), rh, [-0.28, 0, 0, 1.12]);
      const wristR = rh.clone().add(new THREE.Vector3(0.02, -0.07, 0.045));
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.28, -0.42, 1), 0.55, team), wristR, [0, 0, 0]);
      if (gm.hold === 'rifle') {
        // support hand under the handguard: grip axis along the barrel, palm below
        place((s) => gripHand(s, gv, cf, 0.027, team), lh, [Math.PI / 2, 0, -Math.PI / 2 - 0.35, 1.12]);
        place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.78, -0.4, 0.48), 0.62, team), lh.clone().add(new THREE.Vector3(-0.05, -0.035, 0.025)), [0, 0, 0]);
      } else {
        place((s) => gripHand(s, gv, cf, 0.026, team), lh, [-0.28, Math.PI, 0, 0.92]);
        place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.42, -0.4, 0.8), 0.6, team), lh.clone().add(new THREE.Vector3(-0.03, -0.06, 0.05)), [0, 0, 0]);
      }
    } else if (gm.hold === 'knife') {
      place((s) => gripHand(s, gv, cf, 0.015, team), rh, [Math.PI / 2 - 0.2, 0, 0]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.3, -0.5, 1), 0.55, team), rh.clone().add(new THREE.Vector3(0.02, -0.035, 0.06)), [0, 0, 0]);
    } else {
      const right = gm.vmMaterial ? rh : new THREE.Vector3(.1,.02,0);
      const left = gm.vmMaterial ? lh : new THREE.Vector3(-.1,.02,0);
      place((s) => gripHand(s, gv, cf, 0.02, team), right, [0, 0, -0.3]);
      place((s) => gripHand(s, gv, cf, 0.02, team), left, [0, Math.PI, 0.3]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(0.3, -0.45, 0.8), 0.55, team), right.clone().add(new THREE.Vector3(.02,-.07,.04)), [0, 0, 0]);
      place((s) => forearm(s, sv, cf, new THREE.Vector3(), new THREE.Vector3(-0.3, -0.45, 0.8), 0.55, team), left.clone().add(new THREE.Vector3(-.02,-.07,.04)), [0, 0, 0]);
    }
    return b.build();
  }
  // Rocketbox mesh in bind space, with the fingers already articulated. Both hands
  // share one draw call. Only positions and normals vary between equipped items.
  const realArms = {};
  function readSide(buf, meta) {
    const n = meta.vertexCount, o = meta.offset, count = meta.indexCount;
    if (!n || !count || count % 3 || o + 26*n + 2*count > buf.byteLength) throw new Error('Invalid arm geometry');
    const vector = a => new THREE.Vector3().fromArray(a);
    return {
      n, joints: meta.joints.map(vector), contact: vector(meta.contact),
      frame: frame(vector(meta.forward), vector(meta.indexEdge)),
      pos: new Float32Array(buf, o, 3*n), uv: new Float32Array(buf, o+12*n, 2*n),
      norm: new Int8Array(buf, o+20*n, 3*n), weights: new Uint8Array(buf, o+23*n, 3*n),
      index: new Uint16Array(buf, o+26*n, count),
    };
  }
  function topology(sides) {
    const count = sides.reduce((sum, s) => sum+s.n, 0);
    const uv = new Float32Array(count*2), indices = [];
    let offset = 0;
    for (const s of sides) {
      uv.set(s.uv, 2*offset);
      for (const i of s.index) indices.push(offset+i);
      offset += s.n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // paint() uses the position count. Each pose replaces this attribute.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count*3), 3));
    G.Gfx.paint(geo, [1,1,1], .8, 0);
    geo.deleteAttribute('position');
    geo.setIndex(indices);
    return geo;
  }
  async function loadTeamArms(team) {
    if (realArms[team]) return;
    const base = 'assets/chars/', loader = new THREE.TextureLoader();
    async function file(name) {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
      return r;
    }
    const name = 'fparms_' + team;
    const [meta, buf] = await Promise.all([file(name+'.json').then(r => r.json()), file(name+'.bin').then(r => r.arrayBuffer())]);
    const R = readSide(buf, meta.sides.R), L = readSide(buf, meta.sides.L);
    const opts = { viewmodel: true };
    await Promise.all(['map','normalMap','roughnessMap'].map(async key => {
      const t = await loader.loadAsync(base + meta.material[key]);
      t.anisotropy = G.Tex.aniso || 1;
      opts[key] = t;
    }));
    const mat = G.Gfx.litMaterial(opts);
    for (const k of ['uSunDir','uSunVis','uAmbient']) mat.uniforms[k] = gunMat.uniforms[k];
    realArms[team] = { R, L, mat, both: topology([R,L]), right: topology([R]) };
  }
  let loadingArms;
  VM.loadArms = async function () {
    if (G.Gfx.preset.key === 'low') return;
    if (loadingArms) return loadingArms;
    // Finish both teams before shader warm-up, even if one needs the fallback.
    loadingArms = Promise.all(['atk','def'].map(team => loadTeamArms(team).catch(e => e))).then(results => {
      const failure = results.find(Boolean);
      if (failure) throw failure;
    });
    try { await loadingArms; } finally { loadingArms = null; }
  };

  // An orthonormal frame from a longitudinal direction and a reference across it.
  function frame(along, across) {
    const x = along.clone().normalize(), z = new THREE.Vector3().crossVectors(x, across).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, z.clone().cross(x), z));
  }
  function handFrame(id, hold, right) {
    const v = (x,y,z) => new THREE.Vector3(x,y,z);
    // The axes point from wrist to knuckles and from the pinky to the index.
    if (hold === 'knife') return frame(v(-.9,-.35,-.46), v(.42,.05,-1));
    if (!right && hold === 'rifle') return frame(v(.92,.20,-.34), v(-.34,0,-.92));
    if (hold === 'bomb') return frame(v(right ? -.3 : .3,-.35,-1), v(0,1,-.35));
    if (!right && G.Weapons.defs[id] && G.Weapons.defs[id].slot === 'grenade')
      return frame(v(.6,.45,-.7), v(-.4,1,0));
    return frame(v(right ? 0 : .37,-.19,-1), v(0,1,-.22));
  }
  // Affine skin transform, with optional length adjustment along the bind bone
  // only. The fixed viewmodel offsets can put a long handguard past full reach.
  function boneMatrix(from, to, rot, along, stretch) {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(rot);
    if (stretch !== 1) {
      const a = along.toArray(), scale = new THREE.Matrix4();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        scale.elements[i+4*j] += (stretch-1)*a[i]*a[j];
      m.multiply(scale);
    }
    return m.setPosition(to.clone().sub(from.clone().applyMatrix4(m)));
  }
  function poseSide(s, right, gm, base, restRot, outP, outN, offset) {
    const sign = right ? 1 : -1, target = right ? gm.rightHand : gm.leftHand;
    const [upper, fore, hand] = s.joints;
    const handRot = handFrame(gm.id, gm.hold, right).multiply(s.frame.clone().invert());
    const wrist = target.clone().sub(s.contact.clone().sub(hand).applyQuaternion(handRot));
    // Solve in holder space so animations can continue moving the complete pose.
    const inv = restRot.clone().invert();
    const shoulder = new THREE.Vector3(sign*.19,-.26,.17).sub(base).applyQuaternion(inv);
    const toWrist = wrist.clone().sub(shoulder), reach = toWrist.length(), aim = toWrist.normalize();
    const bindUpper = fore.clone().sub(upper), bindFore = hand.clone().sub(fore);
    const u = bindUpper.length(), f = bindFore.length();
    // Put most of the extra reach into the upper sleeve, just outside the frame.
    const extra = Math.max(0, reach/.94-u-f);
    const l1 = u+.75*extra, l2 = f+.25*extra;
    const along = (l1*l1-l2*l2+reach*reach)/(2*reach);
    const pole = new THREE.Vector3(sign*.65,-1,.08).applyQuaternion(inv);
    pole.addScaledVector(aim, -pole.dot(aim)).normalize();
    const elbow = shoulder.clone().addScaledVector(aim, along).addScaledVector(pole, Math.sqrt(Math.max(0,l1*l1-along*along)));
    const upperDir = elbow.clone().sub(shoulder).normalize(), foreDir = wrist.clone().sub(elbow).normalize();
    const bindBend = bindUpper.clone().cross(bindFore), bend = upperDir.clone().cross(foreDir);
    const upperRot = frame(upperDir, bend).multiply(frame(bindUpper, bindBend).invert());
    // Transport the wrist roll up the forearm to avoid twisting the cuff at the hand.
    const foreRot = new THREE.Quaternion().setFromUnitVectors(bindFore.clone().normalize().applyQuaternion(handRot), foreDir).multiply(handRot);
    const matrices = [boneMatrix(upper, shoulder, upperRot, bindUpper.normalize(), l1/u),
      boneMatrix(fore, elbow, foreRot, bindFore.normalize(), l2/f), boneMatrix(hand, wrist, handRot, null, 1)];
    const normals = matrices.map(m => new THREE.Matrix3().getNormalMatrix(m));
    const p = new THREE.Vector3(), n = p.clone(), t = p.clone(), pos = p.clone(), norm = p.clone();
    for (let i = 0; i < s.n; i++) {
      p.fromArray(s.pos, i*3); n.fromArray(s.norm, i*3);
      pos.set(0,0,0); norm.set(0,0,0);
      for (let j = 0; j < 3; j++) {
        const w = s.weights[3*i+j]/255;
        if (!w) continue;
        pos.addScaledVector(t.copy(p).applyMatrix4(matrices[j]), w);
        norm.addScaledVector(t.copy(n).applyMatrix3(normals[j]), w);
      }
      pos.toArray(outP, (offset+i)*3); norm.normalize().toArray(outN, (offset+i)*3);
    }
  }
  function buildArms(id, team) {
    const data = realArms[team];
    if (!data) return proceduralArms(id, team);
    const gm = G.GunModels.get(id), left = gm.hold !== 'knife' && gm.leftHand;
    const shared = left ? data.both : data.right, geo = new THREE.BufferGeometry();
    for (const k of Object.keys(shared.attributes)) geo.setAttribute(k, shared.attributes[k]);
    geo.setIndex(shared.index);
    const pos = new Float32Array(shared.attributes.uv.count*3), norm = new Float32Array(pos.length);
    const base = new THREE.Vector3().fromArray(BASE[id] || grenadeBase);
    const restRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(restPitch(id), restYaw(id), 0));
    poseSide(data.R, true, gm, base, restRot, pos, norm, 0);
    if (left) poseSide(data.L, false, gm, base, restRot, pos, norm, data.R.n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('normal', new THREE.BufferAttribute(norm,3));
    return geo;
  }
  function restPitch(id) { return id === 'knife' ? .04-.25 : .04; }
  function restYaw(id) { return id === 'knife' ? .045+.35 : .045; }
  function armMat(team) {
    if (realArms[team]) return realArms[team].mat;
    if (!armMats[team]) {
      const camo = team === 'atk' ? [K.lin(0x8d7b57), K.lin(0x4a4532)] : [K.lin(0x46505d), K.lin(0x1d2229)];
      const m = G.Gfx.litMaterial({ detail: 'cloth', camo, viewmodel: true, detailScale: 5 });
      for (const k of ['uSunDir','uSunVis','uAmbient']) m.uniforms[k] = gunMat.uniforms[k];
      armMats[team] = m;
    }
    return armMats[team];
  }

  VM.setWeapon = function (id, team) {
    const gm = G.GunModels.get(id);
    if (id === curId && team === curTeam && VM.cur.gm === gm && VM.cur.armData === realArms[team]) return;
    const key = id + '|' + team;
    if (!guns[key] || guns[key].gm !== gm || guns[key].armData !== realArms[team]) {
      if (guns[key]) guns[key].arms.geometry.dispose();
      const material = gm.vmMaterial || gunMat;
      if (gm.vmMaterial) {
        for (const k of ['uSunDir','uSunVis','uAmbient']) material.uniforms[k] = gunMat.uniforms[k];
      }
      const body = new THREE.Mesh(gm.body,material);
      const mag = gm.reloadShell ? new THREE.Mesh(gm.reloadShell,gunMat) : gm.mag && new THREE.Mesh(gm.mag,material);
      const arms = new THREE.Mesh(buildArms(id, team), armMat(team));
      const action = gm.action && new THREE.Mesh(gm.action,material);
      [body, mag, action, arms].forEach((m) => { if (m) m.frustumCulled = false; });
      guns[key] = { body, mag, arms, gm, action, armData: realArms[team] };
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
    for (const k in guns) {
      const g = guns[k];
      holder.add(g.body,g.arms); if (g.mag) holder.add(g.mag); if (g.action) holder.add(g.action);
    }
    flash.visible = flash2.visible = true;
    renderer.compile(scene, cam);
    flash.visible = flash2.visible = false;
    curId = null; VM.setWeapon('knife', 'atk');
  };

  VM.onShoot = function (d) {
    const m = d.model;
    const heavy = d.scope || d.shell || m === 'box';
    st.kick += heavy ? 0.078 : m === 'heavy' ? 0.055 : d.slot === 'pistol' ? 0.034 : 0.029;
    st.kickRot += heavy ? 0.18 : m === 'heavy' ? 0.20 : d.slot === 'pistol' ? 0.11 : 0.057;
    st.kickSide = (Math.random() - 0.5) * (heavy ? 0.045 : 0.029);
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
    let rx = restPitch(id) + st.kickRot, ry = restYaw(id) + st.swayX * 1.5 + st.kickSide, rz = st.swayX * 2 + st.kickSide * 0.8 + Math.sin(st.bob) * 0.012 * f;
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
    if (magDrop && VM.cur.gm.vmMaterial && VM.cur.gm.mag) {
      const pivot = VM.cur.gm.magPivot;
      magMesh.position.add(pivot).sub(rotatedPivot.copy(pivot).applyQuaternion(magMesh.quaternion));
    }
    if (id === 's8' && magMesh) { magMesh.visible = st.reloadT >= 0; magMesh.position.y=-0.09*(1-Math.max(0,st.reloadT)); }
    if (VM.cur.action) {
      const t=G.clamp((G.time-p.lastShot-0.07)/0.45,0,1), travel=Math.sin(t*Math.PI);
      VM.cur.action.position.z=travel*(id==='s8' ? 0.095 : 0.058);
      if (id==='s40') {
        const action = VM.cur.action;
        action.rotation.z=travel*0.45;
        if (VM.cur.gm.vmMaterial) {
          const axis = VM.cur.gm.muzzle;
          rotatedPivot.set(axis.x,axis.y,0).applyQuaternion(action.quaternion);
          action.position.x = axis.x-rotatedPivot.x; action.position.y = axis.y-rotatedPivot.y;
        }
      }
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
    if (p.planting || p.defusing) { y -= 0.06; rx -= 0.5; }
    holder.position.set(x, y, z); holder.rotation.set(rx, ry, rz);
    // muzzle flash
    st.flashT -= dt;
    flash.visible = flash2.visible = st.flashT > 0 && id !== 'knife' && id !== 'bomb';
  };
  const grenadeBase = [.105,-.15,-.34];
  const rotatedPivot = new THREE.Vector3();
  const tmpC = new THREE.Color();
  VM.render = function (renderer) {
    if (!scene || !holder.visible) return;
    renderer.clearDepth();
    renderer.render(scene, cam);
  };
})(window.G);
