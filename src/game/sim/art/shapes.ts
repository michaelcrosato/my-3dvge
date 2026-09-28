/**
 * Shape helpers for the voxel art. Coordinates are voxels; boxes are [min, max). A `Fill` is a palette
 * index or a per-voxel function (use block-level patterns, not per-voxel noise, to keep meshes cheap).
 */
import { hash3 } from '../../../voxel/build.ts';
import type { VoxelVolume } from '../../../voxel/volume.ts';

export type Fill = number | ((x: number, y: number, z: number) => number);

export function at(f: Fill, x: number, y: number, z: number): number {
  return typeof f === 'number' ? f : f(x, y, z);
}

export function box(v: VoxelVolume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: Fill): void {
  v.fillBox(Math.round(x0), Math.round(y0), Math.round(z0), Math.round(x1), Math.round(y1), Math.round(z1), f);
}

export function clear(v: VoxelVolume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  box(v, x0, y0, z0, x1, y1, z1, 0);
}

/** Four walls `t` thick around [x0,x1)×[z0,z1), from y0 to y1 (no floor/roof). */
export function walls(v: VoxelVolume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, f: Fill): void {
  box(v, x0, y0, z0, x1, y1, z0 + t, f);
  box(v, x0, y0, z1 - t, x1, y1, z1, f);
  box(v, x0, y0, z0, x0 + t, y1, z1, f);
  box(v, x1 - t, y0, z0, x1, y1, z1, f);
}

function ring(da: number, db: number, r: number, inner: number): boolean {
  const d = Math.hypot(da, db);
  return d <= r && d >= inner;
}

/** Vertical cylinder (axis y) centered at (cx, cz) in voxel coordinates. */
export function cylY(v: VoxelVolume, cx: number, cz: number, r: number, y0: number, y1: number, f: Fill, inner = 0): void {
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!ring(x + 0.5 - cx, z + 0.5 - cz, r, inner)) continue;
      for (let y = y0; y < y1; y++) v.set(x, y, z, at(f, x, y, z));
    }
}

/** Cylinder with its axis along x (wheels, hay bales), centered at (cy, cz). */
export function cylX(v: VoxelVolume, cy: number, cz: number, r: number, x0: number, x1: number, f: Fill, inner = 0): void {
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      if (!ring(y + 0.5 - cy, z + 0.5 - cz, r, inner)) continue;
      for (let x = x0; x < x1; x++) v.set(x, y, z, at(f, x, y, z));
    }
}

/** Cylinder with its axis along z, centered at (cx, cy). */
export function cylZ(v: VoxelVolume, cx: number, cy: number, r: number, z0: number, z1: number, f: Fill, inner = 0): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!ring(x + 0.5 - cx, y + 0.5 - cy, r, inner)) continue;
      for (let z = z0; z < z1; z++) v.set(x, y, z, at(f, x, y, z));
    }
}

/** Solid ellipsoid. */
export function ellipsoid(v: VoxelVolume, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, f: Fill): void {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1) v.set(x, y, z, at(f, x, y, z));
      }
}

/** A wheel (axle along x) spanning x0..x1: tire, hub disc on both faces. */
export function wheelX(v: VoxelVolume, x0: number, x1: number, cy: number, cz: number, r: number, tire: number, hub: number): void {
  cylX(v, cy, cz, r, x0, x1, tire);
  const hr = Math.max(1, r * 0.45);
  cylX(v, cy, cz, hr, x0, x0 + 1, hub);
  cylX(v, cy, cz, hr, x1 - 1, x1, hub);
}

/** Diagonal hazard stripes. */
export function hazard(a: number, b: number, period = 4): Fill {
  return (x, y, z) => (Math.floor((x + y + z) / period) % 2 === 0 ? a : b);
}

/** Two shades chosen per block (cheap for greedy meshing). */
export function shade(a: number, b: number, bx: number, by: number, bz: number, seed = 0): Fill {
  return (x, y, z) => (hash3(Math.floor(x / bx), Math.floor(y / by), Math.floor(z / bz), seed) < 0.5 ? a : b);
}

/** Horizontal bands every `h` voxels (clapboard, ribs). */
export function bandsY(a: number, b: number, h: number, offset = 0): Fill {
  return (_x, y) => (Math.floor((y + offset) / h) % 2 === 0 ? a : b);
}

