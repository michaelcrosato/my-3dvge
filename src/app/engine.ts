import * as THREE from 'three/webgpu';
import { BUILD_INFO } from '../config/build-info.ts';
import type { Params } from '../config/params.ts';
import { QUALITY_PRESETS, defaultQuality, type QualityPreset } from '../config/quality.ts';
import { copyText } from '../debug/clipboard.ts';
import { environmentInfo, probeGpu, type GpuInfo } from '../debug/diagnostics.ts';
import { getErrors } from '../debug/error-overlay.ts';
import { FrameStats } from '../debug/frame-stats.ts';
import { Hud } from '../debug/hud.ts';
import { createRenderer, type BackendName } from '../render/renderer.ts';
import { installDebugHandle } from './debug-handle.ts';

const SKY = 0x9fb8cf;

/** Main-thread engine: owns the renderer, the frame loop and the debug tooling. */
export class Engine {
  readonly params: Params;
  readonly quality: QualityPreset;
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: BackendName;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly frameStats = new FrameStats(3600);
  readonly hud: Hud;
  framesRendered = 0;
  pixelRatio = 1;
  gpuInfo: GpuInfo | null = null;

  private readonly sun: THREE.DirectionalLight;
  private readonly cube: THREE.Mesh;
  private lastFrame = 0;
  private drawCalls = 0;
  private triangles = 0;

  private constructor(params: Params, renderer: THREE.WebGPURenderer, backend: BackendName, ui: HTMLElement) {
    this.params = params;
    this.quality = QUALITY_PRESETS[params.quality ?? defaultQuality()];
    this.renderer = renderer;
    this.backend = backend;

    const q = this.quality;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, q.viewDistance);
    this.camera.position.set(3, 2.2, 4);
    this.camera.lookAt(0, 0.6, 0);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, q.viewDistance * 0.45, q.viewDistance);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a4a3a, 1.2));

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.position.set(12, 20, 8);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -q.shadowExtent;
    sc.right = sc.top = q.shadowExtent;
    sc.near = 0.5;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    renderer.shadowMap.enabled = q.shadows;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0x6b7f4e }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xd9822b }));
    this.cube.position.y = 0.9;
    this.cube.castShadow = true;
    this.cube.receiveShadow = true;
    this.scene.add(this.cube);

    this.hud = new Hud(ui, () => this.hudLines(), params.debug);
    this.hud.addAction({
      label: 'Copy diagnostics',
      run: async (b) => {
        b.textContent = (await copyText(JSON.stringify(this.diagnostics(), null, 2))) ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => (b.textContent = 'Copy diagnostics'), 1500);
      },
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static async create(canvas: HTMLCanvasElement, ui: HTMLElement, params: Params): Promise<Engine> {
    const { renderer, backend } = await createRenderer(canvas, params.renderer);
    const engine = new Engine(params, renderer, backend, ui);
    void probeGpu().then((info) => (engine.gpuInfo = info));
    engine.installHandle();
    return engine;
  }

  start(): void {
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private installHandle(): void {
    const engine = this;
    installDebugHandle({
      get ready() {
        return engine.framesRendered > 0;
      },
      get framesRendered() {
        return engine.framesRendered;
      },
      get bodyCount() {
        return 0;
      },
      get renderer() {
        return engine.backend;
      },
      stats: () => this.statsSnapshot(),
      triggerBlast: async () => 0,
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(time: number): void {
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    if (this.framesRendered > 0) this.frameStats.push(time - this.lastFrame);
    this.lastFrame = time;

    this.cube.rotation.x += dt * 0.7;
    this.cube.rotation.y += dt * 1.1;

    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.drawCalls = info.drawCalls;
    this.triangles = info.triangles;
    this.framesRendered++;
    this.hud.update(time);
  }

  statsSnapshot(): Record<string, unknown> {
    const s = this.frameStats.summary(600);
    return {
      framesRendered: this.framesRendered,
      fps: s.avg > 0 ? 1000 / s.avg : 0,
      frameMs: s,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      pixelRatio: this.pixelRatio,
    };
  }

  diagnostics(): Record<string, unknown> {
    return {
      build: BUILD_INFO,
      renderer: this.backend,
      quality: this.quality,
      params: this.params,
      environment: environmentInfo(),
      gpu: this.gpuInfo,
      stats: this.statsSnapshot(),
      recentFrameMs: Array.from(this.frameStats.recent(120), (v) => Math.round(v * 100) / 100),
      errors: getErrors(),
    };
  }

  private hudLines(): string[] {
    const avg = this.frameStats.average(60);
    const s = this.frameStats.summary(240);
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
      `FPS ${avg > 0 ? (1000 / avg).toFixed(0) : '--'}  frame ${avg.toFixed(1)}ms  p95 ${s.p95.toFixed(1)}  sim --`,
      `bodies 0 active / 0 sleeping  voxels 0`,
      `draw ${this.drawCalls}  tris ${k(this.triangles)}`,
      `${this.backend}  COI ${window.crossOriginIsolated ? 'yes' : 'NO'}  quality ${this.quality.name}  px ${this.pixelRatio.toFixed(2)}`,
      `build ${BUILD_INFO.shortSha}  ${BUILD_INFO.time.replace('T', ' ').slice(0, 16)}Z`,
    ];
  }
}
