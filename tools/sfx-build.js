// Builds assets/sfx/*.wav from the downloaded source packs (not stored in the repo):
//   node tools/sfx-build.js <snake1 dir> <snake2 dir> <warlord dir> [outDir]
// snake1 = "Snake's Authentic Gun Sounds" (free, commercial use, no credit needed),
// snake2 = "Snake's SECOND Authentic Gun Sounds" (public domain), warlord = WARLORD announcer by VoiceBosch
// (CC BY-SA 4.0). Each sound: trim leading silence and the tail, mix to mono, resample (windowed sinc),
// fade out, normalise the peak to -1 dBFS, write 16-bit PCM WAV.
'use strict';
const fs = require('fs'), path = require('path');
const [s1, s2, wl, outArg] = process.argv.slice(2);
if (!s1 || !s2 || !wl) { console.error('usage: node tools/sfx-build.js <snake1> <snake2> <warlord> [outDir]'); process.exit(1); }
const out = path.resolve(outArg || path.join(__dirname, '..', 'assets', 'sfx'));
const G1 = path.join(s1, "Snake's Authentic Gun Sounds"), G2 = path.join(s2, "Snake's SECOND Authentic Gun Sounds");
const R1 = path.join(G1, 'Reloads, Cycling & More', 'WAV'), P2 = path.join(G2, '& More', 'Pistol', 'WAV');

// name, source, sample rate, max seconds, fade seconds, gain (applied after normalising)
const GUN = 32000, VOICE = 22050;
const LIST = [
  ['g_9mm', path.join(G2, 'Full Sounds', '9mm', 'WAV', '9mm Single.wav'), GUN, 0.95, 0.35],
  ['g_556', path.join(G1, 'Full Sound', '5.56', 'WAV', '556 Single WAV.wav'), GUN, 1.25, 0.45],
  ['g_762', path.join(G1, 'Full Sound', '7.62x39', 'WAV', '762x39 Single WAV.wav'), GUN, 1.25, 0.45],
  ['g_308', path.join(G2, 'Full Sounds', '.308 (7.62x51)', 'WAV', '308 Single.wav'), GUN, 1.6, 0.6],
  ['g_762r', path.join(G1, 'Full Sound', '7.62x54R', 'WAV', '762x54r Single WAV.wav'), GUN, 1.9, 0.7],
  ['g_20ga', path.join(G2, 'Full Sounds', '20 Gauge', 'WAV', '20 Gauge Single.wav'), GUN, 1.5, 0.55],
  ['m_ar_out', path.join(R1, 'AR Reload Part 1 WAV.wav'), GUN, 0.8, 0.08],
  ['m_ar_in', path.join(R1, 'AR Reload Part 2 WAV.wav'), GUN, 0.9, 0.08],
  ['m_ar_bolt', path.join(R1, 'AR Bolt Release WAV.wav'), GUN, 0.6, 0.08],
  ['m_ak_out', path.join(R1, 'AK Reload Part 1 WAV.wav'), GUN, 0.8, 0.08],
  ['m_ak_in', path.join(R1, 'AK Reload Part 2 WAV.wav'), GUN, 0.9, 0.08],
  ['m_ak_rack', path.join(R1, 'AK Rack WAV.wav'), GUN, 0.9, 0.08],
  ['m_pistol_out', path.join(P2, '9mm Pistol Reload 1.wav'), GUN, 0.7, 0.08],
  ['m_pistol_in', path.join(P2, '9mm Pistol Reload 2.wav'), GUN, 0.7, 0.08],
  ['m_pistol_slide', path.join(P2, '9mm Pistol Slide Release.wav'), GUN, 0.5, 0.06],
  ['m_dry', path.join(P2, '9mm Pistol Dry Fire.wav'), GUN, 0.35, 0.05],
  ['m_pump', path.join(R1, 'Pump Reload Full Fast WAV.wav'), GUN, 0.9, 0.08],
  ['m_shell', path.join(R1, 'Pump Shell Load WAV.wav'), GUN, 0.7, 0.08],
  ['m_bolt', path.join(R1, '308 Bolt Cycle WAV.wav'), GUN, 1.0, 0.08],
  ['v_start', path.join(wl, '01. Start.wav'), VOICE, 2.5, 0.12],
  ['v_rampage', path.join(wl, '02. Rampage.wav'), VOICE, 2.5, 0.12],
  ['v_double_kill', path.join(wl, '03. Double Kill.wav'), VOICE, 2.5, 0.12],
  ['v_triple_kill', path.join(wl, '04. Triple Kill.wav'), VOICE, 2.5, 0.12],
  ['v_dominating', path.join(wl, '05. Dominating.wav'), VOICE, 2.5, 0.12],
  ['v_unstoppable', path.join(wl, '06. Unstoppable.wav'), VOICE, 2.5, 0.12],
  ['v_first_blood', path.join(wl, '08. First Blood.wav'), VOICE, 2.5, 0.12],
  ['v_headshot', path.join(wl, '09. Headshot.wav'), VOICE, 2.5, 0.12],
  ['v_team_deathmatch', path.join(wl, '12. Team Deathmatch.wav'), VOICE, 3, 0.12],
  ['v_last_man_standing', path.join(wl, '15. Last Man Standing.wav'), VOICE, 3, 0.12],
  ['v_round_winner', path.join(wl, '19. Round Winner.wav'), VOICE, 3, 0.12],
  ['v_mission_failed', path.join(wl, '20. Mission Failed.wav'), VOICE, 3, 0.12],
  ['v_annihilation', path.join(wl, '24. Annihilation.wav'), VOICE, 3, 0.12],
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
  if (!fmt || !data) throw new Error('missing fmt/data: ' + file);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.ch)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const p = (i * fmt.ch + c) * bytes;
      if (fmt.format === 3 && fmt.bits === 32) s += data.readFloatLE(p);
      else if (fmt.bits === 16) s += data.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) s += data.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) s += data.readInt32LE(p) / 2147483648;
      else throw new Error('unsupported bits ' + fmt.bits);
    }
    mono[i] = s / fmt.ch;
  }
  return { rate: fmt.rate, samples: mono };
}

