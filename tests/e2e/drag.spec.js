// Drag & drop with pointer events: mouse on desktop, touch on the phone project.
const { test, expect, seedState, savedState, zoneIds, dragTo, zoneEnd, pointer, center } = require('../helpers');

const board = {
  title: 'Drag test',
  rows: [
    { id: 'r1', name: 'S', color: '#ff7f7f', items: ['a'] },
    { id: 'r2', name: 'A', color: '#ffbf7f', items: [] },
    { id: 'r3', name: 'B', color: '#ffdf7f', items: ['b', 'c'] },
  ],
  pool: ['d', 'e'],
  items: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { id, type: 'text', text: id.toUpperCase() }])),
};

test.beforeEach(async ({ page }) => {
  await seedState(page, board);
  await page.goto('/tier-ranker/');
  await expect(page.locator('#pool .item')).toHaveCount(2);
});

const item = (page, id) => page.locator(`.item[data-id="${id}"]`);
const zone = (page, i) => page.locator('#tiers .zone').nth(i);

test('drag an item from the pool into an empty tier', async ({ page }) => {
  await dragTo(page, item(page, 'd'), zoneEnd(zone(page, 1)));
  await expect(zone(page, 1).locator('.item')).toHaveText(['D']);
  expect(await zoneIds(page, 'pool')).toEqual(['e']);
  const s = await savedState(page);
  expect(s.rows[1].items).toEqual(['d']);
  expect(s.pool).toEqual(['e']);
});

test('drag between tiers and back to the pool', async ({ page }) => {
  await dragTo(page, item(page, 'a'), zoneEnd(zone(page, 2)));
  expect(await zoneIds(page, 2)).toEqual(['b', 'c', 'a']);
  await dragTo(page, item(page, 'b'), zoneEnd(page.locator('#pool')));
  expect(await zoneIds(page, 'pool')).toEqual(['d', 'e', 'b']);
  const s = await savedState(page);
  expect(s.rows.map((r) => r.items)).toEqual([[], [], ['c', 'a']]);
  expect(s.pool).toEqual(['d', 'e', 'b']);
});

test('drop before an item to reorder within a tier', async ({ page }) => {
  // Aim at the left half of B: C should land in front of it.
  await dragTo(page, item(page, 'c'), async () => {
    const b = await item(page, 'b').boundingBox();
    return { x: b.x + b.width * 0.25, y: b.y + b.height / 2 };
  });
  expect(await zoneIds(page, 2)).toEqual(['c', 'b']);
  expect((await savedState(page)).rows[2].items).toEqual(['c', 'b']);
});

test('dropping onto the row label puts the item in that row', async ({ page }) => {
  await dragTo(page, item(page, 'e'), page.locator('#tiers .label').nth(1));
  expect(await zoneIds(page, 1)).toEqual(['e']);
});

test('the trash appears while dragging and deletes the dropped item', async ({ page }) => {
  const trash = page.locator('#trash');
  await expect(trash).not.toBeInViewport();
  await dragTo(page, item(page, 'd'), async () => {
    await expect(trash).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    return center(trash);
  }, { beforeDrop: () => expect(trash).toHaveClass(/over/) });
  await expect(item(page, 'd')).toHaveCount(0);
  await expect(trash).not.toHaveClass(/over/);
  const s = await savedState(page);
  expect(s.pool).toEqual(['e']);
  expect(s.items.d).toBeUndefined();
});

test('a ghost follows the pointer and the source becomes a placeholder', async ({ page }, testInfo) => {
  await page.evaluate(() => document.addEventListener('pointerdown', (e) => (window.lastPointerType = e.pointerType)));
  const ptr = await pointer(page);
  const start = await center(item(page, 'd'));
  await ptr.down(start);
  await ptr.move({ x: start.x + 30, y: start.y - 10 });
  await expect(page.locator('.drag-ghost')).toHaveCount(1);
  // The phone project drives real touch input, the desktop one a mouse.
  expect(await page.evaluate(() => window.lastPointerType)).toBe(testInfo.project.name === 'e2e-phone' ? 'touch' : 'mouse');
  await expect(item(page, 'd').and(page.locator('.placeholder'))).toHaveCount(1);
  await ptr.up();
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  await expect(page.locator('.placeholder')).toHaveCount(0);
});

test('a tiny movement is a click, not a drag', async ({ page }) => {
  const ptr = await pointer(page);
  const start = await center(item(page, 'd'));
  await ptr.down(start);
  await ptr.move({ x: start.x + 2, y: start.y + 2 });
  await expect(page.locator('body')).not.toHaveClass(/dragging/);
  await ptr.up();
  expect(await zoneIds(page, 'pool')).toEqual(['d', 'e']);
});

test('an image item can be dragged and keeps its stored image', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({
    name: 'red.png', mimeType: 'image/png', buffer: require('../helpers').makePng(120, 90),
  });
  const img = page.locator('#pool .item:not(.text)');
  await expect(img).toHaveCount(1);
  const id = await img.getAttribute('data-id');
  await dragTo(page, img, zoneEnd(zone(page, 0)));
  expect(await zoneIds(page, 0)).toEqual(['a', id]);
  await expect(item(page, id).locator('img')).toHaveJSProperty('naturalWidth', 120);
});
