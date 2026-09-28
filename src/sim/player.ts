import type { PlayerInput, Vec3 } from '../shared/protocol.ts';
import type { CharacterHandle, PhysicsBackend } from './physics/backend.ts';

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HALF_HEIGHT = 0.6;
/** Capsule center above the feet. */
export const PLAYER_CENTER = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;

const WALK = 4.5;
const SPRINT = 7.5;
const JUMP_SPEED = 5.2;
const AIR_CONTROL = 0.35;

export const IDLE_INPUT: PlayerInput = { move: [0, 0], yaw: 0, pitch: 0, jump: false, sprint: false, fly: false, vertical: 0 };

/** First-person walker on Rapier's kinematic character controller (auto-steps one voxel). */
export class Player {
  readonly character: CharacterHandle;
  position: Vec3;
  grounded = false;
  private vel: Vec3 = [0, 0, 0];
  private readonly physics: PhysicsBackend;
  private readonly spawn: Vec3;
  gravity = -9.81;

  constructor(physics: PhysicsBackend, feet: Vec3) {
    this.physics = physics;
    this.spawn = [feet[0], feet[1] + PLAYER_CENTER + 0.05, feet[2]];
    this.position = [...this.spawn];
    this.character = physics.createCharacter(this.position, {
      radius: PLAYER_RADIUS,
      halfHeight: PLAYER_HALF_HEIGHT,
      stepHeight: 0.15,
      maxSlopeDeg: 50,
    });
  }

  get body(): number {
    return this.physics.characterBody(this.character);
  }

  update(dt: number, input: PlayerInput): void {
    if (input.fly) {
      // The free-fly camera is main-thread only; the body waits where it was left.
      this.vel = [0, 0, 0];
      return;
    }
    const [sx, fz] = input.move;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    const speed = input.sprint ? SPRINT : WALK;
    const tx = (-sin * fz + cos * sx) * speed;
    const tz = (-cos * fz - sin * sx) * speed;
    const k = this.grounded ? 1 : AIR_CONTROL;
    this.vel[0] += (tx - this.vel[0]) * Math.min(1, k * 12 * dt);
    this.vel[2] += (tz - this.vel[2]) * Math.min(1, k * 12 * dt);
    if (this.grounded && input.jump) this.vel[1] = JUMP_SPEED;
    else this.vel[1] = Math.max(-40, this.vel[1] + this.gravity * dt);

    const want = this.vel[1] * dt;
    const r = this.physics.moveCharacter(this.character, [this.vel[0] * dt, want, this.vel[2] * dt]);
    const got = r.position[1] - this.position[1];
    if (r.grounded && this.vel[1] < 0) this.vel[1] = 0; // landed
    if (want > 0 && got < want * 0.5) this.vel[1] = 0; // bumped a ceiling
    this.grounded = r.grounded;
    this.position = r.position;

    if (this.position[1] < -30) this.respawn();
  }

  respawn(): void {
    this.vel = [0, 0, 0];
    this.position = [...this.spawn];
    this.physics.teleportCharacter(this.character, this.position);
  }
}
