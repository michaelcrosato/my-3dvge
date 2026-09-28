/**
 * Small synthesis toolkit on top of a (live or offline) BaseAudioContext: shared noise buffers,
 * distortion curves, envelope helpers and Karplus-Strong plucked-string buffers.
 */
import { midiToFreq } from './theory.ts';

export type NoiseKind = 'white' | 'brown' | 'pink';
export type PluckKind = 'banjo' | 'guitar' | 'surf';

/** Deterministic PRNG so buffers are reproducible. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCurve(amount: number, n = 1024, ceiling = 1): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (ceiling * Math.tanh(amount * x)) / norm;
  }
  return curve;
}

/** Soft-clip curve that never exceeds ±0.98 (the master "brickwall"). */
export const SAFETY_CURVE = makeCurve(1.2, 2048, 0.98);

export class Synth {
  readonly ctx: BaseAudioContext;
  readonly white: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly crunch: Float32Array<ArrayBuffer>;
  readonly drive: Float32Array<ArrayBuffer>;
  private readonly rand = mulberry(1234);
  private readonly plucks = new Map<string, AudioBuffer>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2);
    this.white = ctx.createBuffer(1, len, sr);
    this.brown = ctx.createBuffer(1, len, sr);
    this.pink = ctx.createBuffer(1, len, sr);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0), p = this.pink.getChannelData(0);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const r = this.rand() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
      b0 = 0.99765 * b0 + r * 0.099046;
      b1 = 0.963 * b1 + r * 0.2965164;
      b2 = 0.57 * b2 + r * 1.0526913;
      p[i] = (b0 + b1 + b2 + r * 0.1848) * 0.2;
    }
    this.crunch = makeCurve(3.5);
    this.drive = makeCurve(1.8);
  }

  random(): number {
    return this.rand();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  gain(value: number, dest?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q: number, dest?: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  shaper(curve: Float32Array<ArrayBuffer>, dest?: AudioNode): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = '2x';
    if (dest) s.connect(dest);
    return s;
  }

  panner(pan: number, dest?: AudioNode): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    if (dest) p.connect(dest);
    return p;
  }

  osc(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  /** Low-frequency oscillator modulating `param` by ±depth (stops at t + dur; Infinity = until stopped). */
  lfo(type: OscillatorType, rate: number, depth: number, param: AudioParam, t: number, dur = Number.POSITIVE_INFINITY): OscillatorNode {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    g.connect(param);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    o.connect(g);
    o.start(t);
    if (Number.isFinite(dur)) o.stop(t + dur);
    o.onended = () => g.disconnect();
    return o;
  }

  /** Noise from a shared buffer, started at a random offset. */
  noise(kind: NoiseKind, t: number, dur: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'white' ? this.white : kind === 'brown' ? this.brown : this.pink;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start(t, this.rand() * 1.5);
    src.stop(t + dur);
    return src;
  }

  /** Looping noise that runs until stopped (for continuous sounds). */
  noiseLoop(kind: NoiseKind, dest: AudioNode): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'white' ? this.white : kind === 'brown' ? this.brown : this.pink;
    src.loop = true;
    src.connect(dest);
    src.start(this.ctx.currentTime, this.rand() * 1.5);
    return src;
  }

  /**
   * Percussive envelope: 0 → peak in `attack`, exponential decay to silence over `decay`.
   * Returns the end time.
   */
  perc(param: AudioParam, t: number, peak: number, attack: number, decay: number): number {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    param.setValueAtTime(0, t + attack + decay + 0.001);
    return t + attack + decay;
  }

  /** attack → hold → release envelope. Returns the end time. */
  ahr(param: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    param.setValueAtTime(0, t + attack + hold + release + 0.001);
    return t + attack + hold + release;
  }

  /** Exponential pitch/frequency sweep. */
  sweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
    param.setValueAtTime(Math.max(0.01, from), t);
    param.exponentialRampToValueAtTime(Math.max(0.01, to), t + dur);
  }

  /** Karplus-Strong plucked string buffer for a MIDI note (cached). */
  pluckBuffer(midi: number, kind: PluckKind): AudioBuffer {
    const key = `${kind}:${midi}`;
    const cached = this.plucks.get(key);
    if (cached) return cached;
    const sr = this.ctx.sampleRate;
    const freq = midiToFreq(midi);
    const dur = kind === 'banjo' ? 0.9 : kind === 'surf' ? 0.35 : 1.4;
    const decay = kind === 'banjo' ? 0.994 : kind === 'surf' ? 0.99 : 0.9975;
    const brightness = kind === 'banjo' ? 0.9 : kind === 'surf' ? 0.75 : 0.55;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) {
      prev += brightness * (this.rand() * 2 - 1 - prev);
      ring[i] = prev;
    }
    let idx = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const next = idx + 1 === period ? 0 : idx + 1;
      const v = ring[idx]!;
      // Banjo twang: a touch of the un-averaged sample keeps it bright.
      out[i] = v;
      ring[idx] = decay * (kind === 'banjo' ? 0.52 * v + 0.48 * ring[next]! : 0.5 * (v + ring[next]!));
      idx = next;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const norm = peak > 0 ? 0.8 / peak : 1;
    const fade = Math.min(n, Math.floor(sr * 0.02));
    for (let i = 0; i < n; i++) {
      out[i]! *= norm;
      if (i > n - fade) out[i]! *= (n - i) / fade;
    }
    this.plucks.set(key, buf);
    return buf;
  }

  /** Plays a buffer at time t; returns the source. */
  play(buffer: AudioBuffer, t: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start(t);
    return src;
  }

  /** Disconnects `node` once `src` has ended (frees the subgraph). */
  cleanup(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    src.onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }
}
