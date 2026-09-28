import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { createArtKit } from '../../src/game/sim/art/index.ts';
import { spawnVehicle, type DriveIntent, type Vehicle, type VehicleHooks } from '../../src/game/sim/vehicles.ts';
import { gameScene } from '../../src/game/sim/scene.ts';
import type { GameInput, GameSnapshot, SimMessage } from '../../src/game/shared/types.ts';
import { RapierBackend } from '../../src/sim/physics/rapier-backend.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

async function arena() {
  const world = new SimWorld({ ...DEFAULT_PARAMS }, null, { volumeAdded: () => undefined, volumeRemoved: () => undefined }, await RapierBackend.create());
  const map = new Uint8Array(64).fill(100);
  world.setGround({ x0: -60, z0: -60, x1: 60, z1: 60, map: { width: 4, height: 4, data: map }, slabs: [{ x0: -60, z0: -60, x1: 60, z1: 60, y: 0 }] });
  const kit = createArtKit(world.palette, () => world.random());
  let hits = 0;
  const events: string[] = [];
  const hooks: VehicleHooks = {
    world,
    canWreck: (sv) => sv.destructible && sv.tag !== 'vehicle',
    isCrushable: () => false,
    onHit: () => hits++,
    onEvent: (e) => events.push(e.e),
    fireMissile: () => undefined,
  };
  const brick = world.palette.add(0xa4533c, 'brick');
  const building = (x: number, z: number, w = 40, h = 30, d = 40) => {
    const v = new VoxelVolume(w, h, d);
    v.fillBox(0, 0, 0, w, h, d, brick);
    v.fillBox(3, 0, 3, w - 3, h - 3, d - 3, 0);
    const sv = world.addVolume('static', v, [x - (w * 0.1) / 2, 0, z - (d * 0.1) / 2], [0, 0, 0, 1], 'scene');
    return world.structures.register(sv.id, { collapseAt: 0.3 });
  };
  const drive = (v: Vehicle, intent: Partial<DriveIntent>, seconds: number) => {
    const full: DriveIntent = { throttle: 0, steer: 0, dir: null, action: false, actionPressed: false, jump: false, jumpPressed: false, assist: true, ...intent };
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      v.drive(full, 1 / 60);
      world.step(1 / 60);
      v.afterStep(1 / 60);
      full.actionPressed = false;
      full.jumpPressed = false;
    }
  };
  world.syncColliders();
  return { world, kit, hooks, building, drive, hits: () => hits, events };
}

