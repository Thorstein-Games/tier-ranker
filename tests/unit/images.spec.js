// Image helpers: IndexedDB wrapper, shrinkImage/addImageBlob, addImageFromUrl, imageSrc, item elements.
const { test, expect, makePng, CORS, savedState } = require('../helpers');

// Runs in the page: a PNG blob of w×h with some detail so it doesn't compress to nothing.
const pngBlobSrc = `(w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let i = 0; i < 400; i++) {
    g.fillStyle = 'hsl(' + (i * 37) % 360 + ',80%,50%)';
    g.fillRect((i * 53) % w, (i * 97) % h, 20, 20);
  }
  return new Promise((r) => c.toBlob(r, 'image/png'));
}`;
const blobSize = `async (b) => { const bmp = await createImageBitmap(b); return { w: bmp.width, h: bmp.height, type: b.type }; }`;

test('imageDB put/get/del/clear work and persist in the "tier-ranker" database', async ({ app }) => {
  const r = await app.evaluate(async () => {
    await imageDB.put('k1', new Blob(['one'], { type: 'text/plain' }));
    await imageDB.put('k2', new Blob(['two']));
    const got = await (await imageDB.get('k1')).text();
    await imageDB.del('k1');
    const afterDel = await imageDB.get('k1');
    const names = (await indexedDB.databases()).map((d) => d.name);
    await imageDB.clear();
    return { got, afterDel, k2: await imageDB.get('k2'), names };
  });
  expect(r).toEqual({ got: 'one', afterDel: undefined, k2: undefined, names: expect.arrayContaining(['tier-ranker']) });
});

test('shrinkImage() downscales large images to MAX_IMAGE_SIDE as WebP, keeping aspect ratio', async ({ app }) => {
  const r = await app.evaluate(async ([pngBlobSrc, blobSize]) => {
    const png = await eval(pngBlobSrc)(1000, 500);
    const out = await shrinkImage(png);
    return { max: MAX_IMAGE_SIDE, ...(await eval(blobSize)(out)), smaller: out.size < png.size };
  }, [pngBlobSrc, blobSize]);
  expect(r).toEqual({ max: 320, w: 320, h: 160, type: 'image/webp', smaller: true });
});

test('shrinkImage() handles portrait images', async ({ app }) => {
  const r = await app.evaluate(async ([pngBlobSrc, blobSize]) =>
    eval(blobSize)(await shrinkImage(await eval(pngBlobSrc)(300, 900))), [pngBlobSrc, blobSize]);
  expect(r).toMatchObject({ w: 107, h: 320 });
});

test('shrinkImage() keeps the original when re-encoding would not make it smaller', async ({ app }) => {
  const same = await app.evaluate(async () => {
    // A tiny 2×2 solid PNG: WebP output won't beat it.
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    return (await shrinkImage(png)) === png;
  });
  expect(same).toBe(true);
});

test('shrinkImage() returns undecodable data unchanged', async ({ app }) => {
  expect(await app.evaluate(async () => {
    const junk = new Blob(['not an image'], { type: 'image/png' });
    return (await shrinkImage(junk)) === junk;
  })).toBe(true);
});

test('addImageBlob() stores the shrunk image in IndexedDB and adds a stored item to the pool', async ({ app }) => {
  const r = await app.evaluate(async ([pngBlobSrc, blobSize]) => {
    await addImageBlob(await eval(pngBlobSrc)(800, 800));
    const id = state.pool.at(-1);
    return { item: state.items[id], blob: await eval(blobSize)(await imageDB.get(id)), id };
  }, [pngBlobSrc, blobSize]);
  expect(r.item).toEqual({ id: r.id, type: 'image', stored: true });
  expect(r.blob).toEqual({ w: 320, h: 320, type: 'image/webp' });
  expect((await savedState(app)).pool).toEqual([r.id]);
  await expect(app.locator(`#pool .item[data-id="${r.id}"] img`)).toHaveJSProperty('complete', true);
  await expect(app.locator(`#pool .item[data-id="${r.id}"] img`)).toHaveAttribute('src', /^blob:/);
});

test('addImageBlob() toasts and adds nothing when IndexedDB fails', async ({ app }) => {
  await app.evaluate(async () => {
    imageDB.put = () => Promise.reject(new Error('quota'));
    await addImageBlob(new Blob(['x'], { type: 'image/png' }));
  });
  await expect(app.locator('#toast')).toHaveText(/Could not store image/);
  expect(await app.evaluate(() => state.pool.length)).toBe(0);
});

