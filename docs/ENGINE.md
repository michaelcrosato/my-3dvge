# Making games with my-3dvge

A guide for humans and AI agents. You write **scenes** (levels + game rules) against a small API; the
engine handles rendering, meshing, physics, destruction, input, debugging and deployment. You should not
need to touch `src/app`, `src/render`, `src/sim/world.ts` or the workers to make a new game.

## 1. Add a scene

1. Create `src/sim/scenes/<name>.ts` exporting a `SceneDef`:

   ```ts
   import { box } from '../../voxel/build.ts';
   import { VOXEL_SIZE } from '../../voxel/constants.ts';
   import { VoxelVolume } from '../../voxel/volume.ts';
   import type { SceneDef } from '../scene-api.ts';
   import { ground, standardKit } from './kit.ts';

   export const myScene: SceneDef = {
     name: 'mine',
     description: 'Topple the tower in 3 blasts.',
     async build(ctx) {
       const kit = standardKit(ctx.palette);                 // shared colors + materials
       const v = new VoxelVolume(320, 128, 320);             // 32 × 12.8 × 32 m (voxels are 0.1 m)
       const g = ground(v, kit);                             // bedrock anchor + dirt + grass
       box(v, 150, g, 150, 170, g + 100, 170, kit.concrete); // a 10 m tower
       ctx.addStatic(v, [-16, 0, -16]);                      // world position of voxel (0,0,0)
       ctx.setSpawn([0, 0.4, 10], 0);
       ctx.setBlastTarget([0, 2, 0]);
     },
     update(ctx, dt) {                                       // game rules, 60 Hz, in the sim worker
       if (ctx.dynamicBodyCount() > 20) ctx.setStatus('Tower down!');
     },
   };
   ```
2. Register it in `src/sim/scenes/index.ts` and add the name to `SceneName` in `src/config/params.ts`.
3. Open `/?scene=mine&debug=1`.

## 2. The API (`src/sim/scene-api.ts`)

| Call | What it does |
| --- | --- |
| `palette.add(color, material)` / `addShades(...)` / `findOrAdd(...)` | Palette entries (max 255, shared by the world). |
| `addStatic(volume, pos)` | Immovable, destructible volume. Voxel layer **y = 0 is the anchor**: after a blast, anything no longer connected to it falls. |
| `addDynamic(volume, pos, rot?)` | Rigid body made of voxels (mass = voxels × material density). |
| `loadVox(url, defaultMaterial?)` | Loads a MagicaVoxel file → `VoxAsset` (`toVolume()`, `stamp(target, x, y, z)`, `size()`). |
| `blast(center, radius?, power?)` | Carves a sphere; returns the number of new bodies. |
| `spawnCrate(origin, dir)` | Throws a 0.5 m crate. |
| `setStatus(text)` | Game text at the top of the screen. |
| `random()`, `time()`, `dynamicBodyCount()`, `playerPosition()` | Deterministic RNG, sim time, counts, player. |
| `setSpawn(pos, yaw)`, `setBlastTarget(pos)` | Player start; default target for tests/bench. |

Shape helpers (`src/voxel/build.ts`): `box`, `hollowBox`, `clearBox`, `sphere`, `cylinder`,
`blockShade` (per-block color variation that keeps greedy meshing effective), `brickPattern`.
Structures (`src/sim/scenes/kit.ts`): `standardKit`, `ground`, `house`.

## 3. Materials (`src/voxel/materials.ts`)

`dirt, grass, wood, concrete, brick, metal, glass, stone, bedrock` — each with density (kg/m³), strength,
friction and restitution. A blast of power P removes a voxel of strength S out to
`radius·√(P/S)`; `bedrock` never breaks (use it for anchor layers).

## 4. Assets

- `npm run gen:assets` runs `scripts/gen-assets.ts` (plain Node, no build step) → `public/vox/*.vox`.
- Copy that script's pattern to generate new assets: build `VoxModel`s with `createVoxModel`/`voxSet`
  (z-up .vox space), give palette entries a MATL `_material` (engine material name), `writeVox` them.
- Anything MagicaVoxel can open works too; `_metal`/`_glass` MATL types map to metal/glass.

## 5. Budgets that keep phones at 60 fps

- Keep static worlds ≲ 500 × 128 × 500 voxels; use `blockShade` rather than per-voxel random colors.
- Dynamic bodies are capped (`?maxBodies=`, default 150); the oldest debris despawns first.
- Every blast should stay local (radius ≲ 3 m). Fragments below the particle threshold become particles.
- Check the HUD (`?debug=1`): sim step ms, bodies, draw calls, triangles. Run `?bench=1` on the phone.

## 6. Testing

- Unit/physics tests run the simulation in Node: `new SimWorld(params, null, events, await RapierBackend.create())`,
  then `world.step(1/60)`; see `tests/unit/physics.test.ts`.
- Smoke tests drive the real page through `window.__engine` (`ready`, `framesRendered`, `bodyCount`,
  `triggerBlast()`, `startBench()`, `benchReport`, `stats()`).

## 7. Building a full game (the game layer)

For games with their own camera, UI and audio (see `src/game/` for PATHBREAKERS):

| Piece | Where | What it gives you |
| --- | --- | --- |
| `SceneDef.preStep / update / onMessage` | sim worker | Game rules before/after each 60 Hz physics step; messages from the client. |
| `ctx.send(data)` ↔ `engine.sendGame(data)` | both | Game-defined message channel between rules (worker) and client (main thread). |
| `GameClient` + `src/app/clients.ts` | main thread | Registered per scene; owns the camera (`engine.camera`), input (`engine.controls`: keyboard, mouse, touch joystick/buttons, gamepad), UI and audio. `engine.slotPose(slot, pos, quat)` gives interpolated poses. |
| `ctx.setGround(desc)` | sim | Big flat terrain: collider slabs (holes = pits/canals) + a nearest-sampled color map. |
| `ctx.addKinematic(...)` + `world.setKinematicPose` | sim | Script-driven volumes (carriers, trains, doors) that push dynamic bodies. |
| `VolumeOptions` | sim | `collide:false` (visual only), custom `colliders` (e.g. a chassis box), `destructible:false`, `lifetime`, `explosive`, body damping/CCD. |
| `world.structures.register(volumeId, def)` | sim | Integrity: carving/impact damage (`structures.damage`) past `collapseAt` fractures the building into physics debris + dust; `onCollapse` callback. |
| `carve(world, {kind:'box'\|'sphere', ...}, power)` / `querySolid` | sim | Oriented-box or sphere destruction and contact probing (vehicle blades, stomps). |
| Explosive material `tnt` | sim | Detonates when carved or hit hard; chains via `world.scheduleExplosion`. |
| `physics.createVehicle(chassis, wheels)` / `updateVehicle` | sim | Raycast-suspension vehicles (engine force > 0 drives toward -z; steer > 0 turns left). |
| `world.emitParticle` / `emitSmoke` | sim | Debris, smoke and fire particles (one instanced draw call). |
| `engine.restart(params)` | main | Restart or switch level without reloading the page. |
