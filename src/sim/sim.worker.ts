/// Simulation worker: owns all game state — voxels, the physics world, the player and game rules — and
/// steps it at a fixed 60 Hz. Transforms go out through a SharedArrayBuffer ring (or postMessage).
import type { MainToSim, SimToMain } from '../shared/protocol.ts';
import { MAX_SLOTS, TransformWriter } from '../shared/transforms.ts';
import { errorMessage, forwardWorkerErrors, workerScope } from '../shared/worker-scope.ts';
import { blast } from './destruction.ts';
import { MeshDispatcher } from './mesh-dispatch.ts';
import { RapierBackend } from './physics/rapier-backend.ts';
import { getScene } from './scenes/index.ts';
import { SimWorld } from './world.ts';

forwardWorkerErrors('sim');

const STEP = 1 / 60;
const MAX_STEPS_PER_TICK = 4;

function post(msg: SimToMain, transfer?: Transferable[]): void {
  workerScope.postMessage(msg, transfer);
}

let world: SimWorld | null = null;
let writer: TransformWriter | null = null;
let dispatcher: MeshDispatcher | null = null;
let paletteVersion = -1;
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let last = 0;
let acc = 0;

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
      if (world.palette.version !== paletteVersion) {
        paletteVersion = world.palette.version;
        dispatcher?.setPalette(world.palette.colors);
      }
      world.flushMeshes();
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
  world = new SimWorld(
    msg.params,
    dispatcher,
    {
      volumeAdded: (volume) => post({ type: 'volumeAdded', volume }),
      volumeRemoved: (id) => post({ type: 'volumeRemoved', id }),
      status: (text) => post({ type: 'status', text }),
    },
    physics,
  );
  const scene = getScene(msg.params.scene);
  const ctx = world.sceneContext();
  await scene.build(ctx);
  if (scene.update) world.sceneUpdate = (dt) => scene.update!(ctx, dt);
  world.syncColliders(); // build static colliders up front, not inside the first step
  world.spawnPlayer();
  paletteVersion = world.palette.version;
  dispatcher.setPalette(world.palette.colors);
  world.flushMeshes();
  post({ type: 'ready', scene: scene.name, spawn: world.spawn, spawnYaw: world.spawnYaw, blastTarget: world.blastTarget, settings: world.settings });
  setInterval(() => {
    if (world) post({ type: 'stats', stats: world.stats() });
  }, 250);
  last = performance.now();
  tick();
}

function handle(msg: MainToSim): void {
  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => post(errorMessage(err)));
    return;
  }
  if (!world) return;
  switch (msg.type) {
    case 'input':
      world.input = msg.input;
      break;
    case 'blast': {
      const r = blast(world, msg.origin, msg.dir, msg.radius, msg.power);
      post({ type: 'blastDone', id: msg.id, newBodies: r.newBodies, removedVoxels: r.removedVoxels });
      if (r.particles.length) post({ type: 'particles', data: r.particles }, [r.particles.buffer]);
      break;
    }
    case 'spawnCrate':
      world.spawnCrate(msg.origin, msg.dir);
      break;
    case 'settings':
      world.applySettings(msg.settings);
      break;
    case 'pause':
      paused = msg.paused;
      if (!paused && timer === undefined) {
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
