# my-3dvge

Physics-first, Teardown-inspired **destructible voxel engine** for the browser — three.js WebGPU (with
WebGL2 fallback), Rapier physics in a worker, Vite + TypeScript. Built so AI agents can make games on it.

## PATHBREAKERS — the tech-demo game

**Live: https://my-3dvge.vercel.app** · design: [docs/GAME.md](docs/GAME.md)

An original game inspired by *Blast Corps* (Rare, 1997): a runaway Hazard Carrier rolls in a dead-straight
line and explodes on contact with anything. Hop between five demolition machines — PLOWHORSE (dozer),
TAILWHIP (tail-slide dump truck), SKYLARK (jump buggy), LONGBOW (missile bike), HAMMERHEAD (stomp mech) —
plus the FREIGHT HOPPER rail car, to flatten the lane, bridge the gaps and get the carrier home.
Mission **Cinder Flats** (≈ 3½ min, 34 buildings, 100 RDUs, 8 survivors, 2 dishes), **Time Attack**, and the
**Quarry Rumble** bonus stage. Six cameras: overhead ¾, chase, cockpit, isometric, 2.5D side, tactical.

Controls — keyboard: WASD drive · Space jump/thrust · Shift action · E enter/exit · C camera · V carrier view ·
R reset · F fast-forward · Esc pause. Gamepad: stick/triggers drive · A jump · X action · Y enter · View camera ·
LB carrier view. Touch: left joystick + ACTION / JUMP / ENTER / CAM buttons.

Engine sandbox scenes: `?scene=test|city|stress|gallery` (the original engine demo and the art gallery).

- Spec: [docs/SPEC.md](docs/SPEC.md) · Make a game: [docs/ENGINE.md](docs/ENGINE.md) · Agent guide: [CLAUDE.md](CLAUDE.md)
- Live: https://my-3dvge.vercel.app
- URL params: `?debug=1` (HUD) · `renderer=webgl` · `quality=low|medium|high` · `scene=cinder|quarry|test|city|stress|gallery`
  · `maxBodies=150` · `bench=1&benchTime=300`

Sandbox controls — desktop: click to lock the mouse, WASD/Space/Shift, click = blast, `E` = crate, `F` = fly.
Mobile: left thumb joystick, drag right side to look, Blast/Crate/Jump/Fly buttons.

```bash
npm ci && npm run dev      # then open http://localhost:5173/?debug=1
npm test && npm run test:e2e
```

MIT licensed.
