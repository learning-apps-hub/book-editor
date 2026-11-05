// Book Editor — app shell (build step 3): display language, My shelf / Library tabs, read-only reader.
// File formats: docs/book-file-format.md. No build step; plain ES modules.
import { UI, langName } from './i18n.js';

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

// ---- Routes: #library, #shelf, #read/<id>/<page> (page 0 = cover). Browser Back works. ----
function parseRoute() {
  const [view, id, at] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (view === 'shelf') return { view: 'shelf' };
  if (view === 'read' && id) return { view: 'read', id, at: Math.max(0, parseInt(at, 10) || 0) };
  return { view: 'library' };
}
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, '', '#' + hash); else location.hash = hash;
  if (replace) onRoute();
};
function onRoute() {
  const prev = S.route;
  S.route = parseRoute();
  if (S.route.view === 'read' && S.lib) loadBook(S.route.id);
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
  const n = { shelf: 0, library: S.lib ? S.lib.books.length : '' };
  const tab = (k, icon) => `<button class="htab" role="tab" aria-selected="${active === k}" data-act="go" data-k="${k}">${icon}<span>${esc(T(k === 'shelf' ? 'myShelf' : 'library'))}</span>${n[k] === '' ? '' : `<span class="cnt">${n[k]}</span>`}</button>`;
  return `<div class="hometabs" role="tablist">${tab('shelf', ICON_SHELF)}${tab('library', ICON_LIB)}</div>`;
}
const problem = (key, act) => `<div class="msg ${key === 'tooNew' ? '' : 'bad'}" role="alert"><p>${esc(T(key))}</p>${act ? `<button class="btn" data-act="${act}">${esc(T('tryAgain'))}</button>` : ''}</div>`;
const sampleNote = () => S.sample ? `<p class="muted" style="margin:0">${esc(T('sample'))}</p>` : '';

function libraryView() {
  if (S.libError) return problem(S.libError, S.libError === 'loadFail' ? 'retry-lib' : null);
  if (!S.lib) return `<div class="loading">${esc(T('loading'))}</div>`;
  const books = S.lib.books.slice().sort((a, b) => String(b.shared).localeCompare(String(a.shared)));
  if (!books.length) return `<div class="empty"><p>${esc(T('libEmpty'))}</p></div>`;
  const card = b => {
    const title = titleOf(b.titles, b.languages, S.ui);
    return `<div class="libcard"><button class="bk" data-act="read" data-k="${esc(b.id)}">
        <span class="cov">${b.cover ? `<img src="${esc(S.libBase + b.cover)}" alt="" loading="lazy">` : ''}<span class="readtag">${ICON_READ}${esc(T('read'))}</span></span>
        <b>${esc(title)}</b><span class="libmeta">${esc((b.languages || []).map(langName).join(' · '))}</span></button>
      <button class="btn primary addbig" data-act="add" data-k="${esc(b.id)}">${ICON_PEN}<span>${esc(T('addShelf'))}<small>${esc(T('addSub'))}</small></span></button></div>`;
  };
  return `<p class="intro">${esc(T('libIntro'))}</p>${sampleNote()}<div class="shelf">${books.map(card).join('')}</div>`;
}
function shelfView() {
  // Step 4 fills this from the device's own storage (IndexedDB).
  return `<div class="empty"><p>${esc(T('shelfEmpty'))}</p><button class="btn primary bigbtn" data-act="go" data-k="library">${ICON_LIB}${esc(T('goLibrary'))}</button></div>`;
}

