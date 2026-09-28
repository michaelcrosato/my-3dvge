# System audit — 2026-09-28

Baseline: `0954095` (PATHBREAKERS vertical slice). Scope: every engine and game subsystem, with fixes
for reproducible defects and bounded optimizations that preserve gameplay and the worker architecture.

| System | Review and outcome | Verification |
| --- | --- | --- |
| Simulation host, loop and restart | Queued pause/resume messages could start two worker timer loops during initialization. Start once, cancel the timer on pause, and respect tab visibility on restart. Resolve canceled blast requests and stop old benchmarks on restart. | Fake-timer worker lifecycle regression; real pause/retry and canceled-request browser test. |
| Transform transport and interpolation | Shared ring views could change beneath a stalled renderer. Publish per-slot sequence numbers and copy/validate snapshots with bounded retries and reusable buffers. Preserve quaternion interpolation and slot-owner snapping. | Shared and posted transport unit tests, ring wrap and in-progress writes; browser test without cross-origin isolation. |
| Voxel storage and meshing | Corner and edge edits invalidated only face neighbors, leaving diagonal AO stale. Invalidate the full padding neighborhood while rebuilding colliders only for the edited chunk. | Corner AO geometry regression plus existing face, winding, greedy merge and padding tests. |
| Mesh dispatch and rendering | Empty mesh results discarded their version; older results from another mesher could restore deleted geometry. Keep version tombstones for both merged and per-chunk rendering. Skip unchanged camera far-plane/projection updates. | Out-of-order meshes before/after volume creation, deletion and removal; rendered browser checks. |
| Physics, colliders and body budgets | Removing a Rapier body freed native colliders but retained JS collider-group references. Release owned groups and vehicle/character controllers with their body. | Repeated lifecycle regression, crate rest, mass, sleeping/budget, walker steps, and vehicle physics tests. |
| Destruction, structures and explosions | Reviewed carving, strength, anchoring, island extraction, structural collapse, chain reactions and debris cleanup. Dozer grind damage had bypassed material strength; now only eligible material contacts receive bonus damage. | Stone/metal resistance regression; existing collapse, explosive, island, obstacle and vehicle tests. |
| Vehicle mechanics and carrier puzzles | Reviewed all seven vehicles, corridor collision, pit filling, rail lock, missile and pickup paths. Reduce dozer grind contact scans from 60 to 10 per simulated second, retaining the damage rate while grinding. | Brick destruction still passes alongside resistant-material tests; train, gap, carrier, movement and mission tests. |
| Input and game flow | Focus loss left touch direction, pointer ids and pending presses active; key releases over form inputs could be ignored. Clear input on focus loss/level transitions. Cancel delayed failure/results screens, old fuse timers and alignment state on retry. | Interrupted mobile touch gesture, worker pause, restart-before-failure-screen browser regressions. |
| Cameras, markers, UI and radar | Reviewed camera modes, world/UI markers, HUD, menus, radar projection and results. Correct how-to text to match the implemented D-pad and touch bindings. | UI formatting tests; title, briefing, mission and retry browser checks; desktop visual inspection. |
| Save data | Blindly merging stored JSON admitted invalid cameras, audio values and malformed records. Validate fields independently and preserve valid progress; retain defaults for invalid fields. | Missing, malformed, blocked and mixed-validity storage tests; record/unlock preservation. |
| Audio | Reviewed synthesis, loops, spatialization, music scheduling and voice limiting. Scheduled fuse ticks bypassed the one-shot cap; route them through the same bounded pool. | Saturated live pool with fuse scheduling; offline rendering of every SFX and all four music tracks; theory tests. |
| Assets, art and level construction | Reviewed shape/palette helpers, procedural models, terrain/holes, level placement, scene registry and asset generation. Reject negative/truncated `.vox` chunks and impossible record/string lengths before reads/allocations. Validate dimensions and round-trip UTF-8 metadata. | Generated assets, art budgets, level/obstacle tests, malformed binary and UTF-8 regressions; city/stress browser loading. |
| Configuration, diagnostics and delivery | Reviewed URL bounds, quality/resolution control, frame/bench statistics, HUD/error reporting, build stamping, CI and isolation/cache headers. Existing behavior retained. | Params/formatting tests, benchmark report, WebGL fallback, error overlays and deployment header checks. |

No runtime dependencies were added. The shared-transform copy trades a bounded 256 KiB of reusable
reader buffers at 2,048 slots for consistent render-frame data; no per-frame typed-array allocation is
needed after warmup. The dozer optimization reduces query frequency by six; it is not a claim of a
sixfold overall frame-rate improvement.

Browser checks use Chromium with software WebGL, including touch emulation. They validate behavior,
not sustained Galaxy S26 performance or GPU-specific WebGPU behavior. A physical phone thermal run
remains a separate performance measurement. Existing deliberate limits (bounded anchored flood search,
coarse debris colliders, `.vox` scene-graph chunks skipped) remain in place.

## Local validation

- `npm run typecheck` — passed.
- `npm test` — 112 tests passed across 17 files (baseline: 93 across 13).
- `npm run build` — passed.
- `npm run test:e2e` — 12 passed; the Vercel-only cache-header test is skipped locally.
- Biome error-level check of changed TypeScript and `git diff --check` — passed. Existing non-null
  assertion/style warnings are not treated as a newly introduced formatting mandate.
- Browser visual inspection — title, briefing and running mission render; no reported browser errors.

The PR must additionally pass GitHub Actions and Vercel preview checks before squash merge. Run the
browser suite with `BASE_URL` set to the preview to include the deployment cache/header assertion.
