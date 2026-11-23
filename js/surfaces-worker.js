// Plain data only. Transfer the finished buffers so the graphics thread can upload them.
'use strict';
self.G = {};
importScripts('textures.js');
self.onmessage = async function (e) {
  try {
    if (e.data.normals && typeof createImageBitmap === 'undefined') throw Error('Worker cannot decode scans');
    const data = await G.Tex.buildWorldData(e.data, (step,total) => self.postMessage({step,total}));
    const buffers=[];
    for (const bank of [data.base,data.large,data.scans]) {
      if (!bank) continue;
      buffers.push(bank.albedo.buffer);
      if (bank.normal) buffers.push(bank.normal.buffer);
    }
    self.postMessage({bank:data},buffers);
  } catch (error) { self.postMessage({error:error.message}); }
};
