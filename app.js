'use strict';

/* =========================================================
   Tier Ranker — client-side only.
   Board layout (rows, item order, text items) lives in localStorage.
   Image blobs live in IndexedDB (much larger quota, stores binary
   without base64 bloat). Uploaded images are downscaled first.
   ========================================================= */

const STORE_KEY = 'tier-ranker:v1';
const MAX_ROWS = 10;
const MAX_IMAGE_SIDE = 320; // px; plenty for an 80px tile on hi-dpi screens
const DEFAULT_ROWS = [
  ['S', '#ff7f7f'],
  ['A', '#ffbf7f'],
  ['B', '#ffdf7f'],
  ['C', '#ffff7f'],
  ['D', '#bfff7f'],
  ['💩', '#7fbfff'],
];
const PALETTE = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffff', '#7fbfff', '#7f7fff', '#ff7fff'];

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);

/* ---------------- IndexedDB (image blobs) ---------------- */
const imageDB = (() => {
  let dbPromise;
  const open = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('tier-ranker', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('images');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      const req = fn(tx.objectStore('images'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    put: (key, blob) => run('readwrite', (s) => s.put(blob, key)),
    del: (key) => run('readwrite', (s) => s.delete(key)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();

// Ask the browser not to evict our storage under pressure (best effort).
navigator.storage?.persist?.().catch(() => {});

/* ---------------- state ---------------- */
function defaultState() {
  return {
    title: 'My Tier List',
    rows: DEFAULT_ROWS.map(([name, color]) => ({ id: uid(), name, color, items: [] })),
    pool: [],
    items: {}, // id -> { id, type: 'text'|'image', text?, url?, stored? }
  };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.rows) && Array.isArray(s.pool) && s.items) return s;
  } catch {}
  return defaultState();
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('Could not save — browser storage is full or blocked.');
  }
}

/* ---------------- elements ---------------- */
const titleEl = $('#title');
const baseTitle = document.title;
const syncDocTitle = () => (document.title = state.title === 'My Tier List' ? baseTitle : `${state.title} – Tier Ranker`);
const tiersEl = $('#tiers');
const poolEl = $('#pool');
const addRowBtn = $('#add-row');
const rowCountEl = $('#row-count');
const trashEl = $('#trash');
const toastEl = $('#toast');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ---------------- rendering ---------------- */
const objectUrls = new Map(); // item id -> blob: URL

async function imageSrc(item) {
  if (!item.stored) return item.url || '';
  if (objectUrls.has(item.id)) return objectUrls.get(item.id);
  const blob = await imageDB.get(item.id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.set(item.id, url);
  return url;
}

function makeItemEl(item) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = item.id;
  if (item.type === 'text') {
    el.classList.add('text');
    el.textContent = item.text;
    el.title = item.text;
  } else {
    const img = new Image();
    img.draggable = false;
    img.alt = '';
    img.onerror = () => el.classList.add('broken');
    imageSrc(item).then((src) => (src ? (img.src = src) : el.classList.add('broken')));
    el.append(img);
  }
  return el;
}

function fillZone(zone, ids) {
  zone.replaceChildren(...ids.map((id) => state.items[id]).filter(Boolean).map(makeItemEl));
}

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#111' : '#fff';
}

function renderRow(row, index) {
  const tier = document.createElement('div');
  tier.className = 'tier';
  tier.dataset.row = row.id;

  const label = document.createElement('div');
  label.className = 'label';
  label.style.background = row.color;
  label.style.color = textColorFor(row.color);
  const name = document.createElement('span');
  name.className = 'name';
  name.contentEditable = 'true';
  name.spellcheck = false;
  name.textContent = row.name;
  name.title = 'Click to rename';
  label.append(name);

  const zone = document.createElement('div');
  zone.className = 'zone';
  zone.dataset.zone = row.id;
  fillZone(zone, row.items);

  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.innerHTML = `
    <button class="icon-btn" data-act="up" title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button>
    <input class="color-input" type="color" value="${row.color}" title="Row color" />
    <button class="icon-btn" data-act="down" title="Move down" ${index === state.rows.length - 1 ? 'disabled' : ''}>▼</button>
    <button class="icon-btn del" data-act="del" title="Delete row" ${state.rows.length <= 1 ? 'disabled' : ''}>✕</button>`;

  tier.append(label, zone, controls);
  return tier;
}

function render() {
  titleEl.textContent = state.title;
  syncDocTitle();
  tiersEl.replaceChildren(...state.rows.map(renderRow));
  fillZone(poolEl, state.pool);
  addRowBtn.disabled = state.rows.length >= MAX_ROWS;
  rowCountEl.textContent = `${state.rows.length} / ${MAX_ROWS} rows`;
}

/* ---------------- title & rows ---------------- */
titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
titleEl.addEventListener('blur', () => {
  state.title = titleEl.textContent.trim().slice(0, 80) || 'My Tier List';
  titleEl.textContent = state.title;
  syncDocTitle();
  save();
});

const rowOf = (el) => state.rows.find((r) => r.id === el.closest('.tier')?.dataset.row);

tiersEl.addEventListener('keydown', (e) => {
  if (e.target.classList.contains('name') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
tiersEl.addEventListener('focusout', (e) => {
  if (!e.target.classList.contains('name')) return;
  const row = rowOf(e.target);
  if (!row) return;
  row.name = e.target.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) || '?';
  e.target.textContent = row.name;
  save();
});
tiersEl.addEventListener('input', (e) => {
  if (!e.target.classList.contains('color-input')) return;
  const row = rowOf(e.target);
  row.color = e.target.value;
  const label = e.target.closest('.tier').querySelector('.label');
  label.style.background = row.color;
  label.style.color = textColorFor(row.color);
});
tiersEl.addEventListener('change', (e) => {
  if (e.target.classList.contains('color-input')) save();
});
tiersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const i = state.rows.indexOf(rowOf(btn));
  const act = btn.dataset.act;
  if (act === 'up' && i > 0) {
    [state.rows[i - 1], state.rows[i]] = [state.rows[i], state.rows[i - 1]];
  } else if (act === 'down' && i < state.rows.length - 1) {
    [state.rows[i + 1], state.rows[i]] = [state.rows[i], state.rows[i + 1]];
  } else if (act === 'del' && state.rows.length > 1) {
    const [removed] = state.rows.splice(i, 1);
    state.pool.push(...removed.items); // items go back to the pool, not lost
  } else return;
  save();
  render();
});

addRowBtn.addEventListener('click', () => {
  if (state.rows.length >= MAX_ROWS) return;
  const color = PALETTE[state.rows.length % PALETTE.length];
  state.rows.push({ id: uid(), name: 'New', color, items: [] });
  save();
  render();
  const names = tiersEl.querySelectorAll('.name');
  const last = names[names.length - 1];
  last.focus();
  document.getSelection().selectAllChildren(last);
});

$('#unrank-all').addEventListener('click', () => {
  for (const row of state.rows) { state.pool.push(...row.items); row.items = []; }
  save();
  render();
});

$('#start-over').addEventListener('click', async () => {
  if (!confirm('Delete all rows, items and images and start fresh?')) return;
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  try { await imageDB.clear(); } catch {}
  state = defaultState();
  save();
  render();
});

/* ---------------- adding items ---------------- */
function addItem(item) {
  state.items[item.id] = item;
  state.pool.push(item.id);
  save();
  poolEl.append(makeItemEl(item));
}

$('#text-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#text-input');
  const text = input.value.trim();
  if (!text) return;
  addItem({ id: uid(), type: 'text', text });
  input.value = '';
  input.focus();
});

