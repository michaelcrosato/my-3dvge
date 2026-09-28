import * as THREE from 'three/webgpu';
import type { MeshResult, VolumeInfo } from '../shared/protocol.ts';
import { CHUNK_SIZE, VOXEL_SIZE } from '../voxel/constants.ts';

interface ChunkView {
  mesh: THREE.Mesh;
  version: number;
}

interface ChunkData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  version: number;
}

export interface VolumeView {
  info: VolumeInfo;
  group: THREE.Group;
  /** Per-chunk meshes (large volumes only). */
  chunks: Map<number, ChunkView>;
  /** Small volumes: chunk geometry merged into one mesh (one draw call per volume). */
  merged: boolean;
  data: Map<number, ChunkData>;
  mesh: THREE.Mesh | null;
}

const CHUNK_RADIUS = (CHUNK_SIZE / 2) * Math.sqrt(3) * VOXEL_SIZE;
/** Volumes with at most this many chunks render as a single merged mesh. */
const MERGE_MAX_CHUNKS = 27;

/** Releases a mesh: its geometry and the renderer's per-object state (pipelines/bindings). */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  mesh.dispatchEvent({ type: 'dispose' });
  mesh.removeFromParent();
}

/**
 * Main-thread mirror of the simulation's volumes. Small volumes (buildings, debris, vehicles) merge their
 * chunk meshes into one mesh per volume (one draw call); huge volumes keep one mesh per chunk so
 * frustum culling and partial remeshes stay cheap. Incoming meshes are applied under a per-frame time
 * budget so large remeshes never hitch a frame.
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
  private readonly dirtyViews = new Set<VolumeView>();
  chunkMeshes = 0;
  meshesApplied = 0;

  get queued(): number {
    return this.queue.length;
  }

  /** Removes everything (engine restart). */
  clear(): void {
    for (const id of [...this.volumes.keys()]) this.removeVolume(id);
    this.queue = [];
    this.orphans.clear();
    this.removed.clear();
    this.bySlot.clear();
    this.dirtyViews.clear();
  }

  addVolume(info: VolumeInfo): void {
    const group = new THREE.Group();
    group.position.fromArray(info.position);
    group.quaternion.fromArray(info.rotation);
    if (info.kind === 'static') {
      group.matrixAutoUpdate = false;
      group.updateMatrix();
    }
    const chunkCount = Math.ceil(info.size[0] / CHUNK_SIZE) * Math.ceil(info.size[1] / CHUNK_SIZE) * Math.ceil(info.size[2] / CHUNK_SIZE);
    const view: VolumeView = { info, group, chunks: new Map(), merged: chunkCount <= MERGE_MAX_CHUNKS, data: new Map(), mesh: null };
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
    for (const c of view.chunks.values()) disposeMesh(c.mesh);
    this.chunkMeshes -= view.chunks.size;
    view.chunks.clear();
    if (view.mesh) {
      disposeMesh(view.mesh);
      this.chunkMeshes--;
      view.mesh = null;
    }
    view.data.clear();
    this.dirtyViews.delete(view);
    view.group.removeFromParent();
    this.volumes.delete(id);
    if (view.info.slot >= 0 && this.bySlot.get(view.info.slot) === view) this.bySlot.delete(view.info.slot);
  }

  enqueue(result: MeshResult): void {
    this.queue.push(result);
  }

  /** Applies queued meshes and rebuilds merged volumes until `budgetMs` is spent (always some progress). */
  processQueue(budgetMs: number): void {
    const start = performance.now();
    if (this.queue.length) {
      let i = 0;
      for (; i < this.queue.length; i++) {
        this.apply(this.queue[i]!);
        if (performance.now() - start > budgetMs * 0.6) {
          i++;
          break;
        }
      }
      this.queue = i >= this.queue.length ? [] : this.queue.slice(i);
    }
    let rebuilt = 0;
    for (const view of this.dirtyViews) {
      if (rebuilt > 0 && performance.now() - start > budgetMs) break;
      this.rebuild(view);
      this.dirtyViews.delete(view);
      rebuilt++;
    }
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
    if (view.merged) {
      const prev = view.data.get(r.chunk);
      if (prev && prev.version > r.version) return;
      if (r.indices.length === 0) view.data.delete(r.chunk);
      else view.data.set(r.chunk, { positions: r.positions, normals: r.normals, colors: r.colors, indices: r.indices, version: r.version });
      this.dirtyViews.add(view);
      this.meshesApplied++;
      return;
    }
    const existing = view.chunks.get(r.chunk);
    if (existing && existing.version > r.version) return; // stale result

    if (r.indices.length === 0) {
      if (existing) {
        disposeMesh(existing.mesh);
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
      mesh.castShadow = view.info.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      view.group.add(mesh);
      view.chunks.set(r.chunk, { mesh, version: r.version });
      this.chunkMeshes++;
    }
    this.meshesApplied++;
  }

  /** Concatenates a small volume's chunk geometry into its single mesh. */
  private rebuild(view: VolumeView): void {
    let verts = 0, idx = 0;
    for (const d of view.data.values()) {
      verts += d.positions.length / 3;
      idx += d.indices.length;
    }
    if (verts === 0) {
      if (view.mesh) {
        disposeMesh(view.mesh);
        view.mesh = null;
        this.chunkMeshes--;
      }
      return;
    }
    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const colors = new Uint8Array(verts * 4);
    const indices = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    let vo = 0, io = 0;
    for (const d of view.data.values()) {
      positions.set(d.positions, vo * 3);
      normals.set(d.normals, vo * 3);
      colors.set(d.colors, vo * 4);
      const src = d.indices;
      for (let k = 0; k < src.length; k++) indices[io + k] = src[k]! + vo;
      vo += d.positions.length / 3;
      io += src.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    const s = view.info.size;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((s[0] * VOXEL_SIZE) / 2, (s[1] * VOXEL_SIZE) / 2, (s[2] * VOXEL_SIZE) / 2), (Math.hypot(s[0], s[1], s[2]) * VOXEL_SIZE) / 2);
    if (view.mesh) {
      view.mesh.geometry.dispose();
      view.mesh.geometry = g;
    } else {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = view.info.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      view.group.add(mesh);
      view.mesh = mesh;
      this.chunkMeshes++;
    }
  }
}
