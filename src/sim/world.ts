/**
 * Simulation-side world state: every VoxelVolume with its transform and rigid body, the shared palette,
 * collider sync, explosives, sleeping/budget management, particles, ground and mesh dispatch.
 * Pure TypeScript with no worker globals, so it also runs in Node tests.
 */
import type { Params } from '../config/params.ts';
import type {
  GroundDesc, MeshJob, PlayerInput, Quat, SimSettings, SimStats, Vec3, VolumeInfo, VolumeKind,
} from '../shared/protocol.ts';
import { MAX_SLOTS, PLAYER_SLOT, SLOT_FLOATS } from '../shared/transforms.ts';
import { mergeBoxes, mergeBoxesCoarse, type VoxelBox } from '../voxel/boxes.ts';
import { CHUNK_SIZE, VOXEL_SIZE } from '../voxel/constants.ts';
import { MATERIALS } from '../voxel/materials.ts';
import { Palette } from '../voxel/palette.ts';
import { VoxelVolume } from '../voxel/volume.ts';
import { readVox } from '../voxel/vox.ts';
import { blast, carve } from './destruction.ts';
import type { MeshSink } from './mesh-dispatch.ts';
import type { BodyOptions, BoxShape, PhysicsBackend } from './physics/backend.ts';
import { IDLE_INPUT, Player } from './player.ts';
import type { SceneContext } from './scene-api.ts';
import { Structures } from './structures.ts';
import { voxAsset } from './vox-asset.ts';

export type VolumeTag = 'scene' | 'crate' | 'debris' | 'vehicle' | 'prop' | 'projectile';

const VOXEL_M3 = VOXEL_SIZE * VOXEL_SIZE * VOXEL_SIZE;
/** Dynamic bodies with more boxes than this fall back to coarser collider approximations. */
const MAX_BODY_BOXES = 48;
const SLEEP_LIN2 = 0.1 * 0.1;
const SLEEP_ANG2 = 0.15 * 0.15;
const SLEEP_AFTER_STEPS = 30;
const KILL_Y = -25;
/** Velocity change in one step that detonates an explosive body. */
const EXPLOSIVE_IMPACT_DV = 3.2;
/** Particle record: px py pz vx vy vz r g b kind. */
export const PARTICLE_FLOATS = 10;
export const PARTICLE_DEBRIS = 0;
export const PARTICLE_SMOKE = 1;
export const PARTICLE_FIRE = 2;

export interface VolumeOptions {
  velocity?: { lin: Vec3; ang: Vec3 };
  /** false → no rigid body or colliders (visual only). Default true. */
  collide?: boolean;
  /** Replaces voxel-derived colliders (e.g. a vehicle chassis box). */
  colliders?: BoxShape[];
  /** false → blasts and carving ignore this volume. Default true. */
  destructible?: boolean;
  /** Seconds until the volume crumbles to dust and is removed. */
  lifetime?: number;
  body?: BodyOptions;
  /** Detonates when damaged or (dynamic) hit hard. Default: auto-detected for small volumes. */
  explosive?: boolean;
  castShadow?: boolean;
  userData?: unknown;
}

export interface SimVolume {
  id: number;
  kind: VolumeKind;
  tag: VolumeTag;
  volume: VoxelVolume;
  position: Vec3;
  rotation: Quat;
  slot: number;
  chunkVersions: Uint32Array;
  /** Simulation time (s) when created — the oldest debris is despawned first. */
  createdAt: number;
  body: number;
  /** Static: collider group per chunk. */
  chunkColliders: Map<number, number>;
  /** Dynamic: the body's compound collider group. */
  colliders: number;
  lowSpeedSteps: number;
  destructible: boolean;
  collide: boolean;
  customColliders: boolean;
  explosive: boolean;
  expiresAt: number;
  lastVel: Vec3;
  castShadow: boolean;
  userData: unknown;
}