describe('vehicle destruction mechanics', () => {
  it('PLOWHORSE cannot grind through stone or metal', async () => {
    for (const material of ['stone', 'metal'] as const) {
      const a = await arena();
      const paletteIndex = a.world.palette.add(0x777777, material);
      const volume = new VoxelVolume(40, 30, 40);
      volume.fillBox(0, 0, 0, 40, 30, 40, paletteIndex);
      const sv = a.world.addVolume('static', volume, [4, 0, -2], [0, 0, 0, 1], 'scene');
      const structure = a.world.structures.register(sv.id);
      const dozer = spawnVehicle(a.hooks, a.kit, 'dozer', -6, 0, -Math.PI / 2);
      a.drive(dozer, { throttle: 1 }, 7);
      expect(dozer.center()[0]).toBeGreaterThan(0); // reached the wall
      expect(structure.damage).toBe(0);
      expect(volume.voxelCount).toBe(40 * 30 * 40);
    }
  });

  it('PLOWHORSE rams a brick building and grinds into it', async () => {
    const a = await arena();
    const s = a.building(6, 0);
    const dozer = spawnVehicle(a.hooks, a.kit, 'dozer', -6, 0, -Math.PI / 2);
    a.drive(dozer, { throttle: 1 }, 5);
    expect(a.hits()).toBeGreaterThan(0);
    expect(s.damage).toBeGreaterThan(0);
  });

  it('TAILWHIP wrecks with its rear, not its nose', async () => {
    const a = await arena();
    const front = a.building(7, 0);
    const truck = spawnVehicle(a.hooks, a.kit, 'truck', 0, 0, -Math.PI / 2);
    a.drive(truck, { throttle: 1 }, 3);
    const noseDamage = front.damage;
    const back = a.building(-14, 0);
    a.drive(truck, { throttle: -1 }, 4);
    expect(back.damage).toBeGreaterThan(noseDamage);
    // Power slide engages with action + steer at speed.
    const truck2 = spawnVehicle(a.hooks, a.kit, 'truck', 0, 30, -Math.PI / 2);
    a.drive(truck2, { throttle: 1 }, 2.5);
    a.drive(truck2, { throttle: 1, steer: 1, action: true }, 1);
    expect(a.events).toContain('slide');
  });

  it('SKYLARK crushes what it lands on at speed; turbo spends fuel', async () => {
    const a = await arena();
    const s = a.building(0, 0, 50, 30, 50);
    const buggy = spawnVehicle(a.hooks, a.kit, 'buggy', -3, 0, -Math.PI / 2);
    a.world.physics!.setPose(buggy.sv.body, [-8, 6, -1], [0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)]);
    a.world.physics!.setVelocity(buggy.sv.body, [9, 0, 0], [0, 0, 0]);
    a.drive(buggy, {}, 1.5);
    expect(s.damage).toBeGreaterThan(0);
    const before = buggy.meter()!.value;
    a.drive(buggy, { actionPressed: true, throttle: 1 }, 0.1);
    expect(a.events).toContain('turbo');
    expect(buggy.meter()!.value).toBeLessThan(before);
  });

  it('HAMMERHEAD flies on thrusters and stomps through a roof', async () => {
    const a = await arena();
    const s = a.building(0, 0, 50, 30, 50);
    const mech = spawnVehicle(a.hooks, a.kit, 'mech', -10, 0, 0);
    const y0 = mech.center()[1];
    a.drive(mech, { jump: true }, 1.2);
    expect(mech.center()[1]).toBeGreaterThan(y0 + 2);
    a.world.physics!.setPose(mech.sv.body, [-0.9, 7, -0.8], [0, 0, 0, 1]);
    a.drive(mech, { actionPressed: true }, 0.1);
    a.drive(mech, {}, 1.5);
    expect(a.events).toContain('stomp');
    expect(s.damage).toBeGreaterThan(0);
  });
});

describe('FREIGHT HOPPER bridges the rail cut', () => {
  it('driving the flatbed under the lane fills the rail gap', async () => {
    const msgs: SimMessage[] = [];
    const world = new SimWorld({ ...DEFAULT_PARAMS, scene: 'cinder' }, null, { volumeAdded: () => undefined, volumeRemoved: () => undefined, game: (d) => msgs.push(d as SimMessage) }, await RapierBackend.create());
    const scene = gameScene('cinder');
    const ctx = world.sceneContext();
    await scene.build(ctx);
    world.scenePreStep = (dt) => scene.preStep!(ctx, dt);
    world.sceneUpdate = (dt) => scene.update!(ctx, dt);
    world.syncColliders();
    world.spawnPlayer();
    const input = (p: Partial<GameInput>): GameInput => ({ move: [0, 0], camYaw: 0, relative: false, lookYaw: 0, lookPitch: 0, jump: false, action: false, sprint: false, actionCount: 0, jumpCount: 0, enter: 0, reset: 0, ...p });
    const run = (s: number) => { for (let i = 0; i < s * 60; i++) world.step(1 / 60); };
    const snap = () => [...msgs].reverse().find((m) => m.k === 'snap')!.data as GameSnapshot;
    scene.onMessage!(ctx, { t: 'start', mode: 'mission' });
    scene.onMessage!(ctx, { t: 'skipFlyover' });
    run(3.2);
    world.player!.teleport([-23.2, 0, 12.5]);
    run(0.2);
    scene.onMessage!(ctx, { t: 'input', input: input({ enter: 1 }) });
    run(0.2);
    expect(snap().player.vehicle).toBe('train');
    // Relative mode: stick "forward" with camera yaw 0 means toward -z (north), where the lane is.
    scene.onMessage!(ctx, { t: 'input', input: input({ enter: 1, relative: true, move: [0, 1] }) });
    for (let i = 0; i < 20 * 60 && !snap().aligned; i++) world.step(1 / 60);
    scene.onMessage!(ctx, { t: 'input', input: input({ enter: 1 }) });
    expect(snap().aligned).toBe(true);
    expect(snap().gaps.find((g) => g.id === 1)!.filled).toBe(true);
  });
});
