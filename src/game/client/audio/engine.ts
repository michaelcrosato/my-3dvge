/**
 * The live GameAudio implementation: AudioContext + master chain (compressor → soft-clip safety), music
 * and sfx buses, a capped/rate-limited one-shot voice pool with listener-relative spatialization,
 * continuous loops and the lookahead music scheduler.
 */
import type { VehicleKind, XYZ } from '../../shared/types.ts';
import type { GameAudio, MusicTrack, PlayOptions, SfxName } from './index.ts';
import { createAlarm, createCarrier, createEngine, createSlide, createThrust, type LoopVoice } from './loops.ts';
import { MusicSequencer } from './music.ts';
import { SFX, SFX_LEVEL } from './sfx.ts';
import { SAFETY_CURVE, Synth } from './synth.ts';
import { pickVoiceToDrop, spatialize } from './theory.ts';

export const VOICE_CAP = 24;
const RATE_LIMIT_S = 0.03;
const LOOKAHEAD_S = 0.12;
const TIMER_MS = 25;
/** Effects that get a little random pitch variation so repeats don't sound mechanical. */
const VARY = new Set<string>(['explosion', 'bigExplosion', 'impact', 'crumble', 'metalHit', 'stomp', 'land', 'glass', 'collapse']);

interface Voice {
  name: string;
  volume: number;
  start: number;
  end: number;
  out: GainNode;
  pan: StereoPannerNode;
}

/** Master chain shared by the live engine and offline renders: in → compressor → safety clip → dest. */
export function buildMasterChain(ctx: BaseAudioContext, dest: AudioNode): GainNode {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 10;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const safety = ctx.createWaveShaper();
  safety.curve = SAFETY_CURVE;
  safety.oversample = '2x';
  input.connect(comp);
  comp.connect(safety);
  safety.connect(dest);
  return input;
}

export interface AudioStats {
  unlocked: boolean;
  state: string;
  voices: number;
  played: number;
  dropped: number;
  skipped: number;
  music: string | null;
}

export class AudioEngine implements GameAudio {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private music: MusicSequencer | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private voices: Voice[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private listener: XYZ = [0, 0, 0];
  private yaw = 0;
  private volumes = { music: 0.6, sfx: 0.9 };
  private engineKind: VehicleKind | null = null;
  private engineVoice: LoopVoice | null = null;
  private engineState = { kind: null as VehicleKind | null, speed: 0, load: 0 };
  private readonly loopOn = { thrust: false, slide: false, fuse: false };
  private readonly loopVoices: { thrust: LoopVoice | null; slide: LoopVoice | null } = { thrust: null, slide: null };
  private nextFuseTick = 0;
  private carrierVoice: LoopVoice | null = null;
  private carrierState = { distance: 1e9, rolling: false };
  private alarmVoice: LoopVoice | null = null;
  private alarmLevel = 0;
  private musicState: { track: MusicTrack; tension: number } = { track: 'none', tension: 0 };
  private readonly counters = { played: 0, dropped: 0, skipped: 0 };

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  stats(): AudioStats {
    return {
      unlocked: this.ctx !== null,
      state: this.ctx?.state ?? 'locked',
      voices: this.voices.length,
      ...this.counters,
      music: this.music?.current ?? null,
    };
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.synth = new Synth(ctx);
      this.master = buildMasterChain(ctx, ctx.destination);
      this.musicBus = this.synth.gain(this.volumes.music * 0.8, this.master);
      this.sfxBus = this.synth.gain(this.volumes.sfx, this.master);
      this.music = new MusicSequencer(this.synth, this.musicBus);
      this.timer = setInterval(() => this.tick(), TIMER_MS);
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend().catch(() => undefined);
        else void this.ctx.resume().catch(() => undefined);
      });
      // Apply state requested before unlock.
      this.setEngine(this.engineState.kind, this.engineState.speed, this.engineState.load);
      for (const k of ['thrust', 'slide', 'fuse'] as const) if (this.loopOn[k]) this.applyLoop(k, true);
      this.setCarrier(this.carrierState.distance, this.carrierState.rolling);
      this.setAlarm(this.alarmLevel);
      this.music.set(this.musicState.track, this.musicState.tension);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  setVolumes(music: number, sfx: number): void {
    this.volumes = { music: Math.max(0, Math.min(1, music)), sfx: Math.max(0, Math.min(1, sfx)) };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus!.gain.setTargetAtTime(this.volumes.music * 0.8, t, 0.05);
    this.sfxBus!.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  setListener(pos: XYZ, yaw: number): void {
    this.listener = [pos[0], pos[1], pos[2]];
    this.yaw = yaw;
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.synth || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < RATE_LIMIT_S) {
      this.counters.skipped++;
      return;
    }
    let gain = (opts.volume ?? 1) * (SFX_LEVEL[name] ?? 0.7);
    let pan = 0;
    if (opts.at) {
      const sp = spatialize(this.listener, this.yaw, opts.at);
      gain *= sp.gain;
      pan = sp.pan;
    }
    if (gain < 0.01) {
      this.counters.skipped++;
      return;
    }
    this.lastPlayed.set(name, now);
    const pitch = opts.pitch ?? (VARY.has(name) ? 1 + (Math.random() - 0.5) * 0.08 : 1);
    this.enqueue(name, now + 0.004, gain, pan, pitch);
  }

