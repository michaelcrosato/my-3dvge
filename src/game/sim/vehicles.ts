/**
 * PATHBREAKERS vehicles. Each one is a voxel model on a physics body with its own way of wrecking
 * buildings (a damage zone that carves static voxels and adds structure damage):
 * PLOWHORSE rams with its blade, TAILWHIP slams its rear while sliding, SKYLARK crushes from the air,
 * LONGBOW fires missiles, HAMMERHEAD stomps from above. FREIGHT HOPPER runs on rails; the COMMAND RIG
 * ends the mission.
 */
import type { Quat, Vec3 } from '../../shared/protocol.ts';
import { add, cross, length, quatRotate, scale, sub } from '../../shared/math.ts';
import { carve, querySolid, type CarveShape } from '../../sim/destruction.ts';
import type { WheelControl } from '../../sim/physics/backend.ts';
import type { SimVolume, SimWorld } from '../../sim/world.ts';
import { SLOT_FLOATS } from '../../shared/transforms.ts';
import type { MeterInfo, VehicleKind } from '../shared/types.ts';
import { VEHICLE_DIMS, buildVehicle, type ArtKit } from './art/index.ts';
import { clamp, placeModel, VS, wrapAngle, yawOf, yawOfDir, yawQuat } from './util.ts';

/** What the driver wants this step (already mapped from GameInput). */
export interface DriveIntent {
  /** -1..1, + forward. */
  throttle: number;
  /** -1..1, + left. */
  steer: number;
  /** World-space desired direction (x, z) × magnitude (relative camera modes); overrides throttle/steer. */
  dir: [number, number] | null;
  action: boolean;
  actionPressed: boolean;
  jump: boolean;
  jumpPressed: boolean;
  /** Assist toggle (drift assist). */
  assist: boolean;
}

export interface VehicleHooks {
  world: SimWorld;
  /** Volumes a vehicle is allowed to wreck (structures, props) — never vehicles or the carrier. */
  canWreck(sv: SimVolume): boolean;
  onHit(v: Vehicle, removedByVolume: Map<number, number>, at: Vec3, strength: number): void;
  onEvent(e: { e: 'turbo' } | { e: 'horn' } | { e: 'slide'; on: boolean } | { e: 'thrust'; on: boolean } | { e: 'land'; strength: number } | { e: 'fire'; x: number; y: number; z: number } | { e: 'stomp'; x: number; y: number; z: number }): void;
  fireMissile(from: Vec3, dir: Vec3, owner: Vehicle): void;
}

const scratch = new Float32Array(SLOT_FLOATS);

export abstract class Vehicle {
  readonly kind: VehicleKind;
  readonly sv: SimVolume;
  readonly hooks: VehicleHooks;
  readonly size: [number, number, number];
  occupied = false;
  activity: string | null = null;
  /** Active damage zone this step (for the client's highlight). */
  zone: { center: Vec3; half: Vec3; yaw: number } | null = null;
  protected flippedTime = 0;

  constructor(hooks: VehicleHooks, kind: VehicleKind, sv: SimVolume) {
    this.hooks = hooks;
    this.kind = kind;
    this.sv = sv;
    this.size = VEHICLE_DIMS[kind].map((v) => v * VS) as [number, number, number];
  }

  get id(): number {
    return this.sv.id;
  }

  get world(): SimWorld {
    return this.hooks.world;
  }

  /** Voxel-grid origin pose. */
  originPose(): { pos: Vec3; rot: Quat } {
    const w = this.world;
    if (this.sv.body >= 0 && this.sv.kind === 'dynamic' && w.physics) {
      w.physics.readTransform(this.sv.body, scratch, 0);
      return { pos: [scratch[0]!, scratch[1]!, scratch[2]!], rot: [scratch[3]!, scratch[4]!, scratch[5]!, scratch[6]!] };
    }
    return { pos: this.sv.position, rot: this.sv.rotation };
  }

  /** Model-space point (meters from the min corner) → world. */
  toWorld(p: Vec3, pose = this.originPose()): Vec3 {
    return add(pose.pos, quatRotate(pose.rot, p));
  }

  center(): Vec3 {
    return this.toWorld([this.size[0] / 2, this.size[1] / 2, this.size[2] / 2]);
  }

  forward(): Vec3 {
    return quatRotate(this.originPose().rot, [0, 0, -1]);
  }

