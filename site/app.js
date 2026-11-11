// Book Editor — app shell: display language, My shelf / Library tabs, read-only reader (step 3);
// My shelf in this browser's storage, Select → Move to / Delete (step 4).
// File formats: docs/book-file-format.md. No build step; plain ES modules.
import { UI, langName } from './i18n.js';
import * as Shelf from './shelf.js';

// ---- Library location ----
// The real Library sits at the app's own address under library/ (behind Cloudflare Access).
// Where there is none (local copy, public demo) the app falls back to the made-up sample.
const LIBRARIES = [{ base: 'library/', sample: false }, { base: 'samples/', sample: true }];

// ---- Display language: remembered on this device, else the browser's language ----
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: just not remembered */ } },
};
function firstUi() {
  const saved = store.get('be.ui');
  if (saved && UI[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const k = String(l).slice(0, 2).toLowerCase();
    if (UI[k]) return k;
  }
  return 'en';
}

const S = {
  ui: firstUi(), langSheet: false,
  lib: null, libBase: null, sample: false, libError: null,    // libError: 'loadFail' | 'tooNew'
  books: {},                                                   // id -> { book, story } | { error }
  readLang: {},                                                // id -> story language picked in the reader
  route: { view: 'library' },
  shelf: null, folders: [], shelfError: null, covers: {},      // shelf: book records from this device
  adding: null,                                                // { id, n, m } while a book is copied in
  mine: null,                                                  // { id, rec, urls } the shelf book being read
  selecting: false, picked: new Set(), sheet: null, closed: {},  // sheet: 'move' | 'delete'
};
const T = (k, v = {}) => String(UI[S.ui][k] ?? UI.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x]);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleOf = (titles, langs, prefer) => titles?.[prefer] || titles?.[langs?.[0]] || Object.values(titles || {})[0] || '';

// ---- Loading ----
class TooNew extends Error {}
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) { const e = new Error(`${r.status} ${url}`); e.status = r.status; throw e; }
  return r.json();
}
function checkFormat(obj, format) {
  if (!obj || obj.format !== format) throw new Error(`not a ${format}`);
  if (obj.formatVersion !== 1) throw new TooNew();
}
async function loadLibrary() {
  S.libError = null; S.lib = null; render();
  for (const L of LIBRARIES) {
    try {
      const lib = await getJson(L.base + 'library.json');
      checkFormat(lib, 'book-editor-library');
      Object.assign(S, { lib, libBase: L.base, sample: L.sample });
      return render();
    } catch (e) {
      if (e instanceof TooNew) { S.libError = 'tooNew'; return render(); }
      if (e.status === 404 && !L.sample) continue;       // no real Library here: try the sample
      S.libError = 'loadFail'; return render();
    }
  }
}
async function loadBook(id) {
  if (S.books[id] && !S.books[id].error) return;
  S.books[id] = { loading: true }; render();
  try {
    const dir = S.libBase + encodeURIComponent(id) + '/';
    const [book, story] = await Promise.all([getJson(dir + 'book.json'), getJson(dir + 'story.json')]);
    checkFormat(book, 'book-editor-book');
    if (!Array.isArray(story)) throw new Error('story.json is not a list');
    story.sort((a, b) => a.number - b.number);
    S.books[id] = { book, story, dir };
  } catch (e) {
    S.books[id] = { error: e instanceof TooNew ? 'tooNew' : 'bookFail' };
  }
  render();
}

// ---- My shelf (this device) ----
async function loadShelf() {
  try {
    const { books, folders } = await Shelf.list();
    const keep = new Set(books.map(b => b.id));
    for (const [id, u] of Object.entries(S.covers)) if (!keep.has(id)) { URL.revokeObjectURL(u); delete S.covers[id]; }
    await Promise.all(books.map(async b => {
      const p = b.book?.pictures?.covers?.front;
      if (!p || S.covers[b.id]) return;
      const blob = await Shelf.file(b.id, p).catch(() => null);
      if (blob) S.covers[b.id] = URL.createObjectURL(blob);
    }));
    Object.assign(S, { shelf: books, folders, shelfError: null });
  } catch {
    Object.assign(S, { shelf: [], folders: [], shelfError: 'noStore' });
  }
  render();
}
const onShelf = id => !!S.shelf?.some(b => b.id === id);

