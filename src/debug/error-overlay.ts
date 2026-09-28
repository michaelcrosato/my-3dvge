/**
 * On-screen error overlay: the phone has no devtools, so every uncaught error, unhandled rejection,
 * worker error and console.error is shown here (deduplicated) with a copy button.
 */

export type ErrorKind = 'error' | 'rejection' | 'worker' | 'console' | 'boot';

export interface ErrorEntry {
  kind: ErrorKind;
  message: string;
  stack?: string;
  source?: string;
  count: number;
  time: string;
}

const MAX_ENTRIES = 30;
const entries: ErrorEntry[] = [];
let panel: HTMLDivElement | null = null;
let list: HTMLPreElement | null = null;
let dismissed = false;
const listeners: ((e: ErrorEntry) => void)[] = [];

export function getErrors(): readonly ErrorEntry[] {
  return entries;
}

export function onError(fn: (e: ErrorEntry) => void): void {
  listeners.push(fn);
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack };
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const e = err as { message: unknown; stack?: unknown };
    return { message: String(e.message), stack: typeof e.stack === 'string' ? e.stack : undefined };
  }
  return { message: String(err) };
}

export function reportError(kind: ErrorKind, err: unknown, source?: string): void {
  const { message, stack } = describe(err);
  const existing = entries.find((e) => e.message === message && e.kind === kind);
  if (existing) {
    existing.count++;
  } else {
    const entry: ErrorEntry = { kind, message, stack, source, count: 1, time: new Date().toISOString() };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    for (const fn of listeners) fn(entry);
  }
  render();
}

function render(): void {
  if (!panel || !list) return;
  if (entries.length === 0 || dismissed) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  list.textContent = entries
    .map((e) => {
      const head = `[${e.kind}${e.count > 1 ? ` ×${e.count}` : ''}]${e.source ? ` (${e.source})` : ''} ${e.message}`;
      const stack = e.stack ? `\n  ${e.stack.split('\n').slice(0, 6).join('\n  ')}` : '';
      return head + stack;
    })
    .join('\n\n');
}

export function errorsAsText(): string {
  return JSON.stringify(entries, null, 2);
}

export function installErrorOverlay(root: HTMLElement, copy: (text: string) => Promise<boolean>): void {
  panel = document.createElement('div');
  panel.className = 'error-overlay';
  panel.hidden = true;
  const bar = document.createElement('div');
  bar.className = 'error-bar';
  const title = document.createElement('strong');
  title.textContent = 'Errors';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = async () => {
    copyBtn.textContent = (await copy(errorsAsText())) ? 'Copied' : 'Copy failed';
  };
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Dismiss';
  closeBtn.onclick = () => {
    dismissed = true;
    render();
  };
  bar.append(title, copyBtn, closeBtn);
  list = document.createElement('pre');
  panel.append(bar, list);
  root.append(panel);

  window.addEventListener('error', (e) => {
    reportError('error', e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => reportError('rejection', e.reason));

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    reportError('console', args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
  };

  for (const e of window.__bootErrors ?? []) reportError('boot', e);
  render();
}

/** New errors re-open a dismissed overlay. */
onError(() => {
  dismissed = false;
});
