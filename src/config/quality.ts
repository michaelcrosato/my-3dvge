import type { QualityName } from './params.ts';

export interface QualityPreset {
  name: QualityName;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-extent (m) of the shadow camera box that follows the viewer. */
  shadowExtent: number;
  /** Upper bound for the device pixel ratio. */
  maxPixelRatio: number;
  /** Floor for dynamic resolution. */
  minPixelRatio: number;
  /** Camera far plane and fog end, in meters. */
  viewDistance: number;
}

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', shadows: true, shadowMapSize: 512, shadowExtent: 14, maxPixelRatio: 1, minPixelRatio: 0.5, viewDistance: 60 },
  medium: { name: 'medium', shadows: true, shadowMapSize: 1024, shadowExtent: 20, maxPixelRatio: 1.5, minPixelRatio: 0.6, viewDistance: 100 },
  high: { name: 'high', shadows: true, shadowMapSize: 2048, shadowExtent: 28, maxPixelRatio: 2, minPixelRatio: 0.75, viewDistance: 160 },
};

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

/** Phones start at medium (dynamic resolution handles the rest); desktops at high. */
export function defaultQuality(): QualityName {
  return isMobileDevice() ? 'medium' : 'high';
}
