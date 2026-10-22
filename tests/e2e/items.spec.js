// Adding items: text, uploads, image links, paste and file drops; editing text items.
const { test, expect, makePng, savedState, CORS } = require('../helpers');

const pool = (page) => page.locator('#pool .item');

test('add text items with the button and with Enter', async ({ app }) => {
  const input = app.locator('#text-input');
  await input.fill('  Pizza  ');
  await app.getByRole('button', { name: 'Add text' }).click();
  await input.fill('Tacos');
  await input.press('Enter');
  await expect(pool(app)).toHaveText(['Pizza', 'Tacos']);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  const s = await savedState(app);
  expect(s.pool.map((id) => s.items[id])).toMatchObject([{ type: 'text', text: 'Pizza' }, { type: 'text', text: 'Tacos' }]);
});

test('blank text is ignored and long text is capped by the input', async ({ app }) => {
  await app.locator('#text-input').fill('   ');
  await app.locator('#text-input').press('Enter');
  await expect(pool(app)).toHaveCount(0);
  await expect(app.locator('#text-input')).toHaveAttribute('maxlength', '60');
});

test('double-click a text item to edit it; cancel or blank keeps the old text', async ({ app }) => {
  await app.locator('#text-input').fill('Pizza');
  await app.locator('#text-input').press('Enter');
  const item = pool(app).first();

  app.once('dialog', (d) => { expect(d.defaultValue()).toBe('Pizza'); d.accept('  Calzone  '); });
  await item.dblclick();
  await expect(item).toHaveText('Calzone');
  await expect(item).toHaveAttribute('title', 'Calzone');
  expect(Object.values((await savedState(app)).items)[0].text).toBe('Calzone');

  app.once('dialog', (d) => d.dismiss());
  await item.dblclick();
  app.once('dialog', (d) => d.accept('   '));
  await item.dblclick();
  await expect(item).toHaveText('Calzone');
});

test('upload several image files; non-images are skipped', async ({ app }) => {
  await app.locator('#file-input').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: makePng(900, 600) },
    { name: 'b.png', mimeType: 'image/png', buffer: makePng(50, 50, [0, 200, 0]) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  await expect(app.locator('#toast')).toHaveText('Added 2 images.');
  await expect(pool(app)).toHaveCount(2);
  const imgs = pool(app).locator('img');
  await expect(imgs.first()).toHaveAttribute('src', /^blob:/);
  // Big uploads are downscaled to 320px before storing.
  await expect(imgs.first()).toHaveJSProperty('naturalWidth', 320);
  await expect(imgs.nth(1)).toHaveJSProperty('naturalWidth', 50);
  await expect(app.locator('#pool .item.broken')).toHaveCount(0);
  const s = await savedState(app);
  for (const id of s.pool) expect(s.items[id]).toEqual({ id, type: 'image', stored: true });
  // The same file can be chosen again straight away.
  await expect(app.locator('#file-input')).toHaveValue('');
});

test('uploading only non-images shows a message', async ({ app }) => {
  await app.locator('#file-input').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(app.locator('#toast')).toHaveText('No image files found.');
  await expect(pool(app)).toHaveCount(0);
});

test.describe('add image by link', () => {
  test('stores a local copy when the host allows CORS', async ({ app }) => {
    await app.route('https://img.example/cat.png', (r) => r.fulfill({ headers: CORS, contentType: 'image/png', body: makePng(64, 64) }));
    await app.locator('#url-input').fill('https://img.example/cat.png');
    await app.getByRole('button', { name: 'Add link' }).click();
    await expect(pool(app).locator('img')).toHaveAttribute('src', /^blob:/);
    await expect(app.locator('#url-input')).toHaveValue('');
  });

  test('keeps just the link when the host blocks CORS', async ({ app }) => {
    await app.route('https://img.example/dog.png', (r) =>
      r.fulfill({ headers: { 'access-control-allow-origin': 'https://elsewhere.example' }, contentType: 'image/png', body: makePng(64, 64) }));
    await app.locator('#url-input').fill('https://img.example/dog.png');
    await app.locator('#url-input').press('Enter');
    await expect(pool(app).locator('img')).toHaveAttribute('src', 'https://img.example/dog.png');
    const s = await savedState(app);
    expect(s.items[s.pool[0]]).toMatchObject({ type: 'image', url: 'https://img.example/dog.png' });
  });

  test('complains about links that are not images', async ({ app }) => {
    await app.route('https://img.example/nope', (r) => r.fulfill({ status: 404, body: '' }));
    await app.locator('#url-input').fill('https://img.example/nope');
    await app.locator('#url-input').press('Enter');
    await expect(app.locator('#toast')).toHaveText('Couldn’t load an image from that link.');
    await expect(app.locator('#url-input')).toHaveValue('https://img.example/nope');
    await expect(pool(app)).toHaveCount(0);
  });
});

test('paste an image from the clipboard', async ({ app }) => {
  const b64 = makePng(40, 40).toString('base64');
  await app.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'clip.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, b64);
  await expect(app.locator('#toast')).toHaveText('Added 1 image.');
  await expect(pool(app).locator('img')).toHaveJSProperty('naturalWidth', 40);
});

test('pasting into a text field does not add an image', async ({ app }) => {
  await app.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'clip.png', { type: 'image/png' }));
    document.querySelector('#text-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  expect(await app.evaluate(() => state.pool.length)).toBe(0);
});

test('drop image files anywhere on the page', async ({ app }) => {
  const b64 = makePng(30, 20).toString('base64');
  const dt = await app.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'drop.png', { type: 'image/png' }));
    return dt;
  }, b64);
  await app.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
  await expect(app.locator('body')).toHaveClass(/file-over/);
  await app.dispatchEvent('main', 'drop', { dataTransfer: dt });
  await expect(app.locator('body')).not.toHaveClass(/file-over/);
  await expect(app.locator('#toast')).toHaveText('Added 1 image.');
  await expect(pool(app).locator('img')).toHaveJSProperty('naturalWidth', 30);
});
