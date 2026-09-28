import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import type { MainToSim } from '../../src/shared/protocol.ts';

const mock = vi.hoisted(() => ({
  listener: null as ((e: { data: MainToSim }) => void) | null,
  post: vi.fn(),
  build: vi.fn<() => Promise<void>>(),
}));
vi.mock('../../src/shared/worker-scope.ts', () => ({
  workerScope: { postMessage: mock.post, addEventListener: (_type: string, fn: typeof mock.listener) => { mock.listener = fn; } },
  forwardWorkerErrors: () => undefined,
  errorMessage: (err: unknown) => ({ type: 'error', message: String(err) }),
}));
vi.mock('../../src/sim/physics/rapier-backend.ts', () => ({ RapierBackend: { create: async () => null } }));
vi.mock('../../src/sim/scenes/index.ts', () => ({ getScene: () => ({ name: 'test', build: mock.build }) }));

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('starts only one timer loop after queued pause/resume messages during scene loading', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  let built!: () => void;
  mock.build.mockReturnValue(new Promise<void>((resolve) => { built = resolve; }));
  await import('../../src/sim/sim.worker.ts');
  const send = (data: MainToSim) => mock.listener!({ data });
  send({ type: 'init', params: DEFAULT_PARAMS, meshPorts: [], shared: null });
  send({ type: 'pause', paused: true });
  send({ type: 'pause', paused: false });
  built();
  await vi.advanceTimersByTimeAsync(50);
  expect(mock.post.mock.calls.some(([msg]) => msg.type === 'ready')).toBe(true);
  expect(vi.getTimerCount()).toBe(2); // stats interval + one simulation timeout
  for (let i = 0; i < 5; i++) {
    send({ type: 'pause', paused: true });
    expect(vi.getTimerCount()).toBe(1);
    send({ type: 'pause', paused: false });
    expect(vi.getTimerCount()).toBe(2);
  }
  expect(mock.post.mock.calls.filter(([msg]) => msg.type === 'error')).toEqual([]);
});
