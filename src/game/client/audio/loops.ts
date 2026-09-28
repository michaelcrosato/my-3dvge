/**
 * Continuous sounds: per-vehicle engines, thruster roar, tire slide, carrier rumble and the collision
 * alarm. Each loop owns a few long-lived nodes; `set` glides parameters, `stop` fades out and releases.
 */
import type { VehicleKind } from '../../shared/types.ts';
import type { Synth } from './synth.ts';

export interface LoopVoice {
  readonly out: GainNode;
  /** speed/load (or level) in 0..1. */
  set(a: number, b: number): void;
  stop(fade?: number): void;
}

const GLIDE = 0.06;

class LoopBuilder {
  readonly s: Synth;
  readonly out: GainNode;
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly nodes: AudioNode[] = [];

  constructor(s: Synth, dest: AudioNode) {
    this.s = s;
    this.out = s.gain(0, dest);
    this.nodes.push(this.out);
  }

  osc(type: OscillatorType, freq: number, dest: AudioNode): OscillatorNode {
    const o = this.s.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start();
    this.sources.push(o);
    return o;
  }

  noise(kind: 'white' | 'brown' | 'pink', dest: AudioNode): AudioBufferSourceNode {
    const n = this.s.noiseLoop(kind, dest);
    this.sources.push(n);
    return n;
  }

  gain(v: number, dest: AudioNode): GainNode {
    const g = this.s.gain(v, dest);
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode {
    const x = this.s.filter(type, f, q, dest);
    this.nodes.push(x);
    return x;
  }

  lfo(type: OscillatorType, rate: number, depth: number, param: AudioParam): OscillatorNode {
    const o = this.s.lfo(type, rate, depth, param, this.s.ctx.currentTime);
    this.sources.push(o);
    return o;
  }

  voice(set: (a: number, b: number, t: number) => void, level: number): LoopVoice {
    const s = this.s;
    let stopped = false;
    const v: LoopVoice = {
      out: this.out,
      set: (a, b) => {
        if (stopped) return;
        const t = s.ctx.currentTime;
        set(Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b)), t);
      },
      stop: (fade = 0.3) => {
        if (stopped) return;
        stopped = true;
        const t = s.ctx.currentTime;
        this.out.gain.cancelScheduledValues(t);
        this.out.gain.setValueAtTime(this.out.gain.value, t);
        this.out.gain.linearRampToValueAtTime(0, t + fade);
        for (const src of this.sources) src.stop(t + fade + 0.05);
        this.sources[0]?.addEventListener('ended', () => this.nodes.forEach((n) => n.disconnect()));
      },
    };
    this.out.gain.setTargetAtTime(level, s.ctx.currentTime, 0.08);
    return v;
  }
}

function glide(param: AudioParam, value: number, t: number, tc = GLIDE): void {
  param.setTargetAtTime(value, t, tc);
}

/** Diesel-style engine: detuned saws through a lowpass, amplitude "chug" at the firing rate. */
function diesel(s: Synth, dest: AudioNode, base: number, span: number, voices: number, chugDepth: number, cutoff: [number, number]): LoopVoice {
  const b = new LoopBuilder(s, dest);
  const chug = b.gain(0.7, b.out);
  const lp = b.filter('lowpass', cutoff[0], 2.2, chug);
  const oscs: OscillatorNode[] = [];
  for (let i = 0; i < voices; i++) oscs.push(b.osc('sawtooth', base * (1 + i * 0.012), b.gain(0.35 / voices + 0.1, lp)));
  const sub = b.osc('square', base / 2, b.gain(0.16, lp));
  const chugLfo = b.lfo('square', base / 2, chugDepth, chug.gain);
  const rumbleLp = b.filter('lowpass', 420, 0.7, b.out);
  const rumble = b.gain(0.08, rumbleLp);
  b.noise('brown', rumble);
  return b.voice((speed, load, t) => {
    const f = base + span * speed + span * 0.25 * load;
    oscs.forEach((o, i) => glide(o.frequency, f * (1 + i * 0.012), t));
    glide(sub.frequency, f / 2, t);
    glide(chugLfo.frequency, f / 2.2, t);
    glide(lp.frequency, cutoff[0] + (cutoff[1] - cutoff[0]) * (0.35 * speed + 0.65 * load), t);
    glide(rumble.gain, 0.05 + 0.12 * load, t);
  }, 0.32);
}

