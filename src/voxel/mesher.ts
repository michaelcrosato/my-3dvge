/**
 * Greedy chunk mesher with baked per-vertex ambient occlusion.
 *
 * Input is a PADDED³ array (chunk + 1-voxel neighbor border, x fastest) of palette indices. Faces are
 * emitted only where a solid voxel borders empty space; coplanar faces with the same palette index AND
 * the same four AO values are merged into one quad. Positions are in volume-local meters.
 */
import { CHUNK_SIZE, PADDED, VOXEL_SIZE } from './constants.ts';

/** Brightness per AO level (0 = fully occluded corner, 3 = open). */
export const AO_CURVE = [0.5, 0.68, 0.85, 1] as const;

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** RGBA8, AO baked into RGB. */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  quads: number;
}

const S = CHUNK_SIZE;
const P = PADDED;
const STRIDE = [1, P, P * P] as const;

/** Corner (v,w) offsets in emission order; positive faces wind CCW seen from outside. */
const CORNERS_POS = [0, 0, 1, 0, 1, 1, 0, 1] as const;
const CORNERS_NEG = [0, 0, 0, 1, 1, 1, 1, 0] as const;

/** Direction d: axis = d >> 1, sign = d & 1 ? -1 : +1 (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z). */
export function faceAO(data: Uint8Array, px: number, py: number, pz: number, d: number, out: number[] = [0, 0, 0, 0]): number[] {
  return faceAOAt(data, px + py * P + pz * P * P, d, out);
}

