// Editing the board through the UI: title, rows, unrank all, start over.
const { test, expect, savedState } = require('../helpers');

const tiers = (page) => page.locator('#tiers .tier');
const names = (page) => page.locator('#tiers .name');

test('rename the list title', async ({ app }) => {
  const title = app.locator('#title');
  await title.click();
  await title.fill('Best Pokémon');
  await title.press('Enter');
  await expect(title).not.toBeFocused();
  await expect(app).toHaveTitle('Best Pokémon – Tier Ranker');
  expect((await savedState(app)).title).toBe('Best Pokémon');
});

test('add a row, type its name straight away, and hit the 10-row limit', async ({ app }) => {
  await app.locator('#add-row').click();
  await expect(tiers(app)).toHaveCount(7);
  await expect(names(app).last()).toBeFocused();
  await app.keyboard.type('Top 10');
  await app.keyboard.press('Enter');
  await expect(names(app).last()).toHaveText('Top 10');
  expect((await savedState(app)).rows[6].name).toBe('Top 10');

  for (let i = 0; i < 3; i++) await app.locator('#add-row').click();
  await expect(app.locator('#row-count')).toHaveText('10 / 10 rows');
  await expect(app.locator('#add-row')).toBeDisabled();
});

test('rename a row by clicking its label', async ({ app }) => {
  const name = names(app).nth(1);
  await name.click();
  await name.fill('Amazing');
  await name.press('Enter');
  await expect(name).toHaveText('Amazing');
  expect((await savedState(app)).rows[1].name).toBe('Amazing');
});

test('recolour a row', async ({ app }) => {
  await tiers(app).nth(0).locator('.color-input').fill('#336699');
  await expect(tiers(app).nth(0).locator('.label')).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  expect((await savedState(app)).rows[0].color).toBe('#336699');
});

test('reorder rows with the arrows', async ({ app }) => {
  await tiers(app).nth(0).getByTitle('Move down').click();
  await expect(names(app)).toHaveText(['A', 'S', 'B', 'C', 'D', '💩']);
  await tiers(app).nth(5).getByTitle('Move up').click();
  await expect(names(app)).toHaveText(['A', 'S', 'B', 'C', '💩', 'D']);
  expect((await savedState(app)).rows.map((r) => r.name)).toEqual(['A', 'S', 'B', 'C', '💩', 'D']);
});

test('delete a row; its items go back to the pool', async ({ app }) => {
  await app.evaluate(() => {
    state.items.x = { id: 'x', type: 'text', text: 'Ranked' };
    state.rows[2].items.push('x');
    save();
    render();
  });
  await tiers(app).nth(2).getByTitle('Delete row').click();
  await expect(names(app)).toHaveText(['S', 'A', 'C', 'D', '💩']);
  await expect(app.locator('#pool .item')).toHaveText(['Ranked']);
  await expect(app.locator('#row-count')).toHaveText('5 / 10 rows');
});

test('unrank all moves every item back to the pool', async ({ app }) => {
  await app.evaluate(() => {
    for (const [i, id] of ['p', 'q', 'r'].entries()) {
      state.items[id] = { id, type: 'text', text: id };
      state.rows[i].items.push(id);
    }
    save();
    render();
  });
  await app.locator('#unrank-all').click();
  await expect(app.locator('#pool .item')).toHaveText(['p', 'q', 'r']);
  await expect(app.locator('#tiers .item')).toHaveCount(0);
});

test('start over asks first, then wipes rows, items and images', async ({ app }) => {
  await app.locator('#title').fill('Temp');
  await app.locator('#title').press('Enter');
  await app.locator('#text-input').fill('Gone soon');
  await app.locator('#text-input').press('Enter');
  await tiers(app).nth(0).getByTitle('Delete row').click();

  app.once('dialog', (d) => d.dismiss());
  await app.locator('#start-over').click();
  await expect(app.locator('#pool .item')).toHaveCount(1);

  app.once('dialog', (d) => { expect(d.type()).toBe('confirm'); d.accept(); });
  await app.locator('#start-over').click();
  await expect(app.locator('#pool .item')).toHaveCount(0);
  await expect(names(app)).toHaveText(['S', 'A', 'B', 'C', 'D', '💩']);
  await expect(app.locator('#title')).toHaveText('My Tier List');
  await expect(app).toHaveTitle(/Free Tier List Maker/);
});