// Downscale to keep storage small; fall back to the original if decoding fails (e.g. some SVGs).
async function shrinkImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

async function addImageBlob(blob) {
  const id = uid();
  try {
    await imageDB.put(id, await shrinkImage(blob));
  } catch {
    toast('Could not store image — browser storage may be full.');
    return;
  }
  addItem({ id, type: 'image', stored: true });
}

async function addImageFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return toast('No image files found.');
  for (const f of images) await addImageBlob(f);
  toast(`Added ${images.length} image${images.length > 1 ? 's' : ''}.`);
}

$('#file-input').addEventListener('change', async (e) => {
  await addImageFiles(e.target.files);
  e.target.value = '';
});

// Prefer a local copy (works offline, survives link rot). Many hosts block
// cross-origin fetches, so fall back to just remembering the link.
async function addImageFromUrl(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error();
    await addImageBlob(blob);
  } catch {
    const ok = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!ok) return false;
    addItem({ id: uid(), type: 'image', url });
  }
  return true;
}

$('#url-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#url-input');
  let url;
  try { url = new URL(input.value.trim()).href; } catch { return toast('That doesn’t look like a valid URL.'); }
  if (!(await addImageFromUrl(url))) return toast('Couldn’t load an image from that link.');
  input.value = '';
});

