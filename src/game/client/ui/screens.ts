/** Menu screens: title, how to play, settings, briefing, pause, results, failed. */
import {
  CAMERA_MODES, VEHICLE_NAMES, type CameraMode, type LevelId, type LevelStatic, type Medal, type MissionResults, type ModeId,
  type SaveData,
} from '../../shared/types.ts';
import { el, icon, medalBadge, menuButton } from './dom.ts';
import { completionPercent, formatMoney, formatTime, isRecord, medalRank, percent, type InputDevice } from './format.ts';
import type { UIHooks } from './index.ts';
import { MenuNav } from './nav.ts';

export const CAMERA_LABELS: Record<CameraMode, string> = {
  overhead: 'OVERHEAD',
  chase: 'CHASE',
  cockpit: 'COCKPIT',
  iso: 'ISOMETRIC',
  side: 'SIDE 2.5D',
  tactical: 'TACTICAL',
};

const LEVEL_NAMES: Record<LevelId, string> = { cinder: 'CINDER FLATS', quarry: 'QUARRY RUMBLE' };

const VEHICLE_HOWTO: [string, string, string][] = [
  [VEHICLE_NAMES.dozer, 'Rams with its front blade at speed. Pushes TNT and concrete blocks. Can’t crack stone or metal.', 'Horn'],
  [VEHICLE_NAMES.truck, 'Swings its armored rear into buildings while power-sliding. Front does nothing.', 'Hold to slide'],
  [VEHICLE_NAMES.buggy, 'Wrecks buildings by landing on them or hitting them while airborne. Use ramps and mounds.', 'Turbo'],
  [VEHICLE_NAMES.mech, 'Flies on thrusters and stomp-dives onto rooftops. Destroys almost anything.', 'Stomp (Jump = thrusters)'],
  [VEHICLE_NAMES.bike, 'Fires missiles — the only ranged attack. Opens doors and far-off targets. Ammo refills.', 'Fire'],
  [VEHICLE_NAMES.train, 'Rolls along its rails. Line its flatbed up under the carrier lane to bridge the rail cut.', '—'],
  [VEHICLE_NAMES.semi, 'Board it once the path is clear to end the mission.', '—'],
];

const CONTROLS: [string, string, string, string][] = [
  ['Drive / walk', 'WASD / Arrows', 'Left stick (RT/LT throttle)', 'Left joystick'],
  ['Action (special move)', 'Shift · K · Left mouse', 'X / RB', 'ACTION'],
  ['Jump / thrusters', 'Space', 'A', 'JUMP'],
  ['Enter / exit vehicle', 'E', 'Y', 'ENTER'],
  ['Change camera', 'C', 'View', 'CAM'],
  ['Carrier view (hold)', 'V', 'LB', 'CARRIER'],
  ['Rotate isometric view', 'Z / X', 'Right stick', 'Drag right side'],
  ['Reset flipped vehicle', 'R', 'B', 'RESET'],
  ['Fast-forward carrier (path clear)', 'F', 'RB (hold)', '—'],
  ['Pause', 'Esc', 'Menu', '❚❚'],
];

function panel(cls: string): HTMLDivElement {
  const p = el('div', `pb-panel ${cls}`);
  return p;
}

function header(text: string, sub?: string): HTMLDivElement {
  const h = el('div', 'pb-header');
  h.append(el('div', 'pb-stripes'), el('h2', 'pb-h2', text));
  if (sub) h.append(el('div', 'pb-h2-sub', sub));
  return h;
}

function bestKey(level: LevelId, mode: ModeId): `${LevelId}:${ModeId}` {
  return `${level}:${mode}`;
}

function bestMedal(m: MissionResults['medals']): Medal | undefined {
  const all = [m.carrier, m.completion, m.time].filter((x): x is Medal => !!x);
  return all.sort((a, b) => medalRank(b) - medalRank(a))[0];
}

function bestLine(save: SaveData, level: LevelId, mode: ModeId): string {
  const b = save.best[bestKey(level, mode)];
  if (!b) return 'NO RECORD YET';
  const medal = bestMedal(b.medals);
  return `BEST ${formatTime(b.time, false)}${mode === 'mission' ? ` · ${b.completion}%` : ''}${medal ? ` · ${medal.toUpperCase()}` : ''}`;
}

