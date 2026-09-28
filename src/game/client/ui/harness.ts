/**
 * Dev harness (?harness=ui): drives the UI with fake level data and an animated fake snapshot.
 * URL options for screenshots: screen=title|briefing|ta|bonus|pause|results|failed|hud|flyover|imminent,
 * t=<seconds into the fake mission>, touch=1 (fake touch buttons), clean=1 (hide dev buttons).
 */
import type {
  CameraMode, GameEvent, GameSnapshot, LevelStatic, MissionResults, SaveData, StructureInfo, VehicleKind,
} from '../../shared/types.ts';
import { createGameUI, type Projector } from './index.ts';

type Rgb = [number, number, number];

function makeMap(w: number, h: number, bounds: LevelStatic['bounds']): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  const toX = (i: number) => bounds.x0 + ((i + 0.5) / w) * (bounds.x1 - bounds.x0);
  const toZ = (j: number) => bounds.z0 + ((j + 0.5) / h) * (bounds.z1 - bounds.z0);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = toX(i), z = toZ(j);
      let c: Rgb = (Math.floor(x / 14) + Math.floor(z / 14)) % 2 ? [104, 142, 64] : [96, 132, 58];
      if (x < -40 && Math.abs(z) > 12 && Math.floor(z / 3) % 2 === 0) c = [150, 120, 70]; // crop rows
      if (x > 100) c = [140, 138, 128]; // industrial concrete
      if (Math.abs(z) < 3) c = [62, 64, 68]; // carrier road
      if (Math.abs(z - 30) < 2.5 || Math.abs(x - 60) < 2.5) c = [70, 72, 76]; // streets
      if (x > -24 && x < -16) c = [72, 58, 44]; // rail cut
      if (x > 30 && x < 34 && z > -60 && z < 60) c = [60, 110, 160]; // drainage canal
      const o = (j * w + i) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  return data;
}

function fakeLevel(): LevelStatic {
  const bounds = { x0: -180, z0: -90, x1: 180, z1: 90 };
  let id = 1;
  const s = (name: string, x: number, z: number, w: number, d: number, h: number, value: number, survivor = false): StructureInfo => ({
    id: id++, name, x, z, w, d, h, value, inLane: Math.abs(z) < d / 2 + 1.6, survivor,
  });
  const structures = [
    s('Red Barn', -110, 0, 10, 8, 7, 45000),
    s('Farmhouse', -88, 1, 8, 8, 6, 60000, true),
    s('Gas Station', -60, 0, 12, 9, 5, 120000),
    s('Stone Depot', 10, 0, 12, 10, 6, 150000),
    s('Terrace A', 75, 0, 7, 9, 7, 55000),
    s('Terrace B', 85, 0, 7, 9, 7, 55000),
    s('Terrace C', 95, 0, 7, 9, 7, 55000, true),
    s('Office Tower', 130, 0, 12, 12, 24, 900000),
    s('Grain Silo', -120, 24, 5, 5, 12, 30000),
    s('Tool Shed', -70, -26, 5, 4, 3, 8000),
    s('Chapel', -30, 34, 10, 16, 11, 210000, true),
    s('Garage', 20, 30, 8, 6, 4, 25000),
    s('Warehouse', 115, -36, 22, 14, 9, 340000),
    s('Water Tower', 110, 36, 6, 6, 16, 70000),
  ];
  return {
    level: 'cinder',
    title: 'CINDER FLATS',
    subtitle: 'Hazard Carrier HC-7 · rural route 9',
    briefing: [
      'Pathbreakers, we have a runaway.',
      'Hazard Carrier HC-7 is hauling two unstable fusion cores through Cinder Flats on autopilot. It will not stop and it will not steer.',
      'If it touches anything — a barn, a pump, a single brick — it goes up and takes the county with it.',
      'Flatten everything in its lane. Bridge the rail cut. And whatever you do, don’t touch the carrier.',
    ],
    tips: [
      'PLOWHORSE can’t crack the stone depot — shove a TNT crate into it instead.',
      'Ram the gas pumps and get clear: the whole station goes up.',
      'Follow the RDU trail east of the terraces to find HAMMERHEAD.',
    ],
    bounds,
    lane: { x0: -165, x1: 165, z: 0, width: 3.2, speed: 1.9 },
    structures,
    gaps: [
      { id: 1, kind: 'rail', x0: -22, x1: -18, z0: -2.2, z1: 2.2 },
      { id: 2, kind: 'pit', x0: 38, x1: 41.6, z0: -2, z1: 2 },
      { id: 3, kind: 'pit', x0: 45, x1: 48.6, z0: -2, z1: 2 },
      { id: 4, kind: 'pit', x0: 52, x1: 55.6, z0: -2, z1: 2 },
    ],
    totals: { buildings: 30, survivors: 8, rdus: 100, dishes: 2 },
    timeLimit: 0,
    medalTimes: null,
    timeAttackTimes: { bronze: 150, silver: 120, gold: 100, platinum: 60 },
    map: { width: 180, height: 90, data: makeMap(180, 90, bounds) },
  } as LevelStatic;
}

