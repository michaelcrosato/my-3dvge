import type { MeshJob } from '../shared/protocol.ts';

export interface MeshSink {
  setPalette(colors: Uint8Array): void;
  submit(job: MeshJob): void;
  readonly inFlight: number;
}

/** Sends mesh jobs to the least-busy mesher worker (each acks with {type:'done'}). */
export class MeshDispatcher implements MeshSink {
  private readonly ports: MessagePort[];
  private readonly busy: number[];

  constructor(ports: MessagePort[]) {
    this.ports = ports;
    this.busy = ports.map(() => 0);
    ports.forEach((p, i) => {
      p.onmessage = () => {
        this.busy[i] = Math.max(0, this.busy[i]! - 1);
      };
    });
  }

  get inFlight(): number {
    return this.busy.reduce((a, b) => a + b, 0);
  }

  setPalette(colors: Uint8Array): void {
    for (const p of this.ports) p.postMessage({ type: 'palette', colors: colors.slice() });
  }

  submit(job: MeshJob): void {
    let best = 0;
    for (let i = 1; i < this.busy.length; i++) if (this.busy[i]! < this.busy[best]!) best = i;
    this.busy[best]!++;
    this.ports[best]!.postMessage(job, [job.data.buffer]);
  }
}
