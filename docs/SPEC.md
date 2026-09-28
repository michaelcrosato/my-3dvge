# my-3dvge — Specification

A physics-first, Teardown-inspired destructible voxel game engine for the browser, built so that AI
agents can design and ship games on top of it without re-inventing the engine each time.

## 1. Vision

- **Physics and game design first.** Lighting and shadows matter but must stay cheap.
- **Primary target:** Samsung Galaxy S26, Chrome for Android, a **steady 60 fps sustained over 10+
  minutes** of play (thermal throttling is the real enemy).
- **Also runs** in desktop Chrome, Edge and Firefox, using the WebGL2 fallback wherever WebGPU is
  unavailable.
- **Engine, not a one-off game:** scenes and game rules are plain modules written against a small,
  documented API (`docs/ENGINE.md`), so an agent can add a game by adding files, not by rewriting systems.

## 2. Repo and deployment

- Public repo `github.com/michaelcrosato/my-3dvge`, MIT license. Never commit secrets, `.env` files or
  the `.vercel` folder.
- Deployed on **Vercel via its GitHub integration**: pushes to `main` go to production, every PR gets a
  preview URL. The phone is tested **only** through these URLs. Find the production URL via the GitHub
  deployments API or the Vercel bot's PR comments.
- `vercel.json` sets framework `vite`, the build command and output dir `dist`. On every route it sets
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Hashed
  assets (`/assets/*`) are cached as immutable; `index.html` is never cached. **Self-host everything**: no
  CDNs, no third-party scripts.
- **Git workflow:** one branch + PR per milestone. Squash-merge only when GitHub Actions **and** the
  Vercel preview are both green. Tag `main` after each milestone: M0→`v0.1.0`, M1→`v0.2.0`,
  M2→`v0.3.0`, M3→`v0.4.0`, M4→`v0.5.0`. Conventional commit messages.
- **GitHub Actions** on every PR and push to `main`: `npm ci` → typecheck → unit tests → build →
  Playwright smoke test against the built site served with the same headers.

## 3. Stack

- Vite + TypeScript (strict), npm, current Node LTS pinned in `.nvmrc` and `package.json` `engines`.
- Latest three.js with `WebGPURenderer` (import from `three/webgpu`) and its WebGL2 fallback.
  `?renderer=webgl` forces the fallback.
- Rapier physics: `@dimforge/rapier3d-simd-compat` (published; falls back to `@dimforge/rapier3d-compat`
  only if SIMD is unavailable), behind a `PhysicsBackend` interface so Jolt can be swapped in later.
- Vitest (unit), Playwright/Chromium (smoke), lil-gui (tuning panel). **No other runtime dependency**
  without a reason written in the PR.

## 4. Architecture

### Threads
- **Main thread:** rendering and input only.
- **Simulation worker:** owns all game state — voxel data, the Rapier world, destruction, island
  splitting and game rules.
- **Mesher worker pool:** builds chunk meshes and returns them as transferable `ArrayBuffer`s.
- Body transforms are shared through a `SharedArrayBuffer` when `crossOriginIsolated` is true, with a
  `postMessage` fallback so the engine still runs when it isn't.

### Units and voxel data
- Meters. **Voxel size = 0.1 m.**
- Every object is a `VoxelVolume` with its own transform, stored in **32³ chunks, 1 byte per voxel**
  (0 = empty). Each byte indexes a **255-entry palette**; a palette entry has a color and a material
  (wood, concrete, metal, glass, dirt, …) with density and strength.

### Rendering
- Greedy meshing per chunk with **baked per-vertex ambient occlusion**, one directional light with a
  shadow map, and fog.
- Quality presets (low/medium/high) set shadow resolution, pixel ratio and view distance.
- **Dynamic resolution** lowers the pixel ratio when frame time goes over budget.

### Colliders
- Never one collider per voxel. Greedy-merge solid voxels into boxes; one compound collider per
  dynamic body. Static volumes get one compound collider **per chunk**, rebuilt only for changed chunks.

