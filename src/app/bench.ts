import { summarize, type FrameSummary } from '../debug/frame-stats.ts';
import type { Vec3 } from '../shared/protocol.ts';

export interface BenchDriver {
  /** Point the camera (free-fly) at a position/orientation. */
  setCamera(position: Vec3, yaw: number, pitch: number): void;
  blast(origin: Vec3, dir: Vec3): void;
  crate(origin: Vec3, dir: Vec3): void;
  bodyCount(): number;
}

export interface BenchReport {
  seconds: number;
  frames: number;
  frameMs: FrameSummary;
  /** Average frame time over the first and last window (thermal throttling shows as last > first). */
  firstWindowAvgMs: number;
  lastWindowAvgMs: number;
  windowSeconds: number;
  peakBodies: number;
  blasts: number;
  crates: number;
}

/**
 * Scripted benchmark: the camera orbits the scene's blast target, blasting every 2.5 s and throwing a
 * crate every 1.2 s, while recording every frame time and the peak body count.
 */
export class Bench {
  readonly seconds: number;
  private readonly center: Vec3;
  private readonly driver: BenchDriver;
  private start = -1;
  private readonly times: number[] = [];
  private readonly stamps: number[] = [];
  private peak = 0;
  private blasts = 0;
  private crates = 0;
  private nextBlast = 2;
  private nextCrate = 1;
  done = false;

  constructor(seconds: number, center: Vec3, driver: BenchDriver) {
    this.seconds = seconds;
    this.center = center;
    this.driver = driver;
  }

  get elapsed(): number {
    return this.start < 0 ? 0 : this.stamps.length ? this.stamps[this.stamps.length - 1]! : 0;
  }

  /** Call once per rendered frame; returns the report when finished. */
  frame(now: number, frameMs: number): BenchReport | null {
    if (this.done) return null;
    if (this.start < 0) this.start = now;
    const t = (now - this.start) / 1000;
    this.times.push(frameMs);
    this.stamps.push(t);
    this.peak = Math.max(this.peak, this.driver.bodyCount());

    const a = t * ((2 * Math.PI) / 45);
    const r = 13 + 3 * Math.sin(t * 0.21);
    const c = this.center;
    const pos: Vec3 = [c[0] + Math.cos(a) * r, c[1] + 5 + 2 * Math.sin(t * 0.13), c[2] + Math.sin(a) * r];
    const dx = c[0] - pos[0], dy = c[1] - pos[1], dz = c[2] - pos[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.driver.setCamera(pos, yaw, pitch);

    if (t >= this.nextBlast) {
      this.nextBlast += 2.5;
      const j = (k: number) => Math.sin(t * 12.9898 + k * 78.233) * 3;
      const target: Vec3 = [c[0] + j(1), c[1] + Math.abs(j(2)) * 0.8, c[2] + j(3)];
      this.driver.blast(pos, [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
      this.blasts++;
    }
    if (t >= this.nextCrate) {
      this.nextCrate += 1.2;
      this.driver.crate(pos, [dx, dy + 2, dz]);
      this.crates++;
    }
    if (t < this.seconds) return null;
    this.done = true;
    return this.report();
  }

  report(): BenchReport {
    const total = this.stamps.length ? this.stamps[this.stamps.length - 1]! : 0;
    const win = Math.min(60, Math.max(1, total / 3));
    const avg = (from: number, to: number) => {
      let s = 0, n = 0;
      for (let i = 0; i < this.times.length; i++)
        if (this.stamps[i]! >= from && this.stamps[i]! < to) {
          s += this.times[i]!;
          n++;
        }
      return n ? s / n : 0;
    };
    return {
      seconds: total,
      frames: this.times.length,
      frameMs: summarize(this.times),
      firstWindowAvgMs: avg(0, win),
      lastWindowAvgMs: avg(total - win, total + 1),
      windowSeconds: win,
      peakBodies: this.peak,
      blasts: this.blasts,
      crates: this.crates,
    };
  }
}
