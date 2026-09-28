import * as THREE from 'three/webgpu';
import { VOXEL_SIZE } from '../voxel/constants.ts';

const FLOATS = 9; // px py pz vx vy vz r g b (matches sim/destruction PARTICLE_FLOATS)
const GRAVITY = -9.81;

/**
 * Non-colliding voxel debris: one InstancedMesh (a single draw call), simulated on the main thread
 * (a few hundred ballistic points is trivial) and recycled oldest-first.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly spin: Float32Array;
  private count = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(capacity = 1536) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
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

  spawn(data: Float32Array): void {
    const n = Math.floor(data.length / FLOATS);
    for (let k = 0; k < n; k++) {
      // Full: overwrite a random existing particle (cheap and visually fine).
      const i = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
      const o = k * FLOATS;
      this.pos.set(data.subarray(o, o + 3), i * 3);
      this.vel.set(data.subarray(o + 3, o + 6), i * 3);
      this.maxLife[i] = this.life[i] = 1.2 + Math.random() * 1.3;
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
          this.mesh.getColorAt(last, this.color);
          this.mesh.setColorAt(i, this.color);
          colorsMoved = true;
        }
        continue;
      }
      const o = i * 3;
      this.vel[o + 1]! += GRAVITY * dt;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      const t = this.life[i]! / this.maxLife[i]!;
      const a = this.spin[i]! * (1 - t);
      this.q.setFromEuler(this.e.set(a, a * 0.7, 0));
      this.s.setScalar(Math.min(1, t * 2.5));
      this.m.compose(this.p.set(this.pos[o]!, this.pos[o + 1]!, this.pos[o + 2]!), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsMoved && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
