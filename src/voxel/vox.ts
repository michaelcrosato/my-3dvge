/**
 * MagicaVoxel .vox reader and writer. Self-contained (no imports, erasable TS only) so Node scripts in
 * scripts/ can run it directly with `node`.
 *
 * Coordinates here are .vox space (z up). Supported chunks: MAIN, PACK, SIZE, XYZI, RGBA, MATL; scene
 * graph chunks (nTRN, nGRP, nSHP, LAYR, rOBJ, …) are skipped. Color index i (1–255) maps to RGBA entry
 * i-1 in the file; MATL ids are color indices.
 */

export interface VoxModel {
  size: [number, number, number];
  /** Dense color indices (0 = empty), index x + sx·(y + sy·z). */
  data: Uint8Array;
}

export interface VoxFile {
  version: number;
  models: VoxModel[];
  /** RGBA8 per color index 0–255 (index 0 unused). */
  palette: Uint8Array;
  /** MATL dictionaries by color index (e.g. { _type: '_metal' } or our { _material: 'wood' }). */
  materials: Map<number, Record<string, string>>;
}

export function createVoxModel(sx: number, sy: number, sz: number): VoxModel {
  if (![sx, sy, sz].every((s) => Number.isInteger(s) && s >= 1 && s <= 256)) throw new Error(`Invalid .vox model size ${sx}x${sy}x${sz}`);
  return { size: [sx, sy, sz], data: new Uint8Array(sx * sy * sz) };
}

export function voxGet(m: VoxModel, x: number, y: number, z: number): number {
  const [sx, sy, sz] = m.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
  return m.data[x + sx * (y + sy * z)]!;
}

export function voxSet(m: VoxModel, x: number, y: number, z: number, c: number): void {
  const [sx, sy, sz] = m.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
  m.data[x + sx * (y + sy * z)] = c;
}

/** Grayscale fallback when a file has no RGBA chunk. */
function defaultPalette(): Uint8Array {
  const p = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i++) p.set([i, i, i, 255], i * 4);
  return p;
}

export function readVox(input: ArrayBuffer | Uint8Array): VoxFile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  const i32 = (at: number) => dv.getInt32(at, true);
  const requireBytes = (at: number, n: number, limit: number) => {
    if (at < 0 || n < 0 || at + n > limit) throw new Error('.vox: invalid or truncated chunk');
  };
  if (bytes.length < 20 || ascii(0) !== 'VOX ') throw new Error('Not a MagicaVoxel .vox file');
  const version = i32(4);
  if (ascii(8) !== 'MAIN') throw new Error('.vox: missing MAIN chunk');
  const mainSize = i32(12), childrenSize = i32(16);
  requireBytes(20, mainSize, bytes.length);
  let pos = 20 + mainSize;
  requireBytes(pos, childrenSize, bytes.length);
  const end = pos + childrenSize;
  const models: VoxModel[] = [];
  const materials = new Map<number, Record<string, string>>();
  let palette = defaultPalette();
  let size: [number, number, number] | null = null;

  const readString = (at: number, limit: number): [string, number] => {
    requireBytes(at, 4, limit);
    const n = i32(at);
    requireBytes(at + 4, n, limit);
    return [new TextDecoder().decode(bytes.subarray(at + 4, at + 4 + n)), at + 4 + n];
  };

  while (pos < end) {
    requireBytes(pos, 12, end);
    const id = ascii(pos);
    const contentSize = i32(pos + 4);
    const childrenSize = i32(pos + 8);
    const body = pos + 12;
    requireBytes(body, contentSize, end);
    const bodyEnd = body + contentSize;
    requireBytes(bodyEnd, childrenSize, end);
    if (id === 'SIZE') {
      requireBytes(body, 12, bodyEnd);
      size = [i32(body), i32(body + 4), i32(body + 8)];
    } else if (id === 'XYZI') {
      if (!size) throw new Error('.vox: XYZI before SIZE');
      requireBytes(body, 4, bodyEnd);
      const n = i32(body);
      requireBytes(body + 4, n * 4, bodyEnd);
      const m = createVoxModel(size[0], size[1], size[2]);
      for (let k = 0; k < n; k++) {
        const o = body + 4 + k * 4;
        voxSet(m, bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
      }
      models.push(m);
      size = null;
    } else if (id === 'RGBA') {
      requireBytes(body, 256 * 4, bodyEnd);
      palette = new Uint8Array(256 * 4);
      for (let i = 0; i < 255; i++) palette.set(bytes.subarray(body + i * 4, body + i * 4 + 4), (i + 1) * 4);
    } else if (id === 'MATL') {
      requireBytes(body, 8, bodyEnd);
      const matId = i32(body);
      const pairs = i32(body + 4);
      requireBytes(body + 8, pairs * 8, bodyEnd); // at least two string lengths per pair
      let at = body + 8;
      const dict: Record<string, string> = {};
      for (let k = 0; k < pairs; k++) {
        const [key, next] = readString(at, bodyEnd);
        const [value, after] = readString(next, bodyEnd);
        dict[key] = value;
        at = after;
      }
      materials.set(matId, dict);
    }
    pos = body + contentSize + childrenSize;
  }
  return { version, models, palette, materials };
}

class ByteWriter {
  private buf = new Uint8Array(1024);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  ascii(s: string): void {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i) & 255;
  }

  i32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setInt32(this.length, v, true);
    this.length += 4;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.i32(bytes.length);
    this.bytes(bytes);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function chunk(out: ByteWriter, id: string, content: Uint8Array): void {
  out.ascii(id);
  out.i32(content.length);
  out.i32(0);
  out.bytes(content);
}

export function writeVox(file: Pick<VoxFile, 'models' | 'palette'> & { materials?: Map<number, Record<string, string>> }): Uint8Array {
  const children = new ByteWriter();
  if (file.models.length > 1) {
    const w = new ByteWriter();
    w.i32(file.models.length);
    chunk(children, 'PACK', w.result());
  }
  for (const m of file.models) {
    const s = new ByteWriter();
    s.i32(m.size[0]);
    s.i32(m.size[1]);
    s.i32(m.size[2]);
    chunk(children, 'SIZE', s.result());
    const [sx, sy, sz] = m.size;
    const x = new ByteWriter();
    let count = 0;
    for (let i = 0; i < m.data.length; i++) if (m.data[i]) count++;
    x.i32(count);
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++)
        for (let xx = 0; xx < sx; xx++) {
          const c = m.data[xx + sx * (y + sy * z)]!;
          if (c) x.bytes(Uint8Array.of(xx, y, z, c));
        }
    chunk(children, 'XYZI', x.result());
  }
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 255; i++) rgba.set(file.palette.subarray((i + 1) * 4, (i + 2) * 4), i * 4);
  chunk(children, 'RGBA', rgba);
  for (const [id, dict] of file.materials ?? []) {
    const w = new ByteWriter();
    w.i32(id);
    const entries = Object.entries(dict);
    w.i32(entries.length);
    for (const [k, v] of entries) {
      w.string(k);
      w.string(v);
    }
    chunk(children, 'MATL', w.result());
  }
  const kids = children.result();
  const out = new ByteWriter();
  out.ascii('VOX ');
  out.i32(150);
  out.ascii('MAIN');
  out.i32(0);
  out.i32(kids.length);
  out.bytes(kids);
  return out.result();
}
