// State: ids, defaults, loading (incl. old saves), saving and rendering from state.
const { test, expect, STORE_KEY, seedState, savedState } = require('../helpers');
const legacy = require('../fixtures/legacy-save.json');

test('uid() returns short, unique, url-safe ids', async ({ app }) => {
  const ids = await app.evaluate(() => Array.from({ length: 2000 }, uid));
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8,16}$/);
});

test('defaultState() has the S–💩 rows, an empty pool and no items', async ({ app }) => {
  const s = await app.evaluate(() => defaultState());
  expect(s.title).toBe('My Tier List');
  expect(s.rows.map((r) => r.name)).toEqual(['S', 'A', 'B', 'C', 'D', '💩']);
  expect(s.rows.map((r) => r.color)).toEqual(['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fbfff']);
  expect(new Set(s.rows.map((r) => r.id)).size).toBe(6);
  for (const r of s.rows) expect(r.items).toEqual([]);
  expect(s.pool).toEqual([]);
  expect(s.items).toEqual({});
});

test('defaultState() returns fresh objects each call', async ({ app }) => {
  const shared = await app.evaluate(() => {
    const a = defaultState(), b = defaultState();
    a.rows[0].items.push('x');
    return b.rows[0].items.length || a.rows[0].id === b.rows[0].id;
  });
  expect(shared).toBe(false);
});

test('the storage key is unchanged (changing it would orphan every saved list)', async ({ app }) => {
  expect(await app.evaluate(() => STORE_KEY)).toBe(STORE_KEY);
});

test.describe('loadState()', () => {
  const load = (page, raw) => page.evaluate(([key, raw]) => {
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
    return loadState();
  }, [STORE_KEY, raw]);

  test('falls back to defaults when nothing is saved', async ({ app }) => {
    const s = await load(app, null);
    expect(s.rows.map((r) => r.name)).toEqual(['S', 'A', 'B', 'C', 'D', '💩']);
  });

  for (const [name, raw] of [
    ['corrupt JSON', '{"rows": ['],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['rows not an array', JSON.stringify({ ...legacy, rows: {} })],
    ['missing pool', JSON.stringify({ ...legacy, pool: undefined })],
    ['missing items', JSON.stringify({ ...legacy, items: undefined })],
  ]) {
    test(`falls back to defaults for ${name}`, async ({ app }) => {
      const s = await load(app, raw);
      expect(s.title).toBe('My Tier List');
      expect(s.rows).toHaveLength(6);
    });
  }

  test('reads an existing save unchanged (old-save compatibility)', async ({ app }) => {
    expect(await load(app, JSON.stringify(legacy))).toEqual(legacy);
  });

  test('keeps unknown extra fields from newer/older saves', async ({ app }) => {
    const s = await load(app, JSON.stringify({ ...legacy, someFutureField: 1 }));
    expect(s.someFutureField).toBe(1);
    expect(s.rows).toEqual(legacy.rows);
  });
});

test('save() writes state to localStorage and round-trips through loadState()', async ({ app }) => {
  const back = await app.evaluate(() => {
    state.title = 'Round trip';
    state.items.t = { id: 't', type: 'text', text: 'Hi' };
    state.pool.push('t');
    save();
    return loadState();
  });
  expect(back.title).toBe('Round trip');
  expect(back.pool).toEqual(['t']);
  expect((await savedState(app)).items.t.text).toBe('Hi');
});

test('save() shows a toast instead of throwing when storage is full', async ({ app }) => {
  await app.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    save();
  });
  await expect(app.locator('#toast')).toHaveText(/Could not save/);
  await expect(app.locator('#toast')).toHaveClass(/show/);
});

test('textColorFor() picks dark text on light colours and light text on dark ones', async ({ app }) => {
  const r = await app.evaluate(() => ({
    palette: PALETTE.map(textColorFor),
    black: textColorFor('#000000'),
    white: textColorFor('#ffffff'),
    navy: textColorFor('#1a237e'),
    yellow: textColorFor('#ffeb3b'),
  }));
  expect(new Set(r.palette)).toEqual(new Set(['#111']));
  expect(r).toMatchObject({ black: '#fff', white: '#111', navy: '#fff', yellow: '#111' });
});

test.describe('render()', () => {
  test('draws rows, items and controls from a saved list', async ({ page }) => {
    await seedState(page, legacy);
    await page.goto('/tier-ranker/');
    const tiers = page.locator('#tiers .tier');
    await expect(tiers).toHaveCount(3);
    await expect(page.locator('#title')).toHaveText('Snacks');
    await expect(page).toHaveTitle('Snacks – Tier Ranker');
    await expect(tiers.locator('.name')).toHaveText(['S', 'Great', 'Meh']);
    await expect(page.locator('#row-count')).toHaveText('3 / 10 rows');
    // Label colours and contrast-aware text colour.
    await expect(tiers.nth(1).locator('.label')).toHaveCSS('background-color', 'rgb(127, 191, 255)');
    await expect(tiers.nth(2).locator('.label')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(tiers.nth(0).locator('.label')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(tiers.nth(2).locator('.color-input')).toHaveValue('#222222');
    // Items: text, remote image, and a dangling id that's skipped.
    await expect(tiers.nth(0).locator('.item')).toHaveCount(2);
    await expect(tiers.nth(0).locator('.item.text')).toHaveText('Crisps');
    await expect(tiers.nth(2).locator('.item')).toHaveCount(1);
    await expect(page.locator('#pool .item')).toHaveText(['Popcorn']);
    // First row can't move up, last can't move down.
    await expect(tiers.nth(0).locator('[data-act=up]')).toBeDisabled();
    await expect(tiers.nth(0).locator('[data-act=down]')).toBeEnabled();
    await expect(tiers.nth(2).locator('[data-act=down]')).toBeDisabled();
    await expect(tiers.nth(2).locator('[data-act=del]')).toBeEnabled();
  });

  test('disables delete on the last remaining row and add-row at MAX_ROWS', async ({ app }) => {
    await app.evaluate(() => {
      state.rows = state.rows.slice(0, 1);
      render();
    });
    await expect(app.locator('[data-act=del]')).toBeDisabled();
    await expect(app.locator('[data-act=up]')).toBeDisabled();
    await expect(app.locator('[data-act=down]')).toBeDisabled();
    await app.evaluate(() => {
      while (state.rows.length < MAX_ROWS) state.rows.push({ id: uid(), name: 'x', color: '#000000', items: [] });
      render();
    });
    expect(await app.evaluate(() => MAX_ROWS)).toBe(10);
    await expect(app.locator('#add-row')).toBeDisabled();
    await expect(app.locator('#row-count')).toHaveText('10 / 10 rows');
  });

  test('keeps the default document title for the default list name', async ({ app }) => {
    await expect(app).toHaveTitle('Tier Ranker – Free Tier List Maker Online | Thorstein Games');
  });
});
