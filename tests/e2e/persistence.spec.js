// Everything survives a reload: localStorage for the board, IndexedDB for image blobs.
const { test, expect, makePng, seedState, savedState, dragTo, zoneEnd } = require('../helpers');
const legacy = require('../fixtures/legacy-save.json');

test('board, text items, uploaded images and order survive a reload', async ({ app }) => {
  await app.locator('#title').fill('Keep me');
  await app.locator('#title').press('Enter');
  await names(app).nth(0).fill('Gods');
  await names(app).nth(0).press('Enter');
  await app.locator('#add-row').click();
  await app.keyboard.press('Enter');
  await app.locator('#tiers .color-input').nth(1).fill('#123456');
  await app.locator('#text-input').fill('Text item');
  await app.locator('#text-input').press('Enter');
  await app.locator('#file-input').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: makePng(200, 100) });
  await expect(app.locator('#pool .item')).toHaveCount(2);
  await dragTo(app, app.locator('#pool .item.text'), zoneEnd(app.locator('#tiers .zone').nth(0)));
  const before = await savedState(app);

  await app.reload();
  await expect(app.locator('#title')).toHaveText('Keep me');
  await expect(app).toHaveTitle('Keep me – Tier Ranker');
  await expect(names(app)).toHaveText(['Gods', 'A', 'B', 'C', 'D', '💩', 'New']);
  await expect(app.locator('#tiers .label').nth(1)).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(app.locator('#tiers .zone').nth(0).locator('.item')).toHaveText(['Text item']);
  const img = app.locator('#pool .item img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect(img).toHaveJSProperty('naturalWidth', 200);
  expect(await savedState(app)).toEqual(before);
});

test('a deleted image is gone from IndexedDB after reload', async ({ app }) => {
  await app.locator('#file-input').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: makePng(20, 20) });
  await expect(app.locator('#pool .item')).toHaveCount(1);
  const id = await app.locator('#pool .item').getAttribute('data-id');
  await dragTo(app, app.locator('#pool .item'), async () => {
    await app.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const b = await app.locator('#trash').boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await app.reload();
  await expect(app.locator('#pool .item')).toHaveCount(0);
  expect(await app.evaluate((id) => imageDB.get(id), id)).toBeUndefined();
});

test('a list saved by an earlier version still opens', async ({ page }) => {
  await seedState(page, legacy);
  await page.route('https://upload.wikimedia.org/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: makePng(10, 10) }));
  await page.goto('/tier-ranker/');
  await expect(page.locator('#title')).toHaveText('Snacks');
  await expect(names(page)).toHaveText(['S', 'Great', 'Meh']);
  await expect(page.locator('#tiers .zone').nth(0).locator('.item.text')).toHaveText('Crisps');
  await expect(page.locator('#tiers .zone').nth(0).locator('img')).toHaveJSProperty('naturalWidth', 10);
  await expect(page.locator('#pool .item')).toHaveText(['Popcorn']);
  // Still editable: add a row and it saves in the same shape.
  await page.locator('#add-row').click();
  const s = await savedState(page);
  expect(s.rows).toHaveLength(4);
  expect(s.items).toEqual(legacy.items);
});

function names(page) { return page.locator('#tiers .name'); }
