/**
 * One-shot sound effect recipes. Each recipe builds its own little node graph into `out`, starting at
 * time `t`, with a pitch multiplier `p`, and returns when it finishes (seconds, context time).
 * Levels are designed to peak around 0.6–0.8 before the master limiter.
 */
import type { Synth } from './synth.ts';
import { midiToFreq, noteToMidi } from './theory.ts';

export type Recipe = (s: Synth, out: AudioNode, t: number, p: number) => number;

const n = (name: string) => midiToFreq(noteToMidi(name));

/** Low boom: a sine that drops in pitch. */
function thump(s: Synth, out: AudioNode, t: number, from: number, to: number, dur: number, peak: number): number {
  const g = s.gain(0, out);
  const o = s.osc('sine', from, t, dur + 0.05, g);
  s.sweep(o.frequency, t, from, to, dur);
  s.cleanup(o, g);
  return s.perc(g.gain, t, peak, 0.004, dur);
}

/** Filtered noise burst with a moving cutoff. */
function burst(
  s: Synth, out: AudioNode, t: number, kind: 'white' | 'brown' | 'pink', type: BiquadFilterType,
  f0: number, f1: number, q: number, attack: number, decay: number, peak: number,
): number {
  const g = s.gain(0, out);
  const f = s.filter(type, f0, q, g);
  const src = s.noise(kind, t, attack + decay + 0.05, f);
  s.sweep(f.frequency, t, f0, f1, attack + decay);
  s.cleanup(src, f, g);
  return s.perc(g.gain, t, peak, attack, decay);
}

/** A tonal blip/beep. */
function tone(s: Synth, out: AudioNode, type: OscillatorType, freq: number, t: number, attack: number, hold: number, release: number, peak: number, lp = 0): number {
  const g = s.gain(0, out);
  const dest = lp > 0 ? s.filter('lowpass', lp, 0.7, g) : g;
  const o = s.osc(type, freq, t, attack + hold + release + 0.05, dest);
  s.cleanup(o, g, dest);
  return s.ahr(g.gain, t, peak, attack, hold, release);
}

/** Bell-ish ping: sine + a quieter inharmonic partial. */
function bell(s: Synth, out: AudioNode, freq: number, t: number, decay: number, peak: number): number {
  const end = tone(s, out, 'sine', freq, t, 0.003, 0, decay, peak);
  tone(s, out, 'sine', freq * 2.76, t, 0.002, 0, decay * 0.4, peak * 0.25);
  tone(s, out, 'triangle', freq * 2, t, 0.002, 0, decay * 0.6, peak * 0.2);
  return end;
}

/** Crackle grains (debris). */
function grains(s: Synth, out: AudioNode, t: number, dur: number, count: number, peak: number, lo = 700, hi = 3200): number {
  // Each grain builds a few nodes; cap them so a collapse can't build hundreds on the main thread.
  count = Math.min(count, 10);
  let end = t;
  for (let i = 0; i < count; i++) {
    const at = t + Math.pow(s.random(), 1.6) * dur;
    const len = 0.006 + s.random() * 0.03;
    end = Math.max(end, burst(s, out, at, 'white', 'bandpass', lo + s.random() * (hi - lo), lo, 3, 0.001, len, peak * (0.4 + s.random() * 0.6)));
  }
  return end;
}

/** Brass-ish chord stab (fanfares). */
function brass(s: Synth, out: AudioNode, notes: number[], t: number, hold: number, peak: number): number {
  let end = t;
  const g = s.gain(1, out);
  const f = s.filter('lowpass', 900, 1.2, g);
  f.frequency.setValueAtTime(700, t);
  f.frequency.linearRampToValueAtTime(2600, t + 0.06);
  f.frequency.exponentialRampToValueAtTime(1200, t + hold + 0.2);
  for (const freq of notes) {
    const vg = s.gain(0, f);
    const o1 = s.osc('sawtooth', freq, t, hold + 0.35, vg);
    const o2 = s.osc('sawtooth', freq * 1.006, t, hold + 0.35, vg);
    s.cleanup(o1, vg);
    void o2;
    end = Math.max(end, s.ahr(vg.gain, t, peak / notes.length, 0.02, hold, 0.25));
  }
  setTimeoutCleanup(s, end, g, f);
  return end;
}

