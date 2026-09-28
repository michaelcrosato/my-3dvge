import GUI from 'lil-gui';
import { QUALITY_NAMES, type QualityName } from '../config/params.ts';
import type { SimSettings } from '../shared/protocol.ts';

/** lil-gui tuning panel: live simulation settings (sent to the worker) and the quality preset (reload). */
export function createTuningPanel(
  root: HTMLElement,
  settings: SimSettings,
  quality: QualityName,
  onChange: (patch: Partial<SimSettings>) => void,
): GUI {
  const host = document.createElement('div');
  host.className = 'tuning-panel';
  root.append(host);
  const gui = new GUI({ container: host, title: 'Tuning', width: 260 });
  const s = { ...settings };
  const send = (key: keyof SimSettings) => (v: number) => onChange({ [key]: v });
  const physics = gui.addFolder('Physics');
  physics.add(s, 'gravity', -30, 0, 0.1).name('gravity (m/s²)').onFinishChange(send('gravity'));
  physics.add(s, 'maxBodies', 10, 600, 1).name('body cap').onFinishChange(send('maxBodies'));
  const blast = gui.addFolder('Destruction');
  blast.add(s, 'blastRadius', 0.2, 4, 0.05).name('blast radius (m)').onFinishChange(send('blastRadius'));
  blast.add(s, 'blastPower', 0.1, 10, 0.1).name('blast power').onFinishChange(send('blastPower'));
  blast.add(s, 'strengthScale', 0.1, 5, 0.05).name('material strength ×').onFinishChange(send('strengthScale'));
  blast.add(s, 'particleThreshold', 0, 60, 1).name('particle threshold').onFinishChange(send('particleThreshold'));
  const view = { quality };
  gui
    .add(view, 'quality', [...QUALITY_NAMES])
    .name('quality (reloads)')
    .onChange((q: QualityName) => {
      const url = new URL(location.href);
      url.searchParams.set('quality', q);
      location.href = url.toString();
    });
  gui.close();
  return gui;
}