export interface WorldEventMap {
  volumeAdded: [SimVolume];
  volumeRemoved: [SimVolume];
  /** Voxels were carved from a volume (count, world centroid of the removed voxels). */
  carved: [SimVolume, number, Vec3];
  explosion: [Vec3, number, number];
}

export interface SimEvents {
  volumeAdded(info: VolumeInfo): void;
  volumeRemoved(id: number): void;
  status?(text: string): void;
  ground?(ground: GroundDesc): void;
  /** Message for the main-thread game client. */
  game?(data: unknown, transfer?: Transferable[]): void;
}

export const DEFAULT_SETTINGS: SimSettings = {
  gravity: -9.81,
  blastRadius: 1.2,
  blastPower: 1.5,
  strengthScale: 1,
  maxBodies: 150,
  particleThreshold: 6,
};

interface PendingExplosion {
  at: number;
  center: Vec3;
  radius: number;
  power: number;
}

export class SimWorld {
  readonly params: Params;
  readonly palette = new Palette();
  readonly volumes = new Map<number, SimVolume>();
  readonly physics: PhysicsBackend | null;
  readonly settings: SimSettings;
  readonly structures: Structures;
  /** Palette indices used for spawned crates (reserved before the scene builds). */
  readonly crateColors: number[];
  spawn: Vec3 = [0, 2, 0];
  spawnYaw = 0;
  blastTarget: Vec3 = [0, 1, 0];
  time = 0;
  player: Player | null = null;
  input: PlayerInput = IDLE_INPUT;
  ground: GroundDesc | null = null;
  /** Seconds debris broken off by carving lives (null = until the body budget removes it). */
  debrisLifetime: number | null = null;
  /** Game hooks bound by the worker: run before / after each physics step. */
  scenePreStep: ((dt: number) => void) | null = null;
  sceneUpdate: ((dt: number) => void) | null = null;
  private context: SceneContext | null = null;
  private readonly sink: MeshSink | null;
  private readonly events: SimEvents;
  private readonly listeners: { [K in keyof WorldEventMap]?: ((...args: WorldEventMap[K]) => void)[] } = {};
  private readonly bodyToVolume = new Map<number, SimVolume>();
  private nextId = 1;
  private rng: number;
  /** FIFO so a freed slot isn't immediately reused (the renderer may still read it for a frame). */
  private readonly freeSlots: number[] = [];
  private readonly explosions: PendingExplosion[] = [];
  private particles: number[] = [];
  private groundBody = -1;
  private steps = 0;
  private stepMsAvg = 0;
  private stepMsPeak = 0;
  private stepMsMaxShown = 0;
  private active = 0;
  private sleeping = 0;

