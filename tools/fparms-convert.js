// Bake Rocketbox finger articulation before reducing each sleeve and hand to three joints.
// node tools/fparms-convert.js (from any directory; uses the local Rocketbox sources)
'use strict';
const fs = require('fs'), path = require('path'), load = require('./fbx/load');
const T = load.THREE, root = path.join(__dirname, '..'), out = path.join(root, 'assets/chars');
const vec = () => new T.Vector3();

function extract(mesh, body, scale, side) {
  const geo = mesh.geometry, a = geo.attributes, bones = mesh.skeleton.bones;
  const game = new T.Matrix4().makeRotationY(Math.PI).scale(vec().setScalar(.01 * scale));
  const bind = game.clone().multiply(mesh.bindMatrix), normal = new T.Matrix3().getNormalMatrix(bind);
  const frames = mesh.skeleton.boneInverses.map(m => game.clone().multiply(m.clone().invert()));
  const joints = frames.map(m => vec().setFromMatrixPosition(m));
  const id = name => {
    const i = bones.findIndex(b => b.name === 'Bip01_' + side + '_' + name);
    if (i < 0) throw new Error('Missing ' + side + ' ' + name);
    return i;
  };
  const arm = ['UpperArm', 'Forearm', 'Hand'].map(id), wrist = joints[arm[2]];
  const finger = (f, j) => id('Finger' + f + (j || ''));
  const knuckle = f => joints[finger(f, 0)];
  const forward = knuckle(2).clone().sub(wrist).normalize();
  const edge = knuckle(1).clone().sub(knuckle(4)).normalize();
  const palm = vec().crossVectors(forward, edge).normalize().multiplyScalar(side === 'L' ? 1 : -1);
  // Contact at the centre of the wrap, inside the curve of the middle phalanx.
  const contact = knuckle(2).clone().lerp(knuckle(3), .5).addScaledVector(palm, .022);
  const reduced = new Map([[id('Clavicle'), 0], ...arm.map((b, i) => [b, i])]);
  const deform = new Map();
  for (let f = 0; f < 5; f++) {
    // Local X follows the phalanx. Of the two transverse frame axes, choose the
    // hinge whose positive swing takes X towards the palm (thumb towards pinky).
    const toward = f ? palm : edge.clone().negate();
    const angles = f === 0 ? (side === 'R' ? [14, 22, 18] : [5, 9, 8]) :
      side === 'R' && f === 1 ? [-14, -7, 0] : side === 'R' ? [35, 55, 39] : [22, 45, 32];
    let parent = new T.Matrix4();
    for (let j = 0; j < 3; j++) {
      const b = finger(f, j), p = joints[b], m = frames[b];
      const x = vec().setFromMatrixColumn(m, 0).normalize(), hinge = x.clone().cross(toward);
      const y = vec().setFromMatrixColumn(m, 1).normalize(), z = vec().setFromMatrixColumn(m, 2).normalize();
      const axis = Math.abs(y.dot(hinge)) > Math.abs(z.dot(hinge)) ? y : z;
      const angle = Math.sign(axis.dot(hinge)) * angles[j] * Math.PI / 180;
      const rot = new T.Matrix4().makeRotationAxis(axis, angle);
      rot.setPosition(p.clone().sub(p.clone().applyMatrix4(rot)));
      parent = parent.clone().multiply(rot);
      deform.set(b, parent);
      reduced.set(b, 2);
    }
  }
  const positions = [], normals = [], uvs = [], weights = [], indices = [], remap = new Map();
  function influence(i) {
    let sum = 0;
    for (let k = 4*i; k < 4*i+4; k++) if (reduced.has(a.skinIndex.array[k])) sum += a.skinWeight.array[k];
    return sum;
  }
  function add(i) {
    const p = vec().fromBufferAttribute(a.position, i).applyMatrix4(bind);
    const n = vec().fromBufferAttribute(a.normal, i).applyNormalMatrix(normal);
    const pos = vec(), norm = vec(), w = [0, 0, 0];
    let total = 0;
    for (let k = 4*i; k < 4*i+4; k++) {
      const b = a.skinIndex.array[k], weight = a.skinWeight.array[k];
      if (!weight) continue;
      const m = deform.get(b);
      pos.addScaledVector(m ? p.clone().applyMatrix4(m) : p, weight);
      norm.addScaledVector(m ? n.clone().transformDirection(m) : n, weight);
      w[reduced.get(b) || 0] += weight;
      total += weight;
    }
    pos.divideScalar(total); norm.normalize();
    const upper = Math.round(w[0]/total*255), fore = Math.round((w[0]+w[1])/total*255) - upper;
    const data = [pos.toArray(), norm.toArray().map(v => Math.round(v*127)), [a.uv.getX(i), a.uv.getY(i)], [upper, fore, 255-upper-fore]];
    const key = data.join('|');
    if (!remap.has(key)) {
      remap.set(key, positions.length/3);
      positions.push(...data[0]); normals.push(...data[1]); uvs.push(...data[2]); weights.push(...data[3]);
    }
    indices.push(remap.get(key));
  }
  for (const g of geo.groups.filter(g => g.materialIndex === body)) {
    for (let i = g.start; i < g.start+g.count; i += 3) {
      const tri = [i, i+1, i+2].map(k => geo.index ? geo.index.getX(k) : k);
      if (tri.every(k => influence(k) >= .45)) tri.forEach(add);
    }
  }
  const vertexCount = positions.length/3;
  if (!vertexCount || vertexCount >= 65536 || indices.length/3 > 6000) throw new Error('Unexpected arm size');
  // Each side is an independently aligned block. Pad the end to a float boundary.
  const parts = [new Float32Array(positions), new Float32Array(uvs), new Int8Array(normals),
    new Uint8Array(weights), new Uint16Array(indices)].map(a => Buffer.from(a.buffer));
  const bytes = Buffer.concat(parts);
  return { bytes: Buffer.concat([bytes, Buffer.alloc((4-bytes.length%4)%4)]),
    meta: { vertexCount, indexCount: indices.length, joints: arm.map(i => joints[i].toArray()),
      forward: forward.toArray(), indexEdge: edge.toArray(), contact: contact.toArray() } };
}

for (const [team, avatar] of [['atk', 'Military_Male_02'], ['def', 'Military_Male_03']]) {
  const soldier = JSON.parse(fs.readFileSync(path.join(out, team+'1.json')));
  const group = load(path.join(root, '_src/rocketbox', avatar, 'Export', avatar+'.fbx'));
  group.updateMatrixWorld(true);
  let mesh;
  group.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
  const body = mesh.material.findIndex(m => m.name.endsWith('_body'));
  const material = soldier.materials.find(m => m.name === mesh.material[body].name);
  const meta = { source: avatar, material, sides: {} }, parts = [];
  let offset = 0;
  for (const side of ['R', 'L']) {
    const arm = extract(mesh, body, soldier.scale, side);
    meta.sides[side] = Object.assign({ offset }, arm.meta);
    parts.push(arm.bytes); offset += arm.bytes.length;
    console.log(team, side, arm.meta.vertexCount+' vertices,', arm.meta.indexCount/3+' triangles');
  }
  const file = path.join(out, 'fparms_'+team);
  fs.writeFileSync(file+'.bin', Buffer.concat(parts));
  fs.writeFileSync(file+'.json', JSON.stringify(meta, null, 2)+'\n');
}