  heading(): number {
    return yawOf(this.originPose().rot);
  }

  velocity(): Vec3 {
    return this.sv.body >= 0 && this.sv.kind === 'dynamic' ? this.world.physics!.linvel(this.sv.body) : [0, 0, 0];
  }

  speed(): number {
    const v = this.velocity();
    const f = this.forward();
    return v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  }

  meter(): MeterInfo | null {
    return null;
  }

  /** Called before physics each step; `intent` is null when nobody drives it. */
  abstract drive(intent: DriveIntent | null, dt: number): void;

  /** Called after physics each step (damage zones, landing checks). */
  afterStep(_dt: number): void {}

  /** Puts the vehicle back on its wheels (manual reset or auto-recovery). */
  reset(): void {
    const w = this.world;
    if (this.sv.kind !== 'dynamic' || !w.physics) return;
    const c = this.center();
    const yaw = this.heading();
    const g = Math.max(0, w.groundHeight(c[0], c[2]));
    const { pos, rot } = placeModel(VEHICLE_DIMS[this.kind], c[0], g + 0.6, c[2], yaw);
    w.physics.setPose(this.sv.body, pos, rot, true);
  }

  /** Carves a box zone (model-space center/half in meters) with the body's rotation. */
  protected wreckBox(localCenter: Vec3, half: Vec3, power: number, damageMul: number, pose = this.originPose()): number {
    const world = this.world;
    const center = this.toWorld(localCenter, pose);
    const shape: CarveShape = { kind: 'box', center, half, rotation: pose.rot };
    this.zone = { center, half, yaw: yawOf(pose.rot) };
    const filter = (sv: SimVolume) => sv.kind === 'static' && this.hooks.canWreck(sv);
    const probe = querySolid(world, shape, filter);
    if (probe.count === 0) return 0;
    const r = carve(world, shape, power, { filter, particleChance: 0.12 });
    if (r.removedVoxels > 0) {
      for (const [id, n] of r.perVolume) world.structures.damage(id, n * damageMul);
      this.hooks.onHit(this, r.perVolume, probe.centroid, r.removedVoxels);
    }
    return r.removedVoxels;
  }

  /** Auto-recovery when stuck on its roof/side. */
  protected checkFlip(dt: number): void {
    const up = quatRotate(this.originPose().rot, [0, 1, 0]);
    const v = this.velocity();
    if (up[1] < 0.35 && length(v) < 2) {
      this.flippedTime += dt;
      if (this.flippedTime > 1.6) {
        this.flippedTime = 0;
        this.reset();
      }
    } else {
      this.flippedTime = 0;
    }
  }
}

// ------------------------------------------------------------------ wheeled vehicles

interface WheeledSpec {
  mass: number;
  /** Chassis box vertical extent above the model base (m) and horizontal inset (m). */
  chassisY: [number, number];
  inset: number;
  comHeight: number;
  wheels: { x: number; z: number; r: number; drive: boolean; steer: 1 | 0 | -1 }[];
  rest: number;
  stiffness: number;
  engine: number;
  brake: number;
  maxSpeed: number;
  reverseMax: number;
  steer: number;
  grip: [number, number];
  uprightAssist: number;
}

