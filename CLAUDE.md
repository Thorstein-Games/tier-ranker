# Tier Ranker

Client-side tier list maker. Plain HTML/CSS/JS with **no build step and no runtime dependencies**. The root `package.json` holds only the test tooling (`@playwright/test`); nothing from it ships to the site. The code lives in three files, plus static images in `assets/`:

- `index.html`: markup, including the image-search `<dialog>`.
- `app.js`: all logic, organised into `/* ---- section ---- */` blocks: IndexedDB, state, rendering, rows, adding items, image search, drag & drop.
- `assets/`: full logo (`logo.svg`), letterless `logo-mark.svg` (favicon and header, where the letters would be illegible), `apple-touch-icon.png` (180px, square, iOS rounds it) and `og-image.png` (1200×630 social preview). The PNGs are rendered from `logo.svg`, so regenerate them if the logo changes.
- `style.css`: dark theme driven by CSS variables in `:root`. The single mobile breakpoint is `@media (max-width: 600px)`.
- `tests/`, `playwright.config.js`, `package.json`: the test suite (see Testing). Never add these to the deploy `cp` line.

## SEO and sharing metadata

`index.html`'s `<head>` has the title, description, canonical URL, Open Graph/Twitter tags and JSON-LD (`WebApplication` + `FAQPage`). Canonical and `og:*` URLs are absolute `https://thorsteingames.com/tier-ranker...`. The FAQ JSON-LD mirrors the visible FAQ in the `.about` section, so edit both together. The page `<h1>` is the "Tier Ranker" name line; the editable list title is an `<h2>`.

## Shared Thorstein Games bar and footer

`index.html` loads `https://thorsteingames.com/tg-bar.js` (served by the thorstein-games-website repo, whose CLAUDE.md has the full contract) and uses `<tg-bar game="tier-ranker">` (thin site header, first in `<body>`, hides while scrolling down) and `<tg-footer game="tier-ranker">` (other games, More Games, contact, privacy, copyright) after `<main>`. The bar is always 40px; `style.css` holds that space before the script loads (`tg-bar:not(:defined)`). The page is longer than a screen, so the footer stays below the fold. When checking locally without network the elements stay empty, which is fine.

Ads: a `<tg-ad format="banner">` sits between `<main>` and the footer (rules and options in the thorstein-games-website CLAUDE.md). Keep ads out of the tier list and the drag areas. Check placements with `?tgads=preview`.

## Key invariants

- **State** (`state`) is saved to `localStorage` under `tier-ranker:v1`. Its shape is `{ title, rows: [{id, name, color, items: [ids]}], pool: [ids], items: {id: item} }`. If you change the shape, keep `loadState()` able to read old saves, or bump the key.
- **Image blobs** go in IndexedDB (`tier-ranker` DB, `images` store), keyed by item id. Items with `stored: true` live there. Items with only `url` are remote links, used when a host blocks CORS.
- New images go through `addImageBlob` (downscales to `MAX_IMAGE_SIDE` and re-encodes as WebP) or `addImageFromUrl` (tries a CORS fetch first, falls back to a plain link). Reuse these; don't add a parallel path.
- **Drag & drop** uses pointer events (mouse and touch), not the HTML5 DnD API. Anything with class `.item` is draggable. After a drop, `syncFromDom()` rebuilds `state` from the DOM order.
- **Image search** calls the Wikimedia APIs (`SEARCH_SOURCES` in `app.js`). They're keyless and CORS-enabled through `origin=*`. Keep the app backend-free: no API keys, no servers.
- Keep inputs at `font-size: 16px` or larger, or iOS Safari zooms in on focus.

## Paths and deployment

- Asset paths are **absolute** (`/tier-ranker/app.js`) because thorsteingames.com proxies `/tier-ranker` to this repo's GitHub Pages site (proxy rules in the `thorstein-games-website` repo's `public/_redirects`). Keep new asset references in that form.
- `.github/workflows/pages.yml` deploys `main` and copies an **explicit file list** (`index.html style.css app.js assets .nojekyll`). **If you add a file the site needs, add it to that `cp` line too.** The tests serve only the files on that line, so a missing one fails them.
- `pages.yml` first calls `.github/workflows/test.yml` and deploys only if it passes. `test.yml` also runs on pull requests and pushes to other branches.

## Running and verifying

Serve the *parent* directory so the `/tier-ranker/` paths resolve:

```sh
cd .. && python3 -m http.server 8000   # open http://localhost:8000/tier-ranker/
```

- Syntax check: `node --check app.js`
- Check UI changes in a browser at both desktop and phone widths (around 390px).

## Testing

Playwright (Chromium), pinned to an exact version in `package.json`. Setup once with `npm ci` and `npx playwright install chromium`, then:

```sh
npm test            # everything
npm run test:unit   # tests/unit: app.js functions + static deploy checks
npm run test:e2e    # tests/e2e: user flows, at desktop (1280px) and phone (390px, touch) widths
```

- `playwright.config.js` starts `tests/server.mjs`, which serves the repo at `/tier-ranker/` but **only the files `pages.yml` copies**, like the real deploy.
- Unit tests load the page and call `app.js`'s top-level functions and `state` through `page.evaluate`. `app.js` stays a plain browser script; no exports.
- `tests/helpers.js` has the shared fixtures. Every test blocks real network: requests to anything but the test server fail, `tg-bar.js` is stubbed, and uncaught page errors fail the test. Mock Wikimedia with `mockWikimedia(page)`, and other hosts with `page.route`. Playwright adds `access-control-allow-origin` to fulfilled responses that lack one, so to simulate a host that blocks CORS, send a different origin.
- Drag tests use the mouse on desktop and real CDP touch events on the phone project (`dragTo()` in the helpers).
- `tests/fixtures/legacy-save.json` is a save in the existing `tier-ranker:v1` shape. If you change the shape, it must keep loading (or bump the key).
- Wait with auto-retrying assertions (`expect(locator)…`), never sleeps.
- Add or update tests with every behaviour change. CI runs `node --check app.js` and `npm test`, and uploads the Playwright report when they fail.

## Style

Match the existing code: `'use strict'`, `const`/arrow functions, the `$()` helper, `uid()` for ids, `toast()` for user feedback, terse comments only where intent isn't obvious. Update `README.md` when you add a user-facing feature.
