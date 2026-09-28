import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { gameScene } from '../../src/game/sim/scene.ts';
import type { GameEvent, GameInput, GameSnapshot, LevelStatic, SimMessage } from '../../src/game/shared/types.ts';
import { RapierBackend } from '../../src/sim/physics/rapier-backend.ts';
import { SimWorld } from '../../src/sim/world.ts';

async function boot(level: 'cinder' | 'quarry') {
  const msgs: SimMessage[] = [];
  const world = new SimWorld({ ...DEFAULT_PARAMS, scene: level }, null, { volumeAdded: () => undefined, volumeRemoved: () => undefined, game: (d) => msgs.push(d as SimMessage) }, await RapierBackend.create());
  const scene = gameScene(level);
  const ctx = world.sceneContext();
  await scene.build(ctx);
  world.scenePreStep = (dt) => scene.preStep!(ctx, dt);
  world.sceneUpdate = (dt) => scene.update!(ctx, dt);
  world.syncColliders();
  world.spawnPlayer();
  const send = (m: unknown) => scene.onMessage!(ctx, m);
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) world.step(1 / 60);
  };
  const snap = () => [...msgs].reverse().find((m) => m.k === 'snap')?.data as GameSnapshot;
  const events = () => msgs.flatMap((m) => (m.k === 'events' ? m.list : [])) as GameEvent[];
  const input = (p: Partial<GameInput>): GameInput => ({ move: [0, 0], camYaw: 0, relative: false, lookYaw: 0, lookPitch: 0, jump: false, action: false, sprint: false, actionCount: 0, jumpCount: 0, enter: 0, reset: 0, ...p });
  return { world, msgs, send, run, snap, events, input };
}

describe('PATHBREAKERS rules', () => {
  it('builds Cinder Flats with lane structures, gaps, 100 RDUs and sends the level', async () => {
    const g = await boot('cinder');
    const stat = g.msgs.find((m) => m.k === 'static')!.data as LevelStatic;
    expect(stat.structures.filter((s) => s.inLane).map((s) => s.name)).toEqual(expect.arrayContaining(['BARN', 'FARMHOUSE', 'GAS PUMPS', 'CORNER SHOP', 'STONE DEPOT', 'ROW HOUSE', 'OFFICE TOWER']));
    expect(stat.structures.filter((s) => !s.inLane).length).toBeGreaterThan(15);
    expect(stat.gaps.map((x) => x.kind)).toEqual(['rail', 'pit', 'pit']);
    expect(stat.totals.rdus).toBe(100);
    expect(stat.totals.dishes).toBe(2);
    expect(stat.totals.survivors).toBe(8);
  });

  it('runs the mission flow; the untouched carrier explodes on the barn', async () => {
    const g = await boot('cinder');
    g.run(0.2);
    expect(g.snap().state).toBe('briefing');
    g.send({ t: 'start', mode: 'mission' });
    g.run(0.2);
    expect(g.snap().state).toBe('flyover');
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    expect(g.snap().state).toBe('running');
    const x0 = g.snap().carrier!.x;
    g.run(2);
    expect(g.snap().carrier!.x).toBeGreaterThan(x0 + 3);
    expect(g.snap().blockers[0]!.eta).toBeGreaterThan(0);
    g.run(40);
    expect(g.snap().state).toBe('failed');
    const fail = g.events().find((e) => e.e === 'fail');
    expect(fail && 'reason' in fail ? fail.reason : '').toMatch(/barn/i);
  });

  it('the player can board PLOWHORSE and ram the barn down', async () => {
    const g = await boot('cinder');
    g.send({ t: 'start', mode: 'timeAttack' });
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    g.send({ t: 'input', input: g.input({ enter: 1 }) });
    g.run(0.1);
    expect(g.snap().player.vehicle).toBe('dozer');
    // Drive east toward the barn (camera-relative: yaw 0 → "right" is +x), angling onto its center line.
    g.send({ t: 'input', input: g.input({ enter: 1, relative: true, move: [1, 0.12] }) });
    g.run(14);
    const hits = g.events().filter((e) => e.e === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    const barnDown = g.events().some((e) => e.e === 'collapse' && e.name === 'BARN');
    const damaged = g.world.structures.standing().find((s) => s.def && g.world.volumes.get(s.volumeId) && s.damage > 0);
    expect(barnDown || damaged).toBeTruthy();
  });

  it('clearing the lane reaches PATH CLEAR and the carrier gets home safe', async () => {
    const g = await boot('cinder');
    g.send({ t: 'start', mode: 'mission' });
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    g.send({ t: 'debug', cmd: 'clearLane' });
    g.run(0.5);
    expect(g.snap().state).toBe('clear');
    g.send({ t: 'fastForward', on: true });
    g.run(40);
    const results = g.events().find((e) => e.e === 'results');
    expect(results).toBeTruthy();
    expect(g.snap().state).toBe('complete');
    if (results && results.e === 'results') {
      expect(results.results.medals.carrier).toBe('gold');
      expect(results.results.buildings[0]).toBeGreaterThanOrEqual(10);
      expect(results.results.damage).toBeGreaterThan(0);
    }
  }, 60_000);

  it('Quarry Rumble completes when all 12 targets fall', async () => {
    const g = await boot('quarry');
    const stat = g.msgs.find((m) => m.k === 'static')!.data as LevelStatic;
    expect(stat.structures.length).toBe(12);
    g.send({ t: 'start', mode: 'mission' });
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    for (const s of g.world.structures.standing()) g.world.structures.collapse(s);
    g.run(0.2);
    const results = g.events().find((e) => e.e === 'results');
    expect(results && results.e === 'results' ? results.results.medals.time : undefined).toBe('platinum');
  });

  it('PLOWHORSE can shove a concrete block into a drainage pit (gap filled)', async () => {
    const g = await boot('cinder');
    g.send({ t: 'start', mode: 'mission' });
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    const w = g.world;
    const dozer = [...w.volumes.values()].find((v) => v.tag === 'vehicle' && v.volume.sizeX === 30 && v.volume.sizeZ === 46)!;
    // Park the dozer south of the first block (x 42, z 9), facing north (-z), and board it.
    w.physics!.setPose(dozer.body, [42 - 1.5, 0.4, 12.2], [0, 0, 0, 1], true);
    w.player!.teleport([39, 0, 15]);
    g.run(0.3);
    g.send({ t: 'input', input: g.input({ enter: 1 }) });
    g.run(0.2);
    expect(g.snap().player.vehicle).toBe('dozer');
    g.send({ t: 'input', input: g.input({ enter: 1, move: [0, 0.7] }) });
    for (let i = 0; i < 20 * 60 && !g.snap().gaps.find((x) => x.id === 2)!.filled; i++) w.step(1 / 60);
    expect(g.snap().gaps.find((x) => x.id === 2)!.filled).toBe(true);
    expect(g.events().some((e) => e.e === 'gapFilled')).toBe(true);
  });

  it('a disturbed TNT crate lights its fuse and detonates', async () => {
    const g = await boot('cinder');
    g.send({ t: 'start', mode: 'mission' });
    g.send({ t: 'skipFlyover' });
    g.run(3.2);
    const w = g.world;
    const tnt = [...w.volumes.values()].find((v) => v.explosive && v.kind === 'dynamic')!;
    w.physics!.applyImpulse(tnt.body, [0, 0, 400]);
    g.run(1);
    expect(g.events().some((e) => e.e === 'fuse')).toBe(true);
    g.run(8.5);
    expect(g.events().filter((e) => e.e === 'explosion').length).toBeGreaterThan(0);
    expect(w.volumes.has(tnt.id)).toBe(false);
  });
});
