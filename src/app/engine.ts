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
import { DynamicResolution } from '../render/dynamic-resolution.ts';
import { createRenderer, type BackendName } from '../render/renderer.ts';
import { GroundView } from '../render/ground-view.ts';
import { WorldView } from '../render/world-view.ts';
import type { PlayerInput, SimSettings, SimStats, SimToMain, Vec3 } from '../shared/protocol.ts';
import { MAX_SLOTS, PLAYER_SLOT, TransformReader, interpolateSlot, transformBufferBytes, type TransformSample } from '../shared/transforms.ts';
import { CLIENTS } from './clients.ts';
import type { GameClient } from './game-client.ts';
import { Bench, type BenchReport } from './bench.ts';
import { installDebugHandle } from './debug-handle.ts';
import { SimHost } from './sim-host.ts';

/** Eye height above the player capsule's center (center is 0.9 m above the feet). */
const EYE_OFFSET = 0.7;
/** Main-thread time budget per frame for uploading new chunk meshes. */
const MESH_UPLOAD_BUDGET_MS = 3;
/** Render cap: high-refresh phones (120 Hz) would otherwise burn twice the power for no gameplay gain. */
const TARGET_FPS = 60;

/** Main-thread engine: renderer, input, camera, the world mirror and debug tooling. */
export class Engine {
  params: Params;
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
  host: SimHost;
  transforms: TransformReader;
  sharedTransforms: boolean;
  readonly ground = new GroundView();
  /** Scene-specific main-thread game (camera, input, UI, audio); null in sandbox scenes. */
  client: GameClient | null = null;
  /** True for engine sandbox scenes (no game client): default walker/fly controls and tools. */
  readonly sandbox: boolean;
  /** This frame's interpolated transform sample (valid during client.update). */
  sample: TransformSample | null = null;
  /** Where the sun's shadow box centers (defaults to the camera). */
  shadowFocus: THREE.Vector3 | null = null;
  readonly canvas: HTMLCanvasElement;
  framesRendered = 0;
  pixelRatio = 1;
  gpuInfo: GpuInfo | null = null;
  simReady = false;
  simStats: SimStats | null = null;
  blastTarget: Vec3 = [0, 1, 0];
  fly: boolean;
  settings: SimSettings | null = null;
  readonly dynRes: DynamicResolution;
  bench: Bench | null = null;
  benchReport: BenchReport | null = null;

  private readonly pendingBlasts = new Map<number, (newBodies: number) => void>();
  private nextBlastId = 1;
  private tuning: HTMLElement | null = null;
  readonly ui: HTMLElement;
  private readonly flyPos = new THREE.Vector3(0, 3, 6);
  private readonly playerPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private lastFrame = 0;
  private lastRaf = 0;
  private rafEma = 1000 / 60;
  private readonly statusEl: HTMLDivElement;
  private drawCalls = 0;
  private triangles = 0;

  private constructor(params: Params, renderer: THREE.WebGPURenderer, backend: BackendName, canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.params = params;
    this.quality = QUALITY_PRESETS[params.quality ?? defaultQuality()];
    this.renderer = renderer;
    this.backend = backend;
    this.fly = params.fly;
    this.canvas = canvas;
    this.sandbox = CLIENTS[params.scene] === undefined;

    const q = this.quality;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, q.viewDistance);
    this.camera.rotation.order = 'YXZ';
    this.env = new Environment(this.scene, renderer, q);
    this.scene.add(this.world.root, this.particles.mesh, this.ground.root);
    this.ui = ui;

    this.controls = new Controls(canvas, ui);
    if (this.sandbox) {
      const crosshair = document.createElement('div');
      crosshair.className = 'crosshair';
      ui.append(crosshair);
      this.addTouchButtons();
    }
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.statusEl.hidden = true;
    ui.append(this.statusEl);
    const base = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    this.dynRes = new DynamicResolution(base, Math.min(base, q.minPixelRatio), TARGET_FPS);

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
      label: 'Bench',
      run: () => this.startBench(this.params.benchTime),
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

