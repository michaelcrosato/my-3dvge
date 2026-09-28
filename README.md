# my-3dvge

Physics-first, Teardown-inspired **destructible voxel engine** for the browser — three.js WebGPU (with
WebGL2 fallback), Rapier physics in a worker, Vite + TypeScript. Built so AI agents can make games on it.

- Spec: [docs/SPEC.md](docs/SPEC.md) · Make a game: [docs/ENGINE.md](docs/ENGINE.md) · Agent guide: [CLAUDE.md](CLAUDE.md)
- Live: https://my-3dvge.vercel.app
- URL params: `?debug=1` (HUD) · `renderer=webgl` · `quality=low|medium|high` · `scene=test|city|stress`
  · `maxBodies=150` · `bench=1&benchTime=300`

Controls — desktop: click to lock the mouse, WASD/Space/Shift, click = blast, `E` = crate, `F` = fly.
Mobile: left thumb joystick, drag right side to look, Blast/Crate/Jump/Fly buttons.

```bash
npm ci && npm run dev      # then open http://localhost:5173/?debug=1
npm test && npm run test:e2e
```

MIT licensed.
