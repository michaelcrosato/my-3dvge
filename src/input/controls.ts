/**
 * Unified input: keyboard + pointer-lock mouse on desktop; a floating virtual joystick (left side),
 * drag-to-look (right side) and on-screen buttons on touch devices; standard-mapping gamepads.
 * Held state is queryable any time; presses are edge-detected per rendered frame (call endFrame()).
 */
export type Action = string;

const JOY_RADIUS = 60;
const MAX_PITCH = Math.PI / 2 - 0.01;
const DEADZONE = 0.16;
const GAMEPAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right'] as const;

export interface GamepadState {
  connected: boolean;
  move: [number, number];
  look: [number, number];
  /** Analog triggers 0..1. */
  lt: number;
  rt: number;
  held: Set<string>;
  pressed: Set<string>;
}

function dead(v: number): number {
  const a = Math.abs(v);
  return a < DEADZONE ? 0 : (Math.sign(v) * (a - DEADZONE)) / (1 - DEADZONE);
}

export class Controls {
  yaw = 0;
  pitch = 0;
  mouseSensitivity = 0.0022;
  touchSensitivity = 0.0065;
  gamepadLookSpeed = 2.6;
  /** Action pushed on a pointer-locked left click (null: none — read isKeyDown('Mouse0') instead). */
  clickAction: Action | null = 'blast';
  /** Whether clicking the canvas requests pointer lock. */
  pointerLockEnabled = true;
  readonly isTouch: boolean;
  readonly gamepad: GamepadState = { connected: false, move: [0, 0], look: [0, 0], lt: 0, rt: 0, held: new Set(), pressed: new Set() };
  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private readonly keysPressed = new Set<string>();
  private readonly held = new Set<string>();
  private readonly actions: Action[] = [];
  private joyId = -1;
  private joyOrigin = [0, 0];
  private joyVec = [0, 0];
  private lookId = -1;
  private lookLast = [0, 0];
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  readonly buttonBar: HTMLDivElement;

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
    window.addEventListener('mouseup', (e) => {
      this.keys.delete(`Mouse${e.button}`);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Adds an on-screen touch button. `action` fires on press; `hold` is readable via isHeld(). */
  addTouchButton(label: string, opts: { action?: Action; hold?: string; className?: string; parent?: HTMLElement }): HTMLButtonElement {
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
    (opts.parent ?? this.buttonBar).append(b);
    return b;
  }

  /** Removes all touch buttons from the default bar. */
  clearTouchButtons(): void {
    this.buttonBar.replaceChildren();
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True if the key went down since the last endFrame(). */
  keyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** Pushes a synthetic action (UI buttons, etc.). */
  pushAction(a: Action): void {
    this.actions.push(a);
  }

  /** [strafe (+right), forward (+forward)], length ≤ 1. */
  moveVector(): [number, number] {
    let x = this.joyVec[0]! + this.gamepad.move[0];
    let y = this.joyVec[1]! + this.gamepad.move[1];
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
    return this.keys.has('Space') || this.held.has('jump') || this.gamepad.held.has('a');
  }

  sprint(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.gamepad.held.has('ls') || Math.hypot(this.joyVec[0]!, this.joyVec[1]!) > 0.95;
  }

  takeActions(): Action[] {
    return this.actions.splice(0, this.actions.length);
  }

  /** Reads the first connected gamepad (standard mapping); right stick rotates yaw/pitch. */
  pollGamepad(dt: number): void {
    const gp = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    const s = this.gamepad;
    s.pressed.clear();
    if (!gp) {
      s.connected = false;
      s.move = [0, 0];
      s.look = [0, 0];
      s.held.clear();
      s.lt = s.rt = 0;
      return;
    }
    s.connected = true;
    s.move = [dead(gp.axes[0] ?? 0), -dead(gp.axes[1] ?? 0)];
    s.look = [dead(gp.axes[2] ?? 0), dead(gp.axes[3] ?? 0)];
    s.lt = gp.buttons[6]?.value ?? 0;
    s.rt = gp.buttons[7]?.value ?? 0;
    GAMEPAD_BUTTONS.forEach((name, i) => {
      const down = gp.buttons[i]?.pressed ?? false;
      if (down && !s.held.has(name)) s.pressed.add(name);
      if (down) s.held.add(name);
      else s.held.delete(name);
    });
    if (s.look[0] || s.look[1]) this.rotate(s.look[0] * this.gamepadLookSpeed * dt, s.look[1] * this.gamepadLookSpeed * dt);
  }

  /** Clears per-frame edge state. */
  endFrame(): void {
    this.keysPressed.clear();
  }

  private rotate(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down) {
      if (!e.repeat) {
        this.keysPressed.add(e.code);
        if (e.code === 'KeyE') this.actions.push('spawn');
        if (e.code === 'KeyF') this.actions.push('toggleFly');
      }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.keys.add(`Mouse${e.button}`);
      this.keysPressed.add(`Mouse${e.button}`);
      if (e.button !== 0) return;
      if (this.pointerLocked) {
        if (this.clickAction) this.actions.push(this.clickAction);
      } else {
        if (this.pointerLockEnabled) {
          const p = this.canvas.requestPointerLock?.() as unknown;
          if (p instanceof Promise) p.catch(() => undefined);
        }
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
    if (e.pointerType === 'mouse') this.keys.delete(`Mouse${e.button}`);
    if (e.pointerId === this.joyId) {
      this.joyId = -1;
      this.joyVec = [0, 0];
      this.joyBase.hidden = true;
    }
    if (e.pointerId === this.lookId) this.lookId = -1;
  }
}
