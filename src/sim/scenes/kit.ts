/** Shared building kit for procedural scenes: a standard palette plus common structures. */
import { blockShade, box, brickPattern, hollowBox } from '../../voxel/build.ts';
import type { Palette } from '../../voxel/palette.ts';
import type { VoxelVolume } from '../../voxel/volume.ts';

export interface Kit {
  bedrock: number;
  dirt: (x: number, y: number, z: number) => number;
  grass: (x: number, y: number, z: number) => number;
  concrete: (x: number, y: number, z: number) => number;
  brick: (x: number, y: number, z: number) => number;
  wood: (x: number, y: number, z: number) => number;
  crate: number[];
  metal: (x: number, y: number, z: number) => number;
  glass: number;
  asphalt: (x: number, y: number, z: number) => number;
  roof: (x: number, y: number, z: number) => number;
  paint: number[];
}

export function standardKit(p: Palette): Kit {
  const bedrock = p.add(0x3b3631, 'bedrock');
  const dirt = p.addShades(0x7a5a3a, 'dirt', 3, 0.06, 2);
  const grass = p.addShades(0x6a8f3c, 'grass', 4, 0.07, 3);
  const concrete = p.addShades(0xa8a49b, 'concrete', 3, 0.04, 4);
  const bricks = p.addShades(0xa4533c, 'brick', 4, 0.08, 5);
  const mortar = p.add(0xc9c0ae, 'concrete');
  const wood = p.addShades(0x9c6b3f, 'wood', 4, 0.08, 6);
  const crate = p.addShades(0xc28a4a, 'wood', 3, 0.06, 7);
  const metal = p.addShades(0x6f7c86, 'metal', 2, 0.05, 8);
  const glass = p.add(0xa9dcec, 'glass');
  const asphalt = p.addShades(0x3e4145, 'stone', 3, 0.04, 9);
  const roof = p.addShades(0x5b5f66, 'concrete', 2, 0.05, 10);
  const paint = [0xd9822b, 0x3f7cc7, 0xc74a3f, 0x4fa368, 0xe0c341, 0x8a5cc7].map((c) => p.add(c, 'wood'));
  return {
    bedrock,
    dirt: blockShade(dirt, 5, 5, 5, 1),
    grass: blockShade(grass, 6, 1, 6, 2),
    concrete: blockShade(concrete, 8, 8, 8, 3),
    brick: brickPattern(bricks, mortar),
    wood: blockShade(wood, 12, 2, 12, 4),
    crate,
    metal: blockShade(metal, 16, 16, 16, 5),
    glass,
    asphalt: blockShade(asphalt, 8, 1, 8, 6),
    roof: blockShade(roof, 10, 2, 10, 7),
    paint,
  };
}

/** Ground slab: bedrock anchor layer, dirt, and a grass top. Returns the height of the top surface. */
export function ground(v: VoxelVolume, kit: Kit, thickness = 4): number {
  box(v, 0, 0, 0, v.sizeX, 1, v.sizeZ, kit.bedrock);
  box(v, 0, 1, 0, v.sizeX, thickness - 1, v.sizeZ, kit.dirt);
  box(v, 0, thickness - 1, 0, v.sizeX, thickness, v.sizeZ, kit.grass);
  return thickness;
}

/** A simple house: hollow shell with a door, windows and a flat roof. Coordinates in voxels. */
export function house(
  v: VoxelVolume, kit: Kit,
  x0: number, y0: number, z0: number, w: number, h: number, d: number,
  walls: (x: number, y: number, z: number) => number = kit.wood,
): void {
  hollowBox(v, x0, y0, z0, x0 + w, y0 + h, z0 + d, 2, walls, false);
  box(v, x0 - 1, y0 + h, z0 - 1, x0 + w + 1, y0 + h + 2, z0 + d + 1, kit.roof);
  // Door on the -z side.
  box(v, x0 + Math.floor(w / 2) - 5, y0, z0, x0 + Math.floor(w / 2) + 5, y0 + 20, z0 + 2, 0);
  // Windows on the ±x sides.
  for (const wx of [x0, x0 + w - 2]) {
    for (let wz = z0 + 6; wz + 8 < z0 + d - 4; wz += 14) box(v, wx, y0 + 10, wz, wx + 2, y0 + 18, wz + 8, kit.glass);
  }
}
