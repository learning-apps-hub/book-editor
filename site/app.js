// Book Editor — app shell: display language, My shelf / Library tabs, read-only reader (step 3);
// My shelf in this browser's storage, Select → Move to / Delete (step 4);
// a shelf book's Story: scene list, words edited in place, comments, autosave (step 5).
// File formats: docs/book-file-format.md. No build step; plain ES modules.
import { UI, langName } from './i18n.js';
import * as Shelf from './shelf.js';
import * as Work from './work.js';

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
  // Story (a shelf book being edited)
  view: {}, scene: {},                                         // id -> story language shown ('all' = every one) / last scene
  sel: null,                                                   // { n, lang, start, end } words last selected in a story box
  compose: null,                                               // { n, lang?, quote?, position?, draft } comment being written
  delC: null, redo: null,                                      // comment id asking "Delete?" / words to put back after Undo
  dirty: false, save: '', saveFailed: false,                   // save: '' | 'saving' | 'saved' | 'fail'
  composing: false, renderLater: false, fromBook: false,
  name: '', nameSheet: false,                                  // the reader's name, shown to the author on changes + comments
  reply: null, editC: null, showResolved: false,               // { id, draft } / { k: id or id/replyId, draft }
};
S.name = store.get('be.name') || '';
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
  if (onShelf(id)) return go(bookHash(id));
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
  flushSave();
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

