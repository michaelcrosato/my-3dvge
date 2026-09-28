/// <reference types="vite/client" />

/** Full git SHA injected at build time from VERCEL_GIT_COMMIT_SHA, or "local". */
declare const __COMMIT_SHA__: string;
/** ISO timestamp of the build. */
declare const __BUILD_TIME__: string;

interface Window {
  __bootErrors?: { message: string; stack?: string }[];
}
