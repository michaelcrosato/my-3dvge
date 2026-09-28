/**
 * Physics abstraction. The simulation only talks to this interface so another engine (e.g. Jolt) can be
 * swapped in without touching destruction or game code. Handles are opaque numbers.
 */
import type { Quat, Vec3 } from '../../shared/protocol.ts';

export type BodyHandle = number;
export type ColliderGroup = number;
export type CharacterHandle = number;
export type BodyType = 'fixed' | 'dynamic' | 'kinematic';

/** A box collider in body-local space (center + half extents, meters). */
export interface BoxShape {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  /** kg/m³ */
  density: number;
  friction: number;
  restitution: number;
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

export interface PhysicsBackend {
  readonly name: string;
  setGravity(y: number): void;
  step(dt: number): void;

  createBody(type: BodyType, position: Vec3, rotation: Quat): BodyHandle;
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
  mass(body: BodyHandle): number;
  /** World-space center of mass. */
  centerOfMass(body: BodyHandle): Vec3;
  isSleeping(body: BodyHandle): boolean;
  sleep(body: BodyHandle): void;
  wake(body: BodyHandle): void;

  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeBody?: BodyHandle): RayHit | null;
  /** Dynamic bodies whose colliders intersect a sphere. */
  dynamicBodiesInSphere(center: Vec3, radius: number): BodyHandle[];

  createCharacter(position: Vec3, opts: CharacterOptions): CharacterHandle;
  /** Moves a character by a desired delta with collision + autostep; returns its new center. */
  moveCharacter(ch: CharacterHandle, desired: Vec3): { position: Vec3; grounded: boolean };
  characterBody(ch: CharacterHandle): BodyHandle;
  teleportCharacter(ch: CharacterHandle, position: Vec3): void;

  colliderCount(): number;
}
