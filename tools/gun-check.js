// Validate the shipped models without the source FBXs, WebGL or a build step.
'use strict';
const assert = require('assert').strict, fs = require('fs'), path = require('path');
const THREE = require('../vendor/three.min.js');
const dir = path.join(__dirname,'../assets/guns');
const classes = {
  pistol: ['p10','h50'], smg: ['v9','u45'], rifle: ['ar7','tr4','fa2'], sniper: ['r90','s40'],
  pump: ['s8'], bomb: ['bomb'], grenade: ['he','flash','smoke','incendiary'], bottle: ['molotov'],
};
const lengths = { pistol:[.14,.28], smg:[.4,1], rifle:[.65,1.1], sniper:[.9,1.45],
  pump:[.85,1.35], bomb:[.15,.27], grenade:[.09,.21], bottle:[.18,.33] };
const groups = new Map();
const size = file => fs.statSync(path.join(dir,file)).size;
const fmt = a => '[' + a.map(v => v.toFixed(3)).join(', ') + ']';
function jpegSize(file) {
  const data = fs.readFileSync(path.join(dir,file));
  assert.equal(data.readUInt16BE(0),0xffd8,file);
  for (let i = 2; i + 9 < data.length; i += 2 + data.readUInt16BE(i+2)) {
    const marker = data.readUInt16BE(i);
    if (marker === 0xffc0 || marker === 0xffc2) return [data.readUInt16BE(i+7),data.readUInt16BE(i+5)];
    assert.notEqual(marker,0xffda,'missing JPEG size: ' + file);
  }
  throw new Error('Invalid JPEG: ' + file);
}

function check(id, kind) {
  const m = JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'));
  const b = fs.readFileSync(path.join(dir,id+'.bin')), n = m.vertexCount;
  const indexOffset = Math.ceil(15*n/4)*4 + 8*n, stride = m.index32 ? 4 : 2;
  assert.equal(m.id,id); assert(n > 0 && n < m.indexCount);
  assert.equal(b.length,indexOffset + stride*m.indexCount,id + ' binary layout');
  let end = 0;
  for (const part of ['body','mag','action']) {
    const [start,count] = m.ranges[part];
    assert.equal(start,end); assert(count >= 0 && count%3 === 0);
    end += count;
  }
  assert.equal(end,m.indexCount); assert(m.ranges.body[1] > 0);
  const firearm = ['pistol','smg','rifle','sniper','pump'].includes(kind);
  if (firearm) assert(m.ranges.action[1] > 0,id + ' moving action');
  if (kind !== 'pump' && kind !== 'bomb') assert(m.ranges.mag[1] > 0,id + ' magazine / throwable part');

  const lo = [Infinity,Infinity,Infinity], hi = lo.map(x => -x);
  let tipDistance = Infinity;
  for (let i = 0; i < n; i++) {
    const p = [0,1,2].map(k => b.readFloatLE(i*12 + k*4));
    for (let k = 0; k < 3; k++) {
      assert(Number.isFinite(p[k]),id + ' position');
      lo[k] = Math.min(lo[k],p[k]); hi[k] = Math.max(hi[k],p[k]);
    }
    const uv = indexOffset-8*n + 8*i;
    assert(Number.isFinite(b.readFloatLE(uv)) && Number.isFinite(b.readFloatLE(uv+4)),id + ' UV');
    tipDistance = Math.min(tipDistance,Math.hypot(...p.map((v,k) => v - m.anchors.muzzle[k])));
  }
  for (let i = indexOffset; i < b.length; i += stride) assert(b.readUIntLE(i,stride) < n,id + ' index');
  if (firearm && kind !== 'pump') {
    const vertex = (i,v) => {
      const p = 12*b.readUIntLE(indexOffset+i*stride,stride);
      return v.set(b.readFloatLE(p),b.readFloatLE(p+4),b.readFloatLE(p+8));
    };
    const box = new THREE.Box3(), triangle = new THREE.Triangle();
    const [start,count] = m.ranges.mag;
    for (let i = start; i < start+count; i++) box.expandByPoint(vertex(i,triangle.a));
    box.expandByScalar(.001);
    let seated = false;
    for (let i = 0; !seated && i < m.ranges.body[1]; i += 3) {
      vertex(i,triangle.a); vertex(i+1,triangle.b); vertex(i+2,triangle.c);
      seated = box.intersectsTriangle(triangle);
    }
    assert(seated,id + ' detached magazine');
  }
  const anchors = m.anchors;
  for (const key of ['rightHand','leftHand','magPivot','eject','muzzle']) {
    const a = anchors[key];
    assert(a && a.length === 3 && a.every((v,k) => v >= lo[k]-1e-6 && v <= hi[k]+1e-6),id+' '+key+' outside bounds');
    if (key !== 'muzzle') assert(anchors.muzzle[2] < a[2],id + ' reversed ' + key);
  }
  if (firearm) {
    assert(Math.abs(anchors.muzzle[2]-lo[2]) < .001 && tipDistance < .025,id + ' detached muzzle');
    assert(anchors.muzzle[1] > anchors.rightHand[1],id + ' upside down');
  }
  const axis = firearm ? 2 : kind === 'bomb' ? 0 : 1, length = hi[axis]-lo[axis];
  assert(length >= lengths[kind][0] && length <= lengths[kind][1],id + ' length ' + length);
  assert.equal(m.normalFlipY,m.textures.normalMap.endsWith('_DirectX.jpg'));
  const files = [id+'.json',id+'.bin'];
  for (const key of ['map','normalMap','roughnessMap','metalnessMap']) {
    const file = m.textures[key], pixels = ['map','normalMap'].includes(key) ? 1024 : 512;
    assert.deepEqual(jpegSize(file),[pixels,pixels],file);
    files.push(file);
  }
  if (!groups.has(m.source)) groups.set(m.source,new Set());
  for (const f of files) groups.get(m.source).add(f);
  const bytes = files.reduce((v,f) => v+size(f),0);
  console.log(id, m.indexCount/3+' tris,', files.length+' files,', (bytes/1024).toFixed(1)+' KiB, bbox (m)',fmt(lo),fmt(hi));
  console.log('  '+Object.keys(anchors).map(k => k+' '+fmt(anchors[k])).join('  '));
}
const ids = [].concat(...Object.values(classes)).sort();
assert.deepEqual(fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)).sort(),ids);
assert.deepEqual(fs.readdirSync(dir).filter(f=>f.endsWith('.bin')).map(f=>f.slice(0,-4)).sort(),ids);
for (const [kind,list] of Object.entries(classes)) for (const id of list) check(id,kind);
for (const [source, files] of groups) {
  const bytes = [...files].reduce((v,f) => v+size(f),0);
  assert(bytes <= 1024*1024,source+' exceeds 1 MiB ('+bytes+' bytes)');
}
console.log(ids.length+' models, '+groups.size+' sources passed.');
