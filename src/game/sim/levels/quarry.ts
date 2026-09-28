/** Bonus stage: QUARRY RUMBLE — wreck 12 targets against the clock with TAILWHIP or HAMMERHEAD. */
import type { LevelBuilder, LevelDef } from '../game.ts';

export const quarryRumble: LevelDef = {
  id: 'quarry',
  title: 'QUARRY RUMBLE',
  subtitle: 'Bonus stage · Destruction trial',
  briefing: ['No carrier, no mercy: flatten all 12 targets in the old quarry as fast as you can.', 'TAILWHIP and HAMMERHEAD are fueled up. The clock starts at GO.'],
  tips: ['Use the dirt mounds to launch TAILWHIP into the high targets.', 'HAMMERHEAD stomps anything from above — fly between targets.'],
  bounds: { x0: -70, z0: -70, x1: 70, z1: 70 },
  lane: null,
  medalTimes: { bronze: 90, silver: 65, gold: 50, platinum: 35 },
  timeAttackTimes: null,
  radio: {
    start: 'CHIEF: Clock is running. Twelve targets — make it quick!',
    'enter:truck': 'SPARKS: Tail first, remember?',
    'enter:mech': 'SPARKS: Fly high, stomp hard.',
  },
  build(b: LevelBuilder) {
    const g = b.ground;
    g.fill(0xb49a6a, 0.08);
    g.blob(0, 0, 55, 55, 0xa88c5c, 0.1);
    g.blob(0, 0, 22, 22, 0x9b8058, 0.1);
    g.rect(-3, -70, 3, 70, 0x8e7a58, 0.05);
    g.rect(-70, -3, 70, 3, 0x8e7a58, 0.05);
    b.spawn(0, 50, 0);
    b.vehicle('truck', -4, 46, 0);
    b.vehicle('mech', 4, 46, 0);
    const ring = 12;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const r = i % 2 ? 38 : 24;
      b.building('target', Math.cos(a) * r, Math.sin(a) * r, { name: `TARGET ${i + 1}`, value: 50_000, target: true, variant: i, collapseAt: 0.25 });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      b.prop('mound', Math.cos(a) * 31, Math.sin(a) * 31, { w: 50, h: 14, d: 60, yaw: -a });
    }
    for (const [x, z] of [[-55, -50], [50, -55], [58, 40], [-60, 30]] as const) b.prop('rock', x, z);
  },
};
