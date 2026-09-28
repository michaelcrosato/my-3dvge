/**
 * Body transforms from the simulation worker to the renderer.
 *
 * With cross-origin isolation a SharedArrayBuffer holds a 3-frame ring: the worker writes frame f into
 * ring slot f % 3 and then publishes f atomically; the renderer reads frames f and f-1 and interpolates.
 * Readers copy and validate per-frame sequence numbers: a stalled renderer must not retain live ring
 * views that the worker can wrap around and overwrite. Without isolation the worker posts each frame's
 * Float32Array instead (same reader API).
 *
 * Per body slot: px, py, pz, qx, qy, qz, qw, owner volume id (0 = player / none).
 */
export const SLOT_FLOATS = 8;
/** Transform slots shared with the renderer; slot 0 is the player. */
export const MAX_SLOTS = 2048;
export const PLAYER_SLOT = 0;
const RING = 3;
const HEADER_BYTES = 64; // Int32 [0] = latest frame, [1..3] = slot sequences; Float64 times at byte 16

export function transformBufferBytes(slots: number): number {
  return HEADER_BYTES + RING * slots * SLOT_FLOATS * 4;
}

/** Wall-clock milliseconds comparable across threads (worker and window have different timeOrigins). */
export function absoluteNow(): number {
  return performance.timeOrigin + performance.now();
}

export class TransformWriter {
  private readonly header: Int32Array | null;
  private readonly times: Float64Array | null;
  private readonly ring: Float32Array[];
  private readonly fallback: Float32Array;
  private frame = 0;
  private readonly post: ((frame: number, time: number, data: Float32Array) => void) | null;

  constructor(shared: SharedArrayBuffer | null, slots: number, post: ((frame: number, time: number, data: Float32Array) => void) | null) {
    this.post = post;
    if (shared) {
      this.header = new Int32Array(shared, 0, 4);
      this.times = new Float64Array(shared, 16, RING);
      this.ring = Array.from({ length: RING }, (_, i) => new Float32Array(shared, HEADER_BYTES + i * slots * SLOT_FLOATS * 4, slots * SLOT_FLOATS));
    } else {
      this.header = null;
      this.times = null;
      this.ring = [];
    }
    this.fallback = new Float32Array(slots * SLOT_FLOATS);
  }

  get shared(): boolean {
    return this.header !== null;
  }

  /** Buffer to fill for the next frame. */
  begin(): Float32Array {
    if (!this.header) return this.fallback;
    const next = this.frame + 1;
    Atomics.store(this.header, 1 + next % RING, -next); // in progress
    return this.ring[next % RING]!;
  }

  /** Publishes the frame; `usedFloats` bounds the copy in postMessage mode. */
  commit(usedFloats: number): void {
    this.frame++;
    const now = absoluteNow();
    if (this.header && this.times) {
      this.times[this.frame % RING] = now;
      Atomics.store(this.header, 1 + this.frame % RING, this.frame);
      Atomics.store(this.header, 0, this.frame);
    } else if (this.post) {
      this.post(this.frame, now, this.fallback.slice(0, usedFloats));
    }
  }
}

export interface TransformSample {
  prev: Float32Array;
  curr: Float32Array;
  alpha: number;
  frame: number;
}

export class TransformReader {
  private readonly header: Int32Array | null;
  private readonly times: Float64Array | null;
  private readonly ring: Float32Array[];
  private posted: { frame: number; time: number; data: Float32Array }[] = [];
  private readonly stepMs: number;
  private copied: { frame: number; time: number; prev: Float32Array; curr: Float32Array } | null = null;
  private scratchPrev: Float32Array;
  private scratchCurr: Float32Array;

