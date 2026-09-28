import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { voxAsset } from '../../src/sim/vox-asset.ts';
import { Palette } from '../../src/voxel/palette.ts';
import { createVoxModel, readVox, voxGet, voxSet, writeVox } from '../../src/voxel/vox.ts';

function randomFile() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const models = [createVoxModel(7, 5, 9), createVoxModel(3, 3, 3)];
  for (const m of models) for (let i = 0; i < m.data.length; i++) if (rnd() < 0.4) m.data[i] = 1 + Math.floor(rnd() * 255);
  const palette = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i++) palette.set([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255], i * 4);
  const materials = new Map<number, Record<string, string>>([
    [3, { _type: '_metal', _rough: '0.3' }],
    [9, { _material: 'wood' }],
  ]);
  return { models, palette, materials };
}

describe('.vox reader/writer', () => {
  it('round-trips models, palette and materials', () => {
    const src = randomFile();
    const file = readVox(writeVox(src));
    expect(file.version).toBe(150);
    expect(file.models.length).toBe(2);
    file.models.forEach((m, i) => {
      expect(m.size).toEqual(src.models[i]!.size);
      expect(Array.from(m.data)).toEqual(Array.from(src.models[i]!.data));
    });
    // Entry 255 has no slot in the file's RGBA chunk (index i ↔ entry i-1).
    expect(Array.from(file.palette.subarray(4, 255 * 4))).toEqual(Array.from(src.palette.subarray(4, 255 * 4)));
    expect(file.materials).toEqual(src.materials);
    // Writing again is byte-identical.
    expect(Array.from(writeVox(file))).toEqual(Array.from(writeVox(src)));
  });

  it('rejects files that are not .vox', () => {
    expect(() => readVox(new Uint8Array(32))).toThrow(/Not a MagicaVoxel/);
  });

  it('converts z-up .vox space to the y-up engine with materials mapped', () => {
    const m = createVoxModel(2, 3, 4); // x=2, y(depth)=3, z(up)=4
    voxSet(m, 1, 0, 3, 5); // top, front
    const palette = new Uint8Array(256 * 4);
    palette.set([255, 0, 0, 255], 5 * 4);
    const asset = voxAsset({ version: 150, models: [m], palette, materials: new Map([[5, { _type: '_metal' }]]) }, new Palette());
    expect(asset.size()).toEqual([2, 4, 3]);
    const v = asset.toVolume();
    const idx = v.get(1, 3, 2); // y = vox z, z = sy-1-vox y
    expect(idx).toBeGreaterThan(0);
    expect(v.voxelCount).toBe(1);
    expect(voxGet(m, 1, 0, 3)).toBe(5);
  });

  it('parses the generated assets in public/vox', () => {
    for (const name of ['crate', 'wall', 'building-a', 'building-b']) {
      const file = readVox(readFileSync(new URL(`../../public/vox/${name}.vox`, import.meta.url)));
      expect(file.models.length).toBe(1);
      expect(file.models[0]!.data.some((c) => c > 0)).toBe(true);
      expect([...file.materials.values()].every((d) => typeof d._material === 'string')).toBe(true);
    }
  });
});