  constructor(params: Params, sink: MeshSink | null, events: SimEvents, physics: PhysicsBackend | null = null, seed = 1337) {
    this.params = params;
    this.sink = sink;
    this.events = events;
    this.physics = physics;
    this.rng = seed;
    this.settings = { ...DEFAULT_SETTINGS, maxBodies: params.maxBodies };
    for (let s = PLAYER_SLOT + 1; s < MAX_SLOTS; s++) this.freeSlots.push(s);
    this.crateColors = [this.palette.add(0x7a4f2a, 'wood'), this.palette.add(0xc28a4a, 'wood'), this.palette.add(0xb07a3e, 'wood')];
    this.structures = new Structures(this);
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof WorldEventMap>(event: K, fn: (...args: WorldEventMap[K]) => void): void {
    ((this.listeners[event] ??= []) as ((...args: WorldEventMap[K]) => void)[]).push(fn);
  }

  emit<K extends keyof WorldEventMap>(event: K, ...args: WorldEventMap[K]): void {
    const list = this.listeners[event] as ((...a: WorldEventMap[K]) => void)[] | undefined;
    if (list) for (const fn of list) fn(...args);
  }

  sendToClient(data: unknown, transfer?: Transferable[]): void {
    this.events.game?.(data, transfer);
  }

  setStatus(text: string): void {
    this.events.status?.(text);
  }

  random(): number {
    // mulberry32
    let t = (this.rng += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  sceneContext(): SceneContext {
    this.context ??= this.createContext();
    return this.context;
  }

  private createContext(): SceneContext {
    return {
      params: this.params,
      palette: this.palette,
      world: this,
      random: () => this.random(),
      addStatic: (volume, position = [0, 0, 0], opts) => this.addVolume('static', volume, position, [0, 0, 0, 1], 'scene', opts).id,
      addDynamic: (volume, position, rotation = [0, 0, 0, 1], opts) => this.addVolume('dynamic', volume, position, rotation, 'scene', opts).id,
      addKinematic: (volume, position, rotation = [0, 0, 0, 1], opts) => this.addVolume('kinematic', volume, position, rotation, 'prop', opts).id,
      setSpawn: (position, yaw = 0) => {
        this.spawn = position;
        this.spawnYaw = yaw;
      },
      setBlastTarget: (position) => {
        this.blastTarget = position;
      },
      loadVox: async (url, defaultMaterial) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`loadVox ${url}: HTTP ${res.status}`);
        return voxAsset(readVox(await res.arrayBuffer()), this.palette, defaultMaterial);
      },
      blast: (center, radius, power) => blast(this, center, undefined, radius, power).newBodies,
      spawnCrate: (origin, dir) => this.spawnCrate(origin, dir).id,
      setStatus: (text) => this.setStatus(text),
      setGround: (ground) => this.setGround(ground),
      send: (data, transfer) => this.sendToClient(data, transfer),
      dynamicBodyCount: () => this.dynamicCount(),
      time: () => this.time,
      playerPosition: () => (this.player ? [...this.player.position] : null),
    };
  }

  /** Creates the player at the scene's spawn point (requires physics). */
  spawnPlayer(): void {
    if (this.physics && !this.player) {
      this.player = new Player(this.physics, this.spawn);
      this.player.gravity = this.settings.gravity;
    }
  }

  get freeSlotCount(): number {
    return this.freeSlots.length;
  }

  // ---------------------------------------------------------------- volumes

  addVolume(kind: VolumeKind, volume: VoxelVolume, position: Vec3, rotation: Quat, tag: VolumeTag, opts: VolumeOptions = {}): SimVolume {
    const slot = kind !== 'static' ? (this.freeSlots.shift() ?? -1) : -1;
    if (kind !== 'static' && slot < 0) throw new Error('Out of transform slots');
    const collide = opts.collide ?? true;
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
      body: -1,
      chunkColliders: new Map(),
      colliders: -1,
      lowSpeedSteps: 0,
      destructible: opts.destructible ?? true,
      collide,
      customColliders: opts.colliders !== undefined,
      explosive: opts.explosive ?? (volume.voxelCount < 20_000 && this.containsExplosive(volume)),
      expiresAt: opts.lifetime !== undefined ? this.time + opts.lifetime : Number.POSITIVE_INFINITY,
      lastVel: [0, 0, 0],
      castShadow: opts.castShadow ?? true,
      userData: opts.userData,
    };
    for (const ci of volume.nonEmptyChunks()) {
      volume.dirtyMesh.add(ci);
      if (collide && !sv.customColliders) volume.dirtyCollider.add(ci);
    }
    this.volumes.set(sv.id, sv);
    if (this.physics && collide) {
      const type = kind === 'static' ? 'fixed' : kind;
      sv.body = this.physics.createBody(type, position, rotation, opts.body);
      this.bodyToVolume.set(sv.body, sv);
      if (opts.colliders) {
        sv.colliders = this.physics.addBoxes(sv.body, opts.colliders);
        volume.dirtyCollider.clear();
      } else if (kind !== 'static') {
        this.rebuildDynamicColliders(sv);
      }
      if (opts.velocity && kind === 'dynamic') {
        this.physics.setVelocity(sv.body, opts.velocity.lin, opts.velocity.ang);
        sv.lastVel = [...opts.velocity.lin];
      }
    } else {
      volume.dirtyCollider.clear();
    }
    this.events.volumeAdded(this.info(sv));
    this.emit('volumeAdded', sv);
    return sv;
  }