function bonusLevel(base: LevelStatic): LevelStatic {
  return {
    ...base,
    level: 'quarry',
    title: 'QUARRY RUMBLE',
    subtitle: 'Bonus stage · Ashgrove quarry',
    briefing: ['Twelve condemned structures. One clock.', 'Pick a machine and make the quarry flat.'],
    tips: ['TAILWHIP slides hit hardest on the packed dirt.'],
    lane: null,
    gaps: [],
    totals: { buildings: 12, survivors: 0, rdus: 0, dishes: 0 },
    timeLimit: 60,
    medalTimes: { bronze: 60, silver: 45, gold: 35, platinum: 25 },
    timeAttackTimes: null,
  } as LevelStatic;
}

const SAVE: SaveData = {
  best: { 'cinder:mission': { time: 186.4, medals: { carrier: 'gold', completion: 'silver' }, completion: 82 } },
  unlocked: { quarry: false, timeAttack: true },
  settings: { music: 0.7, sfx: 0.9, camera: 'overhead', invertY: false, assist: true },
};

const RESULTS: MissionResults = {
  level: 'cinder',
  mode: 'mission',
  time: 201.3,
  carrierSafe: true,
  buildings: [27, 30],
  survivors: [6, 8],
  rdus: [88, 100],
  dishes: [1, 2],
  damage: 1845000,
  medals: { carrier: 'gold', completion: 'silver' },
};

const RADIO: [GameEvent & { e: 'radio' }][] = [
  [{ e: 'radio', who: 'CHIEF', text: 'Carrier’s rolling! That barn is first — get PLOWHORSE on it.' }],
  [{ e: 'radio', who: 'SPARKS', text: 'Heads up, the depot walls are stone. Dozer blade won’t bite. Try the TNT.' }],
  [{ e: 'radio', who: 'PILOT', text: 'Chopper’s standing by for survivors. Wave ’em down, I’ll scoop ’em.' }],
  [{ e: 'radio', who: 'CHIEF', text: 'Nice work, rookie. Keep that lane clean!' }],
];

