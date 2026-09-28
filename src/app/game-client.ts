import type { Engine } from './engine.ts';

/**
 * A main-thread game client: owns camera control, input translation, UI and audio for a scene whose
 * rules run in the simulation worker. Loaded by scene name from src/app/clients.ts.
 */
export interface GameClient {
  /** Called once, after the engine exists and before the first frame. */
  attach(engine: Engine): void | Promise<void>;
  /** Called when the simulation is (re)started and ready. */
  onReady?(): void;
  /** Messages the scene sent with ctx.send(). */
  onMessage(data: unknown): void;
  /** Every rendered frame, after volume transforms are interpolated. Must position engine.camera. */
  update(dt: number, time: number): void;
}