/** Vertical stripes: along x on z-facing walls and along z on x-facing walls. */
export function stripes(a: number, b: number, w: number): Fill {
  return (x, _y, z) => (Math.floor((x + z) / w) % 2 === 0 ? a : b);
}

/**
 * A roof whose ridge runs along z over [x0,x1)×[z0,z1): height above yBase at distance `d` (voxels) from
 * the nearer eave is profile(d). Fills a `t`-thick roof skin and, if `gable` is given, the gable-end
 * triangles (`gt` thick) at both z ends.
 */
export function roofZ(
  v: VoxelVolume, x0: number, x1: number, z0: number, z1: number, yBase: number,
  profile: (d: number) => number, t: number, roof: Fill, gable?: Fill, gt = 2, gz0 = z0, gz1 = z1,
): void {
  for (let x = x0; x < x1; x++) {
    const d = Math.min(x - x0 + 0.5, x1 - x - 0.5);
    const top = yBase + Math.floor(profile(d));
    if (gable !== undefined && top - t > yBase) {
      box(v, x, yBase, gz0, x + 1, top - t + 1, gz0 + gt, gable);
      box(v, x, yBase, gz1 - gt, x + 1, top - t + 1, gz1, gable);
    }
    box(v, x, Math.max(yBase, top - t + 1), z0, x + 1, top + 1, z1, roof);
  }
}

/** Same as roofZ with the ridge along x (gables at the x ends). */
export function roofX(
  v: VoxelVolume, x0: number, x1: number, z0: number, z1: number, yBase: number,
  profile: (d: number) => number, t: number, roof: Fill, gable?: Fill, gt = 2, gx0 = x0, gx1 = x1,
): void {
  for (let z = z0; z < z1; z++) {
    const d = Math.min(z - z0 + 0.5, z1 - z - 0.5);
    const top = yBase + Math.floor(profile(d));
    if (gable !== undefined && top - t > yBase) {
      box(v, gx0, yBase, z, gx0 + gt, top - t + 1, z + 1, gable);
      box(v, gx1 - gt, yBase, z, gx1, top - t + 1, z + 1, gable);
    }
    box(v, x0, Math.max(yBase, top - t + 1), z, x1, top + 1, z + 1, roof);
  }
}

export type Face = 'z0' | 'z1' | 'x0' | 'x1';

/**
 * A framed opening (window or door) set into a wall face. `u0..u1` runs along the wall (x for z-faces,
 * z for x-faces), `y0..y1` vertically; `plane` is the outer wall coordinate, `t` the wall thickness.
 */
export function opening(
  v: VoxelVolume, face: Face, plane: number, u0: number, u1: number, y0: number, y1: number, t: number,
  fill: Fill, frame?: number,
): void {
  const put = (a0: number, b0: number, a1: number, b1: number, f: Fill, depth: number) => {
    if (face === 'z0') box(v, a0, b0, plane, a1, b1, plane + depth, f);
    else if (face === 'z1') box(v, a0, b0, plane - depth + 1, a1, b1, plane + 1, f);
    else if (face === 'x0') box(v, plane, b0, a0, plane + depth, b1, a1, f);
    else box(v, plane - depth + 1, b0, a0, plane + 1, b1, a1, f);
  };
  if (frame !== undefined) put(u0 - 1, y0 - 1, u1 + 1, y1 + 1, frame, 1);
  put(u0, y0, u1, y1, fill, t);
}

/** Evenly spaced windows along a face between u0 and u1; `skip` can leave a gap (e.g. for a door). */
export function windowRow(
  v: VoxelVolume, face: Face, plane: number, u0: number, u1: number, y0: number, y1: number, t: number,
  width: number, spacing: number, glass: Fill, frame?: number, skip?: (u0: number, u1: number) => boolean,
): void {
  const span = u1 - u0;
  const n = Math.max(1, Math.floor((span - width) / spacing) + 1);
  const start = u0 + Math.floor((span - (n - 1) * spacing - width) / 2);
  for (let i = 0; i < n; i++) {
    const u = start + i * spacing;
    if (skip?.(u, u + width)) continue;
    opening(v, face, plane, u, u + width, y0, y1, t, glass, frame);
  }
}
