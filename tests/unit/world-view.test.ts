import { describe, expect, it } from 'vitest';
import { WorldView } from '../../src/render/world-view.ts';
import type { MeshResult, VolumeInfo } from '../../src/shared/protocol.ts';

function result(version: number, empty = false): MeshResult {
  return {
    type: 'mesh', volumeId: 1, chunk: 0, version, origin: [0, 0, 0], ms: 0,
    positions: empty ? new Float32Array() : new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array(empty ? 0 : 9), colors: new Uint8Array(empty ? 0 : 12),
    indices: empty ? new Uint16Array() : new Uint16Array([0, 1, 2]),
  };
}

describe('worker mesh ordering', () => {
  for (const size of [32, 128]) it(`keeps empty-chunk versions for a ${size}-voxel volume`, () => {
    const world = new WorldView();
    const info: VolumeInfo = { id: 1, kind: 'static', slot: -1, size: [size, size, size], position: [0, 0, 0], rotation: [0, 0, 0, 1], castShadow: true };
    // Cross-worker messages can arrive before the simulation's volumeAdded message.
    world.enqueue(result(2, true));
    world.processQueue(100);
    world.addVolume(info);
    world.enqueue(result(1));
    world.processQueue(100);
    expect(world.chunkMeshes).toBe(0);
    world.enqueue(result(3));
    world.processQueue(100);
    expect(world.chunkMeshes).toBe(1);
    world.enqueue(result(4, true));
    world.processQueue(100);
    world.enqueue(result(3));
    world.processQueue(100);
    expect(world.chunkMeshes).toBe(0);
    world.removeVolume(1);
    world.enqueue(result(5));
    world.processQueue(100);
    expect(world.chunkMeshes).toBe(0);
    world.clear();
    world.material.dispose();
  });
});
