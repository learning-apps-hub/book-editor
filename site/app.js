// Book Editor — app shell: display language, My shelf / Library tabs, read-only reader (step 3);
// My shelf in this browser's storage, Select → Move to / Delete (step 4);
// a shelf book's Story, ported from eBook Production: scene list, the story shown once with changes and comments marked in it,
// select words → Comment / Replace (each Replace kept as made, with Undo), Next round bar: note, Send back / Approve story (step 5);
// the reader's identity: picture + colour + optional nickname, also their highlighter (identity.js).
// File formats: docs/book-file-format.md. No build step; plain ES modules.
import { UI, langName } from './i18n.js';
import * as Shelf from './shelf.js';
import * as Work from './work.js';
import * as Id from './identity.js';
import * as Layout from './layout.js';

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
  home: (() => { try { return { view: 'shelves', sort: 'changed', filter: 'all', ...JSON.parse(store.get('be.home')) }; } catch { return { view: 'shelves', sort: 'changed', filter: 'all' }; } })(),
  selecting: false, picked: new Set(), sheet: null, closed: {},  // sheet: 'move' | 'delete'
  // Story (a shelf book being edited)
  view: {}, scene: {},                                         // id -> story language shown ('all' = every one) / last scene
  pop: null,                                                   // { n, f, l, start, end, quote, draft, top } words selected in the story
  delC: null, noteOpen: {}, sendAsk: null,                     // comment id asking "Delete?" / round note shown / 'rewrite'|'final' sheet
  dirty: false, save: '', saveFailed: false,                   // save: '' | 'saving' | 'saved' | 'fail'
  composing: false, renderLater: false,
  me: null, nameSheet: false, idDraft: null,                  // the reader's identity (identity.js) / the sheet choosing it
  editC: null,                                                 // { k: comment id, draft } comment being edited
  layoutScene: {}, pvSize: 'large',                            // selected preview scene / Large or Small
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
    if (Work.migrate(rec)) { S.dirty = true; flushSave(); }   // saved by an older Book Editor: keep it in today's shape
    if (!rec.opened) Shelf.markOpened(id).then(loadShelf).catch(() => {});
  } catch {
    S.mine = { id, gone: true };
  }
  render();
}

