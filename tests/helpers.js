// Shared fixtures and helpers for the unit and e2e suites.
const { test: base, expect } = require('@playwright/test');
const zlib = require('node:zlib');

const STORE_KEY = 'tier-ranker:v1';
const APP = '/tier-ranker/';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const CORS = { 'access-control-allow-origin': '*' };

/* ---------- tiny PNG encoder (no deps) ---------- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** Solid-colour RGB PNG of the given size. */
function makePng(width, height, [r, g, b] = [200, 60, 60]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/* ---------- Wikimedia mocks ---------- */
/** Fake Wikipedia/Commons API + upload.wikimedia.org. Returns the list of API requests made. */
async function mockWikimedia(page, { wikipedia, commons, fail = false } = {}) {
  const calls = [];
  const api = (pagesFor) => async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    if (fail) return route.fulfill({ status: 500, headers: CORS, body: 'boom' });
    const q = url.searchParams.get('gsrsearch');
    const offset = Number(url.searchParams.get('gsroffset') || 0);
    const body = pagesFor(q, offset);
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route(`${WIKI_API}?**`, api(wikipedia || wikiPages));
  await page.route(`${COMMONS_API}?**`, api(commons || commonsPages));
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: makePng(64, 48, [40, 120, 220]) }));
  return calls;
}

// Default fake responses. Pages are deliberately out of `index` order.
const wikiPages = (q, offset) => ({
  ...(offset ? {} : { continue: { gsroffset: 3, continue: 'gsroffset||' } }),
  query: {
    pages: offset
      ? [{ pageid: 9, index: 4, title: `${q} sequel`, thumbnail: { source: 'https://upload.wikimedia.org/w/sequel.png' } }]
      : [
          { pageid: 2, index: 2, title: `${q} two`, thumbnail: { source: 'https://upload.wikimedia.org/w/two.png' } },
          { pageid: 1, index: 1, title: `${q} one`, thumbnail: { source: 'https://upload.wikimedia.org/w/one.png' } },
          { pageid: 3, index: 3, title: `${q} no image` },
        ],
  },
});
const commonsPages = (q) => ({
  query: {
    pages: [
      { index: 1, title: `File:${q} photo.jpg`, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c/photo.png', mime: 'image/jpeg' }] },
      { index: 2, title: `File:${q} clip.webm`, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c/clip.png', mime: 'video/webm' }] },
    ],
  },
});

/* ---------- fixtures ---------- */
const test = base.extend({
  // Every test: no real network, a stub for the shared Thorstein Games bar script,
  // and a hard failure on uncaught page errors.
  network: [async ({ context, baseURL }, use) => {
    const blocked = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(baseURL) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
      if (url === 'https://thorsteingames.com/tg-bar.js') {
        return route.fulfill({ contentType: 'text/javascript', body: '/* tg-bar stub */' });
      }
      blocked.push(url);
      return route.abort();
    });
    await use({ blocked });
  }, { auto: true }],

  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],

  // A freshly loaded app with empty storage.
  app: async ({ page }, use) => {
    await page.goto(APP);
    await expect(page.locator('#tiers .tier')).toHaveCount(6);
    await use(page);
  },
});

/** Seed localStorage before the app script runs. */
async function seedState(page, state) {
  await page.addInitScript(([key, json]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, json);
      sessionStorage.setItem('seeded', '1');
    }
  }, [STORE_KEY, JSON.stringify(state)]);
}

const savedState = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORE_KEY);

/** Ids (in order) of the items in the pool or in the row at `index`. */
const zoneIds = (page, which) => page.evaluate((which) => {
  const zone = which === 'pool' ? document.querySelector('#pool') : document.querySelectorAll('#tiers .zone')[which];
  return [...zone.children].map((c) => c.dataset.id);
}, which);

/* ---------- pointer drag (mouse or touch) ---------- */
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Pointer driver: mouse on desktop, real CDP touch events on touch devices. */
async function pointer(page) {
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (!touch) {
    return {
      down: async ({ x, y }) => { await page.mouse.move(x, y); await page.mouse.down(); },
      move: ({ x, y }) => page.mouse.move(x, y, { steps: 8 }),
      up: () => page.mouse.up(),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  let last;
  const send = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  return {
    down: async (p) => { last = p; await send('touchStart', p); },
    move: async (p) => {
      const from = last;
      for (let i = 1; i <= 8; i++) {
        await send('touchMove', { x: from.x + ((p.x - from.x) * i) / 8, y: from.y + ((p.y - from.y) * i) / 8 });
      }
      last = p;
    },
    up: () => send('touchEnd'),
  };
}

/**
 * Drag `source` and drop it at `target` (a locator, or a function returning a point).
 * `beforeDrop` runs while still holding, after the final move.
 */
async function dragTo(page, source, target, { beforeDrop } = {}) {
  const ptr = await pointer(page);
  const start = await center(source);
  await ptr.down(start);
  await ptr.move({ x: start.x + 12, y: start.y + 12 }); // past the 5px threshold
  await expect(page.locator('body')).toHaveClass(/dragging/);
  const end = typeof target === 'function' ? await target() : await center(target);
  await ptr.move(end);
  if (beforeDrop) await beforeDrop();
  await ptr.up();
  await expect(page.locator('body')).not.toHaveClass(/dragging/);
}

/** A point in the empty space at the end of a zone (after its last item). */
const zoneEnd = (zone) => async () => {
  await zone.scrollIntoViewIfNeeded();
  const b = await zone.boundingBox();
  return { x: b.x + b.width - 6, y: b.y + b.height - 6 };
};

module.exports = {
  test, expect, makePng, pngSize, mockWikimedia, seedState, savedState, zoneIds, dragTo, zoneEnd, pointer, center,
  STORE_KEY, APP, WIKI_API, COMMONS_API, CORS,
};
