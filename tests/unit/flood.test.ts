import { describe, expect, it } from 'vitest';
import { findDetached, findIslands, linearIndex } from '../../src/voxel/flood.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

const groundAnchor = (_x: number, y: number) => y === 0;

describe('findIslands (dynamic volumes)', () => {
  it('finds one island for a solid box and an L-shape', () => {
    const v = new VoxelVolume(6, 6, 6);
    v.fillBox(0, 0, 0, 3, 3, 3, 1);
    expect(findIslands(v).length).toBe(1);
    v.fillBox(3, 0, 0, 6, 1, 1, 1);
    const islands = findIslands(v);
    expect(islands.length).toBe(1);
    expect(islands[0]!.voxels.length).toBe(27 + 3);
  });

  it('splits separated parts and sorts largest first', () => {
    const v = new VoxelVolume(10, 4, 4);
    v.fillBox(0, 0, 0, 2, 2, 2, 1); // 8 voxels
    v.fillBox(5, 0, 0, 8, 3, 3, 1); // 27 voxels
    v.set(9, 3, 3, 2); // 1 voxel
    const islands = findIslands(v);
    expect(islands.map((i) => i.voxels.length)).toEqual([27, 8, 1]);
    expect(islands[0]!.min).toEqual([5, 0, 0]);
    expect(islands[0]!.max).toEqual([7, 2, 2]);
  });

  it('uses 6-connectivity: edge- or corner-touching voxels are separate', () => {
    const v = new VoxelVolume(3, 3, 3);
    v.set(0, 0, 0, 1);
    v.set(1, 1, 0, 1); // shares an edge only
    v.set(2, 2, 2, 1); // shares a corner only
    expect(findIslands(v).length).toBe(3);
  });
});

describe('findDetached (static volumes, anchored at y = 0)', () => {
  function pillarAndSlab(): VoxelVolume {
    const v = new VoxelVolume(20, 16, 20);
    v.fillBox(8, 0, 8, 12, 10, 12, 1); // pillar 4×10×4 standing on the ground layer
    v.fillBox(2, 10, 2, 18, 12, 18, 1); // slab 16×2×16 resting on the pillar only
    return v;
  }

  it('keeps everything that still touches the anchor layer', () => {
    const v = pillarAndSlab();
    const seeds = [linearIndex(v, 10, 5, 10), linearIndex(v, 3, 10, 3)];
    expect(findDetached(v, seeds, groundAnchor)).toEqual([]);
  });

  it('detaches the slab and upper pillar when the pillar is cut', () => {
    const v = pillarAndSlab();
    v.fillBox(8, 4, 8, 12, 6, 12, 0); // cut through the pillar at y 4..5
    const seeds = [linearIndex(v, 10, 3, 10), linearIndex(v, 10, 6, 10)];
    const islands = findDetached(v, seeds, groundAnchor);
    expect(islands.length).toBe(1);
    expect(islands[0]!.voxels.length).toBe(4 * 4 * 4 + 16 * 2 * 16); // pillar y 6..9 + slab
    expect(islands[0]!.min).toEqual([2, 6, 2]);
    expect(islands[0]!.max).toEqual([17, 11, 17]);
  });

  it('reports separate detached pieces separately and ignores duplicate seeds', () => {
    const v = new VoxelVolume(12, 8, 4);
    v.fillBox(0, 0, 0, 12, 1, 4, 1); // ground
    v.fillBox(1, 3, 0, 3, 5, 2, 1); // floating block A (16 voxels... 2×2×2 = 8)
    v.fillBox(7, 3, 0, 10, 4, 1, 1); // floating block B (3 voxels)
    const seeds = [linearIndex(v, 1, 3, 0), linearIndex(v, 2, 4, 1), linearIndex(v, 8, 3, 0), linearIndex(v, 5, 0, 0)];
    const islands = findDetached(v, seeds, groundAnchor);
    expect(islands.map((i) => i.voxels.length).sort((a, b) => a - b)).toEqual([3, 8]);
  });

  it('treats components larger than the search limit as anchored', () => {
    const v = new VoxelVolume(30, 10, 30);
    v.fillBox(0, 5, 0, 30, 8, 30, 1); // big floating slab (2700 voxels)
    expect(findDetached(v, [linearIndex(v, 0, 5, 0)], groundAnchor, 1000)).toEqual([]);
    expect(findDetached(v, [linearIndex(v, 0, 5, 0)], groundAnchor, 10_000).length).toBe(1);
  });
});