const SPECS: Record<'dozer' | 'truck' | 'buggy' | 'bike', WheeledSpec> = {
  dozer: {
    mass: 7000, chassisY: [0.35, 2.0], inset: 0.1, comHeight: 0.55,
    wheels: [{ x: -1.15, z: -1.3, r: 0.45, drive: true, steer: 1 }, { x: 1.15, z: -1.3, r: 0.45, drive: true, steer: 1 }, { x: -1.15, z: 1.4, r: 0.45, drive: true, steer: -1 }, { x: 1.15, z: 1.4, r: 0.45, drive: true, steer: -1 }],
    rest: 0.3, stiffness: 45, engine: 7200, brake: 900, maxSpeed: 9, reverseMax: 5, steer: 0.42, grip: [3, 1.4], uprightAssist: 6,
  },
  truck: {
    mass: 6000, chassisY: [0.5, 2.4], inset: 0.05, comHeight: 0.7,
    wheels: [{ x: -1.0, z: -1.85, r: 0.5, drive: false, steer: 1 }, { x: 1.0, z: -1.85, r: 0.5, drive: false, steer: 1 }, { x: -1.0, z: 1.75, r: 0.5, drive: true, steer: 0 }, { x: 1.0, z: 1.75, r: 0.5, drive: true, steer: 0 }],
    rest: 0.35, stiffness: 40, engine: 9500, brake: 800, maxSpeed: 15, reverseMax: 6, steer: 0.5, grip: [2.4, 1.1], uprightAssist: 5,
  },
  buggy: {
    mass: 900, chassisY: [0.38, 1.25], inset: 0.1, comHeight: 0.45,
    wheels: [{ x: -0.85, z: -1.12, r: 0.42, drive: true, steer: 1 }, { x: 0.85, z: -1.12, r: 0.42, drive: true, steer: 1 }, { x: -0.85, z: 1.12, r: 0.42, drive: true, steer: 0 }, { x: 0.85, z: 1.12, r: 0.42, drive: true, steer: 0 }],
    rest: 0.35, stiffness: 28, engine: 1350, brake: 160, maxSpeed: 21, reverseMax: 7, steer: 0.52, grip: [2.2, 1.0], uprightAssist: 3,
  },
  bike: {
    mass: 320, chassisY: [0.3, 1.2], inset: 0.1, comHeight: 0.2,
    wheels: [{ x: -0.32, z: -0.95, r: 0.38, drive: false, steer: 1 }, { x: 0.32, z: -0.95, r: 0.38, drive: false, steer: 1 }, { x: -0.32, z: 0.95, r: 0.38, drive: true, steer: 0 }, { x: 0.32, z: 0.95, r: 0.38, drive: true, steer: 0 }],
    rest: 0.3, stiffness: 30, engine: 950, brake: 90, maxSpeed: 22, reverseMax: 5, steer: 0.45, grip: [2.4, 1.2], uprightAssist: 14,
  },
};

export class WheeledVehicle extends Vehicle {
  readonly spec: WheeledSpec;
  readonly handle: number;
  /** Throttle requested this step (after mapping). */
  protected throttle = 0;
  protected contacts: boolean[] = [];
  protected airTime = 0;
  protected sinceLanding = 10;
  protected steerState = 0;

  constructor(hooks: VehicleHooks, kind: 'dozer' | 'truck' | 'buggy' | 'bike', sv: SimVolume) {
    super(hooks, kind, sv);
    this.spec = SPECS[kind];
    const physics = hooks.world.physics!;
    const [w, , l] = this.size;
    const s = this.spec;
    this.handle = physics.createVehicle(
      sv.body,
      s.wheels.map((wh) => ({
        position: [w / 2 + wh.x, s.rest + wh.r, l / 2 + wh.z] as Vec3,
        radius: wh.r,
        suspensionRest: s.rest,
        maxTravel: s.rest * 0.9,
        stiffness: s.stiffness,
        compression: 4.4,
        relaxation: 5.3,
        maxForce: s.mass * 60,
        frictionSlip: s.grip[0],
        sideFriction: s.grip[1],
      })),
    );
  }

  static colliders(kind: 'dozer' | 'truck' | 'buggy' | 'bike'): { hx: number; hy: number; hz: number; cx: number; cy: number; cz: number; density: number; friction: number; restitution: number; mass: { mass: number; com: Vec3; inertia: Vec3 } }[] {
    const s = SPECS[kind];
    const [w, , l] = VEHICLE_DIMS[kind].map((v) => v * VS) as [number, number, number];
    const hy = (s.chassisY[1] - s.chassisY[0]) / 2;
    const hx = w / 2 - s.inset, hz = l / 2 - s.inset;
    const cy = (s.chassisY[0] + s.chassisY[1]) / 2;
    const m = s.mass;
    return [{
      cx: w / 2, cy, cz: l / 2, hx, hy, hz, density: 0, friction: 0.4, restitution: 0.05,
      mass: { mass: m, com: [0, s.comHeight - cy, 0], inertia: [(m * (4 * hy * hy + 4 * hz * hz)) / 12, (m * (4 * hx * hx + 4 * hz * hz)) / 12, (m * (4 * hx * hx + 4 * hy * hy)) / 12] },
    }];
  }

  get grounded(): boolean {
    return this.contacts.filter(Boolean).length >= 2;
  }

  /** Engine multiplier (turbo). */
  protected boost(): number {
    return 1;
  }

