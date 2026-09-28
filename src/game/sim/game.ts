/**
 * PATHBREAKERS rules (simulation worker): mission state machine, input → walker/vehicles, the carrier,
 * gaps, TNT fuses, pickups (RDUs, survivors, dishes, ammo), missiles, scoring and medals. Talks to the
 * main-thread client only through SimMessage / ClientMessage (src/game/shared/types.ts).
 */
import type { Vec3 } from '../../shared/protocol.ts';
import { add, length, scale, sub } from '../../shared/math.ts';
import type { SceneContext } from '../../sim/scene-api.ts';
import type { SimVolume, SimWorld } from '../../sim/world.ts';
import { VoxelVolume } from '../../voxel/volume.ts';
import type {
  ClientMessage, GameEvent, GameInput, GameSnapshot, GapInfo, LevelId, LevelStatic, Medal, MissionResults,
  MissionState, ModeId, StructureInfo, VehicleKind, XYZ,
} from '../shared/types.ts';
import { VEHICLE_NAMES } from '../shared/types.ts';
import { PROP_DIMS, buildBuilding, buildProp, color, createArtKit, type ArtKit, type BuildingKind, type BuildingOptions, type PropKind, type PropOptions } from './art/index.ts';
import { Carrier } from './carrier.ts';
import { GroundPainter } from './ground-paint.ts';
import { Bike, Mech, Train, Vehicle, spawnVehicle, type DriveIntent, type VehicleHooks } from './vehicles.ts';
import { placeModel, VS, yawOfDir, yawQuat } from './util.ts';

export interface LevelDef {
  id: LevelId;
  title: string;
  subtitle: string;
  briefing: string[];
  tips: string[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
  lane: { x0: number; x1: number; z: number; width: number; speed: number } | null;
  medalTimes: Record<Medal, number> | null;
  timeAttackTimes: Record<Medal, number> | null;
  /** Radio lines keyed by trigger name (see triggers in the game). */
  radio: Partial<Record<string, string>>;
  build(b: LevelBuilder): void;
}

interface StructMeta {
  info: StructureInfo;
  sv: SimVolume;
  destroyed: boolean;
  target: boolean;
}

interface GapDef {
  info: GapInfo;
  filled: () => boolean;
  /** Pits stay filled once a block settles in. */
  latched: boolean;
}

interface Tnt {
  sv: SimVolume;
  rest: Vec3;
  fuse: number;
}

interface Missile {
  sv: SimVolume;
  pos: Vec3;
  vel: Vec3;
  life: number;
  owner: number;
}

const IDLE: GameInput = { move: [0, 0], camYaw: 0, relative: false, lookYaw: 0, lookPitch: 0, jump: false, action: false, sprint: false, actionCount: 0, jumpCount: 0, enter: 0, reset: 0 };

/** Level construction API used by level scripts. */
export class LevelBuilder {
  readonly game: PathbreakersGame;
  readonly ground: GroundPainter;
  readonly kit: ArtKit;

  constructor(game: PathbreakersGame, bounds: LevelDef['bounds']) {
    this.game = game;
    this.ground = new GroundPainter(bounds);
    this.kit = game.kit;
  }

  get world(): SimWorld {
    return this.game.world;
  }

  /** A destructible building (a structure with integrity). Returns its volume id. */
  building(kind: BuildingKind, x: number, z: number, o: BuildingOptions & { yaw?: number; name?: string; value?: number; survivor?: boolean; collapseAt?: number; fragments?: number; target?: boolean } = {}): number {
    const model = buildBuilding(kind, this.kit, o);
    const y = Math.max(0, this.world.groundHeight(x, z));
    const { pos, rot } = placeModel([model.sizeX, model.sizeY, model.sizeZ], x, y === Number.NEGATIVE_INFINITY ? 0 : y, z, o.yaw ?? 0);
    const sv = this.world.addVolume('static', model, pos, rot, 'scene', { explosive: kind === 'pump' });
    const s = this.world.structures.register(sv.id, { collapseAt: o.collapseAt ?? (kind === 'office' ? 0.22 : 0.3), fragments: o.fragments ?? (kind === 'office' ? 16 : 9), debrisLifetime: 7 });
    const fp = s.footprint;
    const info: StructureInfo = {
      id: sv.id,
      name: o.name ?? kind.toUpperCase(),
      x: (fp.x0 + fp.x1) / 2,
      z: (fp.z0 + fp.z1) / 2,
      w: fp.x1 - fp.x0,
      d: fp.z1 - fp.z0,
      h: model.sizeY * VS,
      value: o.value ?? Math.round((model.voxelCount * 2.5) / 1000) * 1000,
      inLane: false,
      survivor: !!o.survivor,
    };
    this.game.structs.set(sv.id, { info, sv, destroyed: false, target: !!o.target });
    return sv.id;
  }

  /** A static prop; `crushable` props are flattened by the carrier and never count as obstacles. */
  prop(kind: PropKind, x: number, z: number, o: PropOptions & { yaw?: number; y?: number; crushable?: boolean; solid?: boolean } = {}): SimVolume {
    const model = buildProp(kind, this.kit, o);
    const ground = this.world.groundHeight(x, z);
    const y = o.y ?? (Number.isFinite(ground) ? ground : 0);
    const { pos, rot } = placeModel([model.sizeX, model.sizeY, model.sizeZ], x, y, z, o.yaw ?? 0);
    const destructible = !['mound', 'ramp', 'track', 'loadingRamp', 'safePad', 'block'].includes(kind);
    const sv = this.world.addVolume('static', model, pos, rot, 'scene', { destructible, collide: o.solid ?? kind !== 'safePad', userData: { crushable: !!o.crushable } });
    if (o.crushable) this.game.crushables.add(sv.id);
    return sv;
  }

