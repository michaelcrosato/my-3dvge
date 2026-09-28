import { VOXEL_SIZE } from '../../voxel/constants.ts';
import type { VoxelVolume } from '../../voxel/volume.ts';
import { buildBuilding, buildCarrier, buildProp, buildVehicle, createArtKit, type BuildingKind, type PropKind } from '../../game/sim/art/index.ts';
import type { SceneDef } from '../scene-api.ts';

/**
 * Art gallery (?scene=gallery&fly=1): every PATHBREAKERS model laid out in rows receding from the
 * camera — vehicles first, then props, then buildings with their variants.
 */
export const galleryScene: SceneDef = {
  name: 'gallery',
  description: 'All PATHBREAKERS voxel models on a grid.',
  build(ctx) {
    const kit = createArtKit(ctx.palette, () => ctx.random());
    const map = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      const checker = ((i % 8) + Math.floor(i / 8)) % 2;
      map.set(checker ? [112, 142, 82, 255] : [104, 134, 76, 255], i * 4);
    }
    ctx.setGround({ x0: -140, z0: -240, x1: 140, z1: 40, map: { width: 8, height: 8, data: map }, slabs: [{ x0: -140, z0: -240, x1: 140, z1: 40, y: 0 }] });

    const vehicles = [...(['dozer', 'truck', 'buggy', 'mech', 'bike', 'train', 'semi'] as const).map((k) => buildVehicle(k, kit)), buildCarrier(kit)];
    const prop = (k: PropKind, variant = 0) => buildProp(k, kit, { variant });
    const props = [
      prop('fence'), prop('fence', 1), prop('hay'), prop('hay', 1), prop('tree'), prop('tree', 1), prop('bush'),
      prop('rduOff'), prop('rduOn'), prop('survivor'), prop('survivor', 1), prop('survivor', 2), prop('survivor', 3),
      prop('tnt'), prop('block'), prop('ammo'), prop('dish'), prop('lamp'), prop('wreck'), prop('rock'),
      prop('sign'), prop('sign', 1), prop('track', 0), prop('loadingRamp'), prop('ramp'), prop('mound'), prop('safePad'),
    ];
    const bld = (k: BuildingKind, variant = 0, floors?: number) => buildBuilding(k, kit, { variant, floors });
    const buildings = [
      bld('barn'), bld('barn', 1), bld('farmhouse'), bld('farmhouse', 1), bld('house'), bld('house', 1), bld('house', 2), bld('house', 3),
      bld('terrace'), bld('terrace', 1), bld('terrace', 2), bld('terrace', 3), bld('shop'), bld('shop', 1), bld('shop', 2),
      bld('church'), bld('garage'), bld('garage', 1), bld('gasStation'), bld('pump'), bld('depot'), bld('office', 0, 8),
      bld('waterTower'), bld('mechShed'), bld('silo'), bld('silo', 1), bld('shed'), bld('warehouse'), bld('target'), bld('target', 1),
    ];

    let z = 0;
    /** Lays models out left to right; `faceCamera` turns -z-facing models (vehicles) toward the camera. */
    const row = (models: VoxelVolume[], gap: number, maxWidth: number, faceCamera = false) => {
      let x = -maxWidth / 2;
      let depth = 0;
      for (const m of models) {
        const w = m.sizeX * VOXEL_SIZE, d = m.sizeZ * VOXEL_SIZE;
        if (x + w > maxWidth / 2) {
          z -= depth + gap * 2;
          x = -maxWidth / 2;
          depth = 0;
        }
        if (faceCamera) ctx.world.addVolume('static', m, [x + w, 0, z], [0, 1, 0, 0], 'scene');
        else ctx.addStatic(m, [x, 0, z - d]);
        x += w + gap;
        depth = Math.max(depth, d);
      }
      z -= depth + gap * 3;
    };
    row(vehicles, 2.5, 60, true);
    row(props, 2, 60, true);
    row(buildings, 4, 100, true);
    ctx.setSpawn([0, 14, 22], 0);
  },
};
