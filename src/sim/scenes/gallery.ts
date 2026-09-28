import { VOXEL_SIZE } from '../../voxel/constants.ts';
import { buildBuilding, buildCarrier, buildProp, buildVehicle, createArtKit } from '../../game/sim/art/index.ts';
import type { SceneDef } from '../scene-api.ts';

/** Art gallery (?scene=gallery&fly=1): every PATHBREAKERS model laid out on a grid. */
export const galleryScene: SceneDef = {
  name: 'gallery',
  description: 'All PATHBREAKERS voxel models on a grid.',
  build(ctx) {
    const kit = createArtKit(ctx.palette, () => ctx.random());
    const map = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < map.length; i += 4) map.set([110, 140, 80, 255], i);
    ctx.setGround({ x0: -100, z0: -100, x1: 100, z1: 100, map: { width: 4, height: 4, data: map }, slabs: [{ x0: -100, z0: -100, x1: 100, z1: 100, y: 0 }] });
    const models = [
      ...(['dozer', 'truck', 'buggy', 'mech', 'bike', 'train', 'semi'] as const).map((k) => buildVehicle(k, kit)),
      buildCarrier(kit),
      ...(['barn', 'farmhouse', 'gasStation', 'pump', 'shop', 'depot', 'terrace', 'office', 'waterTower', 'mechShed', 'silo', 'shed', 'warehouse', 'house', 'church', 'garage', 'target'] as const).map((k) => buildBuilding(k, kit)),
      ...(['fence', 'hay', 'tree', 'bush', 'rduOff', 'rduOn', 'survivor', 'tnt', 'block', 'mound', 'ramp', 'track', 'loadingRamp', 'ammo', 'dish', 'lamp', 'wreck', 'rock', 'sign', 'safePad'] as const).map((k) => buildProp(k, kit)),
    ];
    let x = -90, z = -90, rowDepth = 0;
    for (const m of models) {
      const w = m.sizeX * VOXEL_SIZE, d = m.sizeZ * VOXEL_SIZE;
      if (x + w > 90) {
        x = -90;
        z += rowDepth + 4;
        rowDepth = 0;
      }
      ctx.addStatic(m, [x, 0, z]);
      x += w + 4;
      rowDepth = Math.max(rowDepth, d);
    }
    ctx.setSpawn([0, 0, 20], 0);
  },
};
