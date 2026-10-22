// Row add/rename/recolour/reorder/delete logic, title editing, unrank/start over,
// syncFromDom() and deleteItem().
const { test, expect, savedState } = require('../helpers');

/** Put text items a..e into the app: a,b in row 0, c in row 1, d,e in the pool. */
async function seed(page) {
  await page.evaluate(() => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) state.items[id] = { id, type: 'text', text: id.toUpperCase() };
    state.rows[0].items = ['a', 'b'];
    state.rows[1].items = ['c'];
    state.pool = ['d', 'e'];
    save();
    render();
  });
}
const rowNames = (page) => page.evaluate(() => state.rows.map((r) => r.name));
const click = (page, row, act) => page.locator('#tiers .tier').nth(row).locator(`[data-act=${act}]`).click();

test('moving a row up/down swaps it with its neighbour and saves', async ({ app }) => {
  await click(app, 1, 'up');
  expect(await rowNames(app)).toEqual(['A', 'S', 'B', 'C', 'D', '💩']);
  await click(app, 0, 'down');
  await click(app, 1, 'down');
  expect(await rowNames(app)).toEqual(['S', 'B', 'A', 'C', 'D', '💩']);
  expect((await savedState(app)).rows.map((r) => r.name)).toEqual(['S', 'B', 'A', 'C', 'D', '💩']);
  await expect(app.locator('#tiers .name')).toHaveText(['S', 'B', 'A', 'C', 'D', '💩']);
});

test('row items move with their row', async ({ app }) => {
  await seed(app);
  await click(app, 0, 'down');
  const rows = await app.evaluate(() => state.rows.map((r) => r.items));
  expect(rows.slice(0, 2)).toEqual([['c'], ['a', 'b']]);
});

