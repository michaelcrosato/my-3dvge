/// Mesher worker: receives padded chunks from the simulation worker over a MessagePort, greedy-meshes
/// them and posts the geometry to the main thread as transferable buffers.
import type { MeshResult, SimToMesher } from '../shared/protocol.ts';
import { errorMessage, forwardWorkerErrors, workerScope } from '../shared/worker-scope.ts';
import { meshChunk } from '../voxel/mesher.ts';

forwardWorkerErrors('mesher');

let palette: Uint8Array = new Uint8Array(256 * 4);
let port: MessagePort | null = null;

function onJob(e: MessageEvent<SimToMesher>): void {
  const msg = e.data;
  if (msg.type === 'palette') {
    palette = msg.colors;
    return;
  }
  const t0 = performance.now();
  try {
    const m = meshChunk(msg.data, palette, msg.origin);
    const result: MeshResult = {
      type: 'mesh',
      volumeId: msg.volumeId,
      chunk: msg.chunk,
      version: msg.version,
      origin: msg.origin,
      positions: m.positions,
      normals: m.normals,
      colors: m.colors,
      indices: m.indices,
      ms: performance.now() - t0,
    };
    workerScope.postMessage(result, [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
  } catch (err) {
    workerScope.postMessage(errorMessage(err));
  } finally {
    port?.postMessage({ type: 'done' });
  }
}

workerScope.addEventListener('message', (e) => {
  const msg = e.data as { type: string; port?: MessagePort };
  if (msg.type === 'port' && msg.port) {
    port = msg.port;
    port.onmessage = onJob;
  }
});
