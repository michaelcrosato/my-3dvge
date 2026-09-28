/// Simulation worker: owns all game state (voxels, and from M2 physics, destruction and rules).
import type { MainToSim, SimToMain } from '../shared/protocol.ts';
import { errorMessage, forwardWorkerErrors, workerScope } from '../shared/worker-scope.ts';
import { MeshDispatcher } from './mesh-dispatch.ts';
import { getScene } from './scenes/index.ts';
import { SimWorld } from './world.ts';

forwardWorkerErrors('sim');

function post(msg: SimToMain, transfer?: Transferable[]): void {
  workerScope.postMessage(msg, transfer);
}

let world: SimWorld | null = null;

function init(msg: Extract<MainToSim, { type: 'init' }>): void {
  const dispatcher = new MeshDispatcher(msg.meshPorts);
  world = new SimWorld(msg.params, dispatcher, {
    volumeAdded: (volume) => post({ type: 'volumeAdded', volume }),
    volumeRemoved: (id) => post({ type: 'volumeRemoved', id }),
  });
  const scene = getScene(msg.params.scene);
  scene.build(world.sceneContext());
  dispatcher.setPalette(world.palette.colors);
  world.flushMeshes();
  post({
    type: 'ready',
    scene: scene.name,
    spawn: world.spawn,
    spawnYaw: world.spawnYaw,
    blastTarget: world.blastTarget,
    settings: { gravity: -9.81, blastRadius: 1, blastPower: 1, strengthScale: 1, maxBodies: msg.params.maxBodies, particleThreshold: 6 },
  });
  setInterval(() => {
    if (world) post({ type: 'stats', stats: world.baseStats() });
  }, 250);
}

workerScope.addEventListener('message', (e) => {
  const msg = e.data as MainToSim;
  try {
    if (msg.type === 'init') init(msg);
  } catch (err) {
    post(errorMessage(err));
  }
});
