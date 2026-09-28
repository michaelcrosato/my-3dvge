/**
 * PATHBREAKERS UI (DOM overlay): title/level select, briefing, HUD (timer, $ damage, objective counters,
 * vehicle meter, prompts, radio messages, warnings and COLLISION IMMINENT banner, next-obstacle arrow),
 * radar, flashing arrows over blocking buildings, pause/settings, results with medals, failure screen.
 *
 * Touch buttons (created by the client in `.touch-buttons`) are styled by class name:
 * `pb-action`, `pb-jump`, `pb-enter`, `pb-cam`, `pb-reset` (bottom-right cluster) and `pb-pause`,
 * `pb-carrier` (pinned to the top of the screen). Prompts like "E  Enter PLOWHORSE" get their key
 * translated for the active input device (keyboard / gamepad / touch).
 */
import './ui.css';
import type {
  CameraMode, GameEvent, GameSnapshot, LevelId, LevelStatic, MissionResults, ModeId, SaveData,
} from '../../shared/types.ts';
import { el, setClass } from './dom.ts';
import type { InputDevice } from './format.ts';
import { Hud } from './hud.ts';
import { Markers } from './markers.ts';
import { Screens } from './screens.ts';

export interface UIHooks {
  /** Load a level (engine restart) and show its briefing. */
  startLevel(level: LevelId, mode: ModeId): void;
  /** Briefing → debrief flyover → countdown. */
  beginMission(): void;
  skipFlyover(): void;
  pause(): void;
  resume(): void;
  /** Retry the current level and mode instantly. */
  restart(): void;
  quitToTitle(): void;
  /** After the path is clear: end now and show results. */
  finishMission(): void;
  setCamera(mode: CameraMode): void;
  fastForward(on: boolean): void;
  setSetting<K extends keyof SaveData['settings']>(key: K, value: SaveData['settings'][K]): void;
  toggleDebugHud(): void;
  copyDiagnostics(): Promise<boolean>;
  save(): SaveData;
  /** UI sounds. */
  sound(name: 'uiClick' | 'uiBack' | 'uiMove'): void;
}

/** World → screen (CSS px). */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };

export interface CameraInfo {
  mode: CameraMode;
  /** Camera yaw (radians, 0 looks down -z) — for rotating the radar. */
  yaw: number;
}

export interface GameUI {
  mount(root: HTMLElement, hooks: UIHooks): void;
  setLevel(level: LevelStatic): void;
  showTitle(save: SaveData): void;
  showBriefing(level: LevelStatic, mode: ModeId, save: SaveData): void;
  showPause(): void;
  showResults(results: MissionResults, save: SaveData): void;
  showFailed(reason: string): void;
  hideScreens(): void;
  /** Per rendered frame with the latest snapshot. */
  update(snap: GameSnapshot | null, dt: number, project: Projector, camera: CameraInfo): void;
  onEvents(events: GameEvent[]): void;
  /** True while a menu screen is open (gameplay input is ignored). */
  readonly blocking: boolean;
}

/** Gameplay input stays suppressed this long after a menu consumed a key/button (no leaking presses). */
const MENU_INPUT_GRACE_MS = 220;

class PathbreakersUI implements GameUI {
  private root: HTMLElement | null = null;
  private hooks: UIHooks | null = null;
  private hud!: Hud;
  private markers!: Markers;
  private screens!: Screens;
  private level: LevelStatic | null = null;
  private device: InputDevice = 'keyboard';
  private camera: CameraInfo = { mode: 'overhead', yaw: 0 };
  private padCheck = 0;

  get blocking(): boolean {
    if (!this.screens) return false;
    return this.screens.open || performance.now() - this.screens.nav.lastInput < MENU_INPUT_GRACE_MS;
  }

  mount(root: HTMLElement, hooks: UIHooks): void {
    this.root = root;
    this.hooks = hooks;
    root.classList.add('pb-game');
    const getHooks = () => this.hooks!;
    this.hud = new Hud(getHooks);
    this.markers = new Markers();
    this.screens = new Screens(getHooks);
    const layer = el('div', 'pb');
    layer.append(this.markers.root, this.hud.root, this.screens.root);
    root.append(layer);

    window.addEventListener('keydown', () => this.setDevice('keyboard'), { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => this.setDevice(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'keyboard'), { capture: true, passive: true });
    window.addEventListener('resize', () => this.hud.resize());
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) this.setDevice('touch');
    requestAnimationFrame(() => this.hud.resize());
  }

  private setDevice(d: InputDevice): void {
    if (d === this.device) return;
    this.device = d;
    if (this.screens) this.screens.device = d;
    if (this.root) {
      this.root.classList.remove('pb-dev-keyboard', 'pb-dev-gamepad', 'pb-dev-touch');
      this.root.classList.add(`pb-dev-${d}`);
    }
  }

  private syncBlocking(): void {
    if (this.root) setClass(this.root, 'pb-blocking', this.screens.open);
  }

  setLevel(level: LevelStatic): void {
    this.level = level;
    this.hud.setLevel(level);
    this.markers.setLevel(level);
  }

  showTitle(save: SaveData): void {
    this.markers.clearTransient();
    this.screens.showTitle(save);
    this.syncBlocking();
  }

  showBriefing(level: LevelStatic, mode: ModeId, save: SaveData): void {
    if (this.level !== level) this.setLevel(level);
    this.screens.showBriefing(level, mode, save);
    this.syncBlocking();
  }

  showPause(): void {
    this.screens.cameraMode = this.camera.mode;
    this.screens.showPause();
    this.syncBlocking();
  }

  showResults(results: MissionResults, save: SaveData): void {
    this.screens.showResults(results, save);
    this.syncBlocking();
  }

  showFailed(reason: string): void {
    const tips = this.level?.tips ?? [];
    const tip = tips.length ? tips[Math.floor(Math.random() * tips.length)]! : null;
    this.screens.showFailed(reason, tip);
    this.syncBlocking();
  }

  hideScreens(): void {
    this.screens.close();
    this.syncBlocking();
  }

  update(snap: GameSnapshot | null, dt: number, project: Projector, camera: CameraInfo): void {
    if (!this.root) return;
    this.camera = camera;
    this.padCheck += dt;
    if (this.padCheck > 0.25) {
      this.padCheck = 0;
      this.detectGamepad();
    }
    const d = Math.min(0.1, Math.max(0, dt));
    this.hud.update(snap, d, camera, this.device);
    const state = snap?.state;
    const showArrows = state === 'running' || state === 'flyover' || state === 'countdown';
    this.markers.update(snap, d, project, showArrows && !this.screens.open);
  }

  private detectGamepad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      if (gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > 0.5)) {
        this.setDevice('gamepad');
        return;
      }
    }
  }

  onEvents(events: GameEvent[]): void {
    if (!this.root) return;
    this.hud.onEvents(events);
    this.markers.onEvents(events);
  }
}

export function createGameUI(): GameUI {
  return new PathbreakersUI();
}
