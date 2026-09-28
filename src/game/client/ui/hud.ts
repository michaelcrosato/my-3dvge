/**
 * In-game HUD: clock + lane strip, warning banners, big center callouts, toasts, radio messages,
 * $ damage and objective counters, vehicle/meter panel, context prompt, aligned badge, flyover
 * letterbox. Text updates are throttled (~15 Hz); the radar canvas redraws at ~30 Hz.
 */
import { VEHICLE_NAMES, type GameEvent, type GameSnapshot, type LevelStatic } from '../../shared/types.ts';
import { el, icon, setClass, setText } from './dom.ts';
import { devicePrompt, formatMoney, formatTime, warningColor, type InputDevice } from './format.ts';
import type { CameraInfo, UIHooks } from './index.ts';
import { Radar } from './radar.ts';

const TEXT_INTERVAL = 1 / 15;
const RADAR_INTERVAL = 1 / 30;

interface Counter {
  root: HTMLDivElement;
  value: HTMLSpanElement;
  last: number;
}

interface RadioMsg {
  who: string;
  text: string;
}

interface Tick {
  el: HTMLDivElement;
  id: number;
  gap: boolean;
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly radar = new Radar();
  private level: LevelStatic | null = null;
  private readonly hooks: () => UIHooks;
  // top-left
  private readonly clock: HTMLSpanElement;
  private readonly lane: HTMLDivElement;
  private readonly laneTrack: HTMLDivElement;
  private readonly laneCarrier: HTMLDivElement;
  private readonly eta: HTMLDivElement;
  private ticks: Tick[] = [];
  // top-center
  private readonly banner: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  // radio
  private readonly radio: HTMLDivElement;
  private readonly radioWho: HTMLSpanElement;
  private readonly radioText: HTMLSpanElement;
  private readonly radioQueue: RadioMsg[] = [];
  private radioMsg: RadioMsg | null = null;
  private radioChars = 0;
  private radioHold = 0;
  // top-right
  private readonly money: HTMLDivElement;
  private moneyShown = 0;
  private moneyTarget = 0;
  private readonly counters: Record<'buildings' | 'survivors' | 'rdus' | 'dishes' | 'targets', Counter>;
  // bottom
  private readonly vehicle: HTMLDivElement;
  private readonly vehName: HTMLDivElement;
  private readonly vehSpeed: HTMLSpanElement;
  private readonly meter: HTMLDivElement;
  private readonly meterLabel: HTMLSpanElement;
  private readonly meterFill: HTMLDivElement;
  private readonly meterCount: HTMLSpanElement;
  private readonly activity: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly promptKey: HTMLSpanElement;
  private readonly promptText: HTMLSpanElement;
  private readonly aligned: HTMLDivElement;
  private readonly radarBox: HTMLDivElement;
  // overlays
  private readonly letterbox: HTMLDivElement;
  private readonly letterboxCount: HTMLSpanElement;
  private readonly flash: HTMLDivElement;

  private textAcc = TEXT_INTERVAL;
  private radarAcc = RADAR_INTERVAL;
  private clockTime = 0;
  private lastSnapTime = -1;
  private bigTimer = 0;
  private lastCountdown = -1;
  private radarSize = 0;