  tnt(x: number, z: number, y?: number): void {
    const model = buildProp('tnt', this.kit);
    const g = y ?? Math.max(0, this.world.groundHeight(x, z));
    const { pos, rot } = placeModel(PROP_DIMS.tnt, x, g + 0.01, z);
    const sv = this.world.addVolume('dynamic', model, pos, rot, 'prop', { explosive: true, body: { angularDamping: 0.6 } });
    this.game.tnts.push({ sv, rest: [...pos], fuse: -1 });
  }

  block(x: number, z: number): void {
    const model = buildProp('block', this.kit);
    const { pos, rot } = placeModel(PROP_DIMS.block, x, 0.01, z);
    // Looks like concrete, pushes like a crate: light enough for PLOWHORSE.
    const sv = this.world.addVolume('dynamic', model, pos, rot, 'prop', { destructible: false, massScale: 0.05, body: { angularDamping: 0.8, linearDamping: 0.3 } });
    this.game.blocks.push(sv);
  }

  rdu(x: number, z: number, y?: number): void {
    const g = y ?? Math.max(0, this.world.groundHeight(x, z));
    this.game.rdus.push({ pos: [x, g, z], lit: false });
  }

  /** A satellite dish (optionally on a building's roof: it drops to the ground if that building falls). */
  dish(x: number, z: number, y?: number, host?: number): void {
    const model = buildProp('dish', this.kit);
    const g = y ?? Math.max(0, this.world.groundHeight(x, z));
    const { pos, rot } = placeModel([model.sizeX, model.sizeY, model.sizeZ], x, g, z);
    const sv = this.world.addVolume('static', model, pos, rot, 'scene', { destructible: false });
    this.game.dishes.push({ pos: [x, g + 1, z], found: false, sv, host: host ?? -1 });
  }

  ammo(x: number, z: number): void {
    const model = buildProp('ammo', this.kit);
    const g = Math.max(0, this.world.groundHeight(x, z));
    const { pos, rot } = placeModel(PROP_DIMS.ammo, x, g, z);
    const sv = this.world.addVolume('kinematic', model, pos, rot, 'prop', { collide: false, destructible: false });
    this.game.ammo.push({ sv, home: pos, respawn: 0 });
  }

  vehicle(kind: VehicleKind, x: number, z: number, yaw: number, extra?: { track?: { x: number; y: number; z0: number; z1: number }; s?: number }): Vehicle {
    const v = spawnVehicle(this.game.hooks, this.kit, kind, x, z, yaw, extra);
    this.game.vehicles.push(v);
    return v;
  }

  /** A gap in the lane the carrier can't cross unless `filled()` is true. */
  gap(kind: 'rail' | 'pit', x0: number, x1: number, z0: number, z1: number, filled?: () => boolean): void {
    const info: GapInfo = { id: this.game.gaps.length + 1, kind, x0, x1, z0, z1 };
    const g: GapDef = { info, latched: false, filled: filled ?? (() => false) };
    if (!filled) {
      // Pits: filled by a concrete block resting inside.
      g.filled = () => {
        if (g.latched) return true;
        for (const b of this.game.blocks) {
          if (!this.world.volumes.has(b.id)) continue;
          const c = this.world.physics!.centerOfMass(b.body);
          if (c[0] > x0 - 0.3 && c[0] < x1 + 0.3 && c[2] > z0 - 0.3 && c[2] < z1 + 0.3 && c[1] < 0.25) {
            g.latched = true;
            this.world.physics!.sleep(b.body);
            this.game.emit({ e: 'gapFilled', id: info.id });
            this.game.radio('gapFilled');
            return true;
          }
        }
        return false;
      };
    }
    this.game.gaps.push(g);
  }

  spawn(x: number, z: number, yaw: number): void {
    this.world.spawn = [x, Math.max(0, this.world.groundHeight(x, z)), z];
    this.world.spawnYaw = yaw;
  }
}

export class PathbreakersGame {
  readonly ctx: SceneContext;
  readonly world: SimWorld;
  readonly kit: ArtKit;
  readonly level: LevelDef;
  readonly hooks: VehicleHooks;
  state: MissionState = 'loading';
  mode: ModeId = 'mission';
  time = 0;
  stateTime = 0;
  carrier: Carrier | null = null;
  readonly vehicles: Vehicle[] = [];
  controlled: Vehicle | null = null;
  readonly structs = new Map<number, StructMeta>();
  readonly gaps: GapDef[] = [];
  readonly tnts: Tnt[] = [];
  readonly blocks: SimVolume[] = [];
  readonly rdus: { pos: Vec3; lit: boolean }[] = [];
  readonly dishes: { pos: Vec3; found: boolean; sv: SimVolume; host: number }[] = [];
  readonly survivors: { pos: Vec3; state: 'hidden' | 'waiting' | 'rescued'; structure: number }[] = [];
  readonly ammo: { sv: SimVolume; home: Vec3; respawn: number }[] = [];
  readonly crushables = new Set<number>();
  private readonly missiles: Missile[] = [];
  private events: GameEvent[] = [];
  private input: GameInput = IDLE;
  private seen = { enter: 0, reset: 0, action: 0, jump: 0 };
  private snapTimer = 0;
  private damage = 0;
  private radioDone = new Set<string>();
  private warned = new Map<number, number>();
  private pilot: SimVolume | null = null;
  private pilotYaw = 0;
  private lastHitEvent = 0;
  private failReason = '';
  private resultsSent = false;
  private staticInfo: LevelStatic | null = null;
  private forceGaps = false;
  private assist = true;
  private walkerParked = false;

