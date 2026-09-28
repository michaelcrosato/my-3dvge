/**
 * World-anchored overlays, repositioned every frame with transforms only (no layout reads):
 * bobbing warning arrows over blocking structures (clamped to the screen edge when offscreen),
 * "+$45,000 BARN" collapse popups, and TNT fuse countdowns.
 */
import type { GameEvent, GameSnapshot, LevelStatic, StructureInfo } from '../../shared/types.ts';
import { el, setClass, setText } from './dom.ts';
import { formatMoney, warningColor } from './format.ts';
import type { Projector } from './index.ts';

interface ArrowEl {
  root: HTMLDivElement;
  label: HTMLSpanElement;
  level: number;
  edge: boolean;
}

interface Popup {
  root: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  age: number;
}

interface Fuse {
  root: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  left: number;
}

const EDGE = 34;

export class Markers {
  readonly root: HTMLDivElement;
  private readonly arrows = new Map<number, ArrowEl>();
  private readonly popups: Popup[] = [];
  private readonly fuses: Fuse[] = [];
  private structures = new Map<number, StructureInfo>();
  private gapCenters = new Map<number, [number, number]>();
  private time = 0;
  private vw = window.innerWidth;
  private vh = window.innerHeight;

  constructor() {
    this.root = el('div', 'pb-markers');
    window.addEventListener('resize', () => {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
    });
  }

