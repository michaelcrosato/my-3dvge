import * as THREE from 'three/webgpu';
import { BUILD_INFO } from '../config/build-info.ts';
import { QUALITY_NAMES, type Params } from '../config/params.ts';
import { QUALITY_PRESETS, defaultQuality, type QualityPreset } from '../config/quality.ts';
import { copyText } from '../debug/clipboard.ts';
import { environmentInfo, probeGpu, type GpuInfo } from '../debug/diagnostics.ts';
import { getErrors } from '../debug/error-overlay.ts';
import { FrameStats } from '../debug/frame-stats.ts';
import { Hud } from '../debug/hud.ts';
import { createTuningPanel } from '../debug/tuning-panel.ts';
import { Controls, type Action } from '../input/controls.ts';
import { Environment } from '../render/environment.ts';
import { Particles } from '../render/particles.ts';
import { createRenderer, type BackendName } from '../render/renderer.ts';
import { WorldView } from '../render/world-view.ts';
import type { PlayerInput, SimSettings, SimStats, SimToMain, Vec3 } from '../shared/protocol.ts';
import { MAX_SLOTS, PLAYER_SLOT, TransformReader, interpolateSlot, transformBufferBytes } from '../shared/transforms.ts';
import { installDebugHandle } from './debug-handle.ts';
import { SimHost } from './sim-host.ts';