export class Screens {
  readonly root: HTMLDivElement;
  readonly nav: MenuNav;
  private readonly hooks: () => UIHooks;
  private current: HTMLElement | null = null;
  device: InputDevice = 'keyboard';
  /** Camera mode shown as selected in the pause menu. */
  cameraMode: CameraMode = 'overhead';

  constructor(hooks: () => UIHooks) {
    this.hooks = hooks;
    this.root = el('div', 'pb-screens');
    this.nav = new MenuNav((s) => this.hooks().sound(s));
  }

  get open(): boolean {
    return this.current !== null;
  }

  close(): void {
    this.current?.remove();
    this.current = null;
    this.nav.detach();
    this.root.classList.remove('pb-screens-open');
  }

  private mountScreen(screen: HTMLElement, back: (() => void) | null, focus?: HTMLElement | null): void {
    this.current?.remove();
    this.current = screen;
    this.root.append(screen);
    this.root.classList.add('pb-screens-open');
    this.nav.attach(screen, back, focus);
  }

  // ------------------------------------------------------------------ title & sub-screens

  showTitle(save: SaveData): void {
    const h = this.hooks();
    const s = el('div', 'pb-screen pb-title');
    const logo = el('div', 'pb-logo');
    const word = el('div', 'pb-logo-word');
    'PATHBREAKERS'.split('').forEach((c, i) => {
      const span = el('span', 'pb-logo-letter', c);
      span.style.setProperty('--i', String(i));
      word.append(span);
    });
    logo.append(el('div', 'pb-logo-kicker', 'EMERGENCY DEMOLITION DIVISION'), word, el('div', 'pb-logo-tag', 'Clear the lane. Save the county.'));

    const menu = el('div', 'pb-menu');
    const mission = menuButton('MISSION: CINDER FLATS', {
      cls: 'pb-primary',
      sub: bestLine(save, 'cinder', 'mission'),
      onClick: () => h.startLevel('cinder', 'mission'),
    });
    const ta = save.unlocked.timeAttack;
    const timeAttack = menuButton('TIME ATTACK: CINDER FLATS', {
      locked: !ta,
      sub: ta ? bestLine(save, 'cinder', 'timeAttack') : 'LOCKED — clear Cinder Flats to unlock',
      onClick: () => (ta ? h.startLevel('cinder', 'timeAttack') : this.denied(timeAttack)),
    });
    const qu = save.unlocked.quarry;
    const bonus = menuButton('BONUS: QUARRY RUMBLE', {
      locked: !qu,
      sub: qu ? bestLine(save, 'quarry', 'mission') : 'LOCKED — find both satellite dishes in Cinder Flats (or clear it)',
      onClick: () => (qu ? h.startLevel('quarry', 'mission') : this.denied(bonus)),
    });
    const howto = menuButton('HOW TO PLAY', { onClick: () => this.showHowTo(() => this.showTitle(h.save())) });
    const settings = menuButton('SETTINGS', { onClick: () => this.showSettings(() => this.showTitle(h.save())) });
    menu.append(mission, timeAttack, bonus, howto, settings);

    s.append(
      el('div', 'pb-stripes pb-stripes-top'),
      logo,
      menu,
      el('div', 'pb-footer', 'An original game inspired by Blast Corps (Rare, 1997). Built on my-3dvge.'),
      el('div', 'pb-stripes pb-stripes-bottom'),
    );
    this.mountScreen(s, null, mission);
  }

  private denied(b: HTMLElement): void {
    b.classList.remove('pb-shake-x');
    void b.offsetWidth; // restart the animation
    b.classList.add('pb-shake-x');
    this.hooks().sound('uiBack');
  }