export function createEngine(s: Synth, dest: AudioNode, kind: VehicleKind): LoopVoice {
  switch (kind) {
    case 'dozer':
      return diesel(s, dest, 30, 38, 2, 0.35, [260, 1300]);
    case 'truck':
      return diesel(s, dest, 36, 50, 2, 0.25, [320, 1700]);
    case 'semi':
      return diesel(s, dest, 27, 40, 3, 0.3, [280, 1400]);
    case 'buggy': {
      const b = new LoopBuilder(s, dest);
      const drive = s.shaper(s.drive, b.out);
      b.nodes.push(drive);
      const lp = b.filter('lowpass', 1200, 1.6, drive);
      const trem = b.gain(0.8, lp);
      const saw = b.osc('sawtooth', 80, b.gain(0.3, trem));
      const sq = b.osc('square', 160, b.gain(0.08, trem));
      const lfo = b.lfo('sine', 20, 0.15, trem.gain);
      return b.voice((speed, load, t) => {
        const f = 70 + 250 * speed + 40 * load;
        glide(saw.frequency, f, t, 0.04);
        glide(sq.frequency, f * 2, t, 0.04);
        glide(lfo.frequency, f / 4, t);
        glide(lp.frequency, 900 + 3200 * load + 800 * speed, t);
      }, 0.22);
    }
    case 'bike': {
      const b = new LoopBuilder(s, dest);
      const lp = b.filter('lowpass', 1800, 1.2, b.out);
      const sq = b.osc('square', 110, b.gain(0.22, lp));
      const whine = b.osc('sawtooth', 330, b.gain(0.05, lp));
      b.lfo('sine', 7, 4, sq.frequency);
      return b.voice((speed, load, t) => {
        const f = 100 + 340 * speed + 30 * load;
        glide(sq.frequency, f, t, 0.04);
        glide(whine.frequency, f * 3, t, 0.04);
        glide(lp.frequency, 1500 + 2600 * load + 600 * speed, t);
      }, 0.2);
    }
    case 'mech': {
      const b = new LoopBuilder(s, dest);
      const tri = b.osc('triangle', 90, b.gain(0.3, b.out));
      const oct = b.osc('sine', 180, b.gain(0.08, b.out));
      b.lfo('sine', 5.5, 3, tri.frequency);
      const bp = b.filter('bandpass', 3200, 6, b.out);
      const whine = b.gain(0.0, bp);
      b.noise('white', whine);
      const humLp = b.filter('lowpass', 160, 1, b.out);
      const hum = b.osc('sawtooth', 55, b.gain(0.18, humLp));
      return b.voice((speed, load, t) => {
        const f = 85 + 95 * speed;
        glide(tri.frequency, f, t);
        glide(oct.frequency, f * 2, t);
        glide(whine.gain, 0.02 + 0.08 * speed, t);
        glide(hum.frequency, 50 + 12 * load, t);
      }, 0.26);
    }
    case 'train': {
      const b = new LoopBuilder(s, dest);
      const chuff = b.gain(0.4, b.out);
      const bp = b.filter('bandpass', 650, 1.1, chuff);
      b.noise('white', b.gain(0.9, bp));
      const lfo = b.lfo('square', 1.2, 0.38, chuff.gain);
      const lp = b.filter('lowpass', 210, 1.5, b.out);
      const hum = b.osc('sawtooth', 40, b.gain(0.22, lp));
      return b.voice((speed, load, t) => {
        glide(lfo.frequency, 0.8 + 6 * speed, t, 0.15);
        glide(hum.frequency, 38 + 14 * load, t);
        glide(bp.frequency, 550 + 400 * speed, t);
      }, 0.3);
    }
  }
}

export function createThrust(s: Synth, dest: AudioNode): LoopVoice {
  const b = new LoopBuilder(s, dest);
  const lp = b.filter('lowpass', 2600, 0.7, b.out);
  const bp = b.filter('bandpass', 900, 0.6, lp);
  b.noise('pink', b.gain(1.1, bp));
  const rumbleLp = b.filter('lowpass', 180, 1, b.out);
  b.noise('brown', b.gain(0.5, rumbleLp));
  const flutter = b.lfo('sine', 13, 120, bp.frequency);
  void flutter;
  return b.voice(() => undefined, 0.5);
}

export function createSlide(s: Synth, dest: AudioNode): LoopVoice {
  const b = new LoopBuilder(s, dest);
  const bp1 = b.filter('bandpass', 1800, 8, b.out);
  const bp2 = b.filter('bandpass', 2700, 10, b.out);
  b.noise('white', b.gain(0.9, bp1));
  b.noise('white', b.gain(0.5, bp2));
  b.lfo('sine', 21, 260, bp1.frequency);
  b.lfo('sine', 17, 300, bp2.frequency);
  return b.voice(() => undefined, 0.3);
}

/** Low pulsing rumble; `set(level)` scales loudness (distance attenuation applied by the caller). */
export function createCarrier(s: Synth, dest: AudioNode): LoopVoice {
  const b = new LoopBuilder(s, dest);
  const pulse = b.gain(0.65, b.out);
  const lp = b.filter('lowpass', 210, 3, pulse);
  b.osc('sawtooth', 41, b.gain(0.4, lp));
  b.osc('sine', 55, b.gain(0.5, lp));
  b.osc('sawtooth', 82.4, b.gain(0.15, lp));
  b.lfo('sine', 1.15, 0.33, pulse.gain);
  const v = b.voice((level, _b, t) => glide(b.out.gain, level, t, 0.2), 0);
  return v;
}

/** Siren: sweeping saw; `set(level 0..1)` controls speed and loudness. */
export function createAlarm(s: Synth, dest: AudioNode): LoopVoice {
  const b = new LoopBuilder(s, dest);
  const lp = b.filter('lowpass', 2600, 0.8, b.out);
  const saw = b.osc('sawtooth', 780, b.gain(0.5, lp));
  const sq = b.osc('square', 1170, b.gain(0.12, lp));
  const sweep = b.lfo('triangle', 0.8, 260, saw.frequency);
  const sweep2 = b.lfo('triangle', 0.8, 390, sq.frequency);
  return b.voice((level, _b, t) => {
    const rate = 0.6 + level * 2.8;
    glide(sweep.frequency, rate, t, 0.1);
    glide(sweep2.frequency, rate, t, 0.1);
    glide(b.out.gain, 0.08 + level * 0.18, t, 0.1);
  }, 0.1);
}