  private containsExplosive(volume: VoxelVolume): boolean {
    let found = false;
    const explosive = new Set(MATERIALS.filter((m) => m.explosive).map((m) => m.id));
    if (explosive.size === 0) return false;
    volume.forEachSolid((_x, _y, _z, v) => {
      if (!found && explosive.has(this.palette.materials[v]!)) found = true;
    });
    return found;
  }

  removeVolume(id: number): void {
    const sv = this.volumes.get(id);
    if (!sv) return;
    this.volumes.delete(id);
    if (this.physics && sv.body >= 0) {
      this.bodyToVolume.delete(sv.body);
      this.physics.removeBody(sv.body); // also removes its colliders
    }
    if (sv.slot >= 0) this.freeSlots.push(sv.slot);
    this.events.volumeRemoved(id);
    this.emit('volumeRemoved', sv);
  }

  volumeForBody(body: number): SimVolume | undefined {
    return this.bodyToVolume.get(body);
  }

  info(sv: SimVolume): VolumeInfo {
    const v = sv.volume;
    return {
      id: sv.id,
      kind: sv.kind,
      slot: sv.slot,
      size: [v.sizeX, v.sizeY, v.sizeZ],
      position: sv.position,
      rotation: sv.rotation,
      castShadow: sv.castShadow,
    };
  }

  /** Current world pose of a volume's voxel-grid origin. */
  volumePose(sv: SimVolume): { pos: Vec3; rot: Quat } {
    if (sv.kind === 'dynamic' && this.physics && sv.body >= 0) {
      const t = scratchPose;
      this.physics.readTransform(sv.body, t, 0);
      return { pos: [t[0]!, t[1]!, t[2]!], rot: [t[3]!, t[4]!, t[5]!, t[6]!] };
    }
    return { pos: sv.position, rot: sv.rotation };
  }

  /** Moves a kinematic volume (its body, if any, reaches the pose at the end of the next step). */
  setKinematicPose(id: number, position: Vec3, rotation: Quat): void {
    const sv = this.volumes.get(id);
    if (!sv || sv.kind !== 'kinematic') return;
    sv.position = [...position];
    sv.rotation = [...rotation];
    if (this.physics && sv.body >= 0) this.physics.setKinematicTarget(sv.body, position, rotation);
  }

  // ---------------------------------------------------------------- ground

  setGround(ground: GroundDesc): void {
    this.ground = ground;
    if (this.physics) {
      if (this.groundBody >= 0) this.physics.removeBody(this.groundBody);
      this.groundBody = this.physics.createBody('fixed', [0, 0, 0], [0, 0, 0, 1]);
      const boxes: BoxShape[] = ground.slabs.map((s) => {
        const depth = s.depth ?? 2;
        return {
          cx: (s.x0 + s.x1) / 2,
          cy: s.y - depth / 2,
          cz: (s.z0 + s.z1) / 2,
          hx: Math.abs(s.x1 - s.x0) / 2,
          hy: depth / 2,
          hz: Math.abs(s.z1 - s.z0) / 2,
          density: 1000,
          friction: 0.9,
          restitution: 0.02,
        };
      });
      if (boxes.length) this.physics.addBoxes(this.groundBody, boxes);
    }
    this.events.ground?.(ground);
  }

