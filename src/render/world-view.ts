import * as THREE from 'three/webgpu';
import type { MeshResult, VolumeInfo } from '../shared/protocol.ts';
import { CHUNK_SIZE, VOXEL_SIZE } from '../voxel/constants.ts';

interface ChunkView {
  mesh: THREE.Mesh;
  version: number;
}

export interface VolumeView {
  info: VolumeInfo;
  group: THREE.Group;
  chunks: Map<number, ChunkView>;
}

const CHUNK_RADIUS = (CHUNK_SIZE / 2) * Math.sqrt(3) * VOXEL_SIZE;

/**
 * Main-thread mirror of the simulation's volumes: one Group per volume, one Mesh per non-empty chunk.
 * Incoming meshes are applied under a per-frame time budget so large remeshes never hitch a frame.
 */
export class WorldView {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly volumes = new Map<number, VolumeView>();
  /** Dynamic volume views indexed by transform slot. */
  readonly bySlot = new Map<number, VolumeView>();
  private queue: MeshResult[] = [];
  private readonly orphans = new Map<number, MeshResult[]>();
  private readonly removed = new Set<number>();
  chunkMeshes = 0;
  meshesApplied = 0;

  get queued(): number {
    return this.queue.length;
  }

  addVolume(info: VolumeInfo): void {
    const group = new THREE.Group();
    group.position.fromArray(info.position);
    group.quaternion.fromArray(info.rotation);
    if (info.kind === 'static') {
      group.matrixAutoUpdate = false;
      group.updateMatrix();
    }
    const view: VolumeView = { info, group, chunks: new Map() };
    this.volumes.set(info.id, view);
    if (info.slot >= 0) this.bySlot.set(info.slot, view);
    this.root.add(group);
    const waiting = this.orphans.get(info.id);
    if (waiting) {
      this.orphans.delete(info.id);
      this.queue.push(...waiting);
    }
  }

  removeVolume(id: number): void {
    this.removed.add(id);
    this.orphans.delete(id);
    const view = this.volumes.get(id);
    if (!view) return;
    for (const c of view.chunks.values()) c.mesh.geometry.dispose();
    this.chunkMeshes -= view.chunks.size;
    view.group.removeFromParent();
    this.volumes.delete(id);
    if (view.info.slot >= 0 && this.bySlot.get(view.info.slot) === view) this.bySlot.delete(view.info.slot);
  }

  enqueue(result: MeshResult): void {
    this.queue.push(result);
  }

  /** Applies queued meshes until `budgetMs` is spent (always at least one). */
  processQueue(budgetMs: number): void {
    if (this.queue.length === 0) return;
    const start = performance.now();
    let i = 0;
    for (; i < this.queue.length; i++) {
      this.apply(this.queue[i]!);
      if (performance.now() - start > budgetMs) {
        i++;
        break;
      }
    }
    this.queue = i >= this.queue.length ? [] : this.queue.slice(i);
  }

  private apply(r: MeshResult): void {
    const view = this.volumes.get(r.volumeId);
    if (!view) {
      if (this.removed.has(r.volumeId)) return;
      const list = this.orphans.get(r.volumeId) ?? [];
      list.push(r);
      this.orphans.set(r.volumeId, list);
      return;
    }
    const existing = view.chunks.get(r.chunk);
    if (existing && existing.version > r.version) return; // stale result

    if (r.indices.length === 0) {
      if (existing) {
        existing.mesh.geometry.dispose();
        existing.mesh.removeFromParent();
        view.chunks.delete(r.chunk);
        this.chunkMeshes--;
      }
      return;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(r.colors, 4, true));
    g.setIndex(new THREE.BufferAttribute(r.indices, 1));
    const half = (CHUNK_SIZE / 2) * VOXEL_SIZE;
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(r.origin[0] * VOXEL_SIZE + half, r.origin[1] * VOXEL_SIZE + half, r.origin[2] * VOXEL_SIZE + half),
      CHUNK_RADIUS,
    );

    if (existing) {
      existing.mesh.geometry.dispose();
      existing.mesh.geometry = g;
      existing.version = r.version;
    } else {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      view.group.add(mesh);
      view.chunks.set(r.chunk, { mesh, version: r.version });
      this.chunkMeshes++;
    }
    this.meshesApplied++;
  }
}
