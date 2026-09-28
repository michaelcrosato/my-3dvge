/**
 * Shape helpers for building volumes procedurally (all coordinates in voxels, boxes are [min, max)).
 * `Fill` is a palette index or a function choosing one per voxel (for shading/patterns).
 */
import type { VoxelVolume } from './volume.ts';

export type Fill = number | ((x: number, y: number, z: number) => number);

const pick = (f: Fill, x: number, y: number, z: number) => (typeof f === 'number' ? f : f(x, y, z));

export function box(v: VoxelVolume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, fill: Fill): void {
  v.fillBox(x0, y0, z0, x1, y1, z1, fill);
}

/** Hollow box with walls `t` voxels thick, open or closed top. */
export function hollowBox(
  v: VoxelVolume,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  t: number, fill: Fill, closedTop = true,
): void {
  for (let z = z0; z < z1; z++)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const wall = x < x0 + t || x >= x1 - t || z < z0 + t || z >= z1 - t || y < y0 + t || (closedTop && y >= y1 - t);
        if (wall) v.set(x, y, z, pick(fill, x, y, z));
      }
}

export function clearBox(v: VoxelVolume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  v.fillBox(x0, y0, z0, x1, y1, z1, 0);
}

export function sphere(v: VoxelVolume, cx: number, cy: number, cz: number, r: number, fill: Fill): void {
  const r2 = r * r;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) v.set(x, y, z, pick(fill, x, y, z));
      }
}

/** Vertical cylinder standing on y0. */
export function cylinder(v: VoxelVolume, cx: number, y0: number, cz: number, r: number, h: number, fill: Fill): void {
  const r2 = r * r;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (dx * dx + dz * dz <= r2) for (let y = y0; y < y0 + h; y++) v.set(x, y, z, pick(fill, x, y, z));
    }
}

/** Deterministic hash → [0,1), for stable per-voxel/per-block color variation. */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Picks one of `shades` per block of `bx×by×bz` voxels (keeps greedy meshing effective). */
export function blockShade(shades: readonly number[], bx: number, by: number, bz: number, seed = 0): (x: number, y: number, z: number) => number {
  return (x, y, z) => shades[Math.floor(hash3(Math.floor(x / bx), Math.floor(y / by), Math.floor(z / bz), seed) * shades.length)]!;
}

/** Running-bond brick pattern: bricks of `bw×bh` with 1-voxel mortar lines. */
export function brickPattern(bricks: readonly number[], mortar: number, bw = 4, bh = 2): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    const row = Math.floor(y / (bh + 1));
    if (y % (bh + 1) === bh) return mortar;
    const u = x + z + (row % 2) * Math.floor(bw / 2);
    if (u % (bw + 1) === bw) return mortar;
    return bricks[Math.floor(hash3(Math.floor(u / (bw + 1)), row, 0, 7) * bricks.length)]!;
  };
}