// ---- Routes: #library, #shelf, #read/<id>/<page> (Library copy), #mine/<id>/<page> (shelf copy, read),
// #book/<id>/story/<scene> and #book/<id>/layout (shelf copy, edit). Page 0 = cover. Browser Back works. ----
function parseRoute() {
  const [view, id, at, n] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (view === 'shelf') return { view: 'shelf' };
  if (view === 'book' && id) return at === 'layout' ? { view, id, tab: 'layout' } : { view, id, tab: 'story', n: Math.max(1, parseInt(n, 10) || 1) };
  if ((view === 'read' || view === 'mine') && id) return { view, id, at: Math.max(0, parseInt(at, 10) || 0) };
  return { view: 'library' };
}
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, '', '#' + hash); else location.hash = hash;
  if (replace) onRoute();
};
function onRoute() {
  const prev = S.route, r = S.route = parseRoute();
  if (r.view !== 'shelf') { S.selecting = false; S.picked.clear(); S.sheet = null; }
  if (prev.view === 'book' && (r.view !== 'book' || r.id !== prev.id || r.n !== prev.n || r.tab !== prev.tab)) {
    flushSave();
    Object.assign(S, { compose: null, sel: null, delC: null, redo: null, reply: null, editC: null });
  }
  if (r.view !== 'mine') S.fromBook = false;
  if (r.view === 'book' && r.tab === 'story') S.scene[r.id] = r.n;
  if (r.view === 'book' && !S.name) S.nameSheet = true;
  if (r.view !== 'book') S.nameSheet = false;
  if (r.view === 'read' && S.lib) loadBook(r.id);
  if (r.view === 'mine' || r.view === 'book') loadMine(r.id); else closeMine();
  render();
  if (prev.view !== r.view || prev.id !== r.id || prev.n !== r.n || prev.tab !== r.tab) window.scrollTo(0, 0);
}
const bookHash = (id, n) => `book/${encodeURIComponent(id)}/story/${n || S.scene[id] || 1}`;

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
    <b>${esc(title)}</b><span class="libmeta">${esc(!b.opened ? T('stNew') : countText(Work.counts(b)) || T('stNone'))}</span>`;
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
// The reader's own copy, read with their changed words in it. Back returns to editing.
function mineScreen() {
  const { id } = S.route, M = S.mine, back = `<button class="btn bigbtn" data-act="back-edit">${esc(T('backEdit'))}</button>`;
  if (!M || M.id !== id || M.loading) return `<div class="rtop">${back}</div><div class="loading">${esc(T('loading'))}</div>`;
  if (M.gone) return `<div class="rtop">${back}</div>${problem('notOnShelf')}`;
  return readerBody({ id, book: M.rec.book, story: Work.appliedStory(M.rec), src: p => M.urls[p], back, tag: T('onShelfTag'), call: '' });
}

// ---- A shelf book: top bar, Story / Layout steps ----
const ICON_CM = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const ICON_CM_S = ICON_CM.replace(/width="20" height="20"/, 'width="14" height="14"');
const ICON_EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function countText({ c, n }) {
  return [c && T(c === 1 ? 'chg1' : 'chgN', { n: c }), n && T(n === 1 ? 'cm1' : 'cmN', { n })].filter(Boolean).join(', ');
}
function statusBox(rec) {
  const k = Work.counts(rec);
  return k.c + k.n
    ? `<div class="status todo" id="stbox"><b>${esc(T('notSent'))}</b><span>${esc(countText(k))} · ${esc(T('keptHere'))}</span>${whoAmI()}</div>`
    : `<div class="status ok" id="stbox"><b>${esc(T('noChg'))}</b><span>${esc(T('noChgT'))}</span>${whoAmI()}</div>`;
}
const whoAmI = () => S.name ? `<span class="whoami">${esc(T('you', { name: S.name }))}<button class="btn quiet" data-act="name-open">${esc(T('changeName'))}</button></span>` : '';
const when = iso => { try { return new Intl.DateTimeFormat(S.ui, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return ''; } };
const byLine = (by, at, edited) => `<b>${esc(by || T('someone'))}</b><span>${esc(when(at))}${edited ? ` · ${esc(T('editedT'))}` : ''}</span>`;
function nameSheet() {
  if (!S.nameSheet) return '';
  return `<div class="sheetbox" data-act="name-close"><section class="card" role="dialog" aria-modal="true" aria-labelledby="nh" data-stop="1">
    <h2 id="nh">${esc(T('nameTitle'))}</h2><p>${esc(T('nameHelp'))}</p>
    <div class="newf"><input id="nm" maxlength="40" autocomplete="name" value="${esc(S.name)}" placeholder="${esc(T('nameTitle'))}" aria-label="${esc(T('nameTitle'))}">
      <button class="btn primary" data-act="name-save">${esc(T('save'))}</button></div></section></div>`;
}
const saveText = () => S.save === 'saving' ? T('saving') : S.save === 'saved' ? T('saved') : S.save === 'fail' ? T('notSaved') : '';
const viewOf = (id, langs) => {
  const v = S.view[id];
  return v === 'all' || langs.includes(v) ? v : langs.includes(S.ui) ? S.ui : langs[0];
};

function bookScreen() {
  const { id } = S.route, M = S.mine, back = `<button class="btn bigbtn" data-act="go" data-k="shelf">${esc(T('backShelf'))}</button>`;
  if (!M || M.id !== id || M.loading) return `<div class="rtop">${back}</div><div class="loading">${esc(T('loading'))}</div>`;
  if (M.gone) return `<div class="rtop">${back}</div>${problem('notOnShelf')}`;
  const rec = M.rec, book = rec.book, tl = book.titles?.[S.ui] ? S.ui : book.languages[0];
  const k = Work.counts(rec), story = S.route.tab === 'story';
  const step = (key, icon, sub, subId) => `<button class="step" role="tab" aria-selected="${S.route.tab === key}" data-act="tab" data-k="${key}"><span class="ic">${icon}</span>
    <span class="st"><b>${esc(T(key))}</b><span${subId ? ` id="${subId}"` : ''}>${esc(sub)}</span></span></button>`;
  return `<div class="rtop">${back}<h2 lang="${esc(tl)}">${esc(titleOf(book.titles, book.languages, S.ui))}</h2>
      <button class="btn bigbtn" data-act="read-mine">${ICON_READ}${esc(T('read'))}</button></div>
    ${statusBox(rec)}
    <div class="steps" role="tablist">${step('story', ICON_PEN, k.c + k.n ? countText(k) : T('storySub'), 'storysub')}${step('layout', ICON_EYE, T('layoutSub'))}</div>
    ${story ? storyView(rec) : `<section class="card"><div class="msg"><p>${esc(T('layoutSoon'))}</p></div></section>`}`;
}

// Track changes: each changed field shows the book's words with the reader's changes marked in them
// (added words underlined, removed words struck through), with who changed it and when.
const diffHtml = (was, now) => Work.diff(was, now).map(d => d.t === 'ins' ? `<ins>${esc(d.s)}</ins>` : d.t === 'del' ? `<del>${esc(d.s)}</del>` : esc(d.s)).join('');
function chgHtml(rec, n, l) {
  const fields = Work.FIELDS.filter(f => Work.isChanged(rec, n, f, l));
  if (fields.length) {
    return `<div class="tc"><div class="tchead"><span class="edited">✎ ${esc(T('changed'))}</span><button class="btn quiet" data-act="undo-lang" data-k="${esc(l)}">${esc(T('undoHere'))}</button></div>
      ${fields.map(f => { const w = Work.editInfo(rec, n, f, l) || {};
        return `<div class="tcf"><div class="cmmeta"><span class="flbl">${esc(T(f === 'title' ? 'fTitle' : 'fText'))}</span>${byLine(w.by, w.at)}</div>
          <div class="diff ${f}" lang="${esc(l)}">${diffHtml(Work.bookValue(rec, n, f, l), Work.value(rec, n, f, l))}</div></div>`; }).join('')}</div>`;
  }
  if (S.redo && S.redo.n === n && S.redo.lang === l) return `<button class="btn quiet" data-act="redo-lang" data-k="${esc(l)}">${esc(T('redoHere'))}</button>`;
  return '';
}
const quoteChip = (c, act) => c.quote
  ? (act ? `<button class="cmq" data-act="show-comment" data-k="${esc(c.id)}" lang="${esc(c.lang)}">“${esc(c.quote)}”</button>` : `<span class="cmq" lang="${esc(c.lang)}">“${esc(c.quote)}”</span>`)
  : `<span class="cmq whole">${esc(T('wholeScene'))}</span>`;

function storyView(rec) {
  const id = rec.id, book = rec.book, langs = book.languages, story = rec.story, m = story.length, urls = S.mine.urls;
  const n = Math.min(S.route.n, m), view = viewOf(id, langs), all = view === 'all', shown = all ? langs : [view];
  const tl = all ? (langs.includes(S.ui) ? S.ui : langs[0]) : view, P = book.pictures || {};
  const thumb = k => { const p = P.colour?.[k] || P.small?.[k] || P.colouring?.[k]; return p && urls[p] ? `<img src="${esc(urls[p])}" alt="">` : ''; };
  const sceneTitle = x => Work.value(rec, x, 'title', tl);
  const toc = `<nav class="toc" aria-labelledby="toch"><div class="lbl" id="toch">${esc(T('scenes'))}</div>${story.map(s => {
    const x = s.number, cc = Work.openComments(rec, x).length;
    return `<button data-act="scene" data-k="${x}" aria-current="${x === n}"><span class="th">${thumb(String(x))}</span><span class="num">${x}</span>
      <span class="tt" id="tt-${x}" lang="${esc(tl)}">${esc(sceneTitle(x))}</span>
      <span class="marks"><span class="edited" id="tm-${x}" title="${esc(T('changed'))}" ${Work.sceneChanged(rec, x) ? '' : 'hidden'}>✎</span>${cc ? `<span class="cmc" title="${esc(T(cc === 1 ? 'cm1' : 'cmN', { n: cc }))}">${ICON_CM_S}${cc}</span>` : ''}</span></button>`;
  }).join('')}</nav>`;
  const mob = `<select class="scenesel" id="at" aria-label="${esc(T('scenes'))}">${story.map(s =>
    `<option value="${s.number}" id="op-${s.number}" ${s.number === n ? 'selected' : ''}>${esc(T('sceneN', { n: s.number }))} · ${esc(sceneTitle(s.number))}${Work.sceneChanged(rec, s.number) ? ' ✎' : ''}</option>`).join('')}</select>`;
  const seg = langs.length > 1 ? `<div class="seg" role="group" aria-label="${esc(T('showLang'))}">${langs.map(l =>
    `<button lang="${esc(l)}" aria-pressed="${l === view}" data-act="view" data-k="${esc(l)}">${esc(langName(l, book.languageNames))}</button>`).join('')}
    <button aria-pressed="${all}" data-act="view" data-k="all">${esc(T('allLangs'))}</button></div>` : '<span></span>';
  const ro = S.name ? '' : 'readonly data-act="need-name"';
  const block = l => {
    const tid = `t-${n}-${l}`, xid = `x-${n}-${l}`, on = Work.isChanged(rec, n, 'title', l) || Work.isChanged(rec, n, 'text', l);
    return `<div class="langblock">${all ? `<div class="lname" lang="${esc(l)}">${esc(langName(l, book.languageNames))}</div>` : ''}
      <label class="flbl" for="${tid}">${esc(T('fTitle'))}</label>
      <input class="titlein" id="${tid}" data-f="title" data-l="${esc(l)}" data-n="${n}" lang="${esc(l)}" autocomplete="off" ${ro} value="${esc(Work.value(rec, n, 'title', l))}">
      <label class="flbl" for="${xid}">${esc(T('fText'))}</label>
      <textarea class="textin ${all ? 'short' : ''}" id="${xid}" data-f="text" data-l="${esc(l)}" data-n="${n}" lang="${esc(l)}" ${ro}>${esc(Work.value(rec, n, 'text', l))}</textarea>
      <div class="chg" id="chg-${esc(l)}" data-on="${on}">${chgHtml(rec, n, l)}</div></div>`;
  };
  const nav = `<div class="spnav"><span>${n > 1 ? `<button class="btn bigbtn" data-act="scene" data-k="${n - 1}">${esc(T('prevScene', { n: n - 1 }))}</button>` : ''}</span>
    <span>${n < m ? `<button class="btn primary bigbtn" data-act="scene" data-k="${n + 1}">${esc(T('nextScene', { n: n + 1 }))}</button>` : ''}</span></div>`;
  const cms = Work.openComments(rec, n), done = Work.sceneComments(rec, n).filter(c => c.resolved), C = S.compose?.n === n ? S.compose : null;
  const composer = C ? `<div class="composer">${quoteChip(C)}<label class="flbl" for="cmtext">${esc(T('yourComment'))}</label>
      <textarea id="cmtext">${esc(C.draft || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="save-comment">${esc(T('save'))}</button><button class="btn" data-act="cancel-comment">${esc(T('cancel'))}</button></div></div>` : '';
  const own = by => !!by && by === S.name;
  const editBox = k => `<label class="flbl" for="ced">${esc(T('edit'))}</label><textarea id="ced">${esc(S.editC.draft)}</textarea>
    <div class="row"><button class="btn primary" data-act="edit-save">${esc(T('save'))}</button><button class="btn" data-act="edit-cancel">${esc(T('cancel'))}</button></div>`;
  const ask = (k, q) => `<div class="row delask"><b>${esc(T(q))}</b><button class="btn danger-solid" data-act="del-c-yes" data-k="${esc(k)}">${esc(T('del'))}</button><button class="btn" data-act="del-c-no">${esc(T('keepIt'))}</button></div>`;
  const ownActs = (k, by) => own(by) ? `<button class="btn quiet" data-act="edit-c" data-k="${esc(k)}">${esc(T('edit'))}</button><button class="btn quiet del-c" data-act="del-comment" data-k="${esc(k)}">${esc(T('del'))}</button>` : '';
  const reply = (c, r) => { const k = `${c.id}/${r.id}`;
    return `<div class="rp"><div class="cmmeta">${byLine(r.by, r.made, r.edited)}</div>
      ${S.editC?.k === k ? editBox(k) : `<p>${esc(r.text)}</p>`}
      ${S.delC === k ? ask(k, 'delR') : S.editC?.k === k || c.resolved ? '' : `<div class="row cmacts">${ownActs(k, r.by)}</div>`}</div>`; };
  const card = c => `<div class="cm ${c.resolved ? 'isdone' : ''}" id="cm-${esc(c.id)}"><div class="cmmeta">${byLine(c.by, c.made, c.edited)}</div>
      <div class="cmtop">${quoteChip(c, !c.resolved)}${c.quote ? `<span class="cml">${esc(langName(c.lang, book.languageNames))}</span>` : ''}</div>
      ${S.editC?.k === c.id ? editBox(c.id) : `<p>${esc(c.text)}</p>`}
      ${(c.replies || []).map(r => reply(c, r)).join('')}
      ${S.reply?.id === c.id ? `<div class="rp"><label class="flbl" for="rptext">${esc(T('yourReply'))}</label><textarea id="rptext">${esc(S.reply.draft || '')}</textarea>
        <div class="row"><button class="btn primary" data-act="reply-save">${esc(T('reply'))}</button><button class="btn" data-act="reply-cancel">${esc(T('cancel'))}</button></div></div>` : ''}
      ${c.resolved ? `<div class="row cmacts"><span class="cml">${esc(T('resolvedBy', { name: c.resolved.by || T('someone'), t: when(c.resolved.at) }))}</span><button class="btn quiet" data-act="reopen" data-k="${esc(c.id)}">${esc(T('reopen'))}</button></div>`
        : S.delC === c.id ? ask(c.id, 'delC')
        : S.editC?.k === c.id || S.reply?.id === c.id ? ''
        : `<div class="row cmacts"><button class="btn quiet" data-act="reply" data-k="${esc(c.id)}">${esc(T('reply'))}</button><button class="btn quiet" data-act="resolve" data-k="${esc(c.id)}">✓ ${esc(T('resolve'))}</button>${ownActs(c.id, c.by)}</div>`}</div>`;
  const list = cms.map(card).join('') + (done.length ? `<button class="btn quiet resbtn" data-act="toggle-resolved" aria-expanded="${S.showResolved}">${S.showResolved ? '▾' : '▸'} ${esc(T('resolvedN', { n: done.length }))}</button>${S.showResolved ? done.map(card).join('') : ''}` : '');
  return `<div class="three">${toc}
    <section class="card scenecard">${mob}
      <div class="scenehead"><span class="lbl">${esc(T('sceneOf', { n, m }))}</span><span class="savest ${S.save === 'fail' ? 'bad' : ''}" id="savest" aria-live="polite">${esc(saveText())}</span></div>
      <div class="row between">${seg}<button class="btn" data-act="comment">${ICON_CM}${esc(T('comment'))}</button></div>
      ${shown.map(block).join('')}${nav}</section>
    <aside class="cmside" aria-labelledby="cmh"><h3 class="lbl" id="cmh">${esc(T('commentsOn'))}</h3>${composer}${cms.length || C ? '' : `<div class="emptyc">${esc(T('noComments'))}</div>`}${list}</aside></div>`;
}

// While typing nothing is re-rendered (that would break typing and Chinese input): only the marks around the boxes change.
function refreshMarks() {
  const M = S.mine, r = S.route;
  if (!M?.rec || r.view !== 'book' || M.id !== r.id) return;
  const rec = M.rec, n = r.n, langs = rec.book.languages, view = viewOf(rec.id, langs);
  const tl = view === 'all' ? (langs.includes(S.ui) ? S.ui : langs[0]) : view;
  const st = document.getElementById('stbox');
  if (st) st.outerHTML = statusBox(rec);
  const k = Work.counts(rec), sub = document.getElementById('storysub');
  if (sub) sub.textContent = k.c + k.n ? countText(k) : T('storySub');
  const ch = Work.sceneChanged(rec, n), title = Work.value(rec, n, 'title', tl);
  const tm = document.getElementById(`tm-${n}`); if (tm) tm.hidden = !ch;
  const tt = document.getElementById(`tt-${n}`); if (tt) tt.textContent = title;
  const op = document.getElementById(`op-${n}`); if (op) op.textContent = `${T('sceneN', { n })} · ${title}${ch ? ' ✎' : ''}`;
  for (const l of langs) {
    const box = document.getElementById(`chg-${l}`); if (!box) continue;
    box.dataset.on = String(Work.isChanged(rec, n, 'title', l) || Work.isChanged(rec, n, 'text', l));
    box.innerHTML = chgHtml(rec, n, l);
  }
}
let marksTimer;
const scheduleMarks = () => { clearTimeout(marksTimer); marksTimer = setTimeout(refreshMarks, 150); };

// The reader's name: asked once per device, changeable (a shared tablet: each person types their own).
function saveName() {
  const box = document.getElementById('nm'), name = (box?.value || '').trim().replace(/\s+/g, ' ');
  if (!name) return box?.focus();
  S.name = name; store.set('be.name', name); S.nameSheet = false; render();
}

// ---- Autosave: a short pause after typing, and at once when leaving the book or the page ----
let saveTimer;
function setSave(st) {
  S.save = st;
  const el = document.getElementById('savest');
  if (el) { el.textContent = saveText(); el.classList.toggle('bad', st === 'fail'); }
}
function queueSave() {
  S.dirty = true; S.redo = null; setSave('saving');
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 600);
}
function flushSave() {
  clearTimeout(saveTimer);
  const M = S.mine;
  if (!M?.rec || !S.dirty) return;
  S.dirty = false;
  const { id, rec } = M, edits = { ...(rec.edits || {}) }, editBy = structuredClone(rec.editBy || {}), comments = structuredClone(rec.comments || []);
  Shelf.saveWork(id, edits, comments, editBy).then(changed => {
    const b = S.shelf?.find(x => x.id === id);
    if (b) Object.assign(b, { edits, editBy, comments, changed });
    S.saveFailed = false;
    if (S.mine?.id === id && !S.dirty) setSave('saved');
  }).catch(e => {
    if (S.mine?.id === id) { S.dirty = true; setSave('fail'); }
    if (!S.saveFailed) toast(T(e?.name === 'QuotaExceededError' ? 'full' : 'notSaved'));
    S.saveFailed = true;
  });
}

function render() {
  // Never rebuild the page in the middle of Chinese/Japanese/Korean typing: wait for the word to finish.
  if (S.composing) { S.renderLater = true; return; }
  document.documentElement.lang = S.ui;
  const r = S.route;
  const main = r.view === 'read' ? readerScreen() : r.view === 'mine' ? mineScreen() : r.view === 'book' ? bookScreen()
    : homeTabs(r.view) + (r.view === 'shelf' ? shelfView() : libraryView());
  const app = document.getElementById('app');
  // Keep the box being typed in: same element id → same focus, cursor, selection and scroll.
  const f = document.activeElement, keep = f?.id && app.contains(f)
    ? { id: f.id, s: f.selectionStart, e: f.selectionEnd, d: f.selectionDirection, top: f.scrollTop } : null;
  app.classList.toggle('selecting', S.selecting && r.view === 'shelf');
  app.innerHTML = header() + main + actBar() + shelfSheet() + nameSheet() + langSheet();
  const el = keep && document.getElementById(keep.id);
  if (el) {
    el.focus({ preventScroll: true });
    if (typeof keep.s === 'number' && el.setSelectionRange) try { el.setSelectionRange(keep.s, keep.e, keep.d || 'none'); } catch { /* not a text box */ }
    el.scrollTop = keep.top;
  }
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
  if (['lang-close', 'sheet-close', 'name-close'].includes(b.dataset.act) && b.classList.contains('sheetbox') && e.target.closest('[data-stop]')) return;
  const a = b.dataset.act, k = b.dataset.k;
  if (a === 'go') return go(k);
  if (a === 'read') return go(`read/${encodeURIComponent(k)}/0`);
  if (a === 'open-mine') return go(bookHash(k));
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
  return storyClick(a, k);
});

// ---- Story actions ----
function storyClick(a, k) {
  const M = S.mine, r = S.route;
  if (!M?.rec || r.view === 'shelf' || r.view === 'library') return;
  const rec = M.rec, id = rec.id, n = r.n;
  const needName = () => { if (S.name) return false; S.nameSheet = true; render(); document.getElementById('nm')?.focus(); return true; };
  const findC = k => { const [cid, rid] = String(k).split('/'), c = (rec.comments || []).find(x => x.id === cid); return { c, r: rid ? c?.replies?.find(x => x.id === rid) : null, rid }; };
  const focusId = id2 => { const el = document.getElementById(id2); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (a === 'name-open' || a === 'need-name') { if (a === 'need-name' && S.name) return; S.nameSheet = true; render(); return document.getElementById('nm')?.focus(); }
  if (a === 'name-close') { S.nameSheet = false; return render(); }
  if (a === 'name-save') return saveName();
  if (a === 'reply') { if (needName()) return; S.reply = { id: k, draft: '' }; render(); return focusId('rptext'); }
  if (a === 'reply-cancel') { S.reply = null; return render(); }
  if (a === 'reply-save') {
    const text = (document.getElementById('rptext')?.value || '').trim(), { c } = findC(S.reply.id);
    if (!text) return document.getElementById('rptext')?.focus();
    if (c) { c.replies = [...(c.replies || []), Work.newReply(text, S.name)]; queueSave(); }
    S.reply = null; return render();
  }
  if (a === 'resolve' || a === 'reopen') {
    if (a === 'resolve' && needName()) return;
    const { c } = findC(k); if (!c) return;
    if (a === 'resolve') c.resolved = { by: S.name, at: new Date().toISOString() }; else delete c.resolved;
    queueSave(); return render();
  }
  if (a === 'toggle-resolved') { S.showResolved = !S.showResolved; return render(); }
  if (a === 'edit-c') { const { c, r: rp } = findC(k); S.editC = { k, draft: (rp || c)?.text || '' }; render(); return focusId('ced'); }
  if (a === 'edit-cancel') { S.editC = null; return render(); }
  if (a === 'edit-save') {
    const text = (document.getElementById('ced')?.value || '').trim(), { c, r: rp, rid } = findC(S.editC.k), it = rid ? rp : c;
    if (!text) return document.getElementById('ced')?.focus();
    if (it && it.text !== text) { it.text = text; it.edited = new Date().toISOString(); queueSave(); }
    S.editC = null; return render();
  }
  if (a === 'read-mine') { S.fromBook = true; return go(`mine/${encodeURIComponent(id)}/${r.tab === 'story' ? n : 0}`); }
  if (a === 'back-edit') {
    if (S.fromBook) return history.back();
    return go(bookHash(id, S.route.at || undefined), true);
  }
  if (a === 'tab') return go(k === 'layout' ? `book/${encodeURIComponent(id)}/layout` : bookHash(id), true);
  if (a === 'scene') return go(bookHash(id, +k), true);
  if (a === 'view') { S.view[id] = k; S.sel = null; return render(); }
  if (a === 'undo-lang') {
    const keepWords = Object.fromEntries(Work.FIELDS.map(f => [f, Work.value(rec, n, f, k)]));
    const keepInfo = Object.fromEntries(Work.FIELDS.map(f => [f, Work.editInfo(rec, n, f, k)]));
    Work.undo(rec, n, k); queueSave(); S.redo = { n, lang: k, words: keepWords, info: keepInfo }; return render();
  }
  if (a === 'redo-lang' && S.redo) {
    const { words, info } = S.redo;
    for (const f of Work.FIELDS) { Work.setValue(rec, n, f, k, words[f], S.name); Work.setEditInfo(rec, n, f, k, info[f]); }
    queueSave(); return render();
  }
  if (a === 'comment') {
    if (needName()) return;
    const sel = S.sel, t = sel && sel.n === n && sel.end > sel.start ? Work.value(rec, n, 'text', sel.lang) : '';
    let start = sel?.start, end = sel?.end;
    if (t) { while (start < end && /\s/.test(t[start])) start++; while (end > start && /\s/.test(t[end - 1])) end--; }
    S.compose = t && end > start ? { n, lang: sel.lang, quote: t.slice(start, end), position: start, draft: S.compose?.draft || '' }
      : { n, draft: S.compose?.draft || '' };
    render();
    const box = document.getElementById('cmtext');
    box?.focus({ preventScroll: true }); box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (a === 'cancel-comment') { S.compose = null; return render(); }
  if (a === 'save-comment') {
    const box = document.getElementById('cmtext'), text = (box?.value || '').trim();
    if (!text) return box?.focus();
    rec.comments = [...(rec.comments || []), Work.newComment({ spread: n, ...S.compose, text, by: S.name })];
    S.compose = null; S.sel = null; queueSave(); render();
    return document.querySelector('[data-act="comment"]')?.focus();
  }
  if (a === 'del-comment') { S.delC = k; return render(); }
  if (a === 'del-c-no') { S.delC = null; return render(); }
  if (a === 'del-c-yes') {
    const [cid, rid] = k.split('/');
    if (rid) { const { c } = findC(cid); if (c) c.replies = (c.replies || []).filter(x => x.id !== rid); }
    else rec.comments = (rec.comments || []).filter(c => c.id !== cid);
    S.delC = null; queueSave(); return render();
  }
  if (a === 'show-comment') {
    const c = (rec.comments || []).find(x => x.id === k);
    if (!c) return;
    const v = viewOf(id, rec.book.languages);
    if (v !== 'all' && v !== c.lang) { S.view[id] = c.lang; render(); }
    const ta = document.getElementById(`x-${n}-${c.lang}`);
    if (!ta) return;
    const i = Work.findQuote(ta.value, c.quote, c.position);
    ta.focus({ preventScroll: true });
    if (i >= 0) ta.setSelectionRange(i, i + c.quote.length);
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.langSheet) { S.langSheet = false; render(); return; }
  if (e.key === 'Escape' && S.compose && S.route.view === 'book') { S.compose = null; render(); return document.querySelector('[data-act="comment"]')?.focus(); }
  if (e.key === 'Escape' && S.sheet) return closeSheet();
  if (e.key === 'Enter' && e.target.id === 'nf') { e.preventDefault(); return createFolder(); }
  if (e.key === 'Enter' && e.target.id === 'nm') { e.preventDefault(); return saveName(); }
  if (e.key === 'Escape' && S.nameSheet) { S.nameSheet = false; return render(); }
  if ((S.route.view !== 'read' && S.route.view !== 'mine') || S.langSheet || e.target.matches('input,textarea,select')) return;
  const story = S.route.view === 'read' ? S.books[S.route.id]?.story : S.mine?.rec?.story;
  if (!story) return;
  const at = Math.min(S.route.at, story.length), base = `${S.route.view}/${encodeURIComponent(S.route.id)}/`;
  if (e.key === 'ArrowRight' && at < story.length) go(base + (at + 1), true);
  else if (e.key === 'ArrowLeft' && at > 0) go(base + (at - 1), true);
});
window.addEventListener('hashchange', onRoute);

// Typing: store the words at once, save after a short pause, refresh the marks; never re-render here.
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'cmtext' && S.compose) { S.compose.draft = el.value; return; }
  if (el.id === 'rptext' && S.reply) { S.reply.draft = el.value; return; }
  if (el.id === 'ced' && S.editC) { S.editC.draft = el.value; return; }
  if (!el.dataset?.f || S.route.view !== 'book' || !S.mine?.rec || !S.name) return;
  Work.setValue(S.mine.rec, +el.dataset.n, el.dataset.f, el.dataset.l, el.value, S.name);
  queueSave(); scheduleMarks();
});
document.addEventListener('change', e => {
  if (e.target.id === 'at' && S.mine?.rec) go(bookHash(S.mine.rec.id, +e.target.value), true);
});
document.addEventListener('compositionstart', () => { S.composing = true; });
document.addEventListener('compositionend', () => {
  S.composing = false;
  if (S.renderLater) { S.renderLater = false; render(); }
});
// Remember the words selected in a story box, so Comment can quote them after the box loses focus.
function trackSel() {
  const el = document.activeElement;
  if (S.route.view === 'book' && el?.dataset?.f === 'text') S.sel = { n: +el.dataset.n, lang: el.dataset.l, start: el.selectionStart, end: el.selectionEnd };
}
['selectionchange', 'select', 'keyup', 'mouseup', 'touchend'].forEach(ev => document.addEventListener(ev, trackSel));
// Leaving the page (closing the tab, switching app on a phone): save now.
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

S.route = parseRoute();
render();
loadShelf();
loadLibrary().then(onRoute);