  constructor(hooks: () => UIHooks) {
    this.hooks = hooks;
    this.root = el('div', 'pb-hud');

    // Top-left: clock + lane strip + ETA.
    const tl = el('div', 'pb-tl');
    const clockBox = el('div', 'pb-clock');
    clockBox.append(icon('clock'));
    this.clock = el('span', 'pb-clock-text', '0:00.0');
    clockBox.append(this.clock);
    this.lane = el('div', 'pb-lane');
    this.laneTrack = el('div', 'pb-lane-track');
    this.laneCarrier = el('div', 'pb-lane-carrier');
    this.laneCarrier.append(icon('carrier'));
    const safe = el('div', 'pb-lane-safe', 'SAFE');
    this.laneTrack.append(this.laneCarrier, safe);
    this.lane.append(this.laneTrack);
    this.eta = el('div', 'pb-eta');
    tl.append(clockBox, this.lane, this.eta);

    // Radio box (under the lane strip).
    this.radio = el('div', 'pb-radio');
    this.radioWho = el('span', 'pb-radio-who');
    this.radioText = el('span', 'pb-radio-text');
    this.radio.append(this.radioWho, this.radioText);
    tl.append(this.radio);

    // Top-center.
    const tc = el('div', 'pb-tc');
    this.timer = el('div', 'pb-timer');
    this.banner = el('div', 'pb-banner');
    this.toasts = el('div', 'pb-toasts');
    tc.append(this.timer, this.banner, this.toasts);
    this.big = el('div', 'pb-big');

    // Top-right: money + counters.
    const tr = el('div', 'pb-tr');
    this.money = el('div', 'pb-money', '$0');
    const counters = el('div', 'pb-counters');
    const counter = (ic: string, title: string): Counter => {
      const root = el('div', 'pb-counter');
      root.title = title;
      const value = el('span', 'pb-counter-value', '0/0');
      root.append(icon(ic), value);
      counters.append(root);
      return { root, value, last: -1 };
    };
    this.counters = {
      buildings: counter('building', 'Buildings destroyed'),
      survivors: counter('survivor', 'Survivors rescued'),
      rdus: counter('rdu', 'RDU beacons lit'),
      dishes: counter('dish', 'Satellite dishes found'),
      targets: counter('target', 'Targets left'),
    };
    tr.append(this.money, counters);

    // Bottom-left radar.
    this.radarBox = el('div', 'pb-radar');
    this.radarBox.append(this.radar.canvas);

    // Bottom-center vehicle panel + prompt.
    const bc = el('div', 'pb-bc');
    this.prompt = el('div', 'pb-prompt');
    this.promptKey = el('span', 'pb-key');
    this.promptText = el('span', 'pb-prompt-text');
    this.prompt.append(this.promptKey, this.promptText);
    this.vehicle = el('div', 'pb-vehicle');
    this.vehName = el('div', 'pb-veh-name', 'ON FOOT');
    this.vehSpeed = el('span', 'pb-veh-speed', '0');
    const speedBox = el('div', 'pb-veh-speedbox');
    speedBox.append(this.vehSpeed, el('span', 'pb-veh-unit', 'KM/H'));
    this.meter = el('div', 'pb-meter');
    this.meterLabel = el('span', 'pb-meter-label');
    const bar = el('div', 'pb-meter-bar');
    this.meterFill = el('div', 'pb-meter-fill');
    bar.append(this.meterFill);
    this.meterCount = el('span', 'pb-meter-count');
    this.meter.append(this.meterLabel, bar, this.meterCount);
    this.activity = el('div', 'pb-activity');
    const vrow = el('div', 'pb-veh-row');
    vrow.append(this.vehName, speedBox);
    this.vehicle.append(vrow, this.meter, this.activity);
    bc.append(this.prompt, this.vehicle);

    this.aligned = el('div', 'pb-aligned');
    this.aligned.append(el('span', 'pb-aligned-face', '☺'), el('span', '', 'ALIGNED'));

    // Flyover letterbox with skip button.
    this.letterbox = el('div', 'pb-letterbox');
    const lbTop = el('div', 'pb-lb-bar pb-lb-top');
    lbTop.append(el('span', 'pb-lb-title', 'CARRIER DEBRIEF'), el('span', 'pb-lb-sub', 'TARGETS IN THE LANE ARE MARKED'));
    const lbBottom = el('div', 'pb-lb-bar pb-lb-bottom');
    this.letterboxCount = el('span', 'pb-lb-count');
    const skip = el('button', 'pb-skip', 'SKIP ▶');
    skip.type = 'button';
    skip.addEventListener('click', () => {
      this.hooks().sound('uiClick');
      this.hooks().skipFlyover();
    });
    lbBottom.append(this.letterboxCount, skip);
    this.letterbox.append(lbTop, lbBottom);

    this.flash = el('div', 'pb-flash');

    this.root.append(tl, tc, tr, this.radarBox, bc, this.aligned, this.big, this.letterbox, this.flash);
  }

  /** Re-measures size-dependent pieces (call on viewport resize, not per frame). */
  resize(): void {
    const size = this.radarBox.clientWidth || 150;
    if (size !== this.radarSize) {
      this.radarSize = size;
      this.radar.resize(size);
    }
  }

