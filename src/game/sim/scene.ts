import type { SceneDef } from '../../sim/scene-api.ts';
import type { LevelId } from '../shared/types.ts';
import { PathbreakersGame, type LevelDef } from './game.ts';
import { cinderFlats } from './levels/cinder.ts';
import { quarryRumble } from './levels/quarry.ts';

export const LEVELS: Record<LevelId, LevelDef> = { cinder: cinderFlats, quarry: quarryRumble };

/** Wraps a PATHBREAKERS level as an engine scene (rules run in the simulation worker). */
export function gameScene(id: LevelId): SceneDef {
  let game: PathbreakersGame | null = null;
  const level = LEVELS[id];
  return {
    name: id,
    description: `PATHBREAKERS — ${level.title}`,
    build(ctx) {
      game = new PathbreakersGame(ctx, level);
      game.build();
    },
    preStep(_ctx, dt) {
      game?.preStep(dt);
    },
    update(_ctx, dt) {
      game?.update(dt);
    },
    onMessage(_ctx, data) {
      game?.onMessage(data);
    },
  };
}
