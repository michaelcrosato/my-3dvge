# my-3dvge

Physics-first, Teardown-inspired destructible voxel engine for the browser (three.js WebGPU + WebGL2
fallback, Rapier in a worker, Vite + strict TypeScript). Built as an **engine for AI agents to make
games on**. Primary target: Galaxy S26 / Chrome Android at a steady 60 fps. Full spec:
**[docs/SPEC.md](docs/SPEC.md)** — read it before architectural changes. Game/scene API: `docs/ENGINE.md`.
The shipped tech-demo game is **PATHBREAKERS** (Blast Corps-inspired): design in **[docs/GAME.md](docs/GAME.md)**,
code in `src/game/` (sim rules in `sim/`, voxel art in `sim/art/`, main-thread client/camera in `client/`,
UI in `client/ui/`, procedural WebAudio in `client/audio/`, contract in `shared/types.ts`). It is the default
scene (`/`); engine sandboxes stay at `?scene=test|city|stress|gallery`.

## Commands

```bash
npm ci                 # install (Node LTS from .nvmrc)
npm run dev            # Vite dev server with COOP/COEP headers
npm run typecheck      # tsc --noEmit (strict)
npm test               # Vitest unit + physics tests
npm run build          # production build → dist/
npm run preview        # serve dist/ with the same headers as Vercel
npm run test:e2e       # Playwright smoke test (local preview; set BASE_URL to test a deployment)
npm run gen:assets     # regenerate procedural .vox assets → public/vox (node runs the .ts directly)
```

## Layout

- `src/app` main-thread engine (loop, input → worker, interpolation, bench) · `src/render` three.js
  (world view, particles, environment, dynamic resolution) · `src/debug` HUD/overlay/diagnostics/lil-gui
- `src/sim` simulation worker: `world.ts` (volumes, bodies, colliders, budget), `destruction.ts`,
  `player.ts`, `physics/` (PhysicsBackend + Rapier), `scenes/` (**games live here**, see docs/ENGINE.md)
- `src/voxel` pure logic: volume/chunks, mesher (+AO), box merging, flood fill, .vox, palette/materials
- `src/mesher` mesher worker · `src/shared` protocol + SharedArrayBuffer transform ring
- `src/app/clients.ts` registers per-scene main-thread game clients (`GameClient`); `src/game/` is one
- Dev harnesses: `?harness=ui` (all game screens with fake data), `?harness=audio` (every sound/music state)

## Conventions

- Units are meters; voxel size 0.1 m; chunks are 32³, 1 byte/voxel, palette of 255 entries.
- Main thread = render + input only. All game state lives in the simulation worker. Pure logic
  (meshing, flood fill, box merging, .vox) lives in side-effect-free modules with unit tests.
- Physics goes through the `PhysicsBackend` interface — never import Rapier outside its backend.
- No new runtime dependency without a written reason in the PR. Self-host everything (no CDNs).
- TypeScript strict + `erasableSyntaxOnly` (no enums/namespaces/parameter properties) so Node can run
  shared modules directly from `scripts/`.

## Workflow rules

- One branch + PR per milestone; conventional commits; squash-merge only when GitHub Actions **and**
  the Vercel preview are green; tag `main` per milestone (M0 v0.1.0 … M4 v0.5.0).
- Before pushing: `npm run typecheck && npm test && npm run build && npm run test:e2e`.
- The owner tests only through Vercel URLs on a phone: keep the HUD, error overlay and diagnostics
  working, and show the commit SHA so builds can be verified.
- Never commit secrets, `.env*` or `.vercel/`.