/* ---------------- image search (Wikimedia APIs: free, keyless, CORS-enabled) ---------------- */
const SEARCH_SOURCES = {
  // One image per article — great for characters, games, films, foods, people…
  wikipedia: {
    api: 'https://en.wikipedia.org/w/api.php',
    params: (q) => ({
      generator: 'search', gsrsearch: q, gsrlimit: 30,
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: MAX_IMAGE_SIDE, pilimit: 'max', pilicense: 'any',
    }),
    toResult: (p) => p.thumbnail && { title: p.title, src: p.thumbnail.source },
  },
  // Free media library — many more images per topic.
  commons: {
    api: 'https://commons.wikimedia.org/w/api.php',
    params: (q) => ({
      generator: 'search', gsrsearch: q, gsrnamespace: 6, gsrlimit: 30,
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: MAX_IMAGE_SIDE,
    }),
    toResult: (p) => {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl || !info.mime?.startsWith('image/')) return null;
      return { title: p.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''), src: info.thumburl };
    },
  },
};

const searchDialog = $('#search-dialog');
const searchInput = $('#search-input');
const searchResultsEl = $('#search-results');
const searchStatusEl = $('#search-status');
const searchMoreBtn = $('#search-more');
let search = { source: 'wikipedia', query: '', cont: null, token: 0 };

async function runSearch(more = false) {
  const query = searchInput.value.trim();
  if (!query) return;
  if (!more) {
    search = { ...search, query, cont: null, token: search.token + 1 };
    searchResultsEl.replaceChildren();
  }
  const { token, source } = search;
  const src = SEARCH_SOURCES[source];
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: 2, origin: '*',
    ...src.params(search.query), ...(more ? search.cont : {}),
  });
  searchStatusEl.textContent = 'Searching…';
  searchMoreBtn.hidden = true;
  let data;
  try {
    const res = await fetch(`${src.api}?${params}`);
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch {
    if (token === search.token) searchStatusEl.textContent = 'Search failed — check your connection and try again.';
    return;
  }
  if (token !== search.token) return; // a newer search started meanwhile
  const pages = (data.query?.pages || []).sort((a, b) => a.index - b.index);
  const results = pages.map(src.toResult).filter(Boolean);
  searchResultsEl.append(...results.map(makeResultEl));
  search.cont = data.continue || null;
  searchMoreBtn.hidden = !search.cont;
  const n = searchResultsEl.children.length;
  searchStatusEl.textContent = n
    ? 'Click an image to add it to your unranked items.'
    : `No images found${search.cont ? ' yet — try loading more or' : ' — try'} a different search or source.`;
}

function makeResultEl({ title, src }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'result';
  btn.title = title;
  btn.dataset.src = src;
  const img = new Image();
  img.alt = title;
  img.loading = 'lazy';
  img.src = src;
  img.onerror = () => btn.remove();
  const caption = document.createElement('span');
  caption.textContent = title;
  btn.append(img, caption);
  return btn;
}

searchResultsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.result');
  if (!btn || btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  const ok = await addImageFromUrl(btn.dataset.src);
  btn.classList.remove('busy');
  if (!ok) return toast('Couldn’t add that image.');
  btn.classList.add('added');
  toast(`Added “${btn.title}”.`);
});

$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
searchMoreBtn.addEventListener('click', () => runSearch(true));

searchDialog.querySelector('.source-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-source]');
  if (!tab || tab.dataset.source === search.source) return;
  search.source = tab.dataset.source;
  for (const t of searchDialog.querySelectorAll('[data-source]')) t.setAttribute('aria-checked', t === tab);
  if (searchInput.value.trim()) runSearch();
});

