// Convert a Microsoft Rocketbox avatar (MIT) to the game's 16-bone soldier rig.
// node rbconvert.js <avatar.fbx> <texturesDir> <outDir> <outName> [desert]
// Output: <outName>.bin + <outName>.json (geometry, joints, proportions) and BMP textures in <outDir>/_bmp
// (encode them to JPG afterwards). The mesh is posed with every limb straight down, the rest pose
// the game's animation assumes (bone rotations are measured from straight down).
'use strict';
const fs = require('fs'), path = require('path');
const load = require('./fbx/load.js');
const T3 = load.THREE;
const [fbxPath, texDir, outDir, outName, recolor] = process.argv.slice(2);
const HEAD_CENTER = 1.63;     // hitbox head centre (weapons.js) when standing

const grp = load(fbxPath); grp.updateMatrixWorld(true);
let sk = null; grp.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
const geo = sk.geometry, bones = sk.skeleton.bones, inv = sk.skeleton.boneInverses, NB = bones.length;
const byName = {}; bones.forEach((b, i) => { byName[b.name] = i; });
const bi = (n) => { if (!(n in byName)) throw new Error('missing bone ' + n); return byName[n]; };

// bind space -> game space: centimetres to metres, face -Z (Rocketbox faces +Z)
const G0 = new T3.Matrix4().makeRotationY(Math.PI).multiply(new T3.Matrix4().makeScale(0.01, 0.01, 0.01));
const P = bones.map((b, i) => new T3.Vector3().setFromMatrixPosition(new T3.Matrix4().copy(inv[i]).invert()).applyMatrix4(G0));

// per-bone deformation x' = Q + R (x - P0)
const D = bones.map((b, i) => ({ P0: P[i].clone(), Q: P[i].clone(), R: new T3.Quaternion() }));
const DOWN = new T3.Vector3(0, -1, 0);
const dir = (a, b) => new T3.Vector3().subVectors(b, a).normalize();
const subtree = (root) => { const out = []; bones[root].traverse((o) => { if (o.isBone && o.name in byName) out.push(byName[o.name]); }); return out; };
const J = {}, L = {};
for (const [s, side] of [['L', 'L'], ['R', 'R']]) {
  const ua = bi(`Bip01_${s}_UpperArm`), fa = bi(`Bip01_${s}_Forearm`), ha = bi(`Bip01_${s}_Hand`);
  const th = bi(`Bip01_${s}_Thigh`), ca = bi(`Bip01_${s}_Calf`), fo = bi(`Bip01_${s}_Foot`);
  const lUA = P[ua].distanceTo(P[fa]), lFA = P[fa].distanceTo(P[ha]), lTH = P[th].distanceTo(P[ca]), lCA = P[ca].distanceTo(P[fo]);
  const rUA = new T3.Quaternion().setFromUnitVectors(dir(P[ua], P[fa]), DOWN);
  const rFA = new T3.Quaternion().setFromUnitVectors(dir(P[fa], P[ha]), DOWN);
  const rTH = new T3.Quaternion().setFromUnitVectors(dir(P[th], P[ca]), DOWN);
  const rCA = new T3.Quaternion().setFromUnitVectors(dir(P[ca], P[fo]), DOWN);
  const qUA = P[ua].clone(), qFA = qUA.clone().addScaledVector(DOWN, lUA), qHA = qFA.clone().addScaledVector(DOWN, lFA);
  const qTH = P[th].clone(), qCA = qTH.clone().addScaledVector(DOWN, lTH), qFO = qCA.clone().addScaledVector(DOWN, lCA);
  D[ua].R.copy(rUA);
  D[fa].Q.copy(qFA); D[fa].R.copy(rFA);
  for (const k of subtree(ha)) { D[k].P0.copy(P[ha]); D[k].Q.copy(qHA); D[k].R.copy(rFA); }
  D[th].R.copy(rTH);
  D[ca].Q.copy(qCA); D[ca].R.copy(rCA);
  for (const k of subtree(fo)) { D[k].P0.copy(P[fo]); D[k].Q.copy(qFO); D[k].R.identity(); }
  J['uarm' + side] = qUA; J['farm' + side] = qFA; J['hand' + side] = qHA;
  J['thigh' + side] = qTH; J['shin' + side] = qCA; J['foot' + side] = qFO;
  L.uarm = lUA; L.farm = lFA; L.thigh = lTH; L.shin = lCA;
}
J.pelvis = P[bi('Bip01_Pelvis')].clone(); J.spine = P[bi('Bip01_Spine')].clone();
J.chest = P[bi('Bip01_Spine2')].clone(); J.head = P[bi('Bip01_Head')].clone();

