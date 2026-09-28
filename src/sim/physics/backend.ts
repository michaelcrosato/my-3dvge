/**
 * Physics abstraction. The simulation only talks to this interface so another engine (e.g. Jolt) can be
 * swapped in without touching destruction or game code. Handles are opaque numbers.
 */
import type { Quat, Vec3 } from '../../shared/protocol.ts';

export type BodyHandle = number;
export type ColliderGroup = number;
export type CharacterHandle = number;
export type VehicleHandle = number;
export type BodyType = 'fixed' | 'dynamic' | 'kinematic';

/** A box collider in body-local space (center + half extents, meters). */
export interface BoxShape {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  /** kg/m³ (ignored when `mass` is given). */
  density: number;
  friction: number;
  restitution: number;
  /** Explicit mass properties (e.g. a low center of mass for vehicles). */
  mass?: { mass: number; com: Vec3; inertia: Vec3 };
  sensor?: boolean;
}

export interface BodyOptions {
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
  gravityScale?: number;
  canSleep?: boolean;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  body: BodyHandle | null;
}

export interface CharacterOptions {
  radius: number;
  halfHeight: number;
  /** Highest step climbed automatically (m). */
  stepHeight: number;
  maxSlopeDeg: number;
}

/** A raycast wheel in chassis space. Suspension points straight down; the axle is the chassis x axis. */
export interface WheelDesc {
  position: Vec3;
  radius: number;
  suspensionRest: number;
  maxTravel: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  maxForce: number;
  frictionSlip: number;
  sideFriction: number;
}

export interface WheelControl {
  engine: number;
  brake: number;
  /** Radians, positive turns toward chassis -x (left when facing -z). */
  steer: number;
}

export interface PhysicsBackend {
  readonly name: string;
  setGravity(y: number): void;
  step(dt: number): void;

  createBody(type: BodyType, position: Vec3, rotation: Quat, opts?: BodyOptions): BodyHandle;
  removeBody(body: BodyHandle): void;
  /** Attaches boxes to a body as one compound; returns a handle to remove them together. */
  addBoxes(body: BodyHandle, boxes: readonly BoxShape[]): ColliderGroup;
  removeColliders(group: ColliderGroup): void;

  /** Writes px,py,pz,qx,qy,qz,qw at `offset`. */
  readTransform(body: BodyHandle, out: Float32Array, offset: number): void;
  linvel(body: BodyHandle): Vec3;
  angvel(body: BodyHandle): Vec3;
  setVelocity(body: BodyHandle, lin: Vec3, ang: Vec3): void;
  applyImpulse(body: BodyHandle, impulse: Vec3, point?: Vec3): void;
  applyTorqueImpulse(body: BodyHandle, impulse: Vec3): void;
  addForce(body: BodyHandle, force: Vec3): void;
  mass(body: BodyHandle): number;
  /** World-space center of mass. */
  centerOfMass(body: BodyHandle): Vec3;
  isSleeping(body: BodyHandle): boolean;
  sleep(body: BodyHandle): void;
  wake(body: BodyHandle): void;
  /** Kinematic bodies: pose reached at the end of the next step. */
  setKinematicTarget(body: BodyHandle, position: Vec3, rotation: Quat): void;
  /** Teleports a body (optionally zeroing its velocity). */
  setPose(body: BodyHandle, position: Vec3, rotation: Quat, resetVelocity?: boolean): void;
  setGravityScale(body: BodyHandle, scale: number): void;
  setLinvel(body: BodyHandle, v: Vec3): void;
  setAngvel(body: BodyHandle, w: Vec3): void;
  /** Allow rotation only about the chosen world axes (e.g. y only for upright walkers). */
  setEnabledRotations(body: BodyHandle, x: boolean, y: boolean, z: boolean): void;

  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeBody?: BodyHandle): RayHit | null;
  /** Dynamic bodies whose colliders intersect a sphere. */
  dynamicBodiesInSphere(center: Vec3, radius: number): BodyHandle[];

  createCharacter(position: Vec3, opts: CharacterOptions): CharacterHandle;
  /** Moves a character by a desired delta with collision + autostep; returns its new center. */
  moveCharacter(ch: CharacterHandle, desired: Vec3): { position: Vec3; grounded: boolean };
  characterBody(ch: CharacterHandle): BodyHandle;
  teleportCharacter(ch: CharacterHandle, position: Vec3): void;
  setCharacterEnabled(ch: CharacterHandle, enabled: boolean): void;

  /** Raycast-suspension vehicle on an existing dynamic chassis body. */
  createVehicle(chassis: BodyHandle, wheels: readonly WheelDesc[]): VehicleHandle;
  /** Applies wheel controls and integrates suspension/tire forces; call before step(). */
  updateVehicle(v: VehicleHandle, dt: number, controls: readonly WheelControl[]): void;
  wheelContacts(v: VehicleHandle): boolean[];
  setWheelGrip(v: VehicleHandle, wheel: number, frictionSlip: number, sideFriction: number): void;
  removeVehicle(v: VehicleHandle): void;

  colliderCount(): number;
}