  /** Top of the ground slab under (x, z), or -Infinity over a hole. */
  groundHeight(x: number, z: number): number {
    if (!this.ground) return 0;
    let h = Number.NEGATIVE_INFINITY;
    for (const s of this.ground.slabs) {
      if (x >= Math.min(s.x0, s.x1) && x <= Math.max(s.x0, s.x1) && z >= Math.min(s.z0, s.z1) && z <= Math.max(s.z0, s.z1)) h = Math.max(h, s.y);
    }
    return h;
  }

  // ---------------------------------------------------------------- colliders

  private boxShapes(sv: SimVolume, boxes: VoxelBox[], perMaterial: boolean): BoxShape[] {
    const vol = sv.volume;
    return boxes.map((b) => {
      const dx = b.x1 - b.x0, dy = b.y1 - b.y0, dz = b.z1 - b.z0;
      let density = 1000, friction = 0.8, restitution = 0.05;
      if (perMaterial) {
        const m = MATERIALS[b.key - 1]!;
        density = m.density;
        friction = m.friction;
        restitution = m.restitution;
      } else if (sv.kind === 'dynamic') {
        // Mixed or approximated box: exact mass from the voxels it actually contains.
        let mass = 0;
        for (let z = b.z0; z < b.z1; z++)
          for (let y = b.y0; y < b.y1; y++)
            for (let x = b.x0; x < b.x1; x++) {
              const v = vol.get(x, y, z);
              if (v) mass += this.palette.material(v).density * VOXEL_M3;
            }
        density = Math.max(1, mass / (dx * dy * dz * VOXEL_M3));
        friction = 0.7;
        restitution = 0.08;
      }
      return {
        hx: (dx * VOXEL_SIZE) / 2,
        hy: (dy * VOXEL_SIZE) / 2,
        hz: (dz * VOXEL_SIZE) / 2,
        cx: (b.x0 + dx / 2) * VOXEL_SIZE,
        cy: (b.y0 + dy / 2) * VOXEL_SIZE,
        cz: (b.z0 + dz / 2) * VOXEL_SIZE,
        density,
        friction,
        restitution,
      };
    });
  }

  /** One compound collider per dynamic body; mass = Σ voxels × material density. */
  rebuildDynamicColliders(sv: SimVolume): void {
    if (!this.physics || sv.body < 0 || sv.customColliders) return;
    const vol = sv.volume;
    if (sv.colliders >= 0) this.physics.removeColliders(sv.colliders);
    const materialKey = (v: number) => this.palette.materials[v]! + 1;
    let boxes = mergeBoxes(vol, 0, 0, 0, vol.sizeX, vol.sizeY, vol.sizeZ, materialKey);
    let perMaterial = true;
    if (boxes.length > MAX_BODY_BOXES) {
      boxes = mergeBoxes(vol, 0, 0, 0, vol.sizeX, vol.sizeY, vol.sizeZ);
      perMaterial = false;
    }
    for (let f = 2; boxes.length > MAX_BODY_BOXES * 2 && f <= 16; f *= 2) boxes = mergeBoxesCoarse(vol, f);
    sv.colliders = this.physics.addBoxes(sv.body, this.boxShapes(sv, boxes, perMaterial));
    vol.dirtyCollider.clear();
  }

  /** Rebuilds colliders for chunks that changed: per chunk for static volumes, per body otherwise. */
  syncColliders(): void {
    if (!this.physics) return;
    for (const sv of this.volumes.values()) {
      const vol = sv.volume;
      if (vol.dirtyCollider.size === 0) continue;
      if (sv.body < 0 || sv.customColliders) {
        vol.dirtyCollider.clear();
        continue;
      }
      if (sv.kind !== 'static') {
        this.rebuildDynamicColliders(sv);
        continue;
      }
      for (const ci of vol.dirtyCollider) {
        const old = sv.chunkColliders.get(ci);
        if (old !== undefined) this.physics.removeColliders(old);
        sv.chunkColliders.delete(ci);
        if (!vol.chunks[ci]) continue;
        const [cxi, cyi, czi] = vol.chunkCoords(ci);
        const x0 = cxi * CHUNK_SIZE, y0 = cyi * CHUNK_SIZE, z0 = czi * CHUNK_SIZE;
        const boxes = mergeBoxes(vol, x0, y0, z0, Math.min(vol.sizeX, x0 + CHUNK_SIZE), Math.min(vol.sizeY, y0 + CHUNK_SIZE), Math.min(vol.sizeZ, z0 + CHUNK_SIZE));
        if (boxes.length) sv.chunkColliders.set(ci, this.physics.addBoxes(sv.body, this.boxShapes(sv, boxes, false)));
      }
      vol.dirtyCollider.clear();
    }
  }

