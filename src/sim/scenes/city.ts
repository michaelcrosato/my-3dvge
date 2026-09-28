import { box, cylinder } from '../../voxel/build.ts';
import { VOXEL_SIZE } from '../../voxel/constants.ts';
import { VoxelVolume } from '../../voxel/volume.ts';
import type { SceneDef } from '../scene-api.ts';
import { standardKit } from './kit.ts';

/**
 * 48 × 48 m city block grid built from the generated .vox assets (public/vox): buildings stamped into
 * the static world, brick walls, and .vox crates as dynamic bodies. Roads are asphalt.
 */
export const cityScene: SceneDef = {
  name: 'city',
  description: '3×3 city blocks of .vox buildings with roads, walls and crates.',
  async build(ctx) {
    const kit = standardKit(ctx.palette);
    const [buildingA, buildingB, wall, crate] = await Promise.all(
      ['building-a', 'building-b', 'wall', 'crate'].map((n) => ctx.loadVox(`/vox/${n}.vox`)),
    );
    const W = 480, H = 128, D = 480, CELL = 160, ROAD = 20;
    const v = new VoxelVolume(W, H, D);
    const origin: [number, number, number] = [-(W / 2) * VOXEL_SIZE, 0, -(D / 2) * VOXEL_SIZE];
    const toWorld = (x: number, y: number, z: number): [number, number, number] => [
      origin[0] + x * VOXEL_SIZE, origin[1] + y * VOXEL_SIZE, origin[2] + z * VOXEL_SIZE,
    ];

    // Ground: bedrock anchor, dirt, then asphalt roads and grass/sidewalk blocks.
    box(v, 0, 0, 0, W, 1, D, kit.bedrock);
    box(v, 0, 1, 0, W, 3, D, kit.dirt);
    const onRoad = (x: number, z: number) => x % CELL < ROAD || x % CELL >= CELL - ROAD || z % CELL < ROAD || z % CELL >= CELL - ROAD;
    box(v, 0, 3, 0, W, 4, D, (x, y, z) => (onRoad(x, z) ? kit.asphalt(x, y, z) : kit.grass(x, y, z)));
    const g = 4;

    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const bx = i * CELL + ROAD, bz = j * CELL + ROAD; // block min corner
        if (i === 1 && j === 1) {
          // Central plaza: a tall tower on a slender base (the default blast target) and a round column.
          box(v, bx + 50, g, bz + 50, bx + 58, g + 25, bz + 58, kit.concrete);
          box(v, bx + 38, g + 25, bz + 38, bx + 70, g + 90, bz + 70, kit.brick);
          cylinder(v, bx + 95, g, bz + 25, 5, 40, kit.brick);
          ctx.setBlastTarget(toWorld(bx + 54, g + 12, bz + 54));
          continue;
        }
        const asset = (i + j) % 2 ? buildingB : buildingA;
        const [sx, , sz] = asset.size();
        asset.stamp(v, bx + Math.floor((120 - sx) / 2), g, bz + 20, 0);
        wall.stamp(v, bx + 10, g, bz + 100);
        wall.stamp(v, bx + 70, g, bz + 100);
        void sz;
      }
    ctx.addStatic(v, origin);

    // .vox crates scattered along the roads.
    for (let k = 0; k < 18; k++) {
      const x = 30 + Math.floor(ctx.random() * 420);
      const z = CELL - ROAD / 2 + (k % 2) * CELL + Math.floor(ctx.random() * 6);
      const [wx, , wz] = toWorld(x, 0, z);
      ctx.addDynamic(crate.toVolume(), [wx, g * VOXEL_SIZE + 0.05 + (k % 3) * 0.6, wz]);
    }

    ctx.setSpawn(toWorld(CELL - ROAD / 2, g, 400), 0);
    ctx.setStatus('City — blast the buildings');
  },
};
