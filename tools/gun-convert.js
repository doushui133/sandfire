// Convert the local CC0 FBXs and encode their maps. Run with node tools/gun-convert.js.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const load = require('./fbx/load'), T = load.THREE;
const root = path.resolve(__dirname, '..'), input = path.join(root, '_src/cc0-guns');
const output = path.join(root, 'assets/guns');

// Grip, support hand and port are measured in centimetres AFTER levelling / yawing the FBX.
// The grip lands at the game's firing-hand position, independent of the source scene origin.
const models = {
  p10: { source: 'Pistol_MK/Makarov', hold: 'pistol', grip: [.47,-2,.6], port: [1.55,4.5,-4],
    bore: 4.73, mag: 'Magazine', magShift: [0,0,-9.25], action: ['Slide','Safety'] },
  h50: { source: 'Luger/Luger', hold: 'pistol', yaw: Math.PI, grip: [2.84,-2.7,1.45], port: [3.65,5.6,-4],
    bore: 5.26, mag: 'Clip', magShift: [-5.67,0,6.8], action: ['Slide','Part1','Part2','Part3'] },
  v9: { source: 'Suomi_KP/Suomi_KP', grip: [-.43,-3.8,13], support: [-.43,1.25,-19], port: [.8,2.8,-8],
    bore: 2.5, mag: 'Magazine', action: ['Bolt','Ejector'] },
  u45: { source: 'GreaseGun/Grease_Gun', grip: [.01,-9,16.7], support: [.01,-7,-9], port: [1.4,2,-6],
    bore: .59, mag: 'Magazine', action: ['Bolt'] },
  ar7: { source: 'AK-47/AK47', grip: [-.25,-9.4,29.6], support: [-.25,-1.9,-4], port: [1.3,.8,13],
    bore: -1.6, mag: 'Magazine', action: ['Ejection_Port'] },
  tr4: { source: 'M4A1/M4A1', grip: [-.08,-8.8,9.1], support: [-.08,.3,-21], port: [1.2,2.3,-4],
    bore: 2.09, mag: 'Magazine', action: ['Charging_Handle','Ejector_2'] },
  r90: { source: 'Sniper/Sniper', pitch: -.18256599, grip: [-.37,-3.8,31.5], support: [-.37,-.5,-7],
    port: [1.15,2.3,16], bore: 3.08, sightY: 6.65, mag: 'Magazine', magShift: [0,3.44,.64], action: ['Bolt'] },
  s8: { source: 'Shotgun/Shotgun', grip: [-.11,-3.3,46], support: [-.11,-2.5,-5.6], port: [1.4,2.6,25.9],
    bore: 2.92, action: ['Fore_Stock'] },
  bomb: { source: 'C4/C4', hold: 'bomb', yaw: Math.PI / 2, offset: [.006,.014,0] },
  he: { source: 'FragGrenade/FragGrenadeModel', grenade: true, scale: .0125, offset: [0,-.053,0], mag: 'Pin' },
  flash: { source: 'Flashbang/Flashbang', grenade: true, scale: .0125, offset: [-.004,.022,0], mag: 'Pin' },
  smoke: { source: 'Smoke_Grenade/Smoke_Grenade', grenade: true, offset: [0,.034,0], mag: 'Pin' },
  molotov: { source: 'Molotv_Cocktail/Molotov_Cocktail', grenade: true, mag: 'Fabric' },
};
models.fa2 = Object.assign({}, models.tr4, { tint: [1.36,1.04,.66] });
models.s40 = Object.assign({}, models.r90, { scale: .0091, tint: [.77,.91,.64] });
models.incendiary = Object.assign({}, models.he, { tint: [1.15,.19,.14] });

function textureFiles(model) {
  if (model === models.molotov) return { map: 'Molotov_Base_Color.jpg', normalMap: 'Molotov_Normal_DirectX.jpg',
    roughnessMap: 'Molotov_Roughness.jpg', metalnessMap: 'Molotov_Metallic.jpg' };
  const names = fs.readdirSync(path.join(input, path.dirname(model.source)));
  const result = {};
  for (const [key, pattern] of Object.entries({ map: /_Base_Color\.png$/, normalMap: /_Normal(?:_DirectX)?\.png$/,
    roughnessMap: /_Roughness\.png$/, metalnessMap: /_Metallic\.png$/ })) {
    const file = names.find(name => pattern.test(name));
    if (!file) throw new Error(model.source + ' missing ' + key);
    result[key] = file.replace(/\.png$/, '.jpg');
  }
  return result;
}