async function addBook(id) {
  if (S.shelfError) return toast(T('noStore'));
  if (onShelf(id)) return go(`mine/${encodeURIComponent(id)}/0`);
  if (S.adding) return;
  S.adding = { id, n: 0, m: 0 }; render();
  try {
    await Shelf.addFromLibrary(S.libBase + encodeURIComponent(id) + '/', (n, m) => { S.adding = { id, n, m }; render(); });
    S.adding = null;
    await loadShelf();
    toast(T('added'));
  } catch (e) {
    S.adding = null; render();
    toast(T(e?.name === 'QuotaExceededError' ? 'full' : e?.name === 'TooNew' ? 'tooNew' : 'addFail'));
  }
}

function closeMine() {
  if (!S.mine) return;
  for (const u of Object.values(S.mine.urls || {})) URL.revokeObjectURL(u);
  S.mine = null;
}
async function loadMine(id) {
  if (S.mine?.id === id) return;
  closeMine();
  S.mine = { id, loading: true }; render();
  try {
    const rec = await Shelf.get(id);
    if (S.mine?.id !== id) return;
    if (!rec) { S.mine = { id, gone: true }; return render(); }
    const urls = {};
    await Promise.all(Shelf.picturePaths(rec.book).map(async p => {
      const blob = await Shelf.file(id, p);
      if (blob) urls[p] = URL.createObjectURL(blob);
    }));
    if (S.mine?.id !== id) { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); return; }
    rec.story.sort((a, b) => a.number - b.number);
    S.mine = { id, rec, urls };
    if (!rec.opened) Shelf.markOpened(id).then(loadShelf).catch(() => {});
  } catch {
    S.mine = { id, gone: true };
  }
  render();
}

// ---- Routes: #library, #shelf, #read/<id>/<page> (Library copy), #mine/<id>/<page> (shelf copy).
// Page 0 = cover. Browser Back works. ----
function parseRoute() {
  const [view, id, at] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (view === 'shelf') return { view: 'shelf' };
  if ((view === 'read' || view === 'mine') && id) return { view, id, at: Math.max(0, parseInt(at, 10) || 0) };
  return { view: 'library' };
}
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, '', '#' + hash); else location.hash = hash;
  if (replace) onRoute();
};
function onRoute() {
  const prev = S.route;
  S.route = parseRoute();
  if (S.route.view !== 'shelf') { S.selecting = false; S.picked.clear(); S.sheet = null; }
  if (S.route.view === 'read' && S.lib) loadBook(S.route.id);
  if (S.route.view === 'mine') loadMine(S.route.id); else closeMine();
  render();
  if (prev.view !== S.route.view || prev.id !== S.route.id) window.scrollTo(0, 0);
}

