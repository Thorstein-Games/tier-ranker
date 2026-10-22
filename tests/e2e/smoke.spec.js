// Page load, layout, SEO/sharing metadata, shared bar/footer and asset availability.
const { test, expect, APP } = require('../helpers');

test('loads with the default board and no console errors', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(APP);
  await expect(page.locator('#tiers .tier .name')).toHaveText(['S', 'A', 'B', 'C', 'D', '💩']);
  await expect(page.locator('#title')).toHaveText('My Tier List');
  await expect(page.locator('#row-count')).toHaveText('6 / 10 rows');
  await expect(page.locator('#pool .item')).toHaveCount(0);
  await expect(page.locator('#trash')).not.toBeInViewport();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(problems).toEqual([]);
});

test('works without the trailing slash too', async ({ page }) => {
  await page.goto('/tier-ranker');
  await expect(page.locator('#tiers .tier')).toHaveCount(6);
});

test('every same-site resource the page loads returns 200', async ({ page, baseURL }) => {
  const bad = [];
  const seen = [];
  page.on('response', (r) => {
    if (!r.url().startsWith(baseURL)) return;
    seen.push(r.url());
    if (r.status() !== 200) bad.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(APP);
  await expect(page.locator('#tiers .tier')).toHaveCount(6);
  await page.waitForLoadState('load');
  expect(bad).toEqual([]);
  for (const f of ['app.js', 'style.css', 'assets/logo-mark.svg']) {
    expect(seen.some((u) => u.endsWith(`/tier-ranker/${f}`)), `${f} was requested`).toBe(true);
  }
});

test('the stylesheet applied and every <head> icon/asset link resolves', async ({ page, request }) => {
  await page.goto(APP);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 23, 26)');
  const urls = await page.evaluate(() => [
    ...[...document.querySelectorAll('link[href^="/"], script[src^="/"], img[src^="/"]')].map((e) => e.getAttribute('href') || e.getAttribute('src')),
    ...[...document.querySelectorAll('meta[content^="https://thorsteingames.com/tier-ranker/"]')].map((m) => new URL(m.content).pathname),
  ]);
  expect(urls).toEqual(expect.arrayContaining(['/tier-ranker/assets/og-image.png', '/tier-ranker/assets/apple-touch-icon.png']));
  for (const u of new Set(urls)) {
    const r = await request.get(u);
    expect(r.status(), u).toBe(200);
  }
});

test('the logo renders', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('img.logo')).toHaveJSProperty('complete', true);
  expect(await page.locator('img.logo').evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
});

test('no horizontal scrolling at this width', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#tiers .tier')).toHaveCount(6);
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
});

test('text inputs use ≥16px text so iOS does not zoom on focus', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#open-search').click(); // the search input lives in a dialog
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=file]):not([type=color])')].map((i) => [i.id, parseFloat(getComputedStyle(i).fontSize)]));
  expect(sizes.length).toBeGreaterThanOrEqual(3);
  for (const [id, size] of sizes) expect(size, id).toBeGreaterThanOrEqual(16);
});

test.describe('SEO and sharing metadata', () => {
  test.beforeEach(({ page }) => page.goto(APP));

  test('title, description, canonical and robots', async ({ page }) => {
    await expect(page).toHaveTitle(/Tier Ranker/);
    await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /tier list/i);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://thorsteingames.com/tier-ranker');
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /index, follow/);
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /width=device-width/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('Open Graph and Twitter tags use absolute thorsteingames.com URLs', async ({ page }) => {
    const meta = (attr, name) => page.locator(`meta[${attr}="${name}"]`);
    await expect(meta('property', 'og:url')).toHaveAttribute('content', 'https://thorsteingames.com/tier-ranker');
    await expect(meta('property', 'og:type')).toHaveAttribute('content', 'website');
    for (const name of ['og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description']) {
      const attr = name.startsWith('og:') ? 'property' : 'name';
      await expect(meta(attr, name)).toHaveAttribute('content', /\S/);
    }
    await expect(meta('property', 'og:image')).toHaveAttribute('content', 'https://thorsteingames.com/tier-ranker/assets/og-image.png');
    await expect(meta('name', 'twitter:image')).toHaveAttribute('content', 'https://thorsteingames.com/tier-ranker/assets/og-image.png');
    await expect(meta('name', 'twitter:card')).toHaveAttribute('content', 'summary_large_image');
  });

  test('JSON-LD parses, describes the app, and its FAQ mirrors the visible FAQ', async ({ page }) => {
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]);
    const app = ld['@graph'].find((n) => n['@type'] === 'WebApplication');
    const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
    expect(app).toMatchObject({ name: 'Tier Ranker', url: 'https://thorsteingames.com/tier-ranker', isAccessibleForFree: true });
    const visible = await page.locator('.about .faq').evaluate((dl) =>
      [...dl.querySelectorAll('dt')].map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()]));
    expect(visible.length).toBeGreaterThan(0);
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(visible);
  });

  test('one <h1> with the app name; the editable list title is an <h2>', async ({ page }) => {
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Tier Ranker');
    await expect(page.locator('h2#title')).toHaveAttribute('contenteditable', 'true');
  });
});

test('shared Thorstein Games bar, ad slot and footer are wired up', async ({ page }) => {
  // Their contents (Home, More Games, Privacy… links) come from tg-bar.js on thorsteingames.com,
  // which is stubbed out here; this checks the page side of that contract.
  await page.goto(APP);
  await expect(page.locator('script[src="https://thorsteingames.com/tg-bar.js"]')).toHaveCount(1);
  await expect(page.locator('body > tg-bar:first-child')).toHaveAttribute('game', 'tier-ranker');
  await expect(page.locator('main ~ tg-footer')).toHaveAttribute('game', 'tier-ranker');
  await expect(page.locator('main ~ tg-ad')).toHaveAttribute('format', 'banner');
  // Ads stay out of the tier list and drag areas.
  await expect(page.locator('main tg-ad, #tiers tg-ad, #pool tg-ad')).toHaveCount(0);
  // Space for the 40px bar is reserved before the script defines it.
  await expect(page.locator('tg-bar')).toHaveCSS('height', '40px');
});
