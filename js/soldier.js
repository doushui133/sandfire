// soldier.js — third-person soldiers (original character designs). Each soldier is one skinned
// mesh built from procedural parts; animation is procedural: a gait with leg IK, aiming that bends
// the spine, a two-handed weapon hold with arm IK, crouch, jump, kneeling to plant or defuse, and
// a ragdoll on death. Soft blob shadows ground them.
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
  const PROP0 = { J, pelY: 0.97, hipX: 0.1, hipY: -0.04, footX: 0.11, footY: 0.095, spineY: 0.12, chestY: 1.30, headOff: [0, 0.115, 0.006], headZ: 0,
    shX: 0.195, shY: 0.14, shZ: 0, lThigh: L_THIGH, lShin: L_SHIN, lUarm: L_UARM, lFarm: L_FARM };
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
      mats[team] = G.Gfx.litMaterial({ skinning: true, detail: 'cloth', camo: TEAMS[team].camo, detailScale: 3.4 });
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
      const t = await loader.loadAsync(objectUrl);
      URL.revokeObjectURL(objectUrl);
      t.anisotropy = aniso;
      return t;
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
      const mats = await Promise.all(meta.materials.map(async (m) => {
        const [map, normalMap, roughnessMap] = await Promise.all([tex(m.map), tex(m.normalMap), tex(m.roughnessMap)]);
        return G.Gfx.litMaterial({ skinning: true, map, normalMap, roughnessMap });
      }));
      const j = meta.joints, hc = meta.headCenter, L = meta.lengths;
      const P = {
        J: j, pelY: j.pelvis[1], hipX: j.thighR[0], hipY: j.thighR[1] - j.pelvis[1], footX: j.footR[0], footY: j.footR[1],
        spineY: j.spine[1] - j.pelvis[1], chestY: j.chest[1], headOff: [hc[0] - j.head[0], hc[1] - j.head[1], hc[2] - j.head[2]], headZ: hc[2] * 0.5,
        shX: j.uarmR[0], shY: j.uarmR[1] - j.chest[1], shZ: j.uarmR[2] - j.chest[2], lThigh: L.thigh, lShin: L.shin, lUarm: L.uarm, lFarm: L.farm,
      };
      real[name] = { geo, mats, P };
    }
  try { await Promise.all([].concat(REAL.atk, REAL.def).map(one)); }
    finally { loadProgress = null; }
  };
  BM.upgradeAgent = function (a) {
    if (!a.rig || a.rig.real || !realReady()) return;
    const list = REAL[a.team];
    if (!a.realName || list.indexOf(a.realName) < 0) a.realName = list[realTurn[a.team]++ % list.length];
    const model = real[a.realName];
    if (!model) return;
    a.rig.mesh.geometry = model.geo;
    a.rig.mesh.material = model.mats;
    a.rig.P = model.P;
    a.rig.real = true;
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
    const { geo, mat } = model ? { geo: model.geo, mat: model.mats } : modelFor(a.team);
    const P = model ? model.P : PROP0;
    const root = new THREE.Group();
    const bones = BONES.map((n) => { const b = new THREE.Bone(); b.position.fromArray(P.J[n]); root.add(b); return b; });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.frustumCulled = true;
    mesh.layers.enable(4);
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    if (showTag) { a.tagSprite = tag(a.name, a.team === 'atk' ? '#ffb38a' : '#9fd0ff'); G.scene.add(a.tagSprite); }
    a.mesh = root;
    a.rig = {
      root, mesh, bones, P, real: !!model, gun: null, gunId: null, phase: Math.random() * 6, speed: 0, mdx: 0, mdz: -1, crouch: 0, kneel: 0, air: 0,
      gestureName: '', gestureT: 0, ground: true, landing: 0, sun: 1, sunT: Math.random() * 0.2, rd: null, recoil: 0, lastShot: -9, hidden: false, lower: 0,
      plantX: [0, 0], plantZ: [0, 0], plantOn: [0, 0], stepPrev: [-1, -1],
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
  const DOWN = new THREE.Vector3(0, -1, 0), XA = new THREE.Vector3(1, 0, 0), YA = new THREE.Vector3(0, 1, 0);
  const ikD = new THREE.Vector3(), ikP = new THREE.Vector3();
  // two-bone IK: joint `mid` and reachable `end` for a chain from `a` towards `t`, bending towards `pole`
  function ik(a, t, l1, l2, pole, mid, end) {
    ikD.subVectors(t, a);
    let d = ikD.length();
    const maxR = (l1 + l2) * 0.998, minR = Math.abs(l1 - l2) + 0.02;
    if (d < 1e-5) { ikD.set(0, -1, 0); d = minR; }
    ikD.divideScalar(d);
    d = G.clamp(d, minR, maxR);
    end.copy(a).addScaledVector(ikD, d);
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    ikP.copy(pole).addScaledVector(ikD, -pole.dot(ikD));
    if (ikP.lengthSq() < 1e-8) ikP.set(0, 0, -1);
    ikP.normalize();
    mid.copy(a).addScaledVector(ikD, x).addScaledVector(ikP, h);
  }
  const dirQ = (q, from, to) => q.setFromUnitVectors(DOWN, tp[16].subVectors(to, from).normalize());
  function setB(rig, name, pos, q) { const b = rig.bones[BI[name]]; b.position.copy(pos); b.quaternion.copy(q); }

  const HOLD = {
    rifle: { off: [0.085, 0.02, -0.25], twist: -0.32 },
    pistol: { off: [0.03, 0.05, -0.44], twist: -0.05 },
    knife: { off: [0.2, -0.32, -0.2], twist: 0 },
    grenade: { off: [0.18, 0.04, -0.22], twist: 0 },
    bomb: { off: [0, -0.36, -0.3], twist: 0 },
  };
  const poleL = new THREE.Vector3(), poleR = new THREE.Vector3(), legPole = new THREE.Vector3();
  const qPel = new THREE.Quaternion(), qSp = new THREE.Quaternion(), qCh = new THREE.Quaternion(), qHd = new THREE.Quaternion(), qAim = new THREE.Quaternion(), qGun = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const HAND_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0)), HAND_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.35, 0, 0.4));

  function animate(a, rig, dt) {
    const it = G.Weapons.current(a);
    const gunId = it && it.id || (G.GunModels.IDS.indexOf(a.cur)>=0 ? a.cur : 'knife');
    if (gunId !== rig.gunId) {
      if (rig.gun) rig.root.remove(rig.gun);
      rig.gun = G.GunModels.mesh(gunId);
      rig.gun.layers.enable(4);
      rig.root.add(rig.gun);
      rig.gunId = gunId;
    }
    const gm = G.GunModels.get(gunId), hold = HOLD[gm.hold] || HOLD.knife;
    rig.root.position.copy(a.pos);
    rig.root.rotation.set(0, a.yaw, 0, 'YXZ');
    // movement in the soldier's own frame (x right, z back)
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    const lx = a.vel.x * cy - a.vel.z * sy, lz = a.vel.x * sy + a.vel.z * cy;
    const sp = Math.hypot(lx, lz);
    rig.speed += (sp - rig.speed) * Math.min(1, dt * 10);
    if (sp > 0.3) { rig.mdx += (lx / sp - rig.mdx) * Math.min(1, dt * 8); rig.mdz += (lz / sp - rig.mdz) * Math.min(1, dt * 8); }
    const ml = Math.hypot(rig.mdx, rig.mdz) || 1, mdx = rig.mdx / ml, mdz = rig.mdz / ml;
    rig.crouch += (a.crouch - rig.crouch) * Math.min(1, dt * 12);
    const kneelWant = a.planting || a.defusing ? 1 : 0;
    rig.kneel += (kneelWant - rig.kneel) * Math.min(1, dt * 6);
    rig.air += ((a.onGround ? 0 : 1) - rig.air) * Math.min(1, dt * 10);
    if (!rig.ground && a.onGround) rig.landing = 1;
    rig.ground = a.onGround; rig.landing = Math.max(0,rig.landing-dt*5);
    rig.gestureT = Math.max(0,rig.gestureT-dt);
    const throwPhase = rig.gestureName==='throw' && rig.gestureT>0 ? 1-rig.gestureT/.52 : 0;
    const reload = rig.gestureName==='reload' ? Math.sin(Math.PI*rig.gestureT/.82) : 0;
    const breath = Math.sin(G.time*2.35 + rig.phase*.13);
    const c = a.crouch, kn = rig.kneel, run = G.clamp(rig.speed / 5, 0, 1);
    const cycle = G.lerp(2.1, 1.4, c);
    if (a.onGround) rig.phase += dt * rig.speed / cycle * Math.PI * 2;
    const ph = rig.phase, amp = Math.min(0.4, rig.speed * 0.075) * (1 - 0.35 * c) * (1 - kn), lift = (0.07 + 0.07 * run) * (1 - kn);
    // pelvis
    const bob = 0.019 * run * (1 - Math.cos(2 * ph)) * 0.5;
    const P = rig.P;
    const pelY = P.pelY - 0.35*c - bob - .075*kn - .038*rig.landing;
    const lean = -0.07 * run * (-mdz > 0 ? 1 : 0.3) - 0.22 * c - 0.15 * kn;
    eul.set(lean, Math.sin(ph) * 0.07 * run, 0, 'YXZ'); qPel.setFromEuler(eul);
    const pel = tp[0].set(0, pelY, 0.04 * c);
    setB(rig, 'pelvis', pel, qPel);
    // legs
    legPole.set(0, 0, -1);
    for (const s of [-1, 1]) {
      const name = s < 0 ? 'L' : 'R', phase = ph + (s < 0 ? 0 : Math.PI);
      const hip = tp[1].set(s * P.hipX, P.hipY, 0).applyQuaternion(qPel).add(pel);
      const step = (phase / (Math.PI * 2)) % 1;
      const d = (step < .5 ? 1-4*step : -Math.cos((step-.5)*Math.PI*2)) * amp;
      const up = step < .5 ? 0 : Math.sin((step-.5)*Math.PI*2)*lift*run;
      const si = s < 0 ? 0 : 1;
      const foot = tp[2].set(s * P.footX + mdx * d + s * Math.abs(mdx) * 0.04, P.footY + up, mdz * d + (s < 0 ? -0.05 : 0.04) * (1 - run));
      if (kn > 0.01) {   // kneel: left foot forward, right knee down
        const kx = s < 0 ? -0.12 : 0.12, kz = s < 0 ? -0.3 : 0.22, ky = s < 0 ? P.footY : P.footY + 0.065;
        foot.set(G.lerp(foot.x, kx, kn), G.lerp(foot.y, ky, kn), G.lerp(foot.z, kz, kn));
      }
      foot.y += rig.air * 0.22;
      // Keep a moving foot planted in the world through the middle of its stance, and match the
      // authored stride again at contact and liftoff so the swing does not pop.
      const stride = rig.speed > 0.75 || (rig.plantOn[si] && rig.speed > 0.35);
      if (a.onGround && kn < 0.12 && rig.air < 0.35 && step < 0.5 && stride) {
        if (rig.stepPrev[si] >= 0.5 || rig.stepPrev[si] < 0 || !rig.plantOn[si]) {
          rig.plantX[si] = a.pos.x + foot.x * cy + foot.z * sy;
          rig.plantZ[si] = a.pos.z - foot.x * sy + foot.z * cy;
          rig.plantOn[si] = 1;
        }
        const dx = rig.plantX[si] - a.pos.x, dz = rig.plantZ[si] - a.pos.z;
        const px = dx * cy - dz * sy, pz = dx * sy + dz * cy;
        const along = Math.hypot(px - foot.x, pz - foot.z);
        const stick = along < 0.42 ? Math.sin(Math.PI * step / 0.5) : 0;
        foot.x += (px - foot.x) * stick;
        foot.z += (pz - foot.z) * stick;
      } else rig.plantOn[si] = 0;
      rig.stepPrev[si] = step;
      const knee = tp[3], ankle = tp[4];
      ik(hip, foot, P.lThigh, P.lShin, legPole.set(s * 0.15, 0, -1), knee, ankle);
      setB(rig, 'thigh' + name, hip, dirQ(tq[0], hip, knee));
      setB(rig, 'shin' + name, knee, dirQ(tq[1], knee, ankle));
      eul.set(up * 2.5 * (Math.sin(phase) > 0 ? -1 : 0.6), 0, 0, 'YXZ');
      setB(rig, 'foot' + name, ankle, tq[2].setFromEuler(eul));
    }
    // spine, chest, head: share the aim pitch, twist the shoulders into a rifle stance
    const pitch = a.pitch * (1 - kn * 0.5) - 0.45 * kn;
    const lower = reload > 0 ? reload*.65 : G.time < a.switchEnd ? 0.7 : it && it.reloading ? 0.45 : 0;
    rig.lower += (lower - rig.lower) * Math.min(1, dt * 10);
    const twist = hold.twist * (1 - kn);
    eul.set(pitch * 0.25 - lean * 0.6, twist * 0.4, 0, 'YXZ'); qSp.copy(qPel).multiply(tq[3].setFromEuler(eul));
    const spine = tp[5].set(0, P.spineY, 0).applyQuaternion(qPel).add(pel);
    setB(rig, 'spine', spine, qSp);
    eul.set(pitch * 0.35 - lean * 0.3, twist * 0.6, breath * 0.02, 'YXZ'); qCh.copy(qSp).multiply(tq[3].setFromEuler(eul));
    const chest = tp[6].set(0, 0.21, 0).applyQuaternion(qSp).add(spine);
    chest.y = P.chestY - .5*c + breath*.01 - .011*rig.landing;
    setB(rig, 'chest', chest, qCh);
    // head looks along the aim regardless of the shoulders
    eul.set(pitch, 0, 0, 'YXZ'); qHd.setFromEuler(eul);
    const head = tp[7].set(0, 0.22, 0).applyQuaternion(qCh).add(chest);
    // Place the centre of the hood on the simulated head sphere across stance and pitch.
    head.copy(tp[8].fromArray(P.headOff).applyQuaternion(qHd)).multiplyScalar(-1);
    head.y += 1.63-.5*c; head.z += P.headZ;
    setB(rig, 'head', head, qHd);
    // weapon: held along the aim, pivoting at the upper chest
    eul.set(pitch - rig.lower * 0.9, 0, rig.lower * 0.3, 'YXZ'); qAim.setFromEuler(eul);
    if (G.time - a.lastShot < 0.07 && gm.hold !== 'knife') rig.recoil = 1; else rig.recoil = Math.max(0, rig.recoil - dt * 14);
    const pivot = tp[8].set(0, 0.12, 0).applyQuaternion(qCh).add(chest);
    const off = tp[9].fromArray(hold.off);
    off.z += rig.recoil * 0.03;
    const gunPos = tp[10].copy(off).applyQuaternion(gm.hold === 'bomb' ? qTmp.identity() : qAim).add(pivot);
    gunPos.x += Math.sin(ph)*run*.011 + breath*.002;
    gunPos.y += breath*.004;
    if (throwPhase>0) {
      const wind=Math.sin(Math.PI*Math.min(1,throwPhase/.58));
      const release=Math.sin(Math.PI*G.clamp((throwPhase-.42)/.58,0,1));
      gunPos.lerp(tp[14].set(.23,head.y+.085,.14),wind);
      gunPos.lerp(tp[14].set(.19,chest.y+.20,-.43),release);
    }
    if (gm.hold === 'bomb') gunPos.y = Math.max(gunPos.y, pel.y - 0.05);
    qGun.copy(gm.hold === 'bomb' ? qTmp.identity() : qAim);
    if (gm.hold === 'knife') qGun.multiply(tq[4].setFromEuler(eul.set(-0.5, 0, 0, 'YXZ')));
    if (rig.recoil > 0) qGun.multiply(tq[4].setFromEuler(eul.set(rig.recoil * 0.06, 0, 0, 'YXZ')));
    rig.gun.position.copy(gunPos); rig.gun.quaternion.copy(qGun);
    // arms reach for the grips
    const shL = tp[11].set(-P.shX, P.shY, P.shZ).applyQuaternion(qCh).add(chest), shR = tp[12].set(P.shX, P.shY, P.shZ).applyQuaternion(qCh).add(chest);
    const tR = tp[13].copy(gm.rightHand).applyQuaternion(qGun).add(gunPos);
    const tL = tp[14];
    const support = gm.leftHand && throwPhase < 0.2 && !(it && it.reloading && rig.lower > 0.2);
    if (support) tL.copy(gm.leftHand).applyQuaternion(qGun).add(gunPos);
    else if (it && it.reloading) tL.set(-0.02, -0.12, 0.0).applyQuaternion(qGun).add(gunPos);   // fetching a magazine
    else tL.set(-0.24, 0.0, 0.05).applyQuaternion(qPel).add(pel);                              // free hand at the side
    if (reload>0) tL.lerp(tp[15].set(-.14,pel.y+.12,-.16),reload);
    arm(rig, 'R', shR, tR, poleR.set(gm.hold === 'pistol' ? 0.35 : 0.7, -1, 0.3), qGun, HAND_R);
    arm(rig, 'L', shL, tL, poleL.set(gm.hold === 'pistol' ? -0.35 : -0.6, -1, 0.2), support || reload > 0 || (it && it.reloading) ? qGun : qPel, HAND_L);
  }
  const am = new THREE.Vector3(), ae = new THREE.Vector3(), aq = new THREE.Quaternion();
  function arm(rig, side, sh, target, pole, frameQ, handQ) {
    ik(sh, target, rig.P.lUarm, rig.P.lFarm, pole, am, ae);
    setB(rig, 'uarm' + side, sh, dirQ(tq[5], sh, am));
    setB(rig, 'farm' + side, am, dirQ(tq[6], am, ae));
    aq.copy(frameQ).multiply(handQ);
    setB(rig, 'hand' + side, ae, aq);
  }

  // ---------- death ----------
  const IMPULSE = { r90: 10, s40: 8.5, s8: 9.5, he: 11, bomb: 12, l60: 6.7, h50: 5.8, ar7: 5.5,
    tr4: 5.3, fa2: 5, v9: 3.9, u45: 4.5, k5: 3.6, p10: 3.2, m18: 3, knife: 2.2 };
  function startRagdoll(a, rig) {
    // make sure the pose is current, then take the joint positions in world space
    rig.root.updateMatrixWorld(true);
    const W = (name, off, out) => {
      const b = rig.bones[BI[name]];
      out.copy(off || tp[15].set(0, 0, 0)).applyQuaternion(b.quaternion).add(b.position).applyMatrix4(rig.root.matrixWorld);
      return out;
    };
    const pts = [
      W('pelvis', null, new THREE.Vector3()), W('chest', null, new THREE.Vector3()), W('head', null, new THREE.Vector3()), W('head', new THREE.Vector3(0, 0.15, 0), new THREE.Vector3()),
      W('uarmL', null, new THREE.Vector3()), W('farmL', null, new THREE.Vector3()), W('handL', new THREE.Vector3(0, -0.05, 0), new THREE.Vector3()),
      W('uarmR', null, new THREE.Vector3()), W('farmR', null, new THREE.Vector3()), W('handR', new THREE.Vector3(0, -0.05, 0), new THREE.Vector3()),
      W('thighL', null, new THREE.Vector3()), W('shinL', null, new THREE.Vector3()), W('footL', null, new THREE.Vector3()),
      W('thighR', null, new THREE.Vector3()), W('shinR', null, new THREE.Vector3()), W('footR', null, new THREE.Vector3()),
    ];
    const info = a.deathInfo || {};
    let idx = RD.P.CHE, k = IMPULSE[info.weapon] || 3.5;
    if (info.head) idx = RD.P.HEA; else if (info.legs) idx = Math.random() < 0.5 ? RD.P.KNL : RD.P.KNR;
    const dx = info.dirx || 0, dz = info.dirz || 0;
    const lift = info.weapon === 'he' || info.weapon === 'bomb' ? 4 : 0.8;
    const v = new THREE.Vector3(dx * k, lift + (info.diry || 0) * k, dz * k);
    const mv = rig.deathVel || a.vel;
    rig.rd = RD.create(pts, new THREE.Vector3(mv.x * 0.8, 0, mv.z * 0.8), { index: idx, v, spread: 0.45 });
    rig.deathVel = null;
    if (!info.head) RD.push(rig.rd, RD.P.PEL, new THREE.Vector3(dx * k * 0.25, 0, dz * k * 0.25), 0);
    rig.mesh.frustumCulled = false;
    rig.root.position.set(0, 0, 0); rig.root.rotation.set(0, 0, 0);
    if (rig.gun) rig.gun.visible = false;
  }
  const rx = new THREE.Vector3(), ry = new THREE.Vector3(), rz = new THREE.Vector3(), rmat = new THREE.Matrix4();
  function basisQ(q, x, y) {
    ry.copy(y).normalize();
    rx.copy(x).addScaledVector(ry, -x.dot(ry)).normalize();
    rz.crossVectors(rx, ry);
    rmat.makeBasis(rx, ry, rz);
    return q.setFromRotationMatrix(rmat);
  }
  function applyRagdoll(rig) {
    const P = RD.P, rd = rig.rd, p = (i, k) => RD.point(rd, i, tp[k]);
    const pel = p(P.PEL, 0), che = p(P.CHE, 1), nec = p(P.NEC, 2), hea = p(P.HEA, 3);
    const shL = p(P.SHL, 4), elL = p(P.ELL, 5), haL = p(P.HAL, 6), shR = p(P.SHR, 7), elR = p(P.ELR, 8), haR = p(P.HAR, 9);
    const hiL = p(P.HIL, 10), knL = p(P.KNL, 11), foL = p(P.FOL, 12), hiR = p(P.HIR, 13), knR = p(P.KNR, 14), foR = p(P.FOR, 15);
    const hipX = tp[17].subVectors(hiR, hiL), up = tp[18].subVectors(che, pel);
    setB(rig, 'pelvis', pel, basisQ(tq[0], hipX, up));
    const shX = tp[19].subVectors(shR, shL);
    setB(rig, 'spine', tp[20].copy(pel).lerp(che, 0.36), basisQ(tq[1], tp[21].addVectors(hipX, shX), up));
    setB(rig, 'chest', che, basisQ(tq[2], shX, tp[22].subVectors(nec, che)));
    setB(rig, 'head', nec, basisQ(tq[3], shX, tp[22].subVectors(hea, nec)));
    setB(rig, 'uarmL', shL, dirQ(tq[4], shL, elL)); setB(rig, 'farmL', elL, dirQ(tq[5], elL, haL)); setB(rig, 'handL', haL.addScaledVector(tp[16].subVectors(haL, elL).normalize(), -0.05), tq[5]);
    setB(rig, 'uarmR', shR, dirQ(tq[4], shR, elR)); setB(rig, 'farmR', elR, dirQ(tq[6], elR, haR)); setB(rig, 'handR', haR.addScaledVector(tp[16].subVectors(haR, elR).normalize(), -0.05), tq[6]);
    setB(rig, 'thighL', hiL, dirQ(tq[0], hiL, knL)); setB(rig, 'shinL', knL, dirQ(tq[7], knL, foL)); setB(rig, 'footL', foL, tq[7]);
    setB(rig, 'thighR', hiR, dirQ(tq[0], hiR, knR)); setB(rig, 'shinR', knR, dirQ(tq[7], knR, foR)); setB(rig, 'footR', foR, tq[7]);
  }

  // ---------- per frame ----------
  BM.update = function (a, dt) {
    const rig = a.rig;
    if (!rig) return;
    if (!a.alive) {
      if (!rig.rd) startRagdoll(a, rig);
      if (RD.update(rig.rd, dt)) applyRagdoll(rig);
      rig.root.visible = true;
      if (a.tagSprite) a.tagSprite.visible = false;
      return;
    }
    if (rig.rd) { rig.rd = null; rig.mesh.frustumCulled = true; if (rig.gun) rig.gun.visible = true; }
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
  BM.prepareDeath = function (a) { if (a.rig) a.rig.deathVel = a.vel.clone(); };
  BM.ragdollPoint = function (a, i, out) { return a.rig && a.rig.rd ? RD.point(a.rig.rd, i, out) : null; };
})(window.G);