// ---- Routes: #library, #shelf, #read/<id>/<page> (Library copy, read only),
// #book/<id>/story/<scene> and #book/<id>/layout (shelf copy). Page 0 = cover. Browser Back works.
// (#mine/<id>/<page>, the shelf copy's own reader, went 2026-11-12: the Layout preview shows the book; old links open Story.) ----
function parseRoute() {
  const [view, id, at, n] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (view === 'shelf') return { view: 'shelf' };
  if (view === 'book' && id) return at === 'layout' ? { view, id, tab: 'layout' } : { view, id, tab: 'story', n: Math.max(1, parseInt(n, 10) || 1) };
  if (view === 'mine' && id) return { view: 'book', id, tab: 'story', n: Math.max(1, parseInt(at, 10) || 1) };
  if (view === 'read' && id) return { view, id, at: Math.max(0, parseInt(at, 10) || 0) };
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
    Object.assign(S, { pop: null, delC: null, editC: null, sendAsk: null });
  }
  if (r.view === 'book' && r.tab === 'story') S.scene[r.id] = r.n;
  if (r.view === 'book' && !S.me && !S.nameSheet) openId();
  if (r.view !== 'book') S.nameSheet = false;
  if (r.view === 'read' && S.lib) loadBook(r.id);
  if (r.view === 'book') loadMine(r.id); else closeMine();
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
// Header: eBooks' header.top (brand left, a .pubset pill right), the display language in that pill.
function header(rec) {
  // In a book: eBooks' book picker pill (cover letter, where it lives, the title); here it goes back to My shelf.
  const pick = rec ? (() => { const t = titleOf(rec.book.titles, rec.book.languages, S.ui), tl = rec.book.titles?.[S.ui] ? S.ui : rec.book.languages[0];
    return `<div class="pk"><button class="picker" data-act="go" data-k="shelf" aria-label="${esc(T('backShelf'))}"><span class="avatar" lang="${esc(tl)}">${esc([...t][0] || '?')}</span>
      <span class="meta"><span class="tiny muted">${esc(T('backShelf'))}</span><b lang="${esc(tl)}">${esc(t)}</b></span></button></div>`; })() : '';
  return `<header class="top"><button class="brand" data-act="go" data-k="library" aria-label="Book Editor">${ICON_BOOK}<span class="brand-name">Book Editor</span></button>${pick}<div class="grow"></div>
    <button class="pubset langbig" data-act="lang-open" aria-haspopup="dialog" aria-label="${esc(T('dispLang'))}: ${esc(UI[S.ui].name)}">${ICON_GLOBE}<b>${esc(UI[S.ui].name)}</b><span class="car" aria-hidden="true">▾</span></button></header>`;
}
function langSheet() {
  if (!S.langSheet) return '';
  return `<div class="sheetbox" data-act="lang-close"><section class="card" role="dialog" aria-modal="true" aria-labelledby="lh" data-stop="1">
    <h2 id="lh">${esc(T('dispLang'))}</h2><p>${esc(T('dispHelp'))}</p>
    <div class="langgrid">${Object.keys(UI).map(k => `<button class="langbtn" lang="${k}" aria-pressed="${k === S.ui}" data-act="ui" data-k="${k}">${esc(UI[k].name)}</button>`).join('')}</div></section></div>`;
}
// My shelf / Library: eBooks' step tabs (nav.steps .step .num .lbl .sub).
function homeTabs(active) {
  const n = { shelf: S.shelf ? S.shelf.length : null, library: S.lib ? S.lib.books.length : null };
  const tab = (k, icon) => `<button class="step${active === k ? ' on' : ''}" role="tab" aria-selected="${active === k}" data-act="go" data-k="${k}"><span class="num">${icon}</span>
    <span class="lbl"><b>${esc(T(k === 'shelf' ? 'myShelf' : 'library'))}</b>${n[k] == null ? '' : `<span class="sub">${esc(T(n[k] === 1 ? 'books1' : 'booksN', { n: n[k] }))}</span>`}</span></button>`;
  return `<nav class="steps" role="tablist">${tab('shelf', ICON_SHELF)}${tab('library', ICON_LIB)}</nav>`;
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

// eBooks' cover card (coverCard): .bk > .cv (picture, or a plain coloured cover with its title) + .bk-t + .bk-s.
const COVER_C = '#2F6B5E';
const coverOf = (src, title) => src ? `<span class="cv img"><img src="${esc(src)}" alt="" loading="lazy">` : `<span class="cv plain"><span class="cvt">${esc(title)}</span>`;
function libraryView() {
  if (S.libError) return problem(S.libError, S.libError === 'loadFail' ? 'retry-lib' : null);
  if (!S.lib) return `<div class="loading">${esc(T('loading'))}</div>`;
  const books = S.lib.books.slice().sort((a, b) => String(b.shared).localeCompare(String(a.shared)));
  const head = `<div class="home-h"><h1>${esc(T('library'))}</h1></div><p class="muted" style="margin:0">${esc(T('libIntro'))}</p>${sampleNote()}`;
  if (!books.length) return `<div class="home">${head}<div class="emptybox"><p>${esc(T('libEmpty'))}</p></div></div>`;
  const card = b => {
    const title = titleOf(b.titles, b.languages, S.ui);
    return `<div class="libcard"><button class="bk" data-act="read" data-k="${esc(b.id)}" style="--c:${COVER_C}">
        ${coverOf(b.cover && S.libBase + b.cover, title)}<span class="readtag">${ICON_READ}${esc(T('read'))}</span></span>
        <span class="bk-t">${esc(title)}</span><span class="bk-l">${esc((b.languages || []).map(l => langName(l, b.languageNames)).join(' · '))}</span></button>
      ${addButton(b.id, false)}</div>`;
  };
  return `<div class="home">${head}<section class="shelf"><div class="covers">${books.map(card).join('')}</div></section></div>`;
}

const folderColour = i => `hsl(${30 + i * 140} 45% 55%)`;
// Home tools (eBooks' renderMenu): view pills, Sort by, state chips. This browser's own choices.
const bookState = b => !b.opened ? 'new' : b.sent ? 'sent' : (({ c, n, note }) => c || n || note)(Work.counts(b)) ? 'changed' : 'none';
const HOME_SORTS = ['changed', 'title', 'added'], HOME_FILTERS = ['all', 'none', 'changed', 'sent'];
const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return '';
  const R = new Intl.RelativeTimeFormat(S.ui, { numeric: 'auto' });
  return s < 3600 ? R.format(-Math.max(1, Math.floor(s / 60)), 'minute') : s < 86400 ? R.format(-Math.floor(s / 3600), 'hour') : s < 7 * 86400 ? R.format(-Math.floor(s / 86400), 'day') : when(iso);
};
function homeTools(extra = '') {
  const h = S.home;
  return `<div class="hometools">
    <div class="pills" role="group" aria-label="${esc(T('hView'))}">${[['shelves', 'hShelves'], ['all', 'hAll']].map(([k, l]) =>
      `<button class="pill" aria-pressed="${h.view === k}" data-act="home-view" data-k="${k}">${esc(T(l))}</button>`).join('')}</div>
    <label class="sortby">${esc(T('sortBy'))} <select class="box" id="home-sort">${HOME_SORTS.map(k => `<option value="${k}" ${h.sort === k ? 'selected' : ''}>${esc(T('sort_' + k))}</option>`).join('')}</select></label>
    <div class="fchips" role="group" aria-label="${esc(T('hShow'))}">${HOME_FILTERS.map(k =>
      `<button class="fchip st-${k}" aria-pressed="${h.filter === k}" data-act="home-filter" data-k="${k}">${k === 'all' ? '' : '<i></i>'}${esc(T(k === 'all' ? 'fAll' : 'f_' + k))}</button>`).join('')}</div>${extra}</div>`;
}
function shelfCard(b, c = COVER_C) {
  const title = titleOf(b.titles, b.languages, S.ui), picked = S.picked.has(b.id), st = bookState(b);
  const badge = st === 'new' ? T('isNew') : st === 'changed' ? T('f_changed') : st === 'sent' ? (b.sent.kind === 'final' ? T('stApprovedB') : T('f_sent')) : '';
  const status = st === 'new' ? T('stNew') : b.sent ? sentText(b.sent) : countText(Work.counts(b)) || T('stNone');
  const left = b.opened && (b.changed || b.added) ? `<span class="bk-l">${esc(T('leftOff', { t: ago(b.changed || b.added) }))}</span>` : '';
  const inner = `${coverOf(S.covers[b.id], title)}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}${S.selecting ? `<span class="pickbox" aria-hidden="true">${picked ? '✓' : ''}</span>` : ''}</span>
    <span class="bk-t">${esc(title)}</span><span class="bk-s">${esc(status)}</span>${left}`;
  return `<button class="bk st-${st}" style="--c:${c}" data-act="${S.selecting ? 'pick' : 'open-mine'}" data-k="${esc(b.id)}"${S.selecting ? ` aria-pressed="${picked}"` : ''}>${inner}</button>`;
}
// eBooks' folded shelf: one book-like "folder", the first covers fanned out behind it.
function shelfFolder(name, key, c, bs) {
  const fan = bs.filter(b => S.covers[b.id]).slice(0, 3);
  const counts = HOME_FILTERS.slice(1).map(k => [k, bs.filter(b => (bookState(b) === 'new' ? 'none' : bookState(b)) === k).length]).filter(x => x[1]);
  return `<button class="folder" data-act="fold" data-k="${esc(key)}" style="--c:${c}" aria-expanded="false">
    <span class="fan">${fan.map((b, i) => `<img class="f${i}" src="${esc(S.covers[b.id])}" alt="" loading="lazy">`).join('')}
      <span class="scv"><span class="scv-n">${esc(name)}</span><span class="scv-c">${esc(T(bs.length === 1 ? 'books1' : 'booksN', { n: bs.length }))}</span></span></span>
    <span class="fstates">${counts.map(([k, n]) => `<span class="fst st-${k}"><i></i>${n} ${esc(T('f_' + k).toLowerCase())}</span>`).join('')}</span>
    <span class="fopen">${esc(T('openShelf'))} ›</span></button>`;
}
function shelfView() {
  if (!S.shelf) return `<div class="loading">${esc(T('loading'))}</div>`;
  if (S.shelfError) return problem(S.shelfError);
  const h = S.home;
  const head = (tools) => `<div class="home-h"><h1>${esc(T('myShelf'))}</h1>${tools}</div>`;
  if (!S.shelf.length) return `<div class="home">${head('')}<div class="emptybox"><p>${esc(T('shelfEmpty'))}</p><button class="btn primary bigbtn" data-act="go" data-k="library">${ICON_LIB}${esc(T('goLibrary'))}</button></div></div>`;
  const ttl = b => titleOf(b.titles, b.languages, S.ui);
  const by = { title: (a, b) => ttl(a).localeCompare(ttl(b), S.ui), added: (a, b) => (b.added || '').localeCompare(a.added || ''),
    changed: (a, b) => (b.changed || b.added || '').localeCompare(a.changed || a.added || '') }[h.sort] || (() => 0);
  const keep = b => h.filter === 'all' || (h.filter === 'none' ? ['none', 'new'].includes(bookState(b)) : bookState(b) === h.filter);
  const nothing = `<div class="muted small empty">${esc(T('hNone'))}</div>`;
  const tile = () => S.selecting ? '' : `<button class="addtile" data-act="go" data-k="library"><span class="plus" aria-hidden="true">+</span>${esc(T('addFromLib'))}<small>${esc(T('addFromLibS'))}</small></button>`;
  const covers = (bs, c, withTile) => `<div class="covers">${bs.map(b => shelfCard(b, c)).join('') || nothing}${withTile ? tile() : ''}</div>`;
  let body;
  if (h.view === 'all' || !S.folders.length) {
    const bs = S.shelf.filter(keep).sort(by);
    body = `<section class="shelf">${h.view === 'all' ? `<div class="shelf-h"><b>${esc(T('hAll'))}</b><span class="muted">· ${esc(T(bs.length === 1 ? 'books1' : 'booksN', { n: bs.length }))}</span></div>` : ''}${covers(bs, COVER_C, true)}</section>`;
  } else {
    const groups = [...S.folders.map((f, i) => [f, f, folderColour(i)]), ['', '_', COVER_C]];
    body = groups.map(([f, key, c]) => {
      const all = S.shelf.filter(b => (b.folder || '') === f);
      if (!f && !all.length && S.selecting) return '';
      const folded = !!S.closed[key], name = f || T('noFolder');
      const head = `<div class="shelf-h"><button class="foldbtn" data-act="fold" data-k="${esc(key)}" aria-expanded="${!folded}"><span class="chev">${folded ? '▸' : '▾'}</span><span class="dot" style="background:${c}"></span><b>${esc(name)}</b><span class="muted">· ${esc(T(all.length === 1 ? 'books1' : 'booksN', { n: all.length }))}</span></button></div>`;
      if (folded && all.length) return `<section class="shelf folded">${head}${shelfFolder(name, key, c, all)}</section>`;
      return `<section class="shelf">${head}${covers(all.filter(keep).sort(by), c, !f)}</section>`;
    }).join('');
  }
  const sel = S.selecting
    ? `<div class="row"><span class="grow">${esc(T('pickSome'))}</span><button class="btn" data-act="select-off">${esc(T('done'))}</button></div>`
    : `<button class="btn selbtn" data-act="select-on">${ICON_CHECK}${esc(T('select'))}</button>`;
  return `<div class="home">${head(homeTools(S.selecting ? '' : sel))}${S.selecting ? sel : ''}${body}<p class="small muted homefoot">${esc(T('keep'))}</p></div>`;
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
      <div class="movelist">${S.folders.map((f, i) => `<button data-act="move-to" data-k="${esc(f)}"><span class="dot" style="background:${folderColour(i)}" aria-hidden="true"></span>${esc(f)}</button>`).join('')}<button data-act="move-to" data-k="">${esc(T('noFolder'))}</button></div>
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
// ---- A shelf book: top bar, Story / Layout steps ----
const ICON_CM = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const ICON_CM_S = ICON_CM.replace(/width="20" height="20"/, 'width="14" height="14"');
const ICON_TICK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1F4A41" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const ICON_EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function countText({ c, n, note }) {
  return [c && T(c === 1 ? 'chg1' : 'chgN', { n: c }), n && T(n === 1 ? 'cm1' : 'cmN', { n }), note && T('yourNote')].filter(Boolean).join(', ');
}
// Sent back or approved: what the shelf card and the status box say.
const sentText = sent => T(sent.kind === 'final' ? 'stApproved' : 'stSent', { n: sent.round + 1 });
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

