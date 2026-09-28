import { WebGPURenderer } from 'three/webgpu';
import type { RendererPref } from '../config/params.ts';

export type BackendName = 'WebGPU' | 'WebGL2';

/**
 * Creates three's WebGPURenderer. It picks WebGPU when an adapter is available and otherwise falls back
 * to its WebGL2 backend by itself; ?renderer=webgl forces the fallback.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  pref: RendererPref,
): Promise<{ renderer: WebGPURenderer; backend: BackendName }> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: pref === 'webgl',
    powerPreference: 'high-performance',
  });
  await renderer.init();
  const isWebGPU = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  return { renderer, backend: isWebGPU ? 'WebGPU' : 'WebGL2' };
}
