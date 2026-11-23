// Load an FBX file in Node with three.js r128's FBXLoader (MIT, copied here unchanged). Textures are
// stubbed: their file names are kept on the placeholder textures. Usage: const load = require('./load.js');
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
globalThis.window = globalThis; globalThis.self = globalThis;
const THREE = require(path.join(__dirname, '..', '..', 'vendor', 'three.min.js'));
globalThis.THREE = THREE;
// FBXLoader decompresses with fflate.unzlibSync; Node's zlib does the same job
globalThis.fflate = { unzlibSync: (d) => new Uint8Array(zlib.inflateSync(Buffer.from(d))) };
for (const f of ['NURBSUtils.js', 'NURBSCurve.js', 'FBXLoader.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f });
}
THREE.TextureLoader.prototype.load = function (url) { const t = new THREE.Texture(); t.name = url; return t; };
module.exports = function loadFBX(file) {
  const buf = fs.readFileSync(file);
  return new THREE.FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.dirname(file) + '/');
};
module.exports.THREE = THREE;