function readerScreen() {
  const { id } = S.route, back = `<button class="btn bigbtn" data-act="go" data-k="library">${esc(T('backLib'))}</button>`;
  if (S.libError) return problem(S.libError, S.libError === 'loadFail' ? 'retry-lib' : null);
  if (!S.lib) return `<div class="loading">${esc(T('loading'))}</div>`;
  if (!S.lib.books.some(b => b.id === id)) return `<div class="rtop">${back}</div>${problem('notFound')}`;
  const B = S.books[id];
  if (!B || B.loading) return `<div class="rtop">${back}</div><div class="loading">${esc(T('loading'))}</div>`;
  if (B.error) return `<div class="rtop">${back}</div>${problem(B.error, B.error === 'bookFail' ? 'retry-book' : null)}`;

  const { book, story, dir } = B, langs = book.languages, m = story.length;
  let lg = S.readLang[id];
  if (!langs.includes(lg)) lg = langs.includes(S.ui) ? S.ui : langs[0];
  const at = Math.min(S.route.at, m), title = titleOf(book.titles, langs, lg);
  const img = path => path ? `<img src="${esc(dir + path)}" alt="">` : '';
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
  const next = at < m ? `#read/${encodeURIComponent(id)}/${at + 1}` : '';
  return `<section class="card">
    <div class="rtop">${back}<h2 lang="${esc(lg)}">${esc(title)}</h2><span class="rotag">${esc(T('readOnly'))}</span></div>
    ${langs.length > 1 ? `<div class="rlangs" role="group" aria-label="${esc(T('readIn'))}"><span class="lbl">${esc(T('readIn'))}</span>${langs.map(l =>
      `<button class="rlang" lang="${esc(l)}" aria-pressed="${l === lg}" data-act="rlang" data-k="${esc(l)}">${esc(langName(l))}</button>`).join('')}</div>` : ''}
    <div class="rbook ${next ? 'tap' : ''}" ${next ? `data-act="rnav" data-k="${at + 1}"` : ''}>${page}</div>
    <div class="rnav"><span>${at > 0 ? `<button class="btn" data-act="rnav" data-k="${at - 1}">${esc(T('rPrev'))}</button>` : ''}</span>
      <span class="pn">${at === 0 ? esc(T('cover')) : esc(T('pageOf', { n: at, m }))}</span>
      <span>${next ? `<button class="btn primary" data-act="rnav" data-k="${at + 1}">${esc(T('rNext'))}</button>` : ''}</span></div>
  </section>
  <div class="rcall"><p>${esc(T('wantEdit'))}</p><button class="btn primary bigbtn" data-act="add" data-k="${esc(id)}">${ICON_PEN}${esc(T('addShelf'))}</button></div>`;
}

function render() {
  document.documentElement.lang = S.ui;
  const r = S.route;
  const main = r.view === 'read' ? readerScreen() : homeTabs(r.view) + (r.view === 'shelf' ? shelfView() : libraryView());
  document.getElementById('app').innerHTML = header() + main + langSheet();
}
let toastTimer;
function toast(m) {
  const t = document.getElementById('toast');
  t.textContent = m; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---- Events ----
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  // A tap inside the language card (not on a button) must not close the sheet.
  if (b.dataset.act === 'lang-close' && e.target.closest('[data-stop]')) return;
  const a = b.dataset.act, k = b.dataset.k;
  if (a === 'go') return go(k);
  if (a === 'read') return go(`read/${encodeURIComponent(k)}/0`);
  if (a === 'rnav') return go(`read/${encodeURIComponent(S.route.id)}/${k}`, true);
  if (a === 'rlang') { S.readLang[S.route.id] = k; return render(); }
  if (a === 'add') return toast(T('soon'));
  if (a === 'retry-lib') return loadLibrary().then(onRoute);
  if (a === 'retry-book') { delete S.books[S.route.id]; return loadBook(S.route.id); }
  if (a === 'lang-open') { S.langSheet = true; render(); return document.querySelector('.langbtn[aria-pressed="true"]')?.focus(); }
  if (a === 'lang-close') { S.langSheet = false; render(); return document.querySelector('.langbig')?.focus(); }
  if (a === 'ui') { S.ui = k; store.set('be.ui', k); S.langSheet = false; render(); return document.querySelector('.langbig')?.focus(); }
});
document.addEventListener('keydown', e => {
  if (S.langSheet && e.key === 'Escape') { S.langSheet = false; render(); return; }
  if (S.route.view !== 'read' || S.langSheet || e.target.matches('input,textarea,select')) return;
  const B = S.books[S.route.id];
  if (!B?.story) return;
  const at = Math.min(S.route.at, B.story.length);
  if (e.key === 'ArrowRight' && at < B.story.length) go(`read/${encodeURIComponent(S.route.id)}/${at + 1}`, true);
  else if (e.key === 'ArrowLeft' && at > 0) go(`read/${encodeURIComponent(S.route.id)}/${at - 1}`, true);
});
window.addEventListener('hashchange', onRoute);

S.route = parseRoute();
render();
loadLibrary().then(onRoute);
