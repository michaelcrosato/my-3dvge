import type { SceneName } from '../../config/params.ts';
import type { SceneDef } from '../scene-api.ts';
import { testScene } from './test.ts';

/** Scene registry: add a SceneDef here (and to SceneName) to make it selectable with ?scene=. */
export const SCENES: Partial<Record<SceneName, SceneDef>> = {
  test: testScene,
};

export function getScene(name: SceneName): SceneDef {
  return SCENES[name] ?? testScene;
}
