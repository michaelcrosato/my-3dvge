/// Simulation worker: owns all game state — voxels, the physics world, the player and game rules — and
/// steps it at a fixed 60 Hz. Transforms go out through a SharedArrayBuffer ring (or postMessage).
import type { MainToSim, SimToMain } from '../shared/protocol.ts';
import { MAX_SLOTS, TransformWriter } from '../shared/transforms.ts';
import { errorMessage, forwardWorkerErrors, workerScope } from '../shared/worker-scope.ts';
import { blast } from './destruction.ts';
import { MeshDispatcher } from './mesh-dispatch.ts';
import { RapierBackend } from './physics/rapier-backend.ts';
import type { SceneContext, SceneDef } from './scene-api.ts';
import { getScene } from './scenes/index.ts';
import { SimWorld } from './world.ts';

forwardWorkerErrors('sim');

const STEP = 1 / 60;
const MAX_STEPS_PER_TICK = 4;

function post(msg: SimToMain, transfer?: Transferable[]): void {
  workerScope.postMessage(msg, transfer);
}

let world: SimWorld | null = null;
let scene: SceneDef | null = null;
let ctx: SceneContext | null = null;
let writer: TransformWriter | null = null;
let dispatcher: MeshDispatcher | null = null;
let paletteVersion = -1;
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let last = 0;
let acc = 0;
let started = false;
/** Messages that arrive before the scene finished building. */
const early: MainToSim[] = [];

function flushOutputs(): void {
  if (!world) return;
  if (world.palette.version !== paletteVersion) {
    paletteVersion = world.palette.version;
    dispatcher?.setPalette(world.palette.colors);
  }
  world.flushMeshes();
  const particles = world.takeParticles();
  if (particles) post({ type: 'particles', data: particles }, [particles.buffer]);
}

function tick(): void {
  timer = undefined;
  if (!world || !writer || paused) return;
  try {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS_PER_TICK) {
      world.step(STEP);
      acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS_PER_TICK) acc = 0; // can't keep up: drop time rather than spiral
    if (n > 0) {
      const used = world.writeTransforms(writer.begin());
      writer.commit(used);
      flushOutputs();
    }
  } catch (err) {
    post(errorMessage(err));
  }
  timer = setTimeout(tick, Math.max(1, (STEP - acc) * 1000));
}

async function init(msg: Extract<MainToSim, { type: 'init' }>): Promise<void> {
  const physics = await RapierBackend.create();
  dispatcher = new MeshDispatcher(msg.meshPorts);
  writer = new TransformWriter(msg.shared, MAX_SLOTS, (frame, time, transforms) =>
    post({ type: 'frame', frame, time, transforms }, [transforms.buffer]),
  );
  const w = new SimWorld(
    msg.params,
    dispatcher,
    {
      volumeAdded: (volume) => post({ type: 'volumeAdded', volume }),
      volumeRemoved: (id) => post({ type: 'volumeRemoved', id }),
      status: (text) => post({ type: 'status', text }),
      ground: (ground) => post({ type: 'ground', ground }),
      game: (data, transfer) => post({ type: 'game', data }, transfer),
    },
    physics,
  );
  scene = getScene(msg.params.scene);
  ctx = w.sceneContext();
  await scene.build(ctx);
  const s = scene, c = ctx;
  if (s.preStep) w.scenePreStep = (dt) => s.preStep!(c, dt);
  if (s.update) w.sceneUpdate = (dt) => s.update!(c, dt);
  w.syncColliders(); // build static colliders up front, not inside the first step
  if (s.player !== false) w.spawnPlayer();
  world = w;
  paletteVersion = w.palette.version;
  dispatcher.setPalette(w.palette.colors);
  flushOutputs();
  post({ type: 'ready', scene: s.name, spawn: w.spawn, spawnYaw: w.spawnYaw, blastTarget: w.blastTarget, settings: w.settings });
  for (const m of early.splice(0)) handle(m);
  setInterval(() => {
    if (world) post({ type: 'stats', stats: world.stats() });
  }, 250);
  last = performance.now();
  started = true;
  tick();
}

function handle(msg: MainToSim): void {
  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => post(errorMessage(err)));
    return;
  }
  if (!world) {
    if (msg.type !== 'input') early.push(msg);
    return;
  }
  switch (msg.type) {
    case 'input':
      world.input = msg.input;
      break;
    case 'blast': {
      const r = blast(world, msg.origin, msg.dir, msg.radius, msg.power);
      post({ type: 'blastDone', id: msg.id, newBodies: r.newBodies, removedVoxels: r.removedVoxels });
      break;
    }
    case 'spawnCrate':
      world.spawnCrate(msg.origin, msg.dir);
      break;
    case 'settings':
      world.applySettings(msg.settings);
      break;
    case 'game':
      if (scene?.onMessage && ctx) scene.onMessage(ctx, msg.data);
      break;
    case 'pause':
      paused = msg.paused;
      if (paused && timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      // Early messages are drained before init starts the loop. Never start a second loop there.
      if (!paused && timer === undefined && started) {
        last = performance.now();
        acc = 0;
        tick();
      }
      break;
    default:
      break;
  }
}

workerScope.addEventListener('message', (e) => {
  try {
    handle(e.data as MainToSim);
  } catch (err) {
    post(errorMessage(err));
  }
});
