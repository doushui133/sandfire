// music.js — original procedural round cues on the Web Audio clock.
(function (G) {
  'use strict';

  const active = new Set();
  const shortFade = 0.08;
  const attack = 0.008;
  const pitch = (note) => 440 * Math.pow(2, (note - 69) / 12);
  const chord = (root, third) => [root, root + third, root + 7];

  // Bass root and brass voicing per bar. Lead entries are [beat, MIDI note, beats].
  const scores = {
    roundStart: {
      bpm: 136, beats: 16, opening: 0.8, cadence: 14,
      bars: [[38, chord(50, 3)], [34, chord(46, 4)], [36, chord(48, 4)], [38, chord(50, 3)]],
      lead: [[1.5, 65, .38], [2, 64, .42], [3, 62, .75], [5.5, 65, .38], [6, 69, .8],
        [8.5, 67, .38], [9, 70, .42], [9.5, 72, .38], [10.5, 67, .65],
        [12, 69, .65], [13, 73, .65], [14, 74, 1.7]]
    },
    win: {
      bpm: 132, beats: 8, cadence: 6,
      bars: [[41, chord(53, 3)], [36, chord(48, 4)]], resolve: [41, chord(53, 3)],
      lead: [[.5, 68, .4], [1, 72, .75], [2, 75, .7], [3, 72, .65],
        [4, 70, .4], [4.5, 72, .4], [5, 76, .65], [6, 77, 1.7]]
    },
    lose: {
      bpm: 126, beats: 8, cadence: 6, subdued: true,
      bars: [[36, chord(48, 3)], [31, chord(43, 4)]], resolve: [36, chord(48, 3)],
      lead: [[0, 67, .85], [1, 66, .8], [2, 63, 1.15], [4, 62, .7], [5, 59, .8], [6, 60, 1.7]]
    },
    mvp: {
      bpm: 134, beats: 14, cadence: 12,
      bars: [[40, chord(52, 3)], [36, chord(48, 4)], [35, chord(47, 4)]], resolve: [40, chord(52, 3)],
      lead: [[0, 67, .65], [.75, 71, .42], [1.5, 76, .85], [3, 74, .7],
        [4, 67, .65], [4.75, 71, .42], [5.5, 72, .75], [6.5, 76, .95],
        [8, 78, .65], [9, 75, .42], [9.5, 78, .4], [10, 83, 1.65], [12, 76, 1.7]]
    },
    practiceStart: {
      bpm: 138, beats: 10, cadence: 8,
      bars: [[45, chord(57, 3)], [43, chord(55, 4)]], resolve: [45, chord(57, 3)],
      lead: [[.5, 72, .4], [1, 76, .42], [1.75, 74, .42], [2.5, 72, .42], [3, 69, .7],
        [4.5, 71, .4], [5, 74, .42], [5.75, 79, .42], [6.5, 74, .42], [7, 71, .7], [8, 69, 1.7]]
    }
  };
  const outcomes = ['win', 'lose', 'mvp'];
  const rhythms = [
    { kick: [0, 1.5, 2, 3.25], bass: [0, .75, 1.5, 2, 2.75, 3.25], brass: [0, 2.5] },
    { kick: [0, 1.75, 2.5, 3.5], bass: [0, .5, 1.25, 2, 2.5, 3.5], brass: [0, 1.75, 3.5] },
    { kick: [0, 2], bass: [0, 1.5, 2.5], brass: [0, 2.5] }
  ];

  let bufferContext, noise, heartbeat, distantHits;
  const drive = new Float32Array(257);
  for (let i = 0; i < drive.length; i++) drive[i] = Math.tanh((i / 128 - 1) * 1.5);

  function noiseBuffer(ctx) {
    if (bufferContext !== ctx) {
      bufferContext = ctx;
      heartbeat = distantHits = null;
      noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.7), ctx.sampleRate);
      const data = noise.getChannelData(0), random = G.seeded(15731);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    return noise;
  }

  function pulseBuffer(ctx, hits) {
    const rate = 8000, beat = 60 / 128;
    const buffer = ctx.createBuffer(1, rate * beat * 8, rate);
    const data = buffer.getChannelData(0);
    for (const [at, length, level] of hits) {
      const first = Math.round(at * beat * rate), count = Math.round(length * rate);
      for (let i = 0; i < count && first + i < data.length; i++) {
        const x = i / count;
        data[first + i] += level * Math.min(x * 14, 1) * Math.pow(1 - x, 3);
      }
    }
    return buffer;
  }

  function track(ctx, bus, name, start, end) {
    const output = ctx.createGain(), nodes = [output], sources = [];
    output.gain.value = 0;
    output.connect(bus);
    const gain = output.gain;
    let rampStart = start, rampEnd = Math.min(end, start + (name === 'clutch' ? 1 : attack));
    let from = 0, to = 1;
    gain.setValueAtTime(from, rampStart);
    gain.linearRampToValueAtTime(to, rampEnd);

    const playing = {
      name,
      stop(fadeSeconds) {
        if (!active.has(playing)) return;
        const now = ctx.currentTime;
        const fade = Number.isFinite(fadeSeconds) ? Math.max(0.006, fadeSeconds) : shortFade;
        const deadline = Math.min(end, now + fade);
        if (now >= end || (to === 0 && deadline >= end)) return;
        let level = from;
        if (now >= rampEnd) level = to;
        else if (now > rampStart) level += (to - from) * (now - rampStart) / (rampEnd - rampStart);
        rampStart = now;
        rampEnd = end = deadline;
        from = level;
        to = 0;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(level, now);
        gain.linearRampToValueAtTime(0, end);
        for (const source of sources) source.stop(end);
      }
    };
    active.add(playing);

    return {
      output,
      keep(node) { nodes.push(node); return node; },
      source(node) { sources.push(node); return this.keep(node); },
      start() {
        sources[0].onended = () => {
          sources[0].onended = null;
          for (const node of nodes) node.disconnect();
          sources.length = nodes.length = 0;
          active.delete(playing);
        };
        for (const source of sources) {
          source.start(start);
          if (Number.isFinite(end)) source.stop(end);
        }
        return { stop: playing.stop };
      }
    };
  }

  function envelope(gain, time, length, level, rise = attack, tail = .14) {
    gain.setValueAtTime(0, time);
    gain.linearRampToValueAtTime(level, time + Math.min(rise, length * .3));
    gain.exponentialRampToValueAtTime(level * tail, time + length * .86);
    gain.linearRampToValueAtTime(0, time + length);
  }

  function instrumentRack(ctx, track) {
    function amp(input, type, frequency, q = .65) {
      const gain = track.keep(ctx.createGain());
      gain.gain.value = 0;
      if (type) {
        const filter = track.keep(ctx.createBiquadFilter());
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        input.connect(filter);
        filter.connect(gain);
        gain.connect(track.output);
        return { gain: gain.gain, frequency: filter.frequency };
      }
      input.connect(gain);
      gain.connect(track.output);
      return { gain: gain.gain };
    }
    function oscillator(type, detune) {
      const osc = track.source(ctx.createOscillator());
      osc.type = type;
      osc.detune.value = detune;
      return osc;
    }
    function stack(types, detune, cutoff, level) {
      const blend = track.keep(ctx.createGain());
      blend.gain.value = 1 / types.length;
      const voices = types.map((type, i) => oscillator(type, detune[i]));
      for (const voice of voices) voice.connect(blend);
      const out = amp(blend, 'lowpass', cutoff);
      return (time, length, notes, accent = 1) => {
        voices.forEach((voice, i) => voice.frequency.setValueAtTime(pitch(notes[i]), time));
        envelope(out.gain, time, length, level * accent, .014, .28);
      };
    }

    const drum = oscillator('sine', 0);
    const kick = amp(drum).gain;
    const sub = oscillator('triangle', 0), shaper = track.keep(ctx.createWaveShaper());
    shaper.curve = drive;
    sub.connect(shaper);
    const bass = amp(shaper, 'lowpass', 640).gain;
    const hiss = track.source(ctx.createBufferSource());
    hiss.buffer = noiseBuffer(ctx);
    hiss.loop = true;
    const hat = amp(hiss, 'highpass', 6500).gain;
    const snare = amp(hiss, 'bandpass', 1800).gain;
    const sweep = amp(hiss, 'bandpass', 400, .9);
    const brass = stack(['sawtooth', 'triangle', 'sawtooth'], [-9, 4, 9], 1750, .094);
    const lead = stack(['sawtooth', 'triangle'], [-7, 7], 2350, .070);

    return {
      kick(time, length = .17, level = .156, low = 48) {
        drum.frequency.setValueAtTime(low * 3, time);
        drum.frequency.exponentialRampToValueAtTime(low, time + length * .43);
        envelope(kick, time, length, level, .004, .075);
      },
      bass(time, length, note, level = .108) {
        sub.frequency.setValueAtTime(pitch(note), time);
        envelope(bass, time, length, level, .009, .32);
      },
      hat(time, length, accent) { envelope(hat, time, length, accent ? .049 : .030, .004); },
      snare(time, length, level = .115) { envelope(snare, time, length, level, .004); },
      sweep(time, length, up, level) {
        sweep.frequency.setValueAtTime(up ? 420 : 2350, time);
        sweep.frequency.exponentialRampToValueAtTime(up ? 4600 : 190, time + length);
        envelope(sweep.gain, time, length, level, up ? length * .3 : .007, .23);
      },
      brass,
      lead(time, length, note, accent) { lead(time, length, [note, note], accent); }
    };
  }

  function scoreCue(rack, score, start) {
    const beat = 60 / score.bpm, at = (n) => start + n * beat;
    const accent = score.subdued ? .72 : 1;
    if (score.opening) rack.sweep(start, beat * score.opening, true, .13);
    for (let bar = 0; bar * 4 < score.cadence; bar++) {
      const first = bar * 4, length = Math.min(4, score.cadence - first);
      const [root, voicing] = score.bars[bar];
      const rhythm = rhythms[score.subdued ? 2 : bar % 2];
      for (const step of rhythm.kick) {
        if (step < length) rack.kick(at(first + step), Math.min(.17, (length - step) * beat), .156 * accent);
      }
      for (const step of rhythm.bass) {
        if (step < length) rack.bass(at(first + step), .43 * beat, root + (step >= 2.5 ? 7 : 0), .108 * accent);
      }
      for (const step of rhythm.brass) {
        if (step < length) rack.brass(at(first + step), Math.min(.48, length - step) * beat, voicing, accent);
      }
      for (let step = .5; step < length; step += .5) {
        rack.hat(at(first + step), beat * .18, step % 1 !== 0);
      }
      for (let step = 1; step < length; step += 2) rack.snare(at(first + step), .13, .115 * accent);
    }
    for (const [time, note, length] of score.lead) rack.lead(at(time), length * beat, note, accent);
    const [root, voicing] = score.resolve || score.bars[score.bars.length - 1];
    const final = at(score.cadence), tail = (score.beats - score.cadence) * beat;
    rack.sweep(final - beat * .8, beat * .8, true, .13 * accent);
    rack.kick(final, tail * .63, .178 * accent);
    rack.bass(final, tail * .88, root, .106 * accent);
    rack.brass(final, tail * .97, voicing, accent);
    rack.sweep(final, tail, false, .19 * accent);
  }

  function countdown(rack, start, seconds) {
    const impact = Math.min(.64, seconds * .25);
    const ticking = seconds - impact;
    const count = G.clamp(Math.round(ticking / .34), 1, 36);
    const offset = (x) => ticking * (.025 + .975 * (1.55 * x - .55 * x * x));
    rack.sweep(start + ticking * .62, ticking * .38, true, .19);
    for (let i = 0; i < count; i++) {
      const progress = i / count, time = offset(progress);
      const gap = offset((i + 1) / count) - time;
      rack.lead(start + time, Math.min(.105, gap * .72), 65 + Math.floor(progress * 12) + (i % 2 ? 1 : 0), .8 + progress * .55);
      rack.hat(start + time, Math.min(.075, gap * .62), i % 2 === 0);
      if (i % 4 === 0) {
        rack.kick(start + time, Math.min(.16, gap), .139, 44);
        rack.bass(start + time, Math.min(.27, gap * 2), i % 8 === 0 ? 29 : 35);
      }
    }
    const final = start + ticking;
    rack.kick(final, impact, .23, 40);
    rack.bass(final, impact * .94, 29, .10);
    rack.brass(final, impact * .78, [41, 44, 47], .96);
    rack.sweep(final, impact, false, .22);
  }

  function clutch(ctx, track) {
    const hiss = noiseBuffer(ctx);
    if (!heartbeat) {
      heartbeat = pulseBuffer(ctx, [
        [0, .24, .128], [.34, .16, .085], [2, .24, .116], [2.30, .16, .075],
        [4, .24, .128], [4.34, .16, .085], [6, .24, .116], [6.30, .16, .075]
      ]);
      distantHits = pulseBuffer(ctx, [[3.25, .25, .20], [7.5, .22, .15]]);
    }
    function loop(buffer) {
      const source = track.source(ctx.createBufferSource());
      source.buffer = buffer;
      source.loop = true;
      return source;
    }
    function tone(type, note, level) {
      const source = track.source(ctx.createOscillator()), amp = track.keep(ctx.createGain());
      source.type = type;
      source.frequency.value = pitch(note);
      amp.gain.value = level;
      source.connect(amp);
      amp.connect(track.output);
      return amp.gain;
    }
    tone('triangle', 33, .038);
    tone('sine', 40, .021);
    loop(heartbeat).connect(tone('sine', 34, 0));
    const filter = track.keep(ctx.createBiquadFilter()), hit = track.keep(ctx.createGain());
    filter.type = 'bandpass';
    filter.frequency.value = 780;
    hit.gain.value = 0;
    loop(hiss).connect(filter);
    filter.connect(hit);
    loop(distantHits).connect(hit.gain);
    hit.connect(track.output);
  }

  function setVolume(v) {
    const value = Number(v);
    const volume = Number.isFinite(value) ? G.clamp(value, 0, 1) : .6;
    G.settings.musicVol = volume;
    const { ctx, musicBus } = G.Audio;
    if (ctx && musicBus && ctx.state !== 'closed') {
      const now = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setTargetAtTime(volume, now, .018);
    }
  }

  document.querySelectorAll('[data-setting="musicVol"]').forEach((slider) => {
    slider.addEventListener('input', () => setVolume(slider.value));
  });
  // The main-menu master slider is handled by main.js.
  const pauseVolume = document.getElementById('vol2');
  pauseVolume.addEventListener('input', () => G.Audio.setVolume(+pauseVolume.value));

  G.Music = {
    cue(name, opts) {
      const { ctx, musicBus } = G.Audio;
      if (!ctx || !musicBus || ctx.state === 'closed') return null;
      const score = Object.prototype.hasOwnProperty.call(scores, name) ? scores[name] : null;
      if (!score && name !== 'bombTicking' && name !== 'clutch') return null;
      const outcome = outcomes.includes(name);
      for (const previous of active) {
        if (previous.name === name || (outcome && (previous.name === 'clutch' || previous.name === 'bombTicking'))) {
          previous.stop(shortFade);
        }
      }
      const now = ctx.currentTime;
      const requested = opts && opts.seconds;
      const countdownCue = name === 'bombTicking';
      const deadline = Number.isFinite(requested) ? now + requested : now;
      const start = countdownCue ? now : now + .016;
      const end = score ? start + score.beats * 60 / score.bpm :
        (countdownCue ? (deadline > now && Number.isFinite(deadline) ? deadline : now + 10) : Infinity);
      const playing = track(ctx, musicBus, name, start, end);
      if (name === 'clutch') clutch(ctx, playing);
      else {
        const rack = instrumentRack(ctx, playing);
        if (score) scoreCue(rack, score, start);
        else {
          // Leave scheduling headroom inside the requested countdown window.
          const first = start + Math.min(.016, (end - start) * .08);
          countdown(rack, first, end - first);
        }
      }
      return playing.start();
    },
    stopAll(fadeSeconds) {
      for (const playing of active) playing.stop(fadeSeconds);
    },
    setVolume
  };
})(window.G);
