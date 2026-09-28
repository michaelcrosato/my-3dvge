/**
 * PATHBREAKERS voxel art: every vehicle, building and prop is built procedurally into a VoxelVolume.
 *
 * Conventions (all builders):
 * - Voxel units (0.1 m). Origin at the model's min corner; +y up.
 * - Vehicles and the carrier face **-z** (their front is the z = 0 side). Game code rotates them.
 * - Buildings stand on y = 0 (their anchor layer) and should be solid enough to read as buildings when
 *   partially destroyed (hollow shells with floors/roof, walls 2–3 voxels thick).
 * - Use `kit` palette entries (materials matter: they set density/strength for physics & destruction).
 * - Deterministic: use `kit.rng` only.
 *
 * This file is the contract; the placeholder builders below are simple blocks until the art pass.
 */
import type { MaterialName } from '../../../voxel/materials.ts';
import type { Palette } from '../../../voxel/palette.ts';
import { VoxelVolume } from '../../../voxel/volume.ts';
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

export type BuildingKind =
  | 'barn' | 'farmhouse' | 'gasStation' | 'pump' | 'shop' | 'depot' | 'terrace' | 'office'
  | 'waterTower' | 'mechShed' | 'silo' | 'shed' | 'warehouse' | 'house' | 'church' | 'garage' | 'target';

export interface BuildingOptions {
  /** Footprint width (x) / depth (z) in voxels; builders pick sensible defaults. */
  w?: number;
  d?: number;
  floors?: number;
  variant?: number;
}

export type PropKind =
  | 'fence' | 'hay' | 'tree' | 'bush' | 'rduOff' | 'rduOn' | 'survivor' | 'tnt' | 'block' | 'mound'
  | 'ramp' | 'track' | 'loadingRamp' | 'ammo' | 'dish' | 'lamp' | 'wreck' | 'rock' | 'sign' | 'safePad';

export interface PropOptions {
  /** Size overrides in voxels (meaning depends on the prop: e.g. fence length along x, track length along z). */
  w?: number;
  h?: number;
  d?: number;
  length?: number;
  variant?: number;
}

/** Required prop sizes (voxels) where gameplay depends on them. */
export const PROP_DIMS = {
  /** Concrete block that exactly fills a drainage pit (pit is 36 × 12 deep × 40). */
  block: [34, 12, 38] as [number, number, number],
  tnt: [8, 8, 8] as [number, number, number],
  rdu: [4, 10, 4] as [number, number, number],
  survivor: [5, 17, 4] as [number, number, number],
  ammo: [8, 6, 8] as [number, number, number],
};

function solid(w: number, h: number, d: number, c: number): VoxelVolume {
  const v = new VoxelVolume(w, h, d);
  v.fillBox(0, 0, 0, w, h, d, c);
  return v;
}

export function buildVehicle(kind: VehicleKind, kit: ArtKit): VoxelVolume {
  const [w, h, d] = VEHICLE_DIMS[kind];
  const colors: Record<VehicleKind, number> = { dozer: 0xe8b21c, truck: 0x3f7cc7, buggy: 0xd8432f, mech: 0xb8c2cc, bike: 0x2f9e5a, train: 0x7d3b2a, semi: 0xdddddd };
  return solid(w, h, d, color(kit, colors[kind], 'metal'));
}

export function buildCarrier(kit: ArtKit): VoxelVolume {
  const [w, h, d] = CARRIER_DIMS;
  return solid(w, h, d, color(kit, 0xe0e0e0, 'metal'));
}

export function buildBuilding(kind: BuildingKind, kit: ArtKit, opts: BuildingOptions = {}): VoxelVolume {
  const w = opts.w ?? 60, d = opts.d ?? 50;
  const h = kind === 'office' ? 30 * (opts.floors ?? 8) + 4 : kind === 'pump' ? 18 : 50;
  const mat: MaterialName = kind === 'depot' ? 'stone' : kind === 'pump' ? 'tnt' : 'brick';
  const v = new VoxelVolume(w, h, d);
  const c = color(kit, kind === 'pump' ? 0xd23b2c : 0xa4533c, mat);
  v.fillBox(0, 0, 0, w, h, d, c);
  if (kind !== 'pump') v.fillBox(3, 0, 3, w - 3, h - 3, d - 3, 0);
  return v;
}

export function buildProp(kind: PropKind, kit: ArtKit, opts: PropOptions = {}): VoxelVolume {
  switch (kind) {
    case 'block': return solid(...PROP_DIMS.block, color(kit, 0x9a9a92, 'reinforced'));
    case 'tnt': return solid(...PROP_DIMS.tnt, color(kit, 0xc8321e, 'tnt'));
    case 'rduOff': return solid(...PROP_DIMS.rdu, color(kit, 0x556066, 'metal'));
    case 'rduOn': return solid(...PROP_DIMS.rdu, color(kit, 0x7dff6a, 'metal'));
    case 'survivor': return solid(...PROP_DIMS.survivor, color(kit, 0xf2a03d, 'wood'));
    case 'ammo': return solid(...PROP_DIMS.ammo, color(kit, 0x3a6ea5, 'wood'));
    case 'fence': return solid(opts.length ?? 40, 10, 2, color(kit, 0xc9b28a, 'wood'));
    case 'mound': return solid(opts.w ?? 40, opts.h ?? 12, opts.d ?? 40, color(kit, 0x8a6a45, 'reinforced'));
    case 'ramp': return solid(opts.w ?? 40, opts.h ?? 14, opts.d ?? 50, color(kit, 0x8d8d86, 'reinforced'));
    case 'track': return solid(30, 2, opts.length ?? 100, color(kit, 0x5a4a3a, 'reinforced'));
    case 'safePad': return solid(opts.w ?? 80, 1, opts.d ?? 60, color(kit, 0xe8d23a, 'reinforced'));
    default: return solid(opts.w ?? 10, opts.h ?? 10, opts.d ?? 10, color(kit, 0x777777, 'wood'));
  }
}
