import type { LevelId, MissionResults, ModeId, SaveData } from '../shared/types.ts';

const KEY = 'pathbreakers.save.v1';

export function defaultSave(): SaveData {
  return {
    best: {},
    unlocked: { quarry: false, timeAttack: false },
    settings: { music: 0.7, sfx: 0.9, camera: 'overhead', invertY: false, assist: true },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    const base = defaultSave();
    return { best: d.best ?? base.best, unlocked: { ...base.unlocked, ...d.unlocked }, settings: { ...base.settings, ...d.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / blocked storage: progress just isn't kept
  }
}

const RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4 } as const;

/** Merges a finished run into the save (best time, best medals, unlocks). Returns true for a new record. */
export function recordResults(s: SaveData, r: MissionResults): boolean {
  const key = `${r.level}:${r.mode}` as `${LevelId}:${ModeId}`;
  const prev = s.best[key];
  const completion = (r.buildings[0] / Math.max(1, r.buildings[1]) + r.rdus[0] / Math.max(1, r.rdus[1]) + r.survivors[0] / Math.max(1, r.survivors[1]) + r.dishes[0] / Math.max(1, r.dishes[1])) / 4;
  const better = <T extends keyof typeof RANK>(a: T | undefined, b: T | undefined) => (a && (!b || RANK[a] > RANK[b]) ? a : b);
  const newRecord = !prev || r.time < prev.time;
  s.best[key] = {
    time: prev ? Math.min(prev.time, r.time) : r.time,
    completion: Math.max(prev?.completion ?? 0, completion),
    medals: {
      carrier: better(r.medals.carrier, prev?.medals.carrier),
      completion: better(r.medals.completion, prev?.medals.completion),
      time: better(r.medals.time, prev?.medals.time),
    },
  };
  if (r.level === 'cinder' && r.mode === 'mission' && r.carrierSafe) {
    s.unlocked.timeAttack = true;
    s.unlocked.quarry = true;
  }
  if (r.dishes[1] > 0 && r.dishes[0] === r.dishes[1]) s.unlocked.quarry = true;
  writeSave(s);
  return newRecord;
}