/** Eye height above the player capsule's center (center is 0.9 m above the feet). */
const EYE_OFFSET = 0.7;
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
  readonly particles = new Particles();
  readonly env: Environment;
  readonly controls: Controls;
  readonly hud: Hud;
  readonly host: SimHost;
  readonly transforms: TransformReader;
  readonly sharedTransforms: boolean;
  framesRendered = 0;
  pixelRatio = 1;
  gpuInfo: GpuInfo | null = null;
  simReady = false;
  simStats: SimStats | null = null;
  blastTarget: Vec3 = [0, 1, 0];
  fly: boolean;
  settings: SimSettings | null = null;

  private readonly pendingBlasts = new Map<number, (newBodies: number) => void>();
  private nextBlastId = 1;
  private tuning: HTMLElement | null = null;
  private readonly ui: HTMLElement;
  private readonly flyPos = new THREE.Vector3(0, 3, 6);
  private readonly playerPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private lastFrame = 0;
  private drawCalls = 0;
  private triangles = 0;

  private constructor(params: Params, renderer: THREE.WebGPURenderer, backend: BackendName, canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.params = params;
    this.quality = QUALITY_PRESETS[params.quality ?? defaultQuality()];
    this.renderer = renderer;
    this.backend = backend;
    this.fly = params.fly;

    const q = this.quality;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, q.viewDistance);
    this.camera.rotation.order = 'YXZ';
    this.env = new Environment(this.scene, renderer, q);
    this.scene.add(this.world.root, this.particles.mesh);
    this.ui = ui;

    this.controls = new Controls(canvas, ui);
    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';
    ui.append(crosshair);
    this.addTouchButtons();

    this.hud = new Hud(ui, () => this.hudLines(), params.debug);
    this.hud.addAction({
      label: 'Copy diagnostics',
      run: async (b) => {
        b.textContent = (await copyText(JSON.stringify(this.diagnostics(), null, 2))) ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => (b.textContent = 'Copy diagnostics'), 1500);
      },
    });
    this.hud.addAction({
      label: 'Tuning',
      run: () => {
        if (this.tuning) this.tuning.hidden = !this.tuning.hidden;
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

    const shared = window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(transformBufferBytes(MAX_SLOTS)) : null;
    this.sharedTransforms = shared !== null;
    this.transforms = new TransformReader(shared, MAX_SLOTS);
    this.host = new SimHost(params, shared, {
      onSim: (msg) => this.onSimMessage(msg),
      onMesh: (r) => this.world.enqueue(r),
    });
    document.addEventListener('visibilitychange', () => this.host.send({ type: 'pause', paused: document.hidden }));

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

  protected addTouchButtons(): void {
    this.controls.addTouchButton('Crate', { action: 'spawn' });
    this.controls.addTouchButton('Blast', { action: 'blast', className: 'primary' });
    this.controls.addTouchButton('Fly', { action: 'toggleFly' });
    this.controls.addTouchButton('Jump', { hold: 'jump' });
  }

  private onSimMessage(msg: SimToMain): void {
    switch (msg.type) {
      case 'ready':
        this.simReady = true;
        this.blastTarget = msg.blastTarget;
        this.flyPos.set(msg.spawn[0], msg.spawn[1] + 1.6, msg.spawn[2]);
        this.controls.yaw = msg.spawnYaw;
        this.settings = msg.settings;
        this.tuning = createTuningPanel(this.ui, msg.settings, this.quality.name, (patch) => {
          Object.assign(this.settings!, patch);
          this.host.send({ type: 'settings', settings: patch });
        }).domElement.parentElement;
        if (this.tuning) this.tuning.hidden = !this.params.debug;
        break;
      case 'particles':
        this.particles.spawn(msg.data);
        break;
      case 'blastDone':
        this.pendingBlasts.get(msg.id)?.(msg.newBodies);
        this.pendingBlasts.delete(msg.id);
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
      case 'frame':
        this.transforms.push(msg.frame, msg.time, msg.transforms);
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
      triggerBlast: (pos, radius, power) => this.blastAt(pos ?? this.blastTarget, undefined, radius, power),
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

  /** Unit vector the camera looks along. */
  viewDir(): Vec3 {
    const c = this.controls;
    const cp = Math.cos(c.pitch);
    return [-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp];
  }

  /** Blasts at `origin`, or along `dir` from it (raycast in the worker). Resolves to new body count. */
  blastAt(origin: Vec3, dir?: Vec3, radius?: number, power?: number): Promise<number> {
    const id = this.nextBlastId++;
    return new Promise((resolve) => {
      this.pendingBlasts.set(id, resolve);
      this.host.send({ type: 'blast', id, origin, dir, radius, power });
    });
  }

  protected handleAction(a: Action): void {
    const origin: Vec3 = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    if (a === 'blast') void this.blastAt(origin, this.viewDir());
    else if (a === 'spawn') this.host.send({ type: 'spawnCrate', origin, dir: this.viewDir() });
    else if (a === 'toggleFly') {
      this.fly = !this.fly;
      if (this.fly) this.flyPos.copy(this.camera.position);
    }
  }

  private updateInput(dt: number): void {
    const c = this.controls;
    for (const a of c.takeActions()) this.handleAction(a);
    const input: PlayerInput = {
      move: this.fly ? [0, 0] : c.moveVector(),
      yaw: c.yaw,
      pitch: c.pitch,
      jump: !this.fly && c.jumpHeld(),
      sprint: c.sprint(),
      fly: this.fly,
      vertical: c.vertical(),
    };
    this.host.send({ type: 'input', input });

    if (this.fly) {
      const [sx, fz] = c.moveVector();
      const speed = c.sprint() ? 16 : 6;
      const [dx, dy, dz] = this.viewDir();
      this.flyPos.x += (dx * fz + Math.cos(c.yaw) * sx) * speed * dt;
      this.flyPos.y += (dy * fz + c.vertical()) * speed * dt;
      this.flyPos.z += (dz * fz - Math.sin(c.yaw) * sx) * speed * dt;
    }
  }

  private applyTransforms(): void {
    const sample = this.transforms.sample();
    if (sample) {
      for (const [slot, view] of this.world.bySlot) interpolateSlot(sample, slot, view.group.position, view.group.quaternion);
      interpolateSlot(sample, PLAYER_SLOT, this.playerPos, this.tmpQuat);
    }
    if (this.fly || !sample) this.camera.position.copy(this.flyPos);
    else this.camera.position.set(this.playerPos.x, this.playerPos.y + EYE_OFFSET, this.playerPos.z);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0);
  }

  private frame(time: number): void {
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    if (this.framesRendered > 0) this.frameStats.push(time - this.lastFrame);
    this.lastFrame = time;

    this.world.processQueue(MESH_UPLOAD_BUDGET_MS);
    this.updateInput(dt);
    this.applyTransforms();
    this.particles.update(dt);
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
      sharedTransforms: this.sharedTransforms,
      mode: this.fly ? 'fly' : 'walk',
      particles: this.particles.alive,
      camera: this.camera.position.toArray().map((v) => Math.round(v * 100) / 100),
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

  protected hudLines(): string[] {
    const avg = this.frameStats.average(60);
    const s = this.frameStats.summary(240);
    const sim = this.simStats;
    const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
      `FPS ${avg > 0 ? (1000 / avg).toFixed(0) : '--'}  frame ${avg.toFixed(1)}ms  p95 ${s.p95.toFixed(1)}  sim ${sim ? `${sim.stepMs.toFixed(2)}ms (max ${sim.stepMsMax.toFixed(1)})` : '--'}`,
      `bodies ${sim?.bodiesActive ?? 0} active / ${sim?.bodiesSleeping ?? 0} sleeping (${sim?.dynamicBodies ?? 0}/${this.params.maxBodies})  colliders ${k(sim?.colliders ?? 0)}  voxels ${k(sim?.voxels ?? 0)}`,
      `draw ${this.drawCalls}  tris ${k(this.triangles)}  chunks ${this.world.chunkMeshes}  queue ${this.world.queued}/${sim?.meshJobs ?? 0}  particles ${this.particles.alive}`,
      `${this.backend}  COI ${window.crossOriginIsolated ? 'yes' : 'NO'} (${this.sharedTransforms ? 'SAB' : 'postMessage'})  quality ${this.quality.name}  px ${this.pixelRatio.toFixed(2)}  ${this.fly ? 'fly' : 'walk'}`,
      `build ${BUILD_INFO.shortSha}  ${BUILD_INFO.time.replace('T', ' ').slice(0, 16)}Z`,
    ];
  }
}