// ---- Icons ----
const ICON_BOOK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z"/><path d="M12 6v14"/></svg>';
const ICON_GLOBE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
const ICON_SHELF = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M2 21h20"/><rect x="4" y="5" width="4" height="16"/><rect x="9" y="3" width="4" height="18"/><path d="M14.6 6.4l3.8-1 3.4 14.6-3.8 1z"/></svg>';
const ICON_LIB = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5z"/><path d="M5 9v9M9.7 9v9M14.3 9v9M19 9v9"/><path d="M2 21h20"/></svg>';
const ICON_PEN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const ICON_READ = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z"/><path d="M12 6v14"/></svg>';
const ICON_CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 12.5l3 3 6-6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---- Screens ----
function header() {
  return `<header class="top"><button class="brand" data-act="go" data-k="library">${ICON_BOOK}<span class="bt">Book Editor</span></button>
    <button class="langbig" data-act="lang-open" aria-haspopup="dialog" aria-label="${esc(T('dispLang'))}: ${esc(UI[S.ui].name)}">${ICON_GLOBE}<span>${esc(UI[S.ui].name)}</span><span class="car" aria-hidden="true">▾</span></button></header>`;
}
function langSheet() {
  if (!S.langSheet) return '';
  return `<div class="sheetbox" data-act="lang-close"><section class="card" role="dialog" aria-modal="true" aria-labelledby="lh" data-stop="1">
    <h2 id="lh">${esc(T('dispLang'))}</h2><p>${esc(T('dispHelp'))}</p>
    <div class="langgrid">${Object.keys(UI).map(k => `<button class="langbtn" lang="${k}" aria-pressed="${k === S.ui}" data-act="ui" data-k="${k}">${esc(UI[k].name)}</button>`).join('')}</div></section></div>`;
}
function homeTabs(active) {
  const n = { shelf: S.shelf ? S.shelf.length : '', library: S.lib ? S.lib.books.length : '' };
  const tab = (k, icon) => `<button class="htab" role="tab" aria-selected="${active === k}" data-act="go" data-k="${k}">${icon}<span>${esc(T(k === 'shelf' ? 'myShelf' : 'library'))}</span>${n[k] === '' ? '' : `<span class="cnt">${n[k]}</span>`}</button>`;
  return `<div class="hometabs" role="tablist">${tab('shelf', ICON_SHELF)}${tab('library', ICON_LIB)}</div>`;
}
const problem = (key, act) => `<div class="msg ${key === 'tooNew' ? '' : 'bad'}" role="alert"><p>${esc(T(key))}</p>${act ? `<button class="btn" data-act="${act}">${esc(T('tryAgain'))}</button>` : ''}</div>`;
const sampleNote = () => S.sample ? `<p class="muted" style="margin:0">${esc(T('sample'))}</p>` : '';
const addingLabel = () => S.adding.m ? T('addingN', { n: S.adding.n, m: S.adding.m }) : T('adding');

function addButton(id, big) {
  if (S.adding?.id === id) return `<button class="btn primary ${big ? 'bigbtn' : 'addbig'}" disabled aria-busy="true">${esc(addingLabel())}</button>`;
  if (onShelf(id)) return `<button class="btn onbtn ${big ? 'bigbtn' : ''}" data-act="open-mine" data-k="${esc(id)}">${esc(T('onShelfOpen'))}</button>`;
  return big ? `<button class="btn primary bigbtn" data-act="add" data-k="${esc(id)}" ${S.adding ? 'disabled' : ''}>${ICON_PEN}${esc(T('addShelf'))}</button>`
    : `<button class="btn primary addbig" data-act="add" data-k="${esc(id)}" ${S.adding ? 'disabled' : ''}>${ICON_PEN}<span>${esc(T('addShelf'))}<small>${esc(T('addSub'))}</small></span></button>`;
}

function libraryView() {
  if (S.libError) return problem(S.libError, S.libError === 'loadFail' ? 'retry-lib' : null);
  if (!S.lib) return `<div class="loading">${esc(T('loading'))}</div>`;
  const books = S.lib.books.slice().sort((a, b) => String(b.shared).localeCompare(String(a.shared)));
  if (!books.length) return `<div class="empty"><p>${esc(T('libEmpty'))}</p></div>`;
  const card = b => {
    const title = titleOf(b.titles, b.languages, S.ui);
    return `<div class="libcard"><button class="bk" data-act="read" data-k="${esc(b.id)}">
        <span class="cov">${b.cover ? `<img src="${esc(S.libBase + b.cover)}" alt="" loading="lazy">` : ''}<span class="readtag">${ICON_READ}${esc(T('read'))}</span></span>
        <b>${esc(title)}</b><span class="libmeta">${esc((b.languages || []).map(l => langName(l, b.languageNames)).join(' · '))}</span></button>
      ${addButton(b.id, false)}</div>`;
  };
  return `<p class="intro">${esc(T('libIntro'))}</p>${sampleNote()}<div class="shelf">${books.map(card).join('')}</div>`;
}

