import * as THREE from 'three/webgpu';
import { BUILD_INFO } from '../config/build-info.ts';
import { QUALITY_NAMES, type Params } from '../config/params.ts';
import { QUALITY_PRESETS, defaultQuality, type QualityPreset } from '../config/quality.ts';
import { copyText } from '../debug/clipboard.ts';
import { environmentInfo, probeGpu, type GpuInfo } from '../debug/diagnostics.ts';
import { getErrors } from '../debug/error-overlay.ts';
import { FrameStats } from '../debug/frame-stats.ts';
import { Hud } from '../debug/hud.ts';
import { Controls } from '../input/controls.ts';
import { Environment } from '../render/environment.ts';
import { createRenderer, type BackendName } from '../render/renderer.ts';
import { WorldView } from '../render/world-view.ts';
import type { SimStats, SimToMain, Vec3 } from '../shared/protocol.ts';
import { installDebugHandle } from './debug-handle.ts';
import { SimHost } from './sim-host.ts';

const EYE_HEIGHT = 1.6;
/** Main-thread time budget per frame for uploading new chunk meshes. */
const MESH_UPLOAD_BUDGET_MS = 3;

/** Main-thread engine: renderer, input, camera, the world mirror and debug tooling. */
export class Engine {
  readonly params: Params;
  readonly quality: QualityPreset;
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: BackendName;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly frameStats = new FrameStats(3600);
  readonly world = new WorldView();
  readonly env: Environment;
  readonly controls: Controls;
  readonly hud: Hud;
  readonly host: SimHost;
  framesRendered = 0;
  pixelRatio = 1;
  gpuInfo: GpuInfo | null = null;
  simReady = false;
  simStats: SimStats | null = null;
  blastTarget: Vec3 = [0, 1, 0];

  private readonly flyPos = new THREE.Vector3(0, 3, 6);
  private lastFrame = 0;
  private drawCalls = 0;
  private triangles = 0;

  private constructor(params: Params, renderer: THREE.WebGPURenderer, backend: BackendName, canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.params = params;
    this.quality = QUALITY_PRESETS[params.quality ?? defaultQuality()];
    this.renderer = renderer;
    this.backend = backend;

    const q = this.quality;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, q.viewDistance);
    this.camera.rotation.order = 'YXZ';
    this.env = new Environment(this.scene, renderer, q);
    this.scene.add(this.world.root);

    this.controls = new Controls(canvas, ui);
    this.hud = new Hud(ui, () => this.hudLines(), params.debug);
    this.hud.addAction({
      label: 'Copy diagnostics',
      run: async (b) => {
        b.textContent = (await copyText(JSON.stringify(this.diagnostics(), null, 2))) ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => (b.textContent = 'Copy diagnostics'), 1500);
      },
    });
    this.hud.addAction({
      label: `Quality: ${q.name}`,
      run: () => {
        const next = QUALITY_NAMES[(QUALITY_NAMES.indexOf(q.name) + 1) % QUALITY_NAMES.length]!;
        const url = new URL(location.href);
        url.searchParams.set('quality', next);
        location.href = url.toString();
      },
    });

    this.host = new SimHost(params, null, {
      onSim: (msg) => this.onSimMessage(msg),
      onMesh: (r) => this.world.enqueue(r),
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static async create(canvas: HTMLCanvasElement, ui: HTMLElement, params: Params): Promise<Engine> {
    const { renderer, backend } = await createRenderer(canvas, params.renderer);
    const engine = new Engine(params, renderer, backend, canvas, ui);
    void probeGpu().then((info) => (engine.gpuInfo = info));
    engine.installHandle();
    return engine;
  }

  start(): void {
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private onSimMessage(msg: SimToMain): void {
    switch (msg.type) {
      case 'ready':
        this.simReady = true;
        this.blastTarget = msg.blastTarget;
        this.flyPos.set(msg.spawn[0], msg.spawn[1] + EYE_HEIGHT, msg.spawn[2]);
        this.controls.yaw = msg.spawnYaw;
        break;
      case 'volumeAdded':
        this.world.addVolume(msg.volume);
        break;
      case 'volumeRemoved':
        this.world.removeVolume(msg.id);
        break;
      case 'stats':
        this.simStats = msg.stats;
        break;
      default:
        break;
    }
  }

  private installHandle(): void {
    const engine = this;
    installDebugHandle({
      get ready() {
        return engine.simReady && engine.framesRendered > 0;
      },
      get framesRendered() {
        return engine.framesRendered;
      },
      get bodyCount() {
        return engine.simStats?.dynamicBodies ?? 0;
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

  private updateFlyCamera(dt: number): void {
    const c = this.controls;
    const [sx, fz] = c.moveVector();
    const speed = c.sprint() ? 16 : 6;
    const cp = Math.cos(c.pitch);
    const fwd = new THREE.Vector3(-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    this.flyPos.addScaledVector(fwd, fz * speed * dt).addScaledVector(right, sx * speed * dt);
    this.flyPos.y += c.vertical() * speed * dt;
    this.camera.position.copy(this.flyPos);
    this.camera.rotation.set(c.pitch, c.yaw, 0);
  }

  private frame(time: number): void {
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    if (this.framesRendered > 0) this.frameStats.push(time - this.lastFrame);
    this.lastFrame = time;

    this.world.processQueue(MESH_UPLOAD_BUDGET_MS);
    this.updateFlyCamera(dt);
    this.env.follow(this.camera.position);

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
      chunkMeshes: this.world.chunkMeshes,
      meshQueue: this.world.queued,
      sim: this.simStats,
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
    const sim = this.simStats;
    const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
      `FPS ${avg > 0 ? (1000 / avg).toFixed(0) : '--'}  frame ${avg.toFixed(1)}ms  p95 ${s.p95.toFixed(1)}  sim ${sim ? sim.stepMs.toFixed(2) : '--'}ms`,
      `bodies ${sim?.bodiesActive ?? 0} active / ${sim?.bodiesSleeping ?? 0} sleeping  voxels ${k(sim?.voxels ?? 0)}`,
      `draw ${this.drawCalls}  tris ${k(this.triangles)}  chunks ${this.world.chunkMeshes}  queue ${this.world.queued}/${sim?.meshJobs ?? 0}`,
      `${this.backend}  COI ${window.crossOriginIsolated ? 'yes' : 'NO'}  quality ${this.quality.name}  px ${this.pixelRatio.toFixed(2)}`,
      `build ${BUILD_INFO.shortSha}  ${BUILD_INFO.time.replace('T', ' ').slice(0, 16)}Z`,
    ];
  }
}
