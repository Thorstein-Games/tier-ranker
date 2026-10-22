// Image search: Wikimedia request parameters, response parsing, paging, errors and races.
const { test, expect, mockWikimedia, WIKI_API, COMMONS_API, CORS } = require('../helpers');

// Results only lay out (and lazy images only load) while the dialog is open.
test.beforeEach(({ app }) => app.evaluate(() => searchDialog.showModal()));

test('SEARCH_SOURCES point at the keyless Wikimedia APIs', async ({ app }) => {
  const r = await app.evaluate(() => Object.fromEntries(Object.entries(SEARCH_SOURCES).map(([k, s]) => [k, [s.api, s.params('cats')]])));
  expect(r.wikipedia[0]).toBe(WIKI_API);
  expect(r.wikipedia[1]).toMatchObject({ generator: 'search', gsrsearch: 'cats', prop: 'pageimages', pithumbsize: 320 });
  expect(r.commons[0]).toBe(COMMONS_API);
  expect(r.commons[1]).toMatchObject({ generator: 'search', gsrsearch: 'cats', gsrnamespace: 6, prop: 'imageinfo', iiurlwidth: 320 });
});

test('wikipedia toResult() keeps pages with a thumbnail only', async ({ app }) => {
  const r = await app.evaluate(() => [
    SEARCH_SOURCES.wikipedia.toResult({ title: 'Mario', thumbnail: { source: 'https://u/m.png' } }),
    SEARCH_SOURCES.wikipedia.toResult({ title: 'No pic' }),
  ]);
  expect(r[0]).toEqual({ title: 'Mario', src: 'https://u/m.png' });
  expect(r[1]).toBeFalsy();
});

test('commons toResult() cleans file titles and skips non-images', async ({ app }) => {
  const r = await app.evaluate(() => {
    const t = SEARCH_SOURCES.commons.toResult;
    return [
      t({ title: 'File:Red panda (Ailurus fulgens).jpg', imageinfo: [{ thumburl: 'https://u/p.jpg', mime: 'image/jpeg' }] }),
      t({ title: 'File:Clip.webm', imageinfo: [{ thumburl: 'https://u/c.jpg', mime: 'video/webm' }] }),
      t({ title: 'File:Doc.pdf', imageinfo: [{ mime: 'image/png' }] }),
      t({ title: 'File:Nothing.png' }),
    ];
  });
  expect(r[0]).toEqual({ title: 'Red panda (Ailurus fulgens)', src: 'https://u/p.jpg' });
  expect(r.slice(1)).toEqual([null, null, null]);
});

test('runSearch() sends a CORS-enabled query and renders results in relevance order', async ({ app }) => {
  const calls = await mockWikimedia(app);
  await app.evaluate(async () => { searchInput.value = '  zelda '; await runSearch(); });
  const p = calls[0].searchParams;
  expect(Object.fromEntries(p)).toMatchObject({ action: 'query', format: 'json', formatversion: '2', origin: '*', gsrsearch: 'zelda' });
  await expect(app.locator('#search-results .result')).toHaveCount(2);
  await expect(app.locator('#search-results .result span')).toHaveText(['zelda one', 'zelda two']);
  await expect(app.locator('#search-results .result').first()).toHaveAttribute('data-src', 'https://upload.wikimedia.org/w/one.png');
  await expect(app.locator('#search-status')).toHaveText('Click an image to add it to your unranked items.');
  await expect(app.locator('#search-more')).toBeVisible();
});

test('runSearch(true) passes the continue token and appends results', async ({ app }) => {
  const calls = await mockWikimedia(app);
  await app.evaluate(async () => { searchInput.value = 'zelda'; await runSearch(); await runSearch(true); });
  expect(calls[1].searchParams.get('gsroffset')).toBe('3');
  expect(calls[1].searchParams.get('continue')).toBe('gsroffset||');
  await expect(app.locator('#search-results .result span')).toHaveText(['zelda one', 'zelda two', 'zelda sequel']);
  await expect(app.locator('#search-more')).toBeHidden();
});

test('runSearch() ignores an empty query', async ({ app }) => {
  const calls = await mockWikimedia(app);
  await app.evaluate(async () => { searchInput.value = '   '; await runSearch(); });
  expect(calls).toHaveLength(0);
});

test('runSearch() reports "no images" and failures', async ({ app }) => {
  await app.route(`${WIKI_API}?**`, (r) => r.fulfill({ headers: CORS, contentType: 'application/json', body: '{"batchcomplete":true}' }));
  await app.evaluate(async () => { searchInput.value = 'qqq'; await runSearch(); });
  await expect(app.locator('#search-status')).toHaveText('No images found — try a different search or source.');

  await app.unroute(`${WIKI_API}?**`);
  await mockWikimedia(app, { fail: true });
  await app.evaluate(async () => { searchInput.value = 'qqq'; await runSearch(); });
  await expect(app.locator('#search-status')).toHaveText('Search failed — check your connection and try again.');
  await expect(app.locator('#search-results .result')).toHaveCount(0);
});

test('a slow, stale search does not overwrite a newer one', async ({ app }) => {
  let releaseSlow;
  const slowGate = new Promise((r) => (releaseSlow = r));
  await mockWikimedia(app);
  await app.route(`${WIKI_API}?**`, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('gsrsearch');
    if (q !== 'slow') return route.fallback();
    await slowGate;
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ query: { pages: [{ index: 1, title: 'STALE', thumbnail: { source: 'https://upload.wikimedia.org/s.png' } }] } }) });
  });
  await app.evaluate(() => { searchInput.value = 'slow'; window.slowSearch = runSearch(); });
  await app.evaluate(async () => { searchInput.value = 'fast'; await runSearch(); });
  releaseSlow();
  await app.evaluate(() => window.slowSearch);
  await expect(app.locator('#search-results .result span')).toHaveText(['fast one', 'fast two']);
});

test('makeResultEl() builds a lazy image button and removes itself if the image fails', async ({ app }) => {
  const r = await app.evaluate(() => {
    const el = makeResultEl({ title: 'Kirby', src: 'https://upload.wikimedia.org/k.png' });
    const img = el.querySelector('img');
    return [el.type, el.className, el.title, el.dataset.src, img.alt, img.loading, el.textContent];
  });
  expect(r).toEqual(['button', 'result', 'Kirby', 'https://upload.wikimedia.org/k.png', 'Kirby', 'lazy', 'Kirby']);
  await app.evaluate(() => searchResultsEl.append(makeResultEl({ title: 'Bad', src: 'data:image/png;base64,AAAA' })));
  await expect(app.locator('#search-results .result')).toHaveCount(0);
});