// ---- Layout: eBook Production's Export-to card, settings grid, jump grid and real-page preview ----
const PV = { host: null, key: '', data: null, overflow: [], scroll: 0, observer: null };
const PV_CSS = `
:host{display:block}.book{display:grid;grid-template-columns:repeat(var(--cols,1),max-content);gap:9mm;padding:6mm;zoom:var(--z,.3)}
.sp{display:flex;flex-direction:column;gap:2mm;cursor:pointer}.cap{font:700 calc(13px/var(--z,.3)) Nunito,system-ui,sans-serif;color:#6B645A}
.pair{display:flex;flex-wrap:wrap;gap:4mm;align-self:flex-start}.pg{flex:none;background:#fff;box-shadow:0 1mm 5mm rgba(0,0,0,.22)}
.sp.on .pair{outline:calc(4px/var(--z,.3)) solid #2F6B5E;outline-offset:2mm}.sheetrow{display:flex;flex-direction:column;gap:2mm}
.sheet{display:flex;position:relative;align-self:flex-start;background:#fff;box-shadow:0 1mm 5mm rgba(0,0,0,.22)}.sheet .pg{box-shadow:none}
.sheet::after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:.5mm dashed rgba(0,0,0,.3);pointer-events:none}
.half{position:relative}.half.on{outline:calc(4px/var(--z,.3)) solid #2F6B5E;outline-offset:-1mm;z-index:1}.body.over{outline:calc(2px/var(--z,.3)) dashed #9B2C2C}
.pv-msg{padding:24px;font:15px Nunito,system-ui,sans-serif;color:#6B645A}`;

const layoutTarget = rec => rec.layout?.target && Layout.TARGETS.some(([k]) => k === rec.layout.target) ? rec.layout.target : 'a5';
const targetName = target => T((Layout.TARGETS.find(([k]) => k === target) || [])[1] || target);
function layoutSettings(rec, target = layoutTarget(rec)) {
  const baseTarget = target === 'changes' ? 'custom' : target;
  return Layout.normaliseSettings(rec.book, baseTarget, rec.layout?.settings?.[target]);
}
function setLayout(rec, target, settings) {
  rec.layout = rec.layout || { target: 'a5', settings: {} };
  rec.layout.target = target;
  rec.layout.settings = { ...(rec.layout.settings || {}), ...(settings ? { [target]: settings } : {}) };
  queueSave();
}
function patchLayout(rec, patch) {
  const target = layoutTarget(rec), next = Layout.normaliseSettings(rec.book, target === 'changes' ? 'custom' : target,
    Layout.mergePatch(layoutSettings(rec, target), patch));
  setLayout(rec, target, next); render();
}
function layoutData(rec) {
  const settings = layoutSettings(rec);
  const story = rec.story.map(s => ({ number: s.number,
    title: Object.fromEntries(rec.book.languages.map(l => [l, Work.value(rec, s.number, 'title', l)])),
    text: Object.fromEntries(rec.book.languages.map(l => [l, Work.value(rec, s.number, 'text', l)])) }));
  const languageMeta = Object.fromEntries(rec.book.languages.map(l => [l, langName(l, rec.book.languageNames)]));
  return Layout.buildLayout({ book: rec.book, story, settings, urls: S.mine?.urls || {}, languageMeta });
}
const layRow = (label, control) => `<div class="sl">${esc(label)}</div><div class="sc">${control}</div>`;
function laySeg(options, current, aria) {
  return `<span class="seg" role="group" aria-label="${esc(aria)}">${options.map(([key, label, patch]) =>
    `<button aria-pressed="${key === current}" data-act="lay-pick" data-patch="${esc(JSON.stringify(patch))}">${esc(label)}</button>`).join('')}</span>`;
}
const sizeSlider = (key, value) => { const pc = Math.round((value ?? 1) * 100);
  return `<span class="psize"><input type="range" min="50" max="100" step="1" value="${pc}" data-lay-size="${key}" aria-label="${esc(T(key === 'book' ? 'pictureSize' : 'scenePictureSize', { n: key }))}"><output>${pc}%</output></span>`; };