/** Same as faceAO but takes the padded linear index of the voxel. */
export function faceAOAt(data: Uint8Array, i: number, d: number, out: number[]): number[] {
  const axis = d >> 1;
  const sign = d & 1 ? -1 : 1;
  const sv = STRIDE[(axis + 1) % 3]!;
  const sw = STRIDE[(axis + 2) % 3]!;
  const layer = i + sign * STRIDE[axis]!;
  const corners = sign > 0 ? CORNERS_POS : CORNERS_NEG;
  for (let c = 0; c < 4; c++) {
    const dv = corners[c * 2]! ? sv : -sv;
    const dw = corners[c * 2 + 1]! ? sw : -sw;
    const s1 = data[layer + dv] !== 0 ? 1 : 0;
    const s2 = data[layer + dw] !== 0 ? 1 : 0;
    const cr = data[layer + dv + dw] !== 0 ? 1 : 0;
    out[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
  }
  return out;
}

// Growable scratch buffers, reused across calls (one mesher per worker).
let cap = 0;
let pos = new Float32Array(0);
let nrm = new Float32Array(0);
let col = new Uint8Array(0);
let idx = new Uint32Array(0);

function ensure(quads: number): void {
  if (quads <= cap) return;
  const n = Math.max(quads, cap * 2, 1024);
  const grow = <T extends Float32Array | Uint8Array | Uint32Array>(old: T, size: number): T => {
    const next = new (old.constructor as new (n: number) => T)(size);
    next.set(old);
    return next;
  };
  pos = grow(pos, n * 12);
  nrm = grow(nrm, n * 12);
  col = grow(col, n * 16);
  idx = grow(idx, n * 6);
  cap = n;
}

const mask = new Int32Array(S * S);
const ao = [0, 0, 0, 0];
const corner = [0, 0, 0];

/**
 * @param data PADDED³ palette indices.
 * @param palette RGBA8 per palette index (256 entries).
 * @param origin chunk origin in volume voxel coordinates.
 */
export function meshChunk(data: Uint8Array, palette: Uint8Array, origin: readonly [number, number, number] = [0, 0, 0]): MeshData {
  let quads = 0;
  for (let d = 0; d < 6; d++) {
    const axis = d >> 1;
    const sign = d & 1 ? -1 : 1;
    const va = (axis + 1) % 3;
    const wa = (axis + 2) % 3;
    const sa = STRIDE[axis]!, sv = STRIDE[va]!, sw = STRIDE[wa]!;
    const neighbor = sign * sa;
    const corners = sign > 0 ? CORNERS_POS : CORNERS_NEG;

    for (let s = 1; s <= S; s++) {
      // 1. Build the face mask for this slice.
      let any = false;
      for (let j = 1; j <= S; j++) {
        const rowBase = s * sa + j * sv;
        for (let k = 1; k <= S; k++) {
          const i = rowBase + k * sw;
          const v = data[i]!;
          let m = 0;
          if (v !== 0 && data[i + neighbor] === 0) {
            faceAOAt(data, i, d, ao);
            m = v | ((ao[0]! | (ao[1]! << 2) | (ao[2]! << 4) | (ao[3]! << 6)) << 8);
            any = true;
          }
          mask[(j - 1) * S + (k - 1)] = m;
        }
      }
      if (!any) continue;

      // 2. Greedy merge: extend along w (k) first, then along v (j).
      for (let j = 0; j < S; j++) {
        for (let k = 0; k < S; ) {
          const m = mask[j * S + k]!;
          if (m === 0) {
            k++;
            continue;
          }
          let kw = 1;
          while (k + kw < S && mask[j * S + k + kw] === m) kw++;
          let jh = 1;
          grow: while (j + jh < S) {
            for (let t = 0; t < kw; t++) if (mask[(j + jh) * S + k + t] !== m) break grow;
            jh++;
          }
          for (let a = 0; a < jh; a++) mask.fill(0, (j + a) * S + k, (j + a) * S + k + kw);

          // 3. Emit the quad.
          ensure(quads + 1);
          const plane = sign > 0 ? s : s - 1; // chunk-local coordinate along the axis
          const pal = (m & 255) * 4;
          const r = palette[pal]!, g = palette[pal + 1]!, b = palette[pal + 2]!;
          const base = quads * 4;
          for (let c = 0; c < 4; c++) {
            const cv = corners[c * 2]! ? j + jh : j;
            const cw = corners[c * 2 + 1]! ? k + kw : k;
            corner[axis] = plane;
            corner[va] = cv;
            corner[wa] = cw;
            const o = (base + c) * 3;
            pos[o] = (origin[0] + corner[0]!) * VOXEL_SIZE;
            pos[o + 1] = (origin[1] + corner[1]!) * VOXEL_SIZE;
            pos[o + 2] = (origin[2] + corner[2]!) * VOXEL_SIZE;
            nrm[o] = axis === 0 ? sign : 0;
            nrm[o + 1] = axis === 1 ? sign : 0;
            nrm[o + 2] = axis === 2 ? sign : 0;
            const shade = AO_CURVE[(m >> (8 + c * 2)) & 3]!;
            const co = (base + c) * 4;
            col[co] = r * shade;
            col[co + 1] = g * shade;
            col[co + 2] = b * shade;
            col[co + 3] = 255;
          }
          const a0 = (m >> 8) & 3, a1 = (m >> 10) & 3, a2 = (m >> 12) & 3, a3 = (m >> 14) & 3;
          const io = quads * 6;
          if (a0 + a2 < a1 + a3) {
            // Split along the 1–3 diagonal so a dark corner doesn't bleed across the quad.
            idx[io] = base + 1; idx[io + 1] = base + 2; idx[io + 2] = base + 3;
            idx[io + 3] = base + 1; idx[io + 4] = base + 3; idx[io + 5] = base;
          } else {
            idx[io] = base; idx[io + 1] = base + 1; idx[io + 2] = base + 2;
            idx[io + 3] = base; idx[io + 4] = base + 2; idx[io + 5] = base + 3;
          }
          quads++;
          k += kw;
        }
      }
    }
  }

  const verts = quads * 4;
  const indices = verts <= 65536 ? Uint16Array.from(idx.subarray(0, quads * 6)) : idx.slice(0, quads * 6);
  return {
    positions: pos.slice(0, verts * 3),
    normals: nrm.slice(0, verts * 3),
    colors: col.slice(0, verts * 4),
    indices,
    quads,
  };
}
