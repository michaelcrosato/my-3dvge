import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
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
});