  showHowTo(back: () => void): void {
    const s = el('div', 'pb-screen pb-howto');
    const p = panel('pb-panel-wide');
    p.append(header('HOW TO PLAY', 'Keep the Hazard Carrier’s lane clear — it explodes if it touches anything.'));
    const body = el('div', 'pb-scroll');

    const sec = (title: string) => {
      const h = el('h3', 'pb-h3 pb-nav', title);
      h.tabIndex = 0;
      body.append(h);
      return h;
    };

    sec('THE JOB');
    const job = el('ul', 'pb-list');
    for (const line of [
      'The carrier rolls in a dead-straight line and never stops. Any building in its lane must go before it arrives.',
      'Arrows over buildings turn green → yellow → orange → red as it closes in. “COLLISION IMMINENT!” means seconds left.',
      'Bridge gaps: line the train’s flatbed up in the rail cut; push concrete blocks into drainage pits.',
      'TNT crates light a fuse when disturbed — push them into walls too tough to ram. Gas pumps explode too.',
      'Don’t ram, land on or blow up the carrier.',
      'Once the path is clear, roam free: light RDU beacons, rescue survivors, find satellite dishes, flatten everything. Board the COMMAND RIG to finish.',
    ]) job.append(el('li', '', line));
    body.append(job);

    sec('CONTROLS');
    const table = el('table', 'pb-table');
    const head = el('tr');
    for (const c of ['', 'KEYBOARD', 'GAMEPAD', 'TOUCH']) head.append(el('th', '', c));
    table.append(head);
    for (const row of CONTROLS) {
      const tr = el('tr');
      row.forEach((c, i) => tr.append(el(i === 0 ? 'th' : 'td', '', c)));
      table.append(tr);
    }
    body.append(table);

    sec('VEHICLES');
    const vt = el('div', 'pb-vehicles');
    for (const [name, what, action] of VEHICLE_HOWTO) {
      const card = el('div', 'pb-vehicle-card');
      card.append(el('div', 'pb-vehicle-name', name), el('div', 'pb-vehicle-what', what), el('div', 'pb-vehicle-action', `ACTION: ${action}`));
      vt.append(card);
    }
    body.append(vt);

    sec('OBJECTIVES & MEDALS');
    const obj = el('ul', 'pb-list');
    for (const line of [
      'CARRIER MEDAL — gold when the carrier reaches the Safe Zone.',
      'COMPLETION MEDAL — buildings, survivors (8), RDU beacons (100) and satellite dishes (2): gold at 100%, silver at 75%, bronze at 40%.',
      'TIME ATTACK — after your first clear. Only lane buildings count; beat bronze 3:30 · silver 2:50 · gold 2:20 · platinum 1:50.',
      'BONUS: QUARRY RUMBLE — find both satellite dishes (or clear Cinder Flats) to unlock. Flatten 12 targets: bronze 2:30 … platinum 1:00.',
    ]) obj.append(el('li', '', line));
    body.append(obj);

    const backBtn = menuButton('BACK', { cls: 'pb-back', onClick: back });
    p.append(body, el('div', 'pb-actions'));
    p.lastElementChild!.append(backBtn);
    s.append(p);
    this.mountScreen(s, back, backBtn);
  }

  /** Settings controls (shared by the title's settings screen and the pause menu). */
  private settingsControls(save: SaveData): HTMLDivElement {
    const h = this.hooks();
    const box = el('div', 'pb-settings');
    const slider = (label: string, key: 'music' | 'sfx') => {
      const row = el('label', 'pb-setting');
      row.append(el('span', 'pb-setting-label', label));
      const input = el('input', 'pb-range pb-nav');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.value = String(Math.round((save.settings[key] ?? 0.8) * 100));
      const val = el('span', 'pb-setting-value', `${input.value}%`);
      input.style.setProperty('--pb-fill', `${input.value}%`);
      input.addEventListener('input', () => {
        val.textContent = `${input.value}%`;
        input.style.setProperty('--pb-fill', `${input.value}%`);
        h.setSetting(key, Number(input.value) / 100);
      });
      row.append(input, val);
      box.append(row);
    };
    const toggle = (label: string, key: 'assist' | 'invertY', hint: string) => {
      let on = save.settings[key];
      const b = el('button', 'pb-toggle pb-nav');
      b.type = 'button';
      const paint = () => {
        b.innerHTML = '';
        b.append(el('span', 'pb-setting-label', label), el('span', `pb-switch ${on ? 'pb-on' : ''}`, on ? 'ON' : 'OFF'));
        b.title = hint;
      };
      paint();
      b.addEventListener('click', () => {
        on = !on;
        h.setSetting(key, on);
        paint();
      });
      box.append(b);
    };
    slider('MUSIC', 'music');
    slider('SOUND FX', 'sfx');
    toggle('DRIFT ASSIST', 'assist', 'Helps TAILWHIP hold its power-slides');
    toggle('INVERT LOOK Y', 'invertY', 'Invert vertical camera look');
    return box;
  }

