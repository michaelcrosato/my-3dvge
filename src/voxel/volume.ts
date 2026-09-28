import { CHUNK_BITS, CHUNK_MASK, CHUNK_SIZE, CHUNK_VOLUME, PADDED, PADDED_VOLUME } from './constants.ts';

/** Read-only voxel access used by the pure algorithms (flood fill, box merging, …). */
export interface VoxelGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  get(x: number, y: number, z: number): number;
}

/**
 * A fixed-size voxel grid stored as lazily allocated 32³ chunks of palette indices (0 = empty).
 * Every object in the world (terrain, buildings, crates, debris) is one VoxelVolume with its own
 * transform. Writes track dirty chunks (including neighbors whose border padding changed) for remeshing
 * and collider rebuilds.
 */
export class VoxelVolume implements VoxelGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Chunk counts per axis. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly chunks: (Uint8Array | null)[];
  /** Solid voxels per chunk. */
  readonly chunkCounts: Int32Array;
  /** Chunks whose mesh is stale. */
  readonly dirtyMesh = new Set<number>();
  /** Chunks whose collider boxes are stale (border-only neighbor changes don't count). */
  readonly dirtyCollider = new Set<number>();
  voxelCount = 0;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) throw new Error(`Invalid volume size ${sizeX}x${sizeY}x${sizeZ}`);
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.cx = Math.ceil(sizeX / CHUNK_SIZE);
    this.cy = Math.ceil(sizeY / CHUNK_SIZE);
    this.cz = Math.ceil(sizeZ / CHUNK_SIZE);
    this.chunks = new Array<Uint8Array | null>(this.cx * this.cy * this.cz).fill(null);
    this.chunkCounts = new Int32Array(this.chunks.length);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  chunkIndex(cxi: number, cyi: number, czi: number): number {
    return (czi * this.cy + cyi) * this.cx + cxi;
  }

  chunkCoords(ci: number): [number, number, number] {
    const cxi = ci % this.cx;
    const rest = (ci - cxi) / this.cx;
    const cyi = rest % this.cy;
    return [cxi, cyi, (rest - cyi) / this.cy];
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) return 0;
    const c = this.chunks[((z >> CHUNK_BITS) * this.cy + (y >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS)];
    return c ? c[((z & CHUNK_MASK) << (2 * CHUNK_BITS)) | ((y & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK)]! : 0;
  }

  set(x: number, y: number, z: number, v: number): void {
    if (!this.inBounds(x, y, z)) return;
    const ci = ((z >> CHUNK_BITS) * this.cy + (y >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS);
    let c = this.chunks[ci];
    if (!c) {
      if (v === 0) return;
      c = this.chunks[ci] = new Uint8Array(CHUNK_VOLUME);
    }
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const li = (lz << (2 * CHUNK_BITS)) | (ly << CHUNK_BITS) | lx;
    const old = c[li]!;
    if (old === v) return;
    c[li] = v;
    if (old === 0) {
      this.chunkCounts[ci]!++;
      this.voxelCount++;
    } else if (v === 0) {
      this.chunkCounts[ci]!--;
      this.voxelCount--;
      if (this.chunkCounts[ci] === 0) this.chunks[ci] = null;
    }
    this.dirtyMesh.add(ci);
    this.dirtyCollider.add(ci);
    // AO samples the full padding shell, including diagonal chunks at edges and corners.
    const dx = lx === 0 ? -1 : lx === CHUNK_MASK ? 1 : 0;
    const dy = ly === 0 ? -1 : ly === CHUNK_MASK ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === CHUNK_MASK ? 1 : 0;
    for (let iz = 0; iz <= (dz === 0 ? 0 : 1); iz++)
      for (let iy = 0; iy <= (dy === 0 ? 0 : 1); iy++)
        for (let ix = 0; ix <= (dx === 0 ? 0 : 1); ix++)
          if (ix || iy || iz) this.markMeshDirty(x + ix * dx, y + iy * dy, z + iz * dz);
  }

  private markMeshDirty(x: number, y: number, z: number): void {
    if (!this.inBounds(x, y, z)) return;
    const ci = ((z >> CHUNK_BITS) * this.cy + (y >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS);
    if (this.chunks[ci]) this.dirtyMesh.add(ci);
  }

  /** Fills an inclusive-exclusive box [x0,x1)×[y0,y1)×[z0,z1). `v` may be a per-voxel function. */
  fillBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    v: number | ((x: number, y: number, z: number) => number),
  ): void {
    const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(this.sizeX, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1)), by = Math.min(this.sizeY, Math.max(y0, y1));
    const az = Math.max(0, Math.min(z0, z1)), bz = Math.min(this.sizeZ, Math.max(z0, z1));
    for (let z = az; z < bz; z++)
      for (let y = ay; y < by; y++)
        for (let x = ax; x < bx; x++) this.set(x, y, z, typeof v === 'number' ? v : v(x, y, z));
  }

  /** Copies chunk `ci` plus a one-voxel border from its neighbors into a PADDED³ array (x fastest). */
  extractPadded(ci: number, out: Uint8Array = new Uint8Array(PADDED_VOLUME)): Uint8Array {
    const [cxi, cyi, czi] = this.chunkCoords(ci);
    const ox = cxi * CHUNK_SIZE, oy = cyi * CHUNK_SIZE, oz = czi * CHUNK_SIZE;
    const P = PADDED, P2 = P * P;
    out.fill(0);
    const c = this.chunks[ci];
    if (c) {
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let y = 0; y < CHUNK_SIZE; y++) {
          const src = (z << (2 * CHUNK_BITS)) | (y << CHUNK_BITS);
          out.set(c.subarray(src, src + CHUNK_SIZE), 1 + (y + 1) * P + (z + 1) * P2);
        }
    }
    // Border shell from neighbors (only where the shell is inside the volume).
    for (let z = -1; z <= CHUNK_SIZE; z++)
      for (let y = -1; y <= CHUNK_SIZE; y++) {
        const edgeYZ = z === -1 || z === CHUNK_SIZE || y === -1 || y === CHUNK_SIZE;
        const row = (y + 1) * P + (z + 1) * P2;
        if (edgeYZ) {
          for (let x = -1; x <= CHUNK_SIZE; x++) out[row + x + 1] = this.get(ox + x, oy + y, oz + z);
        } else {
          out[row] = this.get(ox - 1, oy + y, oz + z);
          out[row + P - 1] = this.get(ox + CHUNK_SIZE, oy + y, oz + z);
        }
      }
    return out;
  }

  /** Visits every solid voxel. */
  forEachSolid(fn: (x: number, y: number, z: number, v: number) => void): void {
    for (let ci = 0; ci < this.chunks.length; ci++) {
      const c = this.chunks[ci];
      if (!c) continue;
      const [cxi, cyi, czi] = this.chunkCoords(ci);
      const ox = cxi * CHUNK_SIZE, oy = cyi * CHUNK_SIZE, oz = czi * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const v = c[i]!;
        if (v !== 0) fn(ox + (i & CHUNK_MASK), oy + ((i >> CHUNK_BITS) & CHUNK_MASK), oz + (i >> (2 * CHUNK_BITS)), v);
      }
    }
  }

  /** Indices of allocated (non-empty) chunks. */
  nonEmptyChunks(): number[] {
    const out: number[] = [];
    for (let ci = 0; ci < this.chunks.length; ci++) if (this.chunks[ci]) out.push(ci);
    return out;
  }
}
