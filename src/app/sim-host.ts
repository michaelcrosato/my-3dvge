import type { Params } from '../config/params.ts';
import { reportError } from '../debug/error-overlay.ts';
import type { MainToSim, MeshResult, MesherToMain, SimToMain } from '../shared/protocol.ts';

export interface SimHostHandlers {
  onSim(msg: SimToMain): void;
  onMesh(result: MeshResult): void;
}

/**
 * Spawns the simulation worker and the mesher pool, wiring each mesher to the simulation worker with a
 * MessageChannel (jobs flow sim → mesher; finished meshes flow mesher → main thread directly).
 */
export class SimHost {
  readonly sim: Worker;
  readonly meshers: Worker[];

  constructor(params: Params, shared: SharedArrayBuffer | null, handlers: SimHostHandlers) {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    this.meshers = [];
    const ports: MessagePort[] = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('../mesher/mesher.worker.ts', import.meta.url), { type: 'module', name: `mesher-${i}` });
      w.onmessage = (e: MessageEvent<MesherToMain>) => {
        const msg = e.data;
        if (msg.type === 'mesh') handlers.onMesh(msg);
        else reportError('worker', msg, `mesher-${i}`);
      };
      w.onerror = (e) => reportError('worker', e.message || 'mesher worker failed to load', `mesher-${i}`);
      const channel = new MessageChannel();
      w.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
      ports.push(channel.port2);
      this.meshers.push(w);
    }

    this.sim = new Worker(new URL('../sim/sim.worker.ts', import.meta.url), { type: 'module', name: 'sim' });
    this.sim.onmessage = (e: MessageEvent<SimToMain>) => {
      if (e.data.type === 'error') reportError('worker', e.data, 'sim');
      else handlers.onSim(e.data);
    };
    this.sim.onerror = (e) => reportError('worker', e.message || 'sim worker failed to load', 'sim');
    this.sim.onmessageerror = () => reportError('worker', 'sim message could not be deserialized', 'sim');
    this.send({ type: 'init', params, meshPorts: ports, shared }, ports);
  }

  send(msg: MainToSim, transfer: Transferable[] = []): void {
    this.sim.postMessage(msg, transfer);
  }
}
