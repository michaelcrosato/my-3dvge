/**
 * Mission: CINDER FLATS — farmland, a small town, a rail cut and an industrial strip. The carrier rolls
 * along +x at z = 0 from x = -165 to the Safe Zone at x = +165 (≈ 3 minutes).
 */
import type { LevelBuilder, LevelDef } from '../game.ts';
import { VS } from '../util.ts';

const C = {
  grass: 0x6f9a3c,
  grassDark: 0x5f8a34,
  field: 0x8a6d3e,
  crops: 0x7a9a36,
  dirt: 0x9a7b50,
  asphalt: 0x4a4c50,
  lane: 0x5a5c60,
  laneEdge: 0xe8c23a,
  concrete: 0xb5b0a4,
  gravel: 0x8e8a80,
  water: 0x3f7fa8,
  sand: 0xc9b27a,
};

export const cinderFlats: LevelDef = {
  id: 'cinder',
  title: 'CINDER FLATS',
  subtitle: 'Mission 1 · Farmland, town and rail yard',
  briefing: [
    'A Hazard Carrier hauling two unstable fusion cores has lost its autopilot override.',
    'It will roll dead straight through Cinder Flats and detonate on contact with ANYTHING.',
    'Flatten every building in its lane, bridge the rail cut and the drainage pits, and do not touch the carrier.',
  ],
  tips: [
    'PLOWHORSE rams at speed but cannot dent stone.',
    'TNT fuses light when a crate is disturbed — push it into what you want gone.',
    'TAILWHIP only hurts with its tail: hold ACTION to slide it into walls.',
    'Follow the RDU lights — they lead to secrets.',
  ],
  bounds: { x0: -180, z0: -90, x1: 180, z1: 90 },
  lane: { x0: -165, x1: 165, z: 0, width: 3.2, speed: 1.85 },
  medalTimes: null,
  timeAttackTimes: { bronze: 150, silver: 120, gold: 100, platinum: 60 },
  radio: {
    start: "CHIEF: Carrier's rolling! Hop in PLOWHORSE and clear that lane, rookie!",
    'enter:dozer': "SPARKS: PLOWHORSE — ram 'em at full speed, blade first!",
    'enter:truck': 'SPARKS: TAILWHIP only hurts with its tail. Hold ACTION while turning to swing it in!',
    'enter:buggy': 'SPARKS: SKYLARK wrecks whatever it lands on. Hit a ramp, hit the turbo!',
    'enter:bike': "SPARKS: LONGBOW's missiles crack stone. Ammo refills — crates help.",
    'enter:mech': 'SPARKS: HAMMERHEAD! Hold JUMP to fly, ACTION to stomp. Crush that tower!',
    'enter:train': "SPARKS: Roll the flatbed under the lane — I'll tell you when it's lined up.",
    'warn:BARN': "CHIEF: The barn's dead ahead of the carrier. Flatten it!",
    'warn:FARMHOUSE': 'CHIEF: Farmhouse next. Keep that dozer moving!',
    'warn:GAS PUMPS': "SPARKS: Ram those gas pumps — and don't park next to them!",
    'warn:CORNER SHOP': 'CHIEF: The corner shop is in the way too!',
    'gap:rail': "CHIEF: The lane crosses the rail cut! Get the FREIGHT HOPPER's flatbed under it!",
    'warn:STONE DEPOT': "SPARKS: That depot is solid stone — the dozer won't dent it. Push the TNT in, or try LONGBOW's missiles!",
    'gap:pit': 'CHIEF: Drainage pits! Shove those concrete blocks in before the carrier drops in!',
    'warn:ROW HOUSE': "SPARKS: Row houses. TAILWHIP's parked just north — swing that tail!",
    'warn:OFFICE TOWER': "CHIEF: That tower's too big for wheels. HAMMERHEAD's by the water tower — follow the lights!",
    fuse: 'SPARKS: Fuse is lit! Get it where it hurts!',
    gapFilled: "SPARKS: That'll hold. Nice work!",
    survivor: 'CHIEF: Survivor spotted! Swing by and pick them up.',
    dish: "SPARKS: A comms dish! There's another one out there somewhere.",
    allDishes: 'SPARKS: Both dishes online — bonus stage unlocked!',
    pathClear: 'CHIEF: Path is CLEAR! Grab the extras, then board the COMMAND RIG — or fast-forward the carrier.',
    carrierSafe: "CHIEF: Carrier's safe! Drinks are on me.",
    'collapse:BARN': "CHIEF: Barn's down! Next!",
  },
  build(b: LevelBuilder) {
    const g = b.ground;
    // ---- ground paint
    g.fill(C.grass, 0.06);
    g.stripes(-170, -80, -120, -30, C.field, C.crops, 1.5, 'x');
    g.stripes(-160, 30, -110, 80, C.crops, C.field, 1.5, 'z');
    g.stripes(100, 40, 170, 85, C.field, C.crops, 2, 'x');
    g.blob(-135, 45, 12, 8, C.water, 0.03);
    g.blob(-60, -45, 16, 10, C.grassDark);
    g.rect(-180, -3, 180, 3, C.lane, 0.05);
    g.rect(-180, -3.2, 180, -2.8, C.laneEdge, 0.03);
    g.rect(-180, 2.8, 180, 3.2, C.laneEdge, 0.03);
    g.rect(-80, 8, -30, 30, C.concrete, 0.03);
    g.rect(-80, -32, -30, -8, C.concrete, 0.03);
    g.rect(-72, -3, -40, 3, C.asphalt, 0.03);
    g.rect(-26, -90, -14, 90, C.gravel, 0.08);
    g.rect(-10, -40, 30, 40, C.gravel, 0.06);
    g.rect(40, -40, 170, -12, C.asphalt, 0.04);
    g.rect(40, 12, 110, 40, C.grassDark, 0.05);
    g.rect(-178, -8, -158, 8, C.concrete, 0.02);
    g.rect(158, -8, 178, 8, C.concrete, 0.02);
    // Rail cut and drainage pits (holes in the ground).
    g.hole(-22, -86, -18, 86, -1.2);
    for (const x of [38.2, 45.2, 52.2]) g.hole(x, -2, x + 3.6, 2, -1.2);

    // ---- start and end
    b.prop('safePad', -168, 0, { w: 160, d: 120 });
    b.prop('safePad', 168, 0, { w: 160, d: 120 });
    b.spawn(-152, 7, -Math.PI / 2);
    b.vehicle('dozer', -148.5, 6.5, -Math.PI / 2);
    b.vehicle('semi', 160, 12, Math.PI / 2);

    // ---- farm: crushable fences and hay, barn, farmhouse
    for (const x of [-140, -136]) b.prop('fence', x, 0, { length: 80, yaw: Math.PI / 2, crushable: true });
    for (const z of [-1.2, 0.2, 1.4]) b.prop('hay', -131, z, { crushable: true });
    b.prop('hay', -129, 0.8, { crushable: true });
    b.building('barn', -104, 0.4, { w: 110, d: 96, name: 'BARN', value: 185_000 });
    b.building('farmhouse', -87, -0.6, { w: 84, d: 72, name: 'FARMHOUSE', value: 240_000 });
    b.building('silo', -104, -16, { name: 'GRAIN SILO', value: 90_000 });
    b.building('silo', -97, -17, { name: 'GRAIN SILO', value: 90_000, variant: 1 });
    b.building('shed', -121, 16, { name: 'TOOL SHED', value: 35_000, survivor: true });
    b.building('shed', -128, -15, { name: 'CHICKEN COOP', value: 20_000, variant: 1 });
    b.building('farmhouse', -80, 24, { name: 'OLD FARMHOUSE', value: 210_000, variant: 1, survivor: true });
    b.building('barn', -150, -32, { name: 'HAY BARN', value: 160_000, variant: 1 });
    b.dish(-113, -24);

    // ---- town: gas station, pumps in the lane, corner shop, houses, church
    b.building('gasStation', -60, -13, { name: 'GAS STATION', value: 320_000 });
    b.building('pump', -62.5, -0.2, { name: 'GAS PUMPS', value: 60_000 });
    b.building('pump', -57.5, 0.4, { name: 'GAS PUMPS', value: 60_000, variant: 1 });
    b.building('shop', -46.5, 0.2, { w: 78, d: 64, name: 'CORNER SHOP', value: 280_000 });
    b.building('house', -70, 17, { name: 'HOUSE', value: 150_000, survivor: true });
    b.building('house', -58, 19, { name: 'HOUSE', value: 150_000, variant: 1 });
    b.building('house', -46, 18, { name: 'HOUSE', value: 150_000, variant: 2, survivor: true });
    b.building('garage', -74, -17, { name: 'GARAGE', value: 60_000 });
    b.building('church', -38, -30, { name: 'CHURCH', value: 420_000, survivor: true });
    for (const x of [-78, -34]) b.prop('lamp', x, 4.5);
    for (const [x, z] of [[-84, 10], [-66, 30], [-40, 30], [-88, -26]] as const) b.prop('tree', x, z);
    b.prop('bush', -76, 1.2, { crushable: true });
    b.prop('sign', -82, 3.8);

    // ---- rail cut: FREIGHT HOPPER on rails in the cut; bridges far north/south
    for (let z = -80; z < 80; z += 10) b.prop('track', -20, z + 5, { length: 100, y: -1.2, solid: false });
    b.vehicle('train', -20, 0, 0, { track: { x: -20, y: -1.2, z0: -70, z1: 70 }, s: 20 });
    b.gap('rail', -22, -18, -1.8, 1.8, () => b.game.vehicles.some((v) => v.kind === 'train' && Math.abs((v as unknown as { deckCenterZ(): number }).deckCenterZ()) <= 0.8));
    b.prop('ramp', -20, -78, { w: 60, h: 2, d: 60, y: -0.2 });
    b.prop('ramp', -20, 78, { w: 60, h: 2, d: 60, y: -0.2 });
    b.building('shed', -8, 20, { name: 'SIGNAL BOX', value: 45_000 });

    // ---- stone depot + TNT; LONGBOW parked nearby
    b.building('depot', 9.5, 0, { w: 90, d: 72, name: 'STONE DEPOT', value: 520_000 });
    for (const [x, z] of [[-1.5, -8.5], [-0.5, -9.8], [-1.0, -8.9]] as const) b.tnt(x, z);
    b.tnt(-0.5, 9.2);
    b.tnt(0.6, 10.1);
    b.vehicle('bike', 4, 17, -Math.PI / 2);
    b.ammo(2, 22);
    b.building('warehouse', 24, -26, { name: 'WAREHOUSE', value: 380_000, survivor: true });

    // ---- drainage pits and concrete blocks
    for (const x of [40, 47, 54]) {
      b.block(x, 9);
      b.gap('pit', x - 1.8, x + 1.8, -2, 2);
    }

    // ---- terraces with mounds; TAILWHIP and SKYLARK
    for (let i = 0; i < 4; i++) b.building('terrace', 74 + i * 6.2, 0, { w: 60, d: 80, name: 'ROW HOUSE', value: 190_000, variant: i });
    b.prop('mound', 68, 13, { w: 60, h: 14, d: 70 });
    b.prop('mound', 90, -13, { w: 60, h: 14, d: 70 });
    b.prop('ramp', 80, 16, { w: 40, h: 16, d: 60 });
    b.vehicle('truck', 62, 18, -Math.PI / 2);
    b.vehicle('buggy', 70, 26, 0);
    b.ammo(66, -24);
    b.building('garage', 66, 28, { name: 'AUTO SHOP', value: 110_000, survivor: true, variant: 1 });
    b.building('warehouse', 60, -30, { name: 'COLD STORE', value: 330_000, variant: 1, survivor: true });

    // ---- office tower; HAMMERHEAD by the water tower
    b.building('office', 129.5, 0, { w: 110, d: 110, floors: 8, name: 'OFFICE TOWER', value: 2_400_000 });
    b.building('waterTower', 108, -50, { name: 'WATER TOWER', value: 140_000 });
    b.building('mechShed', 116, -40, { name: 'MECH SHED', value: 70_000 });
    b.vehicle('mech', 109, -38, 0);
    b.building('house', 100, 26, { name: 'HOUSE', value: 150_000 });
    b.building('house', 112, 24, { name: 'HOUSE', value: 150_000, variant: 1 });
    b.building('shed', 140, -18, { name: 'STORE SHED', value: 30_000 });
    b.building('house', 150, 24, { name: 'HOUSE', value: 150_000, variant: 2 });
    const wh = b.building('warehouse', 150, -34, { name: 'DEPOT HALL', value: 450_000 });
    const whH = (b.world.volumes.get(wh)?.volume.sizeY ?? 60) * VS;
    b.dish(150, -34, whH);
    b.ammo(118, 18);
    for (const [x, z] of [[96, -20], [136, 30], [120, 40], [40, 30], [10, -45], [-120, 60]] as const) b.prop('tree', x, z);
    for (const [x, z] of [[30, 18], [140, 8], [-30, -12]] as const) b.prop('wreck', x, z);
    for (const [x, z] of [[-150, 60], [150, 60], [0, -70]] as const) b.prop('rock', x, z);

    // ---- RDUs: lane edges (78) + trails to secrets (22) = 100
    for (let x = -150; x <= 158; x += 8) {
      b.rdu(x, -3.9);
      b.rdu(x + 4, 3.9);
    }
    for (let i = 0; i < 8; i++) b.rdu(104 + i * 0.6, -7 - i * 4); // to the mech
    for (let i = 0; i < 5; i++) b.rdu(-118 + i * 1.2, -7 - i * 3.5); // to dish 1
    for (let i = 0; i < 5; i++) b.rdu(152, -7 - i * 4); // to the depot hall
    for (let i = 0; i < 4; i++) b.rdu(-40 + i * 2, -14 - i * 4); // to the church
  },
};
