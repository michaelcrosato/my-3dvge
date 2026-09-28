# my-3dvge

Physics-first, Teardown-inspired **destructible voxel engine** for the browser — three.js WebGPU (with
WebGL2 fallback), Rapier physics in a worker, Vite + TypeScript. Built so AI agents can make games on it.

- Spec: [docs/SPEC.md](docs/SPEC.md) · Agent guide: [CLAUDE.md](CLAUDE.md)
- URL params: `?debug=1` (HUD) · `renderer=webgl` · `quality=low|medium|high` · `scene=test|city|stress`
  · `maxBodies=150` · `bench=1&benchTime=300`

```bash
npm ci && npm run dev
```

MIT licensed.
