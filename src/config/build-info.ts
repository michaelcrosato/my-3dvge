const sha = typeof __COMMIT_SHA__ === 'string' ? __COMMIT_SHA__ : 'local';
const time = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date(0).toISOString();

export const BUILD_INFO = {
  sha,
  shortSha: sha === 'local' ? 'local' : sha.slice(0, 7),
  time,
} as const;
