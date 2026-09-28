import type { SceneName } from '../config/params.ts';
import type { GameClient } from './game-client.ts';

/** Scenes with a main-thread game client (code-split: only loaded when that scene runs). */
export const CLIENTS: Partial<Record<SceneName, () => Promise<GameClient>>> = {};