export function runHarness(root: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  document.getElementById('loading')?.remove();
  const canvas = document.getElementById('view');
  if (canvas) canvas.style.display = 'none';
  document.body.style.background = 'radial-gradient(ellipse at 40% 30%, #1d5b55, #0a2422 60%, #06120f)';
  root.replaceChildren();

  let level = fakeLevel();
  let save: SaveData = structuredClone(SAVE);
  let camMode: CameraMode = 'overhead';
  let yaw = 0.35;
  let t = Number(q.get('t') ?? 12);
  let paused = false;
  let forceImminent = false;
  let mode: 'mission' | 'timeAttack' = 'mission';
  const destroyed = new Set<number>();
  let damage = 0;
  let rdus = 23;
  let survivors = 2;
  let lastEventSecond = Math.floor(t);

  const ui = createGameUI();
  const log = (...a: unknown[]) => console.info('[ui-harness]', ...a);
  ui.mount(root, {
    startLevel: (lv, m) => {
      log('startLevel', lv, m);
      mode = m;
      level = lv === 'quarry' ? bonusLevel(fakeLevel()) : fakeLevel();
      ui.setLevel(level);
      ui.showBriefing(level, m, save);
    },
    beginMission: () => {
      log('beginMission');
      ui.hideScreens();
      t = 0;
      destroyed.clear();
      damage = 0;
      paused = false;
    },
    skipFlyover: () => {
      log('skipFlyover');
      t = Math.max(t, 4);
    },
    pause: () => {
      paused = true;
      ui.showPause();
    },
    resume: () => {
      log('resume');
      paused = false;
      ui.hideScreens();
    },
    restart: () => {
      log('restart');
      ui.hideScreens();
      t = 0;
      destroyed.clear();
      damage = 0;
      paused = false;
    },
    quitToTitle: () => {
      log('quitToTitle');
      ui.showTitle(save);
    },
    finishMission: () => ui.showResults(RESULTS, save),
    setCamera: (m) => {
      log('setCamera', m);
      camMode = m;
    },
    fastForward: (on) => log('fastForward', on),
    setSetting: (k, v) => {
      log('setSetting', k, v);
      save = { ...save, settings: { ...save.settings, [k]: v } };
    },
    toggleDebugHud: () => log('toggleDebugHud'),
    copyDiagnostics: async () => {
      log('copyDiagnostics');
      return true;
    },
    save: () => save,
    sound: (s) => log('sound', s),
  });
  ui.setLevel(level);

  if (q.get('touch') === '1') {
    const bar = document.createElement('div');
    bar.className = 'touch-buttons';
    for (const [label, cls] of [['ACTION', 'pb-action'], ['JUMP', 'pb-jump'], ['ENTER', 'pb-enter'], ['CAM', 'pb-cam'], ['RESET', 'pb-reset'], ['❚❚', 'pb-pause'], ['CARRIER', 'pb-carrier']]) {
      const b = document.createElement('button');
      b.className = `touch-btn ${cls}`;
      b.textContent = label!;
      bar.append(b);
    }
    root.append(bar);
  }

  // Dev buttons.
  if (q.get('clean') !== '1') {
    const dev = document.createElement('div');
    dev.style.cssText = 'position:fixed;left:50%;bottom:4px;transform:translateX(-50%);display:flex;gap:4px;flex-wrap:wrap;justify-content:center;z-index:200;pointer-events:auto;max-width:96vw';
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:11px system-ui;padding:3px 6px;min-height:0;background:#000a;color:#fff;border:1px solid #fff5;border-radius:4px';
      b.onclick = fn;
      dev.append(b);
    };
    btn('HUD', () => ui.hideScreens());
    btn('Title', () => ui.showTitle(save));
    btn('Brief', () => ui.showBriefing(level, 'mission', save));
    btn('TA brief', () => ui.showBriefing(level, 'timeAttack', save));
    btn('Bonus brief', () => ui.showBriefing(bonusLevel(fakeLevel()), 'mission', save));
    btn('Pause', () => ui.showPause());
    btn('Results', () => ui.showResults(RESULTS, save));
    btn('Failed', () => ui.showFailed('The carrier hit the Red Barn.'));
    btn('Flyover', () => (t = 1));
    btn('Imminent', () => (forceImminent = !forceImminent));
    btn('Unlock all', () => (save = { ...save, unlocked: { quarry: true, timeAttack: true } }));
    btn('Cam', () => (camMode = camMode === 'overhead' ? 'tactical' : 'overhead'));
    document.body.append(dev);
  }

  // World → screen for a fake chase camera following the player.
  let player = { x: -100, y: 1, z: 8, heading: 0 };
  const project: Projector = (x, y, z) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const back = camMode === 'tactical' ? 2 : 16, up = camMode === 'tactical' ? 60 : 12;
    const cx = player.x + Math.sin(yaw) * back, cy = player.y + up, cz = player.z + Math.cos(yaw) * back;
    let fx = player.x - cx, fy = player.y + 2 - cy, fz = player.z - cz;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // right = f × up(0,1,0)
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    // u = r × f
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const depth = dx * fx + dy * fy + dz * fz;
    const focal = vh / 2 / Math.tan((60 * Math.PI) / 360);
    const sx = dx * rx + dz * rz;
    const sy = dx * ux + dy * uy + dz * uz;
    const d = Math.abs(depth) < 0.05 ? 0.05 : depth;
    return { x: vw / 2 + (sx / d) * focal, y: vh / 2 - (sy / d) * focal, visible: depth > 0.1 };
  };

  const speed = 1.9 * 3; // harness runs the carrier 3× faster
  const inLane = level.structures.filter((s) => s.inLane);

  const snapshot = (): GameSnapshot => {
    const running = t >= 7;
    const state: GameSnapshot['state'] = t < 4 ? 'flyover' : t < 7 ? 'countdown' : destroyed.size >= inLane.length ? 'clear' : 'running';
    const carX = level.lane ? Math.min(level.lane.x1, level.lane.x0 + Math.max(0, t - 7) * speed) : 0;
    const blockers = inLane
      .filter((s) => !destroyed.has(s.id) && s.x > carX)
      .map((s) => {
        const eta = Math.max(0, (s.x - s.w / 2 - (carX + 3.8)) / speed);
        const lvl = forceImminent ? 4 : eta > 40 ? 0 : eta > 25 ? 1 : eta > 15 ? 2 : eta > 8 ? 3 : 4;
        return { id: s.id, eta, level: lvl };
      });
    const next = blockers.slice().sort((a, b) => a.eta - b.eta)[0];
    const railFilled = t > 30;
    const nextObstacle = !railFilled && carX < -22 ? -1 : (next?.id ?? null);
    const target = level.structures.find((s) => s.id === next?.id) ?? level.structures[0]!;
    player = { x: target.x - 14 + Math.cos(t * 0.4) * 8, y: 1, z: target.z + 10 + Math.sin(t * 0.4) * 8, heading: -t * 0.4 };
    const vehicle: VehicleKind | null = t % 40 < 25 ? 'dozer' : null;
    return {
      state,
      mode,
      time: Math.max(0, t - 7),
      countdown: t < 4 ? 4 - t : t < 7 ? 7 - t : 0,
      carrier: level.lane ? { x: carX, z: 0, y: 0, slot: 5, progress: (carX - level.lane.x0) / (level.lane.x1 - level.lane.x0), fastForward: false, eta: next?.eta ?? null, next: nextObstacle } : null,
      player: {
        x: player.x, y: player.y, z: player.z, heading: player.heading, onFoot: !vehicle, vehicle, vehicleId: vehicle ? 3 : null, slot: vehicle ? 7 : 0,
        speed: vehicle ? 6 + Math.sin(t) * 2 : 3, meter: vehicle ? { label: 'Push', value: (Math.sin(t * 0.7) + 1) / 2 } : null,
        activity: vehicle && Math.sin(t * 0.5) > 0.8 ? 'Ramming' : null,
      },
      prompt: !vehicle && t % 40 > 30 ? 'E  Enter PLOWHORSE' : null,
      counts: { buildings: [destroyed.size + 3, 30], survivors: [survivors, 8], rdus: [rdus, 100], dishes: [1, 2], damage },
      blockers: running || state === 'flyover' || state === 'countdown' ? blockers : blockers,
      gaps: level.gaps.map((g) => ({ id: g.id, filled: g.kind === 'rail' ? railFilled : g.id <= 2 })),
      vehicles: [
        { id: 3, kind: 'dozer', x: player.x + 3, z: player.z + 2, heading: 0, occupied: !!vehicle },
        { id: 4, kind: 'truck', x: 60, z: 18, heading: 1, occupied: false },
        { id: 5, kind: 'buggy', x: 65, z: -20, heading: 2, occupied: false },
        { id: 6, kind: 'train', x: -20, z: railFilled ? 0 : -40, heading: 0, occupied: false },
      ],
      survivors: [{ x: player.x - 12, z: player.z - 6 }],
      rdus: Array.from({ length: 10 }, (_, i) => ({ x: player.x - 30 + i * 6, z: player.z + 18 })),
      destroyed: [...destroyed],
      aligned: t > 26 && t < 31,
      targetsLeft: 7,
    } as GameSnapshot;
  };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !ui.blocking) t += dt;
    yaw += dt * 0.05;
    const snap = snapshot();
    // Fake gameplay events.
    const sec = Math.floor(t);
    if (sec !== lastEventSecond && !ui.blocking) {
      lastEventSecond = sec;
      const ev: GameEvent[] = [];
      if (snap.state === 'countdown') ev.push({ e: 'countdown', n: Math.ceil(snap.countdown) });
      if (sec === 7) ev.push({ e: 'go' });
      for (const b of snap.blockers) {
        if (b.eta < 6 && !destroyed.has(b.id)) {
          const s = level.structures.find((x) => x.id === b.id)!;
          destroyed.add(b.id);
          damage += s.value;
          ev.push({ e: 'collapse', id: s.id, name: s.name, x: s.x, y: s.h, z: s.z, value: s.value, inLane: true });
          ev.push({ e: 'explosion', x: s.x, y: 2, z: s.z, radius: 4 });
          if (destroyed.size === inLane.length) ev.push({ e: 'pathClear' });
        }
      }
      if (sec % 9 === 3) ev.push(RADIO[(sec / 9) % RADIO.length | 0]![0]);
      if (sec % 3 === 0) {
        rdus = Math.min(100, rdus + 1);
        ev.push({ e: 'rdu', n: rdus, total: 100, x: player.x, y: 1, z: player.z } as GameEvent);
      }
      if (sec % 15 === 5) ev.push({ e: 'fuse', x: player.x + 4, y: 0.5, z: player.z - 2, seconds: 8 });
      if (sec % 17 === 11) {
        survivors = Math.min(8, survivors + 1);
        ev.push({ e: 'survivorRescued', n: survivors, total: 8 });
      }
      if (sec % 21 === 13) ev.push({ e: 'dish', n: 1, total: 2 });
      if (ev.length) ui.onEvents(ev);
    }
    ui.update(snap, dt, project, { mode: camMode, yaw });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const screen = q.get('screen') ?? 'title';
  if (screen === 'title') ui.showTitle(save);
  else if (screen === 'briefing') ui.showBriefing(level, 'mission', save);
  else if (screen === 'ta') ui.showBriefing(level, 'timeAttack', save);
  else if (screen === 'bonus') {
    level = bonusLevel(fakeLevel());
    ui.setLevel(level);
    ui.showBriefing(level, 'mission', save);
  } else if (screen === 'pause') ui.showPause();
  else if (screen === 'results') ui.showResults(RESULTS, save);
  else if (screen === 'failed') ui.showFailed('The carrier hit the Red Barn.');
  else if (screen === 'flyover') t = Number(q.get('t') ?? 1.5);
  else if (screen === 'imminent') forceImminent = true;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !ui.blocking) {
      paused = true;
      ui.showPause();
    }
  });
}
