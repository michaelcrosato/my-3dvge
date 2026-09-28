import type { Quat, Vec3 } from '../../shared/protocol.ts';
import { quatRotate } from '../../shared/math.ts';
import { VOXEL_SIZE } from '../../voxel/constants.ts';

export const VS = VOXEL_SIZE;

/** Rotation about +y. Yaw 0 faces -z; yaw -π/2 faces +x. */
export function yawQuat(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Heading yaw of a rotation (same convention as yawQuat and the camera). */
export function yawOf(q: Quat): number {
  const f = quatRotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
}

/** Heading yaw of a direction in the XZ plane. */
export function yawOfDir(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Pose for a model of `size` voxels whose footprint center sits at (x, z) with its base at y, rotated by
 * `yaw` (models face -z unrotated). Returns the voxel-grid origin position and rotation.
 */
export function placeModel(size: readonly [number, number, number], x: number, y: number, z: number, yaw = 0): { pos: Vec3; rot: Quat } {
  const rot = yawQuat(yaw);
  const c = quatRotate(rot, [(size[0] * VS) / 2, 0, (size[2] * VS) / 2]);
  return { pos: [x - c[0], y, z - c[2]], rot };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}
