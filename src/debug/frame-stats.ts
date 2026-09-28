/** Nearest-rank percentile of an ascending-sorted array. p in [0, 100]. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * n);
  return sorted[Math.min(n - 1, Math.max(0, rank - 1))] ?? 0;
}

export interface FrameSummary {
  samples: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarize(values: ArrayLike<number>): FrameSummary {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) sum += sorted[i]!;
  return {
    samples: sorted.length,
    avg: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1]! : 0,
  };
}

/** Fixed-size ring buffer of frame times (ms). */
export class FrameStats {
  private readonly buf: Float32Array;
  private next = 0;
  private filled = 0;

  constructor(capacity = 600) {
    this.buf = new Float32Array(capacity);
  }

  push(ms: number): void {
    this.buf[this.next] = ms;
    this.next = (this.next + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }

  get count(): number {
    return this.filled;
  }

  /** Most recent `n` samples, oldest first. */
  recent(n = this.filled): Float32Array {
    const k = Math.min(n, this.filled);
    const out = new Float32Array(k);
    for (let i = 0; i < k; i++) {
      out[i] = this.buf[(this.next - k + i + this.buf.length) % this.buf.length]!;
    }
    return out;
  }

  average(n = 60): number {
    const r = this.recent(n);
    let s = 0;
    for (let i = 0; i < r.length; i++) s += r[i]!;
    return r.length ? s / r.length : 0;
  }

  summary(n = this.filled): FrameSummary {
    return summarize(this.recent(n));
  }
}