  constructor(shared: SharedArrayBuffer | null, slots: number, stepMs = 1000 / 60) {
    this.stepMs = stepMs;
    this.scratchPrev = new Float32Array(shared ? slots * SLOT_FLOATS : 0);
    this.scratchCurr = new Float32Array(shared ? slots * SLOT_FLOATS : 0);
    if (shared) {
      this.header = new Int32Array(shared, 0, 4);
      this.times = new Float64Array(shared, 16, RING);
      this.ring = Array.from({ length: RING }, (_, i) => new Float32Array(shared, HEADER_BYTES + i * slots * SLOT_FLOATS * 4, slots * SLOT_FLOATS));
    } else {
      this.header = null;
      this.times = null;
      this.ring = [];
    }
  }

  /** postMessage fallback: feed frames as they arrive. */
  push(frame: number, time: number, data: Float32Array): void {
    this.posted.push({ frame, time, data });
    if (this.posted.length > 2) this.posted = this.posted.slice(-2);
  }

  sample(now = absoluteNow()): TransformSample | null {
    let prev: Float32Array, curr: Float32Array, tCurr: number, frame: number;
    if (this.header && this.times) {
      // Bounded retries keep the render loop responsive even if the worker laps it during the copy.
      for (let attempt = 0; attempt < 3; attempt++) {
        const f = Atomics.load(this.header, 0);
        if (f < 1 || f === this.copied?.frame) break;
        const p = Math.max(1, f - 1), ci = f % RING, pi = p % RING;
        if (Atomics.load(this.header, 1 + ci) !== f || Atomics.load(this.header, 1 + pi) !== p) continue;
        this.scratchCurr.set(this.ring[ci]!);
        this.scratchPrev.set(this.ring[pi]!);
        const time = this.times[ci]!;
        if (Atomics.load(this.header, 1 + ci) !== f || Atomics.load(this.header, 1 + pi) !== p) continue;
        const old = this.copied;
        this.copied = { frame: f, time, prev: this.scratchPrev, curr: this.scratchCurr };
        this.scratchPrev = old?.prev ?? new Float32Array(this.scratchPrev.length);
        this.scratchCurr = old?.curr ?? new Float32Array(this.scratchCurr.length);
        break;
      }
      if (!this.copied) return null;
      ({ prev, curr, frame, time: tCurr } = this.copied);
    } else {
      const n = this.posted.length;
      if (n === 0) return null;
      const c = this.posted[n - 1]!;
      curr = c.data;
      prev = n > 1 ? this.posted[n - 2]!.data : curr;
      tCurr = c.time;
      frame = c.frame;
    }
    const alpha = Math.min(1, Math.max(0, (now - tCurr) / this.stepMs));
    return { prev, curr, alpha, frame };
  }
}

/** Interpolates slot `s` of a sample into position/quaternion outputs (nlerp for rotation). */
export function interpolateSlot(sample: TransformSample, s: number, pos: { set(x: number, y: number, z: number): unknown }, quat: { set(x: number, y: number, z: number, w: number): unknown }): void {
  const o = s * SLOT_FLOATS;
  const a = sample.prev, b = sample.curr, t = sample.alpha;
  if (b.length <= o + 6) return;
  // Snap (no interpolation) when the slot changed owner between the two frames.
  const pa = a.length > o + 7 && a[o + 7] === b[o + 7] ? a : b;
  pos.set(pa[o]! + (b[o]! - pa[o]!) * t, pa[o + 1]! + (b[o + 1]! - pa[o + 1]!) * t, pa[o + 2]! + (b[o + 2]! - pa[o + 2]!) * t);
  let qx = pa[o + 3]!, qy = pa[o + 4]!, qz = pa[o + 5]!, qw = pa[o + 6]!;
  const bx = b[o + 3]!, by = b[o + 4]!, bz = b[o + 5]!, bw = b[o + 6]!;
  const sign = qx * bx + qy * by + qz * bz + qw * bw < 0 ? -1 : 1;
  qx += (bx * sign - qx) * t;
  qy += (by * sign - qy) * t;
  qz += (bz * sign - qz) * t;
  qw += (bw * sign - qw) * t;
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  quat.set(qx / len, qy / len, qz / len, qw / len);
}
