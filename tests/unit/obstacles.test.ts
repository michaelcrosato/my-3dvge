/**
 * Every lane obstacle in Cinder Flats falls to the tool the level intends (headless, real physics).
 * Vehicles are positioned with setPose (the tests check the mechanics, not the driving).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { gameScene } from '../../src/game/sim/scene.ts';
import type { GameEvent, GameInput, GameSnapshot, LevelStatic, SimMessage } from '../../src/game/shared/types.ts';
import { RapierBackend } from '../../src/sim/physics/rapier-backend.ts';
import type { SimVolume } from '../../src/sim/world.ts';
import { SimWorld } from '../../src/sim/world.ts';

async function boot() {
  const msgs: SimMessage[] = [];
  const world = new SimWorld({ ...DEFAULT_PARAMS, scene: 'cinder' }, null, { volumeAdded: () => undefined, volumeRemoved: () => undefined, game: (d) => msgs.push(d as SimMessage) }, await RapierBackend.create());
  const scene = gameScene('cinder');
  const ctx = world.sceneContext();
  await scene.build(ctx);
  world.scenePreStep = (dt) => scene.preStep!(ctx, dt);
  world.sceneUpdate = (dt) => scene.update!(ctx, dt);
  world.syncColliders();
  world.spawnPlayer();
  const send = (m: unknown) => scene.onMessage!(ctx, m);
  const input = (p: Partial<GameInput>): GameInput => ({ move: [0, 0], camYaw: 0, relative: false, lookYaw: 0, lookPitch: 0, jump: false, action: false, sprint: false, actionCount: 0, jumpCount: 0, enter: 0, reset: 0, ...p });
  const stat = msgs.find((m) => m.k === 'static')!.data as LevelStatic;
  const snap = () => [...msgs].reverse().find((m) => m.k === 'snap')?.data as GameSnapshot;
  const events = () => msgs.flatMap((m) => (m.k === 'events' ? m.list : [])) as GameEvent[];
  const collapsed = (name: string) => events().filter((e) => e.e === 'collapse' && e.name === name).length;
  const struct = (name: string) => stat.structures.filter((s) => s.name === name);
  const vehicle = (sx: number, sz: number) => [...world.volumes.values()].find((v) => v.tag === 'vehicle' && v.volume.sizeX === sx && v.volume.sizeZ === sz) as SimVolume;
  const step = (n: number) => { for (let i = 0; i < n; i++) world.step(1 / 60); };
  send({ t: 'start', mode: 'timeAttack' });
  send({ t: 'skipFlyover' });
  step(200);
  let enter = 0;
  const board = (v: SimVolume, near: [number, number]) => {
    world.player!.teleport([near[0], 0, near[1]]);
    step(10);
    send({ t: 'input', input: input({ enter: ++enter }) });
    step(6);
  };
  const drive = (p: Partial<GameInput>, seconds: number) => {
    send({ t: 'input', input: input({ enter, ...p }) });
    step(Math.round(seconds * 60));
  };
  return { world, send, input, snap, events, collapsed, struct, vehicle, step, board, drive, enterCount: () => enter };
}

describe('Cinder Flats lane obstacles', () => {
  it('ramming the gas pumps sets off a chain explosion that takes both pumps', async () => {
    const g = await boot();
    const dozer = g.vehicle(30, 46);
    const pump = g.struct('GAS PUMPS')[0]!;
    // Dozer 12 m west of the first pump, facing +x.
    g.world.physics!.setPose(dozer.body, [pump.x - 12, 0.4, pump.z - 1.5 - 0.3], [0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], true);
    g.board(dozer, [pump.x - 11, pump.z + 2]);
    g.drive({ move: [0, 1] }, 5);
    g.step(60);
    expect(g.events().filter((e) => e.e === 'explosion').length).toBeGreaterThan(0);
    expect(g.collapsed('GAS PUMPS')).toBe(2);
  });

  it('TNT pushed against the stone depot blows it down (the dozer alone cannot)', async () => {
    const g = await boot();
    const depot = g.struct('STONE DEPOT')[0]!;
    // Detonate a TNT crate right at the depot's west wall (as if pushed there): stack of the level's crates.
    const tnts = [...g.world.volumes.values()].filter((v) => v.explosive && v.kind === 'dynamic');
    expect(tnts.length).toBeGreaterThanOrEqual(3);
    let placed = 0;
    for (const t of tnts.slice(0, 3)) {
      g.world.physics!.setPose(t.body, [depot.x - depot.w / 2 - 0.9, 0.05 + placed * 0.85, depot.z - 0.4], [0, 0, 0, 1], true);
      placed++;
    }
    g.step(30);
    g.world.explodeVolume(tnts[0]!, 0);
    g.step(90);
    expect(g.collapsed('STONE DEPOT')).toBe(1);
  });

  it("TAILWHIP's tail wrecks a row house", async () => {
    const g = await boot();
    const truck = g.vehicle(26, 56);
    const house = g.struct("ROW HOUSE")[2]!;
    // Truck south of the third row house (clear approach), facing south (+z): reverse into it.
    g.world.physics!.setPose(truck.body, [house.x + 1.3, 0.5, house.z + house.d / 2 + 14], [0, 1, 0, 0], true); // 180°: model extends toward -x
    g.board(truck, [house.x - 2.8, house.z + house.d / 2 + 11.5]);
    for (let i = 0; i < 4 && !g.collapsed('ROW HOUSE'); i++) {
      g.drive({ move: [0, -1] }, 3.5);
      g.drive({ move: [0, 1] }, 2.5);
    }
    expect(g.collapsed('ROW HOUSE')).toBeGreaterThanOrEqual(1);
  });

  it('HAMMERHEAD stomps bring the office tower down', async () => {
    const g = await boot();
    const mech = g.vehicle(18, 16);
    const tower = g.struct('OFFICE TOWER')[0]!;
    g.board(mech, [109, -40]);
    expect(g.snap().player.vehicle).toBe('mech');
    let action = 0;
    for (let i = 0; i < 8 && !g.collapsed('OFFICE TOWER'); i++) {
      // Hover above the tower, then stomp.
      g.world.physics!.setPose(mech.body, [tower.x - 0.9 + (i % 3) * 2, tower.h + 6, tower.z - 0.8 + ((i % 2) * 2 - 1) * 2], [0, 0, 0, 1], true);
      g.send({ t: 'input', input: g.input({ enter: g.enterCount(), actionCount: ++action }) });
      g.step(120);
    }
    expect(g.collapsed('OFFICE TOWER')).toBe(1);
  });
});
