import * as THREE from 'three/webgpu';
import type { GroundDesc } from '../shared/protocol.ts';

/**
 * Renders GroundDesc terrain: every slab is a box whose top samples the level's color map (nearest
 * filtering keeps the crisp voxel-art look); sides are darkened. Water planes are flat blue quads.
 */
export class GroundView {
  readonly root = new THREE.Group();
  private texture: THREE.DataTexture | null = null;

  clear(): void {
    for (const child of [...this.root.children]) {
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
      this.root.remove(child);
    }
    this.texture?.dispose();
    this.texture = null;
  }

  set(g: GroundDesc): void {
    this.clear();
    const tex = new THREE.DataTexture(g.map.data, g.map.width, g.map.height, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.texture = tex;

    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const u = (x: number) => (x - g.x0) / (g.x1 - g.x0);
    const v = (z: number) => (z - g.z0) / (g.z1 - g.z0);
    const quad = (pts: number[][], n: number[], shade: number) => {
      const base = pos.length / 3;
      for (const p of pts) {
        pos.push(p[0]!, p[1]!, p[2]!);
        nrm.push(n[0]!, n[1]!, n[2]!);
        uv.push(u(p[0]!), v(p[2]!));
        col.push(shade, shade, shade);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const s of g.slabs) {
      const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
      const y = s.y, b = s.y - (s.depth ?? 2);
      quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, 1, 0], 1);
      quad([[x0, b, z1], [x1, b, z1], [x1, y, z1], [x0, y, z1]], [0, 0, 1], 0.62);
      quad([[x1, b, z0], [x0, b, z0], [x0, y, z0], [x1, y, z0]], [0, 0, -1], 0.62);
      quad([[x1, b, z1], [x1, b, z0], [x1, y, z0], [x1, y, z1]], [1, 0, 0], 0.7);
      quad([[x0, b, z0], [x0, b, z1], [x0, y, z1], [x0, y, z0]], [-1, 0, 0], 0.7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);

    for (const w of g.water ?? []) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.abs(w.x1 - w.x0), Math.abs(w.z1 - w.z0)),
        new THREE.MeshLambertMaterial({ color: 0x3f7fa8 }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2);
      plane.receiveShadow = true;
      this.root.add(plane);
    }
  }
}
