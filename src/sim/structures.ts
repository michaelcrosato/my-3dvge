/**
 * Structures: static volumes with integrity. Carving and impact damage wear a structure down; past its
 * collapse threshold it fractures into physics debris chunks (which crumble to dust after a while) with a
 * dust cloud — the "building goes down" moment of a demolition game.
 */
import type { Vec3 } from '../shared/protocol.ts';
import { add, quatRotate, scale } from '../shared/math.ts';
import { VOXEL_SIZE } from '../voxel/constants.ts';
import { VoxelVolume } from '../voxel/volume.ts';
import { PARTICLE_DEBRIS, type SimWorld } from './world.ts';

export interface StructureDef {
  name?: string;
  /** Fraction of the original voxels' worth of damage that brings it down (default 0.3). */
  collapseAt?: number;
  /** Target number of physics chunks when it collapses (default 10). */
  fragments?: number;
  /** Seconds the collapse debris lives before crumbling to dust (default 7). */
  debrisLifetime?: number;
  userData?: unknown;
}

export interface Structure {
  volumeId: number;
  def: StructureDef;
  /** Voxels at registration. */
  total: number;
  /** Accumulated damage in voxel-equivalents. */
  damage: number;
  collapsed: boolean;
  /** World center and XZ footprint at registration. */
  center: Vec3;
  footprint: { x0: number; z0: number; x1: number; z1: number };
}

export class Structures {
  readonly byVolume = new Map<number, Structure>();
  private readonly world: SimWorld;
  private readonly collapseListeners: ((s: Structure) => void)[] = [];
  private readonly damageListeners: ((s: Structure, amount: number) => void)[] = [];

  constructor(world: SimWorld) {
    this.world = world;
    world.on('carved', (sv, n) => {
      const s = this.byVolume.get(sv.id);
      if (s) this.damage(s, n);
    });
  }

  register(volumeId: number, def: StructureDef = {}): Structure {
    const sv = this.world.volumes.get(volumeId);
    if (!sv) throw new Error(`register structure: unknown volume ${volumeId}`);
    const v = sv.volume;
    const { pos, rot } = this.world.volumePose(sv);
    const corners = [0, 1].flatMap((i) => [0, 1].map((k) => add(pos, quatRotate(rot, [i * v.sizeX * VOXEL_SIZE, 0, k * v.sizeZ * VOXEL_SIZE]))));
    const s: Structure = {
      volumeId,
      def,
      total: Math.max(1, v.voxelCount),
      damage: 0,
      collapsed: false,
      center: add(pos, quatRotate(rot, [(v.sizeX * VOXEL_SIZE) / 2, (v.sizeY * VOXEL_SIZE) / 2, (v.sizeZ * VOXEL_SIZE) / 2])),
      footprint: {
        x0: Math.min(...corners.map((c) => c[0])),
        z0: Math.min(...corners.map((c) => c[2])),
        x1: Math.max(...corners.map((c) => c[0])),
        z1: Math.max(...corners.map((c) => c[2])),
      },
    };
    this.byVolume.set(volumeId, s);
    return s;
  }

  onCollapse(fn: (s: Structure) => void): void {
    this.collapseListeners.push(fn);
  }

  onDamage(fn: (s: Structure, amount: number) => void): void {
    this.damageListeners.push(fn);
  }

  /** 0 = intact, 1 = at the collapse threshold. */
  integrityLoss(s: Structure): number {
    return Math.min(1, s.damage / (s.total * (s.def.collapseAt ?? 0.3)));
  }

  /** Adds damage (voxel-equivalents); collapses the structure past its threshold. */
  damage(target: Structure | number, amount: number): void {
    const s = typeof target === 'number' ? this.byVolume.get(target) : target;
    if (!s || s.collapsed || amount <= 0) return;
    s.damage += amount;
    for (const fn of this.damageListeners) fn(s, amount);
    if (s.damage >= s.total * (s.def.collapseAt ?? 0.3)) this.collapse(s);
  }