// skin every vertex with the deformation (linear blend), in game space
const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, N = pos.count;
const bindN = new T3.Matrix3().getNormalMatrix(new T3.Matrix4().multiplyMatrices(G0, sk.bindMatrix));
const M = new T3.Matrix4().multiplyMatrices(G0, sk.bindMatrix);
const outP = new Float32Array(N * 3), outN = new Float32Array(N * 3);
const v = new T3.Vector3(), n = new T3.Vector3(), t = new T3.Vector3(), acc = new T3.Vector3(), accN = new T3.Vector3();
for (let i = 0; i < N; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(M);
  n.fromBufferAttribute(nor, i).applyMatrix3(bindN).normalize();
  acc.set(0, 0, 0); accN.set(0, 0, 0);
  let wsum = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw.array[i * 4 + k]; if (w <= 0) continue;
    const d = D[si.array[i * 4 + k]];
    t.subVectors(v, d.P0).applyQuaternion(d.R).add(d.Q); acc.addScaledVector(t, w);
    t.copy(n).applyQuaternion(d.R); accN.addScaledVector(t, w); wsum += w;
  }
  if (wsum > 0) acc.divideScalar(wsum); else acc.copy(v);
  accN.normalize();
  outP.set([acc.x, acc.y, acc.z], i * 3); outN.set([accN.x, accN.y, accN.z], i * 3);
}

// map the 80 Biped bones onto the game's 16 bones (split weights where a joint sits between two)
const BONES = ['pelvis', 'spine', 'chest', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const G16 = {}; BONES.forEach((b, i) => { G16[b] = i; });
const direct = {
  Bip01_Pelvis: { pelvis: 1 }, Bip01_Spine: { spine: 1 }, Bip01_Spine1: { spine: 0.5, chest: 0.5 }, Bip01_Spine2: { chest: 1 },
  Bip01_Neck: { chest: 0.45, head: 0.55 }, Bip01_Head: { head: 1 }, Bip01_L_Clavicle: { chest: 1 }, Bip01_R_Clavicle: { chest: 1 },
};
for (const s of ['L', 'R']) Object.assign(direct, {
  [`Bip01_${s}_UpperArm`]: { ['uarm' + s]: 1 }, [`Bip01_${s}_Forearm`]: { ['farm' + s]: 1 }, [`Bip01_${s}_Hand`]: { ['hand' + s]: 1 },
  [`Bip01_${s}_Thigh`]: { ['thigh' + s]: 1 }, [`Bip01_${s}_Calf`]: { ['shin' + s]: 1 }, [`Bip01_${s}_Foot`]: { ['foot' + s]: 1 },
});
const mapOf = bones.map((b) => {
  for (let o = b; o && o.isBone; o = o.parent) if (direct[o.name]) return direct[o.name];
  return { pelvis: 1 };
});
const skinI = new Uint8Array(N * 4), skinW = new Uint8Array(N * 4);
const headW = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const w16 = new Float32Array(16);
  for (let k = 0; k < 4; k++) {
    const w = sw.array[i * 4 + k]; if (w <= 0) continue;
    const m = mapOf[si.array[i * 4 + k]];
    for (const key in m) w16[G16[key]] += w * m[key];
  }
  headW[i] = w16[G16.head];
  const order = Array.from(w16.keys()).sort((a, b) => w16[b] - w16[a]).slice(0, 4);
  const tot = order.reduce((s2, j) => s2 + w16[j], 0) || 1;
  let left = 255;
  order.forEach((j, k) => {
    const q = k === 3 ? left : Math.round(255 * w16[j] / tot); left -= q;
    skinI[i * 4 + k] = j; skinW[i * 4 + k] = Math.max(0, q);
  });
}