  constructor(ctx: SceneContext, level: LevelDef) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.level = level;
    this.kit = createArtKit(ctx.palette, () => ctx.random());
    this.world.debrisLifetime = 9;
    this.hooks = {
      world: this.world,
      canWreck: (sv) => sv.destructible && sv.tag !== 'vehicle',
      onHit: (_v, perVolume, at, strength) => {
        const now = this.world.time;
        if (now - this.lastHitEvent < 0.12) return;
        this.lastHitEvent = now;
        const id = [...perVolume.keys()][0] ?? 0;
        this.emit({ e: 'hit', id, x: at[0], y: at[1], z: at[2], strength, vehicle: this.controlled?.kind ?? null });
      },
      onEvent: (e) => this.emit(e),
      fireMissile: (from, dir, owner) => this.fireMissile(from, dir, owner),
    };
  }

  // ------------------------------------------------------------------ build

  build(): void {
    const b = new LevelBuilder(this, this.level.bounds);
    this.level.build(b);
    this.world.setGround(b.ground.toDesc());
    if (this.level.lane) {
      this.carrier = new Carrier(this.world, this.kit, this.level.lane);
      for (const m of this.structs.values()) {
        if (this.carrier.addObstacle(m.sv) > 0) m.info.inLane = true;
      }
    }
    for (const m of this.structs.values()) if (m.info.survivor) this.survivors.push({ pos: [m.info.x, 0, m.info.z], state: 'hidden', structure: m.info.id });
    this.world.structures.onCollapse((s) => this.onCollapse(s.volumeId));
    this.world.on('explosion', (c, r) => this.onExplosion(c, r));
    // Walker avatar (the pilot): visual only, follows the walker.
    const pilotModel = this.buildPilot();
    this.pilot = this.world.addVolume('kinematic', pilotModel, [0, -500, 0], [0, 0, 0, 1], 'prop', { collide: false, destructible: false });
    this.staticInfo = this.makeStatic(b);
    this.setState('briefing');
    this.sendStatic();
  }

  private buildPilot(): VoxelVolume {
    const v = new VoxelVolume(5, 17, 4);
    const suit = color(this.kit, 0xf07a1a, 'wood'), dark = color(this.kit, 0x2a2f3a, 'wood'), skin = color(this.kit, 0xe8b48a, 'wood'), helmet = color(this.kit, 0xf2d23a, 'metal');
    v.fillBox(1, 0, 1, 2, 7, 3, dark);
    v.fillBox(3, 0, 1, 4, 7, 3, dark);
    v.fillBox(0, 7, 0, 5, 13, 4, suit);
    v.fillBox(1, 13, 1, 4, 15, 3, skin);
    v.fillBox(1, 15, 0, 4, 17, 4, helmet);
    return v;
  }

  private makeStatic(b: LevelBuilder): LevelStatic {
    const l = this.level;
    return {
      level: l.id,
      title: l.title,
      subtitle: l.subtitle,
      briefing: l.briefing,
      tips: l.tips,
      bounds: l.bounds,
      lane: l.lane,
      structures: [...this.structs.values()].map((m) => m.info),
      gaps: this.gaps.map((g) => g.info),
      totals: { buildings: this.structs.size, survivors: this.survivors.length, rdus: this.rdus.length, dishes: this.dishes.length },
      timeLimit: 0,
      medalTimes: l.medalTimes,
      timeAttackTimes: l.timeAttackTimes,
      map: { width: b.ground.width, height: b.ground.height, data: b.ground.data },
      rdus: this.rdus.map((r) => [...r.pos] as XYZ),
      dishes: this.dishes.map((d) => [...d.pos] as XYZ),
    };
  }

  private sendStatic(): void {
    if (this.staticInfo) this.ctx.send({ k: 'static', data: this.staticInfo });
  }

  // ------------------------------------------------------------------ messaging

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  radio(key: string): void {
    const text = this.level.radio[key];
    if (!text || this.radioDone.has(key)) return;
    this.radioDone.add(key);
    const [who, ...rest] = text.split(': ');
    this.emit({ e: 'radio', who: (who === 'SPARKS' || who === 'PILOT' ? who : 'CHIEF') as 'CHIEF' | 'SPARKS' | 'PILOT', text: rest.join(': ') || text });
  }

  onMessage(raw: unknown): void {
    const msg = raw as ClientMessage;
    switch (msg.t) {
      case 'input':
        this.input = msg.input;
        break;
      case 'start':
        if (this.state === 'briefing') {
          this.mode = this.level.lane ? msg.mode : 'mission';
          this.setState('flyover');
        }
        break;
      case 'skipFlyover':
        if (this.state === 'flyover') this.setState('countdown');
        break;
      case 'fastForward':
        if (this.carrier) this.carrier.fastForward = msg.on && this.state === 'clear';
        break;
      case 'finish':
        if (this.state === 'clear') this.complete();
        break;
      case 'debug':
        this.debug(msg.cmd, msg.arg);
        break;
      default:
        if ((msg as { t: string }).t === 'hello') this.sendStatic();
        if ((msg as { t: string; on?: boolean }).t === 'assist') this.assist = !!(msg as { on?: boolean }).on;
        break;
    }
  }

