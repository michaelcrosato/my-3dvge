import { expect, test } from '@playwright/test';
import type { SfxName } from '../../src/game/client/audio/index.ts';

test('touch movement stops after focus loss', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/?scene=test&quality=low&renderer=webgl');
  await page.waitForFunction(() => window.__engine?.ready && Number((window.__engine.stats().sim as { steps?: number })?.steps) > 30);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 290 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 230 }] });
  await expect(page.locator('.joy-base')).toBeVisible();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.joy-base')).toBeHidden();
  // Keep the pointer down: a missed touchend must not keep walking after returning to the tab.
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => window.__engine!.stats().camera as number[]);
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__engine!.stats().camera as number[]);
  expect(Math.hypot(after[0]! - before[0]!, after[2]! - before[2]!)).toBeLessThan(0.15);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await context.close();
});

test('retry cancels the previous failure screen and pause stops the worker', async ({ page }) => {
  await page.goto('/?scene=quarry&quality=low');
  await page.waitForFunction(() => window.__pathbreakers?.level != null);
  await page.evaluate(() => window.__pathbreakers!.start('quarry', 'mission'));
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'briefing');
  await page.evaluate(() => {
    window.__pathbreakers!.begin();
    window.__pathbreakers!.send({ t: 'skipFlyover' });
  });
  await page.waitForFunction(() => window.__pathbreakers!.snapshot?.state === 'running');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'paused');
  await page.waitForTimeout(500); // drain the last 250 ms stats update
  const steps = await page.evaluate(() => (window.__engine!.stats().sim as { steps: number }).steps);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window.__engine!.stats().sim as { steps: number }).steps)).toBe(steps);
  await page.getByRole('button', { name: 'RESUME', exact: true }).click();
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'playing');
  await page.evaluate(() => window.__pathbreakers!.send({ t: 'debug', cmd: 'fail' }));
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'failed');
  const cancelled = await page.evaluate(async () => {
    const pending = window.__engine!.triggerBlast([1000, 1000, 1000]);
    window.__pathbreakers!.start('quarry', 'mission');
    return pending;
  });
  expect(cancelled).toBe(0);
  await page.waitForFunction(() => window.__pathbreakers!.flow === 'briefing');
  await page.waitForTimeout(3500);
  await expect(page.locator('.pb-briefing')).toBeVisible();
  await expect(page.locator('.pb-failed')).toHaveCount(0);
  await expect(page.locator('.error-overlay')).toBeHidden();
});

test('audio recipes render and scheduled fuses respect the shared voice cap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?harness=audio');
  await page.locator('#ah-unlock').click();
  await page.waitForFunction(() => window.__audioHarness?.audio.stats().state === 'running');
  const caps = await page.evaluate(() => {
    const { audio, sfx } = window.__audioHarness!;
    for (const name of sfx) audio.play(name as SfxName, { volume: 0.2 });
    const before = audio.stats().voices;
    audio.setLoop('fuse', true);
    // Exercise the scheduler synchronously while the one-shot pool is saturated.
    (audio as unknown as { tick(): void }).tick();
    audio.setLoop('fuse', false);
    return { before, after: audio.stats().voices };
  });
  expect(caps.before).toBe(24);
  expect(caps.after).toBeLessThanOrEqual(24);
  const rendered = await page.evaluate(async () => {
    const h = window.__audioHarness!;
    const out = [];
    for (const name of h.sfx) out.push({ name, ...await h.renderSfx(name as SfxName) });
    for (const track of ['title', 'mission', 'bonus', 'results'] as const) out.push({ name: track, ...await h.renderMusic(track, 0.8, 2) });
    return out;
  });
  for (const sound of rendered) {
    expect(sound.rms, sound.name).toBeGreaterThan(0);
    expect(sound.peak, sound.name).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('postMessage transforms render when cross-origin isolation is unavailable', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['cross-origin-opener-policy'];
    delete headers['cross-origin-embedder-policy'];
    await route.fulfill({ response, headers });
  });
  await page.goto('/?scene=test&quality=low&renderer=webgl');
  await page.waitForFunction(() => window.__engine?.ready && window.__engine.bodyCount > 0);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
  expect(await page.evaluate(() => window.__engine!.stats().sharedTransforms)).toBe(false);
  const frame = await page.evaluate(() => window.__engine!.framesRendered);
  await page.waitForFunction((f) => window.__engine!.framesRendered > f + 10, frame);
  expect(await page.evaluate(() => window.__engine!.triggerBlast())).toBeGreaterThan(0);
  await expect(page.locator('.error-overlay')).toBeHidden();
});
