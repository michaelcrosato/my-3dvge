import { box } from '../../voxel/build.ts';
import { VOXEL_SIZE } from '../../voxel/constants.ts';
import { VoxelVolume } from '../../voxel/volume.ts';
import type { SceneDef } from '../scene-api.ts';
import { ground, standardKit } from './kit.ts';

/**
 * Physics stress test: crate towers, a crate pyramid, brick walls to knock down, and game rules that keep
 * raining crates until the body cap is nearly reached. Also a small example of SceneDef.update().
 */
export const stressScene: SceneDef = {
  name: 'stress',
  description: 'Crate towers and pyramid plus a crate rain up to the body cap.',
  build(ctx) {
    const kit = standardKit(ctx.palette);
    const W = 320, H = 96, D = 320;
    const v = new VoxelVolume(W, H, D);
    const g = ground(v, kit);
    const origin: [number, number, number] = [-(W / 2) * VOXEL_SIZE, 0, -(D / 2) * VOXEL_SIZE];
    const toWorld = (x: number, y: number, z: number): [number, number, number] => [
      origin[0] + x * VOXEL_SIZE, origin[1] + y * VOXEL_SIZE, origin[2] + z * VOXEL_SIZE,
    ];
    for (let k = 0; k < 4; k++) box(v, 60 + k * 50, g, 240, 100 + k * 50, g + 35, 243, kit.brick);
    box(v, 150, g, 150, 170, g + 60, 170, kit.concrete);
    ctx.addStatic(v, origin);

    const crate = () => {
      const c = new VoxelVolume(5, 5, 5);
      c.fillBox(0, 0, 0, 5, 5, 5, (x, y, z) => kit.crate[(x + y + z) % kit.crate.length]!);
      return c;
    };
    const top = g * VOXEL_SIZE;
    // Towers.
    for (let t = 0; t < 8; t++) {
      const [x, , z] = toWorld(70 + (t % 4) * 50, 0, 90 + Math.floor(t / 4) * 40);
      for (let s = 0; s < 8; s++) ctx.addDynamic(crate(), [x, top + s * 0.5 + 0.01, z]);
    }
    // Pyramid.
    for (let row = 0; row < 6; row++)
      for (let c = 0; c <= 5 - row; c++) {
        const [x, , z] = toWorld(200 + c * 5 + row * 2.5, 0, 200);
        ctx.addDynamic(crate(), [x, top + row * 0.5 + 0.01, z]);
      }
    ctx.setBlastTarget(toWorld(160, g + 10, 160));
    ctx.setSpawn(toWorld(160, g, 290), 0);
  },
  update(ctx) {
    const t = ctx.time();
    const cap = ctx.params.maxBodies;
    // Every 0.5 s, drop a crate over the arena until 10 below the body cap.
    if (Math.floor(t * 2) !== Math.floor((t - 1 / 60) * 2) && ctx.dynamicBodyCount() < cap - 10) {
      const a = ctx.random() * Math.PI * 2;
      const r = 3 + ctx.random() * 8;
      ctx.spawnCrate([Math.cos(a) * r, 12, Math.sin(a) * r], [0, -1, 0]);
    }
    if (Math.floor(t) !== Math.floor(t - 1 / 60)) ctx.setStatus(`Stress — bodies ${ctx.dynamicBodyCount()}/${cap}`);
  },
};
