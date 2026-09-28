/**
 * The API scenes and games are written against (runs inside the simulation worker).
 * See docs/ENGINE.md for a guide. Coordinates are meters unless a name says "voxels".
 */
import type { Params } from '../config/params.ts';
import type { GroundDesc, Quat, Vec3 } from '../shared/protocol.ts';
import type { MaterialName } from '../voxel/materials.ts';
import type { Palette } from '../voxel/palette.ts';
import type { VoxelVolume } from '../voxel/volume.ts';
import type { VoxAsset } from './vox-asset.ts';
import type { SimWorld, VolumeOptions } from './world.ts';

export interface SceneContext {
  readonly params: Params;
  /** Shared 255-entry palette: add colors + materials here before filling volumes. */
  readonly palette: Palette;
  /**
   * Engine internals for games that need more than this interface: volumes, physics backend, structures
   * (world.structures), explosions (world.scheduleExplosion), particles (world.emitParticle), events
   * (world.on('carved' | 'explosion' | 'volumeAdded' | 'volumeRemoved')).
   */
  readonly world: SimWorld;
  /** Seeded PRNG in [0, 1) — scenes must use this (not Math.random) to stay deterministic. */
  random(): number;
  /**
   * Adds an immovable, destructible volume. Its bottom layer (voxel y = 0) is the anchor: after a blast,
   * voxels no longer connected to it break off as dynamic bodies.
   * @param position world position of the voxel-grid origin (corner of voxel 0,0,0)
   */
  addStatic(volume: VoxelVolume, position?: Vec3, opts?: VolumeOptions): number;
  /** Adds a free rigid body made of voxels. `position` is the voxel-grid origin. */
  addDynamic(volume: VoxelVolume, position: Vec3, rotation?: Quat, opts?: VolumeOptions): number;
  /** Adds a volume moved by game code (world.setKinematicPose); it pushes dynamic bodies if it collides. */
  addKinematic(volume: VoxelVolume, position: Vec3, rotation?: Quat, opts?: VolumeOptions): number;
  /** Where the player starts and which way they face (radians, 0 = looking down -Z). */
  setSpawn(position: Vec3, yaw?: number): void;
  /** Default target for window.__engine.triggerBlast() and bench mode. */
  setBlastTarget(position: Vec3): void;
  /** Fetches and parses a MagicaVoxel file (e.g. '/vox/crate.vox'), binding its colors to the palette. */
  loadVox(url: string, defaultMaterial?: MaterialName): Promise<VoxAsset>;
  /** Large flat terrain (colliders + textured render) — far cheaper than voxel ground for big levels. */
  setGround(ground: GroundDesc): void;
  /** Sends a message to the scene's main-thread game client. */
  send(data: unknown, transfer?: Transferable[]): void;

  // ---- game-rule helpers (usable from build() and update()) ----
  /** Carves a sphere (m) at a world position; returns how many new bodies broke off. */
  blast(center: Vec3, radius?: number, power?: number): number;
  /** Throws a crate from `origin` along `dir`; returns its volume id. */
  spawnCrate(origin: Vec3, dir: Vec3): number;
  /** Shows a line of game text at the top of the screen ('' hides it). */
  setStatus(text: string): void;
  dynamicBodyCount(): number;
  /** Seconds of simulated time. */
  time(): number;
  /** Player capsule center, or null before the player spawns. */
  playerPosition(): Vec3 | null;
}

export interface SceneDef {
  name: string;
  description: string;
  /** Builds the level. May be async (e.g. to load .vox assets). */
  build(ctx: SceneContext): void | Promise<void>;
  /** Optional game rules run every fixed 60 Hz step before physics (drive vehicles, move kinematics). */
  preStep?(ctx: SceneContext, dt: number): void;
  /** Optional game rules, called every fixed 60 Hz step after physics. */
  update?(ctx: SceneContext, dt: number): void;
  /** Messages from the scene's main-thread game client. */
  onMessage?(ctx: SceneContext, data: unknown): void;
  /** Spawn the engine's first-person walker at the spawn point (default true). */
  player?: boolean;
}