test('deleting a row returns its items to the end of the pool', async ({ app }) => {
  await seed(app);
  await click(app, 0, 'del');
  const s = await savedState(app);
  expect(s.rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', '💩']);
  expect(s.pool).toEqual(['d', 'e', 'a', 'b']);
  expect(Object.keys(s.items).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  await expect(app.locator('#pool .item')).toHaveText(['D', 'E', 'A', 'B']);
});

test('the last row cannot be deleted', async ({ app }) => {
  for (let i = 0; i < 5; i++) await click(app, 0, 'del');
  await expect(app.locator('#tiers .tier')).toHaveCount(1);
  await expect(app.locator('[data-act=del]')).toBeDisabled();
  // Even if the click reaches the handler, nothing happens.
  await app.evaluate(() => document.querySelector('[data-act=del]').removeAttribute('disabled'));
  await click(app, 0, 'del');
  expect(await rowNames(app)).toEqual(['💩']);
});

test('add row appends a "New" row with the next palette colour, focused for renaming', async ({ app }) => {
  await app.locator('#add-row').click();
  const s = await savedState(app);
  expect(s.rows).toHaveLength(7);
  expect(s.rows[6]).toMatchObject({ name: 'New', items: [] });
  expect(s.rows[6].color).toBe(await app.evaluate(() => PALETTE[6]));
  await expect(app.locator('#tiers .name').last()).toBeFocused();
  expect(await app.evaluate(() => document.getSelection().toString())).toBe('New');
});

test('add row stops at MAX_ROWS', async ({ app }) => {
  for (let i = 0; i < 4; i++) await app.locator('#add-row').click();
  await expect(app.locator('#add-row')).toBeDisabled();
  await app.evaluate(() => document.querySelector('#add-row').click()); // bypass disabled
  expect(await app.evaluate(() => state.rows.length)).toBe(10);
});

test.describe('renaming a row', () => {
  const rename = async (page, text) => {
    await page.evaluate((text) => {
      const name = document.querySelector('#tiers .name');
      name.focus();
      name.textContent = text;
      name.blur();
    }, text);
    return page.evaluate(() => [state.rows[0].name, document.querySelector('#tiers .name').textContent]);
  };
  test('collapses whitespace and trims', async ({ app }) => {
    expect(await rename(app, '  Top \n  tier  ')).toEqual(['Top tier', 'Top tier']);
    expect((await savedState(app)).rows[0].name).toBe('Top tier');
  });
  test('caps names at 30 characters', async ({ app }) => {
    expect((await rename(app, 'x'.repeat(50)))[0]).toBe('x'.repeat(30));
  });
  test('uses "?" for an empty name', async ({ app }) => {
    expect(await rename(app, '   ')).toEqual(['?', '?']);
  });
});

test.describe('editing the title', () => {
  const retitle = async (page, text) => {
    await page.evaluate((text) => {
      titleEl.focus();
      titleEl.textContent = text;
      titleEl.blur();
    }, text);
    return page.evaluate(() => [state.title, titleEl.textContent, document.title]);
  };
  test('saves and updates the document title', async ({ app }) => {
    expect(await retitle(app, '  Best pizza ')).toEqual(['Best pizza', 'Best pizza', 'Best pizza – Tier Ranker']);
    expect((await savedState(app)).title).toBe('Best pizza');
  });
  test('caps the title at 80 characters', async ({ app }) => {
    expect((await retitle(app, 'y'.repeat(100)))[0]).toBe('y'.repeat(80));
  });
  test('restores the default title (and page title) when emptied', async ({ app }) => {
    await retitle(app, 'Temp');
    const [title, text, doc] = await retitle(app, '');
    expect([title, text]).toEqual(['My Tier List', 'My Tier List']);
    expect(doc).toBe('Tier Ranker – Free Tier List Maker Online | Thorstein Games');
  });
});

test('changing a row colour updates the label live and saves on change', async ({ app }) => {
  await app.locator('#tiers .color-input').first().fill('#102030');
  const label = app.locator('#tiers .label').first();
  await expect(label).toHaveCSS('background-color', 'rgb(16, 32, 48)');
  await expect(label).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect((await savedState(app)).rows[0].color).toBe('#102030');
});

test('unrank all moves every ranked item to the pool, in row order', async ({ app }) => {
  await seed(app);
  await app.locator('#unrank-all').click();
  const s = await savedState(app);
  expect(s.pool).toEqual(['d', 'e', 'a', 'b', 'c']);
  for (const r of s.rows) expect(r.items).toEqual([]);
});

test('start over resets everything after confirmation, and nothing when cancelled', async ({ app }) => {
  await seed(app);
  await app.evaluate(() => imageDB.put('img', new Blob(['x'])));
  app.once('dialog', (d) => d.dismiss());
  await app.locator('#start-over').click();
  await expect(app.locator('#pool .item')).toHaveCount(2);

  app.once('dialog', (d) => d.accept());
  await app.locator('#start-over').click();
  await expect(app.locator('#pool .item')).toHaveCount(0);
  const s = await savedState(app);
  expect(s.pool).toEqual([]);
  expect(s.items).toEqual({});
  expect(s.rows.map((r) => r.name)).toEqual(['S', 'A', 'B', 'C', 'D', '💩']);
  expect(await app.evaluate(() => imageDB.get('img'))).toBeUndefined();
});

test('syncFromDom() rebuilds rows and pool from DOM order and saves', async ({ app }) => {
  await seed(app);
  const s = await app.evaluate(() => {
    const zones = document.querySelectorAll('#tiers .zone');
    const el = (id) => document.querySelector(`.item[data-id="${id}"]`);
    zones[2].append(el('a'), el('d')); // a: row0 -> row2, d: pool -> row2
    zones[1].prepend(el('e'));         // e: pool -> row1 (before c)
    syncFromDom();
    return JSON.parse(localStorage.getItem(STORE_KEY));
  });
  expect(s.rows.map((r) => r.items).slice(0, 3)).toEqual([['b'], ['e', 'c'], ['a', 'd']]);
  expect(s.pool).toEqual([]);
});

test('deleteItem() drops the item, its stored blob and its object URL', async ({ app }) => {
  const r = await app.evaluate(async () => {
    await imageDB.put('pic', new Blob(['png'], { type: 'image/png' }));
    state.items.pic = { id: 'pic', type: 'image', stored: true };
    const url = await imageSrc(state.items.pic);
    deleteItem('pic');
    // imageDB.del is fire-and-forget; wait for it by queueing a read after it.
    const blob = await imageDB.get('pic');
    return { item: state.items.pic, blob, cached: objectUrls.has('pic'), url };
  });
  expect(r.item).toBeUndefined();
  expect(r.blob).toBeUndefined();
  expect(r.cached).toBe(false);
  expect(r.url).toMatch(/^blob:/);
});

test('deleteItem() on a text item or unknown id does not throw', async ({ app }) => {
  await seed(app);
  await app.evaluate(() => { deleteItem('a'); deleteItem('nope'); });
  expect(await app.evaluate(() => Object.keys(state.items).sort())).toEqual(['b', 'c', 'd', 'e']);
});