  protected intentToControls(intent: DriveIntent | null): { throttle: number; steer: number; handbrake: boolean } {
    if (!intent) return { throttle: 0, steer: 0, handbrake: true };
    let throttle = intent.throttle, steer = intent.steer;
    if (intent.dir) {
      const [dx, dz] = intent.dir;
      const m = Math.min(1, Math.hypot(dx, dz));
      if (m < 0.08) {
        throttle = 0;
        steer = 0;
      } else {
        const a = wrapAngle(yawOfDir(dx, dz) - this.heading()); // + = target to the left
        if (Math.abs(a) < 1.95) {
          throttle = m * (Math.abs(a) > 1.2 ? 0.55 : 1);
          steer = clamp(a / 0.5, -1, 1);
        } else {
          throttle = -m * 0.8;
          steer = -clamp(wrapAngle(a + Math.PI) / 0.5, -1, 1);
        }
      }
    }
    return { throttle, steer, handbrake: intent.jump && !intent.dir };
  }

  drive(intent: DriveIntent | null, dt: number): void {
    const physics = this.world.physics!;
    const s = this.spec;
    const { throttle, steer, handbrake } = this.intentToControls(intent);
    this.throttle = throttle;
    const speed = this.speed();
    this.steerState += (steer - this.steerState) * Math.min(1, dt * 8);
    const steerAngle = this.steerState * s.steer * (1 - 0.5 * Math.min(1, Math.abs(speed) / s.maxSpeed));
    let engine = 0, brake = 0;
    if (throttle > 0.02) {
      if (speed < -1) brake = s.brake * 3;
      else engine = throttle * s.engine * this.boost() * Math.max(0, 1 - speed / (s.maxSpeed * this.boost()));
    } else if (throttle < -0.02) {
      if (speed > 1) brake = s.brake * 3;
      else engine = throttle * s.engine * 0.8 * Math.max(0, 1 + speed / s.reverseMax);
    } else {
      brake = s.brake * 0.35;
    }
    const controls: WheelControl[] = s.wheels.map((wh) => ({
      engine: wh.drive ? engine : 0,
      brake: handbrake && wh.z > 0 ? s.brake * 4 : brake,
      steer: steerAngle * wh.steer,
    }));
    if (throttle !== 0 || steer !== 0) physics.wake(this.sv.body);
    physics.updateVehicle(this.handle, dt, controls);
    this.contacts = physics.wheelContacts(this.handle);
    this.upright(dt);
    this.special(intent, dt);
  }

  /** Keeps the chassis upright: a righting torque proportional to tilt. */
  protected upright(dt: number): void {
    const physics = this.world.physics!;
    const up = quatRotate(this.originPose().rot, [0, 1, 0]);
    const axis = cross(up, [0, 1, 0]);
    const k = this.spec.uprightAssist * this.spec.mass * dt * (this.grounded ? 1 : 0.35);
    if (length(axis) > 0.02) physics.applyTorqueImpulse(this.sv.body, scale(axis, k));
    // Damp roll/pitch spin a little so landings settle.
    const w = physics.angvel(this.sv.body);
    physics.setAngvel(this.sv.body, [w[0] * (1 - 0.8 * dt), w[1], w[2] * (1 - 0.8 * dt)]);
  }

  protected special(_intent: DriveIntent | null, _dt: number): void {}

  override afterStep(dt: number): void {
    this.zone = null;
    const air = !this.contacts.some(Boolean);
    if (air) this.airTime += dt;
    else {
      if (this.airTime > 0.35) {
        this.sinceLanding = 0;
        this.hooks.onEvent({ e: 'land', strength: Math.min(1, this.airTime / 1.2) });
      }
      this.airTime = 0;
      this.sinceLanding += dt;
    }
    this.checkFlip(dt);
  }
}

/** PLOWHORSE: rams with its blade; too weak for stone and metal. */
export class Dozer extends WheeledVehicle {
  private tick = 0;

  protected override special(intent: DriveIntent | null): void {
    if (intent?.actionPressed) this.hooks.onEvent({ e: 'horn' });
    // Blade "grip": gently hold pushed crates/blocks against the blade.
  }

