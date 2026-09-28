/**
 * PATHBREAKERS main-thread client: flow (title → briefing → play → results), input mapping for
 * keyboard/mouse, gamepad and touch, the camera rig, in-world markers, audio and UI glue.
 */
import * as THREE from 'three/webgpu';
import type { Engine } from '../../app/engine.ts';
import type { GameClient } from '../../app/game-client.ts';
import { copyText } from '../../debug/clipboard.ts';
import type {
  CameraMode, ClientMessage, GameEvent, GameInput, GameSnapshot, LevelId, LevelStatic, MissionResults, ModeId, SaveData, SimMessage,
} from '../shared/types.ts';
import { CAMERA_MODES } from '../shared/types.ts';
import { createGameAudio, type GameAudio, type SfxName } from './audio/index.ts';
import { CameraRig } from './camera.ts';
import { Markers } from './markers.ts';
import { loadSave, recordResults, writeSave } from './save.ts';
import { createGameUI, type GameUI, type UIHooks } from './ui/index.ts';

type Flow = 'title' | 'loading' | 'briefing' | 'playing' | 'paused' | 'results' | 'failed';

const MAX_SPEED: Record<string, number> = { dozer: 9, truck: 15, buggy: 21, bike: 22, mech: 9, train: 7, semi: 1 };

declare global {
  interface Window {
    __pathbreakers?: {
      readonly flow: Flow;
      readonly snapshot: GameSnapshot | null;
      readonly level: LevelStatic | null;
      readonly events: GameEvent[];
      start(level: LevelId, mode: ModeId): void;
      begin(): void;
      send(msg: ClientMessage): void;
      setCamera(mode: CameraMode): void;
    };
  }
}

class PathbreakersClient implements GameClient {
  private engine!: Engine;
  private readonly ui: GameUI = createGameUI();
  private readonly audio: GameAudio = createGameAudio();
  private readonly rig = new CameraRig();
  private readonly markers = new Markers();
  private save: SaveData = loadSave();
  private flow: Flow = 'title';
  private level: LevelStatic | null = null;
  private snap: GameSnapshot | null = null;
  private currentLevel: LevelId = 'cinder';
  private mode: ModeId = 'mission';
  private pending: { level: LevelId; mode: ModeId; quick: boolean } | null = null;
  private readonly counters = { enter: 0, reset: 0, action: 0, jump: 0 };
  private actionWas = false;
  private jumpWas = false;
  private readonly target = { pos: new THREE.Vector3(), heading: 0, vehicle: null as GameSnapshot['player']['vehicle'], speed: 0 };
  private readonly tmpQ = new THREE.Quaternion();
  private readonly carrierPos = new THREE.Vector3();
  private readonly lanePoint = new THREE.Vector3();
  private readonly projV = new THREE.Vector3();
  private readonly recent: GameEvent[] = [];
  private fuses: number[] = [];
  private lastAligned = false;
  private flowTimer = 0;
  private screenAfter: { at: number; show: () => void } | null = null;
  private throttleHeld = 0;
  private fastButton: HTMLButtonElement | null = null;
  private loading: HTMLDivElement | null = null;

