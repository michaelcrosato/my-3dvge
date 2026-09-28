import { describe, expect, it } from 'vitest';
import { mergeBoxes, mergeBoxesCoarse, type VoxelBox } from '../../src/voxel/boxes.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

function coverage(v: VoxelVolume, boxes: VoxelBox[]): { covered: Map<string, number>; emptyCovered: number } {
  const covered = new Map<string, number>();
  let emptyCovered = 0;
  for (const b of boxes)
    for (let z = b.z0; z < b.z1; z++)
      for (let y = b.y0; y < b.y1; y++)
        for (let x = b.x0; x < b.x1; x++) {
          const k = `${x},${y},${z}`;
          covered.set(k, (covered.get(k) ?? 0) + 1);
          if (v.get(x, y, z) === 0) emptyCovered++;
        }
  return { covered, emptyCovered };
}

function expectExactCover(v: VoxelVolume, boxes: VoxelBox[]): void {
  const { covered, emptyCovered } = coverage(v, boxes);
  expect(emptyCovered).toBe(0);
  let solid = 0;
  v.forEachSolid((x, y, z) => {
    solid++;
    expect(covered.get(`${x},${y},${z}`)).toBe(1);
  });
  expect(covered.size).toBe(solid);
}

describe('collider box merging', () => {
  it('merges a solid block into one box', () => {
    const v = new VoxelVolume(10, 6, 4);
    v.fillBox(0, 0, 0, 10, 6, 4, 3);
    const boxes = mergeBoxes(v, 0, 0, 0, 10, 6, 4);
    expect(boxes).toEqual([{ x0: 0, y0: 0, z0: 0, x1: 10, y1: 6, z1: 4, key: 1 }]);
  });

  it('covers an L-shape exactly with two boxes', () => {
    const v = new VoxelVolume(8, 8, 1);
    v.fillBox(0, 0, 0, 8, 2, 1, 1);
    v.fillBox(0, 2, 0, 2, 8, 1, 1);
    const boxes = mergeBoxes(v, 0, 0, 0, 8, 8, 1);
    expect(boxes.length).toBe(2);
    expectExactCover(v, boxes);
  });

  it('never merges voxels with different keys', () => {
    const v = new VoxelVolume(4, 1, 1);
    v.fillBox(0, 0, 0, 2, 1, 1, 1);
    v.fillBox(2, 0, 0, 4, 1, 1, 2);
    const boxes = mergeBoxes(v, 0, 0, 0, 4, 1, 1, (p) => p);
    expect(boxes.map((b) => b.key).sort()).toEqual([1, 2]);
    expectExactCover(v, boxes);
  });

  it('exactly covers random shapes (property test)', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 25; trial++) {
      const v = new VoxelVolume(12, 12, 12);
      const fill = 0.2 + rnd() * 0.7;
      for (let z = 0; z < 12; z++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (rnd() < fill) v.set(x, y, z, 1 + Math.floor(rnd() * 3));
      expectExactCover(v, mergeBoxes(v, 0, 0, 0, 12, 12, 12));
      expectExactCover(v, mergeBoxes(v, 0, 0, 0, 12, 12, 12, (p) => p));
    }
  });

  it('respects region bounds (per-chunk colliders)', () => {
    const v = new VoxelVolume(64, 4, 4);
    v.fillBox(0, 0, 0, 64, 4, 4, 1);
    const boxes = mergeBoxes(v, 32, 0, 0, 64, 4, 4);
    expect(boxes).toEqual([{ x0: 32, y0: 0, z0: 0, x1: 64, y1: 4, z1: 4, key: 1 }]);
  });

  it('coarse merging covers every solid voxel', () => {
    const v = new VoxelVolume(9, 9, 9);
    for (let i = 0; i < 9; i++) v.set(i, i, (i * 5) % 9, 1);
    const boxes = mergeBoxesCoarse(v, 2);
    const { covered } = coverage(v, boxes);
    v.forEachSolid((x, y, z) => expect(covered.get(`${x},${y},${z}`)).toBeGreaterThanOrEqual(1));
    expect(boxes.every((b) => b.x1 <= 9 && b.y1 <= 9 && b.z1 <= 9)).toBe(true);
  });
});