  override afterStep(dt: number): void {
    super.afterStep(dt);
    this.activity = null;
    const speed = this.speed();
    this.tick++;
    // Ramming at speed bites hard; pushing against a wall at full throttle grinds through slowly.
    const ramming = speed > 1.2 && this.tick % 2 === 0;
    const grinding = !ramming && this.throttle > 0.4 && this.tick % 7 === 0;
    if (ramming || grinding) {
      const [w] = this.size;
      const removed = this.wreckBox([w / 2, 0.95, -0.3], [1.55, 0.8, grinding ? 0.55 : 0.5], 2.2, ramming ? 4 + speed * 0.4 : 2);
      if (removed > 0) {
        this.activity = 'ramming';
        const physics = this.world.physics!;
        const v = physics.linvel(this.sv.body);
        const f = Math.max(0.55, 1 - removed / 3000);
        physics.setLinvel(this.sv.body, [v[0] * f, v[1], v[2] * f]);
      }
    }
  }
}

/** TAILWHIP: hold action to power-slide; the armored rear wrecks what it swings into. */
export class Truck extends WheeledVehicle {
  private sliding = false;

  protected override special(intent: DriveIntent | null, dt: number): void {
    const physics = this.world.physics!;
    const slide = !!intent?.action && this.grounded && Math.abs(this.speed()) > 3;
    if (slide !== this.sliding) {
      this.sliding = slide;
      this.hooks.onEvent({ e: 'slide', on: slide });
      const [fs, sf] = this.spec.grip;
      for (const i of [2, 3]) physics.setWheelGrip(this.handle, i, slide ? fs * 0.45 : fs, slide ? sf * 0.25 : sf);
    }
    if (slide && intent) {
      // Swing the tail: yaw torque in the steering direction (assist keeps it controllable).
      const dir = Math.sign(this.steerState) || (intent.dir ? 0 : 0);
      const w = physics.angvel(this.sv.body);
      const target = dir * 1.9;
      const gain = intent.assist ? 1 : 0.7;
      physics.setAngvel(this.sv.body, [w[0], w[1] + (target - w[1]) * Math.min(1, dt * 3 * gain), w[2]]);
    }
  }

  override afterStep(dt: number): void {
    super.afterStep(dt);
    this.activity = this.sliding ? 'sliding' : null;
    const physics = this.world.physics!;
    const pose = this.originPose();
    const v = physics.linvel(this.sv.body);
    const w = physics.angvel(this.sv.body);
    const rearLocal: Vec3 = [this.size[0] / 2, 1.2, this.size[2] + 0.3];
    const rearWorld = this.toWorld(rearLocal, pose);
    const com = physics.centerOfMass(this.sv.body);
    const rearVel = add(v, cross(w, sub(rearWorld, com)));
    const right = quatRotate(pose.rot, [1, 0, 0]);
    const back = quatRotate(pose.rot, [0, 0, 1]);
    const lateral = Math.abs(rearVel[0] * right[0] + rearVel[2] * right[2]);
    const backward = rearVel[0] * back[0] + rearVel[2] * back[2];
    if ((this.sliding && lateral > 2.2) || backward > 3.5 || (this.airTime > 0.3 && length(v) > 7)) {
      const removed = this.wreckBox(rearLocal, [1.45, 1.0, 0.6], 3.3, 7, pose);
      if (removed > 0) physics.setLinvel(this.sv.body, scale(v, Math.max(0.55, 1 - removed / 4000)));
    } else if (this.sliding) {
      this.zone = { center: rearWorld, half: [1.45, 1.0, 0.55], yaw: yawOf(pose.rot) };
    }
  }
}

/** SKYLARK: turbo bursts; wrecks buildings it lands on or flies into. */
export class Buggy extends WheeledVehicle {
  private fuel = 1;
  private turbo = 0;

  protected override boost(): number {
    return this.turbo > 0 ? 2.3 : 1;
  }

  override meter(): MeterInfo {
    return { label: 'TURBO', value: this.fuel };
  }

  protected override special(intent: DriveIntent | null, dt: number): void {
    this.turbo = Math.max(0, this.turbo - dt);
    this.fuel = Math.min(1, this.fuel + dt * 0.22);
    if (intent?.actionPressed && this.fuel >= 0.3) {
      this.fuel -= 0.3;
      this.turbo = 1;
      const f = this.forward();
      this.world.physics!.applyImpulse(this.sv.body, scale([f[0], 0.05, f[2]], this.spec.mass * 3));
      this.hooks.onEvent({ e: 'turbo' });
    }
  }

