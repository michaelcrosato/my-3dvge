/**
 * Debug HUD: a text panel refreshed at 4 Hz plus a row of action buttons. Shown with ?debug=1 or the
 * always-visible HUD toggle (state remembered per device).
 */

export interface HudAction {
  label: string;
  run: (button: HTMLButtonElement) => void | Promise<void>;
}

const STORAGE_KEY = 'my3dvge.hud';

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writeStored(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    // storage unavailable (private mode) — fine
  }
}

export class Hud {
  private readonly panel: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly actions: HTMLDivElement;
  private readonly lines: () => string[];
  readonly toggleButton: HTMLButtonElement;
  private lastUpdate = 0;
  visible: boolean;

  constructor(root: HTMLElement, lines: () => string[], forceVisible: boolean) {
    this.lines = lines;
    this.visible = forceVisible || (readStored() ?? false);
    const toggle = document.createElement('button');
    toggle.className = 'hud-toggle';
    toggle.textContent = 'HUD';
    toggle.onclick = () => this.setVisible(!this.visible);
    this.toggleButton = toggle;

    this.panel = document.createElement('div');
    this.panel.className = 'hud';
    this.text = document.createElement('pre');
    this.actions = document.createElement('div');
    this.actions.className = 'hud-actions';
    this.panel.append(this.text, this.actions);
    root.append(toggle, this.panel);
    this.setVisible(this.visible);
  }

  addAction(action: HudAction): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = (ev) => {
      ev.stopPropagation();
      void action.run(b);
    };
    this.actions.append(b);
    return b;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.panel.hidden = !v;
    writeStored(v);
    if (v) this.update(performance.now(), true);
  }

  update(now: number, force = false): void {
    if (!this.visible || (!force && now - this.lastUpdate < 250)) return;
    this.lastUpdate = now;
    this.text.textContent = this.lines().join('\n');
  }
}
