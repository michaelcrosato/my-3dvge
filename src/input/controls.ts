/**
 * Unified input: keyboard + pointer-lock mouse on desktop; a floating virtual joystick (left side),
 * drag-to-look (right side) and on-screen buttons on touch devices.
 */
export type Action = 'blast' | 'spawn' | 'toggleFly';

const JOY_RADIUS = 60;
const MAX_PITCH = Math.PI / 2 - 0.01;

export class Controls {
  yaw = 0;
  pitch = 0;
  mouseSensitivity = 0.0022;
  touchSensitivity = 0.0065;
  readonly isTouch: boolean;
  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private readonly held = new Set<string>();
  private readonly actions: Action[] = [];
  private joyId = -1;
  private joyOrigin = [0, 0];
  private joyVec = [0, 0];
  private lookId = -1;
  private lookLast = [0, 0];
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly buttonBar: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.canvas = canvas;
    this.isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.append(this.joyKnob);
    this.joyBase.hidden = true;
    this.buttonBar = document.createElement('div');
    this.buttonBar.className = 'touch-buttons';
    this.buttonBar.hidden = !this.isTouch;
    ui.append(this.joyBase, this.buttonBar);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) this.rotate(e.movementX * this.mouseSensitivity, e.movementY * this.mouseSensitivity);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Adds an on-screen touch button. `action` fires on press; `hold` is readable via isHeld(). */
  addTouchButton(label: string, opts: { action?: Action; hold?: string; className?: string }): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = `touch-btn ${opts.className ?? ''}`;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (opts.action) this.actions.push(opts.action);
      if (opts.hold) this.held.add(opts.hold);
    });
    const release = () => {
      if (opts.hold) this.held.delete(opts.hold);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    this.buttonBar.append(b);
    return b;
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }

  /** [strafe (+right), forward (+forward)], length ≤ 1. */
  moveVector(): [number, number] {
    let x = this.joyVec[0]!;
    let y = this.joyVec[1]!;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? [x / len, y / len] : [x, y];
  }

  vertical(): number {
    let v = 0;
    if (this.keys.has('Space') || this.held.has('up')) v += 1;
    if (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.held.has('down')) v -= 1;
    return v;
  }

  jumpHeld(): boolean {
    return this.keys.has('Space') || this.held.has('jump');
  }

  sprint(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.joyVec[0]!, this.joyVec[1]!) > 0.95;
  }

  takeActions(): Action[] {
    return this.actions.splice(0, this.actions.length);
  }

  private rotate(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down) {
      if (!e.repeat && e.code === 'KeyE') this.actions.push('spawn');
      if (!e.repeat && e.code === 'KeyF') this.actions.push('toggleFly');
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (this.pointerLocked) {
        this.actions.push('blast');
      } else {
        const p = this.canvas.requestPointerLock?.() as unknown;
        if (p instanceof Promise) p.catch(() => undefined);
        this.lookId = e.pointerId; // drag-to-look until the lock engages
        this.lookLast = [e.clientX, e.clientY];
      }
      return;
    }
    this.canvas.setPointerCapture?.(e.pointerId);
    if (e.clientX < window.innerWidth * 0.4 && this.joyId < 0) {
      this.joyId = e.pointerId;
      this.joyOrigin = [e.clientX, e.clientY];
      this.joyVec = [0, 0];
      this.joyBase.hidden = false;
      this.joyBase.style.left = `${e.clientX - JOY_RADIUS}px`;
      this.joyBase.style.top = `${e.clientY - JOY_RADIUS}px`;
      this.joyKnob.style.transform = 'translate(0px, 0px)';
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lookLast = [e.clientX, e.clientY];
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      let dx = e.clientX - this.joyOrigin[0]!;
      let dy = e.clientY - this.joyOrigin[1]!;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS;
        dy = (dy / len) * JOY_RADIUS;
      }
      this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joyVec = [dx / JOY_RADIUS, -dy / JOY_RADIUS];
    } else if (e.pointerId === this.lookId && !this.pointerLocked) {
      const s = e.pointerType === 'mouse' ? this.mouseSensitivity * 1.5 : this.touchSensitivity;
      this.rotate((e.clientX - this.lookLast[0]!) * s, (e.clientY - this.lookLast[1]!) * s);
      this.lookLast = [e.clientX, e.clientY];
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      this.joyId = -1;
      this.joyVec = [0, 0];
      this.joyBase.hidden = true;
    }
    if (e.pointerId === this.lookId) this.lookId = -1;
  }
}