  async attach(engine: Engine): Promise<void> {
    this.engine = engine;
    this.currentLevel = engine.params.scene === 'quarry' ? 'quarry' : 'cinder';
    engine.ui.classList.add('pb-game');
    engine.scene.add(this.markers.root);
    engine.hud.toggleButton.hidden = !engine.params.debug;
    engine.controls.clickAction = null;
    this.rig.mode = this.save.settings.camera;
    this.buildTouchControls();
    this.ui.mount(engine.ui, this.hooks());
    this.audio.setVolumes(this.save.settings.music, this.save.settings.sfx);
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false });
    this.ui.showTitle(this.save);
    this.audio.setMusic('title', 0);
    this.installDebugHandle();
  }

  // ---------------------------------------------------------------- UI hooks

  private hooks(): UIHooks {
    return {
      startLevel: (level, mode) => this.startLevel(level, mode, false),
      beginMission: () => this.beginMission(),
      skipFlyover: () => this.send({ t: 'skipFlyover' }),
      pause: () => this.pause(),
      resume: () => this.resume(),
      restart: () => this.startLevel(this.currentLevel, this.mode, true),
      quitToTitle: () => this.quitToTitle(),
      finishMission: () => this.send({ t: 'finish' }),
      setCamera: (mode) => this.setCamera(mode),
      fastForward: (on) => this.send({ t: 'fastForward', on }),
      setSetting: (key, value) => {
        (this.save.settings as Record<string, unknown>)[key] = value;
        writeSave(this.save);
        if (key === 'music' || key === 'sfx') this.audio.setVolumes(this.save.settings.music, this.save.settings.sfx);
        if (key === 'camera') this.setCamera(value as CameraMode);
        if (key === 'assist') this.engine.sendGame({ t: 'assist', on: value });
      },
      toggleDebugHud: () => {
        const hud = this.engine.hud;
        hud.setVisible(!hud.visible);
        hud.toggleButton.hidden = false;
      },
      copyDiagnostics: () => copyText(JSON.stringify(this.engine.diagnostics(), null, 2)),
      save: () => this.save,
      sound: (name) => this.audio.play(name),
    };
  }

  private send(msg: ClientMessage): void {
    this.engine.sendGame(msg);
  }

  private startLevel(level: LevelId, mode: ModeId, quick: boolean): void {
    this.pending = { level, mode, quick };
    this.mode = mode;
    this.currentLevel = level;
    const fresh = this.engine.params.scene === level && this.snap?.state === 'briefing' && this.level?.level === level;
    this.ui.hideScreens();
    if (fresh && !quick) {
      this.showBriefing();
      return;
    }
    this.flow = 'loading';
    if (this.loading) {
      this.loading.hidden = false;
      const text = this.loading.querySelector('.pb-loading-text');
      if (text) text.textContent = `LOADING ${level === 'quarry' ? 'QUARRY RUMBLE' : 'CINDER FLATS'}…`;
    }
    this.level = null;
    this.snap = null;
    this.fuses = [];
    this.engine.restart({ scene: level });
    this.rig.setScript('title');
  }

  private showBriefing(): void {
    if (!this.level || !this.pending) return;
    this.flow = 'briefing';
    this.ui.showBriefing(this.level, this.pending.mode, this.save);
    this.audio.setMusic(this.level.level === 'quarry' ? 'bonus' : 'title', 0);
  }

  private beginMission(): void {
    this.ui.hideScreens();
    this.send({ t: 'start', mode: this.mode });
    this.send({ t: 'assist', on: this.save.settings.assist } as unknown as ClientMessage);
    this.flow = 'playing';
    this.rig.setScript('flyover');
    this.audio.setMusic(this.currentLevel === 'quarry' ? 'bonus' : 'mission', 0.2);
    if (this.pending?.quick) this.send({ t: 'skipFlyover' });
    this.pending = null;
  }

  private pause(): void {
    if (this.flow !== 'playing') return;
    this.flow = 'paused';
    this.engine.setPaused(true);
    this.ui.showPause();
    this.audio.setEngine(null, 0, 0);
    this.audio.setAlarm(0);
  }

  private resume(): void {
    if (this.flow !== 'paused') return;
    this.flow = 'playing';
    this.engine.setPaused(false);
    this.ui.hideScreens();
  }

  private quitToTitle(): void {
    this.engine.setPaused(false);
    this.pending = null;
    this.flow = 'title';
    this.ui.hideScreens();
    this.ui.showTitle(this.save);
    this.audio.setMusic('title', 0);
    this.audio.setAlarm(0);
    this.audio.setEngine(null, 0, 0);
    this.rig.setScript('title');
    if (this.snap?.state !== 'briefing' || this.engine.params.scene !== 'cinder') {
      this.currentLevel = 'cinder';
      this.level = null;
      this.snap = null;
      this.engine.restart({ scene: 'cinder' });
    }
  }

  private setCamera(mode: CameraMode): void {
    this.rig.mode = mode;
    this.rig.orbit = 0;
    this.save.settings.camera = mode;
    writeSave(this.save);
    this.engine.controls.pointerLockEnabled = mode === 'chase' || mode === 'cockpit' || mode === 'overhead';
    if (!this.engine.controls.pointerLockEnabled && document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------- touch

  private buildTouchControls(): void {
    const c = this.engine.controls;
    c.clearTouchButtons();
    c.addTouchButton('ACTION', { hold: 'action', className: 'primary pb-action' });
    c.addTouchButton('JUMP', { hold: 'jump', className: 'pb-jump' });
    c.addTouchButton('ENTER', { action: 'enter', className: 'pb-enter' });
    c.addTouchButton('CAM', { action: 'cam', className: 'pb-cam' });
    c.addTouchButton('RESET', { action: 'reset', className: 'pb-reset' });
    const top = document.createElement('div');
    top.className = 'touch-top';
    top.hidden = !c.isTouch;
    this.engine.ui.append(top);
    c.addTouchButton('❚❚', { action: 'pause', className: 'pb-pause', parent: top });
    c.addTouchButton('CARRIER', { hold: 'carrierCam', className: 'pb-carrier', parent: top });
    this.fastButton = c.addTouchButton('▶▶', { action: 'fast', className: 'pb-carrier pb-fast', parent: top });
    this.fastButton.hidden = true;
    this.loading = document.createElement('div');
    this.loading.className = 'pb-loading';
    this.loading.innerHTML = '<div class="pb-loading-card"><div class="pb-loading-stripes"></div><div class="pb-loading-text">LOADING</div></div>';
    this.loading.hidden = true;
    this.engine.ui.append(this.loading);
  }

  // ---------------------------------------------------------------- engine callbacks

  onReady(): void {
    this.rig.cut();
    this.send({ t: 'hello' } as unknown as ClientMessage);
  }

  onMessage(data: unknown): void {
    const msg = data as SimMessage;
    if (msg.k === 'static') {
      this.level = msg.data;
      this.rig.level = msg.data;
      this.ui.setLevel(msg.data);
      this.markers.setLevel(msg.data);
      if (this.loading) this.loading.hidden = true;
      if (this.flow === 'loading' && this.pending) {
        if (this.pending.quick) this.beginMission();
        else this.showBriefing();
      }
    } else if (msg.k === 'snap') {
      const prev = this.snap;
      this.snap = msg.data;
      if (msg.data.aligned && !this.lastAligned) this.audio.play('aligned');
      this.lastAligned = msg.data.aligned;
      if (prev && prev.state !== msg.data.state) this.onState(msg.data.state);
    } else if (msg.k === 'events') {
      this.ui.onEvents(msg.list);
      for (const e of msg.list) this.onEvent(e);
    }
  }

  private onState(state: GameSnapshot['state']): void {
    if (state === 'countdown' || state === 'running') this.rig.setScript('play');
  }

  private at(e: { x: number; y: number; z: number }): [number, number, number] {
    return [e.x, e.y, e.z];
  }

  private onEvent(e: GameEvent): void {
    this.recent.push(e);
    if (this.recent.length > 200) this.recent.splice(0, 100);
    const sfx = (name: SfxName, opts?: Parameters<GameAudio['play']>[1]) => this.audio.play(name, opts);
    const dist = (x: number, z: number) => Math.hypot(x - this.target.pos.x, z - this.target.pos.z);
    switch (e.e) {
      case 'collapse':
        sfx('collapse', { at: this.at(e) });
        sfx('crumble', { at: this.at(e) });
        this.rig.shake(Math.max(0, 0.9 - dist(e.x, e.z) / 60));
        break;
      case 'explosion':
        sfx(e.radius > 5 ? 'bigExplosion' : 'explosion', { at: this.at(e) });
        this.rig.shake(Math.max(0, (e.radius / 4) * (1 - dist(e.x, e.z) / 70)));
        break;
      case 'hit':
        sfx(e.strength > 600 ? 'crumble' : 'impact', { at: this.at(e), volume: Math.min(1, 0.4 + e.strength / 1500) });
        this.rig.shake(Math.min(0.35, e.strength / 3000));
        break;
      case 'rdu':
        sfx('rdu', { pitch: 1 + (e.n % 8) * 0.04 });
        if (e.index !== undefined) this.markers.lightRdu(e.index);
        break;
      case 'survivorFreed':
        sfx('survivor', { at: this.at(e) });
        break;
      case 'survivorRescued':
        sfx('rescue');
        break;
      case 'dish':
        sfx('dish');
        break;
      case 'enter':
        sfx('enter');
        break;
      case 'exit':
        sfx('exit');
        this.audio.setLoop('slide', false);
        this.audio.setLoop('thrust', false);
        break;
      case 'radio':
        sfx('radio');
        break;
      case 'warning':
        if (e.level >= 3) sfx('warning');
        break;
      case 'pathClear':
        sfx('pathClear');
        break;
      case 'carrierSafe':
        sfx('carrierSafe');
        break;
      case 'countdown':
        sfx('countdown');
        this.rig.setScript('play');
        break;
      case 'go':
        sfx('go');
        break;
      case 'fuse':
        sfx('fuse');
        this.fuses.push(e.seconds);
        break;
      case 'fire':
        sfx('missile', { at: this.at(e) });
        break;
      case 'stomp':
        sfx('stomp', { at: this.at(e) });
        this.rig.shake(0.8);
        break;
      case 'turbo':
        sfx('turbo');
        break;
      case 'slide':
        this.audio.setLoop('slide', e.on);
        break;
      case 'thrust':
        this.audio.setLoop('thrust', e.on);
        if (e.on) sfx('thrustStart');
        break;
      case 'horn':
        sfx('horn');
        break;
      case 'land':
        sfx('land', { volume: 0.4 + e.strength * 0.6 });
        break;
      case 'reset':
        sfx('reset');
        break;
      case 'pickup':
        sfx('pickup');
        break;
      case 'gapFilled':
        sfx('aligned');
        break;
      case 'fail': {
        sfx('fail');
        this.rig.setScript('fail', new THREE.Vector3(e.x, e.y, e.z));
        this.rig.shake(1.6);
        this.flow = 'failed';
        this.audio.setMusic('none', 0);
        this.audio.setAlarm(0);
        this.audio.setEngine(null, 0, 0);
        const reason = e.reason;
        this.screenAfter = { at: this.flowTimer + 2.8, show: () => this.ui.showFailed(reason) };
        break;
      }
      case 'results': {
        const r: MissionResults = e.results;
        const before = JSON.parse(JSON.stringify(this.save)) as SaveData;
        recordResults(this.save, r);
        this.flow = 'results';
        this.audio.setAlarm(0);
        this.audio.setEngine(null, 0, 0);
        this.audio.setMusic('results', 0);
        if (r.medals.carrier || r.medals.completion || r.medals.time) sfx('medal');
        this.screenAfter = { at: this.flowTimer + 1.8, show: () => this.ui.showResults(r, before) };
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- per frame

  private gatherInput(): GameInput | null {
    const c = this.engine.controls;
    const gp = c.gamepad;
    for (const a of c.takeActions()) {
      if (a === 'enter') this.counters.enter++;
      else if (a === 'reset') this.counters.reset++;
      else if (a === 'cam') this.cycleCamera();
      else if (a === 'pause') this.pause();
      else if (a === 'fast') this.send({ t: 'fastForward', on: !this.snap?.carrier?.fastForward });
    }
    if (this.snap?.state === 'flyover' && (c.keyPressed('Enter') || c.keyPressed('Space') || gp.pressed.has('a') || gp.pressed.has('start'))) this.send({ t: 'skipFlyover' });
    if (c.keyPressed('KeyE') || gp.pressed.has('y')) this.counters.enter++;
    if (c.keyPressed('KeyR') || gp.pressed.has('b')) this.counters.reset++;
    if (c.keyPressed('KeyC') || gp.pressed.has('back')) this.cycleCamera();
    if (c.keyPressed('Escape') || c.keyPressed('KeyP') || gp.pressed.has('start')) this.pause();
    if (c.keyPressed('KeyF')) this.send({ t: 'fastForward', on: !this.snap?.carrier?.fastForward });
    if (this.rig.mode === 'iso') {
      if (c.keyPressed('KeyZ') || gp.pressed.has('left')) this.rig.isoTurns--;
      if (c.keyPressed('KeyX') || gp.pressed.has('right')) this.rig.isoTurns++;
    }
    for (const [i, mode] of CAMERA_MODES.entries()) if (c.keyPressed(`Digit${i + 1}`)) this.setCamera(mode);
    const action = c.isKeyDown('ShiftLeft') || c.isKeyDown('ShiftRight') || c.isKeyDown('KeyK') || c.isKeyDown('Mouse0') || c.isHeld('action') || gp.held.has('x') || gp.held.has('rb');
    const jump = c.jumpHeld();
    if (action && !this.actionWas) this.counters.action++;
    if (jump && !this.jumpWas) this.counters.jump++;
    this.actionWas = action;
    this.jumpWas = jump;
    const move = c.moveVector();
    let my = move[1] + (gp.rt - gp.lt);
    my = Math.max(-1, Math.min(1, my));
    this.throttleHeld = Math.abs(my);
    const onFoot = this.snap?.player.onFoot ?? true;
    return {
      move: [move[0], my],
      camYaw: this.rig.yaw,
      relative: this.rig.relativeInput(onFoot),
      lookYaw: c.yaw,
      lookPitch: c.pitch,
      jump,
      action,
      sprint: c.sprint() || action,
      actionCount: this.counters.action,
      jumpCount: this.counters.jump,
      enter: this.counters.enter,
      reset: this.counters.reset,
    };
  }

  private cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.rig.mode);
    this.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]!);
    this.audio.play('uiMove');
  }

  update(dt: number): void {
    this.flowTimer += dt;
    if (this.screenAfter && this.flowTimer >= this.screenAfter.at) {
      this.screenAfter.show();
      this.screenAfter = null;
    }
    const engine = this.engine;
    const snap = this.snap;

    // Input → simulation.
    if (this.flow === 'playing' && !this.ui.blocking) {
      const input = this.gatherInput();
      if (input) this.send({ t: 'input', input });
    } else {
      engine.controls.takeActions();
    }

    // Camera target: interpolated pose of the controlled entity.
    if (snap) {
      const slot = snap.player.slot;
      if (engine.slotPose(slot, this.target.pos, this.tmpQ)) {
        if (snap.player.onFoot) this.target.pos.y -= 0.2;
        else {
          const box = this.target.pos;
          const vid = snap.player.vehicleId;
          const view = vid !== null ? engine.world.volumes.get(vid) : undefined;
          if (view) {
            // Slot pose is the model's min corner; aim at the model's center.
            const s = view.info.size;
            this.projV.set((s[0] * 0.1) / 2, (s[1] * 0.1) / 2, (s[2] * 0.1) / 2).applyQuaternion(this.tmpQ);
            box.add(this.projV);
          }
        }
      } else {
        this.target.pos.set(snap.player.x, snap.player.y, snap.player.z);
      }
      this.target.heading = snap.player.heading;
      this.target.vehicle = snap.player.vehicle;
      this.target.speed = snap.player.speed;
      if (snap.carrier && engine.slotPose(snap.carrier.slot, this.carrierPos, this.tmpQ)) {
        this.carrierPos.set(snap.carrier.x, 1.3, snap.carrier.z);
        const next = snap.carrier.next;
        const st = next !== null && next > 0 ? this.level?.structures.find((s) => s.id === next) : null;
        this.lanePoint.set(st ? st.x : snap.carrier.x + 30, 1, snap.carrier.z);
      }
    }
    const carrierHeld = engine.controls.isHeld('carrierCam') || engine.controls.isKeyDown('KeyV') || engine.controls.gamepad.held.has('lb');
    if (this.rig.script === 'play' || this.rig.script === 'carrier') this.rig.setScript(carrierHeld && snap?.carrier ? 'carrier' : 'play');
    if (this.flow === 'title' || this.flow === 'loading') this.rig.setScript('title');
    const look = { yaw: engine.controls.yaw, pitch: engine.controls.pitch };
    if (this.rig.mode !== 'cockpit' || !snap?.player.onFoot) this.rig.orbit = 0;
    this.rig.update(dt, engine.camera, this.target, look, snap?.carrier ? this.carrierPos : null, this.lanePoint);
    // In mouse-look modes the look yaw drives the on-foot heading; keep them in sync so cameras don't fight.
    if (this.rig.script === 'play' && this.rig.mode !== 'cockpit' && snap?.player.onFoot === false) engine.controls.yaw = this.rig.yaw;
    const ground = engine.world.volumes.size ? 0 : 0;
    if (engine.camera.position.y < ground + 0.8 && this.rig.mode !== 'cockpit') engine.camera.position.y = ground + 0.8;
    engine.setViewOffset(this.rig.script === 'title' ? 90 : this.rig.distance());
    engine.shadowFocus = this.rig.script === 'play' ? this.target.pos : null;

    this.markers.update(snap, dt);

    // Audio.
    const a = this.audio;
    a.setListener([engine.camera.position.x, engine.camera.position.y, engine.camera.position.z], this.rig.yaw);
    const playing = this.flow === 'playing';
    if (snap && playing) {
      const kind = snap.player.vehicle;
      a.setEngine(kind && kind !== 'semi' ? kind : null, kind ? Math.min(1, snap.player.speed / (MAX_SPEED[kind] ?? 10)) : 0, this.throttleHeld);
      const rolling = snap.state === 'running' || snap.state === 'clear';
      a.setCarrier(snap.carrier ? this.carrierPos.distanceTo(this.target.pos) : 999, rolling && snap.mode === 'mission');
      const maxLevel = snap.state === 'running' && snap.mode === 'mission' ? snap.blockers.reduce((m, b) => Math.max(m, b.level), 0) : 0;
      a.setAlarm(maxLevel >= 3 ? maxLevel : 0);
      const eta = snap.carrier?.eta ?? null;
      const tension = snap.state === 'clear' ? 0.1 : eta === null ? 0.2 : eta < 8 ? 1 : eta < 15 ? 0.8 : eta < 25 ? 0.5 : 0.25;
      a.setMusic(this.currentLevel === 'quarry' ? 'bonus' : 'mission', tension);
      this.fuses = this.fuses.map((f) => f - dt).filter((f) => f > 0);
      a.setLoop('fuse', this.fuses.length > 0);
    } else {
      a.setEngine(null, 0, 0);
      a.setLoop('fuse', false);
      a.setCarrier(999, false);
    }
    a.update(dt);

    if (this.fastButton) this.fastButton.hidden = !(snap?.state === 'clear' && this.flow === 'playing' && engine.controls.isTouch);

    // UI.
    const cam = engine.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const project = (x: number, y: number, z: number) => {
      this.projV.set(x, y, z).project(cam);
      return { x: (this.projV.x * 0.5 + 0.5) * w, y: (-this.projV.y * 0.5 + 0.5) * h, visible: this.projV.z < 1 && this.projV.z > -1 };
    };
    this.ui.update(this.flow === 'title' ? null : snap, dt, project, { mode: this.rig.mode, yaw: this.rig.yaw });
  }

  private installDebugHandle(): void {
    const client = this;
    window.__pathbreakers = {
      get flow() {
        return client.flow;
      },
      get snapshot() {
        return client.snap;
      },
      get level() {
        return client.level;
      },
      get events() {
        return client.recent;
      },
      start: (level, mode) => this.startLevel(level, mode, false),
      begin: () => this.beginMission(),
      send: (msg) => this.send(msg),
      setCamera: (mode) => this.setCamera(mode),
    };
  }
}

export function createClient(): GameClient {
  return new PathbreakersClient();
}