test('addImageFiles() ignores non-images and reports how many were added', async ({ app }) => {
  const added = await app.evaluate(async () => {
    const png = (n) => new File([new Uint8Array(8)], n, { type: 'image/png' });
    await addImageFiles([new File(['hi'], 'a.txt', { type: 'text/plain' }), png('a.png'), png('b.png')]);
    return state.pool.length;
  });
  expect(added).toBe(2);
  await expect(app.locator('#toast')).toHaveText('Added 2 images.');
  await app.evaluate(() => addImageFiles([new File(['hi'], 'a.txt', { type: 'text/plain' })]));
  await expect(app.locator('#toast')).toHaveText('No image files found.');
});

test.describe('addImageFromUrl()', () => {
  const png = makePng(400, 200);
  const add = (page, url) => page.evaluate(async (url) => {
    const ok = await addImageFromUrl(url);
    const id = state.pool.at(-1);
    return { ok, item: id && state.items[id], hasBlob: !!(id && (await imageDB.get(id))) };
  }, url);

  test('downloads a local copy when the host allows CORS', async ({ app }) => {
    await app.route('https://img.example/cors.png', (r) => r.fulfill({ headers: CORS, contentType: 'image/png', body: png }));
    const r = await add(app, 'https://img.example/cors.png');
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ type: 'image', stored: true });
    expect(r.item.url).toBeUndefined();
    expect(r.hasBlob).toBe(true);
  });

  test('falls back to remembering the link when CORS is blocked', async ({ app }) => {
    // Playwright adds a permissive CORS header to fulfilled responses unless one is set, so name another origin.
    await app.route('https://img.example/nocors.png', (r) =>
      r.fulfill({ headers: { 'access-control-allow-origin': 'https://elsewhere.example' }, contentType: 'image/png', body: png }));
    const r = await add(app, 'https://img.example/nocors.png');
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ type: 'image', url: 'https://img.example/nocors.png' });
    expect(r.item.stored).toBeUndefined();
    expect(r.hasBlob).toBe(false);
  });

  test('rejects a CORS response that is not an image unless it loads as one', async ({ app }) => {
    await app.route('https://img.example/page', (r) => r.fulfill({ headers: CORS, contentType: 'text/html', body: '<p>hi</p>' }));
    expect((await add(app, 'https://img.example/page')).ok).toBe(false);
    expect(await app.evaluate(() => state.pool.length)).toBe(0);
  });

  test('returns false for a 404', async ({ app }) => {
    await app.route('https://img.example/missing.png', (r) => r.fulfill({ status: 404, headers: CORS, body: '' }));
    expect((await add(app, 'https://img.example/missing.png')).ok).toBe(false);
  });
});

test('imageSrc() resolves links directly, stored blobs to cached blob: URLs, and missing blobs to ""', async ({ app }) => {
  const r = await app.evaluate(async () => {
    await imageDB.put('s1', new Blob(['x'], { type: 'image/png' }));
    const a = await imageSrc({ id: 's1', stored: true });
    const b = await imageSrc({ id: 's1', stored: true });
    return {
      link: await imageSrc({ id: 'l', url: 'https://x.example/a.png' }),
      none: await imageSrc({ id: 'n' }),
      missing: await imageSrc({ id: 'gone', stored: true }),
      blob: a, cached: a === b,
    };
  });
  expect(r).toMatchObject({ link: 'https://x.example/a.png', none: '', missing: '', cached: true });
  expect(r.blob).toMatch(/^blob:/);
});

test('makeItemEl() builds text tiles and marks images that fail to load as broken', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const t = makeItemEl({ id: 't1', type: 'text', text: 'Hello' });
    const missing = makeItemEl({ id: 'm1', type: 'image', stored: true });
    const bad = makeItemEl({ id: 'b1', type: 'image', url: 'data:image/png;base64,AAAA' });
    document.body.append(bad);
    await new Promise((res) => setTimeout(res, 0));
    await imageSrc({ id: 'm1', stored: true });
    return {
      text: [t.className, t.textContent, t.title, t.dataset.id],
      missingBroken: missing.classList.contains('broken'),
      imgDraggable: bad.querySelector('img').draggable,
    };
  });
  expect(r.text).toEqual(['item text', 'Hello', 'Hello', 't1']);
  expect(r.missingBroken).toBe(true);
  expect(r.imgDraggable).toBe(false);
  await expect(app.locator('body > .item[data-id="b1"]')).toHaveClass(/broken/);
});
