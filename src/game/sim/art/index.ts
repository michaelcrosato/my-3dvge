/**
 * PATHBREAKERS voxel art: every vehicle, building and prop is built procedurally into a VoxelVolume.
 *
 * Conventions (all builders):
 * - Voxel units (0.1 m). Origin at the model's min corner; +y up.
 * - Vehicles and the carrier face **-z** (their front is the z = 0 side). Game code rotates them.
 * - Buildings stand on y = 0 (their anchor layer) and are hollow shells (2–3 voxel walls) with floors
 *   and roofs, so they still read as buildings when partially destroyed.
 * - Materials come from the art palette (src/game/sim/art/palette.ts) and matter for gameplay:
 *   density/strength drive physics and destruction (e.g. the depot is `stone`, pumps are `tnt`).
 * - Deterministic: only `kit.rng` and position hashes are used.
 *
 * Modules: kit.ts (kit + size contract), palette.ts (colors), shapes.ts (helpers), vehicles.ts,
 * buildings.ts, props.ts.
 */
import type { VoxelVolume } from '../../../voxel/volume.ts';
import type { VehicleKind } from '../../shared/types.ts';
import { buildBuildingModel, type BuildingKind, type BuildingOptions } from './buildings.ts';
import type { ArtKit } from './kit.ts';
import { buildPropModel, type PropKind, type PropOptions } from './props.ts';
import { buildCarrierModel, buildVehicleModel } from './vehicles.ts';

export { CARRIER_DIMS, PROP_DIMS, VEHICLE_DIMS, color, createArtKit, type ArtKit } from './kit.ts';
export type { BuildingKind, BuildingOptions } from './buildings.ts';
export type { PropKind, PropOptions } from './props.ts';

export const BUILDING_KINDS: readonly BuildingKind[] = [
  'barn', 'farmhouse', 'gasStation', 'pump', 'shop', 'depot', 'terrace', 'office', 'waterTower', 'mechShed',
  'silo', 'shed', 'warehouse', 'house', 'church', 'garage', 'target',
];

export const PROP_KINDS: readonly PropKind[] = [
  'fence', 'hay', 'tree', 'bush', 'rduOff', 'rduOn', 'survivor', 'tnt', 'block', 'mound', 'ramp', 'track',
  'loadingRamp', 'ammo', 'dish', 'lamp', 'wreck', 'rock', 'sign', 'safePad',
];

export function buildVehicle(kind: VehicleKind, kit: ArtKit): VoxelVolume {
  return buildVehicleModel(kind, kit);
}

export function buildCarrier(kit: ArtKit): VoxelVolume {
  return buildCarrierModel(kit);
}

/**
 * Default footprints (voxels, w × d × h): barn 80×100×~80, farmhouse 70×60×~84, house 60×50×~58,
 * terrace 40×60×62, shop 70×60×46, church 60×100×150, garage 60×60×39, gasStation 100×80×47,
 * pump 30×12×18, depot 100×80×50, office 110×110×(30·floors+10), waterTower 60×60×110,
 * mechShed 50×50×~41, silo 30×30×91, shed 40×30×25, warehouse 120×90×50, target 30×10×40.
 */
export function buildBuilding(kind: BuildingKind, kit: ArtKit, opts: BuildingOptions = {}): VoxelVolume {
  return buildBuildingModel(kind, kit, opts);
}

export function buildProp(kind: PropKind, kit: ArtKit, opts: PropOptions = {}): VoxelVolume {
  return buildPropModel(kind, kit, opts);
}
