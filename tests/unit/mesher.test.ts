import { describe, expect, it } from 'vitest';
import { PADDED, PADDED_VOLUME } from '../../src/voxel/constants.ts';
import { AO_CURVE, faceAO, meshChunk } from '../../src/voxel/mesher.ts';
import { VoxelVolume } from '../../src/voxel/volume.ts';

const palette = new Uint8Array(256 * 4).fill(200);

/** Padded grid where (x,y,z) are chunk-local coordinates (the +1 border offset is applied here). */
function grid(voxels: [number, number, number, number?][]): Uint8Array {
  const d = new Uint8Array(PADDED_VOLUME);
  for (const [x, y, z, v = 1] of voxels) d[x + 1 + (y + 1) * PADDED + (z + 1) * PADDED * PADDED] = v;
  return d;
}

function boxVoxels(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v = 1): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push([x, y, z, v]);
  return out;
}

describe('greedy mesher', () => {
  it('meshes a single voxel as 6 quads', () => {
    const m = meshChunk(grid([[4, 4, 4]]), palette);
    expect(m.quads).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    expect(m.indices.length).toBe(36);
  });

  it('merges a bar and a cube into 6 quads', () => {
    expect(meshChunk(grid(boxVoxels(2, 2, 2, 9, 3, 3)), palette).quads).toBe(6);
    expect(meshChunk(grid(boxVoxels(0, 0, 0, 5, 5, 5)), palette).quads).toBe(6);
  });

  it('does not merge faces with different palette indices', () => {
    // two-color 2×1×1 bar: 4 long sides split in two, 2 end caps.
    expect(meshChunk(grid([[3, 3, 3, 1], [4, 3, 3, 2]]), palette).quads).toBe(10);
  });

  it('meshes disconnected voxels separately and culls shared faces', () => {
    expect(meshChunk(grid([[1, 1, 1], [5, 5, 5]]), palette).quads).toBe(12);
    // Hollow 3×3×3 shell with a 1-voxel cavity: 6 outer faces; the cavity has 6 inward faces.
    const shell = boxVoxels(0, 0, 0, 3, 3, 3).filter(([x, y, z]) => !(x === 1 && y === 1 && z === 1));
    expect(meshChunk(grid(shell), palette).quads).toBe(12);
  });

  it('meshes a full chunk as 6 quads and culls faces against solid neighbors', () => {
    const full = grid(boxVoxels(0, 0, 0, 32, 32, 32));
    expect(meshChunk(full, palette).quads).toBe(6);
    // Solid neighbor across the +x border.
    for (let z = 0; z < PADDED; z++) for (let y = 0; y < PADDED; y++) full[PADDED - 1 + y * PADDED + z * PADDED * PADDED] = 1;
    // The +x face is gone; AO darkens the edges touching the neighbor, so sides split into more quads.
    const m = meshChunk(full, palette);
    const normals = m.normals;
    let plusX = 0;
    for (let i = 0; i < normals.length; i += 3) if (normals[i] === 1) plusX++;
    expect(plusX).toBe(0);
  });

  it('winds quads counter-clockwise when seen from outside', () => {
    const m = meshChunk(grid([[0, 0, 0]]), palette);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!]);
      const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const v = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const ni = m.indices[t]! * 3;
      const dot = n[0]! * m.normals[ni]! + n[1]! * m.normals[ni + 1]! + n[2]! * m.normals[ni + 2]!;
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe('ambient occlusion', () => {
  it('leaves an isolated voxel fully open', () => {
    const d = grid([[5, 5, 5]]);
    for (let dir = 0; dir < 6; dir++) expect(faceAO(d, 6, 6, 6, dir)).toEqual([3, 3, 3, 3]);
  });

  it('darkens the lower corners of a side face on a floor', () => {
    // Floor 3×1×3 at y=0, one voxel on top at (1,1,1). +x face of the top voxel (padded coords +1).
    const d = grid([...boxVoxels(0, 0, 0, 3, 1, 3), [1, 1, 1]]);
    const ao = faceAO(d, 2, 2, 2, 0); // +x
    // Corner order for +x faces is (v=y, w=z): (0,0) (1,0) (1,1) (0,1). Lower corners (y offset 0) sit on the floor.
    expect(ao[0]).toBe(1);
    expect(ao[3]).toBe(1);
    expect(ao[1]).toBe(3);
    expect(ao[2]).toBe(3);
  });

  it('fully occludes a corner enclosed by two sides', () => {
    // Top face of (1,0,1) with neighbors above-left and above-front: side1 && side2 → 0.
    const d = grid([[1, 0, 1], [0, 1, 1], [1, 1, 0]]);
    const ao = faceAO(d, 2, 1, 2, 2); // +y; tangents v=z, w=x; corner (0,0) → z-1, x-1
    expect(ao[0]).toBe(0);
  });

  it('bakes AO into vertex colors', () => {
    const d = grid([...boxVoxels(0, 0, 0, 3, 1, 3), [1, 1, 1]]);
    const m = meshChunk(d, palette);
    const shades = new Set<number>();
    for (let i = 0; i < m.colors.length; i += 4) shades.add(m.colors[i]!);
    expect(shades.has(Math.floor(200 * AO_CURVE[3]))).toBe(true);
    expect([...shades].some((s) => s < 200 * AO_CURVE[2])).toBe(true);
  });
});

describe('VoxelVolume', () => {
  it('refreshes AO in all seven neighboring chunks after a corner edit', () => {
    const v = new VoxelVolume(64, 64, 64);
    for (const x of [1, 33]) for (const y of [1, 33]) for (const z of [1, 33]) v.set(x, y, z, 1);
    v.set(31, 31, 31, 1);
    v.set(32, 32, 32, 1);
    v.dirtyMesh.clear();
    v.dirtyCollider.clear();
    v.set(32, 32, 32, 0);
    expect([...v.dirtyMesh].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...v.dirtyCollider]).toEqual([7]);
    const edited = meshChunk(v.extractPadded(0), palette);
    v.set(32, 32, 32, 1);
    expect(meshChunk(v.extractPadded(0), palette).colors).not.toEqual(edited.colors);
  });

  it('stores voxels across chunks and tracks counts', () => {
    const v = new VoxelVolume(70, 40, 33);
    expect([v.cx, v.cy, v.cz]).toEqual([3, 2, 2]);
    v.set(0, 0, 0, 5);
    v.set(69, 39, 32, 7);
    expect(v.get(0, 0, 0)).toBe(5);
    expect(v.get(69, 39, 32)).toBe(7);
    expect(v.get(70, 0, 0)).toBe(0);
    expect(v.voxelCount).toBe(2);
    v.set(0, 0, 0, 0);
    expect(v.voxelCount).toBe(1);
    expect(v.chunks[0]).toBeNull();
  });

  it('marks neighbor chunks dirty for border edits', () => {
    const v = new VoxelVolume(64, 32, 32);
    v.set(33, 0, 0, 1);
    v.dirtyMesh.clear();
    v.set(32, 0, 0, 1);
    expect([...v.dirtyMesh].sort()).toEqual([1]);
    v.set(31, 0, 0, 1); // chunk 0 now allocated → border edits in chunk 1 dirty it too
    v.dirtyMesh.clear();
    v.set(32, 1, 0, 1);
    expect([...v.dirtyMesh].sort()).toEqual([0, 1]);
    v.dirtyMesh.clear();
    v.set(40, 1, 0, 1); // interior edit only dirties its own chunk
    expect([...v.dirtyMesh].sort()).toEqual([1]);
  });

  it('extracts padded chunks including neighbor borders', () => {
    const v = new VoxelVolume(64, 32, 32);
    v.set(32, 5, 6, 9); // first voxel of chunk 1 → +x border of chunk 0
    v.set(31, 5, 6, 4);
    const p = v.extractPadded(0);
    const at = (x: number, y: number, z: number) => p[x + 1 + (y + 1) * PADDED + (z + 1) * PADDED * PADDED];
    expect(at(31, 5, 6)).toBe(4);
    expect(at(32, 5, 6)).toBe(9);
    expect(at(-1, 5, 6)).toBe(0);
  });
});