// scale so the head centre sits on the hitbox, soles on the ground
const hc = new T3.Vector3(); let hn = 0, minY = Infinity;
for (let i = 0; i < N; i++) {
  if (headW[i] > 0.9) { hc.x += outP[i * 3]; hc.y += outP[i * 3 + 1]; hc.z += outP[i * 3 + 2]; hn++; }
  minY = Math.min(minY, outP[i * 3 + 1]);
}
hc.divideScalar(hn);
const S = (HEAD_CENTER) / (hc.y - minY);
const fix = (p) => p.set(p.x * S, (p.y - minY) * S, p.z * S);
for (let i = 0; i < N; i++) { outP[i * 3] *= S; outP[i * 3 + 1] = (outP[i * 3 + 1] - minY) * S; outP[i * 3 + 2] *= S; }
for (const k in J) fix(J[k]);
for (const k in L) L[k] *= S;
fix(hc);

// index the triangle soup, grouped by material
const mats = [].concat(sk.material).map((m) => m.name);
const groups = geo.groups.length ? geo.groups : [{ start: 0, count: N, materialIndex: 0 }];
const keyOf = (i) => [0, 1, 2].map((c) => Math.round(outP[i * 3 + c] * 1e5)).join(',') + '|' + [0, 1, 2].map((c) => Math.round(outN[i * 3 + c] * 1e3)).join(',') + '|' +
  Math.round(uv.getX(i) * 1e5) + ',' + Math.round(uv.getY(i) * 1e5) + '|' + Array.from(skinI.subarray(i * 4, i * 4 + 4)).join(',') + '|' + Array.from(skinW.subarray(i * 4, i * 4 + 4)).join(',');
const remap = new Map(), verts = [], byMat = mats.map(() => []);
for (const gr of groups) for (let i = gr.start; i < gr.start + gr.count; i++) {
  const key = keyOf(i);
  let j = remap.get(key);
  if (j === undefined) { j = verts.length; verts.push(i); remap.set(key, j); }
  byMat[gr.materialIndex].push(j);
}
const NV = verts.length;
const idx = []; const outGroups = [];
byMat.forEach((list, m) => { if (!list.length) return; outGroups.push({ start: idx.length, count: list.length, material: m }); for (const j of list) idx.push(j); });

// binary: positions f32x3 | normals i8x4 | uv f32x2 | skinIndex u8x4 | skinWeight u8x4 | indices u16/u32
const IdxT = NV < 65536 ? Uint16Array : Uint32Array;
const bP = new Float32Array(NV * 3), bN = new Int8Array(NV * 4), bU = new Float32Array(NV * 2), bI = new Uint8Array(NV * 4), bW = new Uint8Array(NV * 4);
verts.forEach((i, j) => {
  bP.set(outP.subarray(i * 3, i * 3 + 3), j * 3);
  for (let c = 0; c < 3; c++) bN[j * 4 + c] = Math.round(outN[i * 3 + c] * 127);
  bU[j * 2] = uv.getX(i); bU[j * 2 + 1] = uv.getY(i);
  bI.set(skinI.subarray(i * 4, i * 4 + 4), j * 4); bW.set(skinW.subarray(i * 4, i * 4 + 4), j * 4);
});
const bIdx = new IdxT(idx);
const parts = [bP, bN, bU, bI, bW, bIdx].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, outName + '.bin'), Buffer.concat(parts));

