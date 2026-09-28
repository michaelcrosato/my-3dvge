/**
 * 6-connected flood fills used by destruction.
 *
 * - findIslands: labels every connected component of a (small) dynamic volume.
 * - findDetached: for a (large) static volume, starts a depth-first search from each seed voxel next to
 *   a carved hole, diving downward first, and stops as soon as it reaches an anchor voxel. Components that
 *   exhaust without touching an anchor are detached; searches that exceed `limit` voxels are assumed
 *   anchored (keeps huge structures cheap).
 */
import type { VoxelGrid } from './volume.ts';

export interface Island {
  /** Linear indices x + sx·(y + sy·z). */
  voxels: number[];
  min: [number, number, number];
  max: [number, number, number];
}

export function linearIndex(g: VoxelGrid, x: number, y: number, z: number): number {
  return x + g.sizeX * (y + g.sizeY * z);
}

export function decodeIndex(g: VoxelGrid, i: number): [number, number, number] {
  const x = i % g.sizeX;
  const r = (i - x) / g.sizeX;
  const y = r % g.sizeY;
  return [x, y, (r - y) / g.sizeY];
}

function islandFrom(g: VoxelGrid, voxels: number[]): Island {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of voxels) {
    const [x, y, z] = decodeIndex(g, i);
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { voxels, min, max };
}

/** Pushes the in-bounds solid 6-neighbors of (x,y,z); -y is pushed last so a stack pops it first. */
function forNeighbors(g: VoxelGrid, x: number, y: number, z: number, fn: (i: number) => void): void {
  const sx = g.sizeX, sy = g.sizeY, sz = g.sizeZ;
  if (y + 1 < sy && g.get(x, y + 1, z)) fn(linearIndex(g, x, y + 1, z));
  if (x + 1 < sx && g.get(x + 1, y, z)) fn(linearIndex(g, x + 1, y, z));
  if (x > 0 && g.get(x - 1, y, z)) fn(linearIndex(g, x - 1, y, z));
  if (z + 1 < sz && g.get(x, y, z + 1)) fn(linearIndex(g, x, y, z + 1));
  if (z > 0 && g.get(x, y, z - 1)) fn(linearIndex(g, x, y, z - 1));
  if (y > 0 && g.get(x, y - 1, z)) fn(linearIndex(g, x, y - 1, z));
}

/** All connected components of solid voxels, largest first. */
export function findIslands(g: VoxelGrid): Island[] {
  const n = g.sizeX * g.sizeY * g.sizeZ;
  const seen = new Uint8Array(n);
  const islands: Island[] = [];
  const stack: number[] = [];
  for (let z = 0; z < g.sizeZ; z++)
    for (let y = 0; y < g.sizeY; y++)
      for (let x = 0; x < g.sizeX; x++) {
        const start = linearIndex(g, x, y, z);
        if (seen[start] || !g.get(x, y, z)) continue;
        const voxels: number[] = [];
        seen[start] = 1;
        stack.push(start);
        while (stack.length) {
          const i = stack.pop()!;
          voxels.push(i);
          const [cx, cy, cz] = decodeIndex(g, i);
          forNeighbors(g, cx, cy, cz, (j) => {
            if (!seen[j]) {
              seen[j] = 1;
              stack.push(j);
            }
          });
        }
        islands.push(islandFrom(g, voxels));
      }
  return islands.sort((a, b) => b.voxels.length - a.voxels.length);
}

/**
 * Components reachable from `seeds` (linear indices of solid voxels) that do not touch an anchor voxel.
 * @param limit voxels explored per search before giving up and treating the component as anchored.
 */
export function findDetached(
  g: VoxelGrid,
  seeds: Iterable<number>,
  isAnchor: (x: number, y: number, z: number) => boolean,
  limit = 150_000,
): Island[] {
  const anchored = new Set<number>();
  const detached = new Set<number>();
  const islands: Island[] = [];
  for (const seed of seeds) {
    if (anchored.has(seed) || detached.has(seed)) continue;
    const [sx0, sy0, sz0] = decodeIndex(g, seed);
    if (!g.get(sx0, sy0, sz0)) continue;
    const visited = new Set<number>([seed]);
    const stack = [seed];
    let isAnchored = false;
    while (stack.length) {
      const i = stack.pop()!;
      const [x, y, z] = decodeIndex(g, i);
      if (isAnchor(x, y, z) || anchored.has(i) || visited.size > limit) {
        isAnchored = true;
        break;
      }
      forNeighbors(g, x, y, z, (j) => {
        if (!visited.has(j)) {
          visited.add(j);
          stack.push(j);
        }
      });
    }
    if (isAnchored) {
      for (const i of visited) anchored.add(i);
    } else {
      for (const i of visited) detached.add(i);
      islands.push(islandFrom(g, [...visited]));
    }
  }
  return islands;
}
