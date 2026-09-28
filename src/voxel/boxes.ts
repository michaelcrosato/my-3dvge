/**
 * Greedy box merging for colliders: solid voxels become as few axis-aligned boxes as possible (never one
 * collider per voxel). Boxes only contain voxels with the same key (e.g. material), never overlap, and
 * cover every solid voxel in the region exactly once.
 */
import type { VoxelGrid } from './volume.ts';

export interface VoxelBox {
  x0: number;
  y0: number;
  z0: number;
  /** Exclusive upper bounds. */
  x1: number;
  y1: number;
  z1: number;
  key: number;
}

/**
 * @param key maps a palette index (> 0) to a merge key (> 0); voxels merge only with equal keys.
 * Region bounds are [r0, r1) in the grid's voxel coordinates.
 */
export function mergeBoxes(
  grid: VoxelGrid,
  rx0: number, ry0: number, rz0: number,
  rx1: number, ry1: number, rz1: number,
  key: (v: number) => number = () => 1,
): VoxelBox[] {
  const sx = rx1 - rx0, sy = ry1 - ry0, sz = rz1 - rz0;
  if (sx <= 0 || sy <= 0 || sz <= 0) return [];
  const keys = new Int32Array(sx * sy * sz);
  let any = false;
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const v = grid.get(rx0 + x, ry0 + y, rz0 + z);
        if (v !== 0) {
          keys[x + sx * (y + sy * z)] = key(v);
          any = true;
        }
      }
  if (!any) return [];

  const out: VoxelBox[] = [];
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const k = keys[at(x, y, z)]!;
        if (k === 0) continue;
        let x1 = x + 1;
        while (x1 < sx && keys[at(x1, y, z)] === k) x1++;
        let y1 = y + 1;
        growY: while (y1 < sy) {
          for (let xx = x; xx < x1; xx++) if (keys[at(xx, y1, z)] !== k) break growY;
          y1++;
        }
        let z1 = z + 1;
        growZ: while (z1 < sz) {
          for (let yy = y; yy < y1; yy++) for (let xx = x; xx < x1; xx++) if (keys[at(xx, yy, z1)] !== k) break growZ;
          z1++;
        }
        for (let zz = z; zz < z1; zz++) for (let yy = y; yy < y1; yy++) keys.fill(0, at(x, yy, zz), at(x1, yy, zz));
        out.push({ x0: rx0 + x, y0: ry0 + y, z0: rz0 + z, x1: rx0 + x1, y1: ry0 + y1, z1: rz0 + z1, key: k });
      }
  return out;
}

/**
 * Coarse fallback for very irregular debris: treats each `f³` block as solid if any voxel in it is, then
 * merges. Over-approximates the shape but keeps collider counts bounded.
 */
export function mergeBoxesCoarse(grid: VoxelGrid, f: number): VoxelBox[] {
  const cx = Math.ceil(grid.sizeX / f), cy = Math.ceil(grid.sizeY / f), cz = Math.ceil(grid.sizeZ / f);
  const coarse: VoxelGrid = {
    sizeX: cx,
    sizeY: cy,
    sizeZ: cz,
    get(x, y, z) {
      for (let dz = 0; dz < f; dz++)
        for (let dy = 0; dy < f; dy++)
          for (let dx = 0; dx < f; dx++) if (grid.get(x * f + dx, y * f + dy, z * f + dz) !== 0) return 1;
      return 0;
    },
  };
  return mergeBoxes(coarse, 0, 0, 0, cx, cy, cz).map((b) => ({
    x0: b.x0 * f,
    y0: b.y0 * f,
    z0: b.z0 * f,
    x1: Math.min(grid.sizeX, b.x1 * f),
    y1: Math.min(grid.sizeY, b.y1 * f),
    z1: Math.min(grid.sizeZ, b.z1 * f),
    key: 1,
  }));
}
