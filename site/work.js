// The reader's own work on a shelf book: changed words and comments. No DOM here.
//
// Kept on the shelf book record (shelf.js):
//   edits    { "<scene number>|<title|text>|<lang>": words }   only fields that differ from the book
//   editBy   { same key: { by, at } }   who last changed that field, and when (track changes)
//   comments [{ id, spread, lang?, quote?, position?, text, by, made, edited?, resolved?: { by, at },
//              replies: [{ id, text, by, made, edited? }] }]
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
export function setValue(rec, n, field, lang, words, by) {
  rec.edits = rec.edits || {}; rec.editBy = rec.editBy || {};
  const k = key(n, field, lang);
  if (words === bookValue(rec, n, field, lang)) { delete rec.edits[k]; delete rec.editBy[k]; return; }
  rec.edits[k] = words;
  rec.editBy[k] = { by: by || rec.editBy[k]?.by || '', at: new Date().toISOString() };
}
/** Who last changed a field and when: { by, at } or null. */
export const editInfo = (rec, n, field, lang) => rec.editBy?.[key(n, field, lang)] || null;
/** Put back who/when for a field (after "Put my changes back"). */
export function setEditInfo(rec, n, field, lang, info) {
  if (info && isChanged(rec, n, field, lang)) (rec.editBy = rec.editBy || {})[key(n, field, lang)] = { ...info };
}

export const isChanged = (rec, n, field, lang) => !!rec.edits && key(n, field, lang) in rec.edits;
export const sceneChanged = (rec, n) => rec.book.languages.some(l => FIELDS.some(f => isChanged(rec, n, f, l)));
export const sceneComments = (rec, n) => (rec.comments || []).filter(c => c.spread === n);

/** Put a language of a scene back to the book's words. */
export function undo(rec, n, lang) {
  for (const f of FIELDS) { if (rec.edits) delete rec.edits[key(n, f, lang)]; if (rec.editBy) delete rec.editBy[key(n, f, lang)]; }
}

/** Every change, in scene order, then the book's language order, title before text. */
export function changeList(rec) {
  const out = [];
  const story = rec.story.slice().sort((a, b) => a.number - b.number);
  for (const s of story) for (const lang of rec.book.languages) for (const field of FIELDS)
    if (isChanged(rec, s.number, field, lang))
      out.push({ spread: s.number, lang, field, was: bookValue(rec, s.number, field, lang), now: value(rec, s.number, field, lang),
        ...(editInfo(rec, s.number, field, lang)?.by ? { by: editInfo(rec, s.number, field, lang).by } : {}),
        ...(editInfo(rec, s.number, field, lang)?.at ? { at: editInfo(rec, s.number, field, lang).at } : {}) });
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

const newId = () => globalThis.crypto?.randomUUID?.() || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export function newComment({ spread, lang, quote, position, text, by }) {
  const c = { id: newId(), spread, text, by, made: new Date().toISOString(), replies: [] };
  if (quote) Object.assign(c, { lang, quote, position });
  return c;
}
export const newReply = (text, by) => ({ id: newId(), text, by, made: new Date().toISOString() });
export const openComments = (rec, n) => sceneComments(rec, n).filter(c => !c.resolved);

/**
 * Word-level differences between the book's words and the reader's: [{ t: 'same'|'ins'|'del', s }].
 * Chinese and Japanese are compared character by character (no spaces between words).
 */
export function diff(was, now) {
  const tok = s => s.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{M}\p{N}'’]+|\s+|[^]/gu) || [];
  const a = tok(was), b = tok(now), out = [];
  const push = (t, s) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
  let i0 = 0; while (i0 < a.length && i0 < b.length && a[i0] === b[i0]) push('same', a[i0++]);
  let ea = a.length, eb = b.length; const tail = [];
  while (ea > i0 && eb > i0 && a[ea - 1] === b[eb - 1]) tail.unshift(a[--ea]), eb--;
  const A = a.slice(i0, ea), B = b.slice(i0, eb);
  if (A.length * B.length > 250000) { if (A.length) push('del', A.join('')); if (B.length) push('ins', B.join('')); }
  else {
    const L = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]); else push('ins', B[j++]);
    }
    while (i < A.length) push('del', A[i++]);
    while (j < B.length) push('ins', B[j++]);
  }
  for (const t of tail) push('same', t);
  return out;
}

/**
 * The changes file (docs/book-file-format.md §2), or null when there is nothing to send.
 * A comment's position follows its words if the reader edited the text after commenting.
 */
export function changesFile(rec, layout) {
  const changes = changeList(rec);
  const comments = (rec.comments || []).slice().sort((a, b) => a.spread - b.spread || String(a.made).localeCompare(String(b.made))).map(c => {
    const who = { by: c.by || '', made: c.made, ...(c.edited ? { edited: c.edited } : {}),
      ...(c.resolved ? { resolved: c.resolved } : {}),
      replies: (c.replies || []).map(r => ({ text: r.text, by: r.by || '', made: r.made, ...(r.edited ? { edited: r.edited } : {}) })) };
    if (!c.quote) return { spread: c.spread, text: c.text, ...who };
    const i = findQuote(value(rec, c.spread, 'text', c.lang), c.quote, c.position);
    return { spread: c.spread, lang: c.lang, quote: c.quote, position: i >= 0 ? i : c.position, text: c.text, ...who };
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