const folderDot = i => `<span class="dot" style="background:hsl(${30 + i * 140} 45% 55%)" aria-hidden="true"></span>`;
function shelfCard(b) {
  const title = titleOf(b.titles, b.languages, S.ui), picked = S.picked.has(b.id), cover = S.covers[b.id];
  const inner = `<span class="cov">${cover ? `<img src="${esc(cover)}" alt="">` : ''}${b.opened ? '' : `<span class="badge">${esc(T('isNew'))}</span>`}${S.selecting ? `<span class="pickbox" aria-hidden="true">${picked ? '✓' : ''}</span>` : ''}</span>
    <b>${esc(title)}</b><span class="libmeta">${esc(b.opened ? T('stNone') : T('stNew'))}</span>`;
  return S.selecting ? `<button class="bk" data-act="pick" data-k="${esc(b.id)}" aria-pressed="${picked}">${inner}</button>`
    : `<button class="bk" data-act="open-mine" data-k="${esc(b.id)}">${inner}</button>`;
}
function shelfView() {
  if (!S.shelf) return `<div class="loading">${esc(T('loading'))}</div>`;
  if (S.shelfError) return problem(S.shelfError);
  if (!S.shelf.length) return `<div class="empty"><p>${esc(T('shelfEmpty'))}</p><button class="btn primary bigbtn" data-act="go" data-k="library">${ICON_LIB}${esc(T('goLibrary'))}</button></div>`;
  const byTitle = (a, b) => titleOf(a.titles, a.languages, S.ui).localeCompare(titleOf(b.titles, b.languages, S.ui), S.ui);
  const group = (f, i) => {
    const items = S.shelf.filter(b => (b.folder || '') === f).sort(byTitle), key = f || '_', open = !S.closed[key];
    if (!f && !items.length && S.selecting) return '';
    const tile = !f && !S.selecting ? `<button class="addtile" data-act="go" data-k="library"><span class="plus" aria-hidden="true">+</span>${esc(T('addFromLib'))}<small>${esc(T('addFromLibS'))}</small></button>` : '';
    const label = f ? `${folderDot(i)}${esc(f)}` : esc(T('noFolder'));
    // With no folders yet there is nothing to fold: show the books without a heading.
    if (!S.folders.length) return `<div class="shelf">${items.map(shelfCard).join('')}${tile}</div>`;
    return `<section class="fold"><button class="foldh" data-act="fold" data-k="${esc(key)}" aria-expanded="${open}"><span class="car" aria-hidden="true">${open ? '▾' : '▸'}</span>${label}<span class="n">· ${esc(T(items.length === 1 ? 'books1' : 'booksN', { n: items.length }))}</span></button>
      ${open ? `<div class="shelf">${items.map(shelfCard).join('')}${tile}</div>` : ''}</section>`;
  };
  const intro = S.selecting
    ? `<div class="introrow"><p>${esc(T('pickSome'))}</p><button class="btn bigbtn" data-act="select-off">${esc(T('done'))}</button></div>`
    : `<div class="introrow"><p>${esc(T('shelfIntro'))}</p><button class="btn bigbtn" data-act="select-on">${ICON_CHECK}${esc(T('select'))}</button></div>`;
  return `${intro}${S.folders.map(group).join('')}${group('', 0)}<p class="foot">${esc(T('keep'))}</p>`;
}
function actBar() {
  if (!S.selecting || S.route.view !== 'shelf') return '';
  const n = S.picked.size, dis = n ? '' : 'disabled';
  return `<div class="actbar"><div class="in"><span class="cnt" aria-live="polite">${esc(T(n === 0 ? 'nSel0' : n === 1 ? 'nSel1' : 'nSelN', { n }))}</span><div class="acts">
    <button class="btn" data-act="act-move" ${dis}>${esc(T('moveTo'))}…</button><button class="btn" data-act="act-soon" ${dis}>${esc(T('exportA'))}</button>
    <button class="btn" data-act="act-soon" ${dis}>${esc(T('sendBack'))}</button><button class="btn danger" data-act="act-delete" ${dis}>${esc(T('del'))}</button></div></div></div>`;
}
function shelfSheet() {
  if (S.sheet === 'move') {
    return `<div class="sheetbox" data-act="sheet-close"><section class="card" role="dialog" aria-modal="true" aria-labelledby="mh" data-stop="1">
      <div class="sheethead"><h2 id="mh">${esc(T('moveTitle'))}</h2><button class="btn" data-act="sheet-close">${esc(T('cancel'))}</button></div>
      <div class="movelist">${S.folders.map((f, i) => `<button data-act="move-to" data-k="${esc(f)}">${folderDot(i)}${esc(f)}</button>`).join('')}<button data-act="move-to" data-k="">${esc(T('noFolder'))}</button></div>
      <div class="newf"><input id="nf" maxlength="40" autocomplete="off" placeholder="${esc(T('folderPh'))}" aria-label="${esc(T('folderPh'))}"><button class="btn primary" data-act="create-folder">${esc(T('createMove'))}</button></div></section></div>`;
  }
  if (S.sheet === 'delete') {
    const n = S.picked.size;
    return `<div class="sheetbox" data-act="sheet-close"><section class="card" role="alertdialog" aria-modal="true" aria-labelledby="dh" aria-describedby="dp" data-stop="1">
      <h2 id="dh">${esc(T(n === 1 ? 'delTitle1' : 'delTitleN', { n }))}</h2><p id="dp">${esc(T('delHelp'))}</p>
      <div class="sheetacts"><button class="btn bigbtn" data-act="sheet-close">${esc(T('cancel'))}</button><button class="btn bigbtn danger-solid" data-act="del-yes">${esc(T('del'))}</button></div></section></div>`;
  }
  return '';
}

