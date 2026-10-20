# Tier Ranker

Client-side tier list maker. Plain HTML/CSS/JS with **no build step, no dependencies, no package.json**. The code lives in three files, plus static images in `assets/`:

- `index.html`: markup, including the image-search `<dialog>`.
- `app.js`: all logic, organised into `/* ---- section ---- */` blocks: IndexedDB, state, rendering, rows, adding items, image search, drag & drop.
- `assets/`: full logo (`logo.svg`), letterless `logo-mark.svg` (favicon and header, where the letters would be illegible), `apple-touch-icon.png` (180px, square, iOS rounds it) and `og-image.png` (1200×630 social preview). The PNGs are rendered from `logo.svg`, so regenerate them if the logo changes.
- `style.css`: dark theme driven by CSS variables in `:root`. The single mobile breakpoint is `@media (max-width: 600px)`.

## SEO and sharing metadata

`index.html`'s `<head>` has the title, description, canonical URL, Open Graph/Twitter tags and JSON-LD (`WebApplication` + `FAQPage`). Canonical and `og:*` URLs are absolute `https://thorsteingames.com/tier-ranker...`. The FAQ JSON-LD mirrors the visible FAQ in the `.about` section, so edit both together. The page `<h1>` is the "Tier Ranker" name line; the editable list title is an `<h2>`.

## Shared Thorstein Games bar and footer

`index.html` loads `https://thorsteingames.com/tg-bar.js` (served by the thorstein-games-website repo, whose CLAUDE.md has the full contract) and uses `<tg-bar game="tier-ranker">` (thin site header, first in `<body>`, hides while scrolling down) and `<tg-footer game="tier-ranker">` (other games, More Games, contact, privacy, copyright) after `<main>`. The bar is always 40px; `style.css` holds that space before the script loads (`tg-bar:not(:defined)`). The page is longer than a screen, so the footer stays below the fold. When checking locally without network the elements stay empty, which is fine.

## Key invariants

- **State** (`state`) is saved to `localStorage` under `tier-ranker:v1`. Its shape is `{ title, rows: [{id, name, color, items: [ids]}], pool: [ids], items: {id: item} }`. If you change the shape, keep `loadState()` able to read old saves, or bump the key.
- **Image blobs** go in IndexedDB (`tier-ranker` DB, `images` store), keyed by item id. Items with `stored: true` live there. Items with only `url` are remote links, used when a host blocks CORS.
- New images go through `addImageBlob` (downscales to `MAX_IMAGE_SIDE` and re-encodes as WebP) or `addImageFromUrl` (tries a CORS fetch first, falls back to a plain link). Reuse these; don't add a parallel path.
- **Drag & drop** uses pointer events (mouse and touch), not the HTML5 DnD API. Anything with class `.item` is draggable. After a drop, `syncFromDom()` rebuilds `state` from the DOM order.
- **Image search** calls the Wikimedia APIs (`SEARCH_SOURCES` in `app.js`). They're keyless and CORS-enabled through `origin=*`. Keep the app backend-free: no API keys, no servers.
- Keep inputs at `font-size: 16px` or larger, or iOS Safari zooms in on focus.

## Paths and deployment

- Asset paths are **absolute** (`/tier-ranker/app.js`) because thorsteingames.com proxies `/tier-ranker` to this repo's GitHub Pages site (rewrites in the `thorstein-games-website` repo's `next.config.ts`). Keep new asset references in that form.
- `.github/workflows/pages.yml` deploys `main` and copies an **explicit file list** (`index.html style.css app.js assets .nojekyll`). **If you add a file the site needs, add it to that `cp` line too.**

## Running and verifying

Serve the *parent* directory so the `/tier-ranker/` paths resolve:

```sh
cd .. && python3 -m http.server 8000   # open http://localhost:8000/tier-ranker/
```

- Syntax check: `node --check app.js`
- There is no test suite. Verify UI changes in a browser. Playwright with Chromium works for headless checks. In sandboxes without outbound network, mock `*.wikipedia.org` / `commons.wikimedia.org` / `upload.wikimedia.org` with `page.route` (send `access-control-allow-origin: *`).
- Check both desktop and phone widths (around 390px).

## Style

Match the existing code: `'use strict'`, `const`/arrow functions, the `$()` helper, `uid()` for ids, `toast()` for user feedback, terse comments only where intent isn't obvious. Update `README.md` when you add a user-facing feature.
