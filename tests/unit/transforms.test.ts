import { describe, expect, it } from 'vitest';
import { TransformReader, TransformWriter, interpolateSlot, transformBufferBytes } from '../../src/shared/transforms.ts';

describe('transform transport', () => {
  for (const shared of [false, true]) it(`interpolates and snaps reused slots (${shared ? 'shared' : 'posted'})`, () => {
    const buffer = shared ? new SharedArrayBuffer(transformBufferBytes(2)) : null;
    const reader = new TransformReader(buffer, 2);
    const writer = new TransformWriter(buffer, 2, (f, t, d) => reader.push(f, t, d));
    expect(reader.sample()).toBeNull();
    writer.begin().set([2, 0, 0, 0, 0, 0, 1, 8], 8);
    writer.commit(16);
    writer.begin().set([4, 0, 0, 0, 0, 0, -1, 8], 8);
    writer.commit(16);
    const sample = reader.sample()!;
    sample.alpha = 0.5;
    let position: number[] = [], rotation: number[] = [];
    const pos = { set: (...v: number[]) => { position = v; } };
    const quat = { set: (...v: number[]) => { rotation = v; } };
    interpolateSlot(sample, 1, pos, quat);
    expect(position).toEqual([3, 0, 0]);
    expect(Math.abs(rotation[3]!)).toBe(1);
    writer.begin().set([100, 0, 0, 0, 0, 0, 1, 9], 8);
    writer.commit(16);
    const reused = reader.sample()!;
    reused.alpha = 0;
    interpolateSlot(reused, 1, pos, quat);
    expect(position[0]).toBe(100);
  });

  it('keeps a shared sample stable when the worker wraps or is midway through writing', () => {
    const buffer = new SharedArrayBuffer(transformBufferBytes(1));
    const writer = new TransformWriter(buffer, 1, null);
    const reader = new TransformReader(buffer, 1);
    for (let f = 1; f <= 2; f++) { writer.begin().fill(f); writer.commit(8); }
    const sample = reader.sample()!;
    for (let f = 3; f <= 6; f++) { writer.begin().fill(f); writer.commit(8); }
    expect([...sample.prev]).toEqual(new Array(8).fill(1));
    expect([...sample.curr]).toEqual(new Array(8).fill(2));
    writer.begin().fill(7);
    expect([...reader.sample()!.curr]).toEqual(new Array(8).fill(6));
    writer.commit(8);
    expect([...reader.sample()!.curr]).toEqual(new Array(8).fill(7));
  });
});
