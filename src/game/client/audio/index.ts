/**
 * PATHBREAKERS audio: procedural WebAudio sound effects and music (no audio files — everything is
 * synthesized, so nothing to download and nothing third-party).
 *
 * - One-shots: capped voice pool (24), 30 ms rate limit per effect, distance attenuation + stereo pan
 *   relative to the listener set with setListener().
 * - Loops: per-vehicle engines, thruster/slide/fuse, carrier rumble, collision alarm.
 * - Music: lookahead-scheduled country-rock with a "collision imminent" variant at tension ≥ 0.75.
 * - Master: compressor + soft-clip safety stage (never exceeds ±0.98).
 * Everything is a silent no-op until unlock() is called from a user gesture; state set before that is
 * remembered and applied on unlock.
 */
import type { VehicleKind, XYZ } from '../../shared/types.ts';
import { AudioEngine } from './engine.ts';

export type SfxName =
  | 'explosion' | 'bigExplosion' | 'crumble' | 'collapse' | 'impact' | 'metalHit' | 'glass' | 'rdu'
  | 'survivor' | 'rescue' | 'dish' | 'enter' | 'exit' | 'horn' | 'turbo' | 'missile' | 'stomp'
  | 'thrustStart' | 'land' | 'warning' | 'countdown' | 'go' | 'pathClear' | 'carrierSafe' | 'fail'
  | 'medal' | 'uiClick' | 'uiBack' | 'uiMove' | 'fuse' | 'tick' | 'skid' | 'aligned' | 'radio' | 'pickup' | 'reset';

export const SFX_NAMES: readonly SfxName[] = [
  'explosion', 'bigExplosion', 'crumble', 'collapse', 'impact', 'metalHit', 'glass', 'rdu', 'survivor', 'rescue',
  'dish', 'enter', 'exit', 'horn', 'turbo', 'missile', 'stomp', 'thrustStart', 'land', 'warning', 'countdown', 'go',
  'pathClear', 'carrierSafe', 'fail', 'medal', 'uiClick', 'uiBack', 'uiMove', 'fuse', 'tick', 'skid', 'aligned', 'radio',
  'pickup', 'reset',
];

export type MusicTrack = 'title' | 'mission' | 'results' | 'bonus' | 'none';

export interface PlayOptions {
  volume?: number;
  /** Playback-rate multiplier (1 = normal). */
  pitch?: number;
  /** World position for distance attenuation and stereo panning (relative to the listener). */
  at?: XYZ;
}

export interface GameAudio {
  /** Resume/create the AudioContext; call from a user gesture (first click/tap/key). */
  unlock(): void;
  /** 0..1 each. */
  setVolumes(music: number, sfx: number): void;
  play(name: SfxName, opts?: PlayOptions): void;
  setListener(pos: XYZ, yaw: number): void;
  /** Continuous engine loop for the controlled vehicle (null = on foot / silent). */
  setEngine(kind: VehicleKind | null, speed01: number, load01: number): void;
  /** Continuous thruster/slide loops. */
  setLoop(name: 'thrust' | 'slide' | 'fuse', on: boolean): void;
  /** Carrier rumble (distance from listener in m) while it rolls. */
  setCarrier(distance: number, rolling: boolean): void;
  /** Collision alarm level 0 (off) .. 4 (imminent). */
  setAlarm(level: number): void;
  /** Music track and tension 0..1 (tension ≥ 0.75 switches to the "collision imminent" variant). */
  setMusic(track: MusicTrack, tension: number): void;
  update(dt: number): void;
}

export function createGameAudio(): GameAudio {
  return new AudioEngine();
}
