// Builds the music cues in assets/sfx from the downloaded sources (not stored in the repo):
//   node tools/music-build.js <Heavy_ConceptB.wav> <battleThemeA.wav> [outDir]
// mu_victory.wav: "Victory Fanfare Short" by cynicmusic, CC0 (https://opengameart.org/content/victory-fanfare-short):
//   the whole fanfare from its first note, the inaudible end of the tail cut at 11.2 s, last 0.6 s faded.
// mu_roundstart.wav: "Battle Theme A" by cynicmusic, CC0 (https://opengameart.org/content/battle-theme-a), an MP3:
//   decode it to WAV first (any decoder). Its first four bars (0.45–6.9 s, ~150 bpm), last 1.4 s faded.
// Both keep stereo, resample to 22.05 kHz (windowed sinc; strings and brass sit well below 11 kHz), normalise the
// peak to -1 dBFS and are written as 16-bit PCM WAV.
'use strict';
const fs = require('fs'), path = require('path');
const [fanfare, battle, outArg] = process.argv.slice(2);
if (!fanfare || !battle) { console.error('usage: node tools/music-build.js <Heavy_ConceptB.wav> <battleThemeA.wav> [outDir]'); process.exit(1); }
const out = path.resolve(outArg || path.join(__dirname, '..', 'assets', 'sfx'));
const RATE = 22050;
// name, source, start (s; null = first sound), length (s), fade out (s)
const CUES = [
  ['mu_victory', fanfare, null, 11.2, 0.6],
  ['mu_roundstart', battle, 0.45, 6.45, 1.4],
];

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
  const frames = Math.floor(data.length / (2 * fmt.ch)), chans = [];
  for (let c = 0; c < 2; c++) {
    const x = new Float32Array(frames), src = Math.min(c, fmt.ch - 1);
    for (let i = 0; i < frames; i++) x[i] = data.readInt16LE((i * fmt.ch + src) * 2) / 32768;
    chans.push(x);
  }
  return { rate: fmt.rate, chans };
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

fs.mkdirSync(out, { recursive: true });
for (const [name, src, from, seconds, fadeSeconds] of CUES) {
  const w = readWav(src);
  let peak = 0;
  for (const x of w.chans) for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const first = Math.min(...w.chans.map((x) => x.findIndex((v) => Math.abs(v) > peak * 0.01)));
  const start = from === null ? Math.max(0, first - Math.round(w.rate * 0.004)) : Math.round(from * w.rate);
  const end = Math.min(w.chans[0].length, start + Math.round(w.rate * seconds));
  const chans = w.chans.map((x) => resample(x.slice(start, end), w.rate, RATE));
  const n = chans[0].length, fade = Math.round(RATE * fadeSeconds), fin = Math.round(RATE * 0.003);
  for (const y of chans) {
    for (let i = 0; i < fade; i++) { const g = i / fade; y[n - 1 - i] *= g * g; }
    for (let i = 0; i < fin; i++) y[i] *= i / fin;
  }
  let p2 = 0;
  for (const y of chans) for (let i = 0; i < n; i++) p2 = Math.max(p2, Math.abs(y[i]));
  const k = p2 > 0 ? 0.891 / p2 : 1;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++)
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * k * 32767))), 44 + (i * 2 + c) * 2);
  fs.writeFileSync(path.join(out, name + '.wav'), b);
  console.log(name, (n / RATE).toFixed(2) + ' s', (b.length / 1024).toFixed(0) + ' KB', 'from', (start / w.rate).toFixed(3) + ' s');
}
