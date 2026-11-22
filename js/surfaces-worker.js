// Plain data only. Transfer the finished buffers so the graphics thread can upload them.
'use strict';
self.G = {};
importScripts('textures.js');
self.onmessage = function (e) {
  try {
    const builder = G.Tex.worldBuilder(e.data.normals, 1, e.data.size);
    for (let i=1; i<=builder.total; i++) {
      self.postMessage({step:i}); builder.step();
    }
    const buffers=[];
    for (const bank of [builder.data.base,builder.data.large]) {
      if (!bank) continue;
      buffers.push(bank.albedo.buffer);
      if (bank.normal) buffers.push(bank.normal.buffer);
    }
    self.postMessage({bank:builder.data},buffers);
  } catch (error) { self.postMessage({error:error.message}); }
};
