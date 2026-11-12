// The reader's own work on a shelf book: changed words, comments, the round. No DOM here.
// Same model as eBook Production's Story: each Replace is kept AS MADE, one entry per Replace.
//
// Kept on the shelf book record (shelf.js):
//   edits    [{ id, spread, field: 'title'|'text', lang, quote, text, start, by, at }]   in the order made.
//            quote = the words replaced, text = the new words ('' = taken out),
//            start = where quote began in the field's words just before this Replace.
//            A field's words = the book's words with every edit put in, in order.
//   comments [{ id, spread, lang?, quote?, position?, text, by, made, edited? }]
//            on selected words (lang, quote, position = where quote starts in the reader's text);
//            older data may also hold whole-scene comments (spread + text only).
//   note     this round's note for the whole story ('' = none)
//   sent     { kind: 'rewrite'|'final', round, at } once Send back or Approve story made the file; the story is locked
//   changed  ISO time of the last save
// `by` = the reader's identity { id, symbol, colour, nick? } (identity.js); older data: a typed name.
// The changes file it becomes is described in docs/book-file-format.md §2.

import { resolve } from './identity.js';

export const FIELDS = ['title', 'text'];
const newId = () => globalThis.crypto?.randomUUID?.() || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Bring a record saved by an older Book Editor up to date (in place). Returns true when it changed.
 * Before 2026-11-12 `edits` was { "n|field|lang": whole new words } with `editBy`: each becomes one edit
 * that replaces the whole field. Replies and "resolved" are no longer used (rounds replace them).
 */
export function migrate(rec) {
  if (!rec.edits || Array.isArray(rec.edits)) { rec.edits = rec.edits || []; return false; }
  const old = rec.edits, by = rec.editBy || {}, out = [];
  for (const [k, words] of Object.entries(old)) {
    const [n, field, lang] = k.split('|');
    const was = bookValue(rec, +n, field, lang);
    if (words === was) continue;
    out.push({ id: newId(), spread: +n, field, lang, quote: was, text: String(words), start: 0, by: by[k]?.by || '', at: by[k]?.at || rec.changed || '' });
  }
  rec.edits = out;
  delete rec.editBy;
  return true;
}

/** The book's own words for a scene field ('' when missing). */
export function bookValue(rec, n, field, lang) {
  const s = rec.story.find(x => x.number === n);
  return String(s?.[field]?.[lang] ?? '');
}

/** Where `quote` starts in `text`, nearest to `near`; -1 when it is not there any more. */
export function findQuote(text, quote, near = 0) {
  if (!quote) return -1;
  let best = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1))
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  return best;
}

const mine = (e, n, field, lang) => e.spread === n && e.field === field && e.lang === lang;

/**
 * A field with the reader's edits put in, in order: { text, owner, applied }.
 * owner[i] = id of the edit whose new words hold character i (null = the book's own words).
 * applied = ids of the edits that went in (one whose words are gone, after an Undo under it, is skipped).
 */
export function layer(rec, n, field, lang) {
  let chars = Array.from(bookValue(rec, n, field, lang).split(''), ch => [ch, null]);
  const applied = new Set();
  for (const e of rec.edits || []) {
    if (!mine(e, n, field, lang)) continue;
    const text = chars.map(c => c[0]).join('');
    let at = e.start;
    if (!(e.quote ? text.slice(at, at + e.quote.length) === e.quote : at >= 0 && at <= text.length))
      at = findQuote(text, e.quote, e.start);
    if (at < 0) continue;
    chars.splice(at, e.quote.length, ...e.text.split('').map(ch => [ch, e.id]));
    applied.add(e.id);
  }
  return { text: chars.map(c => c[0]).join(''), owner: chars.map(c => c[1]), applied };
}

/** The words the reader sees: the book's with their edits in. */
export const value = (rec, n, field, lang) => layer(rec, n, field, lang).text;

/** The edits that are in a scene, in the order made. */
export function sceneEdits(rec, n) {
  const out = [];
  for (const lang of rec.book.languages) for (const field of FIELDS) {
    const { applied } = layer(rec, n, field, lang);
    out.push(...(rec.edits || []).filter(e => applied.has(e.id)));
  }
  return out.sort((a, b) => rec.edits.indexOf(a) - rec.edits.indexOf(b));
}
export const sceneChanged = (rec, n) => rec.book.languages.some(l => FIELDS.some(f => value(rec, n, f, l) !== bookValue(rec, n, f, l)));
export const sceneComments = (rec, n) => (rec.comments || []).filter(c => c.spread === n);

/**
 * Replace the reader's words from `start` to `end` with `words` (empty = take them out). Kept as one edit.
 * Returns the edit, or null when nothing changed.
 */