// The reader, for a Library copy (read) or a shelf copy (mine). Picture left, words right, one language at a time.
function readerBody({ id, book, story, src, back, tag, call }) {
  const langs = book.languages, m = story.length;
  let lg = S.readLang[id];
  if (!langs.includes(lg)) lg = langs.includes(S.ui) ? S.ui : langs[0];
  const at = Math.min(S.route.at, m), title = titleOf(book.titles, langs, lg);
  const img = path => path && src(path) ? `<img src="${esc(src(path))}" alt="">` : '';
  let page;
  if (at === 0) {
    page = `<div class="rpic">${img(book.pictures?.covers?.front)}</div>
      <div class="rtext" lang="${esc(lg)}"><h3>${esc(title)}</h3><p class="hint" lang="${S.ui}">${esc(T('startRead'))}</p></div>`;
  } else {
    const s = story[at - 1], P = book.pictures || {}, k = String(s.number);
    const pic = P.colour?.[k] || P.small?.[k] || P.colouring?.[k];
    const words = s.text?.[lg] || '';
    page = `<div class="rpic">${img(pic)}</div><div class="rtext" lang="${esc(lg)}">
      ${s.title?.[lg] ? `<h3>${esc(s.title[lg])}</h3>` : ''}
      ${words ? `<p>${esc(words)}</p>` : `<p class="gap" lang="${S.ui}">${esc(T('noWords'))}</p>`}
      ${at === m ? `<p class="hint" lang="${S.ui}">— ${esc(T('theEnd'))} —</p>` : ''}</div>`;
  }
  const next = at < m;
  return `<section class="card">
    <div class="rtop">${back}<h2 lang="${esc(lg)}">${esc(title)}</h2><span class="rotag">${esc(tag)}</span></div>
    ${langs.length > 1 ? `<div class="rlangs" role="group" aria-label="${esc(T('readIn'))}"><span class="lbl">${esc(T('readIn'))}</span>${langs.map(l =>
      `<button class="rlang" lang="${esc(l)}" aria-pressed="${l === lg}" data-act="rlang" data-k="${esc(l)}">${esc(langName(l, book.languageNames))}</button>`).join('')}</div>` : ''}
    <div class="rbook ${next ? 'tap' : ''}" ${next ? `data-act="rnav" data-k="${at + 1}"` : ''}>${page}</div>
    <div class="rnav"><span>${at > 0 ? `<button class="btn" data-act="rnav" data-k="${at - 1}">${esc(T('rPrev'))}</button>` : ''}</span>
      <span class="pn">${at === 0 ? esc(T('cover')) : esc(T('pageOf', { n: at, m }))}</span>
      <span>${next ? `<button class="btn primary" data-act="rnav" data-k="${at + 1}">${esc(T('rNext'))}</button>` : ''}</span></div>
  </section>${call}`;
}
function readerScreen() {
  const { id } = S.route, back = `<button class="btn bigbtn" data-act="go" data-k="library">${esc(T('backLib'))}</button>`;
  if (S.libError) return problem(S.libError, S.libError === 'loadFail' ? 'retry-lib' : null);
  if (!S.lib) return `<div class="loading">${esc(T('loading'))}</div>`;
  if (!S.lib.books.some(b => b.id === id)) return `<div class="rtop">${back}</div>${problem('notFound')}`;
  const B = S.books[id];
  if (!B || B.loading) return `<div class="rtop">${back}</div><div class="loading">${esc(T('loading'))}</div>`;
  if (B.error) return `<div class="rtop">${back}</div>${problem(B.error, B.error === 'bookFail' ? 'retry-book' : null)}`;
  const call = `<div class="rcall"><p>${esc(T(onShelf(id) ? 'onShelfMsg' : 'wantEdit'))}</p>${addButton(id, true)}</div>`;
  return readerBody({ id, book: B.book, story: B.story, src: p => B.dir + p, back, tag: T('readOnly'), call });
}
function mineScreen() {
  const { id } = S.route, M = S.mine, back = `<button class="btn bigbtn" data-act="go" data-k="shelf">${esc(T('backShelf'))}</button>`;
  if (!M || M.id !== id || M.loading) return `<div class="rtop">${back}</div><div class="loading">${esc(T('loading'))}</div>`;
  if (M.gone) return `<div class="rtop">${back}</div>${problem('notOnShelf')}`;
  const call = `<div class="rcall soft"><p>${esc(T('editSoon'))}</p></div>`;
  return readerBody({ id, book: M.rec.book, story: M.rec.story, src: p => M.urls[p], back, tag: T('onShelfTag'), call });
}

