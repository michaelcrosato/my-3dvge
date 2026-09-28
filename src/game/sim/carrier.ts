/**
 * The Hazard Carrier: a kinematic voxel transporter rolling in a dead-straight line along +x. It crushes
 * fences and hay, and explodes on the first building voxel in its lane. Lane obstacles are precomputed
 * per structure as the sorted x positions of their voxels inside the carrier's swept box, so the
 * look-ahead ("12 s to impact") and the collision test are exact against the remaining geometry and cost
 * almost nothing per step.
 */
import type { Vec3 } from '../../shared/protocol.ts';
import { carve } from '../../sim/destruction.ts';
import type { SimVolume, SimWorld } from '../../sim/world.ts';
import { rotateAdd } from '../../sim/world.ts';
import { CARRIER_DIMS, buildCarrier, type ArtKit } from './art/index.ts';
import { placeModel, VS } from './util.ts';

interface CorridorList {
  sv: SimVolume;
  /** Lane-axis positions (world x of the voxel's near face), ascending. */
  xs: Float32Array;
  /** Volume-local voxel coords packed x | y<<10 | z<<20 matching xs. */
  voxels: Int32Array;
  ptr: number;
}

export class Carrier {
  readonly world: SimWorld;
  readonly sv: SimVolume;
  readonly laneZ: number;
  readonly startFront: number;
  readonly endFront: number;
  readonly baseSpeed: number;
  readonly length = CARRIER_DIMS[2] * VS;
  readonly width = CARRIER_DIMS[0] * VS;
  readonly height = CARRIER_DIMS[1] * VS;
  /** x of the carrier's front bumper. */
  front: number;
  rolling = false;
  fastForward = false;
  private corridor: CorridorList[] = [];

  constructor(world: SimWorld, kit: ArtKit, lane: { x0: number; x1: number; z: number; speed: number }) {
    this.world = world;
    this.laneZ = lane.z;
    this.startFront = lane.x0;
    this.endFront = lane.x1;
    this.baseSpeed = lane.speed;
    this.front = lane.x0;
    const model = buildCarrier(kit);
    const { pos, rot } = this.pose();
    this.sv = world.addVolume('kinematic', model, pos, rot, 'prop', {
      destructible: false,
      colliders: [{ cx: this.width / 2, cy: 1.45, cz: this.length / 2, hx: this.width / 2, hy: 1.1, hz: this.length / 2, density: 1000, friction: 0.6, restitution: 0 }],
    });
  }

  get speed(): number {
    return this.rolling ? this.baseSpeed * (this.fastForward ? 5 : 1) : 0;
  }

  /** 0..1 along the lane. */
  get progress(): number {
    return Math.min(1, Math.max(0, (this.front - this.startFront) / (this.endFront - this.startFront)));
  }

  get centerX(): number {
    return this.front - this.length / 2;
  }

  private pose() {
    return placeModel(CARRIER_DIMS, this.front - this.length / 2, 0.02, this.laneZ, -Math.PI / 2);
  }

  /** Is a world point inside the carrier's hull box (expanded by `margin`)? Returns the distance outside (≤ 0 inside). */
  distanceTo(p: Vec3): number {
    const dx = Math.max(this.front - this.length - p[0], 0, p[0] - this.front);
    const dz = Math.max(Math.abs(p[2] - this.laneZ) - this.width / 2, 0);
    const dy = Math.max(-p[1], 0, p[1] - this.height);
    return Math.hypot(dx, dy, dz);
  }

  /** Records every voxel of `sv` inside the carrier's swept box (call once per structure after the build). */
  addObstacle(sv: SimVolume): number {
    const { pos, rot } = this.world.volumePose(sv);
    const half = this.width / 2 + 0.05;
    const xs: number[] = [];
    const vox: number[] = [];
    sv.volume.forEachSolid((x, y, z) => {
      const p = rotateAdd(pos, rot, [(x + 0.5) * VS, (y + 0.5) * VS, (z + 0.5) * VS]);
      if (Math.abs(p[2] - this.laneZ) <= half && p[1] <= this.height + 0.1 && p[1] > -0.5) {
        xs.push(p[0] - VS / 2);
        vox.push(x | (y << 10) | (z << 20));
      }
    });
    if (xs.length === 0) return 0;
    const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
    this.corridor.push({ sv, xs: Float32Array.from(order, (i) => xs[i]!), voxels: Int32Array.from(order, (i) => vox[i]!), ptr: 0 });
    return xs.length;
  }

  /** First remaining lane voxel per obstacle volume still in the world (sorted by x). */
  obstacles(): { sv: SimVolume; x: number }[] {
    const out: { sv: SimVolume; x: number }[] = [];
    for (const c of this.corridor) {
      if (!this.world.volumes.has(c.sv.id)) continue;
      const vol = c.sv.volume;
      while (c.ptr < c.xs.length) {
        const p = c.voxels[c.ptr]!;
        if (vol.get(p & 1023, (p >> 10) & 1023, (p >> 20) & 1023) !== 0) break;
        c.ptr++;
      }
      if (c.ptr < c.xs.length && c.xs[c.ptr]! > this.front - this.length) out.push({ sv: c.sv, x: c.xs[c.ptr]! });
    }
    return out.sort((a, b) => a.x - b.x);
  }

  /** Moves the carrier (before physics) and crushes small props in front of it. */
  move(dt: number, crushable: (sv: SimVolume) => boolean): void {
    if (this.rolling) {
      this.front = Math.min(this.endFront, this.front + this.speed * dt);
      if (this.front >= this.endFront) this.rolling = false;
    }
    const { pos, rot } = this.pose();
    this.world.setKinematicPose(this.sv.id, pos, rot);
    if (this.rolling) {
      carve(this.world, { kind: 'box', center: [this.front + 0.35, this.height / 2, this.laneZ], half: [0.45, this.height / 2, this.width / 2 + 0.2], rotation: [0, 0, 0, 1] }, 10, {
        filter: crushable,
        particleChance: 0.25,
      });
    }
  }

  /** Center of the hull (for explosions and cameras). */
  center(): Vec3 {
    return rotateAdd(this.pose().pos, this.pose().rot, [this.width / 2, this.height / 2, this.length / 2]);
  }
}
