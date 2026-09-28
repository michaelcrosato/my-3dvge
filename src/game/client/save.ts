import type { LevelId, MissionResults, ModeId, SaveData } from '../shared/types.ts';
import { CAMERA_MODES } from '../shared/types.ts';
import { completionPercent } from './ui/format.ts';

const KEY = 'pathbreakers.save.v1';

export function defaultSave(): SaveData {
  return {
    best: {},
    unlocked: { quarry: false, timeAttack: false },
    settings: { music: 0.7, sfx: 0.9, camera: 'overhead', invertY: false, assist: true },
  };
}

export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = object(JSON.parse(raw));
    const settings = object(d.settings), unlocked = object(d.unlocked), best = object(d.best);
    for (const key of ['music', 'sfx'] as const) {
      const value = settings[key];
      if (typeof value === 'number' && Number.isFinite(value)) base.settings[key] = Math.max(0, Math.min(1, value));
    }
    if (CAMERA_MODES.includes(settings.camera as SaveData['settings']['camera'])) base.settings.camera = settings.camera as SaveData['settings']['camera'];
    for (const key of ['invertY', 'assist'] as const) if (typeof settings[key] === 'boolean') base.settings[key] = settings[key];
    for (const key of ['quarry', 'timeAttack'] as const) if (typeof unlocked[key] === 'boolean') base.unlocked[key] = unlocked[key];
    for (const level of ['cinder', 'quarry'] as const) for (const mode of ['mission', 'timeAttack'] as const) {
      const key = `${level}:${mode}` as const;
      const record = object(best[key]);
      if (typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time < 0) continue;
      const medals: MissionResults['medals'] = {};
      const storedMedals = object(record.medals);
      for (const kind of ['carrier', 'completion', 'time'] as const) {
        const medal = storedMedals[kind];
        if (typeof medal === 'string' && Object.hasOwn(RANK, medal)) medals[kind] = medal as keyof typeof RANK;
      }
      const completion = typeof record.completion === 'number' && Number.isFinite(record.completion) ? Math.max(0, Math.min(100, record.completion)) : 0;
      base.best[key] = { time: record.time, completion, medals };
    }
  } catch {
    // Invalid JSON or unavailable storage: use the defaults.
  }
  return base;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
  const completion = completionPercent(r);
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
