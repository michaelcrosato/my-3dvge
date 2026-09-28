/**
 * Dev-only offline rendering (OfflineAudioContext) of effects and music through the real master chain,
 * so automated checks can verify sounds are non-silent and don't clip without anyone listening.
 */
import { buildMasterChain } from './engine.ts';
import type { MusicTrack, SfxName } from './index.ts';
import { MusicSequencer } from './music.ts';
import { SFX, SFX_LEVEL } from './sfx.ts';
import { Synth } from './synth.ts';

export interface RenderStats {
  peak: number;
  rms: number;
  /** Rendered length (s). */
  seconds: number;
  /** When the recipe reported it ends (s). */
  end: number;
}

const SR = 44100;

function analyze(buf: AudioBuffer, upTo: number): { peak: number; rms: number } {
  let peak = 0, sum = 0, count = 0;
  const n = Math.min(buf.length, Math.ceil(upTo * buf.sampleRate));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]!);
      if (a > peak) peak = a;
      sum += d[i]! * d[i]!;
      count++;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, count)) };
}

export async function renderSfxOffline(name: SfxName, volume = 1): Promise<RenderStats> {
  const guess = 4;
  const ctx = new OfflineAudioContext(2, SR * guess, SR);
  const s = new Synth(ctx);
  const master = buildMasterChain(ctx, ctx.destination);
  const out = s.gain(volume * (SFX_LEVEL[name] ?? 0.7), master);
  const end = SFX[name]!(s, out, 0.01, 1);
  const buf = await ctx.startRendering();
  const { peak, rms } = analyze(buf, Math.min(guess, end + 0.05));
  return { peak, rms, seconds: guess, end };
}

export async function renderMusicOffline(track: MusicTrack, tension: number, seconds = 6): Promise<RenderStats> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const s = new Synth(ctx);
  const master = buildMasterChain(ctx, ctx.destination);
  const bus = s.gain(0.6 * 0.8, master);
  const seq = new MusicSequencer(s, bus);
  seq.set(track, tension);
  seq.schedule(seconds - 0.3);
  const buf = await ctx.startRendering();
  const { peak, rms } = analyze(buf, seconds);
  return { peak, rms, seconds, end: seconds };
}
