import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { blast, carve } from '../../src/sim/destruction.ts';
import { RapierBackend } from '../../src/sim/physics/rapier-backend.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { VOXEL_SIZE } from '../../src/voxel/constants.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

const noEvents = { volumeAdded: () => undefined, volumeRemoved: () => undefined };

async function makeWorld(): Promise<SimWorld> {
  const physics = await RapierBackend.create();
  return new SimWorld({ ...DEFAULT_PARAMS }, null, noEvents, physics);
}

function groundVolume(world: SimWorld, size = 64, thickness = 4): VoxelVolume {
  const dirt = world.palette.add(0x7a5a3a, 'dirt');
  const g = new VoxelVolume(size, 8, size);
  g.fillBox(0, 0, 0, size, thickness, size, dirt);
  return g;
}

describe('physics (Node + Rapier)', () => {
  it('a crate dropped on the ground comes to rest within 3 s', async () => {
    const world = await makeWorld();
    const size = 64;
    world.addVolume('static', groundVolume(world, size), [-(size * VOXEL_SIZE) / 2, 0, -(size * VOXEL_SIZE) / 2], [0, 0, 0, 1], 'scene');
    const crate = world.spawnCrate([0, 2.5, 0], [0, -1, 0]);
    const body = crate.body;
    const physics = world.physics!;
    expect(physics.mass(body)).toBeCloseTo(125 * 0.001 * 600, 3); // voxel count × wood density

    let restedAt = -1;
    for (let i = 1; i <= 180; i++) {
      world.step(1 / 60);
      const v = physics.linvel(body);
      const w = physics.angvel(body);
      const still = Math.hypot(...v) < 0.05 && Math.hypot(...w) < 0.05;
      if (still && restedAt < 0 && i > 10) restedAt = i;
      if (!still) restedAt = -1;
    }
    expect(restedAt).toBeGreaterThan(0);
    expect(restedAt).toBeLessThanOrEqual(180);
    // Resting on the ground top (0.4 m): the crate's center of mass is 0.25 m above it.
    const com = physics.centerOfMass(body);
    expect(com[1]).toBeGreaterThan(0.4 + 0.25 - 0.05);
    expect(com[1]).toBeLessThan(0.4 + 0.25 + 0.1);
  });

  it('builds per-chunk static colliders and removes them with the volume', async () => {
    const world = await makeWorld();
    const g = groundVolume(world, 64);
    const sv = world.addVolume('static', g, [0, 0, 0], [0, 0, 0, 1], 'scene');
    world.syncColliders();
    expect(sv.chunkColliders.size).toBe(4); // 2×1×2 chunks, one merged box each
    expect(world.physics!.colliderCount()).toBe(4);
    world.removeVolume(sv.id);
    expect(world.physics!.colliderCount()).toBe(0);
  });

  it('enforces the dynamic body budget by despawning the oldest', async () => {
    const world = await makeWorld();
    world.settings.maxBodies = 3;
    const ids = [0, 1, 2, 3, 4].map((i) => world.spawnCrate([i * 2, 5, 0], [0, -1, 0]).id);
    world.step(1 / 60);
    expect(world.dynamicCount()).toBe(3);
    expect(world.volumes.has(ids[0]!)).toBe(false);
    expect(world.volumes.has(ids[4]!)).toBe(true);
  });

  it('the player walks up one-voxel steps', async () => {
    const world = await makeWorld();
    const stone = world.palette.add(0x999999, 'stone');
    const g = new VoxelVolume(120, 16, 20);
    g.fillBox(0, 0, 0, 120, 4, 20, stone);
    for (let i = 0; i < 8; i++) g.fillBox(20 + i * 4, 4, 0, 24 + i * 4, 5 + i, 20, stone);
    g.fillBox(52, 4, 0, 120, 12, 20, stone); // platform at the top step's height (1.2 m)
    world.addVolume('static', g, [0, 0, 0], [0, 0, 0, 1], 'scene');
    world.spawn = [1, 0.4, 1];
    world.spawnPlayer();
    // Face +x (yaw = -90°) and walk forward.
    world.input = { move: [0, 1], yaw: -Math.PI / 2, pitch: 0, jump: false, sprint: false, fly: false, vertical: 0 };
    for (let i = 0; i < 120; i++) world.step(1 / 60);
    const p = world.player!.position;
    expect(p[0]).toBeGreaterThan(5.5); // climbed the stairs (x 2.0–5.2 m) onto the platform
    expect(p[1]).toBeGreaterThan(1.2 + 0.9 - 0.1); // platform top (1.2 m) + capsule center (0.9 m)
  });

  it('carving through a pillar under a slab creates a falling dynamic body', async () => {
    const world = await makeWorld();
    const concrete = world.palette.add(0xa8a49b, 'concrete');
    const dirt = world.palette.add(0x7a5a3a, 'dirt');
    const g = new VoxelVolume(64, 48, 64);
    g.fillBox(0, 0, 0, 64, 4, 64, dirt);
    g.fillBox(30, 4, 30, 34, 34, 34, concrete); // pillar 0.4 × 3 m
    g.fillBox(20, 34, 20, 44, 37, 44, concrete); // slab on top of the pillar only
    const sv = world.addVolume('static', g, [0, 0, 0], [0, 0, 0, 1], 'scene');
    world.syncColliders();
    world.step(1 / 60);
    const before = world.dynamicCount();
    const voxelsBefore = sv.volume.voxelCount;

    const r = carve(world, [3.2, 1.5, 3.2], 0.5, 5);
    expect(r.removedVoxels).toBeGreaterThan(0);
    expect(r.newBodies).toBeGreaterThanOrEqual(1);
    expect(world.dynamicCount()).toBeGreaterThan(before);
    expect(sv.volume.voxelCount).toBeLessThan(voxelsBefore - r.removedVoxels);

    const debris = [...world.volumes.values()].find((v) => v.tag === 'debris')!;
    const y0 = world.physics!.centerOfMass(debris.body)[1];
    for (let i = 0; i < 30; i++) world.step(1 / 60);
    expect(world.physics!.centerOfMass(debris.body)[1]).toBeLessThan(y0 - 0.1); // it falls
  });

  it('bedrock survives any blast and small fragments become particles', async () => {
    const world = await makeWorld();
    const bedrock = world.palette.add(0x333333, 'bedrock');
    const wood = world.palette.add(0x9c6b3f, 'wood');
    const g = new VoxelVolume(20, 20, 20);
    g.fillBox(0, 0, 0, 20, 1, 20, bedrock);
    g.fillBox(10, 1, 10, 11, 15, 11, wood); // thin post
    world.addVolume('static', g, [0, 0, 0], [0, 0, 0, 1], 'scene');
    world.settings.particleThreshold = 4;
    const r = carve(world, [1.05, 0.25, 1.05], 0.3, 10); // cuts the post near its base
    expect(g.get(10, 0, 10)).toBe(bedrock);
    expect(r.newBodies).toBe(1); // the rest of the post (> 4 voxels) falls as a body
    blast(world, [0.55, 0.05, 0.55], undefined, 1, 100); // point-blank on bedrock
    let intact = 0;
    for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++) if (g.get(x, 0, z) === bedrock) intact++;
    expect(intact).toBe(400);
  });

  it('splits a dynamic body into islands when carved in two', async () => {
    const world = await makeWorld();
    const wood = world.palette.add(0x9c6b3f, 'wood');
    const beam = new VoxelVolume(30, 3, 3);
    beam.fillBox(0, 0, 0, 30, 3, 3, wood);
    world.addVolume('dynamic', beam, [0, 5, 0], [0, 0, 0, 1], 'scene');
    const before = world.dynamicCount();
    const r = carve(world, [1.5, 5.15, 0.15], 0.35, 5); // cut the middle of the beam
    expect(r.newBodies).toBe(1);
    expect(world.dynamicCount()).toBe(before + 1);
  });
});
