/**
 * Menu navigation for mouse, touch, keyboard and gamepad. Items are elements with class `pb-nav` inside
 * the active screen; items sharing a `data-row` attribute form a horizontal row (camera chips).
 * Keyboard handling runs in the window capture phase and stops propagation, so menu keys never leak
 * into gameplay input.
 */

export type UISound = 'uiClick' | 'uiBack' | 'uiMove';

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.12;

export class MenuNav {
  private screen: HTMLElement | null = null;
  private back: (() => void) | null = null;
  private readonly sound: (s: UISound) => void;
  /** Last time (ms) a menu key/button was consumed — gameplay ignores input briefly after. */
  lastInput = 0;
  private held = new Map<string, number>();
  private raf = 0;
  private lastPoll = 0;

  constructor(sound: (s: UISound) => void) {
    this.sound = sound;
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get active(): boolean {
    return this.screen !== null;
  }

  /** Makes `screen` the navigable screen. `back` handles Esc / B (null = no back action). */
  attach(screen: HTMLElement, back: (() => void) | null, focus?: HTMLElement | null): void {
    this.screen = screen;
    this.back = back;
    screen.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('.pb-nav');
      if (t && !(t instanceof HTMLInputElement)) this.sound(t.classList.contains('pb-back') ? 'uiBack' : 'uiClick');
    });
    this.lastPoll = 0;
    this.primeGamepad();
    const first = focus ?? this.items()[0];
    // Focus after layout so the browser doesn't scroll mid-animation.
    requestAnimationFrame(() => first?.focus({ preventScroll: false }));
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.poll(t));
  }

  /** Buttons already held when a screen opens must be released before they act. */
  private primeGamepad(): void {
    const gp = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (!gp) return;
    const names: [string, number][] = [['a', 0], ['b', 1], ['start', 9]];
    for (const [n, i] of names) if (gp.buttons[i]?.pressed) this.held.set(n, 0);
  }

  detach(): void {
    this.screen = null;
    this.back = null;
    this.held.clear();
  }

  private items(): HTMLElement[] {
    if (!this.screen) return [];
    return [...this.screen.querySelectorAll<HTMLElement>('.pb-nav')].filter((e) => e.offsetParent !== null || e === document.activeElement);
  }

  private current(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    return a && this.screen?.contains(a) && a.classList.contains('pb-nav') ? a : null;
  }

  /** Vertical move: skips over the rest of a horizontal row. */
  move(delta: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const cur = this.current();
    let i = cur ? items.indexOf(cur) : -1;
    const row = cur?.dataset.row;
    do {
      i = (i + delta + items.length) % items.length;
    } while (row !== undefined && items[i]!.dataset.row === row && items[i] !== cur);
    // Land on the selected chip of a row if there is one.
    const target = items[i]!;
    const r = target.dataset.row;
    const pick = r !== undefined ? (items.find((e) => e.dataset.row === r && e.classList.contains('pb-selected')) ?? target) : target;
    pick.focus();
    this.sound('uiMove');
    this.lastInput = performance.now();
  }

  /** Horizontal: adjusts sliders, moves along rows. Returns true if handled. */
  side(delta: number, fromGamepad: boolean): boolean {
    const cur = this.current();
    if (!cur) return false;
    if (cur instanceof HTMLInputElement && cur.type === 'range') {
      if (!fromGamepad) return false; // native arrow handling
      const step = Number(cur.step || 1) * 5;
      cur.value = String(Math.max(Number(cur.min), Math.min(Number(cur.max), Number(cur.value) + delta * step)));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      this.sound('uiMove');
      return true;
    }
    const row = cur.dataset.row;
    if (row === undefined) return false;
    const rowItems = this.items().filter((e) => e.dataset.row === row);
    const i = rowItems.indexOf(cur);
    const next = rowItems[(i + delta + rowItems.length) % rowItems.length];
    next?.focus();
    this.sound('uiMove');
    return true;
  }

  activate(): void {
    const cur = this.current() ?? this.items()[0];
    if (!cur) return;
    cur.click();
    this.lastInput = performance.now();
  }

  goBack(): void {
    if (!this.back) return;
    this.sound('uiBack');
    this.lastInput = performance.now();
    this.back();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.screen) return;
    const k = e.code;
    let handled = true;
    if (k === 'ArrowUp' || k === 'KeyW') this.move(-1);
    else if (k === 'ArrowDown' || k === 'KeyS' || (k === 'Tab' && !e.shiftKey)) this.move(1);
    else if (k === 'Tab' && e.shiftKey) this.move(-1);
    else if (k === 'ArrowLeft' || k === 'KeyA') handled = this.side(-1, k === 'KeyA');
    else if (k === 'ArrowRight' || k === 'KeyD') handled = this.side(1, k === 'KeyD');
    else if (k === 'Escape' || k === 'Backspace') this.goBack();
    else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
      if (!e.repeat) this.activate();
    } else handled = false;
    // Keep menu keys away from gameplay listeners (and stop native double-activation).
    if (handled || k === 'ArrowLeft' || k === 'ArrowRight') e.stopPropagation();
    if (handled) {
      e.preventDefault();
      this.lastInput = performance.now();
    }
  }

  private poll(t: number): void {
    this.raf = 0;
    if (!this.screen) return;
    const dt = this.lastPoll ? Math.min(0.1, (t - this.lastPoll) / 1000) : 0;
    this.lastPoll = t;
    const gp = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (gp) {
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      const btn = (i: number) => gp.buttons[i]?.pressed ?? false;
      this.repeat('up', btn(12) || ay < -0.6, dt, () => this.move(-1));
      this.repeat('down', btn(13) || ay > 0.6, dt, () => this.move(1));
      this.repeat('left', btn(14) || ax < -0.6, dt, () => this.side(-1, true));
      this.repeat('right', btn(15) || ax > 0.6, dt, () => this.side(1, true));
      this.edge('a', btn(0), () => this.activate());
      this.edge('b', btn(1), () => this.goBack());
      this.edge('start', btn(9), () => (this.back ? this.goBack() : this.activate()));
    }
    this.raf = requestAnimationFrame((tt) => this.poll(tt));
  }

  private repeat(name: string, down: boolean, dt: number, fn: () => void): void {
    if (!down) {
      this.held.delete(name);
      return;
    }
    const t = this.held.get(name);
    if (t === undefined) {
      this.held.set(name, REPEAT_DELAY);
      fn();
      this.lastInput = performance.now();
      return;
    }
    const left = t - dt;
    if (left <= 0) {
      fn();
      this.held.set(name, REPEAT_RATE);
    } else this.held.set(name, left);
  }

  private edge(name: string, down: boolean, fn: () => void): void {
    const was = this.held.has(name);
    if (down && !was) {
      this.held.set(name, 0);
      fn();
      this.lastInput = performance.now();
    } else if (!down && was) this.held.delete(name);
  }
}