  setLevel(level: LevelStatic): void {
    this.structures = new Map(level.structures.map((s) => [s.id, s]));
    this.gapCenters = new Map(level.gaps.map((g) => [g.id, [(g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2]]));
    for (const a of this.arrows.values()) a.root.remove();
    this.arrows.clear();
    this.clearTransient();
  }

  clearTransient(): void {
    for (const p of this.popups) p.root.remove();
    for (const f of this.fuses) f.root.remove();
    this.popups.length = 0;
    this.fuses.length = 0;
  }

  onEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      if (ev.e === 'collapse') {
        const root = el('div', `pb-popup ${ev.inLane ? 'pb-popup-lane' : ''}`);
        root.append(el('span', 'pb-popup-money', `+${formatMoney(ev.value)}`), el('span', 'pb-popup-name', ev.name.toUpperCase()));
        this.root.append(root);
        this.popups.push({ root, x: ev.x, y: ev.y + 3, z: ev.z, age: 0 });
        if (this.popups.length > 10) this.popups.shift()!.root.remove();
      } else if (ev.e === 'fuse') {
        const root = el('div', 'pb-fuse');
        this.root.append(root);
        this.fuses.push({ root, x: ev.x, y: ev.y + 1.2, z: ev.z, left: ev.seconds });
      }
    }
  }

  update(snap: GameSnapshot | null, dt: number, project: Projector, showArrows: boolean): void {
    this.time += dt;
    // Warning arrows over blockers (and unfilled gaps the carrier is heading for).
    const live = new Set<number>();
    if (snap && showArrows) {
      // Only the three most urgent blockers get floating arrows (the strip and radar show all).
      for (const b of [...snap.blockers].sort((x, y) => x.eta - y.eta).slice(0, 3)) {
        const s = this.structures.get(b.id);
        if (!s) continue;
        live.add(b.id);
        // Without a rolling carrier (time attack) the ETA means nothing: show a plain marker.
        this.placeArrow(b.id, s.x, s.h + 2.2, s.z, b.level, snap.mode === 'mission' && snap.carrier?.eta != null ? b.eta : 999, project);
      }
      const next = snap.carrier?.next;
      if (next !== null && next !== undefined && next < 0) {
        const filled = snap.gaps.find((g) => g.id === -next)?.filled;
        const c = this.gapCenters.get(-next);
        if (c && !filled) {
          live.add(next);
          const eta = snap.carrier?.eta ?? 99;
          this.placeArrow(next, c[0], 2.5, c[1], etaLevel(eta), eta, project);
        }
      }
    }
    for (const [id, a] of this.arrows) {
      if (!live.has(id)) {
        a.root.remove();
        this.arrows.delete(id);
      }
    }

    // Popups float up and fade.
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.age += dt;
      if (p.age > 2.2) {
        p.root.remove();
        this.popups.splice(i, 1);
        continue;
      }
      const s = project(p.x, p.y + p.age * 1.6, p.z);
      p.root.style.opacity = String(Math.min(1, (2.2 - p.age) * 2));
      p.root.style.transform = s.visible ? `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -100%)` : 'translate3d(-999px,-999px,0)';
    }

    // Fuses count down locally.
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i]!;
      f.left -= dt;
      if (f.left < -0.3) {
        f.root.remove();
        this.fuses.splice(i, 1);
        continue;
      }
      setText(f.root, f.left > 0 ? Math.ceil(f.left).toString() : '!');
      setClass(f.root, 'pb-fuse-hot', f.left < 3);
      const s = project(f.x, f.y, f.z);
      f.root.style.transform = s.visible ? `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -100%)` : 'translate3d(-999px,-999px,0)';
    }
  }

  private placeArrow(id: number, x: number, y: number, z: number, level: number, eta: number, project: Projector): void {
    let a = this.arrows.get(id);
    if (!a) {
      const root = el('div', 'pb-arrow');
      root.append(el('div', 'pb-arrow-head'));
      const label = el('span', 'pb-arrow-eta');
      root.append(label);
      this.root.append(root);
      a = { root, label, level: -1, edge: false };
      this.arrows.set(id, a);
    }
    if (a.level !== level) {
      a.level = level;
      a.root.style.setProperty('--pb-arrow', warningColor(level));
      setClass(a.root, 'pb-arrow-imminent', level >= 4);
    }
    setText(a.label, eta < 99 ? `${Math.max(0, Math.ceil(eta))}s` : '');
    const s = project(x, y, z);
    const vw = this.vw, vh = this.vh;
    const onScreen = s.visible && s.x >= EDGE && s.x <= vw - EDGE && s.y >= EDGE && s.y <= vh - EDGE;
    const bob = Math.sin(this.time * 5 + id) * 6;
    if (onScreen) {
      if (a.edge) {
        a.edge = false;
        setClass(a.root, 'pb-arrow-edge', false);
        a.root.style.removeProperty('--rot');
        a.root.style.removeProperty('--lx');
        a.root.style.removeProperty('--ly');
      }
      a.root.style.transform = `translate3d(${s.x}px, ${s.y + bob}px, 0)`;
      return;
    }
    // Offscreen: pin to the edge, pointing toward the target.
    let dx = s.x - vw / 2, dy = s.y - vh / 2;
    if (!s.visible) {
      dx = -dx;
      dy = -dy;
      if (Math.abs(dy) < 1) dy = vh; // behind the camera: point down
    }
    // Keep edge indicators clear of the top HUD and the bottom vehicle panel / touch buttons.
    const topRoom = vh / 2 - Math.min(vh / 2 - EDGE, 120);
    const bottomRoom = vh / 2 - Math.min(vh / 2 - EDGE, 170);
    const k = Math.min((vw / 2 - EDGE) / Math.max(1e-3, Math.abs(dx)), (dy < 0 ? topRoom : bottomRoom) / Math.max(1e-3, Math.abs(dy)));
    const ex = vw / 2 + dx * k, ey = vh / 2 + dy * k;
    const ang = Math.atan2(dy, dx) * (180 / Math.PI) - 90;
    const len = Math.hypot(dx, dy) || 1;
    a.edge = true;
    setClass(a.root, 'pb-arrow-edge', true);
    // Only the head rotates; the ETA label sits inward, behind the head.
    a.root.style.setProperty('--rot', `${ang.toFixed(1)}deg`);
    a.root.style.setProperty('--lx', `${((-dx / len) * 62).toFixed(1)}px`);
    a.root.style.setProperty('--ly', `${((-dy / len) * 62 + 48).toFixed(1)}px`);
    a.root.style.transform = `translate3d(${ex}px, ${ey}px, 0)`;
  }
}

/** Warning level for an ETA when the sim didn't give one (gaps). */
export function etaLevel(eta: number): number {
  return eta > 40 ? 0 : eta > 25 ? 1 : eta > 15 ? 2 : eta > 8 ? 3 : 4;
}
