/**
 * Round radar: the level's ground color map (drawn once to an offscreen canvas) rotated with the camera
 * and centred on the player, with the carrier lane, carrier, blockers colored by warning level, vehicles,
 * RDUs and survivors, plus a rim arrow toward the carrier's next obstacle.
 */
import type { GameSnapshot, LevelStatic, VehicleKind } from '../../shared/types.ts';
import { warningColor } from './format.ts';

const VEHICLE_COLORS: Record<VehicleKind, string> = {
  dozer: '#ffc21a',
  truck: '#3f8cff',
  buggy: '#ff4d2e',
  mech: '#d8e4ee',
  bike: '#3ddc5a',
  train: '#b0643c',
  semi: '#ffffff',
};

export class Radar {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private map: HTMLCanvasElement | null = null;
  private level: LevelStatic | null = null;
  private cssSize = 150;
  private dpr = 1;
  /** Meters from center to rim. */
  range = 60;
  private pulse = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pb-radar-canvas';
    this.ctx = this.canvas.getContext('2d')!;
  }

  setLevel(level: LevelStatic): void {
    this.level = level;
    const { width, height, data } = level.map;
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const c = off.getContext('2d');
    if (c && width > 0 && height > 0 && data.length >= width * height * 4) {
      const img = c.createImageData(width, height);
      img.data.set(data.subarray(0, width * height * 4));
      c.putImageData(img, 0, 0);
      this.map = off;
    } else {
      this.map = null;
    }
  }

  /** Match the canvas backing store to its CSS size (call on resize). */
  resize(cssSize: number): void {
    this.cssSize = cssSize;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(cssSize * this.dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  draw(snap: GameSnapshot | null, yaw: number, dt: number): void {
    const ctx = this.ctx;
    const size = this.cssSize;
    const r = size / 2;
    this.pulse = (this.pulse + dt) % 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0b2622';
    ctx.fillRect(0, 0, size, size);
    const level = this.level;
    if (!snap || !level) {
      ctx.restore();
      this.drawRim(ctx, r);
      return;
    }
    const px = snap.player.x, pz = snap.player.z;
    const scale = (r - 4) / this.range;

    ctx.translate(r, r);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);

    const b = level.bounds;
    if (this.map) {
      ctx.globalAlpha = 0.85;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.map, b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
      ctx.globalAlpha = 1;
    }
    // Darken for contrast.
    ctx.fillStyle = 'rgba(4, 20, 18, 0.35)';
    ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);

    const lane = level.lane;
    if (lane) {
      ctx.fillStyle = 'rgba(255, 210, 63, 0.35)';
      ctx.fillRect(lane.x0, lane.z - lane.width / 2, lane.x1 - lane.x0, lane.width);
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.9)';
      ctx.lineWidth = 0.9 / scale;
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.beginPath();
      ctx.moveTo(lane.x0, lane.z);
      ctx.lineTo(lane.x1, lane.z);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Gaps.
    const gapFilled = new Map(snap.gaps.map((g) => [g.id, g.filled]));
    for (const g of level.gaps) {
      const filled = gapFilled.get(g.id) ?? false;
      ctx.fillStyle = filled ? 'rgba(160, 160, 150, 0.9)' : 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(g.x0, g.z0, g.x1 - g.x0, g.z1 - g.z0);
      if (!filled) {
        ctx.strokeStyle = '#ff3b2f';
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeRect(g.x0, g.z0, g.x1 - g.x0, g.z1 - g.z0);
      }
    }

    // Structures.
    const destroyed = new Set(snap.destroyed);
    const blockers = new Map(snap.blockers.map((bl) => [bl.id, bl.level]));
    const blink = Math.sin(this.pulse * 10) > 0;
    for (const s of level.structures) {
      if (destroyed.has(s.id)) continue;
      const lvl = blockers.get(s.id);
      if (lvl !== undefined) {
        ctx.fillStyle = lvl >= 4 && blink ? '#ffffff' : warningColor(lvl);
      } else {
        ctx.fillStyle = s.inLane ? 'rgba(255, 138, 31, 0.8)' : 'rgba(225, 230, 220, 0.75)';
      }
      ctx.fillRect(s.x - s.w / 2, s.z - s.d / 2, s.w, s.d);
    }

    // RDUs and survivors.
    ctx.fillStyle = '#7dff6a';
    const dot = 1.4 / scale;
    for (const d of snap.rdus) ctx.fillRect(d.x - dot, d.z - dot, dot * 2, dot * 2);
    if (blink) {
      ctx.fillStyle = '#29f0ff';
      for (const s of snap.survivors) {
        ctx.beginPath();
        ctx.arc(s.x, s.z, 3 / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Vehicles (unoccupied) as small diamonds.
    for (const v of snap.vehicles) {
      if (v.occupied) continue;
      const k = 3.2 / scale;
      ctx.fillStyle = VEHICLE_COLORS[v.kind];
      ctx.beginPath();
      ctx.moveTo(v.x, v.z - k);
      ctx.lineTo(v.x + k, v.z);
      ctx.lineTo(v.x, v.z + k);
      ctx.lineTo(v.x - k, v.z);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.6 / scale;
      ctx.stroke();
    }

    // Carrier.
    const car = snap.carrier;
    if (car) {
      ctx.save();
      ctx.translate(car.x, car.z);
      ctx.fillStyle = '#f4f4f0';
      ctx.fillRect(-3.8, -1.6, 7.6, 3.2);
      ctx.fillStyle = blink ? '#b9ff3a' : '#6ad11a';
      ctx.fillRect(-3.4, -1.1, 2.4, 2.2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(185, 255, 58, 0.8)';
      ctx.lineWidth = 1.2 / scale;
      ctx.beginPath();
      ctx.arc(car.x, car.z, 6 + (this.pulse * 8) % 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Player arrow (drawn in world space so it follows the rotation).
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-snap.player.heading);
    const a = 4.5 / scale;
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(0, -a);
    ctx.lineTo(a * 0.7, a * 0.8);
    ctx.lineTo(0, a * 0.4);
    ctx.lineTo(-a * 0.7, a * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // back to screen space, clip removed

    // Rim arrow toward the next obstacle.
    const target = this.nextTarget(snap);
    if (target) {
      const dx = target[0] - px, dz = target[1] - pz;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const sx = dx * cos - dz * sin, sy = dx * sin + dz * cos; // radar-frame offset (m)
      const dist = Math.hypot(sx, sy) * scale;
      const ang = Math.atan2(sy, sx);
      const lvl = snap.blockers.find((bl) => bl.id === snap.carrier?.next)?.level ?? 1;
      if (dist > r - 10) {
        ctx.save();
        ctx.translate(r + Math.cos(ang) * (r - 9), r + Math.sin(ang) * (r - 9));
        ctx.rotate(ang);
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = warningColor(lvl);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -6);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r + Math.cos(ang) * dist, r + Math.sin(ang) * dist, 6 + ((this.pulse * 12) % 6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this.drawRim(ctx, r);
  }

  private nextTarget(snap: GameSnapshot): [number, number] | null {
    const id = snap.carrier?.next;
    if (id === null || id === undefined || !this.level) return null;
    if (id < 0) {
      const g = this.level.gaps.find((gg) => gg.id === -id);
      return g ? [(g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2] : null;
    }
    const s = this.level.structures.find((ss) => ss.id === id);
    return s ? [s.x, s.z] : null;
  }

  private drawRim(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(r, r, r - 4, 0, Math.PI * 2);
    ctx.stroke();
    // Range rings.
    ctx.strokeStyle = 'rgba(125, 255, 106, 0.15)';
    ctx.beginPath();
    ctx.arc(r, r, (r - 4) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}
