import * as THREE from 'three/webgpu';
import type { QualityPreset } from '../config/quality.ts';

export const SKY_COLOR = 0x9fb8cf;

/** Sky, fog, hemisphere fill and a single shadow-casting sun whose shadow box follows the viewer. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly dir = new THREE.Vector3(0.45, 1, 0.3).normalize();
  private readonly texel: number;

  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer, q: QualityPreset) {
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.Fog(SKY_COLOR, q.viewDistance * 0.4, q.viewDistance);
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6a5a48, 1.35));

    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.1);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -q.shadowExtent;
    cam.right = cam.top = q.shadowExtent;
    cam.near = 1;
    cam.far = 120;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    renderer.shadowMap.enabled = q.shadows;
    this.texel = (2 * q.shadowExtent) / q.shadowMapSize;
  }

  /** Centers the shadow box on `focus`, snapped to shadow texels to limit shimmering. */
  follow(focus: THREE.Vector3): void {
    const t = this.texel * 2;
    const x = Math.round(focus.x / t) * t;
    const z = Math.round(focus.z / t) * t;
    const y = Math.round(focus.y / t) * t;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.dir.x * 50, y + this.dir.y * 50, z + this.dir.z * 50);
    this.sun.target.updateMatrixWorld();
  }
}
