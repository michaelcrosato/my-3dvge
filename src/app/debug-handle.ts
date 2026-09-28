/** window.__engine: stats and test hooks used by Playwright and for poking at the engine from a console. */
export interface EngineDebugHandle {
  readonly ready: boolean;
  readonly framesRendered: number;
  /** Number of dynamic bodies currently simulated. */
  readonly bodyCount: number;
  readonly renderer: string;
  stats(): Record<string, unknown>;
  /** Blast at a world position (default: the scene's blast target). Resolves to the dynamic body count delta. */
  triggerBlast(pos?: [number, number, number], radius?: number, power?: number): Promise<number>;
}

declare global {
  interface Window {
    __engine?: EngineDebugHandle;
  }
}

export function installDebugHandle(handle: EngineDebugHandle): void {
  window.__engine = handle;
}