  /** Scheduled fuse ticks share the same cap as immediate one-shots. */
  private enqueue(name: string, t: number, gain: number, pan: number, pitch: number): void {
    const now = this.ctx!.currentTime;
    this.prune(now);
    const drop = pickVoiceToDrop(this.voices, gain, VOICE_CAP);
    if (drop === 'skip') {
      this.counters.skipped++;
      return;
    }
    if (drop !== null) {
      this.kill(this.voices[drop]!, now);
      this.voices.splice(drop, 1);
      this.counters.dropped++;
    }
    this.voices.push(this.spawn(name, t, gain, pan, pitch));
    this.counters.played++;
  }

  private spawn(name: string, t: number, gain: number, pan: number, pitch: number): Voice {
    const s = this.synth!;
    const panNode = s.panner(pan, this.sfxBus!);
    const out = s.gain(gain, panNode);
    const recipe = SFX[name];
    const end = recipe ? recipe(s, out, t, pitch) : t;
    const v: Voice = { name, volume: gain, start: t, end, out, pan: panNode };
    setTimeout(() => {
      out.disconnect();
      panNode.disconnect();
    }, (end - s.now + 0.3) * 1000);
    return v;
  }

  private kill(v: Voice, now: number): void {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + 0.02);
    v.end = now;
  }

  private prune(now: number): void {
    if (this.voices.length) this.voices = this.voices.filter((v) => v.end > now);
  }

  setEngine(kind: VehicleKind | null, speed01: number, load01: number): void {
    this.engineState = { kind, speed: speed01, load: load01 };
    if (!this.ctx || !this.synth) return;
    if (kind !== this.engineKind) {
      this.engineVoice?.stop(0.35);
      this.engineVoice = kind ? createEngine(this.synth, this.sfxBus!, kind) : null;
      this.engineKind = kind;
    }
    this.engineVoice?.set(speed01, load01);
  }

  setLoop(name: 'thrust' | 'slide' | 'fuse', on: boolean): void {
    if (this.loopOn[name] === on) return;
    this.loopOn[name] = on;
    if (this.ctx) this.applyLoop(name, on);
  }

  private applyLoop(name: 'thrust' | 'slide' | 'fuse', on: boolean): void {
    const s = this.synth!;
    if (name === 'fuse') {
      if (on) this.nextFuseTick = this.ctx!.currentTime + 0.02;
      return;
    }
    if (on && !this.loopVoices[name]) {
      this.loopVoices[name] = name === 'thrust' ? createThrust(s, this.sfxBus!) : createSlide(s, this.sfxBus!);
      if (name === 'thrust') this.play('thrustStart');
    } else if (!on && this.loopVoices[name]) {
      this.loopVoices[name]!.stop(name === 'thrust' ? 0.25 : 0.15);
      this.loopVoices[name] = null;
    }
  }

  setCarrier(distance: number, rolling: boolean): void {
    this.carrierState = { distance, rolling };
    if (!this.ctx || !this.synth) return;
    const level = rolling ? Math.min(1, (14 / Math.max(distance, 1)) ** 0.9) * 0.55 : 0;
    if (rolling && level > 0.004) {
      this.carrierVoice ??= createCarrier(this.synth, this.sfxBus!);
      this.carrierVoice.set(level, 0);
    } else if (this.carrierVoice) {
      if (!rolling) {
        this.carrierVoice.stop(1);
        this.carrierVoice = null;
      } else {
        this.carrierVoice.set(0, 0);
      }
    }
  }

  setAlarm(level: number): void {
    this.alarmLevel = Math.max(0, Math.min(4, Math.round(level)));
    if (!this.ctx || !this.synth) return;
    if (this.alarmLevel === 0) {
      this.alarmVoice?.stop(0.3);
      this.alarmVoice = null;
      return;
    }
    this.alarmVoice ??= createAlarm(this.synth, this.sfxBus!);
    this.alarmVoice.set(this.alarmLevel / 4, 0);
  }

  setMusic(track: MusicTrack, tension: number): void {
    this.musicState = { track, tension };
    this.music?.set(track, tension);
  }

  update(dt: number): void {
    void dt;
    if (this.ctx) this.prune(this.ctx.currentTime);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    this.music?.schedule(horizon);
    if (this.loopOn.fuse) {
      if (this.nextFuseTick < ctx.currentTime - 0.1) this.nextFuseTick = ctx.currentTime + 0.01;
      while (this.nextFuseTick < horizon) {
        this.enqueue('fuse', this.nextFuseTick, 0.5, 0, 1);
        this.nextFuseTick += 0.24;
      }
    }
  }

  /** Stops everything and releases the context (tests / teardown). */
  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
