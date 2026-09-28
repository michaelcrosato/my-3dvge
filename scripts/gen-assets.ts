/**
 * Procedural .vox asset generator: `npm run gen:assets` → public/vox/*.vox.
 *
 * Runs directly on Node (type stripping) and only depends on src/voxel/vox.ts, so AI agents can copy
 * this pattern to generate new assets. Coordinates are .vox space: x right, y depth, z up. Materials are
 * written as MATL `_material` so the engine maps them to physics materials (wood, brick, glass, …).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createVoxModel, voxSet, writeVox, type VoxModel } from '../src/voxel/vox.ts';

type Fill = number | ((x: number, y: number, z: number) => number);

class PaletteBuilder {
  readonly palette = new Uint8Array(256 * 4);
  readonly materials = new Map<number, Record<string, string>>();
  private next = 1;

  add(hex: number, material: string): number {
    const i = this.next++;
    this.palette.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], i * 4);
    const dict: Record<string, string> = { _material: material };
    if (material === 'metal') dict._type = '_metal';
    if (material === 'glass') dict._type = '_glass';
    this.materials.set(i, dict);
    return i;
  }
}

function box(m: VoxModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, fill: Fill): void {
  for (let z = z0; z < z1; z++)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) voxSet(m, x, y, z, typeof fill === 'number' ? fill : fill(x, y, z));
}

const hash = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function crate(): { models: VoxModel[]; p: PaletteBuilder } {
  const p = new PaletteBuilder();
  const frame = p.add(0x6e4424, 'wood');
  const plankA = p.add(0xc28a4a, 'wood');
  const plankB = p.add(0xb07a3e, 'wood');
  const n = 5;
  const m = createVoxModel(n, n, n);
  box(m, 0, 0, 0, n, n, n, (x, y, z) => {
    const edges = (x === 0 || x === n - 1 ? 1 : 0) + (y === 0 || y === n - 1 ? 1 : 0) + (z === 0 || z === n - 1 ? 1 : 0);
    return edges >= 2 ? frame : z % 2 ? plankA : plankB;
  });
  return { models: [m], p };
}

function wall(): { models: VoxModel[]; p: PaletteBuilder } {
  const p = new PaletteBuilder();
  const bricks = [0xa4533c, 0x9a4a35, 0xb05e44, 0x8f4431].map((c) => p.add(c, 'brick'));
  const mortar = p.add(0xc9c0ae, 'concrete');
  const m = createVoxModel(40, 3, 30);
  box(m, 0, 0, 0, 40, 3, 30, (x, _y, z) => {
    const row = Math.floor(z / 3);
    if (z % 3 === 2) return mortar;
    const u = x + (row % 2) * 2;
    if (u % 5 === 4) return mortar;
    return bricks[Math.floor(hash(Math.floor(u / 5), row, 3) * bricks.length)]!;
  });
  return { models: [m], p };
}

/** Multi-storey building: concrete frame and floor slabs, infill walls, glass windows, a door. */
function building(floors: number, infill: 'brick' | 'concrete'): { models: VoxModel[]; p: PaletteBuilder } {
  const p = new PaletteBuilder();
  const concrete = [0xa8a49b, 0x9f9b92, 0xb1ada4].map((c) => p.add(c, 'concrete'));
  const walls = infill === 'brick' ? [0xa4533c, 0x9a4a35, 0xb05e44].map((c) => p.add(c, 'brick')) : [0xd8d2c4, 0xcfc9bb].map((c) => p.add(c, 'concrete'));
  const glass = p.add(0xa9dcec, 'glass');
  const roof = p.add(0x5b5f66, 'concrete');
  const sx = 70, sy = 60, storey = 30;
  const sz = floors * storey + 2;
  const m = createVoxModel(sx, sy, sz);
  const shade = (list: number[]) => (x: number, y: number, z: number) => list[Math.floor(hash(x >> 3, y >> 3, z >> 3) * list.length)]!;
  // Infill walls (2 thick).
  box(m, 0, 0, 0, sx, 2, sz, shade(walls));
  box(m, 0, sy - 2, 0, sx, sy, sz, shade(walls));
  box(m, 0, 0, 0, 2, sy, sz, shade(walls));
  box(m, sx - 2, 0, 0, sx, sy, sz, shade(walls));
  // Concrete columns at the corners and mid-spans.
  for (const cx of [0, sx / 2 - 2, sx - 4]) for (const cy of [0, sy - 4]) box(m, cx, cy, 0, cx + 4, cy + 4, sz, shade(concrete));
  for (let f = 0; f < floors; f++) {
    const z0 = f * storey;
    if (f > 0) box(m, 0, 0, z0, sx, sy, z0 + 2, shade(concrete)); // floor slab
    // Windows on every facade.
    for (let wx = 8; wx + 10 < sx - 6; wx += 16) {
      if (Math.abs(wx + 5 - sx / 2) < 6) continue;
      box(m, wx, 0, z0 + 10, wx + 10, 2, z0 + 22, glass);
      box(m, wx, sy - 2, z0 + 10, wx + 10, sy, z0 + 22, glass);
    }
    for (let wy = 10; wy + 10 < sy - 6; wy += 18) {
      box(m, 0, wy, z0 + 10, 2, wy + 10, z0 + 22, glass);
      box(m, sx - 2, wy, z0 + 10, sx, wy + 10, z0 + 22, glass);
    }
  }
  box(m, 0, 0, sz - 2, sx, sy, sz, roof); // roof slab
  box(m, sx / 2 - 6, 0, 0, sx / 2 + 6, 2, 22, 0); // door opening
  return { models: [m], p };
}

const out = new URL('../public/vox/', import.meta.url);
mkdirSync(out, { recursive: true });
const assets: Record<string, { models: VoxModel[]; p: PaletteBuilder }> = {
  crate: crate(),
  wall: wall(),
  'building-a': building(3, 'concrete'),
  'building-b': building(2, 'brick'),
};
for (const [name, a] of Object.entries(assets)) {
  const bytes = writeVox({ models: a.models, palette: a.p.palette, materials: a.p.materials });
  writeFileSync(new URL(`${name}.vox`, out), bytes);
  console.log(`public/vox/${name}.vox  ${a.models[0]!.size.join('×')}  ${bytes.length} bytes`);
}
