// Loads the game's map modules into Node (no DOM) so tools can rebuild the static geometry.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function loadGame(projectDir, threePath) {
  const noop = () => {};
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.document = { addEventListener: noop, documentElement: { addEventListener: noop }, createElement: () => ({ getContext: () => null }) };
  globalThis.localStorage = { getItem: () => null, setItem: noop };
  if (!globalThis.THREE) globalThis.THREE = require(threePath);
  for (const m of ['look', 'core', 'map', 'mapgeo']) {
    const src = fs.readFileSync(path.join(projectDir, 'js', m + '.js'), 'utf8');
    // run as browser scripts: hide CommonJS so modules attach to window.G
    vm.runInThisContext('(function (module, exports, require) {' + src + '\n})();', { filename: m + '.js' });
  }
  return globalThis.G;
};
