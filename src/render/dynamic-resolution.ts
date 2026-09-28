/**
 * Dynamic resolution: drops the pixel ratio quickly when frames run over budget and raises it slowly
 * when there is headroom, with hysteresis so it doesn't oscillate (important for sustained thermal load).
 */
export class DynamicResolution {
  readonly maxRatio: number;
  readonly minRatio: number;
  ratio: number;
  enabled = true;
  private ema = 16.7;
  private lastChange = 0;
  private lastDrop = -Infinity;
  private readonly budgetMs: number;

  constructor(maxRatio: number, minRatio: number, targetFps = 60) {
    this.maxRatio = maxRatio;
    this.minRatio = Math.min(minRatio, maxRatio);
    this.ratio = maxRatio;
    this.budgetMs = 1000 / targetFps;
  }

  get scale(): number {
    return this.ratio / this.maxRatio;
  }

  /** Feed each rendered frame's interval. Returns true when the pixel ratio changed. */
  update(frameMs: number, now: number): boolean {
    if (!this.enabled || frameMs > 250) return false;
    this.ema += (frameMs - this.ema) * 0.08;
    const since = now - this.lastChange;
    if (this.ema > this.budgetMs * 1.18 && since > 600 && this.ratio > this.minRatio) {
      this.ratio = Math.max(this.minRatio, this.ratio * 0.88);
      this.lastChange = this.lastDrop = now;
      return true;
    }
    if (this.ema < this.budgetMs * 1.05 && since > 4000 && now - this.lastDrop > 10_000 && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio * 1.06);
      this.lastChange = now;
      return true;
    }
    return false;
  }
}
