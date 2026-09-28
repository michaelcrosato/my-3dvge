/** GPU/adapter probing for the "Copy diagnostics" report. */

export interface GpuInfo {
  api: 'WebGPU' | 'WebGL2' | 'none';
  webgpuAvailable: boolean;
  adapter?: Record<string, string>;
  limits?: Record<string, number>;
  features?: string[];
  webgl?: Record<string, string | number>;
  error?: string;
}

export async function probeGpu(): Promise<GpuInfo> {
  const info: GpuInfo = { api: 'none', webgpuAvailable: false };
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu) {
      const adapter = (await gpu.requestAdapter()) as {
        info?: Record<string, unknown>;
        limits?: Record<string, unknown>;
        features?: Iterable<string>;
      } | null;
      if (adapter) {
        info.api = 'WebGPU';
        info.webgpuAvailable = true;
        info.adapter = {};
        for (const key of ['vendor', 'architecture', 'device', 'description']) {
          const v = adapter.info?.[key];
          if (v !== undefined && v !== '') info.adapter[key] = String(v);
        }
        info.limits = {};
        for (const key in adapter.limits) {
          const v = adapter.limits[key];
          if (typeof v === 'number') info.limits[key] = v;
        }
        info.features = adapter.features ? [...adapter.features] : [];
      }
    }
  } catch (e) {
    info.error = String(e);
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      if (info.api === 'none') info.api = 'WebGL2';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      info.webgl = {
        vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
        renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
        version: String(gl.getParameter(gl.VERSION)),
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        maxSamples: Number(gl.getParameter(gl.MAX_SAMPLES)),
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (e) {
    info.error = `${info.error ?? ''} webgl: ${String(e)}`;
  }
  return info;
}

export function environmentInfo(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    url: location.href,
  };
}