  private debug(cmd: string, arg?: number[]): void {
    if (cmd === 'clearLane') {
      this.forceGaps = true;
      for (const m of this.structs.values()) if (m.info.inLane && !m.destroyed) this.world.structures.collapse(this.world.structures.byVolume.get(m.sv.id)!);
    } else if (cmd === 'win') {
      this.complete();
    } else if (cmd === 'fail') {
      this.fail('Debug failure.');
    } else if (cmd === 'collapse' && arg) {
      const s = this.world.structures.byVolume.get(arg[0] ?? -1);
      if (s) this.world.structures.collapse(s);
    } else if (cmd === 'teleport' && arg && this.world.player) {
      this.world.player.teleport([arg[0] ?? 0, 0, arg[1] ?? 0]);
    }
  }

  private setState(s: MissionState): void {
    this.state = s;
    this.stateTime = 0;
    if (s === 'countdown') this.emit({ e: 'countdown', n: 3 });
    if (s === 'running') {
      this.emit({ e: 'go' });
      if (this.carrier && this.mode === 'mission') this.carrier.rolling = true;
      this.radio('start');
    }
  }

  // ------------------------------------------------------------------ per-step

  preStep(dt: number): void {
    const controllable = this.state === 'countdown' || this.state === 'running' || this.state === 'clear';
    const inp = controllable ? this.input : IDLE;
    const enterPressed = inp.enter !== this.seen.enter;
    const resetPressed = inp.reset !== this.seen.reset;
    const actionPressed = inp.actionCount !== this.seen.action;
    const jumpPressed = inp.jumpCount !== this.seen.jump;
    if (controllable) this.seen = { enter: inp.enter, reset: inp.reset, action: inp.actionCount, jump: inp.jumpCount };

    if (enterPressed) this.toggleVehicle();
    if (resetPressed) this.resetControlled();

    // Walker.
    const player = this.world.player;
    if (player) {
      this.world.input = this.controlled
        ? { move: [0, 0], yaw: 0, pitch: 0, jump: false, sprint: false, fly: false, vertical: 0 }
        : { move: inp.move, yaw: inp.camYaw, pitch: inp.lookPitch, jump: inp.jump, sprint: inp.sprint, fly: false, vertical: 0 };
    }

    // Vehicles.
    for (const v of this.vehicles) {
      const drive = v === this.controlled ? this.intent(inp, actionPressed, jumpPressed) : null;
      v.drive(drive, dt);
    }

    // Carrier.
    this.carrier?.move(dt, (sv) => this.crushables.has(sv.id));
    this.moveMissiles(dt);
  }

