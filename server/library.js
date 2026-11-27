// The private Library in R2 (binding LIBRARY): which books there are, and who may see or edit each one.
//   system/library.json      the list: one entry per book, with its `access` map { email: 'read' | 'edit' }
//   books/<id>/<v>/…         a book's files, unpacked (book.json, story.json, pictures/…); <v> = one upload
// Admins see and edit every book. Anyone else sees only the books an admin opened to them.
// "read" = read it in the Library; "edit" = also add it to My shelf, change it and send it back to the author.
import { HttpError } from './access.js';

const INDEX_KEY = 'system/library.json';
export const MAX_BOOKS = 300, MAX_FILE = 30 * 1024 * 1024;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const V_RE = /^v[0-9]{1,6}-[0-9]{14}-[a-z0-9]{6}$/;
// Files a book may hold: its two JSON files and pictures under pictures/<type>/.
export const PATH_RE = /^(book\.json|story\.json|pictures\/[a-z]{1,20}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(jpe?g|png|webp))$/;
const TYPES = { json: 'application/json; charset=utf-8', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const typeOf = path => TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
export const bookPrefix = (id, v) => `books/${id}/${v}/`;

export async function readIndex(env) {
  if (!env.LIBRARY) throw new HttpError(503, 'not-configured');
  const obj = await env.LIBRARY.get(INDEX_KEY);
  if (!obj) return { books: [], etag: null, exists: false };
  const d = await obj.json();
  return { books: Array.isArray(d.books) ? d.books : [], etag: obj.etag, exists: true };
}
export async function writeIndex(env, books, etag) {
  const opts = { httpMetadata: { contentType: 'application/json' } };
  opts.onlyIf = etag ? { etagMatches: etag } : { uploadedBefore: new Date(0) };   // two admins at once must not undo each other
  const res = await env.LIBRARY.put(INDEX_KEY, JSON.stringify({ format: 'book-editor-library-index', version: 1, books }, null, 1), opts);
  if (res === null) throw new HttpError(409, 'changed');
}

/** 'edit' | 'read' | null: what this person may do with this book. */
export function canOn(me, entry) {
  if (!entry || !me) return null;
  if (me.role === 'admin') return 'edit';
  const a = entry.access?.[me.email];
  return a === 'edit' || a === 'read' ? a : null;
}

/** The Library as one person sees it (docs/book-file-format.md §3), plus `can` per book. Never shows who else has access. */
export function libraryFor(me, books) {
  return {
    format: 'book-editor-library', formatVersion: 1,
    books: books.map(b => [b, canOn(me, b)]).filter(([, can]) => can).map(([b, can]) => ({
      id: b.id, bookVersion: b.bookVersion, titles: b.titles, languages: b.languages,
      ...(b.languageNames && Object.keys(b.languageNames).length ? { languageNames: b.languageNames } : {}),
      ...(b.round ? { round: b.round } : {}),
      ...(b.cover ? { cover: b.cover } : {}), shared: b.shared, bytes: b.bytes, can,
    })),
  };
}

/** Every key under a prefix (R2 lists 1000 at a time). */
export async function listAll(env, prefix, withMeta = false) {
  const out = [];
  let cursor;
  do {
    const r = await env.LIBRARY.list({ prefix, cursor, ...(withMeta ? { include: ['customMetadata'] } : {}) });
    out.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}
export async function deleteAll(env, keys) {
  for (let i = 0; i < keys.length; i += 1000) await env.LIBRARY.delete(keys.slice(i, i + 1000));
}

/** The picture paths a book.json lists (same rule as the app's shelf). */
export function picturePaths(book) {
  const out = new Set();
  for (const group of Object.values(book?.pictures || {})) for (const p of Object.values(group || {})) if (typeof p === 'string') out.add(p);
  return [...out];
}
