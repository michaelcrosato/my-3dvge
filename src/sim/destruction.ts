/**
 * Destruction: carve spheres or oriented boxes out of volumes, then split what broke off.
 *
 * - Static volumes: voxels no longer connected to an anchor (the volume's bottom layer) become new dynamic
 *   bodies.
 * - Dynamic volumes: every disconnected island becomes its own body (inheriting the parent's velocity).
 * - Islands smaller than `particleThreshold` voxels turn into non-colliding particles instead.
 * - Carving explosive voxels detonates them (chain reactions through world.scheduleExplosion).
 */
import type { Quat, Vec3 } from '../shared/protocol.ts';
import { add, cross, length, quatConj, quatRotate, scale, sub } from '../shared/math.ts';
import { hash3 } from '../voxel/build.ts';
import { VOXEL_SIZE } from '../voxel/constants.ts';
import { MATERIALS } from '../voxel/materials.ts';
import { decodeIndex, findDetached, findIslands, linearIndex, type Island } from '../voxel/flood.ts';
import { VoxelVolume } from '../voxel/volume.ts';
import { PARTICLE_DEBRIS, type SimVolume, type SimWorld } from './world.ts';

export type CarveShape =
  | { kind: 'sphere'; center: Vec3; radius: number }
  | { kind: 'box'; center: Vec3; half: Vec3; rotation: Quat };

export interface CarveOptions {
  /** Only volumes passing this filter are carved (non-destructible volumes are always skipped). */
  filter?: (sv: SimVolume) => boolean;
  /** Push and wake nearby dynamic bodies. Default: true for spheres, false for boxes. */
  shockwave?: boolean;
  /** Probability that a removed voxel becomes a flying debris particle. */
  particleChance?: number;
}

export interface BlastResult {
  hit: boolean;
  center: Vec3;
  removedVoxels: number;
  newBodies: number;
  /** Removed voxels per volume id. */
  perVolume: Map<number, number>;
}

const MAX_CARVE_PARTICLES = 90;
const lastStaticDetonation = new WeakMap<SimVolume, number>();

interface LocalShape {
  center: Vec3; // voxel units, volume-local
  bound: number; // bounding radius, voxel units
  /** Per-axis half extent of the shape's local AABB (voxel units). */
  ext: Vec3;
  sphereR: number;
  axes: Vec3[] | null;
  half: Vec3;
}

function localShape(shape: CarveShape, pos: Vec3, rot: Quat): LocalShape {
  const inv = quatConj(rot);
  const center = scale(quatRotate(inv, sub(shape.center, pos)), 1 / VOXEL_SIZE);
  if (shape.kind === 'sphere') {
    const r = shape.radius / VOXEL_SIZE;
    return { center, bound: r, ext: [r, r, r], sphereR: r, axes: null, half: [r, r, r] };
  }
  const half = scale(shape.half, 1 / VOXEL_SIZE);
  const axes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => quatRotate(inv, quatRotate(shape.rotation, e)));
  const ext: Vec3 = [0, 1, 2].map((i) => Math.abs(axes[0]![i]!) * half[0] + Math.abs(axes[1]![i]!) * half[1] + Math.abs(axes[2]![i]!) * half[2]) as Vec3;
  return { center, bound: length(half), ext, sphereR: 0, axes, half };
}

/** Visits solid voxels of `sv` inside the shape. `fn` returns true to stop early. */
function forVoxelsIn(sv: SimVolume, ls: LocalShape, fn: (x: number, y: number, z: number, v: number, depth: number, dist: number) => boolean | void): void {
  const vol = sv.volume;
  const c = ls.center, e = ls.ext;
  const x0 = Math.max(0, Math.floor(c[0] - e[0])), x1 = Math.min(vol.sizeX - 1, Math.ceil(c[0] + e[0]));
  const y0 = Math.max(0, Math.floor(c[1] - e[1])), y1 = Math.min(vol.sizeY - 1, Math.ceil(c[1] + e[1]));
  const z0 = Math.max(0, Math.floor(c[2] - e[2])), z1 = Math.min(vol.sizeZ - 1, Math.ceil(c[2] + e[2]));
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = vol.get(x, y, z);
        if (!v) continue;
        const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], dz = z + 0.5 - c[2];
        if (ls.axes) {
          let depth = Number.POSITIVE_INFINITY;
          let inside = true;
          for (let i = 0; i < 3; i++) {
            const a = ls.axes[i]!;
            const p = Math.abs(dx * a[0] + dy * a[1] + dz * a[2]);
            const h = ls.half[i]!;
            if (p > h) {
              inside = false;
              break;
            }
            depth = Math.min(depth, h - p);
          }
          if (inside && fn(x, y, z, v, depth, 0)) return;
        } else {
          const d = Math.hypot(dx, dy, dz);
          if (d <= ls.sphereR && fn(x, y, z, v, ls.sphereR - d, d)) return;
        }
      }
}