  override afterStep(dt: number): void {
    super.afterStep(dt);
    const v = this.velocity();
    const fast = length(v) > 6;
    this.activity = this.airTime > 0.2 ? 'airborne' : this.turbo > 0 ? 'turbo' : null;
    if (fast && (this.airTime > 0.2 || this.sinceLanding < 0.3)) {
      const [w, h, l] = this.size;
      const removed = this.wreckBox([w / 2, h / 2, l / 2], [w / 2 + 0.3, h / 2 + 0.3, l / 2 + 0.35], 3, 6);
      if (removed > 0) this.world.physics!.setLinvel(this.sv.body, scale(v, Math.max(0.5, 1 - removed / 2500)));
    }
  }
}

/** LONGBOW: missile bike. Ammo refills over time and from ammo crates. */
export class Bike extends WheeledVehicle {
  ammo = 8;
  readonly maxAmmo = 12;
  private regen = 0;
  private cooldown = 0;

  override meter(): MeterInfo {
    return { label: 'MISSILES', value: this.ammo / this.maxAmmo, count: this.ammo };
  }

  protected override special(intent: DriveIntent | null, dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.regen += dt;
    if (this.regen > 5 && this.ammo < this.maxAmmo) {
      this.regen = 0;
      this.ammo++;
    }
    if (intent?.action && this.cooldown === 0 && this.ammo > 0) {
      this.ammo--;
      this.cooldown = 0.35;
      const f = this.forward();
      const side = this.ammo % 2 ? 0.45 : -0.45;
      const pose = this.originPose();
      const from = this.toWorld([this.size[0] / 2 + side, 1.1, -0.3], pose);
      this.hooks.fireMissile(from, [f[0], f[1] + 0.02, f[2]], this);
      this.hooks.onEvent({ e: 'fire', x: from[0], y: from[1], z: from[2] });
    }
  }
}

// ------------------------------------------------------------------ HAMMERHEAD (jet mech)

export class Mech extends Vehicle {
  fuel = 1;
  private stomping = false;
  private pendingDive = -1;
  private grounded = false;
  private thrusting = false;
  private lastVy = 0;

  static colliders(): { hx: number; hy: number; hz: number; cx: number; cy: number; cz: number; density: number; friction: number; restitution: number; mass: { mass: number; com: Vec3; inertia: Vec3 } }[] {
    const [w, h, l] = VEHICLE_DIMS.mech.map((v) => v * VS) as [number, number, number];
    return [{ cx: w / 2, cy: h / 2 + 0.05, cz: l / 2, hx: w / 2 - 0.1, hy: h / 2 - 0.05, hz: l / 2 - 0.1, density: 0, friction: 0.2, restitution: 0, mass: { mass: 2500, com: [0, -0.4, 0], inertia: [2500, 2500, 2500] } }];
  }

  override meter(): MeterInfo {
    return { label: 'JET FUEL', value: this.fuel };
  }

