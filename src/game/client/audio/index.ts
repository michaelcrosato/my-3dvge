/**
 * PATHBREAKERS audio: procedural WebAudio sound effects and music (no audio files — everything is
 * synthesized, so nothing to download and nothing third-party). This file is the contract; the stub
 * below is silent until the audio pass.
 */
import type { VehicleKind, XYZ } from '../../shared/types.ts';

export type SfxName =
  | 'explosion' | 'bigExplosion' | 'crumble' | 'collapse' | 'impact' | 'metalHit' | 'glass' | 'rdu'
  | 'survivor' | 'rescue' | 'dish' | 'enter' | 'exit' | 'horn' | 'turbo' | 'missile' | 'stomp'
  | 'thrustStart' | 'land' | 'warning' | 'countdown' | 'go' | 'pathClear' | 'carrierSafe' | 'fail'
  | 'medal' | 'uiClick' | 'uiBack' | 'uiMove' | 'fuse' | 'tick' | 'skid' | 'aligned' | 'radio' | 'pickup' | 'reset';

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
  return {
    unlock() {},
    setVolumes() {},
    play() {},
    setListener() {},
    setEngine() {},
    setLoop() {},
    setCarrier() {},
    setAlarm() {},
    setMusic() {},
    update() {},
  };
}
