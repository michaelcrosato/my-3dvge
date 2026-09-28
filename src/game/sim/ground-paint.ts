import type { GroundDesc } from '../../shared/protocol.ts';

type Rect = { x0: number; z0: number; x1: number; z1: number };

/** Paints a level's ground color map (roads, fields, water) and cuts holes (rail cuts, pits) into slabs. */
export class GroundPainter {
  readonly bounds: Rect;
  readonly texel: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  private readonly holes: (Rect & { floor: number })[] = [];
  private readonly water: (Rect & { y: number })[] = [];
  private seed = 12345;

  constructor(bounds: Rect, texel = 0.5) {
    this.bounds = bounds;
    this.texel = texel;
    this.width = Math.round((bounds.x1 - bounds.x0) / texel);
    this.height = Math.round((bounds.z1 - bounds.z0) / texel);
    this.data = new Uint8Array(this.width * this.height * 4);
  }

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private put(i: number, j: number, color: number, noise: number): void {
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return;
    const f = 1 + (this.rnd() * 2 - 1) * noise;
    const o = (j * this.width + i) * 4;
    this.data[o] = Math.min(255, ((color >> 16) & 255) * f);
    this.data[o + 1] = Math.min(255, ((color >> 8) & 255) * f);
    this.data[o + 2] = Math.min(255, (color & 255) * f);
    this.data[o + 3] = 255;
  }

  private range(r: Rect): [number, number, number, number] {
    const b = this.bounds, t = this.texel;
    return [
      Math.max(0, Math.floor((Math.min(r.x0, r.x1) - b.x0) / t)),
      Math.max(0, Math.floor((Math.min(r.z0, r.z1) - b.z0) / t)),
      Math.min(this.width, Math.ceil((Math.max(r.x0, r.x1) - b.x0) / t)),
      Math.min(this.height, Math.ceil((Math.max(r.z0, r.z1) - b.z0) / t)),
    ];
  }

  fill(color: number, noise = 0.05): this {
    for (let j = 0; j < this.height; j++) for (let i = 0; i < this.width; i++) this.put(i, j, color, noise);
    return this;
  }

  rect(x0: number, z0: number, x1: number, z1: number, color: number, noise = 0.04): this {
    const [i0, j0, i1, j1] = this.range({ x0, z0, x1, z1 });
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this.put(i, j, color, noise);
    return this;
  }

  /** Crop rows: alternating colors every `period` meters along x (axis 'x') or z. */
  stripes(x0: number, z0: number, x1: number, z1: number, a: number, b: number, period: number, axis: 'x' | 'z' = 'x'): this {
    const [i0, j0, i1, j1] = this.range({ x0, z0, x1, z1 });
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const w = axis === 'x' ? this.bounds.x0 + i * this.texel : this.bounds.z0 + j * this.texel;
        this.put(i, j, Math.floor(w / period) % 2 ? a : b, 0.05);
      }
    return this;
  }

  /** Blob (ellipse) patch, e.g. ponds or dirt patches. */
  blob(cx: number, cz: number, rx: number, rz: number, color: number, noise = 0.05): this {
    const [i0, j0, i1, j1] = this.range({ x0: cx - rx, z0: cz - rz, x1: cx + rx, z1: cz + rz });
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const x = this.bounds.x0 + (i + 0.5) * this.texel, z = this.bounds.z0 + (j + 0.5) * this.texel;
        const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
        if (d <= 1 - this.rnd() * 0.08) this.put(i, j, color, noise);
      }
    return this;
  }

  /** Dashed centerline along x. */
  dashes(x0: number, x1: number, z: number, width: number, color: number, dash = 2, gap = 2): this {
    for (let x = x0; x < x1; x += dash + gap) this.rect(x, z - width / 2, Math.min(x1, x + dash), z + width / 2, color, 0.02);
    return this;
  }

  /** A hole in the ground with a floor slab at y = floor (rendered from the same color map). */
  hole(x0: number, z0: number, x1: number, z1: number, floor: number): this {
    this.holes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), floor });
    return this;
  }

  waterPlane(x0: number, z0: number, x1: number, z1: number, y: number): this {
    this.water.push({ x0, z0, x1, z1, y });
    return this;
  }

  /** Ground slabs = bounds minus holes (rectangle subtraction), plus hole floors. */
  toDesc(): GroundDesc {
    let rects: Rect[] = [{ ...this.bounds }];
    for (const h of this.holes) {
      const next: Rect[] = [];
      for (const r of rects) {
        if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) {
          next.push(r);
          continue;
        }
        if (h.z0 > r.z0) next.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: h.z0 });
        if (h.z1 < r.z1) next.push({ x0: r.x0, z0: h.z1, x1: r.x1, z1: r.z1 });
        const z0 = Math.max(r.z0, h.z0), z1 = Math.min(r.z1, h.z1);
        if (h.x0 > r.x0) next.push({ x0: r.x0, z0, x1: h.x0, z1 });
        if (h.x1 < r.x1) next.push({ x0: h.x1, z0, x1: r.x1, z1 });
      }
      rects = next;
    }
    return {
      ...this.bounds,
      map: { width: this.width, height: this.height, data: this.data },
      slabs: [
        ...rects.map((r) => ({ ...r, y: 0, depth: 2 })),
        ...this.holes.map((h) => ({ x0: h.x0, z0: h.z0, x1: h.x1, z1: h.z1, y: h.floor, depth: 2 })),
      ],
      water: this.water,
    };
  }
}
