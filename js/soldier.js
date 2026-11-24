// soldier.js — third-person models, procedural animation and ragdoll skinning.
(function (G) {
  'use strict';
  const THREE = G.THREE, K = G.Geo, RD = G.Ragdoll;
  const BM = G.BotModel = {};
  const BONES = ['pelvis', 'spine', 'chest', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
  const BI = {}; BONES.forEach((n, i) => (BI[n] = i));
  // bind pose joints (facing -Z, right side +X, feet at y = 0)
  const J = {
    pelvis: [0, 0.97, 0], spine: [0, 1.09, 0], chest: [0, 1.3, 0], head: [0, 1.52, 0],
    uarmL: [-0.195, 1.44, 0], farmL: [-0.214, 1.15, 0.01], handL: [-0.224, 0.905, 0],
    uarmR: [0.195, 1.44, 0], farmR: [0.214, 1.15, 0.01], handR: [0.224, 0.905, 0],
    thighL: [-0.1, 0.93, 0], shinL: [-0.106, 0.51, 0], footL: [-0.11, 0.095, 0],
    thighR: [0.1, 0.93, 0], shinR: [0.106, 0.51, 0], footR: [0.11, 0.095, 0],
  };
  const L_THIGH = 0.42, L_SHIN = 0.415, L_UARM = 0.291, L_FARM = 0.25;
  // body proportions the animation works from; the realistic models bring their own (BM.loadReal)
  function proportions(j, head, lengths) {
    const offset = (a, b) => new THREE.Vector3().fromArray(j[a]).sub(new THREE.Vector3().fromArray(j[b]));
    return {
      J: j, headOff: [head[0] - j.head[0], head[1] - j.head[1], head[2] - j.head[2]],
      pelY: j.pelvis[1], footX: j.footR[0], footY: j.footR[1],
      hipL: offset('thighL', 'pelvis'), hipR: offset('thighR', 'pelvis'),
      spine: offset('spine', 'pelvis'), chest: offset('chest', 'spine'), neck: offset('head', 'chest'),
      shoulderL: offset('uarmL', 'chest'), shoulderR: offset('uarmR', 'chest'),
      lThigh: lengths.thigh, lShin: lengths.shin, lUarm: lengths.uarm, lFarm: lengths.farm,
    };
  }
  const PROP0 = proportions(J, [0, 1.635, 0.006], { thigh: L_THIGH, shin: L_SHIN, uarm: L_UARM, farm: L_FARM });
  const sst = (a, b, v) => { const t = G.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- team looks (surfaces: c colour, r roughness, m metal, z fabric weave, w camouflage) ----------
  const TEAMS = {
    atk: {
      camo: [K.lin(0x8d7b57), K.lin(0x4a4532)],
      shirt: { c: 0x5e533c, r: 0.88, z: 1 }, pants: { c: 0x6b6648, r: 0.86, z: 1, w: 1 },
      rig: { c: 0x6b5839, r: 0.82, z: 0.8 }, pouch: { c: 0x5a4a32, r: 0.82, z: 0.8 }, strap: { c: 0x3d3326, r: 0.8, z: 0.5 },
      hood: { c: 0x2c2a25, r: 0.92, z: 1 }, scarf: { c: 0xa48f68, r: 0.92, z: 1 }, cap: { c: 0x4c4f35, r: 0.86, z: 0.7 }, skin: { c: 0x8e5f45, r: 0.55 }, eye: { c: 0x0c0b0a, r: 0.15 },
      glove: { c: 0x2b2723, r: 0.7, z: 0.3 }, boot: { c: 0x4c3524, r: 0.62 }, sole: { c: 0x1c1915, r: 0.9 }, belt: { c: 0x3a3226, r: 0.7 }, metal: { c: 0x8c8c86, r: 0.35, m: 0.85 },
    },
    def: {
      camo: [K.lin(0x46505d), K.lin(0x1d2229)],
      shirt: { c: 0x2b323d, r: 0.86, z: 1, w: 1 }, pants: { c: 0x2b323d, r: 0.86, z: 1, w: 1 },
      rig: { c: 0x363d49, r: 0.8, z: 0.8 }, pouch: { c: 0x2f3540, r: 0.8, z: 0.8 }, strap: { c: 0x23272e, r: 0.8, z: 0.5 },
      hood: { c: 0x18181a, r: 0.92, z: 1 }, scarf: { c: 0x22252b, r: 0.9, z: 1 }, helmet: { c: 0x4b4f46, r: 0.55 }, goggle: { c: 0x090a0c, r: 0.06, m: 0.4 }, patch: { c: 0x98a1ab, r: 0.8, z: 0.5 },
      skin: { c: 0xa57a5e, r: 0.55 }, eye: { c: 0x0c0b0a, r: 0.15 }, black: { c: 0x141517, r: 0.6 },
      glove: { c: 0x26282c, r: 0.7, z: 0.3 }, boot: { c: 0x1b1b1d, r: 0.6 }, sole: { c: 0x101010, r: 0.9 }, belt: { c: 0x1e2126, r: 0.7 }, metal: { c: 0x8c8c86, r: 0.35, m: 0.85 },
    },
  };

  const TINTS = {
    atk: [[1, 1, 1], [1.10, 1.04, .90], [1.02, .94, .84], [.91, .95, .90], [1.07, 1.00, .95]],
    def: [[1, 1, 1], [.86, .96, 1.12], [.92, .97, 1.06], [1.00, 1.04, 1.08], [.91, .91, .98]],
  };
  const NEUTRAL_SURFACE = [.08, 1, 0];
  function soldierMaterials(team, opts, surface, tint = TINTS[team]) {
    return tint.map((color) => G.Gfx.litMaterial(Object.assign({
      skinning: true, soldierTint: color, soldierSurface: surface,
    }, opts)));
  }

  // ---------- model ----------
  function skinAttr(geo, w) {
    const n = geo.attributes.position.count, si = new Float32Array(n * 4), sw = new Float32Array(n * 4), pos = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      const r = typeof w === 'number' ? [w, 1, 0, 0] : w(pos.getY(i));
      si[i * 4] = r[0]; sw[i * 4] = r[1]; si[i * 4 + 1] = r[2]; sw[i * 4 + 1] = r[3];
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    return geo;
  }
  function buildModel(team, far, economical) {
    const T = TEAMS[team], b = new K.Builder();
    const add = (geo, surf, w) => b.add(skinAttr(geo, w), surf);
    const at = K.at, rbox = far ? K.box : K.rbox;
    // Far silhouettes stay under 3k triangles; medium and low use a coarser far mesh than high and ultra.
    const resolution = far ? (economical ? 0.30 : 0.40) : (economical ? 0.72 : 1);
    const minW = far ? (economical ? 5 : 6) : 6, minH = far ? (economical ? 3 : 4) : 4;
    const sph = (x,y,z,w,h) => K.sphere(x,y,z,Math.max(minW,Math.round(w*resolution)),Math.max(minH,Math.round(h*resolution)));
    const tube = (points,radii,seg) => K.tube(points,radii,Math.max(far && economical ? 4 : 5,Math.round(seg*resolution)));
    const cyl = (r0,r1,len,seg,axis) => K.cyl(r0,r1,len,far ? Math.max(5,Math.round(seg*(economical ? 0.5 : 0.7))) : seg,axis);
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    // torso
    const torsoW = (y) => (y < 1.0 ? [BI.pelvis, 1, BI.spine, 0] : y < 1.13 ? [BI.pelvis, 1 - sst(1.0, 1.13, y), BI.spine, sst(1.0, 1.13, y)]
      : y < 1.25 ? [BI.spine, 1 - sst(1.13, 1.25, y), BI.chest, sst(1.13, 1.25, y)] : y < 1.46 ? [BI.chest, 1, BI.head, 0] : [BI.chest, 1 - sst(1.46, 1.56, y), BI.head, sst(1.46, 1.56, y)]);
    add(tube([v3(0, 0.86, 0.01), v3(0, 0.95, 0.008), v3(0, 1.03, 0.004)], [[0.165, 0.112], [0.17, 0.118], [0.158, 0.108]], 16), T.pants, torsoW);
    add(tube([v3(0, 1.01, 0.004), v3(0, 1.1, 0), v3(0, 1.2, -0.004), v3(0, 1.3, -0.006), v3(0, 1.39, 0), v3(0, 1.445, 0.006), v3(0, 1.48, 0.01)],
      [[0.152, 0.104], [0.152, 0.106], [0.165, 0.115], [0.18, 0.122], [0.182, 0.115], [0.15, 0.098], [0.075, 0.07]], 16), T.shirt, torsoW);
    add(at(rbox(0.35, 0.055, 0.24, 0.025, 1), 0, 1.02, 0.005), T.belt, BI.pelvis);
    add(at(K.box(0.05, 0.035, 0.012), 0, 1.02, -0.123), T.metal, BI.pelvis);
    for (const s of [-1, 1]) add(at(sph(0.068, 0.064, 0.07, 12, 8), s * 0.172, 1.405, 0), T.shirt, BI.chest);
    add(tube([v3(0, 1.44, 0.01), v3(0, 1.52, 0.012), v3(0, 1.58, 0.012)], [0.062, 0.06, 0.057], 12), T.hood, torsoW);
    add(tube([v3(0, 1.43, 0.004), v3(0, 1.5, 0.004)], [[0.1, 0.092], [0.085, 0.082]], 14), T.scarf, torsoW);
    // load-bearing gear
    if (team === 'atk') {
      add(at(rbox(0.31, 0.17, 0.05, 0.015, 1), 0, 1.22, -0.118), T.rig, BI.chest);
      for (let i = 0; i < 4; i++) add(at(rbox(0.066, 0.11, 0.045, 0.012, 1), -0.105 + i * 0.07, 1.21, -0.152), T.pouch, BI.chest);
      for (const s of [-1, 1]) add(at(rbox(0.05, 0.022, 0.25, 0.01, 1), s * 0.1, 1.445, 0), T.strap, BI.chest);
      for (const s of [-1, 1]) add(at(K.box(0.04, 0.32, 0.012), 0, 1.3, 0.12, 0, 0, s * 0.55), T.strap, BI.chest);
      add(at(rbox(0.05, 0.085, 0.085, 0.015, 1), -0.19, 1.13, 0.03), T.pouch, BI.spine);
      add(at(rbox(0.14, 0.12, 0.07, 0.02, 1), 0.06, 1.0, 0.13), T.pouch, BI.pelvis);   // butt pack
    } else {
      add(at(rbox(0.31, 0.3, 0.055, 0.02, 1), 0, 1.28, -0.12), T.rig, BI.chest);
      add(at(rbox(0.32, 0.32, 0.05, 0.02, 1), 0, 1.3, 0.13), T.rig, BI.chest);
      for (const s of [-1, 1]) add(at(rbox(0.05, 0.16, 0.22, 0.02, 1), s * 0.19, 1.2, 0), T.rig, BI.chest);
      for (const s of [-1, 1]) add(at(rbox(0.08, 0.03, 0.26, 0.012, 1), s * 0.12, 1.45, 0), T.strap, BI.chest);
      for (let i = 0; i < 3; i++) add(at(rbox(0.074, 0.1, 0.045, 0.012, 1), -0.085 + i * 0.085, 1.19, -0.166), T.pouch, BI.chest);
      add(at(K.box(0.085, 0.05, 0.006), 0.075, 1.375, -0.149), T.patch, BI.chest);
      add(at(rbox(0.065, 0.13, 0.05, 0.012, 1), -0.1, 1.3, 0.175), T.pouch, BI.chest);
      add(at(cyl(0.004, 0.004, 0.26, 5, 'y'), -0.12, 1.5, 0.175), T.black, BI.chest);
      add(at(rbox(0.05, 0.16, 0.09, 0.015, 1), 0.185, 0.76, 0.01), T.black, BI.thighR);   // holster
    }
    // head
    const headSurf = T.hood;
    const hy = -0.03;   // head height offset
    add(at(sph(0.097, 0.116, 0.107, 16, 12), 0, 1.665 + hy, 0.006), headSurf, BI.head);
    add(at(sph(0.072, 0.056, 0.077, 12, 8), 0, 1.6 + hy, -0.028), headSurf, BI.head);
    add(at(rbox(0.022, 0.04, 0.032, 0.01, 1), 0, 1.66 + hy, -0.104), headSurf, BI.head);
    for (const s of [-1, 1]) add(at(sph(0.016, 0.03, 0.022, 8, 6), s * 0.098, 1.66 + hy, 0.004), headSurf, BI.head);
    if (team === 'atk') {
      // balaclava with an eye opening, field cap
      add(at(rbox(0.104, 0.032, 0.03, 0.012, 1), 0, 1.688 + hy, -0.087), T.skin, BI.head);
      for (const s of [-1, 1]) add(at(sph(0.012, 0.011, 0.008, 8, 6), s * 0.032, 1.688 + hy, -0.099), T.eye, BI.head);
      // Wrapped crown, asymmetric scarf tail and alternating woven bands.
      add(at(sph(.109,.083,.115,20,12),0,1.70,.008), T.scarf, BI.head);
      add(at(sph(.062,.134,.037,14,8),-.046,1.565,.094,-.16,.12,-.18),T.scarf,BI.head);
      const stripe={c:0x80523c,r:.91,z:1};
      for(let i=0;i<(far?2:5);i++) {
        const band=K.torus(.097,.008,far?3:5,far?10:24);
        at(band,0,1.666+i*.012,.008,Math.PI*.49,.07,-.09,1,1.08,1);
        add(band,i%2 ? stripe : T.scarf,BI.head);
      }
      add(at(sph(.103,.066,.083,16,8),0,1.585,-.028),T.scarf,BI.head);
    } else {
      // helmet with rails, mount and ear defenders; goggles over a face mask
      add(at(rbox(0.1, 0.022, 0.03, 0.01, 1), 0, 1.72 + hy, -0.09), T.skin, BI.head);
      add(at(sph(0.122, 0.104, 0.132, 16, 10), 0, 1.712 + hy, 0.008), T.helmet, BI.head);
      for (const s of [-1, 1]) add(at(K.box(0.008, 0.022, 0.12), s * 0.12, 1.69 + hy, 0), T.black, BI.head);
      add(at(rbox(0.045, 0.032, 0.024, 0.008, 1), 0, 1.76 + hy, -0.126), T.black, BI.head);
      for (const s of [-1, 1]) add(at(cyl(0.036, 0.036, 0.034, 12, 'x'), s * 0.112, 1.655 + hy, 0), T.black, BI.head);
      add(at(rbox(.19,.053,.043,.016,1),0,1.666,-.103),T.black,BI.head);
      for (const s of [-1,1]) add(at(sph(.045,.021,.016,14,8),s*.046,1.667,-.119,0,s*.19),{c:0x40585a,r:.16,m:.35},BI.head);
      if (!far) {
        add(tube([v3(.126,1.626,-.013),v3(.128,1.603,-.062),v3(.061,1.601,-.11)],[.005,.005,.006],7),T.black,BI.head);
        add(at(sph(.018,.009,.008,8,6),.057,1.601,-.111),T.black,BI.head);
      }
      for (const s of [-1, 1]) add(at(K.box(0.012, 0.018, 0.1), s * 0.1, 1.69 + hy, -0.03), T.strap, BI.head);
    }
    // arms: one tube from shoulder to wrist, bending at the elbow
    for (const s of [-1, 1]) {
      const U = s < 0 ? BI.uarmL : BI.uarmR, F = s < 0 ? BI.farmL : BI.farmR, H = s < 0 ? BI.handL : BI.handR;
      const pts = [v3(s * 0.19, 1.47, 0), v3(s * 0.2, 1.37, 0), v3(s * 0.207, 1.26, 0.004), v3(s * 0.214, 1.15, 0.01), v3(s * 0.218, 1.05, 0.006), v3(s * 0.222, 0.96, 0), v3(s * 0.224, 0.92, 0)];
      const armW = (y) => (y > 1.39 ? [U, 1 - sst(1.39, 1.47, y) * 0.6, BI.chest, sst(1.39, 1.47, y) * 0.6] : [U, 1 - sst(1.28, 1.02, y), F, sst(1.28, 1.02, y)]);
      pts.splice(3,0,v3(s*.212,1.188,.009));
      pts.splice(5,0,v3(s*.215,1.116,.010));
      const armRadius=[.070,.063,.055,.050,.049,.047,.045,.039,.036];
      if (team==='atk') {
        add(tube(pts.slice(0,4),armRadius.slice(0,4),14),T.shirt,armW);
        add(tube(pts.slice(3),armRadius.slice(3),14),T.skin,armW);
        add(tube([v3(s*.21,1.218,.008),pts[3],v3(s*.213,1.177,.009)],[.056,.058,.052],14),T.shirt,armW);
      } else add(tube(pts,armRadius,16),T.shirt,armW);
      add(tube([v3(s * 0.222, 0.965, 0), v3(s * 0.224, 0.93, 0)], [0.043, 0.042], 10), T.shirt, F);
      add(at(rbox(0.046, 0.085, 0.08, 0.02, 1), s * 0.226, 0.862, -0.006), T.glove, H);
      add(at(rbox(0.02, 0.046, 0.022, 0.009, 1), s * 0.206, 0.878, -0.043), T.glove, H);
      if (team === 'def') add(at(rbox(0.06, 0.07, 0.04, 0.015, 1), s * 0.214, 1.15, 0.046), T.black, F);
    }
    // legs: hip to ankle, bending at the knee
    for (const s of [-1, 1]) {
      const TH = s < 0 ? BI.thighL : BI.thighR, SH = s < 0 ? BI.shinL : BI.shinR, FT = s < 0 ? BI.footL : BI.footR;
      const pts = [v3(s * 0.1, 0.99, 0), v3(s * 0.103, 0.86, -0.004), v3(s * 0.106, 0.7, -0.006), v3(s * 0.106, 0.56, -0.004), v3(s * 0.106, 0.51, 0), v3(s * 0.108, 0.4, 0.006), v3(s * 0.11, 0.26, 0.008), v3(s * 0.11, 0.15, 0.004), v3(s * 0.11, 0.11, 0)];
      pts.splice(5,0,v3(s*.106,.475,.002));
      const legW = (y) => (y > 0.9 ? [TH, 1 - sst(0.9, 0.99, y) * 0.5, BI.pelvis, sst(0.9, 0.99, y) * 0.5] : [TH, 1 - sst(0.62, 0.40, y), SH, sst(0.62, 0.40, y)]);
      add(tube(pts, [0.093, 0.087, 0.075, 0.063, 0.064, 0.061, 0.058, 0.05, 0.044, 0.043], 16), T.pants, legW);
      if (team === 'atk') add(at(rbox(0.032, 0.13, 0.1, 0.012, 1), s * 0.186, 0.74, -0.008), T.pants, TH);
      else add(at(rbox(0.088, 0.1, 0.05, 0.02, 1), s * 0.106, 0.51, -0.062), T.black, SH);
      if (!far) {
        const cargo=team==='def'?T.pouch:T.rig;
        add(at(rbox(.035,.126,.115,.012,1),s*.18,.735,.008),cargo,TH);
        add(at(K.box(.043,.026,.119),s*.181,.785,.006,0,0,s*.06),T.strap,TH);
        for(let i=0;i<3;i++){
          const y=.26+i*.052;
          add(tube([v3(s*.109,y,.006),v3(s*.109,y+.018,.006),v3(s*.109,y+.033,.005)],
            [[.052+i*.002,.048+i*.002],[.058+i*.002,.055+i*.002],[.051+i*.002,.047+i*.002]],12),T.pants,SH);
        }
        if (!economical) for(let i=0;i<4;i++)
          add(at(K.box(.081,.006,.009),s*.11,.101+i*.009,-.104+i*.012,-.5,0,i%2 ? .10 : -.10),T.belt,FT);
      }
      add(at(cyl(0.053, 0.05, 0.12, 12, 'y'), s * 0.11, 0.15, 0), T.boot, SH);
      add(at(rbox(0.105, 0.13, 0.275, 0.03, 1), s * 0.11, 0.065, -0.045), T.boot, FT);
      add(at(rbox(0.112, 0.03, 0.285, 0.01, 1), s * 0.11, 0.015, -0.045), T.sole, FT);
    }
    if (!far) {
      // Distinct back silhouettes, visible when following teammates.
      if (team==='def') {
        add(at(rbox(.24,.25,.083,.029,1),0,1.287,.175),T.rig,BI.chest);
        for(let row=0;row<4;row++) for(const side of [-1,1]) {
          add(at(K.box(.083,.012,.009),side*.052,1.20+row*.041,.218),T.strap,BI.chest);
        }
        for (const side of [-1,1]) {
          add(at(K.box(.038,.18,.012),side*.113,1.31,-.152),T.strap,BI.chest);
          add(at(K.box(.042,.024,.016),side*.113,1.35,-.16),T.metal,BI.chest);
        }
      } else {
        add(at(rbox(.165,.12,.073,.024,1),.08,1.13,.149,0,.05,-.17),T.pouch,BI.spine);
        add(at(K.box(.052,.36,.017),.002,1.275,.131,0,0,-.83),T.scarf,BI.chest);
      }
      for(let i=0;i<(team==='def'?3:4);i++)
        add(at(K.box(.059,.028,.014),-.105+i*(team==='def' ? .085 : .07),1.226,-.181),T.strap,BI.chest);
    }
    return b.build();
  }
  const models = {}, distant = {}, mats = {};
  function modelFor(team) {
    if (!models[team]) {
      const economical = !G.Gfx.preset.movingShadow;
      models[team] = buildModel(team, false, economical);
      distant[team] = buildModel(team, true, economical);
      const bounds = new THREE.Sphere(new THREE.Vector3(0,.92,0),1.23);
      models[team].boundingSphere = bounds; distant[team].boundingSphere = bounds;
      mats[team] = soldierMaterials(team, { detail: 'cloth', camo: TEAMS[team].camo, detailScale: 3.4 }, NEUTRAL_SURFACE);
    }
    return { geo: models[team], mat: mats[team] };
  }

  // ---------- realistic soldiers ----------
  // Microsoft Rocketbox avatars (MIT licence, assets/chars/LICENSE-Rocketbox.txt), converted offline to
  // this 16-bone rig with every limb straight down; each carries its own joints and proportions.
  const REAL = { atk: ['atk1'], def: ['def1', 'def2'] };
  const real = {}, realTurn = { atk: 0, def: 0 };
  const geomBase = 'assets/chars/';
  let texBase = geomBase;
  let loadProgress = null;
  BM.setAssetBase = function (path) { texBase = path; };
  const realReady = () => [].concat(REAL.atk, REAL.def).every((n) => real[n]);
  async function fetchAsset(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    if (loadProgress) loadProgress(url, buf.byteLength);
    return buf;
  }
  async function loadTex(loader, file, aniso) {
    if (!file) return null;
    const url = texBase + file;
    if (loadProgress) {
      const buf = await fetchAsset(url);
      const objectUrl = URL.createObjectURL(new Blob([buf]));
      try {
        const t = await loader.loadAsync(objectUrl);
        t.anisotropy = aniso;
        return t;
      } finally { URL.revokeObjectURL(objectUrl); }
    }
    return new Promise((ok, no) => loader.load(url, (t) => { t.anisotropy = aniso; ok(t); }, undefined, no));
  }
  BM.loadReal = async function (opts) {
    loadProgress = opts && opts.onBytes || null;
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(G.Gfx.preset.key === 'ultra' ? 16 : 8, G.renderer.capabilities.getMaxAnisotropy());
    const tex = (f) => loadTex(loader, f, aniso);
    async function one(name) {
      const meta = JSON.parse(new TextDecoder().decode(await fetchAsset(geomBase + name + '.json')));
      const buf = await fetchAsset(geomBase + name + '.bin');
      const n = meta.vertexCount, geo = new THREE.BufferGeometry();
      const nb = new Int8Array(buf, n * 12, n * 4), nf = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { nf[i * 3] = nb[i * 4] / 127; nf[i * 3 + 1] = nb[i * 4 + 1] / 127; nf[i * 3 + 2] = nb[i * 4 + 2] / 127; }
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, n * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nf, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, n * 16, n * 2), 2));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf, n * 24, n * 4), 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(buf, n * 28, n * 4), 4, true));
      geo.setIndex(new THREE.BufferAttribute(new (meta.index32 ? Uint32Array : Uint16Array)(buf, n * 32, meta.indexCount), 1));
      G.Gfx.paint(geo, [1, 1, 1], 0.8, 0, 0, 0);
      for (const g of meta.groups) geo.addGroup(g.start, g.count, g.material);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.92, 0), 1.23);
      const team = name.slice(0, 3);
      const surfaces = await Promise.all(meta.materials.map(async (m) => {
        const [map, normalMap, roughnessMap] = await Promise.all([tex(m.map), tex(m.normalMap), tex(m.roughnessMap)]);
        const opts = { map, normalMap, roughnessMap };
        if (m.name.endsWith('_head')) {
          const skin = G.Gfx.litMaterial(Object.assign({
            skinning: true, soldierTint: [1, 1, 1], soldierSurface: [.49, .75, 0],
          }, opts));
          return TINTS[team].map(() => skin);
        }
        const surface = m.name.endsWith('_pistol') ? [.29, .67, .38] :
          m.name.endsWith('_helmet') ? [.5, .84, .05] :
          m.name.endsWith('_equipment') ? [.62, .93, 0] : [.68, .96, 0];
        return soldierMaterials(team, opts, surface);
      }));
      const mats = TINTS[team].map((_, i) => surfaces.map((materials) => materials[i]));
      const P = proportions(meta.joints, meta.headCenter, meta.lengths);
      real[name] = { geo, mats, P };
    }
    try { await Promise.all([].concat(REAL.atk, REAL.def).map(one)); }
    finally { loadProgress = null; }
  };
  BM.upgradeAgent = function (a) {
    if (!a.rig || a.rig.real || !a.alive || !realReady()) return;
    const list = REAL[a.team];
    if (!a.realName || list.indexOf(a.realName) < 0) a.realName = list[realTurn[a.team]++ % list.length];
    const model = real[a.realName];
    if (!model) return;
    const rig = a.rig;
    rig.mesh.geometry = model.geo;
    rig.mesh.material = model.mats[rig.variant];
    for (let i = 0; i < BONES.length; i++) {
      const j = model.P.J[BONES[i]];
      rig.mesh.skeleton.boneInverses[i].makeTranslation(-j[0], -j[1], -j[2]);
    }
    rig.P = model.P;
    rig.ready = false;
    rig.real = true;
  };
  BM.upgradeAgents = function () { G.Game.agents.forEach((a) => BM.upgradeAgent(a)); };

  // ---------- blob shadows ----------
  let blobs = null;
  const MAXB = 32;
  function initBlobs() {
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: G.Tex.tex('blob') } },
      vertexShader: 'varying vec2 vUv; varying float vK; void main(){ vUv = uv; vK = instanceColor.r; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vK; void main(){ float a = texture2D( map, vUv ).a * vK; gl_FragColor = vec4( vec3( 1.0 - a ), 1.0 ); }',
      transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    });
    blobs = new THREE.InstancedMesh(geo, mat, MAXB);
    blobs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    blobs.frustumCulled = false; blobs.renderOrder = 2; blobs.count = 0;
    G.scene.add(blobs);
  }
  const bm4 = new THREE.Matrix4(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bp = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function blob(i, x, y, z, ang, w, l, k) {
    bq.setFromAxisAngle(yAxis, ang); bs.set(w, 1, l); bp.set(x, y + 0.012, z);
    blobs.setMatrixAt(i, bm4.compose(bp, bq, bs));
    blobs.instanceColor.setXYZ(i, k, k, k);
  }
  BM.updateBlobs = function () {
    if (G.Gfx.preset.movingShadow) return;
    if (!blobs) initBlobs();
    const sd = G.sunDir, sx = -sd.x, sz = -sd.z, sl = Math.hypot(sx, sz) || 1, sang = Math.atan2(sx / sl, sz / sl);
    let n = 0;
    for (const a of G.Game.agents) {
      const rig = a.rig;
      if (!rig || n > MAXB - 2) continue;
      if (rig.rd) {
        RD.point(rig.rd, RD.P.PEL, tp[0]); RD.point(rig.rd, RD.P.HEA, tp[1]);
        const ang = Math.atan2(tp[1].x - tp[0].x, tp[1].z - tp[0].z);
        blob(n++, (tp[0].x + tp[1].x) / 2, floorAt(tp[0]), (tp[0].z + tp[1].z) / 2, ang, 0.9, 1.7, 0.55);
        continue;
      }
      if (!a.alive) continue;
      const h = G.bodyHeight(a.crouch) / 1.8, fy = a.pos.y;
      blob(n++, a.pos.x, fy, a.pos.z, 0, 0.75, 0.75, 0.42);
      if (rig.sun > 0.05) {
        const len = 1.9 * h;
        blob(n++, a.pos.x + sx / sl * len * 0.45, fy, a.pos.z + sz / sl * len * 0.45, sang, 0.55, len, 0.5 * rig.sun);
      }
    }
    blobs.count = n;
    blobs.instanceMatrix.needsUpdate = true; blobs.instanceColor.needsUpdate = true;
  };
  function floorAt(p) {
    const list = G.Map.query(p.x - 0.05, p.z - 0.05, p.x + 0.05, p.z + 0.05);
    let best = 0;
    for (const b of list) if (b.x0 <= p.x && b.x1 >= p.x && b.z0 <= p.z && b.z1 >= p.z && b.y1 <= p.y + 0.3 && b.y1 > best) best = b.y1;
    return best;
  }

  // ---------- create / remove ----------
  function newFoot() {
    return {
      point: new THREE.Vector3(), start: new THREE.Vector3(), target: new THREE.Vector3(),
      yaw: 0, startYaw: 0, targetYaw: 0, phase: 1, duration: 0, lift: 0,
      floorY: 0, inContact: true, gaitAlong: 0, gaitPitch: 0, gaitS: 1, heel: 0, shown: new THREE.Vector3(),
    };
  }
  function tag(name, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.font = 'bold 34px "Microsoft YaHei", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(name, 128, 32); g.fillStyle = color; g.fillText(name, 128, 32);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set(1.1, 0.28, 1); return s;
  }
  BM.create = function (a, showTag) {
    let model = null;
    if (realReady()) {
      const list = REAL[a.team];
      if (!a.realName || list.indexOf(a.realName) < 0) a.realName = list[realTurn[a.team]++ % list.length];
      model = real[a.realName];
    }
    const variant = (a.id || 0) % TINTS[a.team].length;
    const { geo, mat } = model ? { geo: model.geo, mat: model.mats } : modelFor(a.team);
    const P = model ? model.P : PROP0;
    const root = new THREE.Group();
    const bones = BONES.map((n) => { const b = new THREE.Bone(); b.position.fromArray(P.J[n]); root.add(b); return b; });
    const mesh = new THREE.SkinnedMesh(geo, mat[variant]);
    mesh.frustumCulled = true;
    mesh.layers.enable(4);
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    if (showTag) { a.tagSprite = tag(a.name, a.team === 'atk' ? '#ffb38a' : '#9fd0ff'); G.scene.add(a.tagSprite); }
    a.mesh = root;
    a.rig = {
      root, mesh, bones, P, variant, gun: null, gunId: null, gunModel: null, real: !!model, ready: false,
      feet: [newFoot(), newFoot()], nextFoot: variant % 2, stepping: -1, stepDelay: 0, poseYaw: 0,
      cycle: 0, duty: .6, moveBlend: 0, footBlend: 0, wasGait: false, stopT: 1, hipYaw: 0,
      dirX: 0, dirZ: 0, tx: 0, tz: -1, gaitSpeed: 0, span: 0, ux: 0, uz: 0, px: 1, pz: 0, pSnap: true, fr: null, backpedal: false, rootY: 0, baseY: 0, baseV: 0,
      lastPos: new THREE.Vector3(), lastVel: new THREE.Vector3(), deathVel: new THREE.Vector3(),
      speed: 0, vx: 0, vz: 0, leanX: 0, leanZ: 0, crouch: 0, kneel: 0, air: 0, takeoff: 0,
      idleSeed: Math.random() * Math.PI * 2, gait: 0, weight: 0, settle: 0, pelvisY: P.pelY,
      gestureName: '', gestureT: 0, throwing: 0, reload: 0, ground: true, landing: 0,
      hp: a.hp, hit: 0, hitX: 0, hitZ: 1, pitch: 0, recoil: 0, lastShot: -9, lower: 0, twist: 0,
      holdOffset: new THREE.Vector3(), headLocal: new THREE.Vector3(), headAt: -9,
      sun: 1, sunT: Math.random() * .15, rd: null, hidden: false,
    };
    G.scene.add(root);
    return root;
  };
  BM.remove = function (a) {
    if (a.rig) a.rig.mesh.skeleton.dispose();
    if (a.mesh) { G.scene.remove(a.mesh); a.mesh = null; }
    if (a.tagSprite) { G.scene.remove(a.tagSprite); a.tagSprite.material.map.dispose(); a.tagSprite.material.dispose(); a.tagSprite = null; }
    a.rig = null;
  };

  BM.gesture = function (a,name) {
    if (!a || !a.rig || (name !== 'throw' && name !== 'reload')) return;
    a.rig.gestureName = name; a.rig.gestureT = name === 'throw' ? .52 : .82;
  };
  BM.flinch = function (a, dx, dz) {
    const rig = a.rig;
    if (!rig) return;
    const length = Math.hypot(dx, dz);
    rig.hit = .23;
    rig.hp = a.hp;
    rig.hitX = length > .001 ? dx / length : -Math.sin(a.yaw);
    rig.hitZ = length > .001 ? dz / length : Math.cos(a.yaw);
  };
  BM.updateLOD = function (camera) {
    const threshold=G.Gfx.preset.movingShadow ? 20 : 13;
    for (const a of G.Game.agents) {
      if (!a.rig || a.rig.real) continue;
      const rig=a.rig, far=rig.mesh.geometry===distant[a.team];
      const cutoff=threshold+(far ? -1 : 1);
      const pos=rig.rd ? RD.point(rig.rd,RD.P.PEL,tp[0]) : a.pos;
      rig.mesh.geometry=camera.position.distanceToSquared(pos)>cutoff*cutoff ? distant[a.team] : models[a.team];
    }
  };

  // ---------- animation ----------
  const tp = Array.from({ length: 23 }, () => new THREE.Vector3());
  const tq = Array.from({ length: 8 }, () => new THREE.Quaternion());
  const DOWN = new THREE.Vector3(0, -1, 0);
  const ikD = new THREE.Vector3(), ikP = new THREE.Vector3();
  const damp = (a, b, rate, dt) => G.lerp(a, b, 1 - Math.exp(-rate * dt));

  // Solve the intermediate joint and the reachable endpoint of a two-bone chain.
  function ik(a, target, l1, l2, pole, mid, end) {
    ikD.subVectors(target, a);
    const length = ikD.length();
    if (length > 1e-5) ikD.divideScalar(length); else ikD.copy(DOWN);
    const d = G.clamp(length, Math.abs(l1 - l2) + .012, (l1 + l2) * .999);
    end.copy(a).addScaledVector(ikD, d);
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    ikP.copy(pole).addScaledVector(ikD, -pole.dot(ikD));
    if (ikP.lengthSq() < 1e-8) {
      if (Math.abs(ikD.x) < .8) ikP.set(1, 0, 0); else ikP.set(0, 0, 1);
      ikP.addScaledVector(ikD, -ikP.dot(ikD));
    }
    mid.copy(a).addScaledVector(ikD, x).addScaledVector(ikP.normalize(), h);
  }
  const dirQ = (q, from, to) => q.setFromUnitVectors(DOWN, tp[16].subVectors(to, from).normalize());
  function setB(rig, name, pos, q) { const b = rig.bones[BI[name]]; b.position.copy(pos); b.quaternion.copy(q); }

  const HOLD = {
    rifle: { off: [.098, .011, -.17], twist: -.30 },
    pistol: { off: [.035, .012, -.39], twist: -.055 },
    knife: { off: [.24, -.27, -.12], twist: -.02 },
    grenade: { off: [.19, -.04, -.23], twist: -.11 },
    bomb: { off: [0, -.33, -.26], twist: 0 },
  };
  const LEGS = [
    { thigh: 'thighL', shin: 'shinL', foot: 'footL', hip: 'hipL', side: -1 },
    { thigh: 'thighR', shin: 'shinR', foot: 'footR', hip: 'hipR', side: 1 },
  ];
  const qPel = new THREE.Quaternion(), qSp = new THREE.Quaternion(), qCh = new THREE.Quaternion();
  const qHd = new THREE.Quaternion(), qGun = new THREE.Quaternion(), qFree = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const poseQ = (q, x, y, z) => q.setFromEuler(eul.set(x, y, z));
  const HAND_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.35, 0, 0));
  const HAND_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.35, 0, .4));
  const legPole = new THREE.Vector3();
  const footL = new THREE.Vector3(), footR = new THREE.Vector3();

  function footHome(out, a, P, side, cy, sy) {
    const x = side * (P.footX + .016), z = side * .035;
    return out.set(a.pos.x + x * cy + z * sy, a.pos.y + P.footY, a.pos.z - x * sy + z * cy);
  }

  function resetPose(a, rig) {
    rig.ready = true;
    rig.round = G.Game.round;
    rig.lastPos.copy(a.pos);
    rig.lastVel.copy(a.vel);
    rig.speed = Math.hypot(a.vel.x, a.vel.z);
    rig.vx = a.vel.x; rig.vz = a.vel.z;
    rig.leanX = rig.leanZ = rig.gait = rig.weight = rig.settle = 0;
    rig.recoil = rig.lower = rig.reload = rig.throwing = rig.landing = rig.takeoff = rig.hit = 0;
    rig.holdOffset.set(0, 0, 0); rig.twist = 0;
    rig.gestureName = ''; rig.gestureT = 0;
    rig.lastShot = a.lastShot;
    rig.hp = a.hp; rig.pitch = a.pitch;
    rig.ground = a.onGround; rig.air = a.onGround ? 0 : 1; rig.lastAirY = a.vel.y;
    rig.crouch = a.crouch; rig.kneel = 0;
    rig.pelvisY = rig.P.pelY - .015 - .37 * a.crouch;
    rig.poseYaw = a.yaw;
    rig.stepping = -1; rig.stepDelay = 0;
    rig.rootY = a.pos.y; rig.cycle = 0; rig.moveBlend = rig.footBlend = rig.hipYaw = rig.dirX = rig.dirZ = rig.gaitSpeed = 0;
    rig.wasGait = rig.backpedal = false; rig.stopT = 1; rig.tx = 0; rig.tz = -1; rig.baseY = a.pos.y; rig.baseV = 0;
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    for (let i = 0; i < 2; i++) {
      const foot = rig.feet[i];
      footHome(foot.point, a, rig.P, LEGS[i].side, cy, sy);
      foot.yaw = a.yaw; foot.phase = 1; foot.floorY = a.pos.y; foot.inContact = true; foot.heel = 0;
    }
  }

  // Standing feet: a short step (0.21 s) re-plants a foot that the body turned or drifted away from. Moving
  // feet run on the gait cycle below; these only take over once the body has stopped.
  function startStep(a, rig, i, cy, sy, dt) {
    const foot = rig.feet[i], side = LEGS[i].side, P = rig.P;
    const age = rig.stepDelay <= 0 ? Math.min(-rig.stepDelay, dt) : 0;
    foot.duration = .21;
    foot.lift = .064;
    foot.phase = 0;
    foot.start.copy(foot.point);
    foot.startYaw = foot.yaw;
    footHome(foot.target, a, P, side, cy, sy);
    foot.targetYaw = a.yaw + .10 * side;
    const floor = floorAt(foot.target);
    foot.target.y = (Math.abs(floor - a.pos.y) < .35 ? floor : a.pos.y) + P.footY;
    rig.stepDelay = foot.duration - age;
    rig.stepping = i;
    rig.nextFoot = 1 - i;
    advanceStep(foot, age);
  }

  function advanceStep(foot, dt) {
    foot.phase = Math.min(1, foot.phase + dt / foot.duration);
    const blend = sst(0, 1, foot.phase), lift = Math.sin(Math.PI * foot.phase);
    foot.point.copy(foot.start).lerp(foot.target, blend);
    foot.point.y += lift * lift * foot.lift;
    foot.yaw = foot.startYaw + G.wrapAngle(foot.targetYaw - foot.startYaw) * blend;
  }

  function updateFeet(a, rig, dt, cy, sy, justLanded) {
    const P = rig.P, left = rig.feet[0], right = rig.feet[1];
    if (justLanded) {
      for (let i = 0; i < 2; i++) {
        const foot = rig.feet[i], local = rig.bones[BI[LEGS[i].foot]].position;
        foot.point.set(a.pos.x + local.x * cy + local.z * sy, a.pos.y + P.footY,
          a.pos.z - local.x * sy + local.z * cy);
        foot.yaw = a.yaw; foot.phase = 1;
      }
    }
    if (!a.onGround) {
      left.phase = right.phase = 1;
      rig.stepping = -1;
      rig.stepDelay = 0;
      return;
    }
    if (left.phase < 1) advanceStep(left, dt);
    if (right.phase < 1) advanceStep(right, dt);
    if (rig.stepping >= 0 && rig.feet[rig.stepping].phase === 1)
      rig.stepping = left.phase < 1 ? 0 : right.phase < 1 ? 1 : -1;
    rig.stepDelay = Math.max(-dt, rig.stepDelay - dt);
    if (rig.kneel > .18 || rig.stepping >= 0) return;
    const distL = footHome(tp[1], a, P, -1, cy, sy).distanceTo(left.point);
    const distR = footHome(tp[1], a, P, 1, cy, sy).distanceTo(right.point);
    const yawL = Math.abs(G.wrapAngle(a.yaw - left.yaw)), yawR = Math.abs(G.wrapAngle(a.yaw - right.yaw));
    const turn = Math.max(yawL, yawR) > .70;
    const pending = Math.abs(G.wrapAngle(a.yaw - rig.poseYaw)) > .42 && Math.max(yawL, yawR) > .38;
    const next = (distR + yawR * .13 > distL + yawL * .13) ? 1 : 0;
    if (turn || pending || Math.max(distL, distR) > .16) startStep(a, rig, next, cy, sy, dt);
  }

  function localFoot(out, a, rig, i, cy, sy) {
    const P = rig.P, side = LEGS[i].side, foot = rig.feet[i];
    const x = foot.point.x - a.pos.x, y = foot.point.y - rig.rootY, z = foot.point.z - a.pos.z;
    const kn = rig.kneel, air = rig.air;
    out.set(x * cy - z * sy, y, x * sy + z * cy);
    // A planted foot that trails the body rolls onto its toes: the raised heel lengthens the leg, so the
    // hips need not sink (the old low, bent-knee "duck walk").
    foot.heel = 0;
    if (foot.phase === 1 && rig.speed > .5) {
      const behind = -(x * rig.vx + z * rig.vz) / rig.speed;
      foot.heel = G.clamp((behind - .1) * .3, 0, .085) * (1 - kn);
      out.y += foot.heel;
    }
    out.lerp(tp[5].set(side * (P.footX + .025), P.footY + (i ? .06 : 0), i ? .33 : -.31), kn);
    out.lerp(tp[5].set(side * (P.footX + .012) + rig.leanZ * .10,
      P.footY + .17 + (i ? -.08 : .08) + .055 * rig.takeoff,
      (i ? .16 : -.17) + rig.leanX * .32), air);
    return out;
  }

  function reachableHip(hip, foot, reach, phase) {
    const dx = hip.x - foot.x, dz = hip.z - foot.z;
    const contact = 1 - sst(.025, .22, Math.min(phase, 1 - phase));
    return foot.y + Math.sqrt(Math.max(.09, reach * reach - dx * dx - dz * dz)) - hip.y + (1 - contact) * .35;
  }

  // ---------- locomotion: a phase-driven gait ----------
  // Moving on the ground, each foot runs through a cycle around its hip: planted, it glides back exactly as
  // fast as the body moves (no sliding), then it swings forward in an arc. The hips therefore stay at one
  // steady height (a bob under 1 cm) and the upper body stays calm, as in CS:GO. A planted foot only travels
  // as far as the leg reaches from that height with a soft knee, so legs never lock straight or splay;
  // faster movement gets a short flight phase instead of longer lunges. Moving sideways, the lower body turns
  // up to ~40° into the direction of travel (the spine turns back so the gun stays on target) and the feet
  // run on two tracks that pass in front of and behind each other. Standing, turning in place, kneeling and
  // the air keep the world-planted feet above; a stop hands the feet over exactly where the cycle left them.
  const gaitLocal = [new THREE.Vector3(), new THREE.Vector3()], idleLocal = [new THREE.Vector3(), new THREE.Vector3()];
  const gaitWorld = new THREE.Vector3(), stepPos = new THREE.Vector3(), qTwist = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const BALL = .13;   // ankle to the ball of the foot: the pivot when the heel lifts
  function toWorld(out, a, local, cy, sy, y) {
    return out.set(a.pos.x + local.x * cy + local.z * sy, y, a.pos.z - local.x * sy + local.z * cy);
  }
  // steps per second: ~2 strolling, ~2.9 at walking speed (2.8 m/s: brisk, short steps), ~3.05 running
  function cadence(speed) {
    return speed < 1.5 ? 1.85 + .45 * speed / 1.5 : speed < 3 ? 2.3 + .6 * (speed - 1.5) / 1.5 :
      Math.min(3.1, 2.9 + .15 * (speed - 3) / 2.5);
  }
  function rotY(v, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), x = v.x;
    v.x = x * c + v.z * s; v.z = -x * s + v.z * c;
    return v;
  }
  // limb orientation: twisted about its own axis first (knee and kneecap face `yaw`), then swung onto the bone
  function limbQ(q, from, to, yaw) {
    dirQ(q, from, to);
    return yaw ? q.multiply(qTwist.setFromAxisAngle(UP, yaw)) : q;
  }

  function gaitFeet(a, rig, dt, cy, sy, run, c, H) {
    const P = rig.P, speed = rig.gaitSpeed;
    const tx = rig.tx, tz = rig.tz, ch = Math.cos(H), sh = Math.sin(H);
    // travel in the frame of the turned hips; the legs face along it (or away from it when backpedalling)
    const ux = tx * ch - tz * sh, uz = tx * sh + tz * ch;
    const fx = rig.backpedal ? -ux : ux, fz = rig.backpedal ? -uz : uz;
    // the feet's tracks lie to the right/left of where the legs face; when the legs switch between running
    // and backpedalling (without a reversal) the tracks swing over instead of swapping in one frame
    if (rig.pSnap) { rig.px = -fz; rig.pz = fx; rig.pSnap = false; }
    rig.px = damp(rig.px, -fz, 12, dt); rig.pz = damp(rig.pz, fx, 12, dt);
    const px = rig.px, pz = rig.pz;
    const sideways = Math.abs(ux);
    // how far a planted ankle may be ahead of / behind the hip with a soft knee (behind, the heel is up)
    const w = P.footX + .008;
    // each foot's path is centred under its own hip (with the hips turned, the tracks sit ahead of / behind
    // the hip joints), and a track beside the hip leaves a little less reach
    const hx0 = P.hipR.x, offAlong = (hx0 - w * px) * ux - w * pz * uz, offSide = Math.abs((hx0 - w * px) * px - w * pz * pz);
    const L = Math.sqrt(Math.max(.3, ((P.lThigh + P.lShin) * .985) ** 2 - offSide * offSide));
    const hipH = P.pelY - .015 - (G.lerp(.028, .065, run) + .006 * (1 - run)) * (1 - c) - .33 * c + P.hipR.y - P.footY;
    const heel = G.lerp(.065, .08, run) * (1 - .5 * c);
    const flat = Math.sqrt(Math.max(.0025, L * L - hipH * hipH));
    const raised = Math.sqrt(Math.max(.0025, L * L - (hipH - heel) * (hipH - heel)));
    let front = rig.backpedal ? raised * .85 : flat, back = rig.backpedal ? flat : raised;
    if (rig.fr === null) rig.fr = front / (front + back);
    rig.fr = damp(rig.fr, front / (front + back), 10, dt);
    const T = 2 / (cadence(speed) * G.lerp(1, 1.25, c) * G.lerp(1, 1.08, sideways));
    const stride = Math.max(speed * T, .001);
    // Stride and the planted share of the cycle ease toward their targets, so the hard accelerations of
    // counter-strafing do not jerk a foot through its arc (at a steady pace they match and nothing slides).
    const spanT = Math.min(front + back, G.lerp(.78, .66, c) * G.lerp(1, .8, sideways), stride * .66);
    rig.span = damp(rig.span, spanT, 12, dt);
    rig.duty = damp(rig.duty, G.clamp(spanT / stride, .15, .66), 7, dt);
    const span = rig.span, duty = rig.duty;
    front = span * rig.fr; back = span - front;
    // A reversal (counter-strafe, run → backpedal) flips the line of travel. The same phase would put each
    // foot at the mirror image of where it is, so mirror the phase instead: every foot stays where it is
    // and simply starts moving the other way (a planted foot keeps its spot, a swinging one turns back).
    if (rig.ux * ux + rig.uz * uz < -.2) rig.cycle = ((duty - rig.cycle) % 1 + 1) % 1;
    rig.ux = ux; rig.uz = uz;
    rig.cycle = (rig.cycle + dt / T) % 1;
    const lift = G.lerp(.06, .16, run) * (1 - .4 * c) * sst(.25, 1.5, speed);
    const toeOff = heel * sst(.05, .3, back), heelStrike = .2 * sst(.05, .25, front);
    for (let i = 0; i < 2; i++) {
      const foot = rig.feet[i], side = LEGS[i].side, phi = (rig.cycle + (i ? .5 : 0)) % 1, wasDown = foot.inContact;
      let along, raise, pitch;
      if (phi < duty) {                        // planted
        const s = phi / duty;
        along = front - span * s;
        foot.inContact = true; foot.gaitS = 1;
        if (!rig.backpedal) {                  // heel strike, flat, then the heel rises onto the ball
          raise = toeOff * sst(.45, 1, s);
          pitch = heelStrike * (1 - sst(0, .22, s)) - Math.asin(Math.min(.9, raise / BALL));
        } else {                               // backwards: lands on the ball, lifts off the heel
          raise = heel * .6 * sst(.05, .3, front) * (1 - sst(0, .35, s));
          pitch = -Math.asin(Math.min(.9, raise / BALL)) + .25 * sst(.6, 1, s) * sst(.05, .3, back);
        }
      } else {                                 // swinging through: rises early, reaches, settles
        const s = (phi - duty) / (1 - duty);
        along = -back + span * sst(.06, .9, s);
        foot.inContact = false; foot.gaitS = s;
        const arc = Math.pow(Math.sin(Math.PI * Math.pow(s, .8)), 1.3) * lift;
        if (!rig.backpedal) {
          // the foot keeps rising as it leaves (heel up, knee folding) and only sets down ahead of the hip
          raise = arc + toeOff * (1 - sst(.3, .75, s));
          pitch = G.lerp(-Math.asin(Math.min(.9, toeOff / BALL)), heelStrike, sst(.15, .9, s));
        } else {
          raise = Math.max(arc, heel * .6 * sst(.05, .3, front) * sst(.7, 1, s));
          pitch = G.lerp(.25 * sst(.05, .3, back), -.3 * sst(.05, .3, front), sst(.15, .9, s));
        }
      }
      foot.gaitAlong = along;
      foot.gaitPitch = pitch;
      // own track beside the line of travel, centred under the hip, then from the hip frame to the root frame
      const at = along + side * offAlong;
      const hx = side * w * px + at * ux, hz = side * w * pz + at * uz;
      const out = gaitLocal[i].set(hx * ch + hz * sh, P.footY + raise, -hx * sh + hz * ch);
      // the foot follows the floor under it (steps, platforms), never a crate top or a drop beside it
      toWorld(gaitWorld, a, out, cy, sy, rig.rootY + .3);
      let floor = floorAt(gaitWorld);
      if (floor > a.pos.y + .46 || floor < a.pos.y - .6) floor = a.pos.y;
      foot.floorY = damp(foot.floorY, floor, foot.inContact ? 40 : 22, dt);
      out.y += foot.floorY - rig.rootY;
      // a foot has just landed: the step is heard there, in time with the animation
      if (foot.inContact && !wasDown && rig.footBlend > .5 && G.Bots && G.Bots.onStep) {
        G.Bots.onStep(a, i, stepPos.set(gaitWorld.x, foot.floorY, gaitWorld.z));
      }
    }
    // +1 while the left foot is ahead of the right (pelvis turns with the legs, the arms swing against them)
    return (rig.feet[0].gaitAlong - rig.feet[1].gaitAlong) * -uz / Math.max(span, .05);
  }

  function legs(a, rig, dt, cy, sy, run, justLanded, breath) {
    const P = rig.P, c = rig.crouch, kn = rig.kneel, air = rig.air, speed = rig.speed;
    // The cycle keeps running through brief stops and reversals (counter-strafing), then hands the feet over.
    rig.stopT = speed > .36 && a.onGround && kn < .5 ? 0 : rig.stopT + dt;
    const gaitOn = a.onGround && kn < .5 && rig.stopT < .15;
    // direction of travel in the root frame, smoothed so a reversal passes through zero stride
    rig.dirX = damp(rig.dirX, rig.vx * cy - rig.vz * sy, 14, dt);
    rig.dirZ = damp(rig.dirZ, rig.vx * sy + rig.vz * cy, 14, dt);
    const dl = Math.hypot(rig.dirX, rig.dirZ);
    if (dl > 1e-3) { rig.tx = rig.dirX / dl; rig.tz = rig.dirZ / dl; }
    // the stride follows this smoothed velocity: it shrinks to nothing as a counter-strafe reverses it
    rig.gaitSpeed = dl;
    const ang = Math.atan2(-rig.tx, -rig.tz);   // 0 forward, ±π backward, -π/2 to the right
    // Forward or backpedalling is judged against the hips as they are turned now, with hysteresis, so the
    // legs keep facing the same way through reversals (A-D strafing: hips stay put, the legs run one way
    // and backpedal the other) instead of swapping their tracks.
    const angHip = G.wrapAngle(ang - rig.hipYaw);
    if (Math.abs(angHip) > 2.0) rig.backpedal = true; else if (Math.abs(angHip) < 1.15) rig.backpedal = false;
    const rel = rig.backpedal ? G.wrapAngle(ang - Math.PI) : ang;
    rig.hipYaw = damp(rig.hipYaw, gaitOn ? G.clamp(rel * .5, -.72, .72) * sst(.3, 1.5, speed) * (1 - .45 * c) : 0, 7, dt);
    const H = rig.hipYaw;

    if (!gaitOn && rig.wasGait) {
      // stopping (or leaving the ground): the feet stay exactly where they were drawn last frame (after a
      // short shuffle that is still partly the standing pose); a foot caught in the air finishes with a
      // short step home
      for (let i = 0; i < 2; i++) {
        const f = rig.feet[i];
        f.point.copy(f.shown);
        f.yaw = a.yaw + H + LEGS[i].side * .08; f.phase = 1; f.heel = 0;
      }
      rig.stepping = -1; rig.stepDelay = 0;
      if (a.onGround) for (let i = 0; i < 2; i++) if (!rig.feet[i].inContact) { startStep(a, rig, i, cy, sy, dt); break; }
      rig.footBlend = 0;
    }
    if (gaitOn && !rig.wasGait) {
      // starting: the foot on the side we head for (or the next in turn) lifts off first
      const lead = rig.tx > .35 ? 1 : rig.tx < -.35 ? 0 : rig.nextFoot;
      rig.duty = .66; rig.span = 0; rig.ux = rig.uz = 0; rig.pSnap = true; rig.fr = null;
      rig.cycle = (rig.duty + .03 + (lead ? .5 : 0)) % 1;
      for (let i = 0; i < 2; i++) rig.feet[i].floorY = a.pos.y;
      rig.footBlend = 0;
    }
    rig.wasGait = gaitOn;
    rig.moveBlend = damp(rig.moveBlend, gaitOn ? 1 : 0, 8, dt);
    if (gaitOn) rig.footBlend = damp(rig.footBlend, 1, 9, dt);
    if (!gaitOn || rig.footBlend < .999) updateFeet(a, rig, dt, cy, sy, justLanded);
    const left = localFoot(footL, a, rig, 0, cy, sy), right = localFoot(footR, a, rig, 1, cy, sy);
    const contact = [rig.feet[0].phase, rig.feet[1].phase];
    let swing = 0;
    if (gaitOn) {
      swing = gaitFeet(a, rig, dt, cy, sy, run, c, H);
      left.lerp(gaitLocal[0], rig.footBlend); right.lerp(gaitLocal[1], rig.footBlend);
      if (rig.footBlend > .5) for (let i = 0; i < 2; i++) contact[i] = rig.feet[i].inContact ? 1 : rig.feet[i].gaitS;
    }
    toWorld(rig.feet[0].shown, a, left, cy, sy, rig.rootY + left.y);
    toWorld(rig.feet[1].shown, a, right, cy, sy, rig.rootY + right.y);
    // On steps the hips follow the lowest supporting foot (the one about to land counts as it comes down),
    // so the standing leg bends to let the other reach down instead of locking straight.
    let floorOff = 0;
    {
      const fl = [0, 0], sup = [false, false];
      for (let i = 0; i < 2; i++) {
        const f = rig.feet[i];
        if (gaitOn && rig.footBlend > .5) { fl[i] = f.floorY - rig.rootY; sup[i] = f.inContact; }
        else { fl[i] = f.point.y - P.footY - rig.rootY; sup[i] = f.phase === 1; }
      }
      for (let i = 0; i < 2; i++) {
        if (sup[i]) continue;
        const land = gaitOn && rig.footBlend > .5 ? sst(.45, .95, rig.feet[i].gaitS) : 0;
        fl[i] = sup[1 - i] ? G.lerp(fl[1 - i], fl[i], land) : fl[i];
      }
      floorOff = a.onGround && (sup[0] || sup[1] || gaitOn) ? Math.min(fl[0], fl[1]) : 0;
      if (Math.abs(floorOff) > .6) floorOff = 0;
    }
    // world height of the floor the hips stand over, eased with a critically damped spring (no sudden
    // start); in the air it is simply the body
    const floorW = rig.rootY + floorOff;
    if (!a.onGround || Math.abs(rig.baseY - floorW) > 1.2) { rig.baseY = floorW; rig.baseV = 0; }
    else {
      const om = 2 / .09, x = om * dt, e = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
      const change = rig.baseY - floorW, temp = (rig.baseV + om * change) * dt;
      rig.baseV = (rig.baseV - om * temp) * e;
      rig.baseY = floorW + (change + temp) * e;
    }
    const base = rig.baseY - rig.rootY;
    const mb = rig.moveBlend * (1 - air) * (1 - kn);
    rig.gait = damp(rig.gait, gaitOn ? swing * rig.footBlend : 0, 20, dt) * (1 - kn);
    const mid = Math.cos(2 * Math.PI * (rig.cycle - (rig.duty || .5) / 2));
    // weight over the planted foot, a bob under a centimetre (lowest as each foot takes the weight)
    rig.weight = damp(rig.weight, mb * -G.lerp(.012, .007, run) * mid + (1 - mb) * breath * .012, 11, dt);
    // Walking, the hips ride a little high over the planted leg (an inverted pendulum, ~2 cm, knees nearly
    // straight); running, they sink a little as each foot takes the weight (~1 cm). Never the old bouncing.
    const sway = (.0105 * (1 - run) - .009 * run) * (1 - c);
    const bob = mb * sway * Math.cos(4 * Math.PI * (rig.cycle - (rig.duty || .5) / 2));
    const yaw = G.clamp(G.wrapAngle(rig.poseYaw - a.yaw), -.32, .32) * .63 * (1 - mb) + H - rig.gait * (.05 + run * .04);
    const forward = -(rig.vx * sy + rig.vz * cy) / Math.max(1, speed);
    const strafe = (rig.vx * cy - rig.vz * sy) / Math.max(1, speed);
    poseQ(qPel, rig.leanX * .45 - .07 * run * forward - .19 * c - .12 * kn,
      yaw, rig.leanZ * .4 - rig.weight * 1.2 - run * strafe * .04);
    const pel = tp[0].set(rig.weight, 0, .065 * c + .043 * kn);
    const hipL = tp[1].copy(P.hipL).applyQuaternion(qPel).add(pel);
    const hipR = tp[2].copy(P.hipR).applyQuaternion(qPel).add(pel);
    const reach = (P.lThigh + P.lShin) * .997;
    // steady hips: slightly lower while moving (soft knees walking, athletic knees running)
    const low = mb * G.lerp(.028, .065, run) * (1 - c);
    const wantY = P.pelY - .015 - low - .33 * c - .32 * kn * (1 - .55 * c) - rig.landing * .07 - rig.settle * .015 +
      bob + air * .026 - .034 * rig.takeoff + breath * .002 * (1 - mb);
    const maxY = Math.min(reachableHip(hipL, left, reach, contact[0]), reachableHip(hipR, right, reach, contact[1]));
    // eased, never snapped: a sudden reach limit lowers the hips over ~0.1 s (pelvisY is above the base)
    const limit = maxY - base;
    rig.pelvisY = damp(rig.pelvisY, Math.min(wantY, limit), rig.pelvisY > limit ? 20 : 14, dt);
    pel.y = base + rig.pelvisY;
    setB(rig, 'pelvis', pel, qPel);
    for (let i = 0; i < 2; i++) {
      const leg = LEGS[i], hip = i ? hipR : hipL, foot = rig.feet[i];
      hip.y += pel.y;
      const knee = tp[3], ankle = tp[4];
      // knees (and the thigh and shin meshes) face where the foot points: the hips' heading while moving
      const footRel = G.wrapAngle(foot.yaw - a.yaw);
      const legYaw = G.lerp(footRel - leg.side * .08, H, rig.footBlend) * (1 - kn) * (1 - air);
      rotY(legPole.set(leg.side * (.13 + .13 * c), i ? -1.8 * kn : 0, -1), legYaw);
      ik(hip, i ? right : left, P.lThigh, P.lShin, legPole, knee, ankle);
      setB(rig, leg.thigh, hip, limbQ(tq[0], hip, knee, legYaw));
      setB(rig, leg.shin, knee, limbQ(tq[1], knee, ankle, legYaw));
      const idlePitch = Math.sin(foot.phase * 2 * Math.PI) * -.19 - Math.asin(Math.min(.9, (foot.heel || 0) / BALL));
      const pitch = G.lerp(idlePitch, foot.gaitPitch || 0, rig.footBlend) * (1 - air) * (1 - kn);
      const footYaw = G.lerp(footRel, H + leg.side * .08, rig.footBlend) * (1 - kn) * (1 - air);
      setB(rig, leg.foot, ankle, poseQ(tq[2], pitch + .37 * air + (i ? -.88 * kn : 0), footYaw, 0));
    }
    return pel;
  }

  const elbow = new THREE.Vector3(), wrist = new THREE.Vector3(), armPole = new THREE.Vector3();
  function arm(rig, side, sh, target, pistol, frame, hand) {
    const left = side === 'L';
    armPole.set(left ? -.62 : .58, -1, pistol ? .48 : .28);
    ik(sh, target, rig.P.lUarm, rig.P.lFarm, armPole, elbow, wrist);
    setB(rig, left ? 'uarmL' : 'uarmR', sh, dirQ(tq[5], sh, elbow));
    setB(rig, left ? 'farmL' : 'farmR', elbow, dirQ(tq[6], elbow, wrist));
    setB(rig, left ? 'handL' : 'handR', wrist, tq[7].copy(frame).multiply(hand));
  }

  // Move the gun into the overlap of the two arms' reach spheres.
  function fitGrip(pos, centerR, centerL, reach, support) {
    const delta = tp[17];
    delta.subVectors(pos, centerR);
    if (delta.lengthSq() > reach * reach) pos.copy(centerR).add(delta.setLength(reach));
    if (support < .01) return;
    delta.subVectors(pos, centerL);
    if (delta.lengthSq() <= reach * reach) return;
    const overlap = tp[18].copy(centerR).lerp(centerL, .5);
    const off = tp[19].subVectors(pos, overlap);
    const center = tp[20].subVectors(overlap, centerL);
    const b = off.dot(center);
    const distance = Math.sqrt(Math.max(0, b * b + off.lengthSq() * (reach * reach - center.lengthSq())));
    const t = G.clamp((-b + distance) / Math.max(off.lengthSq(), 1e-8), 0, 1);
    pos.lerp(overlap.addScaledVector(off, t), support);
  }

  function upperBody(a, rig, dt, it, gm, pel, breath, run, cy, sy) {
    const P = rig.P, kn = rig.kneel, c = rig.crouch;
    const id = rig.gunId;
    const hold = HOLD[G.Weapons.defs[id] && G.Weapons.defs[id].slot === 'grenade' ? 'grenade' : gm.hold] || HOLD.knife;
    const pitch = rig.pitch * (1 - kn) - .62 * kn;
    const flinch = Math.sin(Math.PI * sst(0, .23, rig.hit)) * .12;
    const hitPitch = flinch * (rig.hitX * sy + rig.hitZ * cy);
    const hitRoll = -flinch * (rig.hitX * cy - rig.hitZ * sy);
    // the chest turns back against most of the hips' step-to-step twist: the shoulders keep a slight swing
    const counter = rig.gait * (.03 + run * .025) - rig.hipYaw * .55;
    rig.twist = damp(rig.twist, hold.twist, 18, dt);
    const twist = rig.twist * (1 - kn);
    poseQ(tq[3], .30 * pitch + rig.leanX * .35 - .21 * c + hitPitch, twist * .45 + counter, hitRoll);
    qSp.copy(qPel).multiply(tq[3]);
    const spine = tp[5].copy(P.spine).applyQuaternion(qPel).add(pel);
    setB(rig, 'spine', spine, qSp);
    poseQ(tq[3], .39 * pitch - rig.leanX * .25 + breath * .012, twist * .55 - rig.hipYaw * .45, breath * .017 + hitRoll * .35);
    qCh.copy(qSp).multiply(tq[3]);
    // The skeleton stays rigid: bones keep their lengths (no lifted chest, no head pinned to a fixed height,
    // which stretched the neck and torso while moving). The hit sphere follows the animated head instead.
    const chest = tp[6].copy(P.chest).applyQuaternion(qSp).add(spine);
    poseQ(qHd, pitch + hitPitch * .65, -hitRoll * .35, hitRoll * .7);
    const head = tp[7].copy(P.neck).applyQuaternion(qCh).add(chest);
    const headOffset = tp[8].fromArray(P.headOff).applyQuaternion(qHd);
    setB(rig, 'chest', chest, qCh);
    setB(rig, 'head', head, qHd);
    rig.headLocal.copy(head).add(headOffset);
    rig.headAt = G.time;

    const switchLeft = sst(0, .2, a.switchEnd - G.time);
    const reloadPhase = it && it.reloading ? G.clamp(1 - (it.reloadEnd - G.time) / it.def.reload, 0, 1) : 0;
    const reloadWant = rig.gestureName === 'reload' ? Math.sin(Math.PI * rig.gestureT / .82) :
      sst(0, .18, reloadPhase) * (1 - sst(.72, 1, reloadPhase));
    rig.reload = damp(rig.reload, reloadWant, 17, dt);
    rig.lower = damp(rig.lower, Math.max(switchLeft * .85, rig.reload * .65), 15, dt);
    if (a.lastShot !== rig.lastShot) { rig.lastShot = a.lastShot; rig.recoil = gm.hold === 'knife' ? 0 : 1; }
    rig.recoil *= Math.exp(-dt * 16);
    const phase = rig.gestureName === 'throw' ? 1 - rig.gestureT / .52 : 1;
    rig.gun.visible = phase > .87;
    const wind = sst(0, .29, phase) * (1 - sst(.32, .57, phase));
    const release = sst(.32, .55, phase) * (1 - sst(.59, 1, phase));
    rig.throwing = damp(rig.throwing, Math.max(wind, release), 20, dt);
    const knife = gm.hold === 'knife', pistol = gm.hold === 'pistol', bomb = gm.hold === 'bomb';
    const aimPitch = bomb ? -.03 : pitch - rig.lower * .78 - (knife ? .47 : 0);
    poseQ(qGun, aimPitch + rig.recoil * .065 + wind * 1.30 - release * .42,
      wind * -.36 - release * .16, rig.lower * .25 + breath * .013 + wind * .32);
    const gunPos = tp[10].fromArray(hold.off);
    if (rig.holdOffset.lengthSq() === 0) rig.holdOffset.copy(gunPos);
    else rig.holdOffset.lerp(gunPos, 1 - Math.exp(-19 * dt));
    gunPos.copy(rig.holdOffset).applyQuaternion(qGun).add(chest);
    gunPos.y += .105 + breath * .006;
    gunPos.x += rig.gait * (knife ? .036 : .016) + breath * .006;
    gunPos.z += rig.recoil * .033;
    gunPos.lerp(tp[15].set(.25, head.y + .09, .12), wind);
    gunPos.lerp(tp[15].set(.18, chest.y + .235, -.41), release);
    if (bomb) gunPos.y = Math.max(gunPos.y, pel.y - .045);
    if (a.defusing) gunPos.lerp(tp[15].set(.08, pel.y - .04, -.32), kn);
    const shL = tp[11].copy(P.shoulderL).applyQuaternion(qCh).add(chest);
    const shR = tp[12].copy(P.shoulderR).applyQuaternion(qCh).add(chest);
    const tR = tp[13].copy(gm.rightHand).applyQuaternion(qGun), tL = tp[14].set(0, 0, 0);
    const support = gm.leftHand ? (1 - Math.max(rig.throwing, rig.reload)) * (1 - (a.defusing ? kn : 0)) : 0;
    if (gm.leftHand) tL.copy(gm.leftHand).applyQuaternion(qGun);
    const centerR = tp[21].copy(shR).sub(tR), centerL = tp[22].copy(shL).sub(tL);
    fitGrip(gunPos, centerR, centerL, P.lUarm + P.lFarm - (pistol ? .019 : .032), support);
    rig.gun.position.copy(gunPos); rig.gun.quaternion.copy(qGun);
    tR.add(gunPos); tL.add(gunPos);
    // the free hand hangs from the (aimed) chest, not the turned hips, and swings against the legs
    qFree.setFromAxisAngle(UP, -rig.hipYaw).multiply(qPel);
    const free = tp[15].set(-.27, .005 + .09 * rig.reload, .064 + rig.gait * .14).applyQuaternion(qFree).add(pel);
    free.lerp(tp[8].set(-.11, pel.y + .12, -.27), rig.reload);
    free.lerp(tp[8].set(-.16, pel.y - .07, -.40), a.defusing ? kn : 0);
    tL.lerp(free, 1 - support);
    tq[4].copy(qFree).slerp(qGun, Math.max(support, .65 * rig.reload));
    arm(rig, 'R', shR, tR, pistol, qGun, HAND_R);
    arm(rig, 'L', shL, tL, pistol, tq[4], HAND_L);
  }

  function animate(a, rig, dt) {
    if (!rig.ready || rig.round !== G.Game.round || rig.lastPos.distanceToSquared(a.pos) > 6.25) resetPose(a, rig);
    const it = G.Weapons.current(a);
    const id = it && it.id || (G.GunModels.IDS.indexOf(a.cur) >= 0 ? a.cur : 'knife');
    const gm = G.GunModels.get(id);
    if (!rig.gun) {
      rig.gun = G.GunModels.mesh(id);
      rig.gun.layers.enable(4);
      rig.root.add(rig.gun);
    }
    if (gm !== rig.gunModel) {
      rig.gun.geometry = gm.whole;
      rig.gun.material = gm.worldMaterial || G.GunModels.material();
      rig.gun.visible = true;
      rig.gun.userData.gun = id;
      rig.gunId = id; rig.gunModel = gm;
    }
    // Steps snap the physics body up or down by up to 45 cm; the model does not: its feet stay on the real
    // floor and its hips ride on the floor under the supporting foot (legs()), so the legs take the step.
    rig.rootY = a.pos.y;
    rig.root.position.copy(a.pos);
    rig.root.rotation.set(0, a.yaw, 0, 'YXZ');
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw), speed = Math.hypot(a.vel.x, a.vel.z);
    const safeDt = Math.max(dt, .001);
    const ax = (a.vel.x - rig.lastVel.x) / safeDt, az = (a.vel.z - rig.lastVel.z) / safeDt;
    if (rig.speed > .7 && speed < .28) rig.settle = 1;
    rig.settle *= Math.exp(-dt * 8);
    rig.leanX = damp(rig.leanX, G.clamp((ax * sy + az * cy) * .017, -.20, .17), 10, dt);
    rig.leanZ = damp(rig.leanZ, G.clamp((ax * cy - az * sy) * -.014, -.16, .16), 10, dt);
    rig.lastVel.copy(a.vel);
    rig.lastPos.copy(a.pos);
    rig.vx = damp(rig.vx, a.vel.x, 16, dt); rig.vz = damp(rig.vz, a.vel.z, 16, dt);
    rig.speed = damp(rig.speed, speed, 13, dt);
    rig.pitch = damp(rig.pitch, a.pitch, 24, dt);
    const run = sst(2.15, 5.6, rig.speed) * (1 - rig.crouch);
    const move = speed > .36 && a.onGround;
    if (move) rig.poseYaw = a.yaw;
    else rig.poseYaw += G.wrapAngle(a.yaw - rig.poseYaw) * (1 - Math.exp(-dt * (rig.stepping >= 0 ? 12 : 3)));
    const justLanded = !rig.ground && a.onGround;
    if (justLanded) rig.landing = G.clamp(-rig.lastAirY * .13, .30, 1);
    if (!a.onGround && rig.ground) rig.takeoff = sst(1, 5, a.vel.y);
    if (!a.onGround) rig.lastAirY = a.vel.y;
    rig.ground = a.onGround;
    rig.air = damp(rig.air, a.onGround ? 0 : 1, a.onGround ? 19 : 11, dt);
    rig.takeoff *= Math.exp(-dt * 8);
    rig.landing *= Math.exp(-dt * 11);
    rig.crouch = damp(rig.crouch, a.crouch, 18, dt);
    rig.kneel = damp(rig.kneel, a.planting || a.defusing ? 1 : 0, 9, dt);
    rig.gestureT = Math.max(0, rig.gestureT - dt);
    if (rig.gestureT === 0) rig.gestureName = '';

    if (a.hp < rig.hp) BM.flinch(a, 0, 0);
    rig.hp = a.hp;
    rig.hit = Math.max(0, rig.hit - dt);
    const breath = Math.sin(G.time * 2.55 + rig.idleSeed);
    const pel = legs(a, rig, dt, cy, sy, run, justLanded, breath);
    upperBody(a, rig, dt, it, gm, pel, breath, run, cy, sy);
  }

  // ---------- death ----------
  const IMPULSE = { pistol: 3.15, primary: 5.45, sniper: 9.1, shotgun: 8.7, blast: 10.3, knife: 1.8 };
  const PARTICLE = RD.P;
  const ragPoints = Object.keys(PARTICLE).map(() => new THREE.Vector3());
  const ragQ = new THREE.Quaternion(), ragX = new THREE.Vector3(), ragY = new THREE.Vector3();
  const ragDirection = new THREE.Vector3(), ragDelta = new THREE.Quaternion();
  const rx = new THREE.Vector3(), ry = new THREE.Vector3(), rz = new THREE.Vector3(), rmat = new THREE.Matrix4();
  const RAG_ARMS = [
    ['uarmL', 'farmL', 'handL', PARTICLE.SHL, PARTICLE.ELL, PARTICLE.HAL],
    ['uarmR', 'farmR', 'handR', PARTICLE.SHR, PARTICLE.ELR, PARTICLE.HAR],
  ];
  const RAG_LEGS = [
    [LEGS[0], PARTICLE.HIL, PARTICLE.KNL, PARTICLE.FOL, PARTICLE.TOL, PARTICLE.HLL],
    [LEGS[1], PARTICLE.HIR, PARTICLE.KNR, PARTICLE.FOR, PARTICLE.TOR, PARTICLE.HLR],
  ];
  const RAG_JOINTS = [
    'pelvis', 'chest', 'head', null, 'uarmL', 'farmL', 'handL', 'uarmR',
    'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  ];

  function basisQ(q, x, y) {
    ry.copy(y).normalize();
    rx.copy(x).addScaledVector(ry, -x.dot(ry)).normalize();
    if (ry.lengthSq() < .5 || rx.lengthSq() < .5) return q.identity();
    rz.crossVectors(rx, ry);
    return q.setFromRotationMatrix(rmat.makeBasis(rx, ry, rz));
  }

  function ragBone(rig, name, point, q, bind) {
    const i = BI[name], b = rig.bones[i], offset = rig.ragOffset[i];
    if (bind) offset.copy(q).invert().multiply(ragQ.copy(rig.root.quaternion).multiply(b.quaternion));
    else { b.position.copy(point); b.quaternion.copy(q).multiply(offset); }
  }

  // Carry roll with the body and apply only the change in joint direction in that frame.
  function ragSwingQ(rig, name, q, frame, from, to, bind) {
    const i = BI[name];
    if (bind) rig.ragSwing[i] = { axis: new THREE.Vector3(), rotation: new THREE.Quaternion() };
    const swing = rig.ragSwing[i];
    ragDirection.subVectors(to, from);
    if (ragDirection.lengthSq() > 1e-8) {
      ragDirection.normalize().applyQuaternion(ragDelta.copy(frame).invert());
      if (!bind && swing.axis.lengthSq() > .5) {
        ragDelta.setFromUnitVectors(swing.axis, ragDirection);
        swing.rotation.premultiply(ragDelta).normalize();
      }
      swing.axis.copy(ragDirection);
    }
    return q.multiplyQuaternions(frame, swing.rotation);
  }

  function ragFoot(q, ankle, toe, heel) {
    const back = ragY.subVectors(heel, toe).normalize();
    const right = ragX.copy(ankle).addScaledVector(toe, -.5).addScaledVector(heel, -.5)
      .cross(back).normalize();
    return basisQ(q, right, ry.crossVectors(back, right));
  }

  function applyRagdoll(rig, bind) {
    const p = ragPoints, P = PARTICLE;
    if (!bind) for (let i = 0; i < p.length; i++) RD.point(rig.rd, i, p[i]);
    const pel = p[P.PEL], che = p[P.CHE], nec = p[P.NEC], hea = p[P.HEA];
    const hipX = tp[17].subVectors(p[P.HIR], p[P.HIL]), shX = tp[18].subVectors(p[P.SHR], p[P.SHL]);
    const up = tp[19].subVectors(che, pel);
    const pelvisQ = basisQ(tq[0], hipX, up);
    ragBone(rig, 'pelvis', pel, pelvisQ, bind);
    const spineQ = basisQ(tq[1], tp[20].addVectors(hipX, shX), up);
    const spine = tp[21].copy(pel).lerp(che, .38);
    if (bind) rig.ragSpine.copy(rig.bones[BI.spine].position).applyMatrix4(rig.root.matrixWorld)
      .sub(spine).applyQuaternion(tq[7].copy(spineQ).invert());
    else spine.add(tp[22].copy(rig.ragSpine).applyQuaternion(spineQ));
    ragBone(rig, 'spine', spine, spineQ, bind);
    const chestQ = basisQ(tq[2], shX, up);
    ragBone(rig, 'chest', che, chestQ, bind);
    ragBone(rig, 'head', nec, ragSwingQ(rig, 'head', tq[3], chestQ, nec, hea, bind), bind);
    for (let i = 0; i < 2; i++) {
      const arm = RAG_ARMS[i], sh = p[arm[3]], el = p[arm[4]], hand = p[arm[5]];
      ragBone(rig, arm[0], sh, ragSwingQ(rig, arm[0], tq[4], chestQ, sh, el, bind), bind);
      const forearm = ragSwingQ(rig, arm[1], tq[4], chestQ, el, hand, bind);
      ragBone(rig, arm[1], el, forearm, bind);
      ragBone(rig, arm[2], hand, forearm, bind);
      const chain = RAG_LEGS[i], leg = chain[0], hip = p[chain[1]], knee = p[chain[2]], ankle = p[chain[3]];
      ragBone(rig, leg.thigh, hip, ragSwingQ(rig, leg.thigh, tq[4], pelvisQ, hip, knee, bind), bind);
      ragBone(rig, leg.shin, knee, ragSwingQ(rig, leg.shin, tq[4], pelvisQ, knee, ankle, bind), bind);
      ragBone(rig, leg.foot, ankle, ragFoot(tq[4], ankle, p[chain[4]], p[chain[5]]), bind);
    }
  }

  function startRagdoll(a, rig) {
    if (!rig.ready) rig.root.position.copy(a.pos);
    rig.root.updateMatrixWorld(true);
    const p = ragPoints, P = PARTICLE, world = rig.root.matrixWorld;
    for (let i = 0; i < RAG_JOINTS.length; i++) {
      if (RAG_JOINTS[i]) p[i].copy(rig.bones[BI[RAG_JOINTS[i]]].position).applyMatrix4(world);
    }
    const head = rig.bones[BI.head];
    p[P.HEA].fromArray(rig.P.headOff).applyQuaternion(head.quaternion).add(head.position).applyMatrix4(world);
    for (let i = 0; i < 2; i++) {
      const chain = RAG_LEGS[i], b = rig.bones[BI[chain[0].foot]];
      const height = .046 - rig.P.footY;
      p[chain[4]].set(0, height, -.145).applyQuaternion(b.quaternion).add(b.position).applyMatrix4(world);
      p[chain[5]].set(0, height, .054).applyQuaternion(b.quaternion).add(b.position).applyMatrix4(world);
    }
    rig.ragOffset = BONES.map(() => new THREE.Quaternion());
    rig.ragSwing = [];
    rig.ragSpine = new THREE.Vector3();
    applyRagdoll(rig, true);
    const info = a.deathInfo || {}, weapon = G.Weapons.defs[info.weapon];
    const blast = info.weapon === 'he' || info.weapon === 'bomb';
    const type = blast ? 'blast' : weapon && (weapon.melee ? 'knife' : weapon.scope ? 'sniper' :
      weapon.pellets ? 'shotgun' : weapon.slot);
    const force = IMPULSE[type] || IMPULSE.pistol;
    const index = info.head ? P.HEA : info.legs ? (rig.variant % 2 ? P.KNR : P.KNL) : P.CHE;
    const direction = tp[0].set(info.dirx || 0, info.diry || 0, info.dirz || 0).normalize();
    const lift = blast ? 2.2 : .65;
    const velocity = tp[1].copy(rig.deathVel).multiplyScalar(.82).addScaledVector(direction, force * .20);
    rig.rd = RD.create(p, velocity);
    // A headshot snaps the head, but the push is shared with the chest and pelvis: a kick concentrated
    // on the head folded the spine far past what the 16-bone skin can bend without tearing the jacket.
    RD.push(rig.rd, index, tp[2].copy(direction).multiplyScalar(force * (info.head ? 1.05 : 1)), info.head ? .2 : .32);
    if (info.head) RD.push(rig.rd, P.CHE, tp[2].copy(direction).multiplyScalar(force * .45), .3);
    RD.push(rig.rd, P.PEL, tp[2].copy(direction).multiplyScalar(force * (info.head ? .32 : .18)).add(tp[3].set(0, lift, 0)), .25);

    // Opposing wrist and ankle kicks die out as the limbs come into contact.
    const side = Math.sin(rig.idleSeed) < 0 ? -1 : 1;
    const flail = force * .14;
    RD.push(rig.rd, P.HAL, tp[2].set(-flail, .65 + side * .32, .37 * side), .12);
    RD.push(rig.rd, P.HAR, tp[2].set(flail, .65 - side * .32, -.37 * side), .12);
    RD.push(rig.rd, P.FOL, tp[2].set(-.38 * flail, .23, -.49 * side), .12);
    RD.push(rig.rd, P.FOR, tp[2].set(.38 * flail, .32, .49 * side), .12);
    rig.deathVel.set(0, 0, 0);
    rig.mesh.frustumCulled = false;
    rig.root.position.set(0, 0, 0); rig.root.rotation.set(0, 0, 0);
    if (rig.gun) rig.gun.visible = false;
    rig.gunModel = null;
  }

  // ---------- per frame ----------
  BM.update = function (a, dt) {
    const rig = a.rig;
    if (!rig) return;
    if (!a.alive) {
      if (!rig.rd) startRagdoll(a, rig);
      if (RD.update(rig.rd, dt)) applyRagdoll(rig);
      rig.root.visible = !rig.hidden;   // hidden only while the death camera is still inside it
      if (a.tagSprite) a.tagSprite.visible = false;
      return;
    }
    if (rig.rd) {
      rig.rd = null; rig.ready = false;
      rig.mesh.frustumCulled = true;
      BM.upgradeAgent(a);
    }
    // sun on this soldier (for the blob shadow)
    rig.sunT -= dt;
    if (!G.Gfx.preset.movingShadow && rig.sunT <= 0) {
      rig.sunT = 0.15;
      const sd = G.sunDir;
      rig.sunWant = G.Map.raycast(a.pos.x, a.pos.y + 1.0, a.pos.z, sd.x, sd.y, sd.z, 40) ? 0 : 1;
    }
    rig.sun += ((rig.sunWant === undefined ? 1 : rig.sunWant) - rig.sun) * Math.min(1, dt * 8);
    const hide = a.isPlayer || rig.hidden;
    rig.root.visible = !hide;
    if (a.tagSprite) {
      a.tagSprite.visible = !hide;
      a.tagSprite.position.set(a.pos.x, a.pos.y + G.bodyHeight(a.crouch) + 0.42, a.pos.z);
    }
    // the player's own body is only drawn after death; keep its pose current for the ragdoll
    if (!hide || a.isPlayer) animate(a, rig, dt);
  };
  BM.warm = function () { modelFor('atk'); modelFor('def'); if (!G.Gfx.preset.movingShadow && !blobs) initBlobs(); };
  // called just before an agent is marked dead: remember how it was moving
  BM.prepareDeath = function (a) {
    if (!a.rig) return;
    animate(a, a.rig, 0);
    a.rig.deathVel.copy(a.vel);
  };
  BM.ragdollPoint = function (a, i, out) { return a.rig && a.rig.rd ? RD.point(a.rig.rd, i, out) : null; };
})(window.G);
