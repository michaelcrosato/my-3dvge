/**
 * Destruction: carve spheres out of volumes, then split what broke off.
 *
 * - Static volumes: voxels no longer connected to an anchor (the volume's bottom layer) become new dynamic
 *   bodies.
 * - Dynamic volumes: every disconnected island becomes its own body (inheriting the parent's velocity).
 * - Islands smaller than `particleThreshold` voxels turn into non-colliding particles instead.
 */
import type { Quat, Vec3 } from '../shared/protocol.ts';
import { SLOT_FLOATS } from '../shared/transforms.ts';
import { add, cross, length, quatConj, quatRotate, scale, sub } from '../shared/math.ts';
import { VOXEL_SIZE } from '../voxel/constants.ts';
import { decodeIndex, findDetached, findIslands, linearIndex, type Island } from '../voxel/flood.ts';
import { VoxelVolume } from '../voxel/volume.ts';
import type { SimVolume, SimWorld } from './world.ts';

/** Particle record: px py pz vx vy vz r g b. */
export const PARTICLE_FLOATS = 9;
const MAX_PARTICLES_PER_BLAST = 220;
const MAX_CARVE_PARTICLES = 90;

export interface BlastResult {
  hit: boolean;
  center: Vec3;
  removedVoxels: number;
  newBodies: number;
  particles: Float32Array;
}

const scratch = new Float32Array(SLOT_FLOATS);

function volumeTransform(world: SimWorld, sv: SimVolume): { pos: Vec3; rot: Quat } {
  if (sv.kind === 'dynamic' && world.physics && sv.body >= 0) {
    world.physics.readTransform(sv.body, scratch, 0);
    return { pos: [scratch[0]!, scratch[1]!, scratch[2]!], rot: [scratch[3]!, scratch[4]!, scratch[5]!, scratch[6]!] };
  }
  return { pos: sv.position, rot: sv.rotation };
}

class ParticleBuffer {
  data: number[] = [];
  count = 0;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }

  push(world: SimWorld, p: Vec3, v: Vec3, paletteIndex: number): void {
    if (this.count >= this.max) return;
    const c = world.palette.colors;
    const o = paletteIndex * 4;
    this.data.push(p[0], p[1], p[2], v[0], v[1], v[2], c[o]! / 255, c[o + 1]! / 255, c[o + 2]! / 255);
    this.count++;
  }
}

/** Cuts `island` out of `sv`'s grid into a new cropped volume (voxels are cleared from the source). */
function extractIsland(sv: SimVolume, island: Island): VoxelVolume {
  const src = sv.volume;
  const [x0, y0, z0] = island.min;
  const out = new VoxelVolume(island.max[0] - x0 + 1, island.max[1] - y0 + 1, island.max[2] - z0 + 1);
  for (const i of island.voxels) {
    const [x, y, z] = decodeIndex(src, i);
    out.set(x - x0, y - y0, z - z0, src.get(x, y, z));
    src.set(x, y, z, 0);
  }
  return out;
}

function islandCentroid(g: VoxelVolume, island: Island): Vec3 {
  let sx = 0, sy = 0, sz = 0;
  for (const i of island.voxels) {
    const [x, y, z] = decodeIndex(g, i);
    sx += x;
    sy += y;
    sz += z;
  }
  const n = island.voxels.length;
  return [(sx / n + 0.5) * VOXEL_SIZE, (sy / n + 0.5) * VOXEL_SIZE, (sz / n + 0.5) * VOXEL_SIZE];
}

/**
 * Removes voxels within `radius` (m) of `center`. A voxel of strength S survives beyond
 * radius·√(power / (S·strengthScale)); bedrock never breaks.
 */
