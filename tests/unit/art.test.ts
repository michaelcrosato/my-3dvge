import { describe, expect, it } from 'vitest';
import {
  BUILDING_KINDS, CARRIER_DIMS, PROP_DIMS, PROP_KINDS, VEHICLE_DIMS, buildBuilding, buildCarrier, buildProp, buildVehicle,
  createArtKit, type ArtKit,
} from '../../src/game/sim/art/index.ts';
import type { VehicleKind } from '../../src/game/shared/types.ts';
import { meshChunk } from '../../src/voxel/mesher.ts';
import { Palette } from '../../src/voxel/palette.ts';
import type { VoxelVolume } from '../../src/voxel/volume.ts';

const VEHICLES = Object.keys(VEHICLE_DIMS) as VehicleKind[];

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function freshKit(seed = 7): ArtKit {
  return createArtKit(new Palette(), seeded(seed));
}

function buildEverything(kit: ArtKit): VoxelVolume[] {
  const out: VoxelVolume[] = [];
  for (const k of VEHICLES) out.push(buildVehicle(k, kit));
  out.push(buildCarrier(kit));
  for (const k of BUILDING_KINDS) for (let variant = 0; variant < 4; variant++) out.push(buildBuilding(k, kit, { variant, floors: k === 'office' ? 8 : undefined }));
  for (const k of PROP_KINDS) for (let variant = 0; variant < 4; variant++) out.push(buildProp(k, kit, { variant }));
  return out;
}

function fingerprint(v: VoxelVolume): string {
  let h = 0;
  v.forEachSolid((x, y, z, c) => {
    h = (Math.imul(h ^ (x * 73856093 + y * 19349663 + z * 83492791 + c), 16777619) >>> 0) || 1;
  });
  return `${v.sizeX}x${v.sizeY}x${v.sizeZ}:${v.voxelCount}:${h}`;
}

describe('PATHBREAKERS art', () => {
  it('builds every vehicle and the carrier at their contract sizes', () => {
    const kit = freshKit();
    for (const k of VEHICLES) {
      const v = buildVehicle(k, kit);
      expect([v.sizeX, v.sizeY, v.sizeZ]).toEqual(VEHICLE_DIMS[k]);
      expect(v.voxelCount).toBeGreaterThan(100);
    }
    const c = buildCarrier(kit);
    expect([c.sizeX, c.sizeY, c.sizeZ]).toEqual(CARRIER_DIMS);
    expect(c.voxelCount).toBeGreaterThan(1000);
  });

  it('keeps the train flatbed deck flat at y = 12 over the rear 50 voxels', () => {
    const v = buildVehicle('train', freshKit());
    for (let z = 40; z < 90; z++)
      for (let x = 0; x < 30; x++) {
        for (let y = 12; y < v.sizeY; y++) expect(v.get(x, y, z)).toBe(0);
        expect(v.get(x, 11, z)).not.toBe(0);
      }
  });

  it('builds every building and prop (all variants) as non-empty volumes', () => {
    const kit = freshKit();
    for (const k of BUILDING_KINDS)
      for (let variant = 0; variant < 4; variant++) {
        const v = buildBuilding(k, kit, { variant });
        expect(v.voxelCount, `${k} v${variant}`).toBeGreaterThan(50);
        // Buildings stand on their anchor layer.
        let anchored = 0;
        for (let z = 0; z < v.sizeZ; z++) for (let x = 0; x < v.sizeX; x++) if (v.get(x, 0, z)) anchored++;
        expect(anchored, `${k} anchor`).toBeGreaterThan(0);
      }
    for (const k of PROP_KINDS) for (let variant = 0; variant < 4; variant++) expect(buildProp(k, kit, { variant }).voxelCount, k).toBeGreaterThan(0);
    const office = buildBuilding('office', kit, { floors: 8 });
    expect(office.sizeX).toBeLessThanOrEqual(130);
    expect(office.sizeY).toBeLessThanOrEqual(250);
    expect(office.sizeZ).toBeLessThanOrEqual(130);
  });

  it('matches the gameplay prop sizes', () => {
    const kit = freshKit();
    const size = (v: VoxelVolume) => [v.sizeX, v.sizeY, v.sizeZ];
    expect(size(buildProp('block', kit))).toEqual(PROP_DIMS.block);
    expect(size(buildProp('tnt', kit))).toEqual(PROP_DIMS.tnt);
    expect(size(buildProp('rduOff', kit))).toEqual(PROP_DIMS.rdu);
    expect(size(buildProp('rduOn', kit))).toEqual(PROP_DIMS.rdu);
    expect(size(buildProp('survivor', kit))).toEqual(PROP_DIMS.survivor);
    expect(size(buildProp('ammo', kit))).toEqual(PROP_DIMS.ammo);
    // The block fills its pit completely (solid box).
    const block = buildProp('block', kit);
    expect(block.voxelCount).toBe(PROP_DIMS.block[0] * PROP_DIMS.block[1] * PROP_DIMS.block[2]);
  });

  it('uses gameplay materials where they matter', () => {
    const kit = freshKit();
    const materials = (v: VoxelVolume) => {
      const s = new Set<string>();
      v.forEachSolid((_x, _y, _z, c) => s.add(kit.palette.material(c).name));
      return s;
    };
    expect(materials(buildProp('tnt', kit))).toEqual(new Set(['tnt']));
    expect(materials(buildBuilding('pump', kit)).has('tnt')).toBe(true);
    expect(materials(buildBuilding('depot', kit)).has('stone')).toBe(true);
    expect(materials(buildProp('block', kit))).toEqual(new Set(['reinforced']));
    expect(materials(buildProp('ramp', kit))).toEqual(new Set(['reinforced']));
    expect(materials(buildProp('hay', kit))).toEqual(new Set(['hay']));
    expect(materials(buildBuilding('waterTower', kit)).has('wood')).toBe(true); // rammable shed door
  });

  it('is deterministic for a fixed rng', () => {
    const a = buildEverything(freshKit(42)).map(fingerprint);
    const b = buildEverything(freshKit(42)).map(fingerprint);
    expect(a).toEqual(b);
  });

  it('keeps mesh cost within phone budgets (greedy-mesh quads per model)', () => {
    const kit = freshKit();
    const quads = (v: VoxelVolume) => {
      let q = 0;
      for (const ci of v.nonEmptyChunks()) q += meshChunk(v.extractPadded(ci), kit.palette.colors).quads;
      return q;
    };
    for (const k of VEHICLES) expect(quads(buildVehicle(k, kit)), k).toBeLessThan(3000);
    expect(quads(buildCarrier(kit))).toBeLessThan(3500);
    for (const k of BUILDING_KINDS) expect(quads(buildBuilding(k, kit)), k).toBeLessThan(k === 'office' || k === 'waterTower' ? 8000 : 5000);
    for (const k of PROP_KINDS) expect(quads(buildProp(k, kit)), k).toBeLessThan(2500);
  });

  it('stays well inside the 255-entry palette when everything is built together', () => {
    const kit = freshKit();
    buildEverything(kit);
    expect(kit.palette.size).toBeLessThanOrEqual(120);
    expect(kit.palette.size).toBeLessThan(255);
  });
});
