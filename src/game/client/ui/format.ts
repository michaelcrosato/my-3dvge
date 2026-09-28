/** Pure formatting helpers for the PATHBREAKERS UI (unit tested). */
import type { Medal, MissionResults } from '../../shared/types.ts';

/** m:ss.t (or m:ss without tenths). Negative values clamp to 0. */
export function formatTime(seconds: number, tenths = true): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (!tenths) return `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
  const whole = Math.floor(rest);
  const t = Math.min(9, Math.floor((rest - whole) * 10 + 1e-9));
  return `${m}:${String(whole).padStart(2, '0')}.${t}`;
}

/** $1,245,000 */
export function formatMoney(n: number): string {
  const v = Math.max(0, Math.round(n));
  return `$${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function percent(n: number, total: number): number {
  return total > 0 ? Math.round((Math.min(n, total) / total) * 100) : 100;
}

/** Average completion (0..100) over the categories that exist in the level. */
export function completionPercent(r: Pick<MissionResults, 'buildings' | 'survivors' | 'rdus' | 'dishes'>): number {
  const parts = [r.buildings, r.survivors, r.rdus, r.dishes].filter(([, t]) => t > 0);
  if (parts.length === 0) return 100;
  const sum = parts.reduce((acc, [n, t]) => acc + Math.min(n, t) / t, 0);
  return Math.round((sum / parts.length) * 100);
}

export const MEDAL_ORDER: readonly Medal[] = ['bronze', 'silver', 'gold', 'platinum'];

export function medalRank(m: Medal | undefined): number {
  return m ? MEDAL_ORDER.indexOf(m) + 1 : 0;
}

/** Medal earned for a time against bronze/silver/gold/platinum targets (lower is better). */
export function medalForTime(time: number, targets: Record<Medal, number> | null): Medal | undefined {
  if (!targets) return undefined;
  let best: Medal | undefined;
  for (const m of MEDAL_ORDER) if (time <= targets[m]) best = m;
  return best;
}

/** Warning colors by level 0 (green) .. 4 (dark red). */
export const WARNING_COLORS = ['#3ddc5a', '#ffd23f', '#ff8a1f', '#ff3b2f', '#b0101c'] as const;

export function warningColor(level: number): string {
  return WARNING_COLORS[Math.max(0, Math.min(4, Math.round(level)))]!;
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

const KEY_LABELS: Record<string, Record<InputDevice, string>> = {
  E: { keyboard: 'E', gamepad: 'Y', touch: 'ENTER' },
  Y: { keyboard: 'E', gamepad: 'Y', touch: 'ENTER' },
  R: { keyboard: 'R', gamepad: 'B', touch: 'RESET' },
  F: { keyboard: 'F', gamepad: 'D-PAD ▲', touch: '▶▶' },
  C: { keyboard: 'C', gamepad: 'VIEW', touch: 'CAM' },
  V: { keyboard: 'V', gamepad: 'LB', touch: 'CARRIER' },
  SHIFT: { keyboard: 'SHIFT', gamepad: 'X', touch: 'ACTION' },
  SPACE: { keyboard: 'SPACE', gamepad: 'A', touch: 'JUMP' },
  ESC: { keyboard: 'ESC', gamepad: 'MENU', touch: 'PAUSE' },
};

/**
 * Splits a sim prompt like "E  Enter PLOWHORSE" or "[E] Enter PLOWHORSE" into a device-appropriate key
 * chip and the remaining text. Unknown leading tokens stay in the text.
 */
export function devicePrompt(prompt: string, device: InputDevice): { key: string | null; text: string } {
  const m = /^\s*\[?([A-Za-z]+)\]?\s+(.+)$/.exec(prompt);
  if (m) {
    const labels = KEY_LABELS[m[1]!.toUpperCase()];
    if (labels) return { key: labels[device], text: m[2]!.trim() };
  }
  return { key: null, text: prompt.trim() };
}

/** "Is `a` a better run than `b`?" Missions rank by completion then time; timed modes by time. */
export function isRecord(
  a: { time: number; completion: number },
  b: { time: number; completion: number } | undefined,
  timed: boolean,
): boolean {
  if (!b) return true;
  if (timed) return a.time <= b.time;
  return a.completion > b.completion || (a.completion === b.completion && a.time <= b.time);
}
