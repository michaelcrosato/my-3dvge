/** Minimal typing for a dedicated worker's global scope (the project compiles against the DOM lib). */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (e: PromiseRejectionEvent) => void): void;
}

export const workerScope = self as unknown as WorkerScope;

export function errorMessage(err: unknown): { type: 'error'; message: string; stack?: string } {
  if (err instanceof Error) return { type: 'error', message: `${err.name}: ${err.message}`, stack: err.stack };
  return { type: 'error', message: String(err) };
}

/** Forwards uncaught worker errors to the main thread so the on-screen overlay shows them. */
export function forwardWorkerErrors(name: string): void {
  workerScope.addEventListener('error', (e) => {
    workerScope.postMessage({ ...errorMessage(e.error ?? e.message), message: `[${name}] ${e.message}` });
  });
  workerScope.addEventListener('unhandledrejection', (e) => {
    const m = errorMessage(e.reason);
    workerScope.postMessage({ ...m, message: `[${name}] ${m.message}` });
  });
}
