/** URL parameters that configure the engine at boot. Pure: safe to unit test. */

export type RendererPref = 'auto' | 'webgpu' | 'webgl';
export type QualityName = 'low' | 'medium' | 'high';
export type SceneName = 'test' | 'city' | 'stress' | 'gallery' | 'cinder' | 'quarry';

export const SCENE_NAMES: readonly SceneName[] = ['test', 'city', 'stress', 'gallery', 'cinder', 'quarry'];
export const QUALITY_NAMES: readonly QualityName[] = ['low', 'medium', 'high'];

export interface Params {
  renderer: RendererPref;
  /** null = pick automatically from the device. */
  quality: QualityName | null;
  scene: SceneName;
  maxBodies: number;
  bench: boolean;
  /** Bench duration in seconds. */
  benchTime: number;
  debug: boolean;
  /** Start in free-fly camera mode instead of the walking player. */
  fly: boolean;
}

export const DEFAULT_PARAMS: Params = {
  renderer: 'auto',
  quality: null,
  scene: 'cinder',
  maxBodies: 150,
  bench: false,
  benchTime: 300,
  debug: false,
  fly: false,
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function flag(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function positiveInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null) return undefined;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

export function parseParams(search: string): Params {
  const q = new URLSearchParams(search);
  return {
    renderer: oneOf(q.get('renderer'), ['auto', 'webgpu', 'webgl'] as const) ?? DEFAULT_PARAMS.renderer,
    quality: oneOf(q.get('quality'), QUALITY_NAMES) ?? DEFAULT_PARAMS.quality,
    scene: oneOf(q.get('scene'), SCENE_NAMES) ?? DEFAULT_PARAMS.scene,
    maxBodies: positiveInt(q.get('maxBodies'), 1, 2000) ?? DEFAULT_PARAMS.maxBodies,
    bench: flag(q.get('bench')) ?? DEFAULT_PARAMS.bench,
    benchTime: positiveInt(q.get('benchTime'), 5, 3600) ?? DEFAULT_PARAMS.benchTime,
    debug: flag(q.get('debug')) ?? DEFAULT_PARAMS.debug,
    fly: flag(q.get('fly')) ?? DEFAULT_PARAMS.fly,
  };
}