  drive(intent: DriveIntent | null, dt: number): void {
    const physics = this.world.physics!;
    const body = this.sv.body;
    const v = physics.linvel(body);
    const c = this.center();
    const hit = physics.raycast([c[0], c[1], c[2]], [0, -1, 0], this.size[1] / 2 + 0.25, body);
    this.grounded = hit !== null;
    let dx = 0, dz = 0;
    if (intent) {
      if (intent.dir) [dx, dz] = intent.dir;
      else {
        // Tank-ish: throttle along facing, steer turns.
        const f = this.forward();
        dx = f[0] * intent.throttle;
        dz = f[2] * intent.throttle;
      }
    }
    const m = Math.min(1, Math.hypot(dx, dz));
    const maxH = this.grounded ? 5.5 : 9;
    const k = Math.min(1, dt * (this.grounded ? 10 : 2.5));
    const tvx = m > 0.05 ? (dx / (Math.hypot(dx, dz) || 1)) * m * maxH : 0;
    const tvz = m > 0.05 ? (dz / (Math.hypot(dx, dz) || 1)) * m * maxH : 0;
    let vy = v[1];
    let vx = v[0] + (tvx - v[0]) * k;
    let vz = v[2] + (tvz - v[2]) * k;

    // Thrusters.
    const thrust = !!intent?.jump && this.fuel > 0.02 && !this.stomping;
    if (thrust) {
      vy = Math.min(8, vy + (9.81 + 7) * dt);
      this.fuel = Math.max(0, this.fuel - dt * 0.28);
    } else if (this.grounded) {
      this.fuel = Math.min(1, this.fuel + dt * 0.45);
    }
    if (thrust !== this.thrusting) {
      this.thrusting = thrust;
      this.hooks.onEvent({ e: 'thrust', on: thrust });
    }

    // Stomp: dive from the air; from the ground, hop first.
    if (intent?.actionPressed && !this.stomping) {
      if (!this.grounded) this.startDive();
      else if (this.pendingDive < 0) {
        vy = 7.5;
        this.pendingDive = 0.38;
      }
    }
    if (this.pendingDive >= 0) {
      this.pendingDive -= dt;
      if (this.pendingDive < 0) this.startDive();
    }
    if (this.stomping) {
      vx *= 0.9;
      vz *= 0.9;
      vy = Math.min(vy, -24);
      if (this.pendingDive < 0 && physics.linvel(body)[1] > -1) vy = -24;
    }
    physics.setLinvel(body, [vx, this.stomping ? Math.min(v[1], -24) : vy, vz]);

    // Face the movement direction.
    if (m > 0.1) {
      const want = yawOfDir(tvx, tvz);
      const diff = wrapAngle(want - this.heading());
      physics.setAngvel(body, [0, clamp(diff * 6, -5, 5), 0]);
    } else if (intent && !intent.dir && Math.abs(intent.steer) > 0.05) {
      physics.setAngvel(body, [0, intent.steer * 2.5, 0]);
    } else {
      physics.setAngvel(body, [0, 0, 0]);
    }
    this.activity = this.stomping ? 'stomping' : thrust ? 'flying' : this.grounded ? null : 'airborne';
    physics.wake(body);
  }

  private startDive(): void {
    this.stomping = true;
    this.pendingDive = -1;
  }

  override afterStep(): void {
    this.zone = null;
    const physics = this.world.physics!;
    const v = physics.linvel(this.sv.body);
    if (this.stomping) {
      const c = this.center();
      this.zone = { center: [c[0], c[1] - this.size[1] / 2, c[2]], half: [2.3, 2.3, 2.3], yaw: 0 };
      // Landed (on ground or on a roof): vertical speed collapsed.
      if (this.lastVy < -8 && v[1] > -3) {
        this.stomping = false;
        const feet: Vec3 = [c[0], c[1] - this.size[1] / 2 - 0.3, c[2]];
        const world = this.world;
        const filter = (sv: SimVolume) => this.hooks.canWreck(sv) && sv.kind !== 'kinematic';
        const r = carve(world, { kind: 'sphere', center: feet, radius: 2.4 }, 4.6, { filter, shockwave: true, particleChance: 0.15 });
        for (const [id, n] of r.perVolume) world.structures.damage(id, n * 5);
        world.emitSmoke(feet, 12, 2);
        this.hooks.onEvent({ e: 'stomp', x: feet[0], y: feet[1], z: feet[2] });
        if (r.removedVoxels > 0) this.hooks.onHit(this, r.perVolume, feet, r.removedVoxels);
        physics.setLinvel(this.sv.body, [0, 4, 0]);
      }
    }
    this.lastVy = v[1];
  }

  override reset(): void {
    const c = this.center();
    const g = Math.max(0, this.world.groundHeight(c[0], c[2]));
    const { pos } = placeModel(VEHICLE_DIMS.mech, c[0], g + 0.2, c[2], this.heading());
    this.world.physics!.setPose(this.sv.body, pos, yawQuat(this.heading()), true);
    this.stomping = false;
  }
}

// ------------------------------------------------------------------ FREIGHT HOPPER (rail car)

export class Train extends Vehicle {
  /** Track: x of the rail center, base y, z range; the car moves along +z. */
  readonly track: { x: number; y: number; z0: number; z1: number };
  /** z of the car's front (model z = 0). */
  s: number;
  private vel = 0;

  constructor(hooks: VehicleHooks, sv: SimVolume, track: { x: number; y: number; z0: number; z1: number }, s: number) {
    super(hooks, 'train', sv);
    this.track = track;
    this.s = s;
  }

  /** z of the flatbed deck's center (rear 50 voxels of the 90-voxel model). */
  deckCenterZ(): number {
    return this.s + (40 + 25) * VS;
  }