  setLevel(level: LevelStatic): void {
    this.level = level;
    this.radar.setLevel(level);
    for (const t of this.ticks) t.el.remove();
    this.ticks = [];
    const lane = level.lane;
    setClass(this.lane, 'pb-hidden', !lane);
    if (lane) {
      const len = lane.x1 - lane.x0;
      for (const s of level.structures) {
        if (!s.inLane) continue;
        const t = el('div', 'pb-lane-tick');
        t.style.left = `${Math.max(0, Math.min(1, (s.x - lane.x0) / len)) * 100}%`;
        this.laneTrack.append(t);
        this.ticks.push({ el: t, id: s.id, gap: false });
      }
      for (const g of level.gaps) {
        const t = el('div', 'pb-lane-gap');
        t.style.left = `${Math.max(0, Math.min(1, ((g.x0 + g.x1) / 2 - lane.x0) / len)) * 100}%`;
        this.laneTrack.append(t);
        this.ticks.push({ el: t, id: g.id, gap: true });
      }
    }
    const tot = level.totals;
    setClass(this.counters.buildings.root, 'pb-hidden', tot.buildings === 0);
    setClass(this.counters.survivors.root, 'pb-hidden', tot.survivors === 0);
    setClass(this.counters.rdus.root, 'pb-hidden', tot.rdus === 0);
    setClass(this.counters.dishes.root, 'pb-hidden', tot.dishes === 0);
    this.moneyShown = this.moneyTarget = 0;
    this.radioQueue.length = 0;
    this.radioMsg = null;
    this.radio.classList.remove('pb-show');
    this.lastSnapTime = -1;
    this.clockTime = 0;
  }

  onEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      switch (ev.e) {
        case 'countdown':
          if (ev.n !== this.lastCountdown) this.bigText(String(ev.n), 'pb-big-count', 0.95);
          this.lastCountdown = ev.n;
          break;
        case 'go':
          this.bigText('GO!', 'pb-big-go', 1.1);
          break;
        case 'pathClear':
          this.bigText('PATH CLEAR!', 'pb-big-clear', 2.6);
          break;
        case 'carrierSafe':
          this.bigText('CARRIER SAFE!', 'pb-big-safe', 3);
          break;
        case 'radio':
          this.radioQueue.push({ who: ev.who, text: ev.text });
          if (this.radioQueue.length > 4) this.radioQueue.shift();
          break;
        case 'survivorFreed':
          this.toast('SURVIVOR SPOTTED!', 'pb-toast-cyan');
          break;
        case 'survivorRescued':
          this.toast(`SURVIVOR RESCUED ${ev.n}/${ev.total}`, 'pb-toast-cyan');
          break;
        case 'dish':
          this.toast(`SATELLITE DISH ${ev.n}/${ev.total}`, 'pb-toast-teal');
          break;
        case 'gapFilled':
          this.toast('GAP BRIDGED!', 'pb-toast-green');
          break;
        case 'aligned':
          if (ev.ok) this.toast('FLATBED ALIGNED ☺', 'pb-toast-green');
          break;
        case 'pickup':
          this.toast('+ AMMO', 'pb-toast-teal');
          break;
        case 'target':
          this.toast(ev.left > 0 ? `${ev.left} TARGETS LEFT` : 'ALL TARGETS DOWN!', 'pb-toast-orange');
          break;
        case 'explosion':
          if (ev.radius >= 3) this.shake(ev.radius >= 6 ? 'pb-shake-big' : 'pb-shake');
          break;
        case 'collapse':
          if (ev.inLane) this.pulse(this.money);
          break;
        case 'fail':
          this.shake('pb-shake-big');
          break;
        default:
          break;
      }
    }
  }

  private bigText(text: string, cls: string, seconds: number): void {
    this.big.className = 'pb-big';
    void this.big.offsetWidth; // restart the pop-in animation
    this.big.className = `pb-big pb-big-show ${cls}`;
    this.big.textContent = text;
    this.bigTimer = seconds;
  }

  private toast(text: string, cls: string): void {
    const t = el('div', `pb-toast ${cls}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 2400);
  }

  private shake(cls: string): void {
    this.root.classList.remove('pb-shake', 'pb-shake-big');
    this.flash.classList.remove('pb-flash-on');
    void this.root.offsetWidth;
    this.root.classList.add(cls);
    this.flash.classList.add('pb-flash-on');
  }

  private pulse(e: HTMLElement): void {
    e.classList.remove('pb-pulse');
    void e.offsetWidth;
    e.classList.add('pb-pulse');
  }

  update(snap: GameSnapshot | null, dt: number, camera: CameraInfo, device: InputDevice): void {
    // Continuous local state (clock, money roll, radio typing, big text timer).
    if (snap) {
      if (snap.time !== this.lastSnapTime) {
        this.lastSnapTime = snap.time;
        this.clockTime = snap.time;
      } else if (snap.state === 'running' || snap.state === 'clear') {
        this.clockTime += dt;
      }
      if (snap.counts.damage > this.moneyTarget) this.pulse(this.money);
      this.moneyTarget = snap.counts.damage;
      if (snap.state === 'countdown') {
        const n = Math.ceil(snap.countdown);
        if (n !== this.lastCountdown && n > 0 && n <= 5) this.bigText(String(n), 'pb-big-count', 0.95);
        this.lastCountdown = n;
      }
    }
    if (this.moneyShown < this.moneyTarget) this.moneyShown = Math.min(this.moneyTarget, this.moneyShown + Math.max(250, (this.moneyTarget - this.moneyShown) * Math.min(1, dt * 5)));
    else this.moneyShown = this.moneyTarget;
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.big.classList.remove('pb-big-show');
    }
    this.updateRadio(dt);

    this.radarAcc += dt;
    if (this.radarAcc >= RADAR_INTERVAL) {
      if (this.radarSize === 0) this.resize();
      this.radar.range = camera.mode === 'tactical' ? 110 : camera.mode === 'iso' ? 75 : 60;
      this.radar.draw(snap, camera.yaw, this.radarAcc);
      this.radarAcc = 0;
    }

    this.textAcc += dt;
    if (this.textAcc < TEXT_INTERVAL) return;
    this.textAcc = 0;
    this.updateText(snap, device);
  }

  private updateRadio(dt: number): void {
    if (!this.radioMsg) {
      const next = this.radioQueue.shift();
      if (!next) return;
      this.radioMsg = next;
      this.radioChars = 0;
      this.radioHold = 0;
      this.radio.dataset.who = next.who;
      setText(this.radioWho, next.who);
      this.radio.classList.add('pb-show');
    }
    const msg = this.radioMsg;
    if (this.radioChars < msg.text.length) {
      this.radioChars = Math.min(msg.text.length, this.radioChars + dt * 48);
      setText(this.radioText, msg.text.slice(0, Math.floor(this.radioChars)));
      return;
    }
    setText(this.radioText, msg.text);
    this.radioHold += dt;
    if (this.radioHold > 2.6 + msg.text.length * 0.02) {
      this.radio.classList.remove('pb-show');
      if (this.radioHold > 3.1 + msg.text.length * 0.02) this.radioMsg = null;
    }
  }

  private updateText(snap: GameSnapshot | null, device: InputDevice): void {
    const level = this.level;
    setText(this.money, formatMoney(this.moneyShown));
    if (!snap || !level) return;

    // Flyover letterbox.
    const flyover = snap.state === 'flyover';
    setClass(this.letterbox, 'pb-show', flyover);
    setClass(this.root, 'pb-cinematic', flyover);
    if (flyover) setText(this.letterboxCount, snap.countdown > 0 ? `${Math.ceil(snap.countdown)}s` : '');

    // Clock / mode timers.
    const bonusLimit = level.timeLimit;
    setText(this.clock, formatTime(this.clockTime));
    let timerText = '';
    let timerHot = false;
    if (snap.mode === 'timeAttack' && (snap.state === 'running' || snap.state === 'clear')) timerText = formatTime(this.clockTime);
    else if (bonusLimit > 0 && snap.state === 'running') {
      const left = bonusLimit - this.clockTime;
      timerText = formatTime(left);
      timerHot = left < 10;
    }
    setText(this.timer, timerText);
    setClass(this.timer, 'pb-show', timerText !== '');
    setClass(this.timer, 'pb-hot', timerHot);

    // Lane strip.
    const car = snap.carrier;
    if (level.lane && car) {
      this.laneCarrier.style.left = `${Math.max(0, Math.min(1, car.progress)) * 100}%`;
      const destroyed = new Set(snap.destroyed);
      const blockers = new Map(snap.blockers.map((b) => [b.id, b.level]));
      const gaps = new Map(snap.gaps.map((g) => [g.id, g.filled]));
      for (const t of this.ticks) {
        if (t.gap) {
          setClass(t.el, 'pb-filled', gaps.get(t.id) ?? false);
        } else {
          const lvl = blockers.get(t.id);
          setClass(t.el, 'pb-hidden', destroyed.has(t.id) || lvl === undefined);
          if (lvl !== undefined) t.el.style.background = warningColor(lvl);
          setClass(t.el, 'pb-next', car.next === t.id);
        }
      }
    }

    // ETA + banner.
    const maxLevel = snap.blockers.reduce((m, b) => Math.max(m, b.level), -1);
    const nextLevel = car?.next != null ? (snap.blockers.find((b) => b.id === car.next)?.level ?? (car.eta !== null ? etaToLevel(car.eta) : -1)) : -1;
    const warnLevel = Math.max(maxLevel, nextLevel);
    const live = snap.state === 'running';
    if (car && live && car.eta !== null) {
      setText(this.eta, `NEXT OBSTACLE  ${Math.max(0, Math.ceil(car.eta))}s`);
      this.eta.style.color = warningColor(Math.max(0, nextLevel));
      setClass(this.eta, 'pb-hidden', false);
    } else if (snap.state === 'clear') {
      setText(this.eta, car?.fastForward ? 'PATH CLEAR  ▶▶ FAST-FORWARD' : 'PATH CLEAR — ROAM FREE');
      this.eta.style.color = warningColor(0);
      setClass(this.eta, 'pb-hidden', false);
    } else {
      setClass(this.eta, 'pb-hidden', !car || !live);
    }
    const bannerText = live && warnLevel >= 4 ? 'COLLISION IMMINENT!' : live && warnLevel >= 3 ? 'WARNING!' : '';
    setText(this.banner, bannerText);
    setClass(this.banner, 'pb-show', bannerText !== '');
    setClass(this.banner, 'pb-imminent', warnLevel >= 4);
    setClass(this.root, 'pb-danger', live && warnLevel >= 4);

    // Counters.
    const c = snap.counts;
    this.setCounter(this.counters.buildings, c.buildings);
    this.setCounter(this.counters.survivors, c.survivors);
    this.setCounter(this.counters.rdus, c.rdus);
    this.setCounter(this.counters.dishes, c.dishes);
    const bonus = level.timeLimit > 0 || level.medalTimes !== null;
    setClass(this.counters.targets.root, 'pb-hidden', !bonus);
    if (bonus) {
      setText(this.counters.targets.value, String(snap.targetsLeft));
    }

    // Vehicle panel.
    const p = snap.player;
    const name = p.onFoot || !p.vehicle ? 'ON FOOT' : VEHICLE_NAMES[p.vehicle];
    setText(this.vehName, name);
    this.vehicle.dataset.kind = p.onFoot || !p.vehicle ? 'foot' : p.vehicle;
    setText(this.vehSpeed, String(Math.round(p.speed * 3.6)));
    const m = p.meter;
    setClass(this.meter, 'pb-hidden', !m);
    if (m) {
      setText(this.meterLabel, m.label.toUpperCase());
      this.meterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, m.value))})`;
      setClass(this.meterFill, 'pb-low', m.value < 0.2);
      setText(this.meterCount, m.count !== undefined ? `×${m.count}` : '');
    }
    setText(this.activity, p.activity ? p.activity.toUpperCase() : '');
    setClass(this.activity, 'pb-show', !!p.activity);

    // Prompt.
    if (snap.prompt) {
      const dp = devicePrompt(snap.prompt, device);
      setText(this.promptKey, dp.key ?? '');
      setClass(this.promptKey, 'pb-hidden', !dp.key);
      setText(this.promptText, dp.text);
    }
    setClass(this.prompt, 'pb-show', !!snap.prompt);
    setClass(this.aligned, 'pb-show', snap.aligned);
  }

  private setCounter(c: Counter, [n, total]: [number, number]): void {
    setText(c.value, `${n}/${total}`);
    if (c.last >= 0 && n > c.last) this.pulse(c.root);
    setClass(c.root, 'pb-complete', total > 0 && n >= total);
    c.last = n;
  }
}

function etaToLevel(eta: number): number {
  return eta > 40 ? 0 : eta > 25 ? 1 : eta > 15 ? 2 : eta > 8 ? 3 : 4;
}