// textures: TGA -> half size BMP (+ desert recolour for attacker uniforms, specular -> roughness)
function readTGA(file) {
  const b = fs.readFileSync(file), idLen = b[0], type = b[2], w = b.readUInt16LE(12), h = b.readUInt16LE(14), bpp = b[16] >> 3, topDown = !!(b[17] & 32);
  const px = new Uint8Array(w * h * 3); let o = 18 + idLen, p = 0;
  const put = (j) => { px[p++] = b[j + 2]; px[p++] = b[j + 1]; px[p++] = b[j]; };
  if (type === 2) { for (let k = 0; k < w * h; k++, o += bpp) put(o); }
  else if (type === 10) {
    while (p < px.length) { const c = b[o++], cnt = (c & 127) + 1; if (c & 128) { for (let k = 0; k < cnt; k++) put(o); o += bpp; } else for (let k = 0; k < cnt; k++, o += bpp) put(o); }
  } else throw new Error('TGA type ' + type);
  if (!topDown) { const row = w * 3, tmp = new Uint8Array(row); for (let y = 0; y < h >> 1; y++) { const a = y * row, z = (h - 1 - y) * row; tmp.set(px.subarray(a, a + row)); px.copyWithin(a, z, z + row); px.set(tmp, z); } }
  return { w, h, px };
}
function half(img) {
  const w = img.w >> 1, h = img.h >> 1, out = new Uint8Array(w * h * 3), s = img.px, W = img.w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const a = ((2 * y) * W + 2 * x) * 3 + c, d = ((2 * y + 1) * W + 2 * x) * 3 + c;
    out[(y * w + x) * 3 + c] = (s[a] + s[a + 3] + s[d] + s[d + 3] + 2) >> 2;
  }
  return { w, h, px: out };
}
function desert(img) {
  const s = img.px;
  for (let k = 0; k < s.length; k += 3) {
    const r = s[k] / 255, g = s[k + 1] / 255, b = s[k + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0, lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (sat > 0.24 || lum > 0.86) continue;                      // skin, eyes and saturated details stay
    const tt = Math.min(1, Math.max(0, (lum - 0.18) / 0.62)), e = tt * tt * (3 - 2 * tt);
    s[k] = 255 * (0.30 + 0.50 * e); s[k + 1] = 255 * (0.25 + 0.43 * e); s[k + 2] = 255 * (0.16 + 0.30 * e);
  }
}
function roughFromSpec(img) { const s = img.px; for (let k = 0; k < s.length; k += 3) { const sp = (s[k] + s[k + 1] + s[k + 2]) / 765; const r = Math.round(255 * Math.min(1, Math.max(0.3, 1 - 0.85 * sp))); s[k] = s[k + 1] = s[k + 2] = r; } }
function writeBMP(file, img) {
  const row = (img.w * 3 + 3) & ~3, size = 54 + row * img.h, b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(img.w, 18); b.writeInt32LE(img.h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * img.h, 34);
  for (let y = 0; y < img.h; y++) { const src = (img.h - 1 - y) * img.w * 3, dst = 54 + y * row; for (let x = 0; x < img.w; x++) { b[dst + x * 3] = img.px[src + x * 3 + 2]; b[dst + x * 3 + 1] = img.px[src + x * 3 + 1]; b[dst + x * 3 + 2] = img.px[src + x * 3]; } }
  fs.writeFileSync(file, b);
}
const texFiles = fs.readdirSync(texDir);
const bmpDir = path.join(outDir, '_bmp'); fs.mkdirSync(bmpDir, { recursive: true });
const matOut = mats.map((m) => {
  const find = (kind) => texFiles.find((f) => f.toLowerCase().startsWith(m.toLowerCase() + '_' + kind) && f.toLowerCase().endsWith('.tga'));
  const res = { name: m };
  for (const [kind, key] of [['color', 'map'], ['normal', 'normalMap'], ['specular', 'roughnessMap']]) {
    const f = find(kind); if (!f) continue;
    let img = half(readTGA(path.join(texDir, f)));
    if (kind === 'color' && recolor === 'desert' && !/pistol/.test(m)) desert(img);
    if (kind === 'specular') roughFromSpec(img);
    const short = outName + '_' + m.replace(/^sm\d+_/, '') + '_' + key[0] + (key === 'normalMap' ? 'n' : key === 'roughnessMap' ? 'r' : 'c');
    writeBMP(path.join(bmpDir, short + '.bmp'), img);
    res[key] = short + '.jpg';
  }
  return res;
});

const r3 = (p) => p.toArray().map((x) => +x.toFixed(4));
const meta = {
  name: outName, source: 'Microsoft Rocketbox (MIT) ' + path.basename(fbxPath), vertexCount: NV, indexCount: idx.length, index32: IdxT === Uint32Array,
  layout: ['position f32x3', 'normal i8x4', 'uv f32x2', 'skinIndex u8x4', 'skinWeight u8x4', 'index'],
  groups: outGroups, materials: matOut,
  joints: Object.fromEntries(Object.entries(J).map(([k, p]) => [k, r3(p)])),
  lengths: Object.fromEntries(Object.entries(L).map(([k, x]) => [k, +x.toFixed(4)])),
  headCenter: r3(hc), scale: +S.toFixed(4),
};
fs.writeFileSync(path.join(outDir, outName + '.json'), JSON.stringify(meta, null, 1));
console.log(outName, 'verts', NV, 'tris', idx.length / 3, 'scale', S.toFixed(3), 'head', r3(hc), 'pelvis', r3(J.pelvis), 'chest', r3(J.chest), 'uarmR', r3(J.uarmR), 'thighR', r3(J.thighR), 'lengths', JSON.stringify(meta.lengths));