  private cameraRow(selected: CameraMode, onPick: (m: CameraMode) => void): HTMLDivElement {
    const row = el('div', 'pb-chips');
    for (const m of CAMERA_MODES) {
      const c = el('button', `pb-chip pb-nav ${m === selected ? 'pb-selected' : ''}`, CAMERA_LABELS[m]);
      c.type = 'button';
      c.dataset.row = 'camera';
      c.addEventListener('click', () => {
        for (const other of row.children) other.classList.remove('pb-selected');
        c.classList.add('pb-selected');
        onPick(m);
      });
      row.append(c);
    }
    return row;
  }

  showSettings(back: () => void): void {
    const h = this.hooks();
    const save = h.save();
    const s = el('div', 'pb-screen pb-settings-screen');
    const p = panel('');
    p.append(header('SETTINGS'));
    p.append(this.settingsControls(save));
    p.append(el('div', 'pb-setting-label pb-mt', 'DEFAULT CAMERA'));
    p.append(this.cameraRow(save.settings.camera, (m) => h.setSetting('camera', m)));
    const backBtn = menuButton('BACK', { cls: 'pb-back', onClick: back });
    const actions = el('div', 'pb-actions');
    actions.append(backBtn);
    p.append(actions);
    s.append(p);
    this.mountScreen(s, back);
  }

  // ------------------------------------------------------------------ briefing

  showBriefing(level: LevelStatic, mode: ModeId, save: SaveData): void {
    const h = this.hooks();
    const s = el('div', 'pb-screen pb-briefing');
    const p = panel('pb-panel-wide');
    const bonus = level.timeLimit > 0 || level.medalTimes !== null;
    const kicker = mode === 'timeAttack' ? 'TIME ATTACK' : bonus ? 'BONUS STAGE' : 'MISSION BRIEFING';
    p.append(header(kicker, `${level.title} — ${level.subtitle}`));

    const body = el('div', 'pb-scroll pb-brief-body');
    const left = el('div', 'pb-brief-col');
    const lines = el('div', 'pb-brief-lines');
    level.briefing.forEach((line, i) => {
      const l = el('p', 'pb-brief-line', line);
      l.style.setProperty('--i', String(i));
      lines.append(l);
    });
    left.append(lines);

    const right = el('div', 'pb-brief-col');
    right.append(el('h3', 'pb-h3', 'OBJECTIVES'));
    const obj = el('ul', 'pb-objectives');
    const add = (ic: string, text: string, primary = false) => {
      const li = el('li', primary ? 'pb-obj-primary' : '');
      li.append(icon(ic), el('span', '', text));
      obj.append(li);
    };
    const t = level.totals;
    if (mode === 'timeAttack') {
      add('carrier', 'Flatten every building in the carrier lane — fast. Gaps don’t count.', true);
    } else if (level.lane) {
      add('carrier', 'Clear the carrier’s lane before it arrives.', true);
    }
    if (bonus && mode !== 'timeAttack') add('target', level.timeLimit > 0 ? `Destroy every target within ${formatTime(level.timeLimit, false)}.` : 'Destroy every target.', true);
    if (mode === 'mission' && !bonus) {
      if (t.buildings) add('building', `Destroy all ${t.buildings} buildings`);
      if (t.survivors) add('survivor', `Rescue ${t.survivors} survivors`);
      if (t.rdus) add('rdu', `Light ${t.rdus} RDU beacons`);
      if (t.dishes) add('dish', `Find ${t.dishes} satellite dishes`);
    }
    right.append(obj);

    const times = mode === 'timeAttack' ? level.timeAttackTimes : level.medalTimes;
    if (times) {
      right.append(el('h3', 'pb-h3', 'MEDAL TIMES'));
      const mt = el('div', 'pb-medal-times');
      for (const m of ['platinum', 'gold', 'silver', 'bronze'] as const) {
        const row = el('div', `pb-medal-time pb-mt-${m}`);
        row.append(el('span', 'pb-dot'), el('span', '', m.toUpperCase()), el('b', '', formatTime(times[m], false)));
        mt.append(row);
      }
      right.append(mt);
    }
    if (level.tips.length) {
      right.append(el('h3', 'pb-h3', 'FIELD TIPS'));
      const tips = el('ul', 'pb-list pb-tips');
      for (const tip of level.tips) tips.append(el('li', '', tip));
      right.append(tips);
    }
    right.append(el('div', 'pb-best', bestLine(save, level.level, mode)));
    body.append(left, right);

    const start = menuButton(mode === 'timeAttack' ? 'START TIME ATTACK' : bonus ? 'START BONUS' : 'START MISSION', {
      cls: 'pb-primary pb-btn-big',
      onClick: () => h.beginMission(),
    });
    const back = menuButton('BACK', { cls: 'pb-back', onClick: () => h.quitToTitle() });
    const actions = el('div', 'pb-actions');
    actions.append(back, start);
    p.append(body, actions);
    s.append(p);
    this.mountScreen(s, () => h.quitToTitle(), start);
  }