  private intent(inp: GameInput, actionPressed: boolean, jumpPressed: boolean): DriveIntent {
    let dir: [number, number] | null = null;
    if (inp.relative) {
      const [x, y] = inp.move;
      const s = Math.sin(inp.camYaw), c = Math.cos(inp.camYaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      dir = [-s * y + c * x, -c * y - s * x];
    }
    return { throttle: inp.move[1], steer: -inp.move[0], dir, action: inp.action, actionPressed, jump: inp.jump, jumpPressed, assist: this.assist };
  }

  update(dt: number): void {
    this.stateTime += dt;
    for (const v of this.vehicles) v.afterStep(dt);
    this.updatePilot();

    switch (this.state) {
      case 'flyover':
        if (this.stateTime > 8) this.setState('countdown');
        break;
      case 'countdown': {
        const n = 3 - Math.floor(this.stateTime);
        if (n >= 1 && n < 3 && Math.floor(this.stateTime - dt) !== Math.floor(this.stateTime)) this.emit({ e: 'countdown', n });
        if (this.stateTime >= 3) this.setState('running');
        break;
      }
      case 'running':
      case 'clear':
        this.time += dt;
        for (const g of this.gaps) g.filled(); // latch pits (emits gapFilled promptly)
        this.updateTnt(dt);
        this.updatePickups(dt);
        this.updateCarrier();
        break;
      case 'failed':
        this.updateTnt(dt);
        break;
      default:
        break;
    }
    this.flush(dt);
  }

  private flush(dt: number): void {
    if (this.events.length) {
      this.ctx.send({ k: 'events', list: this.events });
      this.events = [];
    }
    this.snapTimer -= dt;
    if (this.snapTimer <= 0) {
      this.snapTimer = 0.1;
      this.ctx.send({ k: 'snap', data: this.snapshot() });
    }
  }

  // ------------------------------------------------------------------ player & vehicles

  playerPos(): Vec3 {
    if (this.controlled) return this.controlled.center();
    const p = this.world.player?.position ?? [0, 0, 0];
    return [p[0], p[1], p[2]];
  }

  private nearestVehicle(): { v: Vehicle; d: number } | null {
    const p = this.playerPos();
    let best: { v: Vehicle; d: number } | null = null;
    for (const v of this.vehicles) {
      if (v.occupied) continue;
      const c = v.center();
      const reach = v.kind === 'train' ? 5.5 : v.kind === 'semi' ? 7 : Math.max(v.size[0], v.size[2]) / 2 + 2.6;
      const d = Math.hypot(c[0] - p[0], c[2] - p[2]);
      if (d < reach && Math.abs(c[1] - p[1]) < 4 && (!best || d < best.d)) best = { v, d };
    }
    return best;
  }

  private toggleVehicle(): void {
    const player = this.world.player;
    if (!player) return;
    if (this.controlled) {
      const v = this.controlled;
      const spot = this.exitSpot(v);
      v.occupied = false;
      this.controlled = null;
      player.setEnabled(true);
      player.teleport(spot);
      this.walkerParked = false;
      this.emit({ e: 'exit', vehicle: v.kind });
      return;
    }
    const near = this.nearestVehicle();
    if (!near) return;
    if (near.v.kind === 'semi') {
      if (this.state === 'clear') this.complete();
      else this.emit({ e: 'radio', who: 'CHIEF', text: 'Not yet, rookie — clear the carrier\'s path first!' });
      return;
    }
    near.v.occupied = true;
    this.controlled = near.v;
    player.setEnabled(false);
    player.teleport([0, -200, 0]);
    this.walkerParked = true;
    this.emit({ e: 'enter', vehicle: near.v.kind });
    this.radio(`enter:${near.v.kind}`);
  }

  private exitSpot(v: Vehicle): Vec3 {
    const pose = v.originPose();
    const candidates: Vec3[] =
      v.kind === 'train'
        ? [[v.center()[0] - 3, 0, v.center()[2]], [v.center()[0] + 3, 0, v.center()[2]]]
        : [
            v.toWorld([-0.9, 0, v.size[2] / 2], pose),
            v.toWorld([v.size[0] + 0.9, 0, v.size[2] / 2], pose),
            v.toWorld([v.size[0] / 2, 0, v.size[2] + 1.2], pose),
          ];
    for (const c of candidates) {
      const g = this.world.groundHeight(c[0], c[2]);
      if (!Number.isFinite(g)) continue;
      const hit = this.world.physics!.raycast([c[0], g + 3, c[2]], [0, -1, 0], 3.2, v.sv.body);
      const y = hit ? hit.point[1] : g;
      if (y - g < 1.5) return [c[0], y + 0.05, c[2]];
    }
    const c = v.center();
    return [c[0], c[1] + v.size[1] / 2 + 0.5, c[2]];
  }

  private resetControlled(): void {
    if (this.controlled) {
      this.controlled.reset();
      this.emit({ e: 'reset' });
    }
  }

  private updatePilot(): void {
    const player = this.world.player;
    if (!this.pilot || !player) return;
    if (this.controlled || !player.enabled) {
      this.world.setKinematicPose(this.pilot.id, [0, -500, 0], [0, 0, 0, 1]);
      return;
    }
    const p = player.position;
    const inp = this.input;
    if (Math.hypot(inp.move[0], inp.move[1]) > 0.1) {
      const s = Math.sin(inp.camYaw), c = Math.cos(inp.camYaw);
      const dx = -s * inp.move[1] + c * inp.move[0], dz = -c * inp.move[1] - s * inp.move[0];
      this.pilotYaw = yawOfDir(dx, dz);
    }
    const { pos, rot } = placeModel([5, 17, 4], p[0], p[1] - 0.95, p[2], this.pilotYaw);
    this.world.setKinematicPose(this.pilot.id, pos, rot);
    if (p[1] < -20 && !this.walkerParked) player.respawn();
  }

  // ------------------------------------------------------------------ missiles

  private fireMissile(from: Vec3, dir: Vec3, owner: Vehicle): void {
    const model = new VoxelVolume(3, 3, 8);
    model.fillBox(0, 0, 0, 3, 3, 8, color(this.kit, 0xd8d8d0, 'metal'));
    model.fillBox(0, 0, 0, 3, 3, 2, color(this.kit, 0xd23b2c, 'metal'));
    const l = length(dir) || 1;
    const d = scale(dir, 1 / l);
    const yaw = yawOfDir(d[0], d[2]);
    const { pos, rot } = placeModel([3, 3, 8], from[0], from[1], from[2], yaw);
    const sv = this.world.addVolume('kinematic', model, pos, rot, 'projectile', { collide: false, destructible: false, castShadow: false });
    const ownerVel = owner.velocity();
    this.missiles.push({ sv, pos: [...from], vel: add(scale(d, 42), [ownerVel[0], 0, ownerVel[2]]), life: 2.5, owner: owner.sv.body });
  }

  private moveMissiles(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      m.life -= dt;
      m.vel[1] -= 2.5 * dt;
      const step = scale(m.vel, dt);
      const hit = this.world.physics!.raycast(m.pos, step, length(step) + 0.05, m.owner);
      if (hit || m.life <= 0 || m.pos[1] < -2) {
        const at = hit ? hit.point : m.pos;
        this.world.removeVolume(m.sv.id);
        this.missiles.splice(i, 1);
        this.world.detonate(at, 1.7, 3.2);
        if (hit?.body !== null && hit?.body !== undefined) {
          const sv = this.world.volumeForBody(hit.body);
          if (sv) this.world.structures.damage(sv.id, 2500);
        }
        continue;
      }
      m.pos = add(m.pos, step);
      const yaw = yawOfDir(m.vel[0], m.vel[2]);
      const { pos, rot } = placeModel([3, 3, 8], m.pos[0], m.pos[1] - 0.15, m.pos[2], yaw);
      this.world.setKinematicPose(m.sv.id, pos, rot);
    }
  }

  // ------------------------------------------------------------------ explosives, pickups

