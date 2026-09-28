import type { MaterialName } from '../voxel/materials.ts';
import { MATERIALS } from '../voxel/materials.ts';
import type { Palette } from '../voxel/palette.ts';
import { VoxelVolume } from '../voxel/volume.ts';
import { voxGet, type VoxFile } from '../voxel/vox.ts';

/**
 * A loaded .vox file bound to the world palette. Converts .vox space (z up) to engine space (y up):
 * engine (x, y, z) = vox (x, z, sy-1-y).
 */
export interface VoxAsset {
  readonly file: VoxFile;
  /** Engine-space size (voxels) of a model. */
  size(model?: number): [number, number, number];
  /** A new VoxelVolume holding the model (e.g. for addDynamic). */
  toVolume(model?: number): VoxelVolume;
  /** Copies the model into `target` with its min corner at (x, y, z). */
  stamp(target: VoxelVolume, x: number, y: number, z: number, model?: number): void;
}

const MATERIAL_NAMES = new Set(MATERIALS.map((m) => m.name));

function materialFor(dict: Record<string, string> | undefined, fallback: MaterialName): MaterialName {
  const custom = dict?._material;
  if (custom && MATERIAL_NAMES.has(custom as MaterialName)) return custom as MaterialName;
  if (dict?._type === '_metal') return 'metal';
  if (dict?._type === '_glass') return 'glass';
  return fallback;
}

export function voxAsset(file: VoxFile, palette: Palette, fallback: MaterialName = 'concrete'): VoxAsset {
  const remap = new Int16Array(256).fill(-1);
  const mapIndex = (c: number): number => {
    let r = remap[c]!;
    if (r < 0) {
      const o = c * 4;
      const color = (file.palette[o]! << 16) | (file.palette[o + 1]! << 8) | file.palette[o + 2]!;
      r = remap[c] = palette.findOrAdd(color, materialFor(file.materials.get(c), fallback));
    }
    return r;
  };
  const model = (i: number) => {
    const m = file.models[i];
    if (!m) throw new Error(`.vox has no model ${i}`);
    return m;
  };
  const asset: VoxAsset = {
    file,
    size(i = 0) {
      const [sx, sy, sz] = model(i).size;
      return [sx, sz, sy];
    },
    stamp(target, x, y, z, i = 0) {
      const m = model(i);
      const [sx, sy, sz] = m.size;
      for (let vz = 0; vz < sz; vz++)
        for (let vy = 0; vy < sy; vy++)
          for (let vx = 0; vx < sx; vx++) {
            const c = voxGet(m, vx, vy, vz);
            if (c) target.set(x + vx, y + vz, z + (sy - 1 - vy), mapIndex(c));
          }
    },
    toVolume(i = 0) {
      const [ex, ey, ez] = asset.size(i);
      const v = new VoxelVolume(ex, ey, ez);
      asset.stamp(v, 0, 0, 0, i);
      return v;
    },
  };
  return asset;
}
