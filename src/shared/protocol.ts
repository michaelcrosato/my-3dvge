/** Message shapes exchanged between the main thread, the simulation worker and the mesher workers. */
import type { Params } from '../config/params.ts';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface VolumeInfo {
  id: number;
  kind: 'static' | 'dynamic';
  /** Transform slot for dynamic volumes; -1 for static ones. */
  slot: number;
  /** Size in voxels. */
  size: Vec3;
  /** World transform of the volume's voxel-grid origin. */
  position: Vec3;
  rotation: Quat;
}

export interface SimStats {
  stepMs: number;
  stepMsMax: number;
  steps: number;
  dynamicBodies: number;
  bodiesActive: number;
  bodiesSleeping: number;
  colliders: number;
  voxels: number;
  volumes: number;
  meshJobs: number;
  particles: number;
}

/** Per-frame player intent sent from the main thread. */
export interface PlayerInput {
  /** Strafe (x, +right) and forward (y, +forward), each -1..1. */
  move: [number, number];
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  fly: boolean;
  /** Vertical intent in fly mode (-1..1). */
  vertical: number;
}

export type MainToSim =
  | { type: 'init'; params: Params; meshPorts: MessagePort[]; shared: SharedArrayBuffer | null }
  | { type: 'input'; input: PlayerInput }
  | { type: 'blast'; id: number; origin: Vec3; dir?: Vec3; radius?: number; power?: number }
  | { type: 'spawnCrate'; origin: Vec3; dir: Vec3 }
  | { type: 'settings'; settings: Partial<SimSettings> }
  | { type: 'pause'; paused: boolean };

export interface SimSettings {
  gravity: number;
  blastRadius: number;
  blastPower: number;
  strengthScale: number;
  maxBodies: number;
  particleThreshold: number;
}

export type SimToMain =
  | { type: 'ready'; scene: string; spawn: Vec3; spawnYaw: number; blastTarget: Vec3; settings: SimSettings }
  | { type: 'volumeAdded'; volume: VolumeInfo }
  | { type: 'volumeRemoved'; id: number }
  | { type: 'stats'; stats: SimStats }
  | { type: 'frame'; frame: number; time: number; transforms: Float32Array }
  | { type: 'particles'; data: Float32Array }
  | { type: 'blastDone'; id: number; newBodies: number; removedVoxels: number }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string; stack?: string };

export interface MeshJob {
  type: 'mesh';
  volumeId: number;
  chunk: number;
  version: number;
  /** Chunk origin in volume voxel coordinates. */
  origin: Vec3;
  /** PADDED³ palette indices (transferred). */
  data: Uint8Array;
}

export type SimToMesher = { type: 'palette'; colors: Uint8Array } | MeshJob;

export interface MeshResult {
  type: 'mesh';
  volumeId: number;
  chunk: number;
  version: number;
  origin: Vec3;
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  ms: number;
}

export type MesherToMain = MeshResult | { type: 'error'; message: string; stack?: string };