function convert(id, model) {
  const scene = load(path.join(input, model.source + '.fbx'));
  scene.updateMatrixWorld(true);
  const positions = [], normals = [], uvs = [], vertices = new Map();
  const indices = { body: [], mag: [], action: [] }, bounds = new T.Box3(), magBounds = new T.Box3();
  const pos = new T.Vector3(), normal = new T.Vector3(), uv = new T.Vector2();
  const scale = model.scale || .01, hold = model.hold || (model.grenade ? 'pistol' : 'rifle');
  const grip = model.grip, hand = hold === 'pistol' ? [0,-.035,.012] : [0,-.035,.035];
  const offset = grip ? hand.map((v,i) => v - grip[i] * scale) : model.offset || [0,0,0];
  const point = a => a.map((v,i) => v * scale + offset[i]);
  const transform = new T.Matrix4().makeRotationY(model.yaw || (model.grenade ? Math.PI / 2 : 0))
    .multiply(new T.Matrix4().makeRotationX(model.pitch || 0));
  transform.scale(new T.Vector3(scale, scale, scale)).setPosition(...offset);
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const part = mesh.name === model.mag ? 'mag' : (model.action || []).includes(mesh.name) ? 'action' : 'body';
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (part === 'mag' && model.magShift) geo.translate(...model.magShift);
    geo.applyMatrix4(transform);
    const a = geo.attributes;
    // FBXLoader emits triangle soup. Preserve seams/hard edges by keying the full packed vertex.
    for (let i = 0; i < a.position.count; i++) {
      pos.fromBufferAttribute(a.position,i); normal.fromBufferAttribute(a.normal,i); uv.fromBufferAttribute(a.uv,i);
      if (id === 'molotov') {
        const bottle = mesh.name === 'Bottle';
        uv.x = (uv.x + (bottle ? 0 : 1)) / 2;
        if (!bottle) uv.y = (uv.y + (mesh.name === 'Fabric' ? 1 : 0)) / 2;
      }
      const n = normal.toArray().map(x => Math.round(x * 127));
      const key = pos.toArray().concat(n, uv.toArray()).join('/');
      let index = vertices.get(key);
      if (index === undefined) {
        index = vertices.size; vertices.set(key,index);
        positions.push(pos.x,pos.y,pos.z); normals.push(...n); uvs.push(uv.x,uv.y);
      }
      bounds.expandByPoint(pos);
      if (part === 'mag') magBounds.expandByPoint(pos);
      indices[part].push(index);
    }
  });
  if (!indices.body.length || (model.mag && !indices.mag.length) || (model.action && !indices.action.length))
    throw new Error(id + ': missing FBX part');

  let anchors, sight = 0;
  if (grip) {
    const side = Math.max(bounds.min.x, -.023);
    const pivot = magBounds.isEmpty() ? point(model.port) : magBounds.getCenter(new T.Vector3()).toArray();
    anchors = { rightHand: hand, leftHand: model.support ? point(model.support) : [side,-.044,.008],
      muzzle: [hand[0], point([0,model.bore,0])[1],bounds.min.z], eject: point(model.port), magPivot: pivot };
    sight = model.sightY === undefined ? bounds.max.y : point([0,model.sightY,0])[1];
  } else if (model.grenade) {
    anchors = { rightHand: [0,-.015,0], leftHand: [-.031,.053,0], magPivot: [0,.064,0],
      muzzle: [0,.07,bounds.min.z], eject: [0,0,0] };
  } else {
    anchors = { rightHand: [.093,.021,0], leftHand: [-.093,.021,0], magPivot: [0,.02,0],
      muzzle: [0,.035,bounds.min.z], eject: [0,.02,0] };
  }
  const ranges = {}, joined = [];
  for (const part of Object.keys(indices)) {
    ranges[part] = [joined.length,indices[part].length];
    joined.push(...indices[part]);
  }
  const vertexCount = vertices.size, index32 = vertexCount > 65535;
  // Little-endian blocks. Pad the signed normal block to a four-byte boundary for the float UVs.
  const arrays = [new Float32Array(positions), new Int8Array(normals), new Uint8Array((4 - normals.length % 4) % 4),
    new Float32Array(uvs), index32 ? new Uint32Array(joined) : new Uint16Array(joined)];
  const textures = textureFiles(model);
  const meta = { id, source: model.source, vertexCount, indexCount: joined.length, index32, ranges, anchors, hold, sight,
    tint: model.tint || [1,1,1], textures, normalFlipY: textures.normalMap.endsWith('_DirectX.jpg') };
  fs.writeFileSync(path.join(output,id + '.bin'), Buffer.concat(arrays.map(a => Buffer.from(a.buffer))));
  fs.writeFileSync(path.join(output,id + '.json'), JSON.stringify(meta,null,2) + '\n');
}

fs.mkdirSync(output,{recursive:true});
for (const [id, model] of Object.entries(models)) convert(id,model);
const encode = cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'guns-encode.ps1')], { stdio: 'inherit' });
if (encode.status !== 0) {
  fs.writeFileSync(path.join(__dirname,'guns-encode.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0guns-encode.ps1"\r\n');
  throw new Error('Texture encoding incomplete. Run tools\\guns-encode.cmd on Windows.');
}
