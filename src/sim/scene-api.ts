/**
 * The API scenes and games are written against (runs inside the simulation worker).
 * See docs/ENGINE.md for a guide. Coordinates are meters unless a name says "voxels".
 */
import type { Params } from '../config/params.ts';
import type { Quat, Vec3 } from '../shared/protocol.ts';
import type { Palette } from '../voxel/palette.ts';
import type { VoxelVolume } from '../voxel/volume.ts';

export interface SceneContext {
  readonly params: Params;
  /** Shared 255-entry palette: add colors + materials here before filling volumes. */
  readonly palette: Palette;
  /** Seeded PRNG in [0, 1) — scenes must use this (not Math.random) to stay deterministic. */
  random(): number;
  /**
   * Adds an immovable, destructible volume. Its bottom layer (voxel y = 0) is the anchor: after a blast,
   * voxels no longer connected to it break off as dynamic bodies.
   * @param position world position of the voxel-grid origin (corner of voxel 0,0,0)
   */
  addStatic(volume: VoxelVolume, position?: Vec3): number;
  /** Adds a free rigid body made of voxels. `position` is the voxel-grid origin. */
  addDynamic(volume: VoxelVolume, position: Vec3, rotation?: Quat): number;
  /** Where the player starts and which way they face (radians, 0 = looking down -Z). */
  setSpawn(position: Vec3, yaw?: number): void;
  /** Default target for window.__engine.triggerBlast() and bench mode. */
  setBlastTarget(position: Vec3): void;
}

export interface SceneDef {
  name: string;
  description: string;
  build(ctx: SceneContext): void;
}
