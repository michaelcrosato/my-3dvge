/**
 * Simulation-side world state: every VoxelVolume with its transform, the shared palette, and mesh
 * dispatch for dirty chunks. Pure TypeScript with no worker globals, so it also runs in Node tests.
 */
import type { Params } from '../config/params.ts';
import type { MeshJob, Quat, SimStats, Vec3, VolumeInfo } from '../shared/protocol.ts';
import { CHUNK_SIZE } from '../voxel/constants.ts';
import { Palette } from '../voxel/palette.ts';
import type { VoxelVolume } from '../voxel/volume.ts';
import type { MeshSink } from './mesh-dispatch.ts';
import type { SceneContext } from './scene-api.ts';

/** Transform slots in the shared buffer; slot 0 is the player. */
export const MAX_SLOTS = 2048;
export const PLAYER_SLOT = 0;

export type VolumeTag = 'scene' | 'crate' | 'debris';

export interface SimVolume {
  id: number;
  kind: 'static' | 'dynamic';
  tag: VolumeTag;
  volume: VoxelVolume;
  position: Vec3;
  rotation: Quat;
  slot: number;
  chunkVersions: Uint32Array;
  /** Simulation time (s) when created — the oldest debris is despawned first. */
  createdAt: number;
}

export interface SimEvents {
  volumeAdded(info: VolumeInfo): void;
  volumeRemoved(id: number): void;
}

export class SimWorld {
  readonly params: Params;
  readonly palette = new Palette();
  readonly volumes = new Map<number, SimVolume>();
  spawn: Vec3 = [0, 2, 0];
  spawnYaw = 0;
  blastTarget: Vec3 = [0, 1, 0];
  time = 0;
  private readonly sink: MeshSink | null;
  private readonly events: SimEvents;
  private nextId = 1;
  private rng: number;
  /** FIFO so a freed slot isn't immediately reused (the renderer may still read it for a frame). */
  private readonly freeSlots: number[] = [];

  constructor(params: Params, sink: MeshSink | null, events: SimEvents, seed = 1337) {
    this.params = params;
    this.sink = sink;
    this.events = events;
    this.rng = seed;
    for (let s = 1; s < MAX_SLOTS; s++) this.freeSlots.push(s);
  }

  random(): number {
    // mulberry32
    let t = (this.rng += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  sceneContext(): SceneContext {
    return {
      params: this.params,
      palette: this.palette,
      random: () => this.random(),
      addStatic: (volume, position = [0, 0, 0]) => this.addVolume('static', volume, position, [0, 0, 0, 1], 'scene').id,
      addDynamic: (volume, position, rotation = [0, 0, 0, 1]) => this.addVolume('dynamic', volume, position, rotation, 'scene').id,
      setSpawn: (position, yaw = 0) => {
        this.spawn = position;
        this.spawnYaw = yaw;
      },
      setBlastTarget: (position) => {
        this.blastTarget = position;
      },
    };
  }

  get freeSlotCount(): number {
    return this.freeSlots.length;
  }

  addVolume(kind: 'static' | 'dynamic', volume: VoxelVolume, position: Vec3, rotation: Quat, tag: VolumeTag): SimVolume {
    const slot = kind === 'dynamic' ? (this.freeSlots.shift() ?? -1) : -1;
    if (kind === 'dynamic' && slot < 0) throw new Error('Out of transform slots');
    const sv: SimVolume = {
      id: this.nextId++,
      kind,
      tag,
      volume,
      position: [...position],
      rotation: [...rotation],
      slot,
      chunkVersions: new Uint32Array(volume.chunks.length),
      createdAt: this.time,
    };
    // Everything that exists starts dirty.
    for (const ci of volume.nonEmptyChunks()) {
      volume.dirtyMesh.add(ci);
      volume.dirtyCollider.add(ci);
    }
    this.volumes.set(sv.id, sv);
    this.events.volumeAdded(this.info(sv));
    return sv;
  }

  removeVolume(id: number): void {
    const sv = this.volumes.get(id);
    if (!sv) return;
    this.volumes.delete(id);
    if (sv.slot >= 0) this.freeSlots.push(sv.slot);
    this.events.volumeRemoved(id);
  }

  info(sv: SimVolume): VolumeInfo {
    const v = sv.volume;
    return { id: sv.id, kind: sv.kind, slot: sv.slot, size: [v.sizeX, v.sizeY, v.sizeZ], position: sv.position, rotation: sv.rotation };
  }

  /** Sends every dirty chunk to the mesher pool. Returns the number of jobs submitted. */
  flushMeshes(): number {
    let jobs = 0;
    for (const sv of this.volumes.values()) {
      const vol = sv.volume;
      if (vol.dirtyMesh.size === 0) continue;
      for (const ci of vol.dirtyMesh) {
        if (this.sink) {
          const [cxi, cyi, czi] = vol.chunkCoords(ci);
          const version = ++sv.chunkVersions[ci]!;
          const job: MeshJob = {
            type: 'mesh',
            volumeId: sv.id,
            chunk: ci,
            version,
            origin: [cxi * CHUNK_SIZE, cyi * CHUNK_SIZE, czi * CHUNK_SIZE],
            data: vol.extractPadded(ci),
          };
          this.sink.submit(job);
        }
        jobs++;
      }
      vol.dirtyMesh.clear();
    }
    return jobs;
  }

  voxelCount(): number {
    let n = 0;
    for (const sv of this.volumes.values()) n += sv.volume.voxelCount;
    return n;
  }

  baseStats(): SimStats {
    let dynamic = 0;
    for (const sv of this.volumes.values()) if (sv.kind === 'dynamic') dynamic++;
    return {
      stepMs: 0,
      stepMsMax: 0,
      steps: 0,
      dynamicBodies: dynamic,
      bodiesActive: 0,
      bodiesSleeping: 0,
      colliders: 0,
      voxels: this.voxelCount(),
      volumes: this.volumes.size,
      meshJobs: this.sink?.inFlight ?? 0,
      particles: 0,
    };
  }
}
