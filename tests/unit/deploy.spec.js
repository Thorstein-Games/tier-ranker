// Static checks on the deployable files: no browser needed.
const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { pngSize } = require('../helpers');

const ROOT = join(__dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const pagesYml = read('.github/workflows/pages.yml');
const deployed = pagesYml.match(/\bcp -r (.+?) _site\/?/)[1].trim().split(/\s+/);
const html = read('index.html');
const isDeployed = (rel) => deployed.some((e) => rel === e || rel.startsWith(`${e}/`));

/** Every same-site path the page or stylesheet references. */
const localRefs = () => {
  const refs = new Set();
  for (const [, url] of html.matchAll(/\b(?:src|href|content)="([^"]+)"/g)) {
    if (url.startsWith('/')) refs.add(url);
    else if (url.startsWith('https://thorsteingames.com/tier-ranker/')) refs.add(url.slice('https://thorsteingames.com'.length));
  }
  for (const [, url] of read('style.css').matchAll(/url\(["']?([^"')]+)/g)) if (!url.startsWith('data:')) refs.add(url);
  return [...refs];
};

test('app.js passes `node --check`', () => {
  const r = spawnSync(process.execPath, ['--check', join(ROOT, 'app.js')], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
});

test('pages.yml deploys the site files and nothing from the test tooling', () => {
  expect(deployed).toEqual(expect.arrayContaining(['index.html', 'style.css', 'app.js', 'assets', '.nojekyll']));
  for (const e of deployed) expect(existsSync(join(ROOT, e)), `${e} exists`).toBe(true);
  for (const dev of ['package.json', 'package-lock.json', 'node_modules', 'tests', 'playwright.config.js', '.']) {
    expect(deployed).not.toContain(dev);
  }
});

test('pages.yml only deploys after the test workflow passes', () => {
  expect(pagesYml).toMatch(/^\s+test:\s*\n\s+uses: \.\/\.github\/workflows\/test\.yml/m);
  expect(pagesYml).toMatch(/needs: test/);
});

test('every local asset referenced by index.html and style.css is in the deploy list and exists', () => {
  const refs = localRefs();
  expect(refs.length).toBeGreaterThan(4);
  for (const ref of refs) {
    expect(ref, 'local references use absolute /tier-ranker/ paths').toMatch(/^\/tier-ranker\//);
    const rel = ref.replace(/^\/tier-ranker\//, '').split(/[?#]/)[0];
    expect(isDeployed(rel), `${rel} is copied by pages.yml`).toBe(true);
    expect(existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).isFile(), `${rel} exists`).toBe(true);
  }
});

test('no relative asset paths sneak into index.html', () => {
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    expect(url, `${url} should be absolute`).toMatch(/^(https?:|\/|#|mailto:)/);
  }
});

test('social and touch icons have the expected sizes', () => {
  expect(pngSize(readFileSync(join(ROOT, 'assets/og-image.png')))).toEqual({ width: 1200, height: 630 });
  expect(pngSize(readFileSync(join(ROOT, 'assets/apple-touch-icon.png')))).toEqual({ width: 180, height: 180 });
  expect(html).toContain('<meta property="og:image:width" content="1200" />');
  expect(html).toContain('<meta property="og:image:height" content="630" />');
});

test('the site stays dependency-free: index.html loads only its own files and the shared tg-bar script', () => {
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  expect(scripts.sort()).toEqual(['/tier-ranker/app.js', 'https://thorsteingames.com/tg-bar.js']);
  expect(html).not.toMatch(/node_modules/);
});
