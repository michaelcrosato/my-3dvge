import { MATERIALS, materialByName, type Material, type MaterialName } from './materials.ts';

/**
 * 255-entry palette shared by every volume. Index 0 is empty space; each entry pairs an RGB color with a
 * material. `colors` is RGBA8 (alpha unused) so it can be posted straight to the mesher workers.
 */
export class Palette {
  readonly colors = new Uint8Array(256 * 4);
  readonly materials = new Uint8Array(256);
  private next = 1;
  /** Bumped on every change so workers know when to re-send colors. */
  version = 0;

  get size(): number {
    return this.next - 1;
  }

  add(color: number, material: MaterialName): number {
    if (this.next > 255) throw new Error('Palette is full (255 entries)');
    const index = this.next++;
    this.set(index, color, material);
    return index;
  }

  /** Adds `count` shades of a base color (±variance brightness), returning their indices. */
  addShades(color: number, material: MaterialName, count: number, variance = 0.08, seed = 1): number[] {
    const out: number[] = [];
    let s = seed * 9301 + 49297;
    for (let i = 0; i < count; i++) {
      s = (s * 9301 + 49297) % 233280;
      const f = 1 + (count === 1 ? 0 : ((s / 233280) * 2 - 1) * variance);
      out.push(this.add(scaleColor(color, f), material));
    }
    return out;
  }

  /** Returns an existing entry with this exact color and material, or adds one. */
  findOrAdd(color: number, material: MaterialName): number {
    const id = materialByName(material).id;
    for (let i = 1; i < this.next; i++) if (this.materials[i] === id && this.color(i) === (color & 0xffffff)) return i;
    return this.add(color, material);
  }

  set(index: number, color: number, material: MaterialName | number): void {
    const o = index * 4;
    this.colors[o] = (color >> 16) & 255;
    this.colors[o + 1] = (color >> 8) & 255;
    this.colors[o + 2] = color & 255;
    this.colors[o + 3] = 255;
    this.materials[index] = typeof material === 'number' ? material : materialByName(material).id;
    this.version++;
    if (index >= this.next) this.next = index + 1;
  }

  color(index: number): number {
    const o = index * 4;
    return (this.colors[o]! << 16) | (this.colors[o + 1]! << 8) | this.colors[o + 2]!;
  }

  material(index: number): Material {
    return MATERIALS[this.materials[index]!]!;
  }
}

export function scaleColor(color: number, f: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}