  /** Fractures the structure into debris chunks and removes it. */
  collapse(s: Structure): void {
    if (s.collapsed) return;
    s.collapsed = true;
    const world = this.world;
    const sv = world.volumes.get(s.volumeId);
    if (sv) {
      const vol = sv.volume;
      const { pos, rot } = world.volumePose(sv);
      const fragments = s.def.fragments ?? 10;
      const lifetime = s.def.debrisLifetime ?? 7;
      const maxDim = Math.max(vol.sizeX, vol.sizeY, vol.sizeZ);
      const cell = Math.max(10, Math.ceil(maxDim / Math.cbrt(fragments)));
      const ncx = Math.ceil(vol.sizeX / cell), ncy = Math.ceil(vol.sizeY / cell);
      const buckets = new Map<number, number[]>();
      vol.forEachSolid((x, y, z) => {
        const key = Math.floor(x / cell) + ncx * (Math.floor(y / cell) + ncy * Math.floor(z / cell));
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push(x, y, z);
      });
      const mid: Vec3 = [vol.sizeX / 2, 0, vol.sizeZ / 2];
      for (const coords of buckets.values()) {
        const n = coords.length / 3;
        if (n < 24) {
          for (let i = 0; i < coords.length && i < 18; i += 3) {
            const v = vol.get(coords[i]!, coords[i + 1]!, coords[i + 2]!);
            const p = add(pos, quatRotate(rot, [(coords[i]! + 0.5) * VOXEL_SIZE, (coords[i + 1]! + 0.5) * VOXEL_SIZE, (coords[i + 2]! + 0.5) * VOXEL_SIZE]));
            const c = world.palette.colors;
            world.emitParticle(p, [(world.random() - 0.5) * 3, world.random() * 2, (world.random() - 0.5) * 3], [c[v * 4]! / 255, c[v * 4 + 1]! / 255, c[v * 4 + 2]! / 255], PARTICLE_DEBRIS);
          }
          continue;
        }
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < coords.length; i += 3) {
          x0 = Math.min(x0, coords[i]!); x1 = Math.max(x1, coords[i]!);
          y0 = Math.min(y0, coords[i + 1]!); y1 = Math.max(y1, coords[i + 1]!);
          z0 = Math.min(z0, coords[i + 2]!); z1 = Math.max(z1, coords[i + 2]!);
        }
        const piece = new VoxelVolume(x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1);
        for (let i = 0; i < coords.length; i += 3) piece.set(coords[i]! - x0, coords[i + 1]! - y0, coords[i + 2]! - z0, vol.get(coords[i]!, coords[i + 1]!, coords[i + 2]!));
        const cellMid: Vec3 = [(x0 + x1) / 2 - mid[0], 0, (z0 + z1) / 2 - mid[2]];
        const len = Math.hypot(cellMid[0], cellMid[2]) || 1;
        const outward = 0.6 + world.random() * 1.6;
        const lin = quatRotate(rot, [(cellMid[0] / len) * outward, -0.5 + world.random() * 1.5, (cellMid[2] / len) * outward]);
        const ang: Vec3 = [(world.random() - 0.5) * 2, (world.random() - 0.5) * 1.5, (world.random() - 0.5) * 2];
        world.addVolume('dynamic', piece, add(pos, quatRotate(rot, scale([x0, y0, z0], VOXEL_SIZE))), rot, 'debris', {
          velocity: { lin, ang },
          lifetime: lifetime + world.random() * 3,
        });
      }
      const fp = s.footprint;
      const spread = Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0) / 2;
      world.emitSmoke([(fp.x0 + fp.x1) / 2, pos[1] + 0.8, (fp.z0 + fp.z1) / 2], Math.min(40, 14 + Math.round(spread * 3)), spread);
      world.removeVolume(s.volumeId);
    }
    for (const fn of this.collapseListeners) fn(s);
  }

  /** Structures still standing. */
  standing(): Structure[] {
    return [...this.byVolume.values()].filter((s) => !s.collapsed);
  }
}