### Destruction
- `carve(worldPos, radius, power)` removes voxels; weaker materials break more.
- After a carve, flood-fill the affected volume (6-connectivity):
  - **Static volumes:** voxels no longer connected to anchor voxels (touching the ground) become new
    dynamic bodies.
  - **Dynamic volumes:** each disconnected island becomes its own body.
  - Mass = voxel count × material density.
  - Fragments below a configurable voxel count become non-colliding particles.

### Budgets and loop
- Max active dynamic bodies (default 150, configurable), aggressive sleeping, and the oldest debris
  despawns when over budget. Splitting and remeshing must **never hitch the main thread**.
- Fixed **60 Hz** simulation step in the worker; the renderer interpolates between the last two states.

### Player
- First-person Rapier kinematic character controller that walks up 1-voxel steps.
- **Desktop:** WASD + pointer-lock mouse look, click to blast, `E` to spawn a crate.
- **Mobile:** virtual joystick on the left, drag to look, on-screen blast and spawn buttons.

### Assets
- MagicaVoxel `.vox` reader and writer, round-trip tested.
- `scripts/` holds Node scripts that generate `.vox` assets procedurally (crates, walls, buildings), so
  AI-written scripts can produce assets too. Procedural test scenes until real assets exist.

## 5. Phone testing tools (the phone has no devtools)

- **HUD** (`?debug=1` or a toggle button): FPS, frame ms, sim step ms; active/sleeping bodies and voxel
  count; draw calls and triangles; renderer (WebGPU/WebGL2), `crossOriginIsolated`, quality preset;
  git commit SHA + build time (from `VERCEL_GIT_COMMIT_SHA` at build time, else `local`).
- **Error overlay** catching uncaught errors, unhandled promise rejections and worker errors.
- **Copy diagnostics** button: JSON with user agent, GPU adapter info and limits, renderer, settings,
  commit SHA and recent frame stats.
- **URL params:** `renderer`, `quality`, `scene` (`test` | `city` | `stress`), `maxBodies`, `bench`,
  `debug`.
- **Bench mode** (`?bench=1` or a button): scripted camera path with timed blasts and crate spawns, runs
  for a configurable time (default 5 min), then reports p50/p95/p99 frame time, first-minute vs
  last-minute average (thermal throttling) and peak body count, with a copy button.
- **lil-gui panel:** gravity, blast radius and power, material strength, body cap, particle threshold,
  quality.
- **`window.__engine`** debug handle exposing stats and test hooks (`framesRendered`, `bodyCount`,
  `triggerBlast`) for Playwright.

## 6. Milestones

| Milestone | Scope | Tag |
| --- | --- | --- |
| **M0 Pipeline** | Scaffold, `vercel.json`, CI, Vitest + Playwright, HUD, error overlay, diagnostics, spinning test cube — proven live on Vercel with headers present. | v0.1.0 |
| **M1 Voxels** | `VoxelVolume` + chunks, mesher workers, greedy meshing + AO, procedural test scene, free-fly camera, quality presets. | v0.2.0 |
| **M2 Physics** | Simulation worker + Rapier, compound colliders, crates that fall and rest, interpolation, player controller, touch controls. | v0.3.0 |
| **M3 Destruction** | Carve, anchored flood fill, island splitting, particles, body budget, lil-gui panel. | v0.4.0 |
| **M4 Assets & bench** | `.vox` reader/writer, asset scripts, city and stress scenes, bench mode, dynamic resolution. | v0.5.0 |

## 7. Required tests

- **Unit (Vitest):** greedy mesher face counts on known shapes; AO values; flood fill + anchoring
  (known shapes split into expected islands); `.vox` round trip; collider box merging (merged boxes cover
  exactly the solid voxels).
- **Physics (Node + Rapier):** a crate dropped on the ground comes to rest within 3 s; carving through a
  pillar under a slab creates at least one new dynamic body.
- **Smoke (Playwright, Chromium, `?scene=test&quality=low`):**
  - page loads with no console errors from our own origin (ignore other origins, e.g. Vercel toolbar);
  - `crossOriginIsolated` is true and `framesRendered` keeps increasing;
  - from M2: `bodyCount > 0`; from M3: `triggerBlast` creates new bodies;
  - runs against a local preview in CI, and against any URL when `BASE_URL` is set.
