// Book Editor — app shell: display language, My shelf / Library tabs, read-only reader (step 3);
// My shelf in this browser's storage, Select → Move to / Delete (step 4);
// a shelf book's Story: scene list, the story shown once with changes and comments marked in it, select words → Comment / Replace, autosave (step 5);
// the reader's identity: picture + colour + optional nickname, also their highlighter (identity.js).
// File formats: docs/book-file-format.md. No build step; plain ES modules.
import { UI, langName } from './i18n.js';
import * as Shelf from './shelf.js';
import * as Work from './work.js';
import * as Id from './identity.js';

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
  pop: null,                                                   // { n, f, l, start, end, quote, draft, top } words selected in the story
  compose: null,                                               // { n, lang?, quote?, position?, draft } comment being written
  delC: null, redo: null,                                      // comment id asking "Delete?" / words to put back after Undo
  dirty: false, save: '', saveFailed: false,                   // save: '' | 'saving' | 'saved' | 'fail'
  composing: false, renderLater: false, fromBook: false,
  me: null, nameSheet: false, idDraft: null,                  // the reader's identity (identity.js) / the sheet choosing it
  reply: null, editC: null, showResolved: false,               // { id, draft } / { k: id or id/replyId, draft }
};
S.me = Id.load(store);
const OLD_NAME = store.get('be.name') || '';                   // a name typed before identities (2026-11-11)
const T = (k, v = {}) => String(UI[S.ui][k] ?? UI.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x]);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Th = (k, v = {}) => esc(String(UI[S.ui][k] ?? UI.en[k] ?? k)).replace(/\{(\w+)\}/g, (_, x) => v[x]);   // values are HTML
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
    Object.assign(S, { compose: null, pop: null, delC: null, redo: null, reply: null, editC: null });
  }
  if (r.view !== 'mine') S.fromBook = false;
  if (r.view === 'book' && r.tab === 'story') S.scene[r.id] = r.n;
  if (r.view === 'book' && !S.me && !S.nameSheet) openId();
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
const whoAmI = () => S.me ? `<span class="whoami">${Th('you', { name: chip(S.me) })}<button class="btn quiet" data-act="name-open">${esc(T('changeName'))}</button></span>` : '';
const when = iso => { try { return new Intl.DateTimeFormat(S.ui, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return ''; } };
// Who: an avatar (picture on the person's colour) + nickname if any. Older data: a typed name.
const colourOf = by => { const w = Id.resolve(by, S.me); return w && typeof w === 'object' && Id.COLOURS.includes(w.colour) ? w.colour : ''; };
const hl = by => colourOf(by) ? ` style="--c:${colourOf(by)}"` : '';
function chip(by) {
  const w = Id.resolve(by, S.me);
  if (!w) return `<b class="who">${esc(T('someone'))}</b>`;
  if (typeof w === 'string') return `<span class="who"><span class="av plain" aria-hidden="true">${esc([...w][0].toLocaleUpperCase())}</span><b>${esc(w)}</b></span>`;
  const c = Id.COLOURS.includes(w.colour) ? w.colour : '#8B8D98', sym = Id.SYMBOLS.includes(w.symbol) ? w.symbol : '?';
  return `<span class="who" style="--c:${c}"><span class="av" role="img" aria-label="${esc(w.nick || T('aReader'))}">${sym}</span>${w.nick ? `<b>${esc(w.nick)}</b>` : ''}</span>`;
}
const byLine = (by, at, edited) => `${chip(by)}<span>${esc(when(at))}${edited ? ` · ${esc(T('editedT'))}` : ''}</span>`;
function openId() {
  S.idDraft = S.me ? { ...S.me } : { symbol: '', colour: '', nick: OLD_NAME.slice(0, Id.NICK_MAX) };
  S.nameSheet = true;
}
function nameSheet() {
  if (!S.nameSheet || !S.idDraft) return '';
  const D = S.idDraft, ok = Id.SYMBOLS.includes(D.symbol) && Id.COLOURS.includes(D.colour), names = T('colourNames').split('|');
  const prev = ok ? chip({ ...D, nick: D.nick?.trim() }) : `<span class="who"><span class="av empty" aria-hidden="true">?</span></span>`;
  return `<div class="sheetbox idbox" data-act="name-close"><section class="card idcard" role="dialog" aria-modal="true" aria-labelledby="nh" data-stop="1">
    <div class="sheethead"><h2 id="nh">${esc(T('idTitle'))}</h2><span class="idprev"${D.colour ? ` style="--c:${D.colour}"` : ''}>${prev}</span></div>
    <p>${esc(T('idHelp'))}</p>
    <div class="flbl" id="idp">${esc(T('idPic'))}</div>
    <div class="symgrid" role="group" aria-labelledby="idp">${Id.SYMBOLS.map(x => `<button class="symbtn" data-act="id-sym" data-k="${x}" aria-pressed="${x === D.symbol}"${D.colour ? ` style="--c:${D.colour}"` : ''}>${x}</button>`).join('')}</div>
    <div class="flbl" id="idc">${esc(T('idColour'))}</div>
    <div class="colgrid" role="group" aria-labelledby="idc">${Id.COLOURS.map((c, i) => `<button class="colbtn" data-act="id-col" data-k="${c}" style="--c:${c}" aria-pressed="${c === D.colour}" aria-label="${esc(names[i] || c)}"></button>`).join('')}</div>
    <label class="flbl" for="nm">${esc(T('idNick'))}</label>
    <input id="nm" class="nickin" maxlength="${Id.NICK_MAX}" autocomplete="nickname" value="${esc(D.nick || '')}">
    <div class="sheetacts"><button class="btn bigbtn" data-act="name-close">${esc(T(S.me ? 'cancel' : 'later'))}</button><button class="btn primary bigbtn" data-act="name-save" ${ok ? '' : 'disabled'}>${esc(T('save'))}</button></div></section></div>`;
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

// The story is shown once, as page text (no typing boxes). The reader's changed words are marked in the colour
// of whoever changed them, commented words in amber. Selecting words opens a pop-up: Comment on them, or Replace them.
// Removed words leave no gap in the text; they show struck through in the change's note at the side.
const chKey = (f, l, i) => `${f}|${l}|${i}`;
const chId = (f, l, i) => `ch-${f}-${l}-${i}`.replace(/[^\w-]/g, '_');
function markedHtml(rec, n, f, l) {
  const text = Work.value(rec, n, f, l), E = new Array(text.length).fill(-1), C = new Array(text.length).fill('');
  if (Work.isChanged(rec, n, f, l))
    Work.hunks(Work.bookValue(rec, n, f, l), text).forEach((h, i) => { for (let j = h.at; j < h.at + h.now.length; j++) E[j] = i; });
  if (f === 'text') for (const c of Work.openComments(rec, n)) {
    if (!c.quote || c.lang !== l) continue;
    const i = Work.findQuote(text, c.quote, c.position);
    if (i >= 0) for (let j = i; j < i + c.quote.length; j++) C[j] = C[j] || c.id;
  }
  const col = hl(Work.editInfo(rec, n, f, l)?.by), out = [];
  let off = 0;
  for (const line of text.split('\n')) {
    let html = '', run = '', e = -1, c = '';
    const flush = () => {
      if (!run) return;
      html += e < 0 && !c ? esc(run) : `<mark class="${e >= 0 ? 'e' : ''}${c ? ' c' : ''}" data-act="mark"${e >= 0 ? ` data-e="${chId(f, l, e)}"${col}` : ''}${c ? ` data-c="${esc(c)}"` : ''}>${esc(run)}</mark>`;
      run = '';
    };
    for (let i = 0; i < line.length; i++) {
      if (E[off + i] !== e || C[off + i] !== c) { flush(); e = E[off + i]; c = C[off + i]; }
      run += line[i];
    }
    flush();
    const cls = f === 'title' ? 'stitle' : line.trim() ? '' : 'gap';
    out.push(`<p data-para data-n="${n}" data-f="${f}" data-l="${esc(l)}" data-off="${off}"${cls ? ` class="${cls}"` : ''}>${html}</p>`);
    off += line.length + 1;
  }
  return out.join('');
}
// One note per run of changed words, in every language of the scene: the book's words struck through, the new ones, Undo.
function changeNotes(rec, n) {
  const out = [];
  for (const l of rec.book.languages) for (const f of Work.FIELDS) {
    if (!Work.isChanged(rec, n, f, l)) continue;
    const w = Work.editInfo(rec, n, f, l) || {}, where = `${T(f === 'title' ? 'fTitle' : 'fText')} · ${langName(l, rec.book.languageNames)}`;
    Work.hunks(Work.bookValue(rec, n, f, l), Work.value(rec, n, f, l)).forEach((h, i) => out.push(
      `<div class="cm chn" id="${chId(f, l, i)}"${hl(w.by)}><div class="cmmeta">${Th('whoChanged', { name: chip(w.by) })}<span>${esc(when(w.at))}</span></div>
        <div class="cmtop"><span class="cml">${esc(where)}</span></div>
        ${h.was ? `<div class="chwas" lang="${esc(l)}"><del>${esc(h.was)}</del></div>` : ''}
        ${h.now ? `<button class="chnow" data-act="show-change" data-k="${esc(chKey(f, l, i))}" lang="${esc(l)}"${hl(w.by)}>${esc(h.now)}</button>` : `<span class="cml">${esc(T('removedW'))}</span>`}
        <div class="row cmacts"><button class="btn quiet" data-act="undo-chg" data-k="${esc(chKey(f, l, i))}">${esc(T('undo'))}</button></div></div>`));
  }
  return out.join('');
}
// The pop-up under selected words: one box for a comment or the new words. A title can only be changed.
function popHtml() {
  const P = S.pop;
  if (!P || !S.mine?.rec) return '';
  const t = P.f === 'title';
  return `<div class="pop" id="pop" role="dialog" aria-labelledby="poph" style="top:${P.top}px">
    <div class="flbl" id="poph">${esc(T(t ? 'popTitleT' : 'popTitle'))} · ${esc(langName(P.l, S.mine.rec.book.languageNames))}</div>
    <div class="cmq" lang="${esc(P.l)}">“${esc(P.quote)}”</div>
    <label class="flbl" for="draft">${esc(T(t ? 'newWords' : 'draftLbl'))}</label>
    <textarea id="draft">${esc(P.draft || '')}</textarea>
    <p class="pophelp">${esc(T(t ? 'popHelpT' : 'popHelp'))}</p>
    <div class="row popacts"><button class="btn" data-act="pop-cancel">${esc(T('cancel'))}</button><button class="btn" data-act="pop-replace">${esc(T('replace'))}</button>${t ? '' : `<button class="btn primary" data-act="pop-comment">${ICON_CM}${esc(T('comment'))}</button>`}</div></div>`;
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
  const block = l => `<div class="langblock" lang="${esc(l)}">${all ? `<div class="lname">${esc(langName(l, book.languageNames))}</div>` : ''}
      ${markedHtml(rec, n, 'title', l)}<div class="story">${markedHtml(rec, n, 'text', l)}</div></div>`;
  const nav = `<div class="spnav"><span>${n > 1 ? `<button class="btn bigbtn" data-act="scene" data-k="${n - 1}">${esc(T('prevScene', { n: n - 1 }))}</button>` : ''}</span>
    <span>${n < m ? `<button class="btn primary bigbtn" data-act="scene" data-k="${n + 1}">${esc(T('nextScene', { n: n + 1 }))}</button>` : ''}</span></div>`;
  const cms = Work.openComments(rec, n), done = Work.sceneComments(rec, n).filter(c => c.resolved), C = S.compose?.n === n ? S.compose : null;
  const composer = C ? `<div class="composer"${hl(S.me)}>${quoteChip(C)}<label class="flbl" for="cmtext">${esc(T('yourComment'))}</label>
      <textarea id="cmtext">${esc(C.draft || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="save-comment">${esc(T('save'))}</button><button class="btn" data-act="cancel-comment">${esc(T('cancel'))}</button></div></div>` : '';
  const own = by => Id.isOwn(by, S.me, OLD_NAME);
  const editBox = k => `<label class="flbl" for="ced">${esc(T('edit'))}</label><textarea id="ced">${esc(S.editC.draft)}</textarea>
    <div class="row"><button class="btn primary" data-act="edit-save">${esc(T('save'))}</button><button class="btn" data-act="edit-cancel">${esc(T('cancel'))}</button></div>`;
  const ask = (k, q) => `<div class="row delask"><b>${esc(T(q))}</b><button class="btn danger-solid" data-act="del-c-yes" data-k="${esc(k)}">${esc(T('del'))}</button><button class="btn" data-act="del-c-no">${esc(T('keepIt'))}</button></div>`;
  const ownActs = (k, by) => own(by) ? `<button class="btn quiet" data-act="edit-c" data-k="${esc(k)}">${esc(T('edit'))}</button><button class="btn quiet del-c" data-act="del-comment" data-k="${esc(k)}">${esc(T('del'))}</button>` : '';
  const reply = (c, r) => { const k = `${c.id}/${r.id}`;
    return `<div class="rp"${hl(r.by)}><div class="cmmeta">${byLine(r.by, r.made, r.edited)}</div>
      ${S.editC?.k === k ? editBox(k) : `<p>${esc(r.text)}</p>`}
      ${S.delC === k ? ask(k, 'delR') : S.editC?.k === k || c.resolved ? '' : `<div class="row cmacts">${ownActs(k, r.by)}</div>`}</div>`; };
  const card = c => `<div class="cm ${c.resolved ? 'isdone' : ''}" id="cm-${esc(c.id)}"${hl(c.by)}><div class="cmmeta">${byLine(c.by, c.made, c.edited)}</div>
      <div class="cmtop">${quoteChip(c, !c.resolved)}${c.quote ? `<span class="cml">${esc(langName(c.lang, book.languageNames))}</span>` : ''}</div>
      ${S.editC?.k === c.id ? editBox(c.id) : `<p>${esc(c.text)}</p>`}
      ${(c.replies || []).map(r => reply(c, r)).join('')}
      ${S.reply?.id === c.id ? `<div class="rp"><label class="flbl" for="rptext">${esc(T('yourReply'))}</label><textarea id="rptext">${esc(S.reply.draft || '')}</textarea>
        <div class="row"><button class="btn primary" data-act="reply-save">${esc(T('reply'))}</button><button class="btn" data-act="reply-cancel">${esc(T('cancel'))}</button></div></div>` : ''}
      ${c.resolved ? `<div class="row cmacts"><span class="cml">${Th('resolvedBy', { name: chip(c.resolved.by), t: esc(when(c.resolved.at)) })}</span><button class="btn quiet" data-act="reopen" data-k="${esc(c.id)}">${esc(T('reopen'))}</button></div>`
        : S.delC === c.id ? ask(c.id, 'delC')
        : S.editC?.k === c.id || S.reply?.id === c.id ? ''
        : `<div class="row cmacts"><button class="btn quiet" data-act="reply" data-k="${esc(c.id)}">${esc(T('reply'))}</button><button class="btn quiet" data-act="resolve" data-k="${esc(c.id)}">✓ ${esc(T('resolve'))}</button>${ownActs(c.id, c.by)}</div>`}</div>`;
  const chs = changeNotes(rec, n);
  const redo = S.redo?.n === n ? `<div class="emptyc undone"><span>${esc(T('undone'))}</span><button class="btn quiet" data-act="redo-chg">${esc(T('putBack'))}</button></div>` : '';
  const list = cms.map(card).join('') + (done.length ? `<button class="btn quiet resbtn" data-act="toggle-resolved" aria-expanded="${S.showResolved}">${S.showResolved ? '▾' : '▸'} ${esc(T('resolvedN', { n: done.length }))}</button>${S.showResolved ? done.map(card).join('') : ''}` : '');
  return `<div class="three">${toc}
    <section class="card scenecard">${mob}
      <div class="scenehead"><span class="lbl">${esc(T('sceneOf', { n, m }))}</span><span class="savest ${S.save === 'fail' ? 'bad' : ''}" id="savest" aria-live="polite">${esc(saveText())}</span></div>
      <div class="row between">${seg}<button class="btn" data-act="comment">${ICON_CM}${esc(T('comment'))}</button></div>
      <p class="selhint">${ICON_PEN}<span>${esc(T('selHint'))}</span></p>
      <div id="storytext">${shown.map(block).join('')}</div>${nav}${S.pop?.n === n && shown.includes(S.pop.l) ? popHtml() : ''}</section>
    <aside class="cmside" aria-labelledby="cmh"><h3 class="lbl" id="cmh">${esc(T('notesOn'))}</h3>${redo}${composer}${cms.length || C || chs ? '' : `<div class="emptyc">${esc(T('noComments'))}</div>`}${chs}${list}</aside></div>`;
}

// The reader's identity: asked once per device, changeable (a shared tablet: each person picks their own).
function saveName() {
  const box = document.getElementById('nm'), D = S.idDraft;
  const me = D && Id.clean({ ...D, id: S.me?.id, nick: box ? box.value : D.nick });
  if (!me) return;
  S.me = me; Id.save(store, me); S.nameSheet = false; S.idDraft = null; render();
}
const myBy = () => S.me && { ...S.me };             // a copy kept on each change, comment and reply

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
  if (a === 'mark') return markTap(b);
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
  const needName = () => { if (S.me) return false; openId(); render(); document.querySelector('.symbtn')?.focus(); return true; };
  const findC = k => { const [cid, rid] = String(k).split('/'), c = (rec.comments || []).find(x => x.id === cid); return { c, r: rid ? c?.replies?.find(x => x.id === rid) : null, rid }; };
  const focusId = id2 => { const el = document.getElementById(id2); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (a === 'name-open') { openId(); render(); return document.querySelector('.symbtn[aria-pressed="true"]')?.focus() ?? document.querySelector('.symbtn')?.focus(); }
  if (a === 'name-close') { S.nameSheet = false; S.idDraft = null; return render(); }
  if ((a === 'id-sym' || a === 'id-col') && S.idDraft) {
    S.idDraft[a === 'id-sym' ? 'symbol' : 'colour'] = k; render();
    return document.querySelector(`[data-act="${a}"][data-k="${k}"]`)?.focus();
  }
  if (a === 'name-save') return saveName();
  if (a === 'reply') { if (needName()) return; S.reply = { id: k, draft: '' }; render(); return focusId('rptext'); }
  if (a === 'reply-cancel') { S.reply = null; return render(); }
  if (a === 'reply-save') {
    const text = (document.getElementById('rptext')?.value || '').trim(), { c } = findC(S.reply.id);
    if (!text) return document.getElementById('rptext')?.focus();
    if (c) { c.replies = [...(c.replies || []), Work.newReply(text, myBy())]; queueSave(); }
    S.reply = null; return render();
  }
  if (a === 'resolve' || a === 'reopen') {
    if (a === 'resolve' && needName()) return;
    const { c } = findC(k); if (!c) return;
    if (a === 'resolve') c.resolved = { by: myBy(), at: new Date().toISOString() }; else delete c.resolved;
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
  if (a === 'scene') { S.pop = null; return go(bookHash(id, +k), true); }
  if (a === 'view') { S.view[id] = k; S.pop = null; return render(); }
  // Undo one change (a run of changed words); "Put it back" restores the words as they were before the Undo.
  if (a === 'undo-chg') {
    const [f, l, i] = k.split('|'), now = Work.value(rec, n, f, l), info = Work.editInfo(rec, n, f, l);
    Work.setValue(rec, n, f, l, Work.undoHunk(Work.bookValue(rec, n, f, l), now, +i), info?.by); Work.setEditInfo(rec, n, f, l, info);
    queueSave(); S.redo = { n, f, l, words: now, info }; return render();
  }
  if (a === 'redo-chg' && S.redo) {
    const { f, l, words, info } = S.redo;
    Work.setValue(rec, n, f, l, words, info?.by); Work.setEditInfo(rec, n, f, l, info);
    queueSave(); return render();
  }
  if (a === 'pop-cancel') { S.pop = null; getSelection()?.removeAllRanges(); return render(); }
  if (a === 'pop-replace' || a === 'pop-comment') {
    const P = S.pop;
    if (!P) return;
    P.draft = document.getElementById('draft')?.value ?? P.draft;
    if (needName()) return;
    const words = (P.draft || '').trim();
    if (a === 'pop-comment') {
      if (!words) { toast(T('writeFirst')); return document.getElementById('draft')?.focus(); }
      const c = Work.newComment({ spread: n, lang: P.l, quote: P.quote, position: P.start, text: words, by: myBy() });
      rec.comments = [...(rec.comments || []), c];
      S.pop = null; getSelection()?.removeAllRanges(); queueSave(); render();
      return flash(document.getElementById(`cm-${c.id}`));
    }
    Work.replaceRange(rec, n, P.f, P.l, P.start, P.end, words, myBy());
    S.pop = null; getSelection()?.removeAllRanges(); queueSave(); render();
    // Show the new words' note (the change that now covers where the words were).
    const now = Work.value(rec, n, P.f, P.l), hs = Work.isChanged(rec, n, P.f, P.l) ? Work.hunks(Work.bookValue(rec, n, P.f, P.l), now) : [];
    const i = hs.findIndex(h => h.at <= P.start + words.length && h.at + h.now.length >= P.start);
    if (i >= 0) flash(document.getElementById(chId(P.f, P.l, i)), true);
    return;
  }
  if (a === 'show-change') {
    const [f, l, i] = k.split('|');
    if (!shownLangs(rec).includes(l)) { S.view[id] = l; render(); }
    return flash(document.querySelector(`#storytext mark[data-e="${chId(f, l, +i)}"]`));
  }
  if (a === 'comment') {
    if (needName()) return;
    S.pop = null; S.compose = { n, draft: S.compose?.draft || '' };
    render();
    const box = document.getElementById('cmtext');
    box?.focus({ preventScroll: true }); box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (a === 'cancel-comment') { S.compose = null; return render(); }
  if (a === 'save-comment') {
    const box = document.getElementById('cmtext'), text = (box?.value || '').trim();
    if (!text) return box?.focus();
    rec.comments = [...(rec.comments || []), Work.newComment({ spread: n, ...S.compose, text, by: myBy() })];
    S.compose = null; queueSave(); render();
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
    if (!shownLangs(rec).includes(c.lang)) { S.view[id] = c.lang; render(); }
    flash(document.querySelector(`#storytext mark[data-c="${CSS.escape(c.id)}"]`));
  }
}
// Show where something is: scroll to it and light it up for a moment.
function flash(el, quiet) {
  if (!el) return;
  if (!quiet || el.getBoundingClientRect().bottom > innerHeight || el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}
const shownLangs = rec => { const v = viewOf(rec.id, rec.book.languages); return v === 'all' ? rec.book.languages : [v]; };
// Tapping marked words shows their note(s) at the side (on a phone: below).
function markTap(m) {
  if (getSelection()?.isCollapsed === false) return;
  const notes = [m.dataset.c && document.getElementById(`cm-${m.dataset.c}`), m.dataset.e && document.getElementById(m.dataset.e)].filter(Boolean);
  notes.forEach((el, i) => flash(el, i > 0));
}

// ---- Selecting words in the story → the pop-up (Comment / Replace) ----
// Offsets come from each paragraph's data-off, so they point into the reader's own text.
function onSelect(focus) {
  const r = S.route;
  if (r.view !== 'book' || r.tab !== 'story' || !S.mine?.rec || S.composing || S.nameSheet) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0), box = document.getElementById('storytext');
  const para = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[data-para]');
  const pa = para(range.startContainer), pb = para(range.endContainer);
  if (!pa || !pb || !box?.contains(pa) || !box.contains(pb) || pa.dataset.l !== pb.dataset.l || pa.dataset.f !== pb.dataset.f) return;
  const rec = S.mine.rec, n = +pa.dataset.n, f = pa.dataset.f, l = pa.dataset.l, text = Work.value(rec, n, f, l);
  const at = (p, node, off) => { const rr = document.createRange(); rr.selectNodeContents(p); rr.setEnd(node, off); return +p.dataset.off + rr.toString().length; };
  let start = at(pa, range.startContainer, range.startOffset), end = at(pb, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return;
  const P = S.pop;
  if (P && P.n === n && P.f === f && P.l === l && P.start === start && P.end === end) { if (focus) focusDraft(); return; }
  const card = document.querySelector('.scenecard')?.getBoundingClientRect(), rect = range.getBoundingClientRect();
  if (!card) return;
  S.pop = { n, f, l, start, end, quote: text.slice(start, end), draft: P?.draft || '', top: Math.round(rect.bottom - card.top + 10) };
  const old = document.getElementById('pop');
  if (old) old.outerHTML = popHtml(); else document.querySelector('.scenecard').insertAdjacentHTML('beforeend', popHtml());
  if (focus) focusDraft();
}
function focusDraft() {
  const d = document.getElementById('draft');
  d?.focus({ preventScroll: true });
  document.getElementById('pop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Mouse: at once, typing goes straight into the box. Touch (long-press, handles) and keyboard: after the selection settles,
// without moving focus, so the selection stays adjustable.
document.addEventListener('mouseup', e => { if (e.target.closest?.('#storytext')) setTimeout(() => onSelect(true), 0); });
let selTimer;
document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(() => onSelect(false), 450); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.langSheet) { S.langSheet = false; render(); return; }
  if (e.key === 'Escape' && S.pop && S.route.view === 'book') { S.pop = null; getSelection()?.removeAllRanges(); return render(); }
  if (e.key === 'Escape' && S.compose && S.route.view === 'book') { S.compose = null; render(); return document.querySelector('[data-act="comment"]')?.focus(); }
  if (e.key === 'Escape' && S.sheet) return closeSheet();
  if (e.key === 'Enter' && e.target.id === 'nf') { e.preventDefault(); return createFolder(); }
  if (e.key === 'Enter' && e.target.id === 'nm') { e.preventDefault(); return saveName(); }
  if (e.key === 'Escape' && S.nameSheet) { S.nameSheet = false; S.idDraft = null; return render(); }
  if ((S.route.view !== 'read' && S.route.view !== 'mine') || S.langSheet || e.target.matches('input,textarea,select')) return;
  const story = S.route.view === 'read' ? S.books[S.route.id]?.story : S.mine?.rec?.story;
  if (!story) return;
  const at = Math.min(S.route.at, story.length), base = `${S.route.view}/${encodeURIComponent(S.route.id)}/`;
  if (e.key === 'ArrowRight' && at < story.length) go(base + (at + 1), true);
  else if (e.key === 'ArrowLeft' && at > 0) go(base + (at - 1), true);
});
window.addEventListener('hashchange', onRoute);

// Typing in a comment, reply or pop-up box: keep the draft (a re-render puts it back).
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'cmtext' && S.compose) { S.compose.draft = el.value; return; }
  if (el.id === 'rptext' && S.reply) { S.reply.draft = el.value; return; }
  if (el.id === 'ced' && S.editC) { S.editC.draft = el.value; return; }
  if (el.id === 'nm' && S.idDraft) { S.idDraft.nick = el.value; return; }
  if (el.id === 'draft' && S.pop) { S.pop.draft = el.value; return; }
});
document.addEventListener('change', e => {
  if (e.target.id === 'at' && S.mine?.rec) go(bookHash(S.mine.rec.id, +e.target.value), true);
});
document.addEventListener('compositionstart', () => { S.composing = true; });
document.addEventListener('compositionend', () => {
  S.composing = false;
  if (S.renderLater) { S.renderLater = false; render(); }
});
// Leaving the page (closing the tab, switching app on a phone): save now.
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

S.route = parseRoute();
render();
loadShelf();
loadLibrary().then(onRoute);