  // ---------------------------------------------------------------- particles & explosions

  emitParticle(p: Vec3, v: Vec3, rgb: readonly [number, number, number], kind = PARTICLE_DEBRIS): void {
    if (this.particles.length > PARTICLE_FLOATS * 1500) return;
    this.particles.push(p[0], p[1], p[2], v[0], v[1], v[2], rgb[0], rgb[1], rgb[2], kind);
  }

  /** Particle records queued since the last call (the worker ships them to the renderer). */
  takeParticles(): Float32Array | null {
    if (this.particles.length === 0) return null;
    const out = new Float32Array(this.particles);
    this.particles = [];
    return out;
  }

  /** A puff of smoke/dust around a point. */
  emitSmoke(center: Vec3, count: number, spread: number, rgb: readonly [number, number, number] = [0.62, 0.6, 0.56]): void {
    for (let i = 0; i < count; i++) {
      const r = () => (this.random() - 0.5) * 2;
      this.emitParticle(
        [center[0] + r() * spread, center[1] + this.random() * spread * 0.5, center[2] + r() * spread],
        [r() * 1.2, 0.6 + this.random() * 1.2, r() * 1.2],
        [rgb[0] * (0.9 + this.random() * 0.2), rgb[1] * (0.9 + this.random() * 0.2), rgb[2] * (0.9 + this.random() * 0.2)],
        PARTICLE_SMOKE,
      );
    }
  }

  /** Queues a detonation (chains through other explosives with a short delay). */
  scheduleExplosion(center: Vec3, radius: number, power: number, delay = 0.12): void {
    this.explosions.push({ at: this.time + delay, center: [...center], radius, power });
  }

  private processExplosions(): void {
    if (this.explosions.length === 0) return;
    const due = this.explosions.filter((e) => e.at <= this.time);
    if (due.length === 0) return;
    const later = this.explosions.filter((e) => e.at > this.time);
    this.explosions.length = 0;
    this.explosions.push(...later);
    for (const e of due) this.detonate(e.center, e.radius, e.power);
  }

  /** Fireball + carve + shockwave. */
  detonate(center: Vec3, radius: number, power: number): void {
    for (let i = 0; i < 26; i++) {
      const a = this.random() * Math.PI * 2, u = this.random() * 2 - 1, s = 3 + this.random() * 6;
      const k = Math.sqrt(1 - u * u);
      this.emitParticle(center, [Math.cos(a) * k * s, Math.abs(u) * s + 2, Math.sin(a) * k * s], [1, 0.45 + this.random() * 0.4, 0.1], PARTICLE_FIRE);
    }
    this.emitSmoke(center, 18, radius * 0.6, [0.35, 0.33, 0.32]);
    carve(this, { kind: 'sphere', center, radius }, power);
    this.emit('explosion', center, radius, power);
  }

  /** Detonates an explosive volume (removed) at its center. */
  explodeVolume(sv: SimVolume, delay = 0.12): void {
    if (!this.volumes.has(sv.id)) return;
    const { pos, rot } = this.volumePose(sv);
    const v = sv.volume;
    const center = rotateAdd(pos, rot, [(v.sizeX * VOXEL_SIZE) / 2, (v.sizeY * VOXEL_SIZE) / 2, (v.sizeZ * VOXEL_SIZE) / 2]);
    const ex = MATERIALS.find((m) => m.explosive)!.explosive!;
    this.removeVolume(sv.id);
    this.scheduleExplosion(center, ex.radius, ex.power, delay);
  }

