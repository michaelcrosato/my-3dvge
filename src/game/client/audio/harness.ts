/**
 * Dev harness (?harness=audio): audition every effect, loop and music state. Also exposes
 * window.__audioHarness for automated checks (offline renders of effects and music).
 */
import type { VehicleKind } from '../../shared/types.ts';
import { AudioEngine } from './engine.ts';
import { SFX_NAMES, type MusicTrack } from './index.ts';
import { renderMusicOffline, renderSfxOffline } from './offline.ts';

declare global {
  interface Window {
    __audioHarness?: {
      audio: AudioEngine;
      sfx: readonly string[];
      renderSfx: typeof renderSfxOffline;
      renderMusic: typeof renderMusicOffline;
    };
  }
}

const VEHICLES: (VehicleKind | 'none')[] = ['none', 'dozer', 'truck', 'buggy', 'mech', 'bike', 'train', 'semi'];
const TRACKS: MusicTrack[] = ['none', 'title', 'mission', 'bonus', 'results'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function slider(label: string, value: number, onInput: (v: number) => void): HTMLLabelElement {
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
  input.dataset.name = label;
  input.oninput = () => onInput(Number(input.value));
  return el('label', { className: 'ah-slider' }, `${label} `, input);
}

export function runHarness(root: HTMLElement): void {
  const audio = new AudioEngine();
  window.__audioHarness = { audio, sfx: SFX_NAMES, renderSfx: renderSfxOffline, renderMusic: renderMusicOffline };

  const style = el('style');
  style.textContent = `
    .ah { position:absolute; inset:0; overflow:auto; pointer-events:auto; background:#141a22; color:#e8eef5; padding:16px; font:14px system-ui, sans-serif; }
    .ah h1 { margin:0 0 8px; font-size:20px; } .ah h2 { margin:18px 0 6px; font-size:15px; color:#ffb347; }
    .ah .row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .ah button { min-height:34px; } .ah button.on { background:rgba(255,179,71,.45); }
    .ah-slider { display:inline-flex; gap:6px; align-items:center; margin-right:12px; }
    .ah pre { background:#0b0f14; padding:8px; border-radius:6px; white-space:pre-wrap; }
  `;
  const stats = el('pre', { id: 'ah-stats' });
  const unlock = el('button', { id: 'ah-unlock', textContent: '🔊 Unlock audio' });
  unlock.onclick = () => {
    audio.unlock();
    unlock.textContent = 'Audio unlocked';
  };

  const sfxRow = el('div', { className: 'row' });
  for (const name of SFX_NAMES) {
    const b = el('button', { textContent: name });
    b.dataset.sfx = name;
    b.onclick = () => audio.play(name);
    sfxRow.append(b);
  }

  const panRow = el('div', { className: 'row' });
  const panTests: [string, [number, number, number]][] = [
    ['explosion left', [-15, 0, 0]],
    ['explosion right', [15, 0, 0]],
    ['explosion far', [0, 0, -120]],
    ['explosion behind', [0, 0, 10]],
  ];
  for (const [label, at] of panTests) {
    const b = el('button', { textContent: label });
    b.dataset.pan = label;
    b.onclick = () => audio.play('explosion', { at });
    panRow.append(b);
  }
  const chain = el('button', { textContent: 'chain ×12 explosions' });
  chain.dataset.chain = '1';
  chain.onclick = () => {
    for (let i = 0; i < 12; i++) setTimeout(() => audio.play(i % 3 ? 'explosion' : 'bigExplosion', { at: [(i - 6) * 4, 0, -10] }), i * 60);
    for (let i = 0; i < 30; i++) setTimeout(() => audio.play(i % 2 ? 'crumble' : 'impact', { at: [(i % 7) * 3, 0, -8] }), i * 17);
  };
  panRow.append(chain);

  let track: MusicTrack = 'none';
  let tension = 0;
  const musicRow = el('div', { className: 'row' });
  for (const t of TRACKS) {
    const b = el('button', { textContent: t });
    b.dataset.track = t;
    b.onclick = () => {
      track = t;
      audio.setMusic(track, tension);
      musicRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
    musicRow.append(b);
  }
  musicRow.append(slider('tension', 0, (v) => {
    tension = v;
    audio.setMusic(track, tension);
  }));

  let vehicle: VehicleKind | null = null;
  let speed = 0.3, load = 0.3;
  const engineRow = el('div', { className: 'row' });
  for (const k of VEHICLES) {
    const b = el('button', { textContent: k });
    b.dataset.engine = k;
    b.onclick = () => {
      vehicle = k === 'none' ? null : k;
      audio.setEngine(vehicle, speed, load);
      engineRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
    engineRow.append(b);
  }
  engineRow.append(
    slider('speed', speed, (v) => {
      speed = v;
      audio.setEngine(vehicle, speed, load);
    }),
    slider('load', load, (v) => {
      load = v;
      audio.setEngine(vehicle, speed, load);
    }),
  );

  const loopRow = el('div', { className: 'row' });
  for (const name of ['thrust', 'slide', 'fuse'] as const) {
    let on = false;
    const b = el('button', { textContent: `${name}: off` });
    b.dataset.loop = name;
    b.onclick = () => {
      on = !on;
      audio.setLoop(name, on);
      b.textContent = `${name}: ${on ? 'on' : 'off'}`;
      b.classList.toggle('on', on);
    };
    loopRow.append(b);
  }
  let carrierOn = false;
  let carrierDist = 20;
  const carrierBtn = el('button', { textContent: 'carrier: off' });
  carrierBtn.dataset.carrier = '1';
  carrierBtn.onclick = () => {
    carrierOn = !carrierOn;
    audio.setCarrier(carrierDist, carrierOn);
    carrierBtn.textContent = `carrier: ${carrierOn ? 'on' : 'off'}`;
  };
  loopRow.append(carrierBtn, slider('carrier near→far', 0.1, (v) => {
    carrierDist = 2 + v * 150;
    audio.setCarrier(carrierDist, carrierOn);
  }));

  const alarmRow = el('div', { className: 'row' });
  for (let lvl = 0; lvl <= 4; lvl++) {
    const b = el('button', { textContent: `alarm ${lvl}` });
    b.dataset.alarm = String(lvl);
    b.onclick = () => audio.setAlarm(lvl);
    alarmRow.append(b);
  }

  let musicVol = 0.6, sfxVol = 0.9;
  const volRow = el('div', { className: 'row' },
    slider('music vol', musicVol, (v) => {
      musicVol = v;
      audio.setVolumes(musicVol, sfxVol);
    }),
    slider('sfx vol', sfxVol, (v) => {
      sfxVol = v;
      audio.setVolumes(musicVol, sfxVol);
    }),
  );

  root.replaceChildren(
    style,
    el('div', { className: 'ah' },
      el('h1', {}, 'PATHBREAKERS — audio harness'),
      el('div', { className: 'row' }, unlock),
      stats,
      el('h2', {}, 'Sound effects'), sfxRow,
      el('h2', {}, 'Spatial / stress'), panRow,
      el('h2', {}, 'Music'), musicRow,
      el('h2', {}, 'Engine'), engineRow,
      el('h2', {}, 'Loops'), loopRow,
      el('h2', {}, 'Alarm'), alarmRow,
      el('h2', {}, 'Volumes'), volRow,
    ),
  );

  let last = performance.now();
  const loop = (now: number) => {
    audio.update((now - last) / 1000);
    last = now;
    stats.textContent = JSON.stringify(audio.stats());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
