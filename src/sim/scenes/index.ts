import type { SceneName } from '../../config/params.ts';
import type { SceneDef } from '../scene-api.ts';
import { cityScene } from './city.ts';
import { galleryScene } from './gallery.ts';
import { gameScene } from '../../game/sim/scene.ts';
import { stressScene } from './stress.ts';
import { testScene } from './test.ts';

/** Scene registry: add a SceneDef here (and to SceneName) to make it selectable with ?scene=. */
export const SCENES: Partial<Record<SceneName, SceneDef>> = {
  test: testScene,
  city: cityScene,
  stress: stressScene,
  gallery: galleryScene,
  cinder: gameScene('cinder'),
  quarry: gameScene('quarry'),
};

export function getScene(name: SceneName): SceneDef {
  return SCENES[name] ?? testScene;
}