  private updateTnt(dt: number): void {
    const physics = this.world.physics!;
    for (let i = this.tnts.length - 1; i >= 0; i--) {
      const t = this.tnts[i]!;
      if (!this.world.volumes.has(t.sv.id)) {
        this.tnts.splice(i, 1);
        continue;
      }
      const c = physics.centerOfMass(t.sv.body);
      if (t.fuse < 0) {
        const moved = Math.hypot(t.sv.position[0] - t.rest[0], 0) + length(physics.linvel(t.sv.body));
        const p = this.world.volumePose(t.sv).pos;
        if (moved > 0.8 || length(sub(p, t.rest)) > 0.3) {
          t.fuse = 8;
          this.emit({ e: 'fuse', x: c[0], y: c[1] + 0.6, z: c[2], seconds: 8 });
          this.radio('fuse');
        }
      } else {
        t.fuse -= dt;
        if (t.fuse <= 0) {
          this.world.explodeVolume(t.sv, 0);
          this.tnts.splice(i, 1);
        }
      }
    }
  }

  private updatePickups(dt: number): void {
    const p = this.playerPos();
    this.rdus.forEach((r, index) => {
      if (r.lit) return;
      if (Math.hypot(r.pos[0] - p[0], r.pos[2] - p[2]) < 2.6 && Math.abs(r.pos[1] - p[1]) < 3.5) {
        r.lit = true;
        const n = this.rdus.filter((x) => x.lit).length;
        this.emit({ e: 'rdu', index, n, total: this.rdus.length, x: r.pos[0], y: r.pos[1], z: r.pos[2] });
      }
    });
    for (const d of this.dishes) {
      if (!d.found && length(sub(d.pos, p)) < 4) {
        d.found = true;
        const n = this.dishes.filter((x) => x.found).length;
        this.emit({ e: 'dish', n, total: this.dishes.length });
        this.radio(n === this.dishes.length ? 'allDishes' : 'dish');
      }
    }
    for (const s of this.survivors) {
      if (s.state === 'waiting' && Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2]) < 3.5) {
        s.state = 'rescued';
        const n = this.survivors.filter((x) => x.state === 'rescued').length;
        this.emit({ e: 'survivorRescued', n, total: this.survivors.length });
      }
    }
    for (const a of this.ammo) {
      if (a.respawn > 0) {
        a.respawn -= dt;
        if (a.respawn <= 0) this.world.setKinematicPose(a.sv.id, a.home, [0, 0, 0, 1]);
        continue;
      }
      const bike = this.controlled instanceof Bike ? this.controlled : null;
      if (bike && Math.hypot(a.home[0] + 0.4 - p[0], a.home[2] + 0.4 - p[2]) < 2.6) {
        bike.ammo = Math.min(bike.maxAmmo, bike.ammo + 6);
        a.respawn = 20;
        this.world.setKinematicPose(a.sv.id, [0, -500, 0], [0, 0, 0, 1]);
        this.emit({ e: 'pickup', what: 'ammo' });
      }
    }
  }

  private onCollapse(volumeId: number): void {
    const m = this.structs.get(volumeId);
    if (!m || m.destroyed) return;
    m.destroyed = true;
    this.damage += m.info.value;
    this.emit({ e: 'collapse', id: m.info.id, name: m.info.name, x: m.info.x, y: m.info.h / 2, z: m.info.z, value: m.info.value, inLane: m.info.inLane });
    if (m.info.inLane) this.radio(`collapse:${m.info.name}`);
    for (const d of this.dishes) {
      if (d.host !== m.info.id || !this.world.volumes.has(d.sv.id)) continue;
      // The roof is gone: the dish tumbles to the ground next to the rubble.
      const model = d.sv.volume;
      this.world.removeVolume(d.sv.id);
      const gx = d.pos[0] + 2, gz = d.pos[2];
      const { pos, rot } = placeModel([model.sizeX, model.sizeY, model.sizeZ], gx, 0, gz, 0.6);
      d.sv = this.world.addVolume('static', model, pos, rot, 'scene', { destructible: false });
      d.pos = [gx, 1, gz];
    }
    for (const s of this.survivors) {
      if (s.structure === m.info.id && s.state === 'hidden') {
        // They run out toward open ground (away from the lane).
        const out = m.info.z >= 0 ? 1 : -1;
        s.pos = [m.info.x, 0, m.info.z + out * (m.info.d / 2 + 2.5)];
        s.state = 'waiting';
        this.emit({ e: 'survivorFreed', x: s.pos[0], y: 0, z: s.pos[2] });
        this.radio('survivor');
      }
    }
    if (!this.level.lane) {
      const left = [...this.structs.values()].filter((s) => s.target && !s.destroyed).length;
      this.emit({ e: 'target', left });
      if (left === 0 && this.state === 'running') this.complete();
    }
  }

  private onExplosion(c: Vec3, radius: number): void {
    this.emit({ e: 'explosion', x: c[0], y: c[1], z: c[2], radius });
    const carrier = this.carrier;
    if (carrier && this.mode === 'mission' && (this.state === 'running' || this.state === 'clear') && carrier.sv && this.world.volumes.has(carrier.sv.id)) {
      if (carrier.distanceTo(c) < radius * 0.45) this.fail('The carrier was caught in a blast!');
    }
  }

  // ------------------------------------------------------------------ carrier

  private laneBlockers(): { id: number; x: number }[] {
    if (!this.carrier) return [];
    return this.carrier.obstacles().map((o) => ({ id: o.sv.id, x: o.x }));
  }

  private gapFilled(g: GapDef): boolean {
    return this.forceGaps || g.filled();
  }

  private updateCarrier(): void {
    const carrier = this.carrier;
    if (!carrier || !this.world.volumes.has(carrier.sv.id)) {
      if (!this.level.lane) return;
      return;
    }
    const blockers = this.laneBlockers();
    if (this.mode === 'timeAttack') {
      if (blockers.length === 0 && this.state === 'running') this.complete();
      return;
    }
    // Collision with the remaining geometry.
    const first = blockers[0];
    if (first && carrier.front >= first.x - 0.02) {
      const m = this.structs.get(first.id);
      this.fail(`The carrier hit ${m ? `the ${m.info.name.toLowerCase()}` : 'a building'}!`);
      return;
    }
    // Gaps.
    for (const g of this.gaps) {
      if (carrier.front >= g.info.x0 + 0.3 && carrier.front - carrier.length < g.info.x1 && !this.gapFilled(g)) {
        this.fail(g.info.kind === 'rail' ? 'The carrier plunged into the rail cut!' : 'The carrier dropped into a drainage pit!');
        return;
      }
    }
    // Vehicles ramming it.
    for (const v of this.vehicles) {
      if (v.sv.kind !== 'dynamic') continue;
      const c = v.center();
      const r = Math.max(v.size[0], v.size[2]) / 2;
      if (carrier.distanceTo(c) < r * 0.7) {
        const vel = v.velocity();
        const rel = Math.hypot(vel[0] - carrier.speed, vel[1], vel[2]);
        if (rel > 7 || (v instanceof Mech && v.activity === 'stomping')) {
          this.fail(v instanceof Mech ? 'You stomped the carrier!' : 'You rammed the carrier!');
          return;
        }
      }
    }
    // Warnings (per blocker, escalating).
    for (const b of blockers) {
      const eta = (b.x - carrier.front) / Math.max(0.01, carrier.baseSpeed);
      const level = eta > 40 ? 0 : eta > 25 ? 1 : eta > 15 ? 2 : eta > 8 ? 3 : 4;
      if ((this.warned.get(b.id) ?? -1) < level) {
        this.warned.set(b.id, level);
        this.emit({ e: 'warning', id: b.id, level });
        if (level >= 2) this.radio(`warn:${this.structs.get(b.id)?.info.name ?? ''}`);
      }
    }
    for (const g of this.gaps) {
      const eta = (g.info.x0 - carrier.front) / Math.max(0.01, carrier.baseSpeed);
      if (eta > 0 && eta < 45 && !this.gapFilled(g)) this.radio(`gap:${g.info.kind}`);
    }
    // Path clear?
    if (this.state === 'running') {
      const gapsOk = this.gaps.every((g) => this.gapFilled(g) || carrier.front - carrier.length > g.info.x1);
      if (blockers.length === 0 && gapsOk) {
        this.setState('clear');
        this.emit({ e: 'pathClear' });
        this.radio('pathClear');
      }
    }
    if (!carrier.rolling && carrier.front >= carrier.endFront && (this.state === 'running' || this.state === 'clear')) {
      this.emit({ e: 'carrierSafe' });
      this.radio('carrierSafe');
      this.complete();
    }
  }

  private fail(reason: string): void {
    if (this.state === 'failed' || this.state === 'complete') return;
    this.failReason = reason;
    const carrier = this.carrier;
    let at: Vec3 = this.playerPos();
    if (carrier && this.world.volumes.has(carrier.sv.id)) {
      at = carrier.center();
      carrier.rolling = false;
      this.world.removeVolume(carrier.sv.id);
      // The double blast.
      this.world.scheduleExplosion(at, 6, 9, 0);
      this.world.scheduleExplosion(add(at, [1.5, 1, 0]), 9, 12, 0.7);
    }
    this.setState('failed');
    this.emit({ e: 'fail', reason, x: at[0], y: at[1], z: at[2] });
    this.emit({ e: 'radio', who: 'PILOT', text: 'D\'oh!' });
  }

  private complete(): void {
    if (this.state === 'complete' || this.state === 'failed') return;
    this.setState('complete');
    if (this.carrier) this.carrier.rolling = false;
    if (!this.resultsSent) {
      this.resultsSent = true;
      this.emit({ e: 'results', results: this.results() });
    }
  }

  private results(): MissionResults {
    const total = this.structs.size;
    const destroyed = [...this.structs.values()].filter((s) => s.destroyed).length;
    const survivors = this.survivors.filter((s) => s.state === 'rescued').length;
    const rdus = this.rdus.filter((r) => r.lit).length;
    const dishes = this.dishes.filter((d) => d.found).length;
    const medals: MissionResults['medals'] = {};
    const pct = (n: number, t: number) => (t === 0 ? 1 : n / t);
    if (this.level.lane && this.mode === 'mission') {
      medals.carrier = 'gold';
      const parts = [pct(destroyed, total), pct(survivors, this.survivors.length), pct(rdus, this.rdus.length), pct(dishes, this.dishes.length)];
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      if (parts.every((p) => p >= 1)) medals.completion = 'gold';
      else if (avg >= 0.75) medals.completion = 'silver';
      else if (avg >= 0.4) medals.completion = 'bronze';
    }
    const times = this.mode === 'timeAttack' ? this.level.timeAttackTimes : this.level.lane ? null : this.level.medalTimes;
    if (times) {
      for (const m of ['platinum', 'gold', 'silver', 'bronze'] as Medal[]) {
        if (this.time <= times[m]) {
          medals.time = m;
          break;
        }
      }
    }
    return {
      level: this.level.id,
      mode: this.mode,
      time: this.time,
      carrierSafe: this.level.lane !== null && this.mode === 'mission',
      buildings: [destroyed, total],
      survivors: [survivors, this.survivors.length],
      rdus: [rdus, this.rdus.length],
      dishes: [dishes, this.dishes.length],
      damage: this.damage,
      medals,
    };
  }

  // ------------------------------------------------------------------ snapshot

  private snapshot(): GameSnapshot {
    const carrier = this.carrier && this.world.volumes.has(this.carrier.sv.id) ? this.carrier : null;
    const blockers = this.laneBlockers();
    const p = this.playerPos();
    const v = this.controlled;
    let next: number | null = null, eta: number | null = null;
    if (carrier) {
      const nb = blockers[0];
      const ng = this.gaps.find((g) => !this.gapFilled(g) && g.info.x1 > carrier.front - carrier.length);
      const tb = nb ? (nb.x - carrier.front) / carrier.baseSpeed : Infinity;
      const tg = ng ? (ng.info.x0 - carrier.front) / carrier.baseSpeed : Infinity;
      if (tb < tg) {
        next = nb!.id;
        eta = tb;
      } else if (ng) {
        next = -ng.info.id;
        eta = tg;
      }
      if (this.mode !== 'mission') eta = null;
    }
    const near = !v ? this.nearestVehicle() : null;
    let prompt: string | null = null;
    if (v) prompt = v.kind === 'semi' ? null : `Exit ${VEHICLE_NAMES[v.kind]}`;
    if (this.state === 'clear' && !near) prompt = this.carrier?.fastForward ? 'F  Carrier fast-forwarding ▶▶' : 'F  Fast-forward the carrier · or board the COMMAND RIG';
    else if (near) prompt = near.v.kind === 'semi' ? (this.state === 'clear' ? 'Board the COMMAND RIG — finish mission' : 'COMMAND RIG (clear the path first)') : `Enter ${VEHICLE_NAMES[near.v.kind]}`;
    const trainAligned = this.vehicles.some((x) => x instanceof Train && Math.abs(x.deckCenterZ() - (this.level.lane?.z ?? 0)) <= 0.8);
    const heading = v ? v.heading() : this.pilotYaw;
    const vel = v ? v.velocity() : [0, 0, 0];
    return {
      state: this.state,
      mode: this.mode,
      time: this.time,
      countdown: this.state === 'countdown' ? Math.max(0, 3 - this.stateTime) : this.state === 'flyover' ? Math.max(0, 8 - this.stateTime) : 0,
      carrier: this.carrier
        ? { x: this.carrier.centerX, z: this.carrier.laneZ, y: 0, slot: this.carrier.sv.slot, progress: this.carrier.progress, fastForward: this.carrier.fastForward, eta, next }
        : null,
      player: {
        x: p[0],
        y: p[1],
        z: p[2],
        heading,
        onFoot: !v,
        vehicle: v?.kind ?? null,
        vehicleId: v?.id ?? null,
        slot: v ? v.sv.slot : 0,
        speed: v ? Math.abs(v instanceof Train ? v.speed() : Math.hypot(vel[0], vel[2])) : 0,
        meter: v ? v.meter() : null,
        activity: v?.activity ?? null,
      },
      prompt,
      counts: {
        buildings: [[...this.structs.values()].filter((s) => s.destroyed).length, this.structs.size],
        survivors: [this.survivors.filter((s) => s.state === 'rescued').length, this.survivors.length],
        rdus: [this.rdus.filter((r) => r.lit).length, this.rdus.length],
        dishes: [this.dishes.filter((d) => d.found).length, this.dishes.length],
        damage: this.damage,
      },
      blockers: carrier
        ? blockers.map((b) => {
            const e = (b.x - carrier.front) / carrier.baseSpeed;
            return { id: b.id, eta: e, level: e > 40 ? 0 : e > 25 ? 1 : e > 15 ? 2 : e > 8 ? 3 : 4 };
          })
        : [],
      gaps: this.gaps.map((g) => ({ id: g.info.id, filled: this.gapFilled(g) })),
      vehicles: this.vehicles.map((x) => {
        const c = x.center();
        return { id: x.id, kind: x.kind, x: c[0], z: c[2], heading: x.heading(), occupied: x.occupied };
      }),
      survivors: this.survivors.filter((s) => s.state === 'waiting').map((s) => ({ x: s.pos[0], z: s.pos[2] })),
      rdus: this.rdus.filter((r) => !r.lit && Math.hypot(r.pos[0] - p[0], r.pos[2] - p[2]) < 70).map((r) => ({ x: r.pos[0], z: r.pos[2] })),
      destroyed: [...this.structs.values()].filter((s) => s.destroyed).map((s) => s.info.id),
      aligned: trainAligned,
      targetsLeft: [...this.structs.values()].filter((s) => s.target && !s.destroyed).length,
      litRdus: this.rdus.flatMap((r, i) => (r.lit ? [i] : [])),
      survivorsAll: this.survivors.map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2], state: s.state })),
      zone: v?.zone ? { center: v.zone.center as XYZ, half: v.zone.half as XYZ, yaw: v.zone.yaw } : null,
    };
  }

  /** Test/debug accessors. */
  get failureReason(): string {
    return this.failReason;
  }
}

export { yawQuat };