  // ------------------------------------------------------------------ pause

  showPause(): void {
    const h = this.hooks();
    const save = h.save();
    const s = el('div', 'pb-screen pb-pause');
    const p = panel('pb-panel-wide');
    p.append(header('PAUSED', 'The carrier is waiting. So is the county.'));
    const body = el('div', 'pb-scroll pb-pause-body');
    const left = el('div', 'pb-pause-col');
    const resume = menuButton('RESUME', { cls: 'pb-primary', onClick: () => h.resume() });
    const restart = menuButton('RESTART', { onClick: () => h.restart() });
    const debug = menuButton('DEBUG HUD', { sub: 'FPS, bodies, draw calls, build', onClick: () => h.toggleDebugHud() });
    const diag = menuButton('COPY DIAGNOSTICS', {
      sub: 'Paste into a bug report',
      onClick: () => {
        const label = diag.querySelector('.pb-btn-label')!;
        void h.copyDiagnostics().then((ok) => {
          label.textContent = ok ? 'COPIED ✓' : 'COPY FAILED';
          setTimeout(() => (label.textContent = 'COPY DIAGNOSTICS'), 1600);
        });
      },
    });
    const quit = menuButton('QUIT TO TITLE', { cls: 'pb-back', onClick: () => h.quitToTitle() });
    left.append(resume, restart, debug, diag, quit);
    const right = el('div', 'pb-pause-col');
    right.append(el('h3', 'pb-h3', 'CAMERA'));
    right.append(
      this.cameraRow(this.cameraMode, (m) => {
        this.cameraMode = m;
        h.setCamera(m);
      }),
    );
    right.append(el('h3', 'pb-h3', 'SETTINGS'));
    right.append(this.settingsControls(save));
    body.append(left, right);
    p.append(body);
    s.append(p);
    this.mountScreen(s, () => h.resume(), resume);
  }

  // ------------------------------------------------------------------ results & failure