  // ---------------------------------------------------------------- simulation

  applySettings(s: Partial<SimSettings>): void {
    Object.assign(this.settings, s);
    if (s.gravity !== undefined) {
      this.physics?.setGravity(s.gravity);
      if (this.player) this.player.gravity = s.gravity;
    }
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.syncColliders();
    if (this.physics) {
      this.scenePreStep?.(dt);
      this.player?.update(dt, this.input);
      this.physics.step(dt);
    }
    this.time += dt;
    this.sceneUpdate?.(dt);
    this.processExplosions();
    if (this.physics) {
      this.manageBodies();
      this.enforceBudget();
    }
    this.steps++;
    const ms = performance.now() - t0;
    this.stepMsAvg = this.steps === 1 ? ms : this.stepMsAvg * 0.95 + ms * 0.05;
    this.stepMsPeak = Math.max(this.stepMsPeak, ms);
    if (this.steps % 60 === 0) {
      this.stepMsMaxShown = this.stepMsPeak;
      this.stepMsPeak = 0;
    }
  }

  /** Sleeping, explosive impacts, debris lifetimes and kill-plane cleanup. */
  private manageBodies(): void {
    const physics = this.physics!;
    let active = 0, sleeping = 0;
    const doomed: SimVolume[] = [];
    const expired: SimVolume[] = [];
    for (const sv of this.volumes.values()) {
      if (this.time >= sv.expiresAt) {
        expired.push(sv);
        continue;
      }
      if (sv.kind !== 'dynamic' || sv.body < 0) continue;
      if (physics.isSleeping(sv.body)) {
        sleeping++;
        sv.lowSpeedSteps = 0;
        sv.lastVel = [0, 0, 0];
        continue;
      }
      active++;
      const v = physics.linvel(sv.body);
      if (sv.explosive) {
        const dv = Math.hypot(v[0] - sv.lastVel[0], v[1] - sv.lastVel[1], v[2] - sv.lastVel[2]);
        if (dv > EXPLOSIVE_IMPACT_DV) doomed.push(sv);
      }
      sv.lastVel = v;
      const w = physics.angvel(sv.body);
      if (sv.tag !== 'vehicle' && v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < SLEEP_LIN2 && w[0] * w[0] + w[1] * w[1] + w[2] * w[2] < SLEEP_ANG2) {
        if (++sv.lowSpeedSteps > SLEEP_AFTER_STEPS) physics.sleep(sv.body);
      } else {
        sv.lowSpeedSteps = 0;
      }
      if (physics.centerOfMass(sv.body)[1] < KILL_Y && sv.tag !== 'vehicle') expired.push(sv);
    }
    for (const sv of doomed) this.explodeVolume(sv, 0);
    for (const sv of expired) this.crumble(sv);
    this.active = active;
    this.sleeping = sleeping;
  }

  /** Removes a volume with a dust puff. */
  crumble(sv: SimVolume): void {
    if (!this.volumes.has(sv.id)) return;
    const { pos, rot } = this.volumePose(sv);
    const v = sv.volume;
    const center = rotateAdd(pos, rot, [(v.sizeX * VOXEL_SIZE) / 2, (v.sizeY * VOXEL_SIZE) / 2, (v.sizeZ * VOXEL_SIZE) / 2]);
    if (center[1] > KILL_Y) {
      const size = Math.max(v.sizeX, v.sizeY, v.sizeZ) * VOXEL_SIZE;
      this.emitSmoke(center, Math.min(10, 2 + Math.round(size * 2)), size * 0.4);
    }
    this.removeVolume(sv.id);
  }

