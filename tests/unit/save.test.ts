import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSave, loadSave, recordResults } from '../../src/game/client/save.ts';
import type { MissionResults } from '../../src/game/shared/types.ts';

afterEach(() => vi.unstubAllGlobals());

function storage(value: string | null) {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => value, setItem });
  return setItem;
}

describe('saved progress', () => {
  it.each([null, 'null', '[]', '42', '{broken', '{"settings":null,"best":null}'])('recovers from missing or invalid saves: %s', (value) => {
    storage(value);
    expect(loadSave()).toEqual(defaultSave());
  });

  it('validates settings and records independently, preserving valid progress', () => {
    storage(JSON.stringify({
      settings: { music: 'loud', sfx: 3, camera: 'unknown', invertY: 'yes', assist: false },
      unlocked: { quarry: true, timeAttack: 'yes' },
      best: { 'cinder:mission': { time: 123, completion: 200, medals: { carrier: 'gold', time: 'bad' } }, 'quarry:mission': { time: -10 } },
    }));
    const save = loadSave();
    expect(save.settings).toEqual({ ...defaultSave().settings, sfx: 1, assist: false });
    expect(save.unlocked).toEqual({ quarry: true, timeAttack: false });
    expect(save.best).toEqual({ 'cinder:mission': { time: 123, completion: 100, medals: { carrier: 'gold' } } });
    const result: MissionResults = { level: 'cinder', mode: 'mission', time: 150, carrierSafe: true, buildings: [1, 2], survivors: [0, 0], rdus: [0, 0], dishes: [0, 0], damage: 1000, medals: { carrier: 'gold' } };
    expect(recordResults(save, result)).toBe(false);
    expect(save.best['cinder:mission']!.time).toBe(123);
    expect(save.unlocked.timeAttack).toBe(true);
  });

  it('works when storage access is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(loadSave()).toEqual(defaultSave());
  });
});