function openSearch() {
  searchDialog.showModal();
  searchInput.focus();
  searchInput.select();
  if (!searchResultsEl.children.length && !searchStatusEl.textContent) {
    searchStatusEl.textContent = 'Search for characters, games, movies, foods… then click images to add them.';
  }
}
$('#open-search').addEventListener('click', openSearch);
$('#add-item').addEventListener('click', openSearch);
$('#search-close').addEventListener('click', () => searchDialog.close());
// Close when clicking the backdrop (outside the dialog box).
searchDialog.addEventListener('click', (e) => { if (e.target === searchDialog) searchDialog.close(); });

// Paste images from the clipboard (when not typing in a field).
window.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, [contenteditable="true"]')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addImageFiles(files); }
});

// Drop image files anywhere on the page.
let fileDragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { fileDragDepth++; document.body.classList.add('file-over'); } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --fileDragDepth <= 0) { fileDragDepth = 0; document.body.classList.remove('file-over'); } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  fileDragDepth = 0;
  document.body.classList.remove('file-over');
  addImageFiles(e.dataTransfer.files);
});

// Double-click a text item to edit its text.
document.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.item.text');
  if (!el) return;
  const item = state.items[el.dataset.id];
  const next = prompt('Edit item', item.text);
  if (next == null || !next.trim()) return;
  item.text = next.trim().slice(0, 60);
  el.textContent = el.title = item.text;
  save();
});

/* ---------------- drag & drop (pointer events: mouse + touch) ---------------- */
let drag = null;

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.item');
  if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
  drag = { el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false };
});

function startDrag(e) {
  const { el } = drag;
  const rect = el.getBoundingClientRect();
  drag.offsetX = e.clientX - rect.left;
  drag.offsetY = e.clientY - rect.top;
  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.started = true;
  el.classList.add('placeholder');
  document.body.classList.add('dragging');
  autoScroll();
}

function insertionPoint(zone, x, y) {
  for (const child of zone.children) {
    if (child === drag.el) continue;
    const r = child.getBoundingClientRect();
    if (y < r.top) return child;
    if (y <= r.bottom && x < r.left + r.width / 2) return child;
  }
  return null;
}

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    startDrag(e);
  }
  e.preventDefault();
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.ghost.style.transform = `translate(${e.clientX - drag.offsetX}px, ${e.clientY - drag.offsetY}px) rotate(3deg)`;

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const overTrash = !!under?.closest('#trash');
  trashEl.classList.toggle('over', overTrash);
  drag.overTrash = overTrash;
  if (overTrash) return;

  const zone = under?.closest('.zone') || under?.closest('.tier')?.querySelector('.zone');
  if (!zone) return;
  const before = insertionPoint(zone, e.clientX, e.clientY);
  if (before !== drag.el.nextSibling || drag.el.parentNode !== zone) zone.insertBefore(drag.el, before);
}, { passive: false });

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (!d.started) return;
  d.ghost.remove();
  d.el.classList.remove('placeholder');
  document.body.classList.remove('dragging');
  trashEl.classList.remove('over');

  if (d.overTrash && !cancelled) {
    deleteItem(d.el.dataset.id);
    d.el.remove();
  }
  syncFromDom();
}
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

// Keep scrolling while dragging near the top/bottom edge (important on phones).
function autoScroll() {
  if (!drag?.started) return;
  const edge = 70;
  if (drag.y != null) {
    if (drag.y < edge) window.scrollBy(0, -Math.ceil((edge - drag.y) / 5));
    else if (drag.y > innerHeight - edge) window.scrollBy(0, Math.ceil((drag.y - (innerHeight - edge)) / 5));
  }
  requestAnimationFrame(autoScroll);
}

function syncFromDom() {
  for (const row of state.rows) {
    const zone = tiersEl.querySelector(`.zone[data-zone="${row.id}"]`);
    row.items = [...zone.children].map((c) => c.dataset.id);
  }
  state.pool = [...poolEl.children].map((c) => c.dataset.id);
  save();
}

function deleteItem(id) {
  const item = state.items[id];
  delete state.items[id];
  if (item?.stored) {
    imageDB.del(id).catch(() => {});
    const url = objectUrls.get(id);
    if (url) { URL.revokeObjectURL(url); objectUrls.delete(id); }
  }
}

render();
