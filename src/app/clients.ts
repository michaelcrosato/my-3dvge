import type { SceneName } from '../config/params.ts';
import type { GameClient } from './game-client.ts';

const pathbreakers = () => import('../game/client/index.ts').then((m) => m.createClient());

/** Scenes with a main-thread game client (code-split: only loaded when that scene runs). */
export const CLIENTS: Partial<Record<SceneName, () => Promise<GameClient>>> = {
  cinder: pathbreakers,
  quarry: pathbreakers,
};
