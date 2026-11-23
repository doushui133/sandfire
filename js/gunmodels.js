// gunmodels.js — detailed procedural weapon models (original designs built from generic weapon
// types). Units are metres; origin at the firing hand's grip, barrel along -Z, up +Y.
// Each model has a body and (where it has one) a separate magazine, so the first-person view can
// animate reloads; hand positions and the muzzle / ejection port come with it.
(function (G) {
  'use strict';
  const THREE = G.THREE, K = G.Geo;
  const GM = G.GunModels = {};

  // surfaces: c colour, r roughness, m metalness, z emissive, w edge wear
  const S = {
    steel: { c: 0x2c2d30, r: 0.4, m: 0.85, w: 0.7 },
    dark: { c: 0x1c1d1f, r: 0.5, m: 0.75, w: 0.4 },
    black: { c: 0x141414, r: 0.62, m: 0.05, w: 0.15 },
    rubber: { c: 0x18191a, r: 0.85, m: 0, w: 0 },
    wood: { c: 0x4c2c19, r: 0.55, m: 0, w: 0.2 },
    woodDark: { c: 0x4e2a16, r: 0.5, m: 0, w: 0.15 },
    tan: { c: 0x9a8360, r: 0.62, m: 0.02, w: 0.2 },
    olive: { c: 0x4d553a, r: 0.6, m: 0.05, w: 0.3 },
    silver: { c: 0xb1b4b8, r: 0.2, m: 1, w: 0.2 },
    brass: { c: 0xb08d3c, r: 0.3, m: 1, w: 0 },
    glass: { c: 0x0b1016, r: 0.04, m: 0.3, w: 0 },
    lens: { c: 0x1a2a3c, r: 0.03, m: 0.6, w: 0 },
    red: { c: 0xff3020, r: 0.3, m: 0, z: 1 },
    lcd: { c: 0x5cff70, r: 0.2, m: 0, z: 0.9 },
    clay: { c: 0xd9cfae, r: 0.85, m: 0 },
    tape: { c: 0x3b3a36, r: 0.7, m: 0 },
    box: { c: 0x3c4a34, r: 0.55, m: 0.1, w: 0.3 },
    wireR: { c: 0xb0281e, r: 0.5, m: 0 }, wireB: { c: 0x2a4e9a, r: 0.5, m: 0 }, wireY: { c: 0xc8a42a, r: 0.5, m: 0 },
    blade: { c: 0xc6c9cc, r: 0.18, m: 1, w: 0.1 },
    worn: { c: 0x8d9096, r: 0.28, m: 1, w: 1 },
    blued: { c: 0x23262c, r: 0.34, m: 0.92, w: 0.85 },
  };
  const qbez = (p0, p1, p2, n) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; o.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]); } return o; };
  const box = (b, s, w, h, d, x, y, z, rx, ry, rz) => b.add(K.at(K.box(w, h, d), x, y, z, rx, ry, rz), s);
  const rbox = (b, s, w, h, d, r, x, y, z, rx, ry, rz) => b.add(K.at(K.rbox(w, h, d, r, 1), x, y, z, rx, ry, rz), s);
  const cylZ = (b, s, r0, r1, len, x, y, z, seg) => b.add(K.at(K.cyl(r0, r1, len, seg || 14, 'z'), x, y, z), s);
  const cylX = (b, s, r, len, x, y, z, seg) => b.add(K.at(K.cyl(r, r, len, seg || 10, 'x'), x, y, z), s);
  const cylY = (b, s, r, len, x, y, z, seg, rx, rz) => b.add(K.at(K.cyl(r, r, len, seg || 10, 'y'), x, y, z, rx || 0, 0, rz || 0), s);
  const prof = (b, s, pts, w, x, holes, bevel) => b.add(K.at(K.profile(pts, w, bevel, holes), x || 0, 0, 0), s);
  // picatinny-style rail with cross slots
  function rail(b, len, y, z0, w) {
    box(b, S.dark, w || 0.021, 0.006, len, 0, y, z0 - len / 2);
    for (let z = z0 - 0.006; z > z0 - len + 0.004; z -= 0.01) box(b, S.dark, (w || 0.021) + 0.004, 0.005, 0.0052, 0, y + 0.005, z);
  }
  function triggerGroup(b, z, y, s) {
    s = s || S.steel;
    box(b, s, 0.009, 0.006, 0.07, 0, y - 0.044, z - 0.012);
    box(b, s, 0.009, 0.046, 0.006, 0, y - 0.022, z - 0.048);
    b.add(K.at(K.torus(0.012, 0.0028, 5, 8, Math.PI), 0, y - 0.016, z - 0.004, 0, Math.PI / 2, Math.PI / 2 + 0.25), S.steel);
  }
  function pinX(b, y, z, len) { cylX(b, S.silver, 0.0026, len || 0.052, 0, y, z, 6); }
  function gripRibs(b, surf, y0, z, n) {
    for (let i = 0; i < n; i++) box(b, surf, 0.033, 0.0032, 0.016, 0, y0 - i * 0.011, z + i * 0.002);
  }

  const builders = {};
  // ---------- AR-7: stamped-receiver assault rifle, wood furniture, curved magazine ----------
  builders.ar7 = function () {
    const b = new K.Builder(), mg = new K.Builder();
    rbox(b, S.steel, 0.046, 0.066, 0.4, 0.005, 0, 0.034, -0.11);
    rbox(b, S.steel, 0.044, 0.026, 0.37, 0.011, 0, 0.074, -0.1);
    for (let i = 0; i < 4; i++) box(b, S.dark, 0.046, 0.004, 0.006, 0, 0.087, 0.05 - i * 0.012);
    box(b, S.dark, 0.003, 0.014, 0.1, 0.024, 0.052, -0.035);              // selector lever
    cylX(b, S.steel, 0.006, 0.03, 0.03, 0.06, -0.15);                        // charging handle
    box(b, S.dark, 0.002, 0.016, 0.07, 0.024, 0.055, -0.15);               // ejection port
    prof(b, S.wood, [[0.03, 0.004], [0.075, 0.004], [0.112, -0.1], [0.07, -0.112], [0.03, -0.012]], 0.032);
    triggerGroup(b, 0.02, 0.0);
    box(b, S.steel, 0.006, 0.026, 0.006, 0, -0.016, 0.005, 0.3);
    // stock with butt plate
    prof(b, S.wood, [[0.085, 0.07], [0.34, 0.052], [0.36, 0.05], [0.37, -0.075], [0.355, -0.088], [0.25, -0.055], [0.13, -0.022], [0.085, -0.002]], 0.042);
    box(b, S.black, 0.044, 0.135, 0.014, 0, -0.016, 0.368, 0.08);
    // handguards
    rbox(b, S.wood, 0.054, 0.046, 0.21, 0.012, 0, 0.03, -0.425);
    for (let i = 0; i < 3; i++) box(b, S.woodDark, 0.056, 0.004, 0.17, 0, 0.022 + i * 0.012, -0.425);
    rbox(b, S.wood, 0.04, 0.03, 0.17, 0.012, 0, 0.098, -0.42);
    cylZ(b, S.steel, 0.012, 0.012, 0.1, 0, 0.1, -0.56);                    // gas tube
    box(b, S.steel, 0.03, 0.05, 0.032, 0, 0.075, -0.6);                     // gas block
    cylZ(b, S.steel, 0.0105, 0.0105, 0.5, 0, 0.055, -0.55);                // barrel
    box(b, S.steel, 0.024, 0.052, 0.04, 0, 0.06, -0.74);                    // front sight base
    box(b, S.steel, 0.004, 0.03, 0.004, 0, 0.1, -0.74);
    box(b, S.steel, 0.018, 0.012, 0.03, 0, 0.1, -0.29);                     // rear sight block
    cylZ(b, S.dark, 0.0145, 0.0145, 0.06, 0, 0.055, -0.81, 12);            // muzzle brake
    b.add(K.at(K.torus(0.009, 0.0022, 4, 10), 0, 0.03, -0.53, 0, Math.PI / 2, 0), S.steel);
    // curved magazine with ribs
    const front = qbez([-0.145, 0.006], [-0.15, -0.13], [-0.215, -0.245], 8), back = qbez([-0.078, 0.006], [-0.085, -0.13], [-0.145, -0.255], 8);
    const pts = front.concat([[-0.18, -0.262]]).concat(back.slice().reverse());
    mg.add(K.at(K.profile(pts, 0.03, 0.003), 0, 0, 0), S.dark);
    const rib = qbez([-0.11, -0.03], [-0.117, -0.13], [-0.172, -0.235], 6);
    for (let i = 0; i < rib.length - 1; i++) {
      const [z0, y0] = rib[i], [z1, y1] = rib[i + 1];
      mg.add(K.at(K.box(0.034, Math.hypot(z1 - z0, y1 - y0) + 0.002, 0.012), 0, (y0 + y1) / 2, (z0 + z1) / 2, -Math.atan2(z1 - z0, -(y1 - y0)), 0, 0), S.steel);
    }
    for (let i = 0; i < 4; i++) pinX(b, 0.048, -0.02 - i * 0.07, 0.05);
    gripRibs(b, S.woodDark, -0.018, 0.018, 5);
    box(b, S.steel, 0.022, 0.008, 0.02, 0, 0.114, -0.74);
    box(b, S.worn, 0.007, 0.018, 0.006, -0.008, 0.11, -0.74);
    box(b, S.worn, 0.007, 0.018, 0.006, 0.008, 0.11, -0.74);
    for (let i = 0; i < 3; i++) box(b, S.black, 0.003, 0.014, 0.012, 0, 0.055, -0.8, 0, i * 0.8, 0);
    return { b, mg, muzzle: [0, 0.055, -0.845], eject: [0.026, 0.06, -0.15], rightHand: [0, -0.035, 0.06], leftHand: [0, 0.028, -0.42], magPivot: [0, -0.05, -0.11], sight: 0.105, hold: 'rifle' };
  };
  // ---------- TR-4: modular carbine with rail handguard, red-dot sight, telescoping stock ----------
  builders.tr4 = function () {
    const b = new K.Builder(), mg = new K.Builder();
    rbox(b, S.black, 0.04, 0.05, 0.21, 0.006, 0, 0.022, -0.07);             // lower receiver
    rbox(b, S.black, 0.036, 0.05, 0.075, 0.005, 0, -0.012, -0.125);         // magwell
    rbox(b, S.black, 0.042, 0.044, 0.25, 0.006, 0, 0.068, -0.11);           // upper receiver
    rail(b, 0.25, 0.094, 0.015);
    box(b, S.dark, 0.002, 0.014, 0.06, 0.022, 0.066, -0.12);               // ejection port cover
    cylX(b, S.dark, 0.006, 0.012, 0.025, 0.062, -0.07);                      // forward assist
    box(b, S.black, 0.05, 0.009, 0.014, 0, 0.09, 0.03);                     // charging handle
    rbox(b, S.black, 0.054, 0.054, 0.35, 0.01, 0, 0.066, -0.41);            // handguard
    rail(b, 0.35, 0.097, -0.235);
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) box(b, S.dark, 0.004, 0.012, 0.03, sx * 0.026, 0.06, -0.3 - i * 0.055);
    cylZ(b, S.steel, 0.0095, 0.0095, 0.12, 0, 0.06, -0.64);
    cylZ(b, S.dark, 0.0125, 0.0125, 0.055, 0, 0.06, -0.725, 12);           // flash hider
    for (let i = 0; i < 4; i++) box(b, S.black, 0.0026, 0.026, 0.032, 0, 0.06, -0.735, 0, 0, i * Math.PI / 4);
    box(b, S.black, 0.016, 0.012, 0.03, 0, 0.11, -0.57);                    // folded front sight
    // red-dot sight
    box(b, S.black, 0.03, 0.01, 0.06, 0, 0.104, -0.11);
    rbox(b, S.black, 0.04, 0.044, 0.064, 0.008, 0, 0.13, -0.11);
    box(b, S.lens, 0.03, 0.028, 0.003, 0, 0.134, -0.077);
    box(b, S.lens, 0.03, 0.028, 0.003, 0, 0.134, -0.143);
    box(b, S.red, 0.0035, 0.0035, 0.002, 0, 0.134, -0.144);
    cylX(b, S.black, 0.008, 0.012, 0.026, 0.13, -0.11);
    prof(b, S.black, [[0.022, 0.0], [0.064, 0.0], [0.1, -0.098], [0.062, -0.108], [0.026, -0.012]], 0.03);
    triggerGroup(b, 0.02, 0.0, S.black);
    cylZ(b, S.black, 0.016, 0.016, 0.2, 0, 0.055, 0.2);                     // buffer tube
    prof(b, S.black, [[0.16, 0.082], [0.3, 0.08], [0.31, 0.07], [0.312, -0.072], [0.268, -0.074], [0.22, -0.02], [0.16, 0.02]], 0.046);
    box(b, S.rubber, 0.05, 0.155, 0.012, 0, 0.005, 0.314);
    const front = qbez([-0.152, 0.0], [-0.152, -0.09], [-0.17, -0.19], 6), back = qbez([-0.098, 0.0], [-0.098, -0.09], [-0.112, -0.2], 6);
    mg.add(K.at(K.profile(front.concat(back.slice().reverse()), 0.028, 0.0025), 0, 0, 0), S.dark);
    mg.add(K.at(K.box(0.034, 0.016, 0.07), 0, -0.198, -0.142, 0.12), S.black);
    for (let i = 0; i < 5; i++) box(b, S.dark, 0.03, 0.003, 0.012, 0, -0.02 - i * 0.012, 0.01);
    for (let i = 0; i < 3; i++) pinX(b, 0.03, -0.02 - i * 0.06, 0.044);
    cylY(b, S.worn, 0.004, 0.004, 0.02, 0.1, -0.11, 6);
    return { b, mg, muzzle: [0, 0.06, -0.755], eject: [0.024, 0.066, -0.12], rightHand: [0, -0.035, 0.05], leftHand: [0, 0.026, -0.41], magPivot: [0, -0.04, -0.125], sight: 0.134, hold: 'rifle' };
  };
  // ---------- V9: compact SMG with foregrip and folding stock ----------
  builders.v9 = function () {
    const b = new K.Builder(), mg = new K.Builder();
    rbox(b, S.black, 0.046, 0.07, 0.3, 0.008, 0, 0.038, -0.09);
    rbox(b, S.dark, 0.044, 0.02, 0.29, 0.006, 0, 0.08, -0.09);
    rail(b, 0.14, 0.094, -0.02);
    box(b, S.dark, 0.002, 0.02, 0.06, 0.024, 0.05, -0.08);
    cylZ(b, S.dark, 0.016, 0.016, 0.1, 0, 0.05, -0.285, 14);
    for (let i = 0; i < 5; i++) box(b, S.black, 0.034, 0.004, 0.006, 0, 0.066, -0.25 - i * 0.016);
    cylZ(b, S.steel, 0.008, 0.008, 0.03, 0, 0.05, -0.345, 10);
    box(b, S.black, 0.004, 0.018, 0.006, 0, 0.1, -0.21);
    prof(b, S.black, [[0.02, 0.004], [0.06, 0.004], [0.092, -0.096], [0.055, -0.106], [0.022, -0.01]], 0.03);
    triggerGroup(b, 0.02, 0.0, S.black);
    cylY(b, S.black, 0.014, 0.085, 0, -0.04, -0.2, 10);
    for (const sx of [-1, 1]) cylZ(b, S.steel, 0.004, 0.004, 0.24, sx * 0.018, 0.04, 0.17, 6);
    box(b, S.rubber, 0.05, 0.08, 0.012, 0, 0.03, 0.29);
    mg.add(K.at(K.rbox(0.026, 0.19, 0.034, 0.004, 1), 0, -0.07, -0.085, 0.12), S.dark);
    mg.add(K.at(K.box(0.03, 0.012, 0.04), 0, -0.165, -0.074, 0.12), S.black);
    for (let i = 0; i < 6; i++) box(mg, S.steel, 0.028, 0.004, 0.036, 0, -0.04 - i * 0.02, -0.085, 0.12);
    gripRibs(b, S.black, -0.02, 0.02, 4);
    for (let i = 0; i < 3; i++) pinX(b, 0.04, -0.04 - i * 0.06, 0.05);
    return { b, mg, muzzle: [0, 0.05, -0.36], eject: [0.024, 0.06, -0.08], rightHand: [0, -0.035, 0.045], leftHand: [0, -0.05, -0.2], magPivot: [0, -0.03, -0.085], sight: 0.1, hold: 'rifle' };
  };
  // ---------- R-90: bolt-action sniper rifle with chassis stock and large scope ----------
  builders.r90 = function () {
    const b = new K.Builder(), mg = new K.Builder();
    prof(b, S.olive, [[-0.56, 0.05], [-0.06, 0.05], [0.04, 0.03], [0.12, 0.05], [0.4, 0.07], [0.43, 0.07], [0.44, -0.1], [0.4, -0.105], [0.2, -0.05], [0.12, -0.12], [0.06, -0.13], [0.03, -0.02], [-0.56, -0.012]], 0.052, 0, [[[0.04, -0.02], [0.1, -0.02], [0.13, -0.09], [0.08, -0.1]]]);
    box(b, S.black, 0.054, 0.16, 0.014, 0, -0.02, 0.44);                    // recoil pad
    rbox(b, S.olive, 0.03, 0.03, 0.14, 0.008, 0, 0.09, 0.27);               // cheek riser
    cylZ(b, S.steel, 0.021, 0.021, 0.26, 0, 0.07, -0.02, 16);              // action
    cylX(b, S.steel, 0.005, 0.05, 0.05, 0.075, 0.08);                        // bolt handle
    b.add(K.at(K.sphere(0.011, 0.011, 0.011, 10, 8), 0.078, 0.065, 0.08), S.black);
    cylZ(b, S.steel, 0.012, 0.0095, 0.72, 0, 0.07, -0.51, 14);
    for (let i = 0; i < 6; i++) box(b, S.dark, 0.003, 0.003, 0.36, Math.cos(i * 1.047) * 0.011, 0.07 + Math.sin(i * 1.047) * 0.011, -0.5);
    rbox(b, S.dark, 0.03, 0.03, 0.06, 0.005, 0, 0.07, -0.9);                // muzzle brake
    for (const sx of [-1, 1]) box(b, S.black, 0.004, 0.012, 0.03, sx * 0.016, 0.07, -0.9);
    // scope: rail, rings, tube, bells, turrets, lenses
    box(b, S.black, 0.022, 0.012, 0.2, 0, 0.098, -0.02);
    for (const z of [-0.08, 0.05]) rbox(b, S.black, 0.03, 0.05, 0.022, 0.006, 0, 0.12, z);
    cylZ(b, S.black, 0.0175, 0.0175, 0.3, 0, 0.14, -0.02, 18);
    b.add(K.at(K.lathe([[0.0175, 0], [0.026, 0.05], [0.027, 0.1], [0.025, 0.105], [0.0, 0.105]], 18), 0, 0.14, -0.17, -Math.PI / 2), S.black);
    b.add(K.at(K.lathe([[0.0, 0], [0.023, 0], [0.024, 0.06], [0.0175, 0.09]], 18), 0, 0.14, 0.22, -Math.PI / 2), S.black);
    cylY(b, S.black, 0.012, 0.03, 0, 0.17, -0.02, 12);
    cylX(b, S.black, 0.011, 0.03, 0.03, 0.14, -0.02, 12);
    b.add(K.at(K.cyl(0.024, 0.024, 0.002, 18, 'z'), 0, 0.14, -0.276), S.lens);
    b.add(K.at(K.cyl(0.02, 0.02, 0.002, 16, 'z'), 0, 0.14, 0.221), S.lens);
    for (const sx of [-1, 1]) cylZ(b, S.dark, 0.006, 0.006, 0.18, sx * 0.016, -0.025, -0.42, 6);
    prof(b, S.black, [[0.0, 0.0], [0.03, 0.0], [0.06, -0.075], [0.03, -0.085], [0.0, -0.01]], 0.03);
    triggerGroup(b, 0.02, -0.01, S.black);
    mg.add(K.at(K.rbox(0.03, 0.06, 0.09, 0.004, 1), 0, -0.035, -0.05), S.black);
    for (let i = 0; i < 3; i++) box(mg, S.olive, 0.032, 0.004, 0.07, 0, -0.02 - i * 0.012, -0.05);
    gripRibs(b, S.black, -0.02, 0.02, 4);
    pinX(b, 0.07, -0.08, 0.046); pinX(b, 0.07, 0.06, 0.046);
    cylY(b, S.worn, 0.008, 0.006, 0, 0.186, -0.02, 6);
    return { b, mg, muzzle: [0, 0.07, -0.935], eject: [0.024, 0.08, 0.0], rightHand: [0, -0.04, 0.07], leftHand: [0, -0.02, -0.3], magPivot: [0, -0.03, -0.05], sight: 0.14, hold: 'rifle' };
  };
  // ---------- pistols ----------
  function pistol(silver) {
    const b = new K.Builder(), mg = new K.Builder();
    const L = silver ? 0.235 : 0.19, H = silver ? 0.036 : 0.031, sl = silver ? S.silver : S.dark;
    prof(b, sl, [[0.032, 0.026], [0.032, 0.026 + H], [-L + 0.02, 0.026 + H], [-L + 0.006, 0.026 + H * 0.6], [-L + 0.006, 0.026], [0.032, 0.026]], silver ? 0.03 : 0.025);
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) box(b, S.black, 0.002, H * 0.7, 0.003, sx * (silver ? 0.0152 : 0.0127), 0.028 + H * 0.5, 0.025 - i * 0.006);
    box(b, S.black, 0.003, 0.006, 0.004, 0, 0.026 + H + 0.003, -L + 0.03);
    box(b, S.black, 0.012, 0.006, 0.006, 0, 0.026 + H + 0.003, 0.024);
    cylZ(b, S.steel, 0.0065, 0.0065, 0.02, 0, 0.026 + H * 0.45, -L + 0.01, 10);
    if (silver) { box(b, S.black, 0.008, 0.022, 0.014, 0, 0.05, 0.038, -0.4); for (let i = 0; i < 3; i++) box(b, S.black, 0.031, 0.004, 0.012, 0, 0.026 + H, -L + 0.04 + i * 0.016); }
    box(b, S.black, silver ? 0.028 : 0.023, 0.02, L * 0.65, 0, 0.016, -L * 0.42);
    prof(b, silver ? S.rubber : S.black, [[0.032, 0.008], [-0.012, 0.008], [-0.022, -0.1], [0.022, -0.112], [0.042, -0.01]], silver ? 0.032 : 0.028);
    triggerGroup(b, -0.006, 0.006, S.black);
    box(b, S.steel, 0.004, 0.01, 0.045, (silver ? 0.016 : 0.013), 0.03 + H * 0.35, -0.04);
    pinX(b, -0.03, 0.01, silver ? 0.034 : 0.028);
    for (let i = 0; i < 4; i++) box(b, S.black, silver ? 0.03 : 0.026, 0.0035, 0.012, 0, -0.018 - i * 0.016, 0.02);
    mg.add(K.at(K.box(silver ? 0.028 : 0.024, 0.012, 0.05), 0, -0.112, 0.006, 0.12), S.black);
    for (let i = 0; i < 3; i++) box(mg, silver ? S.silver : S.dark, silver ? 0.03 : 0.026, 0.003, 0.04, 0, -0.1 - i * 0.012, 0.006);
    box(mg, S.black, silver ? 0.032 : 0.028, 0.01, 0.022, 0, -0.122, 0.01);
    return { b, mg, muzzle: [0, 0.026 + H * 0.45, -L - 0.004], eject: [0.016, 0.026 + H * 0.8, -0.03], rightHand: [0, -0.04, 0.012], leftHand: [-0.026, -0.05, 0.0], magPivot: [0, -0.06, 0.0], sight: 0.026 + H + 0.008, hold: 'pistol' };
  }
  builders.p10 = () => pistol(false);
  builders.h50 = () => pistol(true);
  // ---------- knife ----------
  builders.knife = function () {
    const b = new K.Builder();
    const spine = [[-0.035, 0.013], [-0.14, 0.013], [-0.195, 0.0]];
    const edge = qbez([-0.195, 0.0], [-0.12, -0.028], [-0.035, -0.016], 8);
    b.add(K.at(K.profile(spine.concat(edge), 0.0045, 0.0018), 0, 0, 0), S.blade);
    box(b, S.steel, 0.014, 0.05, 0.008, 0, -0.002, -0.032);
    rbox(b, S.rubber, 0.024, 0.032, 0.11, 0.009, 0, -0.002, 0.026);
    for (let i = 0; i < 4; i++) box(b, S.black, 0.026, 0.006, 0.006, 0, -0.016, 0.0 + i * 0.022);
    rbox(b, S.steel, 0.026, 0.034, 0.016, 0.005, 0, -0.002, 0.085);
    cylX(b, S.brass, 0.0032, 0.026, 0, 0.002, 0.02, 6);
    cylX(b, S.brass, 0.0032, 0.026, 0, 0.002, 0.05, 6);
    box(b, S.worn, 0.006, 0.004, 0.03, 0, 0.012, -0.1);
    return { b, mg: null, muzzle: [0, 0, -0.2], eject: [0, 0, 0], rightHand: [0, 0, 0.03], leftHand: null, magPivot: [0, 0, 0], sight: 0, hold: 'knife' };
  };
  // ---------- bomb: putty blocks, tape, keypad device, wires ----------
  builders.bomb = function () {
    const b = new K.Builder();
    for (let i = 0; i < 4; i++) rbox(b, S.clay, 0.09, 0.042, 0.065, 0.008, (i % 2 ? 0.047 : -0.047), 0.021, (i < 2 ? -0.034 : 0.034));
    for (const z of [-0.045, 0.045]) box(b, S.tape, 0.196, 0.046, 0.016, 0, 0.022, z);
    rbox(b, S.box, 0.11, 0.032, 0.075, 0.006, 0, 0.06, 0);
    box(b, S.glass, 0.06, 0.003, 0.022, 0, 0.0775, -0.018);
    box(b, S.lcd, 0.05, 0.001, 0.014, 0, 0.0795, -0.018);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box(b, S.black, 0.013, 0.004, 0.009, -0.024 + c * 0.016, 0.078, 0.008 + r * 0.012);
    const wire = (s, pts) => b.add(K.tube(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), pts.map(() => 0.003), 5), s);
    wire(S.wireR, [[0.05, 0.065, -0.02], [0.08, 0.06, -0.03], [0.095, 0.03, -0.03]]);
    wire(S.wireB, [[0.05, 0.065, 0.0], [0.085, 0.07, 0.0], [0.098, 0.03, 0.01]]);
    wire(S.wireY, [[0.05, 0.065, 0.02], [0.075, 0.07, 0.035], [0.09, 0.03, 0.04]]);
    cylY(b, S.black, 0.002, 0.07, -0.045, 0.11, 0.028, 5);
    box(b, S.wireY, 0.1, 0.004, 0.008, 0, 0.078, 0.03);
    for (let i = 0; i < 4; i++) cylY(b, S.silver, 0.0022, 0.004, -0.04 + (i % 2) * 0.08, 0.08, -0.028 + (i > 1 ? 0.04 : 0), 5);
    return { b, mg: null, muzzle: [0, 0.05, -0.05], eject: [0, 0, 0], rightHand: [0.06, 0.03, 0.04], leftHand: [-0.06, 0.03, 0.04], magPivot: [0, 0, 0], sight: 0, hold: 'bomb' };
  };

  builders.m18 = function () {
    const d=pistol(false);
    rbox(d.b,S.olive,.036,.025,.13,.005,0,.018,-.105);
    cylZ(d.b,S.steel,.012,.014,.065,0,.04,-.211);
    for (let i=0;i<4;i++) cylX(d.b,S.black,.004,.029,0,.042,-.196-i*.012);
    rbox(d.mg,S.dark,.027,.086,.046,.005,0,-.141,.005);
    box(d.mg,S.olive,.034,.016,.05,0,-.19,.005);
    d.muzzle[2]=-.245; return d;
  };
  // Each frame sets its own receiver length, stock, finish and support-hand position.
  const frames={
    k5:[.22,.33,.17,S.olive], u45:[.31,.48,.23,S.black], s8:[.32,.78,.32,S.wood],
    fa2:[.36,.62,.27,S.tan], s40:[.35,.84,.35,S.woodDark], l60:[.47,.79,.34,S.box],
  };
  function addReloadShell(mg) {
    cylZ(mg,S.wireR,.01,.01,.054,-.035,-.019,-.12);
    cylZ(mg,S.brass,.011,.011,.01,-.035,-.019,-.089);
  }
  function longGun(id) {
    const [length,reach,stock,finish]=frames[id], b=new K.Builder(), mg=new K.Builder();
    const pump=id==='s8', bolt=id==='s40', belt=id==='l60', compact=id==='k5';
    const width=belt ? .074 : compact ? .04 : .049, front=.07-length, grip=front*.85;
    rbox(b,finish,width,.067,length,.008,0,.031,.07-length/2);
    rbox(b,S.steel,width*.94,.028,length*.91,.006,0,.073,.06-length*.455);
    cylZ(b,S.steel,belt ? .019 : .014,.011,reach+front,0,.056,(front-reach)/2);
    cylZ(b,S.dark,.018,.019,.053,0,.056,-reach+.026);
    for (let i=0;i<4;i++) cylX(b,S.black,.003,.038,0,.057,-reach+.009+i*.01);
    triggerGroup(b,.018,.004);
    prof(b,S.rubber,[[.014,.012],[.055,.011],[.085,-.09],[.048,-.106],[.016,-.015]],.033);
    for (let i=0;i<4;i++) box(b,S.black,.036,.006,.028,0,-.027-i*.018,.044+i*.006);
    box(b,S.dark,.004,.018,.069,width/2,.051,-.077);
    for (const z of [.03,front+.04]) cylX(b,S.silver,.003,width+.003,0,.035,z);
    if (compact || id==='fa2') {
      for (const y of [.053,-.01]) cylZ(b,S.steel,.007,.007,stock,0,y,.07+stock/2);
    } else {
      prof(b,finish,[[.065,.061],[stock+.06,.078],[stock+.07,-.065],[stock-.018,-.062],[.09,-.004]],width);
      if (bolt) rbox(b,S.rubber,.046,.022,.15,.006,0,.08,stock-.02);
    }
    box(b,S.rubber,width+.006,.134,.012,0,.005,stock+.073);
    if (!pump) {
      rbox(b,finish,width+.008,.054,(reach+front)*.57,.013,0,.041,front-(reach+front)*.25);
      for (let i=1;i<=6;i++) box(b,S.dark,width+.009,.012,.011,0,.046,front-(reach+front)*i*.07);
    }
    rail(b,compact ? .095 : .17,.091,-.005);
    box(b,S.dark,.024,.025,.018,0,.095,front+.02);
    box(b,S.dark,.005,.037,.008,0,.077,-reach+.07);
    const magazineZ=compact ? .04 : belt ? -.18 : -.115;
    let action;
    if (pump) {
      cylZ(b,S.dark,.014,.014,.48,0,.02,-.48);
      action=new K.Builder();
      rbox(action,S.wood,.061,.046,.18,.014,0,.018,-.46);
      for (let i=0;i<8;i++) box(action,S.woodDark,.062,.027,.006,0,.017,-.39-i*.02);
      addReloadShell(mg);
    } else if (belt) {
      rbox(mg,S.box,.12,.14,.16,.012,-.018,-.065,magazineZ);
      for (let i=0;i<5;i++) box(mg,S.dark,.124,.005,.13,-.018,-.015-i*.023,magazineZ);
      for (let i=0;i<6;i++) cylZ(b,S.brass,.005,.004,.052,-.038-i*.009,.05-i*.006,-.16);
      for (const side of [-1,1]) box(b,S.dark,.009,.22,.009,side*.045,-.054,-.56,0,0,side*.34);
      prof(b,S.black,[[-.24,.08],[-.22,.14],[-.08,.14],[-.06,.08],[-.09,.085],[-.1,.119],[-.20,.119],[-.215,.08]],.018);
    } else {
      const depth=bolt ? .065 : compact ? .19 : id==='u45' ? .205 : .155;
      rbox(mg,S.dark,.034,depth,.052,.005,0,-depth/2,magazineZ);
      for (let i=0;i<4;i++) box(mg,finish,.036,.005,.045,0,-depth*(i+1)/5,magazineZ);
      box(mg,S.black,.042,.013,.064,0,-depth,magazineZ);
      if (bolt) {
        for (const z of [.013,-.105]) rbox(b,S.steel,.032,.037,.022,.006,0,.11,z);
        cylZ(b,S.dark,.019,.019,.22,0,.135,-.05);
        cylZ(b,S.dark,.027,.018,.065,0,.135,-.183);
        cylZ(b,S.lens,.023,.023,.003,0,.135,-.217);
        action=new K.Builder(); cylX(action,S.steel,.005,.045,.04,.075,.036);
        action.add(K.at(K.sphere(.012,.012,.012,10,6),.065,.07,.036),S.black);
      } else if (compact) cylY(b,S.rubber,.016,.095,0,-.035,grip);
      else if (id==='u45') cylZ(b,S.dark,.027,.027,.12,0,.053,-reach+.08);
    }
    for (let i = 0; i < 3; i++) pinX(b, 0.04, front * 0.3 - i * length * 0.18, width + 0.004);
    gripRibs(b, S.black, -0.028, 0.04, 4);
    if (!bolt) {
      box(b, S.dark, 0.006, 0.02, 0.008, -0.007, 0.1, 0.02);
      box(b, S.dark, 0.006, 0.02, 0.008, 0.007, 0.1, 0.02);
    }
    if (id === 'u45') for (let i = 0; i < 4; i++) cylZ(b, S.blued, 0.03, 0.03, 0.008, 0, 0.056, -reach + 0.05 + i * 0.022, 10);
    if (id === 'fa2') box(b, S.tan, 0.014, 0.028, 0.1, 0, 0.115, -0.02);
    if (id === 'k5') for (let i = 0; i < 3; i++) box(b, S.black, 0.004, 0.02, 0.012, 0, 0.056, -reach + 0.02, 0, i * 0.7, 0);
    if (id === 'l60') box(b, S.worn, 0.04, 0.006, 0.08, 0, 0.108, -0.05);
    return {b,mg,action, muzzle:[0,.056,-reach],eject:[width/2,.055,-.08],rightHand:[0,-.034,.047],
      leftHand:[0,pump ? .005 : -.006,pump ? -.46 : grip],magPivot:[0,-.035,magazineZ],sight:bolt ? .135 : .1,hold:'rifle'};
  }
  for (const id in frames) builders[id]=()=>longGun(id);
  const nadeAnchor = { muzzle: [0, 0.07, 0], eject: [0, 0, 0], rightHand: [0, -0.015, 0], leftHand: [-0.031, 0.053, 0], magPivot: [0, 0.064, 0], sight: 0, hold: 'pistol' };
  builders.he = function () {
    const b = new K.Builder(), mg = new K.Builder();
    b.add(K.lathe([[0, -0.058], [0.03, -0.05], [0.048, -0.012], [0.05, 0.016], [0.04, 0.04], [0.018, 0.056], [0, 0.06]], 12), S.olive);
    for (let i = 0; i < 5; i++) b.add(K.at(K.torus(0.046 - i * 0.003, 0.0042, 4, 10), 0, -0.034 + i * 0.016, 0, Math.PI / 2, 0, 0), S.dark);
    cylY(b, S.steel, 0.013, 0.014, 0, 0.064, 0, 8);
    box(b, S.steel, 0.01, 0.068, 0.012, 0.032, 0.02, 0, 0, 0, 0.2);
    mg.add(K.at(K.torus(0.016, 0.0022, 5, 10), -0.02, 0.072, 0), S.brass);
    box(mg, S.steel, 0.008, 0.02, 0.01, -0.032, 0.06, 0);
    return { b, mg, muzzle: nadeAnchor.muzzle.slice(), eject: nadeAnchor.eject.slice(), rightHand: nadeAnchor.rightHand.slice(), leftHand: nadeAnchor.leftHand.slice(), magPivot: nadeAnchor.magPivot.slice(), sight: 0, hold: 'pistol' };
  };
  builders.flash = function () {
    const b = new K.Builder(), mg = new K.Builder();
    b.add(K.lathe([[0, -0.07], [0.03, -0.066], [0.034, 0.042], [0.02, 0.056], [0, 0.06]], 12), S.silver);
    cylY(b, S.dark, 0.0355, 0.014, 0, -0.008, 0, 12);
    cylX(b, S.black, 0.007, 0.02, 0.026, 0, 0, 6); cylX(b, S.black, 0.007, 0.02, -0.026, 0, 0, 6);
    cylZ(b, S.black, 0.007, 0.007, 0.02, 0, 0, 0.026, 6); cylZ(b, S.black, 0.007, 0.007, 0.02, 0, 0, -0.026, 6);
    cylY(b, S.steel, 0.012, 0.012, 0, 0.062, 0, 8);
    box(b, S.blued, 0.008, 0.05, 0.01, 0.03, 0.016, 0);
    mg.add(K.at(K.torus(0.014, 0.002, 5, 10), -0.016, 0.068, 0), S.brass);
    return { b, mg, muzzle: [0, 0.07, 0], eject: [0, 0, 0], rightHand: [0, -0.015, 0], leftHand: [-0.031, 0.053, 0], magPivot: [0, 0.064, 0], sight: 0, hold: 'pistol' };
  };
  builders.smoke = function () {
    const b = new K.Builder(), mg = new K.Builder();
    b.add(K.lathe([[0, -0.074], [0.028, -0.07], [0.034, 0.02], [0.03, 0.05], [0.012, 0.068], [0, 0.074]], 12), S.clay);
    cylY(b, S.olive, 0.035, 0.022, 0, 0.008, 0, 12);
    cylY(b, S.dark, 0.016, 0.01, 0, 0.066, 0, 8);
    for (let i = 0; i < 4; i++) cylY(b, S.dark, 0.004, 0.006, Math.cos(i * 1.57) * 0.01, 0.07, Math.sin(i * 1.57) * 0.01, 5);
    box(b, S.steel, 0.008, 0.05, 0.01, 0.03, 0, 0);
    mg.add(K.at(K.torus(0.015, 0.0022, 5, 10), -0.018, 0.078, 0), S.brass);
    return { b, mg, muzzle: [0, 0.07, 0], eject: [0, 0, 0], rightHand: [0, -0.015, 0], leftHand: [-0.031, 0.053, 0], magPivot: [0, 0.064, 0], sight: 0, hold: 'pistol' };
  };
  builders.molotov = function () {
    const b = new K.Builder(), mg = new K.Builder();
    b.add(K.lathe([[0, -0.1], [0.022, -0.098], [0.042, -0.07], [0.044, 0.02], [0.026, 0.055], [0.014, 0.1], [0.012, 0.125], [0, 0.125]], 12), S.woodDark);
    cylY(b, S.tape, 0.032, 0.04, 0, -0.01, 0, 10);
    cylY(b, S.olive, 0.016, 0.045, 0, 0.07, 0, 8);
    rbox(mg, S.clay, 0.014, 0.07, 0.016, 0.003, 0.01, 0.145, 0, 0, 0, -0.35);
    box(mg, S.wireR, 0.012, 0.028, 0.012, 0.014, 0.175, 0);
    return { b, mg, muzzle: [0, 0.07, 0], eject: [0, 0, 0], rightHand: [0, -0.015, 0], leftHand: [-0.031, 0.053, 0], magPivot: [0, 0.064, 0], sight: 0, hold: 'pistol' };
  };
  builders.incendiary = function () {
    const b = new K.Builder(), mg = new K.Builder();
    b.add(K.lathe([[0, -0.048], [0.04, -0.044], [0.042, 0.028], [0.028, 0.046], [0, 0.05]], 12), S.wireR);
    cylY(b, S.wireY, 0.043, 0.012, 0, 0, 0, 12);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      box(b, S.dark, 0.004, 0.046, 0.02, Math.cos(a) * 0.044, -0.004, Math.sin(a) * 0.044, 0, -a, 0);
    }
    cylY(b, S.steel, 0.012, 0.012, 0, 0.052, 0, 8);
    box(b, S.steel, 0.008, 0.055, 0.01, 0.034, 0.01, 0);
    mg.add(K.at(K.torus(0.013, 0.002, 5, 10), -0.016, 0.06, 0), S.brass);
    return { b, mg, muzzle: [0, 0.07, 0], eject: [0, 0, 0], rightHand: [0, -0.015, 0], leftHand: [-0.031, 0.053, 0], magPivot: [0, 0.064, 0], sight: 0, hold: 'pistol' };
  };

  // ---------- cache and public API ----------
  const cache = {};
  GM.get = function (id) {
    if (cache[id]) return cache[id];
    const d = builders[id]();
    const body = d.b.build(), mag = d.mg ? d.mg.build() : null;
    const action = d.action ? d.action.build() : null, parts = [body];
    if (mag && id !== 's8') parts.push(mag);
    if (action) parts.push(action);
    const whole = parts.length > 1 ? G.Gfx.merge(parts.map((p) => p.clone())) : body;
    const v3 = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
    return (cache[id] = {
      id, body, mag, action, whole, hold: d.hold, sight: d.sight,
      muzzle: v3(d.muzzle), eject: v3(d.eject), rightHand: v3(d.rightHand), leftHand: v3(d.leftHand), magPivot: v3(d.magPivot),
    });
  };
  GM.material = function () {
    return GM.mat || (GM.mat = G.Gfx.litMaterial({ detail: 'gun' }));
  };
  const realIds = ['p10','h50','v9','u45','ar7','tr4','fa2','r90','s40','s8','bomb','he','flash','smoke','molotov','incendiary'];
  let texBase = 'assets/guns/', materialSets = {}, loadProgress = null;
  GM.setAssetBase = function (path) { texBase = path; };
  GM.resetRealCache = function () {
    for (const id of realIds) delete cache[id];
    for (const k of Object.keys(materialSets)) delete materialSets[k];
    loading = null;
  };
  async function materials(meta) {
    const opts = { normalFlipY: meta.normalFlipY }, loader = new THREE.TextureLoader();
    await Promise.all(Object.keys(meta.textures).map(async (key) => {
      const url = texBase + meta.textures[key];
      if (loadProgress) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(url);
        const buf = await r.arrayBuffer();
        loadProgress(url, buf.byteLength);
        const objectUrl = URL.createObjectURL(new Blob([buf]));
        const texture = await loader.loadAsync(objectUrl);
        URL.revokeObjectURL(objectUrl);
        texture.anisotropy = G.Tex.aniso || 1;
        opts[key] = texture;
      } else {
        const texture = await loader.loadAsync(url);
        texture.anisotropy = G.Tex.aniso || 1;
        opts[key] = texture;
      }
    }));
    return { worldMaterial: G.Gfx.litMaterial(opts), vmMaterial: G.Gfx.litMaterial(Object.assign({viewmodel:true},opts)) };
  }
  async function file(name) {
    const url = 'assets/guns/' + name;
    const response = await fetch(url);
    if (!response.ok) throw new Error(name + ' HTTP ' + response.status);
    if (!loadProgress) return response;
    const buf = await response.arrayBuffer();
    loadProgress(url, buf.byteLength);
    return {
      ok: true,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))),
      arrayBuffer: () => Promise.resolve(buf),
    };
  }
  async function loadModel(id) {
    const [meta, buf] = await Promise.all([file(id + '.json').then(r => r.json()), file(id + '.bin').then(r => r.arrayBuffer())]);
    const n = meta.vertexCount, uvOffset = Math.ceil(n * 15 / 4) * 4;
    const Index = meta.index32 ? Uint32Array : Uint16Array;
    if (meta.id !== id || !n || buf.byteLength !== uvOffset + n * 8 + meta.indexCount * Index.BYTES_PER_ELEMENT)
      throw new Error('Invalid model data for ' + id);
    const indices = new Index(buf, uvOffset + n * 8, meta.indexCount), whole = new THREE.BufferGeometry();
    whole.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf,0,n*3),3));
    whole.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf,n*12,n*3),3,true));
    whole.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf,uvOffset,n*2),2));
    whole.setIndex(new THREE.BufferAttribute(indices,1));
    G.Gfx.paint(whole,meta.tint,.6,0);
    whole.computeBoundingSphere();
    // All parts reuse the same GPU buffers. Draw ranges are in index units.
    function part(name) {
      const [start,count] = meta.ranges[name];
      if (!count) return null;
      if (count === indices.length) return whole;
      const g = new THREE.BufferGeometry();
      for (const k of Object.keys(whole.attributes)) g.setAttribute(k,whole.attributes[k]);
      g.setIndex(whole.index); g.setDrawRange(start,count);
      g.boundingSphere = whole.boundingSphere;
      return g;
    }
    const gm = { id, whole, body: part('body'), mag: part('mag'), action: part('action'), hold: meta.hold, sight: meta.sight };
    for (const k of Object.keys(meta.anchors)) gm[k] = meta.anchors[k] && new THREE.Vector3().fromArray(meta.anchors[k]);
    if (id === 's8') {
      // The loose round appears only during shell-by-shell loading. The FBX supplies the pump.
      const b = new K.Builder(); addReloadShell(b);
      gm.reloadShell = b.build();
    }
    if (!materialSets[meta.source]) materialSets[meta.source] = materials(meta).catch(e => {
      delete materialSets[meta.source]; throw e;
    });
    cache[id] = Object.assign(gm, await materialSets[meta.source]);
  }
  let loading = null;
  GM.loadReal = async function (opts) {
    if (G.Gfx.preset.key === 'low') return;
    if (loading) return loading;
    loadProgress = opts && opts.onBytes || null;
    loading = Promise.all(realIds.map(async id => {
      if (cache[id] && cache[id].worldMaterial) return;
      try { await loadModel(id); } catch (e) { console.warn('Using procedural ' + id, e); }
    }));
    try { await loading; } finally { loading = null; loadProgress = null; }
  };
  // a whole-gun mesh for the world (held by soldiers, dropped on the ground)
  GM.mesh = function (id) {
    const gm = GM.get(id), m = new THREE.Mesh(gm.whole, gm.worldMaterial || GM.material());
    m.userData.gun = id;
    return m;
  };
  GM.IDS = ['knife','p10','h50','v9','ar7','tr4','r90','bomb','m18','k5','u45','s8','fa2','s40','l60','he','flash','smoke','molotov','incendiary'];
  GM.builders = builders;   // exposed for the model checks in development
})(window.G);