function overlapsVolume(sv: SimVolume, ls: LocalShape): boolean {
  const vol = sv.volume;
  const c = ls.center;
  const cx = Math.max(0, Math.min(vol.sizeX, c[0]));
  const cy = Math.max(0, Math.min(vol.sizeY, c[1]));
  const cz = Math.max(0, Math.min(vol.sizeZ, c[2]));
  return Math.hypot(cx - c[0], cy - c[1], cz - c[2]) <= ls.bound;
}

export interface SolidQuery {
  count: number;
  /** Solid voxel count per volume. */
  byVolume: Map<SimVolume, number>;
  /** World centroid of the voxels found. */
  centroid: Vec3;
}

/** Counts solid voxels inside a shape without modifying anything (contact tests for vehicles, etc.). */
export function querySolid(world: SimWorld, shape: CarveShape, filter?: (sv: SimVolume) => boolean, voxelFilter?: (paletteIndex: number) => boolean): SolidQuery {
  const byVolume = new Map<SimVolume, number>();
  let count = 0;
  const acc: Vec3 = [0, 0, 0];
  for (const sv of world.volumes.values()) {
    if (filter && !filter(sv)) continue;
    const { pos, rot } = world.volumePose(sv);
    const ls = localShape(shape, pos, rot);
    if (!overlapsVolume(sv, ls)) continue;
    let n = 0;
    const lc: Vec3 = [0, 0, 0];
    forVoxelsIn(sv, ls, (x, y, z, v) => {
      if (voxelFilter && !voxelFilter(v)) return;
      n++;
      lc[0] += x + 0.5;
      lc[1] += y + 0.5;
      lc[2] += z + 0.5;
    });
    if (n === 0) continue;
    byVolume.set(sv, n);
    const w = add(pos, quatRotate(rot, scale(lc, VOXEL_SIZE / n)));
    acc[0] += w[0] * n;
    acc[1] += w[1] * n;
    acc[2] += w[2] * n;
    count += n;
  }
  return { count, byVolume, centroid: count ? scale(acc, 1 / count) : shape.center };
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

function colorOf(world: SimWorld, v: number): [number, number, number] {
  const c = world.palette.colors;
  return [c[v * 4]! / 255, c[v * 4 + 1]! / 255, c[v * 4 + 2]! / 255];
}

/**
 * Removes voxels inside `shape`. Spheres: a voxel of strength S survives beyond radius·√(power/S).
 * Boxes: voxels with strength ≤ power inside the box are removed (with ragged edges).
 */
export function carve(world: SimWorld, shape: CarveShape, power: number, opts: CarveOptions = {}): BlastResult {
  const perVolume = new Map<number, number>();
  let removedVoxels = 0;
  let newBodies = 0;
  let particles = 0;
  const threshold = world.settings.particleThreshold;
  const strengthScale = world.settings.strengthScale;
  const center = shape.center;
  const particleChance = opts.particleChance ?? (shape.kind === 'sphere' ? 0.08 : 0.05);
  const boundM = shape.kind === 'sphere' ? shape.radius : length(shape.half);

  for (const sv of [...world.volumes.values()]) {
    if (!sv.destructible || (opts.filter && !opts.filter(sv))) continue;
    if (!world.volumes.has(sv.id)) continue; // removed by an earlier iteration
    const vol = sv.volume;
    const { pos, rot } = world.volumePose(sv);
    const ls = localShape(shape, pos, rot);
    if (!overlapsVolume(sv, ls)) continue;

    const removed: number[] = [];
    const explosiveAt: Vec3 = [0, 0, 0];
    let explosiveHits = 0;
    const toWorld = (x: number, y: number, z: number): Vec3 => add(pos, quatRotate(rot, [(x + 0.5) * VOXEL_SIZE, (y + 0.5) * VOXEL_SIZE, (z + 0.5) * VOXEL_SIZE]));
    const hits: [number, number, number, number][] = [];
    forVoxelsIn(sv, ls, (x, y, z, v, depth, dist) => {
      const mat = world.palette.material(v);
      const strength = mat.strength * strengthScale;
      if (!Number.isFinite(strength)) return;
      if (shape.kind === 'sphere') {
        if (dist > ls.sphereR * Math.min(1, Math.sqrt(power / Math.max(1e-6, strength)))) return;
      } else {
        if (strength > power) return;
        if (depth < 1 && hash3(x, y, z, 11) < 0.35) return; // ragged edges
      }
      hits.push([x, y, z, v]);
    });
    for (const [x, y, z, v] of hits) {
      vol.set(x, y, z, 0);
      removed.push(linearIndex(vol, x, y, z));
      if (world.palette.material(v).explosive) {
        explosiveHits++;
        explosiveAt[0] += x + 0.5;
        explosiveAt[1] += y + 0.5;
        explosiveAt[2] += z + 0.5;
      }
      if (particles < MAX_CARVE_PARTICLES && world.random() < particleChance) {
        const p = toWorld(x, y, z);
        const dir = sub(p, center);
        const l = length(dir) || 1;
        const speed = 2.5 + world.random() * 4 * Math.min(3, power);
        world.emitParticle(p, [(dir[0] / l) * speed, (dir[1] / l) * speed + 2.5, (dir[2] / l) * speed], colorOf(world, v), PARTICLE_DEBRIS);
        particles++;
      }
    }
    if (removed.length === 0) continue;
    removedVoxels += removed.length;

    // Explosives detonate: dynamic charges go off whole; static ones at the damaged spot.
    if (explosiveHits > 0 && sv.explosive) {
      if (sv.kind === 'dynamic') {
        perVolume.set(sv.id, removed.length);
        world.emit('carved', sv, removed.length, center);
        world.explodeVolume(sv);
        continue;
      }
      const last = lastStaticDetonation.get(sv) ?? -1;
      if (world.time - last > 0.3) {
        lastStaticDetonation.set(sv, world.time);
        const at = toWorld(explosiveAt[0] / explosiveHits - 0.5, explosiveAt[1] / explosiveHits - 0.5, explosiveAt[2] / explosiveHits - 0.5);
        const ex = MATERIALS.find((m) => m.explosive)!.explosive!;
        world.scheduleExplosion(at, ex.radius + Math.min(3, explosiveHits / 400), ex.power);
      }
    }

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
    } else if (sv.kind === 'dynamic') {
      if (vol.voxelCount === 0) {
        perVolume.set(sv.id, removed.length);
        world.emit('carved', sv, removed.length, center);
        world.removeVolume(sv.id);
        continue;
      }
      islands = findIslands(vol);
      keepLargest = true; // the largest island stays in the existing body
    } else {
      islands = [];
    }

    const parentLin: Vec3 = sv.kind === 'dynamic' && world.physics ? world.physics.linvel(sv.body) : [0, 0, 0];
    const parentAng: Vec3 = sv.kind === 'dynamic' && world.physics ? world.physics.angvel(sv.body) : [0, 0, 0];
    const parentCom: Vec3 = sv.kind === 'dynamic' && world.physics ? world.physics.centerOfMass(sv.body) : pos;
    let extracted = 0;

    for (let k = keepLargest ? 1 : 0; k < islands.length; k++) {
      const island = islands[k]!;
      extracted += island.voxels.length;
      if (island.voxels.length < threshold) {
        for (const i of island.voxels) {
          const [x, y, z] = decodeIndex(vol, i);
          const v = vol.get(x, y, z);
          const p = toWorld(x, y, z);
          const dir = sub(p, center);
          const l = length(dir) || 1;
          world.emitParticle(p, add(parentLin, [(dir[0] / l) * 2.5, 1.5 + world.random() * 2, (dir[2] / l) * 2.5]), colorOf(world, v), PARTICLE_DEBRIS);
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
      const push = shape.kind === 'sphere' ? Math.max(0, 1 - dist / (boundM * 2.5)) * power * 2.5 : 0;
      lin = add(lin, scale(away, push / dist));
      const lifetime = world.debrisLifetime !== null ? world.debrisLifetime + world.random() * 3 : undefined;
      world.addVolume('dynamic', piece, origin, rot, 'debris', { velocity: { lin, ang: parentAng }, lifetime });
      newBodies++;
    }
    perVolume.set(sv.id, removed.length + extracted);
    world.emit('carved', sv, removed.length + extracted, center);
    if (sv.kind === 'dynamic' && vol.voxelCount === 0) world.removeVolume(sv.id);
  }

  // Shove and wake nearby dynamic bodies (their support may be gone).
  if (world.physics && removedVoxels > 0) {
    const shock = opts.shockwave ?? shape.kind === 'sphere';
    const r = shock ? boundM * 2.5 : boundM + 1;
    for (const body of world.physics.dynamicBodiesInSphere(center, r)) {
      world.physics.wake(body);
      if (!shock) continue;
      const com = world.physics.centerOfMass(body);
      const away = sub(com, center);
      const dist = length(away) || 1;
      const falloff = Math.max(0, 1 - dist / r);
      const mass = world.physics.mass(body);
      const dv = falloff * power * 4;
      world.physics.applyImpulse(body, scale(away, (Math.min(mass, 400) * dv) / dist));
    }
  }

  return { hit: true, center, removedVoxels, newBodies, perVolume };
}

/** Raycasts from `origin` along `dir` (if given) and carves a sphere at the hit point; otherwise at origin. */
export function blast(world: SimWorld, origin: Vec3, dir?: Vec3, radius = world.settings.blastRadius, power = world.settings.blastPower): BlastResult {
  let center = origin;
  if (dir && world.physics) {
    const hit = world.physics.raycast(origin, dir, 80, world.player?.body);
    if (!hit) return { hit: false, center: origin, removedVoxels: 0, newBodies: 0, perVolume: new Map() };
    center = hit.point;
  }
  return carve(world, { kind: 'sphere', center, radius }, power);
}