    const shared = Engine.sharedBuffer();
    this.sharedTransforms = shared !== null;
    this.transforms = new TransformReader(shared, MAX_SLOTS);
    this.host = this.spawnHost(shared);
    document.addEventListener('visibilitychange', () => this.host.send({ type: 'pause', paused: document.hidden || this.paused }));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static async create(canvas: HTMLCanvasElement, ui: HTMLElement, params: Params): Promise<Engine> {
    const loader = CLIENTS[params.scene];
    const [{ renderer, backend }, client] = await Promise.all([createRenderer(canvas, params.renderer), loader ? loader() : Promise.resolve(null)]);
    const engine = new Engine(params, renderer, backend, canvas, ui);
    void probeGpu().then((info) => (engine.gpuInfo = info));
    engine.installHandle();
    if (client) {
      engine.client = client;
      await client.attach(engine);
    }
    return engine;
  }

  private static sharedBuffer(): SharedArrayBuffer | null {
    return window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(transformBufferBytes(MAX_SLOTS)) : null;
  }

  private spawnHost(shared: SharedArrayBuffer | null): SimHost {
    return new SimHost(this.params, shared, {
      onSim: (msg) => this.onSimMessage(msg),
      onMesh: (r) => this.world.enqueue(r),
    });
  }

  /** Simulation pause requested by the game (menus); also paused while the tab is hidden. */
  paused = false;

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.host.send({ type: 'pause', paused: paused || document.hidden });
  }

  /** Restarts the simulation (optionally with new params) without reloading the page. */
  restart(params: Partial<Params> = {}): void {
    this.params = { ...this.params, ...params };
    this.host.dispose();
    this.world.clear();
    this.particles.clear();
    this.ground.clear();
    this.simReady = false;
    this.simStats = null;
    this.paused = false;
    this.statusEl.hidden = true;
    for (const resolve of this.pendingBlasts.values()) resolve(0);
    this.pendingBlasts.clear();
    this.bench = null;
    const shared = Engine.sharedBuffer();
    this.sharedTransforms = shared !== null;
    this.transforms = new TransformReader(shared, MAX_SLOTS);
    this.sample = null;
    this.host = this.spawnHost(shared);
    this.host.send({ type: 'pause', paused: document.hidden });
  }

  /** Sends a message to the scene's game rules (SceneDef.onMessage) in the simulation worker. */
  sendGame(data: unknown, transfer: Transferable[] = []): void {
    this.host.send({ type: 'game', data }, transfer);
  }

  /** Interpolated pose of a transform slot for this frame. */
  slotPose(slot: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    if (!this.sample) return false;
    interpolateSlot(this.sample, slot, pos, quat);
    return true;
  }

  /** Moves the far plane and fog so `offset` meters of camera distance don't eat the view distance. */
  setViewOffset(offset: number): void {
    const vd = this.quality.viewDistance;
    if (this.camera.far === offset + vd) return;
    this.camera.far = offset + vd;
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = offset + vd * 0.4;
      fog.far = offset + vd;
    }
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
        this.client?.onReady?.();
        if (!this.sandbox) break;
        this.tuning ??= createTuningPanel(this.ui, msg.settings, this.quality.name, (patch) => {
          Object.assign(this.settings!, patch);
          this.host.send({ type: 'settings', settings: patch });
        }).domElement.parentElement;
        if (this.tuning) this.tuning.hidden = !this.params.debug;
        if (this.params.bench) setTimeout(() => this.startBench(this.params.benchTime), 1500);
        break;
      case 'status':
        this.statusEl.textContent = msg.text;
        this.statusEl.hidden = msg.text === '';
        break;
      case 'ground':
        this.ground.set(msg.ground);
        break;
      case 'game':
        this.client?.onMessage(msg.data);
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
      startBench: (seconds) => this.startBench(seconds ?? this.params.benchTime),
      get benchReport() {
        return engine.benchReport;
      },
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pixelRatio = this.dynRes ? this.dynRes.ratio : Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
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
    this.sample = sample;
    if (sample) {
      for (const [slot, view] of this.world.bySlot) {
        // A freshly spawned volume keeps its initial pose until the simulation has written its slot.
        const owner = sample.curr[slot * 8 + 7];
        if (owner !== undefined && owner !== view.info.id) continue;
        interpolateSlot(sample, slot, view.group.position, view.group.quaternion);
      }
      interpolateSlot(sample, PLAYER_SLOT, this.playerPos, this.tmpQuat);
    }
    if (this.client) return;
    if (this.fly || !sample) this.camera.position.copy(this.flyPos);
    else this.camera.position.set(this.playerPos.x, this.playerPos.y + EYE_OFFSET, this.playerPos.z);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0);
  }

  startBench(seconds: number): void {
    if (this.bench && !this.bench.done) return;
    this.benchReport = null;
    this.bench = new Bench(seconds, this.blastTarget, {
      setCamera: (p, yaw, pitch) => {
        this.fly = true;
        this.flyPos.set(p[0], p[1], p[2]);
        this.controls.yaw = yaw;
        this.controls.pitch = pitch;
      },
      blast: (o, d) => void this.blastAt(o, d),
      crate: (o, d) => this.host.send({ type: 'spawnCrate', origin: o, dir: d }),
      bodyCount: () => this.simStats?.dynamicBodies ?? 0,
    });
  }

  private showBenchReport(report: BenchReport): void {
    this.benchReport = report;
    const full = {
      report,
      build: BUILD_INFO,
      renderer: this.backend,
      quality: this.quality.name,
      scene: this.params.scene,
      maxBodies: this.params.maxBodies,
      pixelRatioEnd: this.dynRes.ratio,
      userAgent: navigator.userAgent,
    };
    const text = JSON.stringify(full, null, 2);
    const dlg = document.createElement('div');
    dlg.className = 'modal bench-report';
    const f = report.frameMs;
    const pre = document.createElement('pre');
    pre.textContent =
      `Bench ${report.seconds.toFixed(0)} s, ${report.frames} frames\n` +
      `frame ms  p50 ${f.p50.toFixed(2)}  p95 ${f.p95.toFixed(2)}  p99 ${f.p99.toFixed(2)}  avg ${f.avg.toFixed(2)}\n` +
      `first ${report.windowSeconds.toFixed(0)} s avg ${report.firstWindowAvgMs.toFixed(2)} ms → last ${report.windowSeconds.toFixed(0)} s avg ${report.lastWindowAvgMs.toFixed(2)} ms\n` +
      `peak bodies ${report.peakBodies}  blasts ${report.blasts}  crates ${report.crates}\n\n${text}`;
    const copy = document.createElement('button');
    copy.textContent = 'Copy report';
    copy.onclick = async () => {
      copy.textContent = (await copyText(text)) ? 'Copied ✓' : 'Copy failed';
    };
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.onclick = () => dlg.remove();
    dlg.append(pre, copy, close);
    this.ui.append(dlg);
  }

  private frame(time: number): void {
    // Cap at TARGET_FPS on high-refresh displays: skip a vsync when rendering now would overshoot.
    const raw = time - this.lastRaf;
    this.lastRaf = time;
    if (raw > 0 && raw < 100) this.rafEma += (raw - this.rafEma) * 0.1;
    if (this.framesRendered > 0 && time - this.lastFrame < 1000 / TARGET_FPS - this.rafEma * 0.6) return;

    const frameMs = time - this.lastFrame;
    const dt = Math.min(0.1, frameMs / 1000);
    if (this.framesRendered > 0) {
      this.frameStats.push(frameMs);
      if (this.dynRes.update(frameMs, time)) this.resize();
      if (this.bench) {
        const report = this.bench.frame(time, frameMs);
        if (report) this.showBenchReport(report);
      }
    }
    this.lastFrame = time;

    this.controls.pollGamepad(dt);
    this.world.processQueue(MESH_UPLOAD_BUDGET_MS);
    if (!this.client) this.updateInput(dt);
    this.applyTransforms();
    this.client?.update(dt, time);
    this.particles.update(dt);
    this.env.follow(this.shadowFocus ?? this.camera.position);

    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.drawCalls = info.drawCalls;
    this.triangles = info.triangles;
    this.framesRendered++;
    this.hud.update(time);
    this.controls.endFrame();
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
      dynamicResolution: this.dynRes.scale,
      bench: this.bench ? { elapsed: this.bench.elapsed, seconds: this.bench.seconds, done: this.bench.done } : null,
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
      `${this.backend}  COI ${window.crossOriginIsolated ? 'yes' : 'NO'} (${this.sharedTransforms ? 'SAB' : 'postMessage'})  quality ${this.quality.name}  px ${this.pixelRatio.toFixed(2)} (dynres ×${this.dynRes.scale.toFixed(2)})  ${this.fly ? 'fly' : 'walk'}`,
      ...(this.bench && !this.bench.done ? [`BENCH ${this.bench.elapsed.toFixed(0)}/${this.bench.seconds}s`] : []),
      `build ${BUILD_INFO.shortSha}  ${BUILD_INFO.time.replace('T', ' ').slice(0, 16)}Z`,
    ];
  }
}