/** Disconnect helper for graphs without a single terminal source (live contexts only). */
function setTimeoutCleanup(s: Synth, end: number, ...nodes: AudioNode[]): void {
  if (typeof OfflineAudioContext !== 'undefined' && s.ctx instanceof OfflineAudioContext) return;
  setTimeout(() => nodes.forEach((x) => x.disconnect()), (end - s.ctx.currentTime + 0.2) * 1000);
}

function explosionCore(s: Synth, out: AudioNode, t: number, p: number, size: number): number {
  const dist = s.shaper(s.crunch, out);
  const pre = s.gain(0.55, dist);
  // Crack + roar.
  let end = burst(s, pre, t, 'white', 'lowpass', 5000 * p, 260, 0.7, 0.003, 0.5 * size, 0.9);
  end = Math.max(end, burst(s, pre, t, 'brown', 'lowpass', 1400 * p, 120, 0.5, 0.01, 1.2 * size, 1.0));
  // Sub drop.
  end = Math.max(end, thump(s, out, t, 110 * p, 32, 0.7 * size, 0.85));
  end = Math.max(end, grains(s, out, t + 0.05, 0.6 * size, Math.round(10 * size), 0.35));
  setTimeoutCleanup(s, end, pre, dist);
  return end;
}

const X: Record<string, Recipe> = {
  explosion: (s, out, t, p) => explosionCore(s, out, t, p, 1),
  bigExplosion: (s, out, t, p) => {
    const e1 = explosionCore(s, out, t, p * 0.85, 1.8);
    const e2 = explosionCore(s, out, t + 0.32, p * 0.7, 1.5);
    const e3 = thump(s, out, t, 70, 22, 2.2, 0.7);
    return Math.max(e1, e2, e3);
  },
  crumble: (s, out, t, p) => {
    const bed = burst(s, out, t, 'pink', 'lowpass', 1600 * p, 400, 0.6, 0.02, 0.7, 0.35);
    return Math.max(bed, grains(s, out, t, 0.8, 26, 0.5, 600 * p, 2800 * p));
  },
  collapse: (s, out, t, p) => {
    const g = s.gain(0, out);
    const f = s.filter('lowpass', 260 * p, 0.8, g);
    const src = s.noise('brown', t, 3.2, f);
    s.cleanup(src, f, g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.35);
    g.gain.setValueAtTime(0.9, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
    const rumble = thump(s, out, t, 60 * p, 28, 2.4, 0.55);
    const cr = grains(s, out, t + 0.1, 2.4, 55, 0.45, 500, 2600);
    return Math.max(t + 3.1, rumble, cr);
  },
  impact: (s, out, t, p) => {
    const a = thump(s, out, t, 150 * p, 48, 0.18, 0.9);
    const b = burst(s, out, t, 'white', 'lowpass', 1400 * p, 300, 0.7, 0.001, 0.07, 0.5);
    return Math.max(a, b);
  },
  metalHit: (s, out, t, p) => {
    let end = t;
    const partials = [523, 1307, 2011, 2897, 3810];
    partials.forEach((f, i) => {
      end = Math.max(end, tone(s, out, 'sine', f * p * (1 + (s.random() - 0.5) * 0.02), t, 0.001, 0, 0.9 / (1 + i * 0.45), 0.34 / (1 + i * 0.35)));
    });
    end = Math.max(end, burst(s, out, t, 'white', 'highpass', 3000, 3000, 0.7, 0.001, 0.05, 0.35));
    return Math.max(end, thump(s, out, t, 180 * p, 70, 0.12, 0.5));
  },
  glass: (s, out, t, p) => {
    let end = burst(s, out, t, 'white', 'highpass', 5000, 7000, 0.7, 0.001, 0.12, 0.3);
    for (let i = 0; i < 9; i++) {
      const at = t + s.random() * 0.35;
      end = Math.max(end, tone(s, out, i % 2 ? 'sine' : 'triangle', (2500 + s.random() * 3800) * p, at, 0.001, 0, 0.12 + s.random() * 0.2, 0.18));
    }
    return end;
  },
  rdu: (s, out, t, p) => Math.max(bell(s, out, n('E6') * p, t, 0.35, 0.45), bell(s, out, n('B6') * p, t + 0.075, 0.5, 0.45)),
  survivor: (s, out, t, p) => {
    let end = t;
    ['C5', 'E5', 'G5', 'C6'].forEach((note, i) => (end = Math.max(end, tone(s, out, 'square', n(note) * p, t + i * 0.07, 0.004, 0.04, 0.08, 0.22, 3000))));
    return end;
  },
  rescue: (s, out, t, p) => {
    let end = t;
    ['G5', 'C6', 'E6', 'G6'].forEach((note, i) => (end = Math.max(end, tone(s, out, 'square', n(note) * p, t + i * 0.09, 0.004, 0.06, 0.1, 0.22, 3500))));
    end = Math.max(end, bell(s, out, n('C7') * p, t + 0.36, 0.6, 0.3));
    return end;
  },
  dish: (s, out, t, p) => {
    const g = s.gain(0, out);
    const o = s.osc('sine', 400, t, 0.9, g);
    s.lfo('sine', 18, 60, o.frequency, t, 0.9);
    s.cleanup(o, g);
    o.frequency.setValueAtTime(400 * p, t);
    o.frequency.exponentialRampToValueAtTime(2400 * p, t + 0.35);
    o.frequency.exponentialRampToValueAtTime(900 * p, t + 0.8);
    const end = s.ahr(g.gain, t, 0.35, 0.02, 0.5, 0.3);
    return Math.max(end, bell(s, out, n('A6') * p, t + 0.45, 0.4, 0.2));
  },
  enter: (s, out, t, p) => {
    const clunk = Math.max(thump(s, out, t, 110, 60, 0.1, 0.7), burst(s, out, t, 'brown', 'lowpass', 700, 300, 0.8, 0.002, 0.08, 0.6));
    // Engine start: a sawtooth "vroom" that settles.
    const g = s.gain(0, out);
    const f = s.filter('lowpass', 400, 1.5, g);
    const o = s.osc('sawtooth', 30 * p, t + 0.12, 0.8, f);
    s.cleanup(o, f, g);
    o.frequency.setValueAtTime(28 * p, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(70 * p, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(42 * p, t + 0.85);
    f.frequency.setValueAtTime(300, t + 0.12);
    f.frequency.linearRampToValueAtTime(1400, t + 0.4);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.85);
    return Math.max(clunk, s.ahr(g.gain, t + 0.12, 0.45, 0.05, 0.3, 0.35));
  },
  exit: (s, out, t, p) => Math.max(thump(s, out, t, 100 * p, 55, 0.1, 0.65), burst(s, out, t, 'brown', 'lowpass', 800, 300, 0.8, 0.002, 0.09, 0.55)),
  horn: (s, out, t, p) => {
    const g = s.gain(0, out);
    const f = s.filter('lowpass', 1800, 1, g);
    const a = s.osc('square', 311 * p, t, 0.55, f);
    const b = s.osc('square', 370 * p, t, 0.55, f);
    s.cleanup(a, f, g);
    void b;
    return s.ahr(g.gain, t, 0.28, 0.03, 0.35, 0.12);
  },
  turbo: (s, out, t, p) => {
    const w = burst(s, out, t, 'pink', 'bandpass', 400 * p, 3200 * p, 1.5, 0.08, 0.7, 0.7);
    const g = s.gain(0, out);
    const o = s.osc('sawtooth', 120 * p, t, 0.7, s.filter('lowpass', 900, 1, g));
    s.cleanup(o, g);
    s.sweep(o.frequency, t, 120 * p, 420 * p, 0.6);
    return Math.max(w, s.ahr(g.gain, t, 0.18, 0.05, 0.25, 0.3));
  },
  missile: (s, out, t, p) => {
    const launch = thump(s, out, t, 220 * p, 70, 0.2, 0.6);
    const hiss = burst(s, out, t, 'white', 'highpass', 1200, 2500, 0.8, 0.02, 1.0, 0.45);
    const whine = tone(s, out, 'sawtooth', 700 * p, t + 0.02, 0.05, 0.3, 0.5, 0.06, 2400);
    return Math.max(launch, hiss, whine);
  },
  stomp: (s, out, t, p) => {
    const dist = s.shaper(s.drive, out);
    const a = thump(s, dist, t, 95 * p, 26, 0.45, 0.95);
    const b = burst(s, out, t, 'brown', 'lowpass', 900, 150, 0.7, 0.003, 0.5, 0.8);
    const c = grains(s, out, t + 0.03, 0.4, 12, 0.35);
    setTimeoutCleanup(s, Math.max(a, b, c), dist);
    return Math.max(a, b, c);
  },
  thrustStart: (s, out, t, p) => burst(s, out, t, 'pink', 'bandpass', 500 * p, 1400 * p, 0.9, 0.18, 0.25, 0.55),
  land: (s, out, t, p) => Math.max(thump(s, out, t, 120 * p, 40, 0.22, 0.8), burst(s, out, t, 'brown', 'lowpass', 900, 200, 0.7, 0.002, 0.2, 0.5)),
  warning: (s, out, t, p) => {
    let end = t;
    for (let i = 0; i < 2; i++) {
      end = Math.max(end, tone(s, out, 'square', 880 * p, t + i * 0.28, 0.005, 0.1, 0.02, 0.22, 3000));
      end = Math.max(end, tone(s, out, 'square', 660 * p, t + i * 0.28 + 0.13, 0.005, 0.1, 0.02, 0.22, 3000));
    }
    return end;
  },
  countdown: (s, out, t, p) => tone(s, out, 'square', 660 * p, t, 0.004, 0.14, 0.05, 0.28, 3500),
  go: (s, out, t, p) => Math.max(tone(s, out, 'square', 1320 * p, t, 0.004, 0.35, 0.2, 0.26, 4000), tone(s, out, 'square', 660 * p, t, 0.004, 0.35, 0.2, 0.14, 3000)),
  pathClear: (s, out, t, p) => {
    const e1 = brass(s, out, [n('C4'), n('E4'), n('G4')].map((f) => f * p), t, 0.12, 0.7);
    const e2 = brass(s, out, [n('D4'), n('F4'), n('A4')].map((f) => f * p), t + 0.18, 0.12, 0.7);
    const e3 = brass(s, out, [n('E4'), n('G4'), n('C5')].map((f) => f * p), t + 0.36, 0.6, 0.8);
    return Math.max(e1, e2, e3, bell(s, out, n('C6') * p, t + 0.36, 0.8, 0.2));
  },
  carrierSafe: (s, out, t, p) => {
    const chords = [['C4', 'E4', 'G4'], ['F4', 'A4', 'C5'], ['G4', 'B4', 'D5'], ['C4', 'E4', 'G4', 'C5']];
    let end = t;
    chords.forEach((c, i) => {
      end = Math.max(end, brass(s, out, c.map((x) => n(x) * p), t + i * 0.22, i === 3 ? 0.9 : 0.14, 0.75));
    });
    let tt = t + 0.66;
    for (const note of ['C6', 'E6', 'G6', 'C7']) {
      end = Math.max(end, bell(s, out, n(note) * p, tt, 0.6, 0.15));
      tt += 0.06;
    }
    return end;
  },
  fail: (s, out, t, p) => {
    let end = t;
    ['E4', 'D#4', 'D4', 'C#4'].forEach((note, i) => {
      end = Math.max(end, brass(s, out, [n(note) * p, (n(note) * p) / 2], t + i * 0.24, i === 3 ? 0.8 : 0.16, 0.65));
    });
    return Math.max(end, burst(s, out, t + 0.72, 'brown', 'lowpass', 400, 80, 0.6, 0.05, 1.2, 0.4));
  },
  medal: (s, out, t, p) => {
    let end = t;
    for (let i = 0; i < 8; i++) end = Math.max(end, bell(s, out, n(['C6', 'E6', 'G6', 'C7'][i % 4]!) * p * (1 + (s.random() - 0.5) * 0.01), t + i * 0.05, 0.4, 0.16));
    return end;
  },
  uiClick: (s, out, t, p) => tone(s, out, 'sine', 1800 * p, t, 0.001, 0.005, 0.03, 0.3),
  uiBack: (s, out, t, p) => {
    const g = s.gain(0, out);
    const o = s.osc('triangle', 900 * p, t, 0.14, g);
    s.cleanup(o, g);
    s.sweep(o.frequency, t, 900 * p, 520 * p, 0.1);
    return s.ahr(g.gain, t, 0.3, 0.003, 0.05, 0.06);
  },
  uiMove: (s, out, t, p) => tone(s, out, 'sine', 1250 * p, t, 0.001, 0.004, 0.025, 0.18),
  fuse: (s, out, t, p) => Math.max(tone(s, out, 'square', 2300 * p, t, 0.001, 0.004, 0.02, 0.2, 5000), burst(s, out, t, 'white', 'highpass', 4000, 4000, 0.7, 0.001, 0.02, 0.15)),
  tick: (s, out, t, p) => Math.max(tone(s, out, 'sine', 3000 * p, t, 0.0005, 0.002, 0.02, 0.22), burst(s, out, t, 'white', 'bandpass', 2500, 2500, 4, 0.0005, 0.015, 0.2)),
  skid: (s, out, t, p) => {
    const g = s.gain(0, out);
    const f = s.filter('bandpass', 1900 * p, 9, g);
    const src = s.noise('white', t, 0.5, f);
    s.lfo('sine', 23, 220, f.frequency, t, 0.5);
    s.cleanup(src, f, g);
    return s.ahr(g.gain, t, 0.55, 0.02, 0.25, 0.18);
  },
  aligned: (s, out, t, p) => Math.max(bell(s, out, 880 * p, t, 0.3, 0.35), bell(s, out, 1320 * p, t + 0.1, 0.55, 0.4)),
  radio: (s, out, t, p) => {
    const sq = burst(s, out, t, 'white', 'bandpass', 1600, 1800, 1.4, 0.005, 0.12, 0.35);
    const chirp = tone(s, out, 'sine', 2000 * p, t + 0.13, 0.002, 0.05, 0.02, 0.2);
    return Math.max(sq, chirp, tone(s, out, 'sine', 2600 * p, t + 0.2, 0.002, 0.04, 0.02, 0.16));
  },
  pickup: (s, out, t, p) => {
    const g = s.gain(0, out);
    const o = s.osc('square', 600 * p, t, 0.2, s.filter('lowpass', 3000, 0.7, g));
    s.cleanup(o, g);
    s.sweep(o.frequency, t, 600 * p, 1300 * p, 0.14);
    return Math.max(s.ahr(g.gain, t, 0.24, 0.005, 0.1, 0.06), bell(s, out, 1760 * p, t + 0.12, 0.3, 0.2));
  },
  reset: (s, out, t, p) => {
    const g = s.gain(0, out);
    const f = s.filter('bandpass', 3000, 1.2, g);
    const src = s.noise('pink', t, 0.5, f);
    s.cleanup(src, f, g);
    s.sweep(f.frequency, t, 3000 * p, 300 * p, 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    return t + 0.45;
  },
};

export const SFX = X;

/** Base volume per effect (before PlayOptions.volume and spatialization). */
export const SFX_LEVEL: Record<string, number> = {
  explosion: 0.9,
  bigExplosion: 1,
  collapse: 0.85,
  crumble: 0.95,
  impact: 0.7,
  metalHit: 0.55,
  glass: 0.5,
  stomp: 0.9,
  uiClick: 0.5,
  uiMove: 0.5,
  uiBack: 0.5,
  tick: 0.45,
  fuse: 0.5,
};
