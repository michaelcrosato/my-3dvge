import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { carve, querySolid } from '../../src/sim/destruction.ts';
import { RapierBackend } from '../../src/sim/physics/rapier-backend.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

const noEvents = { volumeAdded: () => undefined, volumeRemoved: () => undefined };

async function makeWorld(): Promise<SimWorld> {
  return new SimWorld({ ...DEFAULT_PARAMS }, null, noEvents, await RapierBackend.create());
}

function flatGround(world: SimWorld, size = 100): void {
  const map = new Uint8Array(4 * 4 * 4).fill(128);
  world.setGround({ x0: -size, z0: -size, x1: size, z1: size, map: { width: 4, height: 4, data: map }, slabs: [{ x0: -size, z0: -size, x1: size, z1: size, y: 0 }] });
}

describe('engine extensions', () => {
  it('ground slabs collide and report height, holes fall through', async () => {
    const world = await makeWorld();
    const map = new Uint8Array(4 * 4 * 4);
    world.setGround({ x0: -10, z0: -10, x1: 10, z1: 10, map: { width: 4, height: 4, data: map }, slabs: [{ x0: -10, z0: -10, x1: 0, z1: 10, y: 0 }] });
    expect(world.groundHeight(-5, 0)).toBe(0);
    expect(world.groundHeight(5, 0)).toBe(Number.NEGATIVE_INFINITY);
    const a = world.spawnCrate([-5, 2, 0], [0, -1, 0]);
    const b = world.spawnCrate([5, 2, 0], [0, -1, 0]);
    for (let i = 0; i < 90; i++) world.step(1 / 60);
    expect(world.physics!.centerOfMass(a.body)[1]).toBeGreaterThan(0.1);
    expect(world.physics!.centerOfMass(b.body)[1]).toBeLessThan(-2);
  });

  it('kinematic volumes follow their target pose and push dynamic bodies', async () => {
    const world = await makeWorld();
    flatGround(world);
    const wood = world.palette.add(0x996633, 'wood');
    const wall = new VoxelVolume(10, 20, 30);
    wall.fillBox(0, 0, 0, 10, 20, 30, wood);
    const k = world.addVolume('kinematic', wall, [-3, 0.01, -1.5], [0, 0, 0, 1], 'prop', { destructible: false });
    const crate = world.spawnCrate([0, 0.5, 0], [1, 0, 0]);
    world.physics!.setVelocity(crate.body, [0, 0, 0], [0, 0, 0]);
    for (let i = 0; i < 120; i++) {
      world.setKinematicPose(k.id, [-3 + (i / 60) * 2, 0.01, -1.5], [0, 0, 0, 1]);
      world.step(1 / 60);
    }
    expect(world.physics!.centerOfMass(crate.body)[0]).toBeGreaterThan(1.5);
    const out = new Float32Array(2048 * 8);
    world.writeTransforms(out);
    expect(out[k.slot * 8]).toBeCloseTo(-3 + (119 / 60) * 2, 3);
  });

  it('box carving removes voxels inside an oriented box only', async () => {
    const world = await makeWorld();
    const concrete = world.palette.add(0xaaaaaa, 'concrete');
    const block = new VoxelVolume(40, 20, 40);
    block.fillBox(0, 0, 0, 40, 20, 40, concrete);
    const sv = world.addVolume('static', block, [0, 0, 0], [0, 0, 0, 1], 'scene');
    const q = querySolid(world, { kind: 'box', center: [2, 1, 2], half: [0.5, 0.5, 0.5], rotation: [0, 0, 0, 1] });
    expect(q.count).toBe(1000);
    const r = carve(world, { kind: 'box', center: [2, 1, 2], half: [0.5, 0.5, 0.5], rotation: [0, 0, 0, 1] }, 5);
    expect(r.removedVoxels).toBeGreaterThan(500);
    expect(r.removedVoxels).toBeLessThanOrEqual(1000);
    expect(sv.volume.get(20, 10, 20)).toBe(0);
    expect(sv.volume.get(5, 10, 5)).toBe(concrete);
    // Too strong for the power: nothing breaks.
    expect(carve(world, { kind: 'box', center: [3, 1, 3], half: [0.3, 0.3, 0.3], rotation: [0, 0, 0, 1] }, 1).removedVoxels).toBe(0);
  });

  it('structures collapse into timed debris after enough damage', async () => {
    const world = await makeWorld();
    flatGround(world);
    const brick = world.palette.add(0xaa5533, 'brick');
    const house = new VoxelVolume(40, 30, 40);
    house.fillBox(0, 0, 0, 40, 30, 40, brick);
    const sv = world.addVolume('static', house, [0, 0, 0], [0, 0, 0, 1], 'scene');
    const s = world.structures.register(sv.id, { collapseAt: 0.2, fragments: 8, debrisLifetime: 1 });
    let collapsed = 0;
    world.structures.onCollapse(() => collapsed++);
    world.structures.damage(s, s.total * 0.1);
    expect(collapsed).toBe(0);
    world.structures.damage(sv.id, s.total * 0.15);
    expect(collapsed).toBe(1);
    expect(world.volumes.has(sv.id)).toBe(false);
    const debris = [...world.volumes.values()].filter((v) => v.tag === 'debris');
    expect(debris.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 60 * 5; i++) world.step(1 / 60);
    expect([...world.volumes.values()].filter((v) => v.tag === 'debris').length).toBe(0); // crumbled after their lifetime
    expect(world.takeParticles()!.length).toBeGreaterThan(0);
  });

  it('explosives chain: carving one TNT crate detonates its neighbour', async () => {
    const world = await makeWorld();
    flatGround(world);
    const tnt = world.palette.add(0xcc2222, 'tnt');
    const crate = () => {
      const v = new VoxelVolume(6, 6, 6);
      v.fillBox(0, 0, 0, 6, 6, 6, tnt);
      return v;
    };
    const a = world.addVolume('dynamic', crate(), [0, 0.01, 0], [0, 0, 0, 1], 'prop');
    const b = world.addVolume('dynamic', crate(), [2.5, 0.01, 0], [0, 0, 0, 1], 'prop');
    expect(a.explosive && b.explosive).toBe(true);
    let explosions = 0;
    world.on('explosion', () => explosions++);
    carve(world, { kind: 'sphere', center: [0.3, 0.3, 0.3], radius: 0.3 }, 5);
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    expect(explosions).toBe(2);
    expect(world.volumes.has(a.id) || world.volumes.has(b.id)).toBe(false);
  });

  it('raycast vehicles drive forward (-z) with positive engine force and steer left with positive steer', async () => {
    const world = await makeWorld();
    flatGround(world);
    const physics = world.physics!;
    const chassis = physics.createBody('dynamic', [0, 1, 0], [0, 0, 0, 1], { canSleep: false });
    physics.addBoxes(chassis, [{ cx: 0, cy: 0, cz: 0, hx: 0.9, hy: 0.3, hz: 1.8, density: 0, friction: 0.5, restitution: 0, mass: { mass: 1200, com: [0, -0.2, 0], inertia: [1200, 1400, 400] } }]);
    const wheel = (x: number, z: number) => ({ position: [x, -0.1, z] as [number, number, number], radius: 0.35, suspensionRest: 0.35, maxTravel: 0.3, stiffness: 30, compression: 4, relaxation: 5, maxForce: 60000, frictionSlip: 2, sideFriction: 1 });
    const v = physics.createVehicle(chassis, [wheel(-0.8, -1.2), wheel(0.8, -1.2), wheel(-0.8, 1.2), wheel(0.8, 1.2)]);
    const drive = (engine: number, steer: number) => [0, 1, 2, 3].map((i) => ({ engine: i >= 2 ? engine : 0, brake: 0, steer: i < 2 ? steer : 0 }));
    for (let i = 0; i < 120; i++) {
      physics.updateVehicle(v, 1 / 60, drive(1500, 0));
      world.step(1 / 60);
    }
    const p = physics.centerOfMass(chassis);
    expect(p[2]).toBeLessThan(-2);
    expect(Math.abs(p[0])).toBeLessThan(0.5);
    expect(physics.wheelContacts(v).every(Boolean)).toBe(true);
    for (let i = 0; i < 90; i++) {
      physics.updateVehicle(v, 1 / 60, drive(1500, 0.4));
      world.step(1 / 60);
    }
    const q = physics.centerOfMass(chassis);
    expect(q[0]).toBeLessThan(p[0] - 1); // turned toward -x (left when facing -z)
  });
});
