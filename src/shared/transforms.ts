/**
 * Body transforms from the simulation worker to the renderer.
 *
 * With cross-origin isolation a SharedArrayBuffer holds a 3-frame ring: the worker writes frame f into
 * ring slot f % 3 and then publishes f atomically; the renderer reads frames f and f-1 and interpolates.
 * The writer never touches those two slots while producing f+1, so reads are tear-free. Without
 * isolation the worker posts each frame's Float32Array instead (same reader API).
 *
 * Per body slot: px, py, pz, qx, qy, qz, qw, (unused).
 */
export const SLOT_FLOATS = 8;
/** Transform slots shared with the renderer; slot 0 is the player. */
export const MAX_SLOTS = 2048;
export const PLAYER_SLOT = 0;
const RING = 3;
const HEADER_BYTES = 64; // Int32 [0] = latest frame; Float64 times at byte 16 + 8·ring

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
    return this.header ? this.ring[(this.frame + 1) % RING]! : this.fallback;
  }

  /** Publishes the frame; `usedFloats` bounds the copy in postMessage mode. */
  commit(usedFloats: number): void {
    this.frame++;
    const now = absoluteNow();
    if (this.header && this.times) {
      this.times[this.frame % RING] = now;
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

  constructor(shared: SharedArrayBuffer | null, slots: number, stepMs = 1000 / 60) {
    this.stepMs = stepMs;
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
      frame = Atomics.load(this.header, 0);
      if (frame < 1) return null;
      curr = this.ring[frame % RING]!;
      prev = frame >= 2 ? this.ring[(frame - 1) % RING]! : curr;
      tCurr = this.times[frame % RING]!;
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
  const pa = a.length > o + 6 ? a : b;
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
