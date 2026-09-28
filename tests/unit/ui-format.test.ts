import { describe, expect, it } from 'vitest';
import {
  completionPercent, devicePrompt, formatMoney, formatTime, isRecord, medalForTime, medalRank, percent, warningColor,
} from '../../src/game/client/ui/format.ts';

describe('UI formatting', () => {
  it('formats mission clocks', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.47)).toBe('1:05.4');
    expect(formatTime(186.99, false)).toBe('3:06');
    expect(formatTime(-3)).toBe('0:00.0');
  });

  it('formats damage with thousands separators', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(45000)).toBe('$45,000');
    expect(formatMoney(1845000.4)).toBe('$1,845,000');
  });

  it('computes completion over the categories a level has', () => {
    expect(percent(27, 30)).toBe(90);
    expect(percent(0, 0)).toBe(100);
    expect(completionPercent({ buildings: [30, 30], survivors: [8, 8], rdus: [100, 100], dishes: [2, 2] })).toBe(100);
    expect(completionPercent({ buildings: [15, 30], survivors: [4, 8], rdus: [50, 100], dishes: [1, 2] })).toBe(50);
    expect(completionPercent({ buildings: [12, 12], survivors: [0, 0], rdus: [0, 0], dishes: [0, 0] })).toBe(100);
  });

  it('ranks medals and awards time medals', () => {
    expect(medalRank(undefined)).toBe(0);
    expect(medalRank('platinum')).toBeGreaterThan(medalRank('gold'));
    const t = { bronze: 150, silver: 120, gold: 100, platinum: 60 };
    expect(medalForTime(59, t)).toBe('platinum');
    expect(medalForTime(101, t)).toBe('silver');
    expect(medalForTime(151, t)).toBeUndefined();
    expect(medalForTime(10, null)).toBeUndefined();
  });

  it('maps warning levels to colors, clamped', () => {
    expect(warningColor(0)).toBe(warningColor(-2));
    expect(warningColor(4)).toBe(warningColor(9));
    expect(warningColor(1)).not.toBe(warningColor(3));
  });

  it('translates prompt keys per input device', () => {
    expect(devicePrompt('E  Enter PLOWHORSE', 'keyboard')).toEqual({ key: 'E', text: 'Enter PLOWHORSE' });
    expect(devicePrompt('[E] Enter PLOWHORSE', 'gamepad')).toEqual({ key: 'Y', text: 'Enter PLOWHORSE' });
    expect(devicePrompt('E Enter PLOWHORSE', 'touch')).toEqual({ key: 'ENTER', text: 'Enter PLOWHORSE' });
    expect(devicePrompt('Push the TNT into the depot', 'keyboard')).toEqual({ key: null, text: 'Push the TNT into the depot' });
  });

  it('decides records by completion then time (missions) or time (timed modes)', () => {
    expect(isRecord({ time: 200, completion: 80 }, undefined, false)).toBe(true);
    expect(isRecord({ time: 200, completion: 90 }, { time: 150, completion: 80 }, false)).toBe(true);
    expect(isRecord({ time: 140, completion: 80 }, { time: 150, completion: 80 }, false)).toBe(true);
    expect(isRecord({ time: 140, completion: 70 }, { time: 150, completion: 80 }, false)).toBe(false);
    expect(isRecord({ time: 90, completion: 0 }, { time: 95, completion: 0 }, true)).toBe(true);
    expect(isRecord({ time: 99, completion: 0 }, { time: 95, completion: 0 }, true)).toBe(false);
  });
});
