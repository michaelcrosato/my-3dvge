import * as THREE from 'three/webgpu';
import { VOXEL_SIZE } from '../voxel/constants.ts';

/** px py pz vx vy vz r g b kind — matches PARTICLE_FLOATS in sim/world.ts. */
const FLOATS = 10;
const GRAVITY = -9.81;
const KIND_SMOKE = 1;
const KIND_FIRE = 2;

/**
 * Non-colliding voxel particles in one InstancedMesh (a single draw call), simulated on the main thread
 * and recycled. Kinds: 0 debris (falls, tumbles, shrinks), 1 smoke/dust (rises, grows, slows),
 * 2 fire (short-lived, light gravity).
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly spin: Float32Array;
  private readonly kind: Uint8Array;
  private count = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    const geo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  spawn(data: Float32Array): void {
    const n = Math.floor(data.length / FLOATS);
    for (let k = 0; k < n; k++) {
      // Full: overwrite a random existing particle (cheap and visually fine).
      const i = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
      const o = k * FLOATS;
      this.pos.set(data.subarray(o, o + 3), i * 3);
      this.vel.set(data.subarray(o + 3, o + 6), i * 3);
      const kind = data[o + 9]! | 0;
      this.kind[i] = kind;
      this.maxLife[i] = this.life[i] = kind === KIND_SMOKE ? 1.8 + Math.random() * 1.6 : kind === KIND_FIRE ? 0.35 + Math.random() * 0.4 : 1.2 + Math.random() * 1.3;
      this.spin[i] = (Math.random() - 0.5) * 12;
      this.mesh.setColorAt(i, this.color.setRGB(data[o + 6]!, data[o + 7]!, data[o + 8]!));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.count === 0) return;
    let i = 0;
    let colorsMoved = false;
    while (i < this.count) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        // Swap-remove with the last live particle.
        const last = --this.count;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.life[i] = this.life[last]!;
          this.maxLife[i] = this.maxLife[last]!;
          this.spin[i] = this.spin[last]!;
          this.kind[i] = this.kind[last]!;
          this.mesh.getColorAt(last, this.color);
          this.mesh.setColorAt(i, this.color);
          colorsMoved = true;
        }
        continue;
      }
      const o = i * 3;
      const kind = this.kind[i]!;
      const t = this.life[i]! / this.maxLife[i]!;
      let size: number;
      if (kind === KIND_SMOKE) {
        const drag = Math.max(0, 1 - 1.6 * dt);
        this.vel[o]! *= drag;
        this.vel[o + 2]! *= drag;
        this.vel[o + 1] = this.vel[o + 1]! * drag + 0.25 * dt;
        size = (2 + (1 - t) * 7) * Math.min(1, t * 3);
      } else if (kind === KIND_FIRE) {
        this.vel[o + 1]! += GRAVITY * 0.25 * dt;
        size = 2.5 * t + 0.5;
      } else {
        this.vel[o + 1]! += GRAVITY * dt;
        size = Math.min(1, t * 2.5);
      }
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      const a = this.spin[i]! * (1 - t);
      this.q.setFromEuler(this.e.set(a, a * 0.7, 0));
      this.s.setScalar(size);
      this.m.compose(this.p.set(this.pos[o]!, this.pos[o + 1]!, this.pos[o + 2]!), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsMoved && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