  showResults(r: MissionResults, save: SaveData): void {
    const h = this.hooks();
    const s = el('div', 'pb-screen pb-results');
    const p = panel('pb-panel-wide');
    const title = r.mode === 'timeAttack' ? 'TIME ATTACK COMPLETE' : r.level === 'quarry' ? 'BONUS COMPLETE' : 'MISSION COMPLETE';
    p.append(header(title, LEVEL_NAMES[r.level]));

    const completion = completionPercent(r);
    const timed = r.mode === 'timeAttack' || r.level === 'quarry';
    const best = save.best[bestKey(r.level, r.mode)];
    const record = isRecord({ time: r.time, completion }, best, timed);

    const tally = el('div', 'pb-tally');
    const rows: [string, string, string][] = [
      ['clock', 'TIME', formatTime(r.time)],
    ];
    if (r.level === 'cinder' && r.mode === 'mission') rows.push(['carrier', 'CARRIER', r.carrierSafe ? 'SAFE' : 'LOST']);
    if (r.buildings[1] > 0) rows.push(['building', 'BUILDINGS', `${r.buildings[0]}/${r.buildings[1]}  ·  ${percent(...r.buildings)}%`]);
    if (r.survivors[1] > 0) rows.push(['survivor', 'SURVIVORS', `${r.survivors[0]}/${r.survivors[1]}`]);
    if (r.rdus[1] > 0) rows.push(['rdu', 'RDU BEACONS', `${r.rdus[0]}/${r.rdus[1]}`]);
    if (r.dishes[1] > 0) rows.push(['dish', 'SATELLITE DISHES', `${r.dishes[0]}/${r.dishes[1]}`]);
    rows.forEach(([ic, label, value], i) => {
      const row = el('div', 'pb-tally-row');
      row.style.setProperty('--i', String(i));
      row.append(icon(ic), el('span', 'pb-tally-label', label), el('span', 'pb-tally-value', value));
      tally.append(row);
    });
    const dmgRow = el('div', 'pb-tally-row pb-tally-money');
    dmgRow.style.setProperty('--i', String(rows.length));
    const dmg = el('span', 'pb-tally-value', '$0');
    dmgRow.append(el('span', 'pb-tally-dollar', '$'), el('span', 'pb-tally-label', 'PROPERTY DAMAGE'), dmg);
    tally.append(dmgRow);
    // Count the damage up after the rows have appeared.
    const startAt = performance.now() + rows.length * 180 + 250;
    const tick = (now: number) => {
      if (!dmg.isConnected) return;
      const t = Math.min(1, Math.max(0, (now - startAt) / 1200));
      dmg.textContent = formatMoney(r.damage * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const medals = el('div', 'pb-medals');
    const m = r.medals;
    const badges: HTMLElement[] = [];
    if (r.level === 'cinder' && r.mode === 'mission') {
      badges.push(medalBadge(m.carrier, 'CARRIER'));
      badges.push(medalBadge(m.completion, `COMPLETION ${completion}%`));
    }
    if (m.time || timed) badges.push(medalBadge(m.time, 'TIME'));
    badges.forEach((b, i) => {
      b.style.setProperty('--i', String(i));
      medals.append(b);
    });

    const bestBox = el('div', `pb-best ${record ? 'pb-record' : ''}`);
    if (record) bestBox.append(el('span', 'pb-record-flash', 'NEW RECORD!'));
    if (best) bestBox.append(el('span', '', `PREVIOUS BEST ${formatTime(best.time, false)}${timed ? '' : ` · ${best.completion}%`}`));

    const retry = menuButton('RETRY', { cls: 'pb-primary', onClick: () => h.restart() });
    const title2 = menuButton('TITLE', { cls: 'pb-back', onClick: () => h.quitToTitle() });
    const actions = el('div', 'pb-actions');
    actions.append(title2, retry);
    const body = el('div', 'pb-scroll pb-results-body');
    body.append(tally, medals, bestBox);
    p.append(body, actions);
    s.append(p);
    this.mountScreen(s, () => h.quitToTitle(), retry);
  }

  showFailed(reason: string, tip: string | null): void {
    const h = this.hooks();
    const s = el('div', 'pb-screen pb-failed');
    s.append(el('div', 'pb-stripes pb-stripes-top pb-stripes-red'));
    const box = el('div', 'pb-failed-box');
    box.append(el('div', 'pb-failed-title', 'MISSION FAILED'), el('div', 'pb-failed-reason', reason));
    if (tip) box.append(el('div', 'pb-failed-tip', `TIP: ${tip}`));
    const retry = menuButton('RETRY', { cls: 'pb-primary pb-btn-big', sub: this.device === 'gamepad' ? 'PRESS A' : this.device === 'touch' ? 'TAP' : 'PRESS ENTER', onClick: () => h.restart() });
    const title = menuButton('TITLE', { cls: 'pb-back', onClick: () => h.quitToTitle() });
    const actions = el('div', 'pb-actions');
    actions.append(title, retry);
    box.append(actions);
    s.append(box, el('div', 'pb-stripes pb-stripes-bottom pb-stripes-red'));
    this.mountScreen(s, () => h.quitToTitle(), retry);
  }
}
