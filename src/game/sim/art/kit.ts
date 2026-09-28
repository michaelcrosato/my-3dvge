/** Art kit, palette access and the model-size contract shared by every builder. */
import type { MaterialName } from '../../../voxel/materials.ts';
import type { Palette } from '../../../voxel/palette.ts';
import type { VehicleKind } from '../../shared/types.ts';

export interface ArtKit {
  palette: Palette;
  rng: () => number;
  /** Palette index cache by name (see color()). */
  cache: Map<string, number>;
}

export function createArtKit(palette: Palette, rng: () => number): ArtKit {
  return { palette, rng, cache: new Map() };
}

/** Palette index for a named color+material (added on first use). */
export function color(kit: ArtKit, hex: number, material: MaterialName): number {
  const key = `${hex}:${material}`;
  let i = kit.cache.get(key);
  if (i === undefined) {
    i = kit.palette.findOrAdd(hex, material);
    kit.cache.set(key, i);
  }
  return i;
}

/**
 * Vehicle model bounds in voxels [x (width), y (height), z (length)]. Physics chassis boxes and wheel
 * positions are derived from these, so models must fill (roughly) exactly this box.
 */
export const VEHICLE_DIMS: Record<VehicleKind, [number, number, number]> = {
  dozer: [30, 22, 46],
  truck: [26, 26, 56],
  buggy: [20, 14, 34],
  mech: [18, 30, 16],
  bike: [10, 14, 24],
  /** Locomotive + flatbed on one frame; the flatbed deck (rear 50 voxels) must be flat on top at y = 12. */
  train: [30, 26, 90],
  semi: [28, 34, 120],
};

/** Carrier bounds [x, y, z] in voxels; faces -z. Two glowing fusion cores on the back. */
export const CARRIER_DIMS: [number, number, number] = [30, 26, 76];

/** Required prop sizes (voxels) where gameplay depends on them. */
export const PROP_DIMS = {
  /** Concrete block that exactly fills a drainage pit (pit is 36 × 12 deep × 40). */
  block: [34, 12, 38] as [number, number, number],
  tnt: [8, 8, 8] as [number, number, number],
  rdu: [4, 10, 4] as [number, number, number],
  survivor: [5, 17, 4] as [number, number, number],
  ammo: [8, 6, 8] as [number, number, number],
};