export function carve(world: SimWorld, center: Vec3, radius: number, power: number): BlastResult {
  const particles = new ParticleBuffer(MAX_PARTICLES_PER_BLAST);
  let removedVoxels = 0;
  let newBodies = 0;
  const r = radius / VOXEL_SIZE;
  const threshold = world.settings.particleThreshold;
  const strengthScale = world.settings.strengthScale;

  for (const sv of [...world.volumes.values()]) {
    const vol = sv.volume;
    const { pos, rot } = volumeTransform(world, sv);
    const inv = quatConj(rot);
    const local = scale(quatRotate(inv, sub(center, pos)), 1 / VOXEL_SIZE); // voxel units
    // Sphere vs volume bounds.
    const cx = Math.max(0, Math.min(vol.sizeX, local[0]));
    const cy = Math.max(0, Math.min(vol.sizeY, local[1]));
    const cz = Math.max(0, Math.min(vol.sizeZ, local[2]));
    if (Math.hypot(cx - local[0], cy - local[1], cz - local[2]) > r) continue;

    const removed: number[] = [];
    let carveParticles = 0;
    const toWorld = (x: number, y: number, z: number): Vec3 => add(pos, quatRotate(rot, [(x + 0.5) * VOXEL_SIZE, (y + 0.5) * VOXEL_SIZE, (z + 0.5) * VOXEL_SIZE]));
    for (let z = Math.max(0, Math.floor(local[2] - r)); z <= Math.min(vol.sizeZ - 1, Math.ceil(local[2] + r)); z++)
      for (let y = Math.max(0, Math.floor(local[1] - r)); y <= Math.min(vol.sizeY - 1, Math.ceil(local[1] + r)); y++)
        for (let x = Math.max(0, Math.floor(local[0] - r)); x <= Math.min(vol.sizeX - 1, Math.ceil(local[0] + r)); x++) {
          const v = vol.get(x, y, z);
          if (!v) continue;
          const d = Math.hypot(x + 0.5 - local[0], y + 0.5 - local[1], z + 0.5 - local[2]);
          if (d > r) continue;
          const strength = world.palette.material(v).strength * strengthScale;
          if (!Number.isFinite(strength) || d > r * Math.min(1, Math.sqrt(power / Math.max(1e-6, strength)))) continue;
          vol.set(x, y, z, 0);
          removed.push(linearIndex(vol, x, y, z));
          if (carveParticles < MAX_CARVE_PARTICLES && world.random() < 0.08) {
            const p = toWorld(x, y, z);
            const dir = sub(p, center);
            const l = length(dir) || 1;
            const speed = 3 + world.random() * 5 * power;
            particles.push(world, p, [(dir[0] / l) * speed, (dir[1] / l) * speed + 2.5, (dir[2] / l) * speed], v);
            carveParticles++;
          }
        }
    if (removed.length === 0) continue;
    removedVoxels += removed.length;

    // Seeds: solid voxels 6-adjacent to the hole.
    const seeds = new Set<number>();
    for (const i of removed) {
      const [x, y, z] = decodeIndex(vol, i);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (vol.get(nx, ny, nz)) seeds.add(linearIndex(vol, nx, ny, nz));
      }
    }

    let islands: Island[];
    let keepLargest = false;
    if (sv.kind === 'static') {
      islands = findDetached(vol, seeds, (_x, y) => y === 0);
    } else {
      if (vol.voxelCount === 0) {
        world.removeVolume(sv.id);
        continue;
      }
      islands = findIslands(vol);
      keepLargest = true; // the largest island stays in the existing body
    }

    const parentLin = sv.kind === 'dynamic' && world.physics ? world.physics.linvel(sv.body) : ([0, 0, 0] as Vec3);
    const parentAng = sv.kind === 'dynamic' && world.physics ? world.physics.angvel(sv.body) : ([0, 0, 0] as Vec3);
    const parentCom = sv.kind === 'dynamic' && world.physics ? world.physics.centerOfMass(sv.body) : pos;

    for (let k = keepLargest ? 1 : 0; k < islands.length; k++) {
      const island = islands[k]!;
      if (island.voxels.length < threshold) {
        for (const i of island.voxels) {
          const [x, y, z] = decodeIndex(vol, i);
          const v = vol.get(x, y, z);
          const p = toWorld(x, y, z);
          const dir = sub(p, center);
          const l = length(dir) || 1;
          particles.push(world, p, add(parentLin, [(dir[0] / l) * 2.5, 1.5 + world.random() * 2, (dir[2] / l) * 2.5]), v);
          vol.set(x, y, z, 0);
        }
        continue;
      }
      const centroidLocal = islandCentroid(vol, island);
      const origin = add(pos, quatRotate(rot, scale(island.min, VOXEL_SIZE)));
      const piece = extractIsland(sv, island);
      // Rigid-body velocity at the island's center of mass, plus a push away from the blast.
      const comWorld = add(pos, quatRotate(rot, centroidLocal));
      let lin = add(parentLin, cross(parentAng, sub(comWorld, parentCom)));
      const away = sub(comWorld, center);
      const dist = length(away) || 1;
      const push = Math.max(0, 1 - dist / (radius * 2.5)) * power * 2.5;
      lin = add(lin, scale(away, push / dist));
      world.addVolume('dynamic', piece, origin, rot, 'debris', { lin, ang: parentAng });
      newBodies++;
    }
    if (sv.kind === 'dynamic' && vol.voxelCount === 0) world.removeVolume(sv.id);
  }

  // Shove and wake nearby dynamic bodies (their support may be gone).
  if (world.physics) {
    for (const body of world.physics.dynamicBodiesInSphere(center, radius * 2.5)) {
      world.physics.wake(body);
      const com = world.physics.centerOfMass(body);
      const away = sub(com, center);
      const dist = length(away) || 1;
      const falloff = Math.max(0, 1 - dist / (radius * 2.5));
      const mass = world.physics.mass(body);
      const dv = falloff * power * 4;
      world.physics.applyImpulse(body, scale(away, (Math.min(mass, 400) * dv) / dist));
    }
  }

  return { hit: true, center, removedVoxels, newBodies, particles: new Float32Array(particles.data) };
}

/** Raycasts from `origin` along `dir` (if given) and carves at the hit point; otherwise carves at origin. */
export function blast(world: SimWorld, origin: Vec3, dir?: Vec3, radius = world.settings.blastRadius, power = world.settings.blastPower): BlastResult {
  let center = origin;
  if (dir && world.physics) {
    const hit = world.physics.raycast(origin, dir, 80, world.player?.body);
    if (!hit) return { hit: false, center: origin, removedVoxels: 0, newBodies: 0, particles: new Float32Array(0) };
    center = hit.point;
  }
  return carve(world, center, radius, power);
}