  /** Despawns the oldest debris (then oldest crates, then oldest scene bodies) above the body cap. */
  enforceBudget(): number {
    const rank: Partial<Record<VolumeTag, number>> = { debris: 0, crate: 1, scene: 2 };
    const dynamic = [...this.volumes.values()].filter((v) => v.kind === 'dynamic' && rank[v.tag] !== undefined);
    let excess = dynamic.length - this.settings.maxBodies;
    if (excess <= 0) return 0;
    dynamic.sort((a, b) => rank[a.tag]! - rank[b.tag]! || a.createdAt - b.createdAt || a.id - b.id);
    let removed = 0;
    for (const sv of dynamic) {
      if (excess-- <= 0) break;
      this.crumble(sv);
      removed++;
    }
    return removed;
  }

  dynamicCount(): number {
    let n = 0;
    for (const sv of this.volumes.values()) if (sv.kind === 'dynamic') n++;
    return n;
  }

  /** Throws a 5×5×5 wooden crate from `origin` along `dir`. */
  spawnCrate(origin: Vec3, dir: Vec3): SimVolume {
    const n = 5;
    const crate = new VoxelVolume(n, n, n);
    const [dark, light, mid] = this.crateColors as [number, number, number];
    crate.fillBox(0, 0, 0, n, n, n, (x, y, z) => {
      const edges = (x === 0 || x === n - 1 ? 1 : 0) + (y === 0 || y === n - 1 ? 1 : 0) + (z === 0 || z === n - 1 ? 1 : 0);
      return edges >= 2 ? dark : y % 2 ? light : mid;
    });
    const half = (n * VOXEL_SIZE) / 2;
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    const pos: Vec3 = [origin[0] + d[0] * 1.2 - half, origin[1] + d[1] * 1.2 - half, origin[2] + d[2] * 1.2 - half];
    return this.addVolume('dynamic', crate, pos, [0, 0, 0, 1], 'crate', {
      velocity: {
        lin: [d[0] * 6, d[1] * 6 + 1.5, d[2] * 6],
        ang: [this.random() - 0.5, this.random() - 0.5, this.random() - 0.5],
      },
    });
  }

  /** Writes the player (slot 0) and every moving volume; returns the number of floats used. */
  writeTransforms(out: Float32Array): number {
    let maxSlot = PLAYER_SLOT;
    if (this.player) {
      const p = this.player.position;
      out.set([p[0], p[1], p[2], 0, 0, 0, 1], PLAYER_SLOT * SLOT_FLOATS);
    }
    for (const sv of this.volumes.values()) {
      if (sv.slot < 0) continue;
      const o = sv.slot * SLOT_FLOATS;
      if (this.physics && sv.body >= 0 && sv.kind === 'dynamic') this.physics.readTransform(sv.body, out, o);
      else out.set([...sv.position, ...sv.rotation], o);
      if (sv.slot > maxSlot) maxSlot = sv.slot;
    }
    return (maxSlot + 1) * SLOT_FLOATS;
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
          const job: MeshJob = {
            type: 'mesh',
            volumeId: sv.id,
            chunk: ci,
            version: ++sv.chunkVersions[ci]!,
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

  stats(): SimStats {
    return {
      stepMs: this.stepMsAvg,
      stepMsMax: this.stepMsMaxShown,
      steps: this.steps,
      dynamicBodies: this.dynamicCount(),
      bodiesActive: this.active,
      bodiesSleeping: this.sleeping,
      colliders: this.physics?.colliderCount() ?? 0,
      voxels: this.voxelCount(),
      volumes: this.volumes.size,
      meshJobs: this.sink?.inFlight ?? 0,
      particles: 0,
    };
  }
}

const scratchPose = new Float32Array(SLOT_FLOATS);

export function rotateAdd(pos: Vec3, q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    pos[0] + v[0] + qw * tx + (qy * tz - qz * ty),
    pos[1] + v[1] + qw * ty + (qz * tx - qx * tz),
    pos[2] + v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}
