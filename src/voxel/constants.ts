/** Edge length of one voxel in meters. */
export const VOXEL_SIZE = 0.1;
export const CHUNK_BITS = 5;
/** Chunks are CHUNK_SIZE³ voxels, one byte (palette index) each. */
export const CHUNK_SIZE = 1 << CHUNK_BITS;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
/** Mesher input: a chunk plus a one-voxel border copied from its neighbors. */
export const PADDED = CHUNK_SIZE + 2;
export const PADDED_VOLUME = PADDED * PADDED * PADDED;
