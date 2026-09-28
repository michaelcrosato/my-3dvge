import { box, cylinder } from '../../voxel/build.ts';
import { VOXEL_SIZE } from '../../voxel/constants.ts';
import { VoxelVolume } from '../../voxel/volume.ts';
import type { SceneDef } from '../scene-api.ts';
import { ground, house, standardKit } from './kit.ts';

/**
 * Compact test range (32 × 32 m): a pillar holding a slab (the default blast target), a brick wall, a
 * wooden house, one-voxel stairs, a metal frame, a thin tower and crates.
 */
export const testScene: SceneDef = {
  name: 'test',
  description: 'Compact test range with a pillar + slab, wall, house, stairs, tower and crates.',
  build(ctx) {
    const kit = standardKit(ctx.palette);
    const W = 320, H = 128, D = 320;
    const v = new VoxelVolume(W, H, D);
    const g = ground(v, kit);
    const origin: [number, number, number] = [-(W / 2) * VOXEL_SIZE, 0, -(D / 2) * VOXEL_SIZE];
    const toWorld = (x: number, y: number, z: number): [number, number, number] => [
      origin[0] + x * VOXEL_SIZE, origin[1] + y * VOXEL_SIZE, origin[2] + z * VOXEL_SIZE,
    ];

    // Pillar + cantilevered slab: blasting the pillar drops the slab.
    box(v, 150, g, 100, 156, g + 30, 106, kit.concrete);
    box(v, 135, g + 30, 85, 171, g + 34, 121, kit.concrete);
    ctx.setBlastTarget(toWorld(153, g + 12, 103));

    // Brick wall.
    box(v, 190, g, 120, 250, g + 30, 123, kit.brick);

    // Wooden house.
    house(v, kit, 60, g, 150, 50, 36, 40);

    // One-voxel stairs (tests character autostep), leading onto a platform.
    for (let i = 0; i < 12; i++) box(v, 160 + i * 4, g, 200, 164 + i * 4, g + i + 1, 212, kit.concrete);
    box(v, 208, g, 200, 228, g + 12, 220, kit.concrete);

    // Metal frame.
    for (const [px, pz] of [[200, 60], [226, 60], [200, 86], [226, 86]] as const) box(v, px, g, pz, px + 3, g + 60, pz + 3, kit.metal);
    box(v, 200, g + 60, 60, 229, g + 62, 89, kit.metal);

    // Thin tower and a round column.
    box(v, 250, g, 200, 258, g + 90, 208, kit.concrete);
    cylinder(v, 120, g, 60, 5, 45, kit.brick);

    ctx.addStatic(v, origin);

    // Loose crates (dynamic bodies from M2 on).
    for (let i = 0; i < 6; i++) {
      const crate = new VoxelVolume(5, 5, 5);
      crate.fillBox(0, 0, 0, 5, 5, 5, (x, y, z) => kit.crate[(x + y + z) % kit.crate.length]!);
      const [wx, , wz] = toWorld(170 + (i % 3) * 8, 0, 150 + Math.floor(i / 3) * 8);
      ctx.addDynamic(crate, [wx, g * VOXEL_SIZE + 0.5 + i * 0.6, wz]);
    }

    ctx.setSpawn(toWorld(165, g, 185), 0.35);
  },
};
