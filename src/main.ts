import './style.css';
import { Engine } from './app/engine.ts';
import { parseParams } from './config/params.ts';
import { copyText } from './debug/clipboard.ts';
import { installErrorOverlay, reportError } from './debug/error-overlay.ts';

const ui = document.getElementById('ui')!;
installErrorOverlay(ui, copyText);

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const params = parseParams(location.search);
  const engine = await Engine.create(canvas, ui, params);
  document.getElementById('loading')?.remove();
  engine.start();
}

const harness = new URLSearchParams(location.search).get('harness');
const start: () => Promise<void> =
  harness === 'ui'
    ? () => import('./game/client/ui/harness.ts').then((m) => m.runHarness(ui))
    : harness === 'audio'
      ? () => import('./game/client/audio/harness.ts').then((m) => m.runHarness(ui))
      : boot;

start().catch((err: unknown) => {
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Failed to start — see errors below.';
  reportError('boot', err, 'boot');
});
