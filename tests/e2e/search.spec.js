// Image search dialog against mocked Wikimedia APIs (no real network).
const { test, expect, mockWikimedia, savedState } = require('../helpers');

test.beforeEach(async ({ app }) => { await mockWikimedia(app); });

const dialog = (page) => page.locator('#search-dialog');

test('both "+ Add item" and "Search images" open the dialog with a hint and focus', async ({ app }) => {
  for (const open of ['#add-item', '#open-search']) {
    await app.locator(open).click();
    await expect(dialog(app)).toBeVisible();
    await expect(app.locator('#search-input')).toBeFocused();
    await expect(app.locator('#search-status')).toHaveText(/Search for characters/);
    await app.locator('#search-close').click();
    await expect(dialog(app)).toBeHidden();
  }
});

test('search Wikipedia, add results, load more', async ({ app }) => {
  await app.locator('#add-item').click();
  await app.locator('#search-input').fill('mario');
  await app.locator('#search-input').press('Enter');
  const results = app.locator('#search-results .result');
  await expect(results).toHaveCount(2);
  await expect(results.locator('span')).toHaveText(['mario one', 'mario two']);
  await expect(results.first().locator('img')).toHaveJSProperty('complete', true);

  await results.first().click();
  await expect(results.first()).toHaveClass(/added/);
  await expect(app.locator('#toast')).toHaveText('Added “mario one”.');
  await expect(app.locator('#pool .item')).toHaveCount(1);
  // Wikimedia sends CORS headers, so a local copy is stored.
  const s = await savedState(app);
  expect(s.items[s.pool[0]]).toMatchObject({ type: 'image', stored: true });

  await app.locator('#search-more').click();
  await expect(results).toHaveCount(3);
  await expect(app.locator('#search-more')).toBeHidden();
});

test('switching to Wikimedia Commons re-runs the search there', async ({ app }) => {
  await app.locator('#open-search').click();
  await app.locator('#search-input').fill('panda');
  await app.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(app.locator('#search-results .result')).toHaveCount(2);
  await app.getByRole('radio', { name: 'Wikimedia Commons' }).click();
  await expect(app.getByRole('radio', { name: 'Wikimedia Commons' })).toHaveAttribute('aria-checked', 'true');
  await expect(app.getByRole('radio', { name: 'Wikipedia' })).toHaveAttribute('aria-checked', 'false');
  // Only the image file comes back (the video is filtered out), titled without "File:" and extension.
  await expect(app.locator('#search-results .result span')).toHaveText(['panda photo']);
});

test('a failed search shows an error', async ({ app }) => {
  await app.unrouteAll();
  await mockWikimedia(app, { fail: true });
  await app.locator('#open-search').click();
  await app.locator('#search-input').fill('anything');
  await app.locator('#search-input').press('Enter');
  await expect(app.locator('#search-status')).toHaveText(/Search failed/);
});

test('the dialog closes with Escape and by clicking the backdrop', async ({ app }) => {
  await app.locator('#open-search').click();
  await app.keyboard.press('Escape');
  await expect(dialog(app)).toBeHidden();
  await app.locator('#open-search').click();
  await expect(dialog(app)).toBeVisible();
  await app.mouse.click(3, 3);
  await expect(dialog(app)).toBeHidden();
});

test('the dialog fits the screen', async ({ app }) => {
  await app.locator('#open-search').click();
  await expect(dialog(app)).toBeInViewport({ ratio: 1 });
});
