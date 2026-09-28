import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and page errors that originate from the site under test. */
function trackErrors(page: Page, origin: string): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location().url;
    // Ignore other origins (e.g. the Vercel preview toolbar).
    if (url && !url.startsWith(origin)) return;
    errors.push(`${msg.text()} @ ${url}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function frames(page: Page): Promise<number> {
  return page.evaluate(() => window.__engine?.framesRendered ?? 0);
}

test('boots, is cross-origin isolated and keeps rendering', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const errors = trackErrors(page, origin);

  const response = await page.goto('/?scene=test&quality=low');
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('require-corp');

  await page.waitForFunction(() => window.__engine?.ready === true, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

  const first = await frames(page);
  await page.waitForFunction((f) => (window.__engine?.framesRendered ?? 0) > f + 10, first, { timeout: 30_000 });
  // Voxel chunks were meshed by the worker pool and uploaded.
  await page.waitForFunction(() => Number(window.__engine!.stats().chunkMeshes ?? 0) > 0, undefined, { timeout: 30_000 });
  // Physics: dynamic bodies exist (scene crates) and the simulation is stepping.
  await page.waitForFunction(() => (window.__engine?.bodyCount ?? 0) > 0, undefined, { timeout: 30_000 });
  const stats = await page.evaluate(() => window.__engine!.stats());
  console.log(`renderer=${await page.evaluate(() => window.__engine!.renderer)} stats=${JSON.stringify(stats)}`);

  expect(errors).toEqual([]);
});

test('triggerBlast breaks the pillar and creates new bodies', async ({ page, baseURL }) => {
  const errors = trackErrors(page, new URL(baseURL!).origin);
  await page.goto('/?scene=test&quality=low');
  await page.waitForFunction(() => window.__engine?.ready === true && window.__engine.bodyCount > 0, undefined, { timeout: 60_000 });
  const before = await page.evaluate(() => window.__engine!.bodyCount);
  const created = await page.evaluate(() => window.__engine!.triggerBlast());
  expect(created).toBeGreaterThan(0);
  await page.waitForFunction((b) => window.__engine!.bodyCount > b, before, { timeout: 10_000 });
  const f = await frames(page);
  await page.waitForFunction((n) => (window.__engine?.framesRendered ?? 0) > n + 10, f, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

for (const scene of ['city', 'stress']) {
  test(`${scene} scene loads (.vox assets / many bodies) without errors`, async ({ page, baseURL }) => {
    const errors = trackErrors(page, new URL(baseURL!).origin);
    await page.goto(`/?scene=${scene}&quality=low`);
    await page.waitForFunction(() => window.__engine?.ready === true && window.__engine.bodyCount > 0, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => Number(window.__engine!.stats().chunkMeshes ?? 0) > 20, undefined, { timeout: 30_000 });
    expect(await window_blast(page)).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test('bench mode runs and reports percentiles', async ({ page }) => {
  await page.goto('/?scene=test&quality=low&bench=1&benchTime=6');
  await page.waitForFunction(() => window.__engine?.benchReport != null, undefined, { timeout: 60_000 });
  const report = (await page.evaluate(() => window.__engine!.benchReport)) as { frames: number; frameMs: { p50: number; p99: number }; peakBodies: number };
  expect(report.frames).toBeGreaterThan(30);
  expect(report.frameMs.p99).toBeGreaterThanOrEqual(report.frameMs.p50);
  expect(report.peakBodies).toBeGreaterThan(0);
  await expect(page.locator('.bench-report')).toBeVisible();
});

async function window_blast(page: Page): Promise<number> {
  return page.evaluate(() => window.__engine!.triggerBlast());
}

test('forced WebGL2 fallback renders', async ({ page, baseURL }) => {
  const errors = trackErrors(page, new URL(baseURL!).origin);
  await page.goto('/?scene=test&quality=low&renderer=webgl');
  await page.waitForFunction(() => window.__engine?.ready === true, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__engine!.renderer)).toBe('WebGL2');
  const first = await frames(page);
  await page.waitForFunction((f) => (window.__engine?.framesRendered ?? 0) > f + 10, first, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('deployment serves cache headers', async ({ request }) => {
  test.skip(!process.env.BASE_URL, 'Vercel-only headers; checked when BASE_URL is set');
  const index = await request.get('/');
  expect(index.headers()['cache-control']).toContain('no-store');
  const html = await index.text();
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
  expect(asset).toBeTruthy();
  const res = await request.get(asset!);
  expect(res.headers()['cache-control']).toContain('immutable');
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
});

test('PATHBREAKERS: title → mission → drive → path clear → results, without errors', async ({ page, baseURL }) => {
  const errors = trackErrors(page, new URL(baseURL!).origin);
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__pathbreakers?.level != null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__pathbreakers!.flow)).toBe('title');
  expect(await page.evaluate(() => window.__pathbreakers!.level!.totals)).toEqual({ buildings: 34, survivors: 8, rdus: 100, dishes: 2 });
  await page.evaluate(() => window.__pathbreakers!.start('cinder', 'mission'));
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'briefing', undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__pathbreakers!.begin();
    window.__pathbreakers!.send({ t: 'skipFlyover' });
  });
  await page.waitForFunction(() => window.__pathbreakers!.snapshot?.state === 'running', undefined, { timeout: 20_000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__pathbreakers!.snapshot?.player.vehicle === 'dozer', undefined, { timeout: 5_000 });
  const x0 = await page.evaluate(() => window.__pathbreakers!.snapshot!.player.x);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.__pathbreakers!.snapshot!.player.x)).toBeGreaterThan(x0 + 1);
  await page.evaluate(() => window.__pathbreakers!.send({ t: 'debug', cmd: 'clearLane' }));
  await page.waitForFunction(() => window.__pathbreakers!.snapshot?.state === 'clear', undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__pathbreakers!.send({ t: 'finish' }));
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'results', undefined, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('PATHBREAKERS: Quarry Rumble bonus stage loads in place', async ({ page, baseURL }) => {
  const errors = trackErrors(page, new URL(baseURL!).origin);
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__pathbreakers?.level != null, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__pathbreakers!.start('quarry', 'mission'));
  await page.waitForFunction(() => window.__pathbreakers!.level?.level === 'quarry' && window.__pathbreakers!.flow === 'briefing', undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__pathbreakers!.begin();
    window.__pathbreakers!.send({ t: 'skipFlyover' });
  });
  await page.waitForFunction(() => window.__pathbreakers!.snapshot?.state === 'running', undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__pathbreakers!.snapshot!.targetsLeft)).toBe(12);
  expect(errors).toEqual([]);
});
