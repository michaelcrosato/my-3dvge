/**
 * PATHBREAKERS UI (DOM overlay): title/level select, briefing, HUD (timer, $ damage, objective counters,
 * vehicle meter, prompts, radio messages, warnings and COLLISION IMMINENT banner, next-obstacle arrow),
 * radar, flashing arrows over blocking buildings, pause/settings, results with medals, failure screen.
 * This file is the contract; the stub below renders a minimal HUD until the UI pass.
 */
import type {
  CameraMode, GameEvent, GameSnapshot, LevelId, LevelStatic, MissionResults, ModeId, SaveData,
} from '../../shared/types.ts';

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

export function createGameUI(): GameUI {
  let root: HTMLElement;
  let hooks: UIHooks;
  let screen: HTMLDivElement;
  let hud: HTMLPreElement;
  let blocking = false;
  const show = (html: string, buttons: [string, () => void][]) => {
    blocking = true;
    screen.hidden = false;
    screen.innerHTML = html;
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      screen.append(b);
    }
  };
  return {
    get blocking() {
      return blocking;
    },
    mount(r, h) {
      root = r;
      hooks = h;
      screen = document.createElement('div');
      screen.className = 'pb-screen-stub';
      screen.style.cssText = 'position:absolute;inset:20% 20%;background:#000c;color:#fff;padding:20px;pointer-events:auto';
      hud = document.createElement('pre');
      hud.style.cssText = 'position:absolute;left:8px;bottom:8px;margin:0;color:#fff;text-shadow:0 1px 2px #000';
      root.append(screen, hud);
    },
    setLevel() {},
    showTitle() {
      show('<h1>PATHBREAKERS</h1>', [['Cinder Flats', () => hooks.startLevel('cinder', 'mission')], ['Quarry Rumble', () => hooks.startLevel('quarry', 'mission')]]);
    },
    showBriefing(level, mode) {
      show(`<h2>${level.title}</h2><p>${level.briefing.join('<br>')}</p>`, [['Start', () => hooks.beginMission()]]);
      void mode;
    },
    showPause() {
      show('<h2>Paused</h2>', [['Resume', () => hooks.resume()], ['Restart', () => hooks.restart()], ['Quit', () => hooks.quitToTitle()]]);
    },
    showResults(res) {
      show(`<h2>Results</h2><pre>${JSON.stringify(res, null, 1)}</pre>`, [['Retry', () => hooks.restart()], ['Title', () => hooks.quitToTitle()]]);
    },
    showFailed(reason) {
      show(`<h2>MISSION FAILED</h2><p>${reason}</p>`, [['Retry', () => hooks.restart()], ['Title', () => hooks.quitToTitle()]]);
    },
    hideScreens() {
      blocking = false;
      screen.hidden = true;
    },
    update(snap) {
      if (!snap) return;
      hud.textContent = `${snap.state} t=${snap.time.toFixed(1)} eta=${snap.carrier?.eta?.toFixed(1) ?? '-'} ${snap.prompt ?? ''}\n$${snap.counts.damage} bld ${snap.counts.buildings.join('/')} rdu ${snap.counts.rdus.join('/')}`;
    },
    onEvents() {},
  };
}
