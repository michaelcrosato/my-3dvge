import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Reuse the exact isolation headers from vercel.json so dev/preview behave like production.
interface VercelHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: VercelHeaderRule[];
};
const allRoutes = vercel.headers.find((rule) => rule.source === '/(.*)');
const isolationHeaders = Object.fromEntries((allRoutes?.headers ?? []).map((h) => [h.key, h.value]));

const sha = process.env.VERCEL_GIT_COMMIT_SHA;

export default defineConfig({
  define: {
    __COMMIT_SHA__: JSON.stringify(sha && sha.length > 0 ? sha : 'local'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
});