  override speed(): number {
    return this.vel;
  }

  override forward(): Vec3 {
    return [0, 0, 1];
  }

  override heading(): number {
    return Math.PI;
  }

  drive(intent: DriveIntent | null, dt: number): void {
    // Forward (W / stick up) runs toward -z, the locomotive's facing; relative modes use world z directly.
    let t = 0;
    if (intent) t = intent.dir ? clamp(intent.dir[1], -1, 1) : -intent.throttle;
    this.vel += t * 3.2 * dt;
    if (Math.abs(t) < 0.05) this.vel *= Math.max(0, 1 - dt * 1.6);
    this.vel = clamp(this.vel, -7, 7);
    const len = VEHICLE_DIMS.train[2] * VS;
    const next = clamp(this.s + this.vel * dt, this.track.z0, this.track.z1 - len);
    if (next === this.track.z0 || next === this.track.z1 - len) this.vel = 0;
    this.s = next;
    // Unrotated model: +x width, +z length; `s` is the model's min-z face.
    this.world.setKinematicPose(this.sv.id, [this.track.x - (VEHICLE_DIMS.train[0] * VS) / 2, this.track.y, this.s], [0, 0, 0, 1]);
    this.activity = Math.abs(this.vel) > 0.2 ? 'rolling' : null;
  }

  static colliders(): { hx: number; hy: number; hz: number; cx: number; cy: number; cz: number; density: number; friction: number; restitution: number }[] {
    const [w, h] = VEHICLE_DIMS.train.map((v) => v * VS) as [number, number, number];
    return [
      { cx: w / 2, cy: h / 2, cz: 2, hx: w / 2, hy: h / 2, hz: 2, density: 1000, friction: 0.8, restitution: 0 },
      { cx: w / 2, cy: 0.6, cz: 6.5, hx: w / 2, hy: 0.6, hz: 2.5, density: 1000, friction: 0.9, restitution: 0 },
    ];
  }
}

/** COMMAND RIG: parked; boarding it after the path is clear ends the mission. */
export class Semi extends Vehicle {
  drive(): void {}
}

// ------------------------------------------------------------------ factory

export function spawnVehicle(
  hooks: VehicleHooks, kit: ArtKit, kind: VehicleKind, x: number, z: number, yaw: number,
  extra?: { track?: { x: number; y: number; z0: number; z1: number }; s?: number },
): Vehicle {
  const world = hooks.world;
  const model = buildVehicle(kind, kit);
  if (kind === 'train') {
    const track = extra!.track!;
    const s = extra!.s ?? track.z0;
    const sv = world.addVolume('kinematic', model, [track.x - (VEHICLE_DIMS.train[0] * VS) / 2, track.y, s], [0, 0, 0, 1], 'vehicle', {
      colliders: Train.colliders(),
      destructible: false,
    });
    return new Train(hooks, sv, track, s);
  }
  if (kind === 'semi') {
    const { pos, rot } = placeModel(VEHICLE_DIMS.semi, x, 0, z, yaw);
    const sv = world.addVolume('static', model, pos, rot, 'vehicle', { destructible: false });
    return new Semi(hooks, kind, sv);
  }
  const ground = Math.max(0, world.groundHeight(x, z));
  const lift = kind === 'mech' ? 0.05 : 0.35;
  const { pos, rot } = placeModel(VEHICLE_DIMS[kind], x, ground + lift, z, yaw);
  const colliders = kind === 'mech' ? Mech.colliders() : WheeledVehicle.colliders(kind);
  const sv = world.addVolume('dynamic', model, pos, rot, 'vehicle', {
    colliders,
    destructible: false,
    body: { canSleep: false, linearDamping: kind === 'mech' ? 0.1 : 0.05, angularDamping: kind === 'mech' ? 2 : 0.4, ccd: true },
  });
  if (kind === 'mech') {
    world.physics!.setEnabledRotations(sv.body, false, true, false);
    return new Mech(hooks, kind, sv);
  }
  switch (kind) {
    case 'dozer':
      return new Dozer(hooks, kind, sv);
    case 'truck':
      return new Truck(hooks, kind, sv);
    case 'buggy':
      return new Buggy(hooks, kind, sv);
    default:
      return new Bike(hooks, 'bike', sv);
  }
}