function layoutSettingsPanel(rec, target, st) {
  if (target === 'changes') return '';
  const show = target === 'tv' ? ['languages', 'language_pages', 'body', 'main', 'covers']
    : target === 'a5' ? ['languages', 'language_pages', 'body', 'main', 'small', 'covers']
    : ['page', 'arrangement', 'languages', 'language_pages', 'body', 'main', 'small', 'covers'];
  const rows = [], langs = st.languages, n = langs.length, max = target === 'a5' ? 3 : Infinity;
  if (show.includes('page')) {
    const choices = st.arrangement === 'booklet' ? Layout.SHEET_CHOICES : Layout.PAGE_CHOICES;
    rows.push(layRow(T('paperSize'), `<select class="box" data-lay-page>${choices.map(([k, label, w, h]) =>
      `<option value="${w},${h}" ${w === st.page.w && h === st.page.h ? 'selected' : ''}>${esc(T('page_' + k) === 'page_' + k ? label : T('page_' + k))}${st.arrangement === 'booklet' ? ` (${esc(T('folded'))})` : ''}</option>`).join('')}</select>`));
  }
  if (show.includes('arrangement')) {
    const key = st.arrangement === 'one_page' ? `one_page_${st.picture_width}` : st.arrangement;
    const options = [['facing', 'arrFacing'], ['picture_page', 'arrPicture'], ['one_page_half', 'arrHalf'], ['one_page_fit', 'arrFull'], ['booklet', 'arrBooklet']];
    rows.push(layRow(T('pageLayout'), `<select class="box" data-lay-arr>${options.map(([k, label]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(T(label))}</option>`).join('')}</select>`));
  }
  rows.push(layRow(T('languages'), `<span class="lchips">${rec.book.languages.map(l => { const on = langs.includes(l);
    return `<button class="tchip" aria-pressed="${on}" data-act="lay-lang" data-code="${esc(l)}" ${!on && n >= max ? `disabled title="${esc(T('upToN', { n: max }))}"` : ''}>${on ? '✓ ' : ''}${esc(langName(l, rec.book.languageNames))}</button>`; }).join('')}</span>`));
  if (show.includes('language_pages') && n > 1) rows.push(layRow(T('languagesPage'), laySeg([
    ['together', T('sideBySide'), { language_pages: 'together' }],
    ['separate', target === 'tv' ? T('oneSlide') : T('onePage'), { language_pages: 'separate' }],
  ], st.language_pages, T('languagesPage'))));
  rows.push(layRow(T('textSize'), `<select class="box narrow" data-lay-body>${Layout.BODY_SIZES.map(x => `<option value="${x}" ${x === st.body_pt ? 'selected' : ''}>${x} pt</option>`).join('')}</select>`));
  const mainOptions = [];
  if (rec.book.pictures?.colour) mainOptions.push(['colour', T('colour'), { pictures: { main: 'colour' } }]);
  if (rec.book.pictures?.colouring) mainOptions.push(['colouring', T('colouring'), { pictures: { main: 'colouring' } }]);
  mainOptions.push(['none', T('none'), { pictures: { main: 'none' } }]);
  let pictureControl = laySeg(mainOptions, st.pictures.main, T('pictures'));
  if (show.includes('small') && rec.book.pictures?.small) pictureControl += `<span class="sub">${esc(T('small'))} ${laySeg([
    ['small', T('on'), { pictures: { small: 'small' } }], ['none', T('off'), { pictures: { small: 'none' } }],
  ], st.pictures.small, T('smallPictures'))}</span>`;
  rows.push(layRow(T('pictures'), pictureControl));
  if (st.arrangement === 'one_page' && st.pictures.main !== 'none') {
    const own = Object.keys(st.picture_sizes || {}).length;
    rows.push(layRow(T('pictureSize'), `${sizeSlider('book', st.picture_size)}${own ? `<span class="sub tiny muted">${esc(T('ownSizes', { n: own }))} <button class="linkbtn" data-act="lay-pick" data-patch="${esc(JSON.stringify({ picture_sizes: null }))}">${esc(T('useAll'))}</button></span>` : ''}`));
  }
  const covers = [];
  for (const which of ['front', 'back']) {
    const hasLine = !!rec.book.pictures?.lineart?.[which];
    const label = T(which === 'front' ? 'front' : 'back');
    const control = hasLine ? laySeg([['colour', T('colour'), { covers: { [which]: 'colour' } }], ['line', T('lineArt'), { covers: { [which]: 'line' } }]], st.covers[which], label) : `<span>${esc(T('colour'))}</span>`;
    covers.push(`<span class="sub">${esc(label)} ${control}</span>`);
  }
  rows.push(layRow(T('covers'), covers.join('')));
  return `<div class="setpanel"><div class="seth">${esc(T('layoutSettings'))}</div><div class="setgrid">${rows.join('')}</div></div>`;
}

function layoutNote(target) {
  return target === 'tv' ? T('noteTv') : target === 'a5' ? T('noteA5') : target === 'changes' ? T('noteChanges') : T('noteCustom');
}
function overflowMap() {
  const out = {};
  if (PV.key && PV.overflow) for (const x of PV.overflow) (out[x.spread] ||= []).push(x.lang);
  return out;
}
function layoutView(rec) {
  const target = layoutTarget(rec), st = layoutSettings(rec, target), data = layoutData(rec), over = overflowMap();
  const selected = S.layoutScene[rec.id] ?? 0;
  const missing = Object.fromEntries(data.missingTitles.map(x => [x.spread, x.languages]));
  const options = Layout.TARGETS.map(([k, key]) => `<option value="${k}" ${k === target ? 'selected' : ''}>${esc(T(key))}</option>`).join('');
  const exportLabel = target === 'changes' ? T('sendBack') : T('exportA');
  const card = `<section class="card xcard"><div class="xrow"><label class="xto"><span>${esc(T('exportTo'))}</span><select class="box" id="xt">${options}</select></label>
    <button class="btn primary" data-act="layout-export">${esc(exportLabel)}</button></div><div class="xnote" role="note"><span class="xi" aria-hidden="true">i</span><div>${esc(layoutNote(target))}</div></div>
    ${layoutSettingsPanel(rec, target, st)}</section>`;
  const jump = `<div class="side"><div class="eyebrow">${esc(T('jumpTo').toLocaleUpperCase(S.ui))}</div><div class="spreadgrid" id="pv-jump">
    <button class="sq picked ${selected === 0 ? 'on' : ''}" data-act="layout-page" data-k="0" aria-label="${esc(T('cover'))}">C</button>${rec.story.map(s => {
      const bad = over[s.number]?.length || missing[s.number]?.length;
      return `<button class="sq ${bad ? 'ready' : 'picked'} ${selected === s.number ? 'on' : ''}" data-act="layout-page" data-k="${s.number}" aria-label="${esc(T('sceneN', { n: s.number }))}">${s.number}</button>`; }).join('')}</div>
    <div class="legend"><span class="lp">${esc(T('fits'))}</span><span class="lr">${esc(T('runsOver'))}</span></div></div>`;
  const sizes = [['large', 'previewLarge'], ['small', 'previewSmall']].map(([k, label]) => `<button class="pill" aria-pressed="${S.pvSize === k}" data-act="pv-size" data-k="${k}">${esc(T(label))}</button>`).join('');
  let about = '';
  if (selected > 0) {
    const names = (over[selected] || []).map(l => langName(l, rec.book.languageNames));
    const untitled = (missing[selected] || []).map(l => langName(l, rec.book.languageNames));
    if (names.length) about += `<div class="warn" style="margin-top:12px"><b>${esc(T('pageFull', { n: selected }))}</b><div class="small">${esc(T('pageFullHelp', { languages: names.join(', ') }))}</div></div>`;
    if (untitled.length) about += `<div class="warn" style="margin-top:12px"><b>${esc(T('titleMissing', { n: selected }))}</b><div class="small">${esc(T('titleMissingHelp', { languages: untitled.join(', ') }))}</div></div>`;
    if (st.arrangement === 'one_page' && st.pictures.main !== 'none') {
      const own = st.picture_sizes?.[selected];
      about += `<div class="psrow"><span class="small" style="font-weight:700">${esc(T('scenePictureSize', { n: selected }))}</span>${sizeSlider(selected, own ?? st.picture_size)}
        ${own != null ? `<button class="linkbtn" data-act="lay-scene-reset" data-k="${selected}">${esc(T('useBookSize'))}</button>` : `<span class="tiny muted">${esc(T('sameBook'))}</span>`}</div>`;
    }
  }
  const pane = `<div class="pane"><div class="row" style="margin-bottom:6px"><b style="font-size:17px">${esc(T('preview'))}</b><span class="tiny muted">· ${esc(targetName(target))}</span><div class="grow"></div><div class="pills" role="group" aria-label="${esc(T('previewSize'))}">${sizes}</div></div>
    <div id="pv-slot"></div>${about}</div>`;
  return `${card}<div class="cols">${jump}${pane}</div>`;
}

function pageCaption(p) {
  if (p.kind === 'cover') return T('cover');
  if (p.kind === 'back') return T('backCover');
  if (p.spread > 0) return `${T('sceneN', { n: p.spread })} · ${T('pageN', { n: p.no })}`;
  return T('pageN', { n: p.no });
}
function previewMarkup(data) {
  if (data.sheets) {
    const half = i => i == null ? '<div class="half"><div class="pg"></div></div>' : `<div class="half" data-spread="${data.pages[i].spread}">${data.pages[i].html}</div>`;
    return `<div class="book">${data.sheets.map((pair, i) => `<section class="sheetrow"><div class="cap">${esc(T('sheetSide', { sheet: Math.floor(i / 2) + 1, side: i % 2 + 1 }))}</div><div class="sheet">${half(pair[0])}${half(pair[1])}</div></section>`).join('')}</div>`;
  }
  const rows = [];
  for (const p of data.pages) {
    const last = rows.at(-1);
    if (last && last.spread === p.spread && !['cover', 'back'].includes(p.kind)) last.pages.push(p);
    else rows.push({ spread: p.spread, pages: [p] });
  }
  return `<div class="book">${rows.map(r => `<section class="sp" data-spread="${r.spread}"><div class="cap">${esc(pageCaption(r.pages[0]))}</div><div class="pair">${r.pages.map(p => p.html).join('')}</div></section>`).join('')}</div>`;
}
function fitLayoutPreview() {
  const book = PV.host?.shadowRoot.querySelector('.book');
  if (!book || !PV.data) return;
  const small = S.pvSize === 'small', sheets = !!PV.data.sheets, cols = small ? (sheets ? 2 : 3) : 1;
  const unit = (sheets ? 2 : 2) * PV.data.widthMm + (sheets ? 0 : 4);
  const pairPx = (cols * unit + 12 + (cols - 1) * 9) * 96 / 25.4;
  book.style.setProperty('--cols', cols); book.style.setProperty('--z', Math.max(.05, Math.min(1, (PV.host.clientWidth - 18) / pairPx)).toFixed(4));
  markLayoutPreview();
}
function markLayoutPreview() {
  const root = PV.host?.shadowRoot, selected = S.mine?.rec ? (S.layoutScene[S.mine.rec.id] ?? 0) : 0;
  if (!root) return;
  root.querySelectorAll('[data-spread]').forEach(el => el.classList.toggle('on', +el.dataset.spread === selected));
  root.querySelectorAll('.body').forEach(el => el.classList.toggle('over', PV.overflow.some(x => x.spread === +el.dataset.spread && x.lang === el.dataset.lang)));
}
function measureLayoutPreview(key) {
  const root = PV.host?.shadowRoot;
  if (!root || PV.key !== key) return;
  const next = [...root.querySelectorAll('.body')].filter(el => el.querySelector('.flow')?.scrollHeight > el.clientHeight + 1)
    .map(el => ({ spread: +el.dataset.spread, lang: el.dataset.lang }));
  const changed = JSON.stringify(next) !== JSON.stringify(PV.overflow);
  PV.overflow = next; markLayoutPreview();
  if (changed) render();
}
function mountLayoutPreview() {
  const slot = document.getElementById('pv-slot'), rec = S.mine?.rec;
  if (!slot || !rec || S.route.tab !== 'layout') return;
  const data = layoutData(rec), target = layoutTarget(rec), key = JSON.stringify([rec.id, target, layoutSettings(rec), rec.edits || []]);
  if (!PV.host) {
    PV.host = document.createElement('div'); PV.host.className = 'pvhost'; PV.host.attachShadow({ mode: 'open' });
    PV.host.addEventListener('scroll', () => { PV.scroll = PV.host.scrollTop; });
    PV.host.addEventListener('click', e => { const x = e.composedPath().find(n => n.dataset?.spread); if (!x || +x.dataset.spread < 0) return;
      S.layoutScene[rec.id] = +x.dataset.spread; render(); });
    PV.observer = new ResizeObserver(fitLayoutPreview); PV.observer.observe(PV.host);
  }
  slot.appendChild(PV.host); PV.host.scrollTop = PV.scroll;
  if (PV.key !== key) {
    PV.key = key; PV.data = data; PV.overflow = [];
    PV.host.shadowRoot.innerHTML = `<style>${data.css}\n${PV_CSS}</style>${previewMarkup(data)}`;
    document.fonts.ready.then(() => requestAnimationFrame(() => { fitLayoutPreview(); measureLayoutPreview(key); }));
  } else { PV.data = data; fitLayoutPreview(); markLayoutPreview(); }
}

// ---- The book: eBook Production's renderBook (header with the book's picker pill, nav.steps, the tab) ----
function bookScreen() {
  const { id } = S.route, M = S.mine, back = `<div class="row"><button class="btn" data-act="go" data-k="shelf">${esc(T('backShelf'))}</button></div>`;
  if (!M || M.id !== id || M.loading) return header() + `${back}<div class="loading">${esc(T('loading'))}</div>`;
  if (M.gone) return header() + back + problem('notOnShelf');
  const rec = M.rec, story = S.route.tab === 'story', sent = rec.sent;
  const step = (key, num, state, sub, subId) => `<button class="step ${state}${S.route.tab === key ? ' on' : ''}" role="tab" aria-selected="${S.route.tab === key}" data-act="tab" data-k="${key}">
      <span class="num">${num}</span><span class="lbl"><b>${esc(T(key))}</b><span class="sub"${subId ? ` id="${subId}"` : ''}>${esc(sub)}</span></span></button>`;
  const nav = `<nav class="steps" role="tablist">${step('story', sent ? '✓' : '1', sent ? 'done' : 'yours', storySub(rec), 'storysub')}${step('layout', '2', '', T('layoutSub'))}</nav>`;
  return header(rec) + nav + (story ? storyView(rec) : layoutView(rec));
}
// The Story step's line: sent / approved, else the round and what is waiting to go.
const storySub = rec => rec.sent ? sentText(rec.sent) : [T('roundN', { n: Work.round(rec) }), countText(Work.counts(rec)) || T('storySub')].join(' · ');

// ---- Story, as eBook Production's storyTab ----
// The story is shown once, as page text. Each Replace is kept as made: its new words are marked in the colour of whoever
// made it, and it has one note at the side (the words taken out struck through, the new words, Undo). Commented words are amber.
// Selecting words opens a pop-up: Comment on them, or Replace them. Once the round is sent the story is locked.
const edId = id => `ed-${id}`;
// eBooks' paragraphs(): <mark> runs from per-character flags. `tag` is p for the story, span for a title line.
function markedHtml(rec, n, f, l, tag = 'p') {
  const L = Work.layer(rec, n, f, l), text = L.text, C = new Array(text.length).fill('');
  const byId = new Map((rec.edits || []).map(e => [e.id, e]));
  if (f === 'text') for (const c of Work.sceneComments(rec, n)) {
    if (!c.quote || c.lang !== l) continue;
    const i = Work.findQuote(text, c.quote, c.position);
    if (i >= 0) for (let j = i; j < i + c.quote.length; j++) C[j] = C[j] || c.id;
  }
  const out = [];
  let off = 0;
  for (const line of text.split('\n')) {
    let html = '', run = '', e = null, c = '';
    const flush = () => {
      if (!run) return;
      html += !e && !c ? esc(run) : `<mark class="${e ? 'e' : ''}${c ? ' c' : ''}" data-act="mark"${e ? ` data-e="${esc(e)}"${hl(byId.get(e)?.by)}` : ''}${c ? ` data-c="${esc(c)}"` : ''}>${esc(run)}</mark>`;
      run = '';
    };
    for (let i = 0; i < line.length; i++) {
      if (L.owner[off + i] !== e || C[off + i] !== c) { flush(); e = L.owner[off + i]; c = C[off + i]; }
      run += line[i];
    }
    flush();
    out.push(`<${tag} data-para data-n="${n}" data-f="${f}" data-l="${esc(l)}" data-off="${off}"${tag === 'p' && !line.trim() ? ' class="gap"' : ''}>${html}</${tag}>`);
    off += line.length + 1;
  }
  return out.join('');
}
const langLabel = (l, names) => /^(zh|ja|ko)/.test(l) ? langName(l, names) : l.toUpperCase();
// One note per Replace (eBooks' .note.edit): "<avatar> changed", the words taken out struck through, the new words, Undo.
function editNote(rec, e, locked) {
  return `<div class="note edit" id="${esc(edId(e.id))}"${hl(e.by)}><div class="head"><span class="chip">${esc(langLabel(e.lang, rec.book.languageNames))}${e.field === 'title' ? ` · ${esc(T('fTitle'))}` : ''}</span>${Th('whoChanged', { name: chip(e.by) })}</div>
      ${e.quote ? `<div class="quote" lang="${esc(e.lang)}" style="text-decoration:line-through;opacity:.7">${esc(e.quote)}</div>` : ''}
      ${e.text ? `<button class="chnow" data-act="show-change" data-k="${esc(e.id)}" lang="${esc(e.lang)}">${esc(e.text)}</button>` : `<div class="tiny muted">${esc(T('removedW'))}</div>`}
      <div class="tiny muted">${esc(when(e.at))}</div>
      ${locked ? '' : `<div class="row" style="justify-content:flex-end"><button class="btn small quiet" data-act="undo-edit" data-k="${esc(e.id)}">${esc(T('undo'))}</button></div>`}</div>`;
}
// eBooks' pop-up under selected words: one box for a comment or the new words. A title can only be changed.
function popHtml() {
  const P = S.pop;
  if (!P || !S.mine?.rec) return '';
  const t = P.f === 'title';
  return `<div class="pop" id="pop" role="dialog" aria-labelledby="poph" style="top:${P.top}px;left:${P.left}px">
    <div class="tiny muted" style="font-weight:700" id="poph">${esc(T(t ? 'popTitleT' : 'popTitle'))} · ${esc(langName(P.l, S.mine.rec.book.languageNames))}</div>
    <div class="quote" lang="${esc(P.l)}">${esc(P.quote)}</div>
    <label class="field tiny muted" style="font-weight:600">${esc(T(t ? 'newWords' : 'draftLbl'))}<textarea class="box" rows="3" id="draft">${esc(P.draft || '')}</textarea></label>
    <div class="tiny muted">${esc(T(t ? 'popHelpT' : 'popHelp'))}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn small" data-act="pop-cancel">${esc(T('cancel'))}</button><button class="btn small" data-act="pop-replace">${esc(T('replace'))}</button>${t ? '' : `<button class="btn small primary" data-act="pop-comment">${esc(T('comment'))}</button>`}</div></div>`;
}

function storyView(rec) {
  const id = rec.id, book = rec.book, langs = book.languages, story = rec.story, m = story.length, names = book.languageNames;
  const n = Math.min(S.route.n, m), view = viewOf(id, langs), all = view === 'all', shown = all ? langs : [view];
  const tl = all ? langs[0] : view, locked = !!rec.sent;
  const sceneTitle = x => Work.value(rec, x, 'title', tl);
  // One line a scene, in view while you read; a phone shows "Scene 3".
  const side = `<div class="side compact"><div class="eyebrow">${esc(T('scenes').toLocaleUpperCase(S.ui))}</div>${story.map(s => {
    const x = s.number, cc = Work.sceneComments(rec, x).length, ch = Work.sceneChanged(rec, x);
    return `<button class="item ${x === n ? 'on' : ''}" data-act="scene" data-k="${x}" ${x === n ? 'aria-current="true"' : ''} title="${esc(sceneTitle(x))}"><span class="t"><span class="t1"><b><span class="lbl">${esc(T('sceneN', { n: x }))}</span><span class="nonly">${x}</span></b><span class="ttl" lang="${esc(tl)}">${esc(sceneTitle(x))}</span></span></span>${ch ? `<span class="rtag mine" title="${esc(T('changed'))}">✎</span>` : ''}${cc ? `<span class="count" title="${esc(T(cc === 1 ? 'cm1' : 'cmN', { n: cc }))}">${cc}</span>` : ''}</button>`;
  }).join('')}</div>`;
  const pills = [...langs.map(l => ({ code: l, label: langLabel(l, names) })), ...(langs.length > 1 ? [{ code: 'all', label: T('allLangs') }] : [])]
    .map(p => `<button class="pill" aria-pressed="${p.code === view}" data-act="view" data-k="${esc(p.code)}"${p.code === 'all' ? '' : ` lang="${esc(p.code)}" title="${esc(langName(p.code, names))}"`}>${esc(p.label)}</button>`).join('');
  const blocks = shown.map(l => `<div class="block" lang="${esc(l)}">${all ? `<div class="lname">${esc(langName(l, names).toLocaleUpperCase(l))}</div><div class="btitle">${markedHtml(rec, n, 'title', l, 'span')}</div>` : ''}
      ${markedHtml(rec, n, 'text', l)}</div>`).join('');
  const heading = all ? esc(sceneTitle(n)) : markedHtml(rec, n, 'title', view, 'span');
  const navBtn = (x, dir) => x >= 1 && x <= m ? `<button class="btn small" data-act="scene" data-k="${x}">${esc(T(dir < 0 ? 'prevScene' : 'nextScene', { n: x }))}</button>` : '<span></span>';
  const nav = m > 1 ? `<div class="spnav">${navBtn(n - 1, -1)}${navBtn(n + 1, 1)}</div>` : '';
  const hint = `<div class="hint">${locked ? `<span>${esc(T('lockedHint'))}</span>` : `${ICON_PEN}<span style="flex:1 1 220px">${esc(T('selHint'))}</span>`}${whoAmI()}</div>`;
  const pane = `<div class="pane" id="pane"><div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:18px">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="small muted" style="font-weight:700">${esc(T('sceneOf', { n, m }))}<span class="savest ${S.save === 'fail' ? 'bad' : ''}" id="savest" aria-live="polite">${esc(saveText())}</span></span>
      <span class="heading" lang="${esc(tl)}" id="scenetitle">${heading}</span></div>
      ${pills ? `<div class="pills" role="group" aria-label="${esc(T('showLang'))}">${pills}</div>` : ''}</div>
    <div class="story" id="storytext">${blocks}</div>
    ${hint}${nav}${S.pop?.n === n && shown.includes(S.pop.l) && !locked ? popHtml() : ''}</div>`;
  // Comments: Edit and Remove for their own maker while the round is open (no replies, no Resolve: the author's next round answers).
  const own = by => !locked && Id.isOwn(by, S.me, OLD_NAME);
  const card = c => `<div class="note" id="cm-${esc(c.id)}"${hl(c.by)}><div class="head">${c.lang ? `<span class="chip">${esc(langLabel(c.lang, names))}</span>` : ''}${chip(c.by)}</div>
      ${c.quote ? `<button class="quote" data-act="show-comment" data-k="${esc(c.id)}" lang="${esc(c.lang)}">${esc(c.quote)}</button>` : `<div class="quote">${esc(T('wholeScene'))}</div>`}
      ${S.editC?.k === c.id ? `<textarea class="box" rows="3" id="ced" aria-label="${esc(T('edit'))}">${esc(S.editC.draft)}</textarea>
        <div class="row" style="justify-content:flex-end"><button class="btn small" data-act="edit-cancel">${esc(T('cancel'))}</button><button class="btn small primary" data-act="edit-save">${esc(T('save'))}</button></div>`
        : `<div style="font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere">${esc(c.text)}</div>`}
      <div class="tiny muted">${esc(when(c.made))}${c.edited ? ` · ${esc(T('editedT'))}` : ''}</div>
      ${S.delC === c.id ? `<div class="row" style="justify-content:flex-end"><b class="small" style="flex:1 1 100%">${esc(T('delC'))}</b><button class="btn small" data-act="del-c-no">${esc(T('keepIt'))}</button><button class="btn small danger-solid" data-act="del-c-yes" data-k="${esc(c.id)}">${esc(T('del'))}</button></div>`
        : S.editC?.k === c.id || !own(c.by) ? ''
        : `<div class="row" style="justify-content:flex-end"><button class="btn small quiet" data-act="edit-c" data-k="${esc(c.id)}">${esc(T('edit'))}</button><button class="btn small quiet danger" data-act="del-comment" data-k="${esc(c.id)}">${esc(T('del'))}</button></div>`}</div>`;
  const notes = Work.sceneComments(rec, n).map(card).join('') + Work.sceneEdits(rec, n).map(e => editNote(rec, e, locked)).join('');
  const aside = `<aside class="notes" aria-label="${esc(T('notesOn'))}"><div class="eyebrow">${esc(T('notesOn').toLocaleUpperCase(S.ui))}</div>
      ${notes || `<div class="note muted small" style="border-style:dashed">${esc(T('noComments'))}</div>`}</aside>`;
  return `${doneBar(rec)}<div class="cols">${side}${pane}${aside}</div>${nextBar(rec)}`;
}

// Sent back or approved: eBooks' done-bar (reopenBar) above the story, with Save the file again and Unlock.
function doneBar(rec) {
  if (!rec.sent) return '';
  const fin = rec.sent.kind === 'final';
  return `<div class="done-bar"><span class="tick">${ICON_TICK}</span><div class="grow" style="flex-basis:260px"><b>${esc(T(fin ? 'approvedBar' : 'sentBar', { n: fin ? rec.sent.round : rec.sent.round + 1, t: when(rec.sent.at) }))}</b>
    <div class="small muted">${esc(T(fin ? 'approvedSub' : 'sentSub'))}</div></div>
    <button class="btn small" data-act="save-again">${esc(T('saveAgain'))}</button><button class="btn small" data-act="unlock">${esc(T('unlock'))}</button></div>`;
}
// eBooks' Next round bar (nextRound, fold): what goes, + Note for this round (the whole story),
// Send back for round n+1 (the author rewrites) or Approve story (final: kept as lessons, nothing rewritten).
function nextBar(rec) {
  if (rec.sent) return '';
  const R = Work.round(rec), open = S.noteOpen[rec.id] || !!(rec.note || '').trim();
  const box = open ? `<label class="field small">${esc(T('noteRound'))}<textarea class="box" id="rnote" rows="2" placeholder="${esc(T('notePh'))}">${esc(rec.note || '')}</textarea></label>` : '';
  return `<section class="next nr fold" aria-label="${esc(T('nextRound'))}">
    <div class="nr-foot"><div class="nr-a"><div class="nr-title"><b>${esc(T('nextRound'))}</b><span class="muted" id="nrst">${esc(sendLine(rec))}</span></div>
      ${open ? '' : `<button class="btn small quiet" data-act="note-open">+ ${esc(T('noteRound'))}</button>`}</div><div class="grow"></div>
      <div class="nr-b"><button class="btn" data-act="ask-send" data-k="rewrite" id="sendbtn" ${countText(Work.counts(rec)) ? '' : 'disabled'}>${esc(T('sendRound', { n: R + 1 }))}</button>
        <button class="btn primary" data-act="ask-send" data-k="final">${esc(T('approve'))}</button></div></div>${box}</section>`;
}
const sendLine = rec => { const w = countText(Work.counts(rec)); return w ? T('toSend', { what: w }) : T('nothingYet'); };
// Typing the round note doesn't re-render (it would lose the caret): the counts follow in place.
function liveCounts(rec) {
  const st = document.getElementById('nrst'), b = document.getElementById('sendbtn'), sub = document.getElementById('storysub');
  if (st) st.textContent = sendLine(rec);
  if (b) b.disabled = !countText(Work.counts(rec));
  if (sub) sub.textContent = storySub(rec);
}
// Send back / Approve story: a file is saved on this device; the reader sends it to the author (email, chat).
function sendSheet() {
  const rec = S.mine?.rec;
  if (!S.sendAsk || !rec || S.route.view !== 'book') return '';
  const fin = S.sendAsk === 'final', file = `<b>${esc(fileName(rec))}</b>`;
  return `<div class="sheetbox" data-act="send-close"><section class="card" role="dialog" aria-modal="true" aria-labelledby="sh" aria-describedby="sp" data-stop="1">
    <h2 id="sh">${esc(T(fin ? 'approveQ' : 'sendQ', { n: Work.round(rec) + 1 }))}</h2>
    <p id="sp">${Th(fin ? 'approveHelp' : 'sendHelp', { n: Work.round(rec) + 1, file })}</p>
    ${countText(Work.counts(rec)) ? `<p class="muted">${esc(T('toSend', { what: countText(Work.counts(rec)) }))}</p>` : ''}
    <div class="sheetacts"><button class="btn bigbtn" data-act="send-close">${esc(T('cancel'))}</button><button class="btn primary bigbtn" data-act="send-yes">${esc(T('saveFile'))}</button></div></section></div>`;
}
const fileName = rec => `${(titleOf(rec.book.titles, rec.book.languages) || rec.id).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'book'}.changes.json`;
function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
  S.dirty = true; setSave('saving');
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 600);
}
function flushSave() {
  clearTimeout(saveTimer);
  const M = S.mine;
  if (!M?.rec || !S.dirty) return;
  S.dirty = false;
  const { id, rec } = M, work = structuredClone({ edits: rec.edits || [], comments: rec.comments || [], note: rec.note || '', sent: rec.sent || null,
    layout: rec.layout || { target: 'a5', settings: {} } });
  Shelf.saveWork(id, work).then(changed => {
    const b = S.shelf?.find(x => x.id === id);
    if (b) { Object.assign(b, work, { changed }); delete b.editBy; if (!work.sent) delete b.sent; }
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
  const main = r.view === 'read' ? readerScreen() : r.view === 'book' ? bookScreen()
    : homeTabs(r.view) + (r.view === 'shelf' ? shelfView() : libraryView());
  const app = document.getElementById('app');
  // Keep the box being typed in: same element id → same focus, cursor, selection and scroll.
  const f = document.activeElement, keep = f?.id && app.contains(f)
    ? { id: f.id, s: f.selectionStart, e: f.selectionEnd, d: f.selectionDirection, top: f.scrollTop } : null;
  app.classList.toggle('selecting', S.selecting && r.view === 'shelf');
  app.innerHTML = (r.view === 'book' ? '' : header()) + main + actBar() + shelfSheet() + sendSheet() + nameSheet() + langSheet();
  const el = keep && document.getElementById(keep.id);
  if (el) {
    el.focus({ preventScroll: true });
    if (typeof keep.s === 'number' && el.setSelectionRange) try { el.setSelectionRange(keep.s, keep.e, keep.d || 'none'); } catch { /* not a text box */ }
    el.scrollTop = keep.top;
  }
  if (r.view === 'book' && r.tab === 'layout') mountLayoutPreview();
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
  if (['lang-close', 'sheet-close', 'name-close', 'send-close'].includes(b.dataset.act) && b.classList.contains('sheetbox') && e.target.closest('[data-stop]')) return;
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
  if (a === 'home-view' || a === 'home-filter') { S.home[a === 'home-view' ? 'view' : 'filter'] = k; store.set('be.home', JSON.stringify(S.home)); return render(); }
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
  if (S.route.view === 'book' && S.route.tab === 'layout' && layoutClick(a, k, b)) return;
  return storyClick(a, k);
});

function layoutClick(a, k, button) {
  const rec = S.mine?.rec;
  if (!rec) return false;
  if (a === 'layout-page') {
    S.layoutScene[rec.id] = +k; render();
    requestAnimationFrame(() => PV.host?.shadowRoot.querySelector(`[data-spread="${+k}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return true;
  }
  if (a === 'pv-size') { S.pvSize = k === 'small' ? 'small' : 'large'; render(); return true; }
  if (a === 'lay-pick') { try { patchLayout(rec, JSON.parse(button.dataset.patch || '{}')); } catch { /* a malformed UI patch is ignored */ } return true; }
  if (a === 'lay-lang') {
    const st = layoutSettings(rec), code = button.dataset.code, on = st.languages.includes(code), max = layoutTarget(rec) === 'a5' ? 3 : Infinity;
    if (on && st.languages.length === 1) { toast(T('oneLanguage')); return true; }
    if (!on && st.languages.length >= max) return true;
    st.languages = on ? st.languages.filter(x => x !== code) : [...st.languages, code];
    setLayout(rec, layoutTarget(rec), st); render(); return true;
  }
  if (a === 'lay-scene-reset') { patchLayout(rec, { picture_sizes: { [k]: null } }); return true; }
  if (a === 'layout-export') { toast(T(layoutTarget(rec) === 'changes' ? 'layoutSendSoon' : 'layoutExportSoon')); return true; }
  return false;
}

// ---- Story actions ----
function storyClick(a, k) {
  const M = S.mine, r = S.route;
  if (!M?.rec || r.view !== 'book') return;
  const rec = M.rec, id = rec.id, n = r.n, locked = !!rec.sent;
  const needName = () => { if (S.me) return false; openId(); render(); document.querySelector('.symbtn')?.focus(); return true; };
  const focusId = id2 => { const el = document.getElementById(id2); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (a === 'name-open') { openId(); render(); return document.querySelector('.symbtn[aria-pressed="true"]')?.focus() ?? document.querySelector('.symbtn')?.focus(); }
  if (a === 'name-close') { S.nameSheet = false; S.idDraft = null; return render(); }
  if ((a === 'id-sym' || a === 'id-col') && S.idDraft) {
    S.idDraft[a === 'id-sym' ? 'symbol' : 'colour'] = k; render();
    return document.querySelector(`[data-act="${a}"][data-k="${k}"]`)?.focus();
  }
  if (a === 'name-save') return saveName();
  if (a === 'tab') return go(k === 'layout' ? `book/${encodeURIComponent(id)}/layout` : bookHash(id), true);
  if (a === 'scene') { S.pop = null; return go(bookHash(id, +k), true); }
  if (a === 'view') { S.view[id] = k; S.pop = null; return render(); }
  if (a === 'show-change') {
    const e = (rec.edits || []).find(x => x.id === k);
    if (!e) return;
    if (!shownLangs(rec).includes(e.lang)) { S.view[id] = e.lang; render(); }
    return flash(document.querySelector(`#pane mark[data-e="${CSS.escape(e.id)}"]`));
  }
  if (a === 'show-comment') {
    const c = (rec.comments || []).find(x => x.id === k);
    if (!c) return;
    if (!shownLangs(rec).includes(c.lang)) { S.view[id] = c.lang; render(); }
    return flash(document.querySelector(`#pane mark[data-c="${CSS.escape(c.id)}"]`));
  }
  // The round: Send back / Approve story make the file; Unlock opens the story again.
  if (a === 'ask-send') { S.sendAsk = k === 'final' ? 'final' : 'rewrite'; render(); return document.querySelector('[data-act="send-yes"]')?.focus(); }
  if (a === 'send-close') { S.sendAsk = null; render(); return document.querySelector('[data-act="ask-send"]')?.focus(); }
  if (a === 'send-yes' || a === 'save-again') {
    const kind = a === 'save-again' ? rec.sent?.kind : S.sendAsk;
    const file = kind && Work.changesFile(rec, S.me, kind);
    if (!file) { S.sendAsk = null; render(); return toast(T('nothingYet')); }
    download(fileName(rec), file);
    if (a === 'send-yes') { rec.sent = { kind, round: Work.round(rec), at: new Date().toISOString() }; S.sendAsk = null; S.pop = null; S.editC = null; S.delC = null; queueSave(); flushSave(); render(); }
    toast(T('fileSaved', { file: fileName(rec) }));
    return document.querySelector('[data-act="save-again"]')?.focus();
  }
  if (a === 'unlock' && locked) { delete rec.sent; queueSave(); render(); return document.querySelector('[data-act="ask-send"]')?.focus(); }
  if (locked) return;                                            // sent: nothing below may change the story
  if (a === 'note-open') { S.noteOpen[id] = true; render(); return focusId('rnote'); }
  if (a === 'edit-c') { const c = (rec.comments || []).find(x => x.id === k); S.editC = { k, draft: c?.text || '' }; render(); return focusId('ced'); }
  if (a === 'edit-cancel') { S.editC = null; return render(); }
  if (a === 'edit-save') {
    const text = (document.getElementById('ced')?.value || '').trim(), c = (rec.comments || []).find(x => x.id === S.editC?.k);
    if (!text) return document.getElementById('ced')?.focus();
    if (c && c.text !== text) { c.text = text; c.edited = new Date().toISOString(); queueSave(); }
    S.editC = null; return render();
  }
  if (a === 'del-comment') { S.delC = k; return render(); }
  if (a === 'del-c-no') { S.delC = null; return render(); }
  if (a === 'del-c-yes') { rec.comments = (rec.comments || []).filter(c => c.id !== k); S.delC = null; queueSave(); return render(); }
  // Undo one Replace. One made on top of its new words goes with it.
  if (a === 'undo-edit') {
    const gone = Work.undoEdit(rec, k);
    if (!gone) return;
    queueSave(); render();
    if (gone > 1) toast(T('undoneN', { n: gone }));
    return;
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
    const e = Work.replace(rec, n, P.f, P.l, P.start, P.end, words, myBy());
    S.pop = null; getSelection()?.removeAllRanges();
    if (!e) return render();
    queueSave(); render();
    return flash(document.getElementById(edId(e.id)), true);
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
  if (r.view !== 'book' || r.tab !== 'story' || !S.mine?.rec || S.mine.rec.sent || S.composing || S.nameSheet || S.sendAsk) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0), box = document.getElementById('pane');
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
  const pane = box.getBoundingClientRect(), rect = range.getBoundingClientRect();
  S.pop = { n, f, l, start, end, quote: text.slice(start, end), draft: P?.draft || '', top: Math.round(rect.bottom - pane.top + 8),
    left: Math.round(Math.max(12, Math.min(rect.left - pane.left, pane.width - 352))) };
  const old = document.getElementById('pop');
  if (old) old.outerHTML = popHtml(); else box.insertAdjacentHTML('beforeend', popHtml());
  if (focus) focusDraft();
}
function focusDraft() {
  const d = document.getElementById('draft');
  d?.focus({ preventScroll: true });
  document.getElementById('pop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Mouse: at once, typing goes straight into the box. Touch (long-press, handles) and keyboard: after the selection settles,
// without moving focus, so the selection stays adjustable.
document.addEventListener('mouseup', e => { if (e.target.closest?.('#pane [data-para]')) setTimeout(() => onSelect(true), 0); });
let selTimer;
document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(() => onSelect(false), 450); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.langSheet) { S.langSheet = false; render(); return; }
  if (e.key === 'Escape' && S.pop && S.route.view === 'book') { S.pop = null; getSelection()?.removeAllRanges(); return render(); }
  if (e.key === 'Escape' && S.sendAsk && S.route.view === 'book') { S.sendAsk = null; render(); return document.querySelector('[data-act="ask-send"]')?.focus(); }
  if (e.key === 'Escape' && S.sheet) return closeSheet();
  if (e.key === 'Enter' && e.target.id === 'nf') { e.preventDefault(); return createFolder(); }
  if (e.key === 'Enter' && e.target.id === 'nm') { e.preventDefault(); return saveName(); }
  if (e.key === 'Escape' && S.nameSheet) { S.nameSheet = false; S.idDraft = null; return render(); }
  if (S.route.view !== 'read' || S.langSheet || e.target.matches('input,textarea,select')) return;
  const story = S.books[S.route.id]?.story;
  if (!story) return;
  const at = Math.min(S.route.at, story.length), base = `${S.route.view}/${encodeURIComponent(S.route.id)}/`;
  if (e.key === 'ArrowRight' && at < story.length) go(base + (at + 1), true);
  else if (e.key === 'ArrowLeft' && at > 0) go(base + (at - 1), true);
});
window.addEventListener('hashchange', onRoute);

// Typing in a comment, reply or pop-up box: keep the draft (a re-render puts it back).
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-lay-size]')) { const out = el.parentElement?.querySelector('output'); if (out) out.textContent = `${el.value}%`; return; }
  if (el.id === 'rnote' && S.mine?.rec && !S.mine.rec.sent) { S.mine.rec.note = el.value; queueSave(); return liveCounts(S.mine.rec); }
  if (el.id === 'ced' && S.editC) { S.editC.draft = el.value; return; }
  if (el.id === 'nm' && S.idDraft) { S.idDraft.nick = el.value; return; }
  if (el.id === 'draft' && S.pop) { S.pop.draft = el.value; return; }
});
document.addEventListener('change', e => {
  const rec = S.mine?.rec, el = e.target;
  if (rec && S.route.tab === 'layout') {
    if (el.id === 'xt') { const target = Layout.TARGETS.some(([k]) => k === el.value) ? el.value : 'a5'; setLayout(rec, target, layoutSettings(rec, target)); render(); return; }
    if (el.matches('[data-lay-page]')) { const [w, h] = el.value.split(',').map(Number); patchLayout(rec, { page: { w, h } }); return; }
    if (el.matches('[data-lay-body]')) { patchLayout(rec, { body_pt: +el.value }); return; }
    if (el.matches('[data-lay-arr]')) {
      const v = el.value, one = v.startsWith('one_page_');
      patchLayout(rec, one ? { arrangement: 'one_page', picture_width: v.slice(9) } : { arrangement: v }); return;
    }
    if (el.matches('[data-lay-size]')) {
      const key = el.dataset.laySize, value = +el.value / 100;
      patchLayout(rec, key === 'book' ? { picture_size: value } : { picture_sizes: { [key]: value } }); return;
    }
  }
  if (e.target.id === 'home-sort') { S.home.sort = e.target.value; store.set('be.home', JSON.stringify(S.home)); render(); return document.getElementById('home-sort')?.focus(); }
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
