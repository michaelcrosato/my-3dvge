import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, parseParams } from '../../src/config/params.ts';
import { FrameStats, percentile, summarize } from '../../src/debug/frame-stats.ts';

describe('parseParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parseParams('')).toEqual(DEFAULT_PARAMS);
  });

  it('parses every supported parameter', () => {
    const p = parseParams('?renderer=webgl&quality=low&scene=stress&maxBodies=40&bench=1&benchTime=60&debug=1&fly=1');
    expect(p).toEqual({
      renderer: 'webgl',
      quality: 'low',
      scene: 'stress',
      maxBodies: 40,
      bench: true,
      benchTime: 60,
      debug: true,
      fly: true,
    });
  });

  it('ignores invalid values and clamps numbers', () => {
    const p = parseParams('?renderer=vulkan&quality=ultra&scene=moon&maxBodies=-5&debug=0');
    expect(p.renderer).toBe('auto');
    expect(p.quality).toBeNull();
    expect(p.scene).toBe('test');
    expect(p.maxBodies).toBe(1);
    expect(p.debug).toBe(false);
  });
});

describe('frame stats', () => {
  it('computes nearest-rank percentiles', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile([], 50)).toBe(0);
  });

  it('summarizes unsorted samples', () => {
    const s = summarize([3, 1, 2, 4]);
    expect(s.avg).toBe(2.5);
    expect(s.max).toBe(4);
    expect(s.p50).toBe(2);
  });

  it('keeps only the most recent samples in its ring buffer', () => {
    const f = new FrameStats(4);
    for (let i = 1; i <= 6; i++) f.push(i);
    expect(Array.from(f.recent())).toEqual([3, 4, 5, 6]);
    expect(f.average(2)).toBe(5.5);
  });
});