// band-limited resampling: Blackman-windowed sinc, cutoff just below the lower Nyquist frequency
function resample(x, from, to) {
  if (from === to) return x;
  const ratio = to / from, n = Math.floor(x.length * ratio), y = new Float32Array(n);
  const cutoff = 0.95 * Math.min(1, ratio), half = 24;
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
    y[i] = wsum ? acc / wsum * 1 : 0;
  }
  return y;
}

function trim(x, rate, maxSeconds, fade) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const start = Math.max(0, x.findIndex((v) => Math.abs(v) > peak * 0.02) - Math.round(rate * 0.003));
  // end where a 20 ms window stays below -46 dB of the peak for good, capped at maxSeconds
  const win = Math.round(rate * 0.02), floor = peak * 0.005;
  let end = x.length;
  for (let i = x.length - win; i > start; i -= win) {
    let m = 0;
    for (let k = 0; k < win; k++) m = Math.max(m, Math.abs(x[i + k]));
    if (m > floor) { end = Math.min(x.length, i + win * 2); break; }
  }
  end = Math.min(end, start + Math.round(rate * maxSeconds));
  const y = x.slice(start, end), f = Math.min(y.length, Math.round(rate * fade));
  for (let i = 0; i < f; i++) { const g = i / f; y[y.length - 1 - i] *= g * g; }
  const fin = Math.min(y.length, Math.round(rate * 0.002));
  for (let i = 0; i < fin; i++) y[i] *= i / fin;
  return y;
}

function writeWav(file, x, rate) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const k = peak > 0 ? 0.891 / peak : 1;   // -1 dBFS
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}

fs.mkdirSync(out, { recursive: true });
let total = 0;
for (const [name, src, rate, max, fade] of LIST) {
  const w = readWav(src);
  const cut = trim(w.samples, w.rate, max, fade);
  const y = resample(cut, w.rate, rate);
  const file = path.join(out, name + '.wav');
  writeWav(file, y, rate);
  const size = fs.statSync(file).size;
  total += size;
  console.log(name.padEnd(22), (y.length / rate).toFixed(2) + 's', Math.round(size / 1024) + ' KB');
}
console.log('total', Math.round(total / 1024) + ' KB in', out);