function render() {
  document.documentElement.lang = S.ui;
  const r = S.route;
  const main = r.view === 'read' ? readerScreen() : r.view === 'mine' ? mineScreen()
    : homeTabs(r.view) + (r.view === 'shelf' ? shelfView() : libraryView());
  const app = document.getElementById('app');
  app.classList.toggle('selecting', S.selecting && r.view === 'shelf');
  app.innerHTML = header() + main + actBar() + shelfSheet() + langSheet();
}
let toastTimer;
function toast(m) {
  const t = document.getElementById('toast');
  t.textContent = m; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---- Shelf actions ----
async function moveTo(folder) {
  const ids = [...S.picked];
  try {
    await Shelf.move(ids, folder);
    Object.assign(S, { sheet: null, selecting: false }); S.picked.clear();
    if (folder) delete S.closed[folder];
    await loadShelf();
    toast(folder ? T('moved', { f: folder }) : T('movedOut'));
  } catch { toast(T('saveFail')); }
}
async function deletePicked() {
  const ids = [...S.picked], n = ids.length;
  try {
    await Shelf.remove(ids);
    Object.assign(S, { sheet: null, selecting: false }); S.picked.clear();
    await loadShelf();
    toast(T(n === 1 ? 'deleted1' : 'deletedN', { n }));
  } catch { toast(T('saveFail')); }
}
function createFolder() {
  const box = document.getElementById('nf'), name = (box?.value || '').trim().replace(/\s+/g, ' ');
  if (!name) return box?.focus();
  const same = S.folders.find(f => f.toLocaleLowerCase() === name.toLocaleLowerCase());
  moveTo(same || name);
}
const closeSheet = () => { S.sheet = null; render(); document.querySelector('[data-act="select-off"]')?.focus(); };

// ---- Events ----
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  // A tap inside a sheet's card (not on a button) must not close the sheet.
  if ((b.dataset.act === 'lang-close' || b.dataset.act === 'sheet-close') && b.classList.contains('sheetbox') && e.target.closest('[data-stop]')) return;
  const a = b.dataset.act, k = b.dataset.k;
  if (a === 'go') return go(k);
  if (a === 'read') return go(`read/${encodeURIComponent(k)}/0`);
  if (a === 'open-mine') return go(`mine/${encodeURIComponent(k)}/0`);
  if (a === 'rnav') return go(`${S.route.view}/${encodeURIComponent(S.route.id)}/${k}`, true);
  if (a === 'rlang') { S.readLang[S.route.id] = k; return render(); }
  if (a === 'add') return addBook(k);
  if (a === 'retry-lib') return loadLibrary().then(onRoute);
  if (a === 'retry-book') { delete S.books[S.route.id]; return loadBook(S.route.id); }
  if (a === 'lang-open') { S.langSheet = true; render(); return document.querySelector('.langbtn[aria-pressed="true"]')?.focus(); }
  if (a === 'lang-close') { S.langSheet = false; render(); return document.querySelector('.langbig')?.focus(); }
  if (a === 'ui') { S.ui = k; store.set('be.ui', k); S.langSheet = false; render(); return document.querySelector('.langbig')?.focus(); }
  if (a === 'fold') { S.closed[k] = !S.closed[k]; return render(); }
  if (a === 'select-on') { S.selecting = true; S.picked.clear(); return render(); }
  if (a === 'select-off') { S.selecting = false; S.picked.clear(); return render(); }
  if (a === 'pick') { S.picked.has(k) ? S.picked.delete(k) : S.picked.add(k); render(); return document.querySelector(`.bk[data-k="${CSS.escape(k)}"]`)?.focus(); }
  if (a === 'act-move') { S.sheet = 'move'; render(); return document.querySelector('.movelist button')?.focus(); }
  if (a === 'act-delete') { S.sheet = 'delete'; render(); return document.querySelector('.sheetacts .btn')?.focus(); }
  if (a === 'act-soon') return toast(T('soonAct'));
  if (a === 'sheet-close') return closeSheet();
  if (a === 'move-to') return moveTo(k);
  if (a === 'create-folder') return createFolder();
  if (a === 'del-yes') return deletePicked();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.langSheet) { S.langSheet = false; render(); return; }
  if (e.key === 'Escape' && S.sheet) return closeSheet();
  if (e.key === 'Enter' && e.target.id === 'nf') { e.preventDefault(); return createFolder(); }
  if ((S.route.view !== 'read' && S.route.view !== 'mine') || S.langSheet || e.target.matches('input,textarea,select')) return;
  const story = S.route.view === 'read' ? S.books[S.route.id]?.story : S.mine?.rec?.story;
  if (!story) return;
  const at = Math.min(S.route.at, story.length), base = `${S.route.view}/${encodeURIComponent(S.route.id)}/`;
  if (e.key === 'ArrowRight' && at < story.length) go(base + (at + 1), true);
  else if (e.key === 'ArrowLeft' && at > 0) go(base + (at - 1), true);
});
window.addEventListener('hashchange', onRoute);

S.route = parseRoute();
render();
loadShelf();
loadLibrary().then(onRoute);
