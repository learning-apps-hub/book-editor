// /api/admin/books — the admin's Library: add or replace a book, choose who may see or edit it, remove it.
//   GET                                          → { books: [...every book, with its access map] }
//   POST { action: 'begin', id, bookVersion }    → { v }  a new upload slot for this book
//   PUT  ?id=&v=&path=   (the file's bytes)      → { ok } one file of the upload (book.json, story.json, pictures/…)
//   POST { action: 'commit', id, v }             → { books }  checks the upload and puts it in the Library (keeps its access)
//   POST { action: 'access', id, access }        → { books }  access = { email: 'read' | 'edit' } (people on the list only)
//   DELETE { id }                                → { books }
// Readers never see this. The book appears to nobody but admins until an admin opens it to someone.
import { sameOrigin, readPeople, cleanEmail, HttpError, json, errorResponse } from '../../../server/access.js';
import { requireAdmin } from '../../../server/session.js';
import {
  readIndex, writeIndex, listAll, deleteAll, picturePaths, bookPrefix, typeOf, ID_RE, V_RE, PATH_RE, MAX_BOOKS, MAX_FILE,
} from '../../../server/library.js';

async function body(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
  const text = await request.text();
  if (text.length > 64 * 1024) throw new HttpError(413, 'too-big');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
}
const cleanId = x => { const id = String(x ?? ''); if (!ID_RE.test(id)) throw new HttpError(400, 'bad-book'); return id; };
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const rand6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const strMap = (o, max) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([k, v]) => typeof k === 'string' && k.length <= 40 && typeof v === 'string').slice(0, 60).map(([k, v]) => [k, v.slice(0, max)]));

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const { books } = await readIndex(env);
    return json({ books: books.map(({ v, ...b }) => b) });
  } catch (e) { return errorResponse(e); }
}

export async function onRequestPut({ request, env }) {
  try {
    sameOrigin(request);
    await requireAdmin(request, env);
    const q = new URL(request.url).searchParams, id = cleanId(q.get('id')), v = String(q.get('v') || ''), path = String(q.get('path') || '');
    if (!V_RE.test(v)) throw new HttpError(400, 'bad-upload');
    if (!PATH_RE.test(path)) throw new HttpError(400, 'bad-path');
    if (Number(request.headers.get('content-length') || 0) > MAX_FILE) throw new HttpError(413, 'too-big');
    const data = await request.arrayBuffer();
    if (!data.byteLength) throw new HttpError(400, 'empty-file');
    if (data.byteLength > MAX_FILE) throw new HttpError(413, 'too-big');
    await env.LIBRARY.put(bookPrefix(id, v) + path, data, { httpMetadata: { contentType: typeOf(path) } });
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

async function commit(env, me, id, v) {
  if (!V_RE.test(v)) throw new HttpError(400, 'bad-upload');
  const pre = bookPrefix(id, v);
  const get = async name => { const o = await env.LIBRARY.get(pre + name); if (!o) throw new HttpError(400, 'missing-' + name.split('.')[0]); return o.json().catch(() => { throw new HttpError(400, 'bad-' + name.split('.')[0]); }); };
  const book = await get('book.json'), story = await get('story.json');
  if (book?.format !== 'book-editor-book') throw new HttpError(400, 'not-a-book');
  if (book.formatVersion !== 1) throw new HttpError(400, 'too-new');
  if (book.id !== id) throw new HttpError(400, 'bad-book');
  if (!Array.isArray(story)) throw new HttpError(400, 'bad-story');
  const files = await listAll(env, pre), have = new Map(files.map(o => [o.key.slice(pre.length), o.size]));
  const pics = picturePaths(book);
  const missing = pics.filter(p => !PATH_RE.test(p) || !have.has(p));
  if (missing.length) throw new HttpError(400, 'missing-pictures');
  const bytes = [...have.values()].reduce((n, s) => n + s, 0);
  const { books, etag } = await readIndex(env);
  const old = books.find(b => b.id === id);
  if (!old && books.length >= MAX_BOOKS) throw new HttpError(400, 'too-many');
  const languages = Array.isArray(book.languages) ? book.languages.filter(l => typeof l === 'string').slice(0, 40) : [];
  const front = book.pictures?.covers?.front;
  const entry = {
    id, v, bookVersion: Number(book.bookVersion) || 1, ...(Number(book.round) > 1 ? { round: Number(book.round) } : {}),
    titles: strMap(book.titles, 200), languages, languageNames: strMap(book.languageNames, 60),
    ...(typeof front === 'string' && have.has(front) ? { cover: `${id}/${front}` } : {}),
    shared: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), bytes, scenes: story.length,
    access: old?.access || {}, by: me.email,
  };
  await writeIndex(env, old ? books.map(b => b.id === id ? entry : b) : [...books, entry], etag);
  // The new copy is live: drop the old one and any upload that was never finished.
  const stale = (await listAll(env, `books/${id}/`)).map(o => o.key).filter(k => !k.startsWith(pre));
  await deleteAll(env, stale);
  return entry;
}

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const me = await requireAdmin(request, env);
    const b = await body(request);
    const id = cleanId(b.id);
    if (b.action === 'begin') {
      const n = Math.max(1, Math.min(999999, Math.floor(Number(b.bookVersion) || 1)));
      return json({ v: `v${n}-${stamp()}-${rand6()}` });
    }
    if (b.action === 'commit') {
      const entry = await commit(env, me, id, String(b.v || ''));
      const { books } = await readIndex(env);
      return json({ books: books.map(({ v, ...x }) => x), added: entry.id });
    }
    if (b.action === 'access') {
      const { people } = await readPeople(env), listed = new Set(people.map(p => p.email));
      const access = {};
      for (const [k, val] of Object.entries(b.access && typeof b.access === 'object' ? b.access : {})) {
        const email = cleanEmail(k);
        if (!email || !listed.has(email)) continue;                 // only people on the list; admins always see everything
        if (val === 'read' || val === 'edit') access[email] = val;
      }
      const { books, etag } = await readIndex(env);
      if (!books.some(x => x.id === id)) throw new HttpError(404, 'not-found');
      const next = books.map(x => x.id === id ? { ...x, access } : x);
      await writeIndex(env, next, etag);
      return json({ books: next.map(({ v, ...x }) => x) });
    }
    throw new HttpError(400, 'bad-action');
  } catch (e) { return errorResponse(e); }
}

export async function onRequestDelete({ request, env }) {
  try {
    sameOrigin(request);
    await requireAdmin(request, env);
    const id = cleanId((await body(request)).id);
    const { books, etag } = await readIndex(env);
    const next = books.filter(x => x.id !== id);
    if (next.length === books.length) throw new HttpError(404, 'not-found');
    await writeIndex(env, next, etag);
    await deleteAll(env, (await listAll(env, `books/${id}/`)).map(o => o.key));
    return json({ books: next.map(({ v, ...x }) => x) });
  } catch (e) { return errorResponse(e); }
}