export function replace(rec, n, field, lang, start, end, words, by) {
  const t = value(rec, n, field, lang);
  // Taking words out of the middle of a sentence: don't leave two spaces behind.
  if (!words && t[end] === ' ' && (start === 0 || /\s/.test(t[start - 1]))) end++;
  const quote = t.slice(start, end);
  if (quote === words) return null;
  const e = { id: newId(), spread: n, field, lang, quote, text: words, start, by: by || '', at: new Date().toISOString() };
  (rec.edits = rec.edits || []).push(e);
  return e;
}

/**
 * Undo one edit. A later edit made on top of its new words can't stand without them, so it goes too.
 * Returns how many edits were undone.
 */
export function undoEdit(rec, id) {
  const e = (rec.edits || []).find(x => x.id === id);
  if (!e) return 0;
  const before = rec.edits.length;
  rec.edits = rec.edits.filter(x => x !== e);
  const { applied } = layer(rec, e.spread, e.field, e.lang);
  rec.edits = rec.edits.filter(x => !mine(x, e.spread, e.field, e.lang) || applied.has(x.id));
  return before - rec.edits.length;
}

/** Every changed field, in scene order, then the book's language order, title before text (changes file §2). */
export function changeList(rec, me) {
  const out = [];
  const story = rec.story.slice().sort((a, b) => a.number - b.number);
  for (const s of story) for (const lang of rec.book.languages) for (const field of FIELDS) {
    const was = bookValue(rec, s.number, field, lang), L = layer(rec, s.number, field, lang);
    if (L.text === was) continue;
    const last = (rec.edits || []).filter(e => L.applied.has(e.id)).pop() || {};
    out.push({ spread: s.number, lang, field, was, now: L.text,
      ...(last.by ? { by: resolve(last.by, me) } : {}), ...(last.at ? { at: last.at } : {}) });
  }
  return out;
}
/** The edits that are in the book, as made (changes file §2 `edits`). */
export function editList(rec, me) {
  const out = [];
  for (const s of rec.story.slice().sort((a, b) => a.number - b.number))
    for (const e of sceneEdits(rec, s.number))
      out.push({ spread: e.spread, lang: e.lang, field: e.field, quote: e.quote, text: e.text, position: e.start,
        ...(e.by ? { by: resolve(e.by, me) } : {}), ...(e.at ? { at: e.at } : {}) });
  return out;
}

/** How much there is to send: c = edits in the book, n = comments, note = a note for this round. */
export function counts(rec) {
  let c = 0;
  if (Array.isArray(rec.edits) && rec.story) for (const s of rec.story) c += sceneEdits(rec, s.number).length;
  else if (rec.edits) c = Object.keys(rec.edits).length;           // an older record not opened since
  return { c, n: (rec.comments || []).length, note: !!(rec.note || '').trim() };
}

/** The round being reviewed: the book's own number (from the author), else 1. */
export const round = rec => Math.max(1, parseInt(rec.book?.round, 10) || 1);

export function newComment({ spread, lang, quote, position, text, by }) {
  const c = { id: newId(), spread, text, by, made: new Date().toISOString() };
  if (quote) Object.assign(c, { lang, quote, position });
  return c;
}

/**
 * The changes file (docs/book-file-format.md §2). `kind` = 'rewrite' (Send back) or 'final' (Approve story).
 * Null when a Send back would carry nothing; an approval is always sent, even with nothing in it.
 * A comment's position follows its words if the reader changed the text after commenting.
 * `me` = the reader's current identity: their own marks carry it, even if they changed it after making them.
 */
export function changesFile(rec, me, kind = 'rewrite', layout) {
  const changes = changeList(rec, me), edits = editList(rec, me), W = by => resolve(by, me) || '';
  const comments = (rec.comments || []).slice().sort((a, b) => a.spread - b.spread || String(a.made).localeCompare(String(b.made))).map(c => {
    const who = { by: W(c.by), made: c.made, ...(c.edited ? { edited: c.edited } : {}) };
    if (!c.quote) return { spread: c.spread, text: c.text, ...who };
    const i = findQuote(value(rec, c.spread, 'text', c.lang), c.quote, c.position);
    return { spread: c.spread, lang: c.lang, quote: c.quote, position: i >= 0 ? i : c.position, text: c.text, ...who };
  });
  const note = (rec.note || '').trim();
  if (kind !== 'final' && !changes.length && !comments.length && !note) return null;
  const out = {
    format: 'book-editor-changes', formatVersion: 1,
    book: { id: rec.book.id, bookVersion: rec.book.bookVersion, fingerprint: rec.book.fingerprint },
    saved: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    round: round(rec), send: kind === 'final' ? 'final' : 'rewrite',
    ...(note ? { note } : {}),
    changes, edits, comments,
  };
  if (layout) out.layout = layout;
  return out;
}
