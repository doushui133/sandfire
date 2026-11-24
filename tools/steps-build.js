// Builds assets/sfx/f_*.wav (footsteps) from the downloaded source (not stored in the repo):
//   node tools/steps-build.js <dir with Fantozzi-SandL1.wav … Fantozzi-StoneR3.wav> [outDir]
// Source: "Fantozzi's Footsteps (Grass/Sand & Stone)" by Fantozzi, CC0
// (https://opengameart.org/content/fantozzis-footsteps-grasssand-stone). The pack ships FLAC/OGG in a 7z archive;
// decode the FLAC files to WAV first (any decoder). Each step: mix to mono, trim the leading silence, keep at most
// 0.36 s, fade the last 70 ms, resample to 32 kHz (the high crunch and click carry the direction), normalise the
// peak to -1 dBFS, 16-bit PCM WAV.
'use strict';
const fs = require('fs'), path = require('path');
const [src, outArg] = process.argv.slice(2);
if (!src) { console.error('usage: node tools/steps-build.js <decoded wav dir> [outDir]'); process.exit(1); }
const out = path.resolve(outArg || path.join(__dirname, '..', 'assets', 'sfx'));
const RATE = 32000, MAX = 0.36, FADE = 0.07;

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV: ' + file);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + size)); break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new Error('expected 16-bit PCM: ' + file);
  const frames = Math.floor(data.length / (2 * fmt.ch)), x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
    x[i] = s / fmt.ch;
  }
  return { rate: fmt.rate, x };
}
// band-limited resampling: Blackman-windowed sinc, cutoff just below the lower Nyquist frequency
function resample(x, from, to) {
  if (from === to) return x;
  const ratio = to / from, n = Math.floor(x.length * ratio), y = new Float32Array(n);
  const cutoff = 0.95 * Math.min(1, ratio), half = Math.ceil(24 / Math.min(1, ratio));
  for (let i = 0; i < n; i++) {
    const t = i / ratio, c = Math.floor(t);
    let acc = 0, wsum = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k, a = Math.PI * d * cutoff;
      const sinc = Math.abs(d) < 1e-9 ? 1 : Math.sin(a) / a;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * d / half) + 0.08 * Math.cos(2 * Math.PI * d / half);
      acc += x[k] * sinc * w; wsum += sinc * w;
    }
    y[i] = wsum ? acc / wsum : 0;
  }
  return y;
}
function writeWav(file, x, rate) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const k = peak > 0 ? 0.891 / peak : 1;
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
  return b.length;
}

fs.mkdirSync(out, { recursive: true });
let total = 0;
for (const surface of ['Sand', 'Stone']) for (const foot of ['L', 'R']) for (const n of [1, 2, 3]) {
  const w = readWav(path.join(src, 'Fantozzi-' + surface + foot + n + '.wav'));
  let peak = 0;
  for (let i = 0; i < w.x.length; i++) peak = Math.max(peak, Math.abs(w.x[i]));
  const start = Math.max(0, w.x.findIndex((v) => Math.abs(v) > peak * 0.03) - Math.round(w.rate * 0.002));
  const cut = w.x.slice(start, Math.min(w.x.length, start + Math.round(w.rate * MAX)));
  const fade = Math.min(cut.length, Math.round(w.rate * FADE)), fin = Math.round(w.rate * 0.001);
  for (let i = 0; i < fade; i++) { const g = i / fade; cut[cut.length - 1 - i] *= g * g; }
  for (let i = 0; i < fin; i++) cut[i] *= i / fin;
  const name = 'f_' + surface.toLowerCase() + '_' + foot.toLowerCase() + n;
  const size = writeWav(path.join(out, name + '.wav'), resample(cut, w.rate, RATE), RATE);
  total += size;
  console.log(name, (cut.length / w.rate).toFixed(2) + ' s', (size / 1024).toFixed(1) + ' KB');
}
console.log('total', (total / 1024).toFixed(0) + ' KB');
