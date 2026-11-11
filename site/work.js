// The reader's own work on a shelf book: changed words and comments. No DOM here.
//
// Kept on the shelf book record (shelf.js):
//   edits    { "<scene number>|<title|text>|<lang>": words }   only fields that differ from the book
//   comments [{ id, spread, lang?, quote?, position?, text, made }]
//            on selected words (lang, quote, position = where quote starts in the reader's text) or on the whole scene
//   changed  ISO time of the last save
// The changes file it becomes is described in docs/book-file-format.md §2.

export const FIELDS = ['title', 'text'];
const key = (n, field, lang) => `${n}|${field}|${lang}`;

/** The book's own words for a scene field ('' when missing). */
export function bookValue(rec, n, field, lang) {
  const s = rec.story.find(x => x.number === n);
  return String(s?.[field]?.[lang] ?? '');
}

/** The words the reader sees: their change if they made one, else the book's. */
export function value(rec, n, field, lang) {
  const k = key(n, field, lang);
  return rec.edits && k in rec.edits ? rec.edits[k] : bookValue(rec, n, field, lang);
}

/** Store the reader's words. Words equal to the book's remove the change. */
export function setValue(rec, n, field, lang, words) {
  rec.edits = rec.edits || {};
  if (words === bookValue(rec, n, field, lang)) delete rec.edits[key(n, field, lang)];
  else rec.edits[key(n, field, lang)] = words;
}

export const isChanged = (rec, n, field, lang) => !!rec.edits && key(n, field, lang) in rec.edits;
export const sceneChanged = (rec, n) => rec.book.languages.some(l => FIELDS.some(f => isChanged(rec, n, f, l)));
export const sceneComments = (rec, n) => (rec.comments || []).filter(c => c.spread === n);

/** Put a language of a scene back to the book's words. */
export function undo(rec, n, lang) {
  for (const f of FIELDS) if (rec.edits) delete rec.edits[key(n, f, lang)];
}

/** Every change, in scene order, then the book's language order, title before text. */
export function changeList(rec) {
  const out = [];
  const story = rec.story.slice().sort((a, b) => a.number - b.number);
  for (const s of story) for (const lang of rec.book.languages) for (const field of FIELDS)
    if (isChanged(rec, s.number, field, lang))
      out.push({ spread: s.number, lang, field, was: bookValue(rec, s.number, field, lang), now: value(rec, s.number, field, lang) });
  return out;
}

export const counts = rec => ({ c: Object.keys(rec.edits || {}).length, n: (rec.comments || []).length });

/** The book's story with the reader's words in it (for reading their own copy). */
export const appliedStory = rec => rec.story.map(s => ({
  ...s,
  title: Object.fromEntries(rec.book.languages.map(l => [l, value(rec, s.number, 'title', l)])),
  text: Object.fromEntries(rec.book.languages.map(l => [l, value(rec, s.number, 'text', l)])),
}));

/** Where `quote` starts in `text`, nearest to `near`; -1 when it is not there any more. */
export function findQuote(text, quote, near = 0) {
  if (!quote) return -1;
  let best = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1))
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  return best;
}

export function newComment({ spread, lang, quote, position, text }) {
  const id = globalThis.crypto?.randomUUID?.() || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const c = { id, spread, text, made: new Date().toISOString() };
  if (quote) Object.assign(c, { lang, quote, position });
  return c;
}

/**
 * The changes file (docs/book-file-format.md §2), or null when there is nothing to send.
 * A comment's position follows its words if the reader edited the text after commenting.
 */
export function changesFile(rec, layout) {
  const changes = changeList(rec);
  const comments = (rec.comments || []).slice().sort((a, b) => a.spread - b.spread || String(a.made).localeCompare(String(b.made))).map(c => {
    if (!c.quote) return { spread: c.spread, text: c.text };
    const i = findQuote(value(rec, c.spread, 'text', c.lang), c.quote, c.position);
    return { spread: c.spread, lang: c.lang, quote: c.quote, position: i >= 0 ? i : c.position, text: c.text };
  });
  if (!changes.length && !comments.length) return null;
  const out = {
    format: 'book-editor-changes', formatVersion: 1,
    book: { id: rec.book.id, bookVersion: rec.book.bookVersion, fingerprint: rec.book.fingerprint },
    saved: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    changes, comments,
  };
  if (layout) out.layout = layout;
  return out;
}
