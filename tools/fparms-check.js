// Exercise the normal equipment and asset-loading paths with local files and no WebGL.
'use strict';
const assert = require('assert').strict, fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), G = require('./loadgame')(root, path.join(root,'vendor/three.min.js'));
const T = G.THREE, vector = a => new T.Vector3().fromArray(a);
for (const script of ['gfx','geom','gunmodels','weapons','viewmodel']) require('../js/'+script);
G.Tex = { tex: () => null, detail: () => null, gunDetail: () => null };
G.sunDir = new T.Vector3(0,1,0);
G.HUD = { buyOpen: false };
G.time = 1;
let requests = 0, failAttacker = false;
global.fetch = async name => {
  requests++;
  const bytes = fs.readFileSync(path.join(root, name));
  return { ok: true, json: async () => JSON.parse(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) };
};
T.TextureLoader.prototype.loadAsync = async function (name) {
  assert(fs.statSync(path.join(root,name)).size > 0);
  if (failAttacker && name.endsWith('atk1_body_mc.jpg')) throw new Error('Test texture failure');
  const t = new T.Texture(); t.name = name; return t;
};

// Recover a joint or grip centre from four non-coplanar, rigidly weighted mesh
// vertices. Applying the same affine coordinates to the rendered mesh checks
// the whole skinning path, independently of the IK solver.
function landmark(positions, weights, bone, point) {
  const candidates = [];
  for (let i = 0; i < positions.length/3; i++) if (weights[3*i+bone] === 255)
    candidates.push({ i, p: new T.Vector3().fromArray(positions, 3*i) });
  const origin = candidates[0];
  const farthest = score => candidates.reduce((best,c) => score(c.p) > score(best.p) ? c : best);
  const a = farthest(p => p.distanceToSquared(origin.p)), x = a.p.clone().sub(origin.p);
  const b = farthest(p => p.clone().sub(origin.p).cross(x).lengthSq()), y = b.p.clone().sub(origin.p);
  const normal = x.clone().cross(y);
  const c = farthest(p => Math.abs(p.clone().sub(origin.p).dot(normal))), z = c.p.clone().sub(origin.p);
  const basis = new T.Matrix4().makeBasis(x,y,z);
  assert(Math.abs(basis.determinant()) > 1e-6, 'degenerate landmark basis');
  const bary = vector(point).sub(origin.p).applyMatrix4(basis.invert());
  const ids = [origin.i,a.i,b.i,c.i], w = [1-bary.x-bary.y-bary.z,bary.x,bary.y,bary.z];
  return (attr, offset) => ids.reduce((p,i,k) =>
    p.addScaledVector(new T.Vector3().fromBufferAttribute(attr,offset+i), w[k]), new T.Vector3());
}
// Weld UV and normal seams before finding open edges on the upper sleeve.
function sleeveRim(pos, weights, index) {
  const edges = new Map(), points = [];
  for (let i = 0; i < pos.length; i += 3)
    points.push(Array.from(pos.subarray(i,i+3), v => Math.round(v*1e5)).join(','));
  for (let i = 0; i < index.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = index[i+j], b = index[i+(j+1)%3];
    if (weights[3*a] < 250 || weights[3*b] < 250) continue;
    const key = [points[a],points[b]].sort().join('|');
    if (edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);
  }
  return Array.from(new Set([].concat(...edges.values())));
}
function fixture(team) {
  const file = path.join(root,'assets/chars/fparms_'+team), meta = JSON.parse(fs.readFileSync(file+'.json'));
  const buf = fs.readFileSync(file+'.bin'), ab = buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const sides = {};
  for (const key of ['R','L']) {
    const s = meta.sides[key], n = s.vertexCount, o = s.offset;
    const pos = new Float32Array(ab,o,3*n), weights = new Uint8Array(ab,o+23*n,3*n);
    const index = new Uint16Array(ab,o+26*n,s.indexCount);
    assert(index.every(i => i < n));
    assert(s.indexCount%3 === 0 && s.indexCount/3 > 100 && s.indexCount/3 <= 6000);
    for (let i = 0; i < weights.length; i += 3) assert.equal(weights[i]+weights[i+1]+weights[i+2],255);
    sides[key] = { n, count: s.indexCount, rim: sleeveRim(pos,weights,index), grip: landmark(pos,weights,2,s.contact),
      shoulder: landmark(pos,weights,0,s.joints[0]), elbow: landmark(pos,weights,0,s.joints[1]),
      foreStart: landmark(pos,weights,1,s.joints[1]), foreEnd: landmark(pos,weights,1,s.joints[2]),
      wrist: landmark(pos,weights,2,s.joints[2]) };
  }
  return sides;
}
function checkMotion(player, item, camera, rim) {
  const vm = G.VM, mesh = vm.cur.arms, holder = mesh.parent, p = new T.Vector3();
  const wide = new T.PerspectiveCamera(vm.cam.fov,21/9,vm.cam.near,vm.cam.far);
  const frustum = new T.Frustum().setFromProjectionMatrix(wide.projectionMatrix);
  function sample(frames) {
    for (let i = 0; i < frames; i++) {
      G.time += 1/60;
      vm.update(1/60,player,camera);
      assert.equal(vm.cur.arms,mesh);
      holder.updateMatrix();
      for (const k of rim) {
        p.fromBufferAttribute(mesh.geometry.attributes.position,k).applyMatrix4(holder.matrix);
        assert(!frustum.containsPoint(p),player.team+' '+item.id+' visible sleeve cut');
      }
    }
  }
  vm.onSwitch(); sample(30);
  if (item.def.reload) {
    item.reloading = true; vm.onReload(1); sample(62); item.reloading = false;
  }
  if (item.def.slot === 'grenade') {
    player.primed = true; sample(1); player.primed = false; vm.onThrow(item.id); sample(18);
  }
  if (item.id === 'knife') { vm.onKnife(true); sample(30); }
  if (item.id === 'bomb') { player.planting = true; sample(1); player.planting = false; }
}
async function check() {
  const vm = G.VM, sides = { atk: fixture('atk'), def: fixture('def') };
  G.Gfx.preset = G.Gfx.PRESETS.low;
  vm.init(16/9);
  await vm.loadArms();
  assert.equal(requests,0);
  vm.setWeapon('p10','atk');
  const fallback = vm.cur.arms;
  assert('CLOTH' in fallback.material.defines);
  G.Gfx.preset = G.Gfx.PRESETS.high;
  failAttacker = true;
  await assert.rejects(vm.loadArms(), /Test texture failure/);
  vm.setWeapon('p10','def'); assert('USE_MAP' in vm.cur.arms.material.defines);
  vm.setWeapon('p10','atk'); assert.equal(vm.cur.arms,fallback);
  failAttacker = false;
  await vm.loadArms();
  const camera = new T.PerspectiveCamera();
  let maxError = 0, hands = 0;
  for (const realGuns of [false,true]) {
    if (realGuns) await G.GunModels.loadReal();
    for (const team of ['atk','def']) for (const id of G.GunModels.IDS) {
      const label = team+' '+id;
      const item = { id, def: G.Weapons.defs[id] || {} }, slot = id === 'bomb' ? 'bomb' : 'item';
      const player = { team, cur: slot, inv: { item }, pos: new T.Vector3(), vel: new T.Vector3(), alive: true,
        crouch: 0, onGround: true, lastShot: -10 };
      vm.update(0,player,camera);
      const { arms, gm } = vm.cur, geo = arms.geometry, mat = arms.material;
      const texturedGun = realGuns && fs.existsSync(path.join(root,'assets/guns',id+'.json'));
      assert.equal(!!gm.vmMaterial,texturedGun,label);
      assert('VIEWMODEL' in mat.defines);
      for (const k of ['uSunDir','uSunVis','uAmbient']) assert.equal(mat.uniforms[k],vm.cur.body.material.uniforms[k]);
      for (const [key, suffix] of [['map','mc'],['normalMap','nn'],['roughnessMap','rr']])
        assert.equal(mat.uniforms[key].value.name,'assets/chars/'+team+'1_body_'+suffix+'.jpg');
      for (const [name,attr] of Object.entries(geo.attributes)) assert(attr.array.every(Number.isFinite),label+' '+name);
      const pos = geo.attributes.position;
      assert(geo.index.array.every(i => i < pos.count),label+' index');
      arms.parent.updateMatrix();
      const rim = [];
      let offset = 0, count = 0;
      for (const key of id === 'knife' ? ['R'] : ['R','L']) {
        const s = sides[team][key], target = key === 'R' ? gm.rightHand : gm.leftHand;
        const error = s.grip(pos,offset).distanceTo(target);
        assert(error < .01,label+' '+key+' grip error '+error);
        maxError = Math.max(maxError,error);
        const shoulder = s.shoulder(pos,offset).applyMatrix4(arms.parent.matrix);
        const elbow = s.elbow(pos,offset).applyMatrix4(arms.parent.matrix);
        assert(shoulder.z > 0 && shoulder.y < 0 && elbow.y < shoulder.y,label+' '+key+' shoulder/elbow');
        assert(s.foreStart(pos,offset).distanceTo(s.elbow(pos,offset)) < .001,label+' elbow seam');
        assert(s.foreEnd(pos,offset).distanceTo(s.wrist(pos,offset)) < .001,label+' wrist seam');
        assert(s.rim.length > 0);
        rim.push(...s.rim.map(i => offset+i));
        offset += s.n; count += s.count; hands++;
      }
      assert.equal(pos.count,offset,label+' vertices'); assert.equal(geo.index.count,count,label+' triangles');
      vm.setWeapon(id,team); assert.equal(vm.cur.arms,arms,label+' cache');
      checkMotion(player,item,camera,rim);
    }
  }
  console.log(G.GunModels.IDS.length+' ids, both teams, procedural and shipped weapon sets; '+hands+
    ' hand placements. Maximum grip error '+(maxError*1000).toFixed(6)+' mm.');
}
check().catch(e => { console.error(e); process.exitCode = 1; });
