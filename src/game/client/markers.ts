/**
 * Cheap in-world markers drawn as InstancedMeshes (one draw call each): RDU lamps (dark → lit), waiting
 * survivors (bobbing and waving), and a translucent damage-zone box for the controlled vehicle.
 */
import * as THREE from 'three/webgpu';
import { meshChunk } from '../../voxel/mesher.ts';
import { Palette } from '../../voxel/palette.ts';
import type { VoxelVolume } from '../../voxel/volume.ts';
import type { GameSnapshot, LevelStatic } from '../shared/types.ts';
import { buildProp, createArtKit } from '../sim/art/index.ts';

function geometryOf(model: VoxelVolume, palette: Palette): THREE.BufferGeometry {
  const m = meshChunk(model.extractPadded(0), palette.colors);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 4, true));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.translate((-model.sizeX * 0.1) / 2, 0, (-model.sizeZ * 0.1) / 2);
  g.computeBoundingSphere();
  return g;
}

export class Markers {
  readonly root = new THREE.Group();
  private rduOff: THREE.InstancedMesh | null = null;
  private rduOn: THREE.InstancedMesh | null = null;
  private survivors: THREE.InstancedMesh;
  private readonly zone: THREE.Mesh;
  private rdus: [number, number, number][] = [];
  private lit = new Set<number>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly palette = new Palette();
  private t = 0;
  private dirty = true;

  constructor() {
    const kit = createArtKit(this.palette, () => 0.5);
    this.survivors = new THREE.InstancedMesh(geometryOf(buildProp('survivor', kit), this.palette), this.material, 16);
    this.survivors.count = 0;
    this.survivors.frustumCulled = false;
    this.survivors.castShadow = true;
    this.zone = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.22, depthWrite: false }));
    this.zone.visible = false;
    this.root.add(this.survivors, this.zone);
  }

  setLevel(level: LevelStatic): void {
    this.rduOff?.removeFromParent();
    this.rduOn?.removeFromParent();
    this.rdus = level.rdus ?? [];
    this.lit.clear();
    const kit = createArtKit(this.palette, () => 0.5);
    const n = Math.max(1, this.rdus.length);
    this.rduOff = new THREE.InstancedMesh(geometryOf(buildProp('rduOff', kit), this.palette), this.material, n);
    this.rduOn = new THREE.InstancedMesh(geometryOf(buildProp('rduOn', kit), this.palette), this.material, n);
    for (const mesh of [this.rduOff, this.rduOn]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.root.add(mesh);
    }
    this.dirty = true;
  }

  lightRdu(index: number): void {
    if (!this.lit.has(index)) {
      this.lit.add(index);
      this.dirty = true;
    }
  }

  update(snap: GameSnapshot | null, dt: number): void {
    this.t += dt;
    if (snap?.litRdus && snap.litRdus.length !== this.lit.size) {
      for (const i of snap.litRdus) this.lit.add(i);
      this.dirty = true;
    }
    if (this.dirty && this.rduOff && this.rduOn) {
      this.dirty = false;
      let off = 0, on = 0;
      this.rdus.forEach((r, i) => {
        this.m.makeTranslation(r[0], r[1], r[2]);
        if (this.lit.has(i)) this.rduOn!.setMatrixAt(on++, this.m);
        else this.rduOff!.setMatrixAt(off++, this.m);
      });
      this.rduOff.count = off;
      this.rduOn.count = on;
      this.rduOff.instanceMatrix.needsUpdate = true;
      this.rduOn.instanceMatrix.needsUpdate = true;
    }
    const waiting = (snap?.survivorsAll ?? []).filter((s) => s.state === 'waiting');
    waiting.forEach((s, i) => {
      const bob = Math.abs(Math.sin(this.t * 6 + i)) * 0.25;
      this.q.setFromEuler(this.e.set(0, this.t * 1.5 + i, Math.sin(this.t * 8 + i) * 0.15));
      this.m.compose(this.p.set(s.x, s.y + bob, s.z), this.q, this.s);
      this.survivors.setMatrixAt(i, this.m);
    });
    this.survivors.count = Math.min(16, waiting.length);
    this.survivors.instanceMatrix.needsUpdate = true;
    const z = snap?.zone;
    this.zone.visible = !!z;
    if (z) {
      this.zone.position.set(z.center[0], z.center[1], z.center[2]);
      this.zone.scale.set(z.half[0] * 2, z.half[1] * 2, z.half[2] * 2);
      this.zone.rotation.set(0, z.yaw, 0);
    }
  }
}
