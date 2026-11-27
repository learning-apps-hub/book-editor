// node server/tests/library.test.mjs — the private Library (step 4.5): adding a book, who may see / edit it,
// serving its files, Send back into the inbox, the admin's inbox, and the Chinese font from R2. Fake R2, no network.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const S = await import('../session.js');
const A = await import('../access.js');
const L = await import('../library.js');
const LIB = await import('../../functions/library/[[path]].js');
const BK = await import('../../functions/api/admin/books.js');
const IN = await import('../../functions/api/inbox.js');
const IB = await import('../../functions/api/admin/inbox.js');
const FONT = await import('../../functions/fonts/[name].js');
const PPL = await import('../../functions/api/admin/people.js');

const ORIGIN = 'https://app.example.dev';
function fakeR2() {
  const objs = new Map(); let n = 0;
  const bytes = b => typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  const view = (k, o, withBody = true) => ({
    key: k, size: o.data.length, etag: o.etag, httpEtag: `"${o.etag}"`, customMetadata: o.meta,
    ...(withBody ? { body: new Blob([o.data]).stream() } : {}),
    json: async () => JSON.parse(new TextDecoder().decode(o.data)), arrayBuffer: async () => o.data.slice().buffer,
  });
  return {
    async get(k, opt = {}) {
      const o = objs.get(k); if (!o) return null;
      const inm = opt.onlyIf instanceof Headers ? opt.onlyIf.get('if-none-match') : null;
      return view(k, o, !(inm && inm === `"${o.etag}"`));
    },
    async put(k, body, o = {}) {
      const obj = objs.get(k);
      if (o.onlyIf?.etagMatches && (!obj || obj.etag !== o.onlyIf.etagMatches)) return null;
      if (o.onlyIf?.uploadedBefore && obj) return null;
      objs.set(k, { data: bytes(body), etag: 'e' + (++n), meta: o.customMetadata || {} }); return { etag: 'e' + n };
    },
    async delete(k) { for (const x of [].concat(k)) objs.delete(x); },
    async list({ prefix = '' } = {}) {
      return { objects: [...objs.keys()].filter(k => k.startsWith(prefix)).sort().map(k => ({ key: k, size: objs.get(k).data.length, customMetadata: objs.get(k).meta })), truncated: false };
    },
    has: k => objs.has(k), keys: () => [...objs.keys()],
  };
}
const pushes = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = init.method || 'GET';
  if (u === 'https://ntfy.example/topic') { pushes.push({ body: init.body, headers: init.headers }); return new Response('{}'); }
  const okr = x => new Response(JSON.stringify({ success: true, result: x }));
  if (u.endsWith('/access/policies/pol')) return okr({ name: 'Readers', decision: 'allow', session_duration: '720h', include: [] });
  if (u.endsWith('/access/organizations/revoke_user') && m === 'POST') return okr(true);
  return new Response('{}', { status: 404 });
};
const R2 = fakeR2();
const env = { ADMIN_EMAILS: 'boss@example.com', LIBRARY: R2, NTFY_URL: 'https://ntfy.example/topic', SESSION_SECRET: 's'.repeat(40), PASS_PEPPER: 'p'.repeat(40),
  ACCESS_POLICY_ID: 'pol', CF_ACCOUNT_ID: 'acct', CF_ACCESS_TOKEN: 'tok' };
await A.writePeople(env, [
  { email: 'ed@example.com', name: 'Ed', role: 'reader' }, { email: 'rita@example.com', name: 'Rita', role: 'reader' },
  { email: 'nobody@example.com', name: 'Nobody', role: 'reader' }], null);
const jar = {};
for (const e of ['boss@example.com', 'ed@example.com', 'rita@example.com', 'nobody@example.com']) {
  const c = await S.credsFor(env, e); jar[e] = (await S.makeCookie(env, e, c.sv)).split(';')[0];
}
const req = (method, path, { as, body, raw, origin = ORIGIN, headers = {} } = {}) => {
  const h = { ...headers };
  if (as) h.cookie = jar[as];
  if (origin) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  return new Request(ORIGIN + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
};
const call = async (fn, r, extra = {}) => { const res = await fn({ request: r, env, ...extra }); const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: res.status, body: b, res }; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };
const lib = (path, as, headers) => call(LIB.onRequestGet, req('GET', '/library/' + path, { as, headers }), { params: { path: path.split('/') } });

// ---- No Library yet: 404, so the app shows the sample ----
eq((await lib('library.json', 'boss@example.com')).status, 404, 'no Library yet → 404 (sample)');
eq((await lib('library.json')).status, 401, 'signed out → 401');

// ---- Adding a book (admin) ----
const book = { format: 'book-editor-book', formatVersion: 1, id: 'fox', bookVersion: 2, round: 2, fingerprint: 'sha256:x', languages: ['en', 'zh'],
  titles: { en: 'The Fox', zh: '狐狸' }, scenes: 1, pictures: { colour: { 1: 'pictures/colour/01.jpg' }, covers: { front: 'pictures/covers/front.jpg' } } };
const story = [{ number: 1, text: { en: 'Hi', zh: '你好' } }];
let r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'ed@example.com', body: { action: 'begin', id: 'fox', bookVersion: 2 } }));
eq(r.status, 403, 'readers cannot add books');
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'begin', id: '../x', bookVersion: 2 } }));
eq([r.status, r.body.error], [400, 'bad-book'], 'bad id refused');
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'begin', id: 'fox', bookVersion: 2 }, origin: 'https://evil.example' }));
eq(r.status, 403, 'cross-site refused');
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'begin', id: 'fox', bookVersion: 2 } }));
ok(L.V_RE.test(r.body.v), 'begin gives an upload slot');
const v1 = r.body.v;
const put = (v, path, data, as = 'boss@example.com') => call(BK.onRequestPut, req('PUT', `/api/admin/books?${new URLSearchParams({ id: 'fox', v, path })}`, { as, raw: data }));
eq((await put(v1, '../../system/people.json', 'x')).body.error, 'bad-path', 'path escape refused');
eq((await put(v1, 'pictures/colour/01.svg', 'x')).body.error, 'bad-path', 'only pictures / json');
eq((await put('vX', 'book.json', 'x')).body.error, 'bad-upload', 'bad slot refused');
eq((await put(v1, 'book.json', 'x', 'ed@example.com')).status, 403, 'readers cannot upload');
eq((await put(v1, 'book.json', JSON.stringify(book))).status, 200, 'book.json uploaded');
eq((await put(v1, 'story.json', JSON.stringify(story))).status, 200, 'story.json uploaded');
eq((await put(v1, 'pictures/colour/01.jpg', new Uint8Array([1, 2, 3]))).status, 200, 'picture uploaded');
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'commit', id: 'fox', v: v1 } }));
eq([r.status, r.body.error], [400, 'missing-pictures'], 'commit refuses a book with a picture missing');
eq((await lib('library.json', 'boss@example.com')).status, 404, 'nothing went live');
await put(v1, 'pictures/covers/front.jpg', new Uint8Array([9, 9]));
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'commit', id: 'fox', v: v1 } }));
eq(r.status, 200, 'commit');
eq([r.body.books.length, r.body.books[0].id, r.body.books[0].bookVersion, r.body.books[0].round, r.body.books[0].cover, r.body.books[0].scenes], [1, 'fox', 2, 2, 'fox/pictures/covers/front.jpg', 1], 'book listed');
ok(!('v' in r.body.books[0]), 'upload slot not shown');
eq(r.body.books[0].access, {}, 'new book: nobody but admins');

// ---- Who sees what ----
let l = await lib('library.json', 'boss@example.com');
eq([l.status, l.body.format, l.body.books.map(b => [b.id, b.can])], [200, 'book-editor-library', [['fox', 'edit']]], 'admin sees it, can edit');
ok(!('access' in l.body.books[0]), 'the list never shows who else has access');
l = await lib('library.json', 'ed@example.com');
eq(l.body.books, [], 'reader sees nothing until opened to them');
eq((await lib('fox/book.json', 'ed@example.com')).status, 404, 'hidden book file → 404');
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com',
  body: { action: 'access', id: 'fox', access: { 'Ed@Example.com': 'edit', 'rita@example.com': 'read', 'stranger@example.com': 'edit', 'nobody@example.com': 'owner' } } }));
eq(r.body.books[0].access, { 'ed@example.com': 'edit', 'rita@example.com': 'read' }, 'access: listed people, read/edit only');
eq((await lib('library.json', 'ed@example.com')).body.books.map(b => b.can), ['edit'], 'Ed can edit');
eq((await lib('library.json', 'rita@example.com')).body.books.map(b => b.can), ['read'], 'Rita can read');
eq((await lib('library.json', 'nobody@example.com')).body.books, [], 'Nobody still sees nothing');
let f = await lib('fox/pictures/colour/01.jpg', 'rita@example.com');
eq([f.status, f.res.headers.get('content-type')], [200, 'image/jpeg'], 'picture served to a reader');
const et = f.res.headers.get('etag');
f = await lib('fox/pictures/colour/01.jpg', 'rita@example.com', { 'if-none-match': et });
eq(f.status, 304, 'unchanged picture → 304');
f = await lib('fox/book.json', 'ed@example.com');
eq([f.status, f.body.id], [200, 'fox'], 'book.json served');
eq((await lib('fox/../system/people.json', 'boss@example.com')).status, 404, 'no path escape');
eq((await lib('fox/pictures/colour/02.jpg', 'boss@example.com')).status, 404, 'missing file → 404');

// ---- Replacing the book keeps its access; old copies are cleared ----
const v2 = (await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'begin', id: 'fox', bookVersion: 3 } }))).body.v;
const dead = (await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'begin', id: 'fox', bookVersion: 3 } }))).body.v;
await put(dead, 'book.json', 'half an upload');
await put(v2, 'book.json', JSON.stringify({ ...book, bookVersion: 3, round: 1, pictures: { colour: { 1: 'pictures/colour/01.png' } } }));
await put(v2, 'story.json', JSON.stringify(story));
await put(v2, 'pictures/colour/01.png', new Uint8Array([4]));
r = await call(BK.onRequestPost, req('POST', '/api/admin/books', { as: 'boss@example.com', body: { action: 'commit', id: 'fox', v: v2 } }));
eq([r.body.books[0].bookVersion, r.body.books[0].round, r.body.books[0].cover, r.body.books[0].access['ed@example.com']], [3, undefined, undefined, 'edit'], 'replaced, access kept');
ok(R2.keys().filter(k => k.startsWith('books/fox/')).every(k => k.startsWith(`books/fox/${v2}/`)), 'old copy and unfinished upload removed');
eq((await lib('fox/pictures/colour/01.png', 'ed@example.com')).status, 200, 'new picture served');

// ---- Send back into the inbox ----
const changes = { format: 'book-editor-changes', formatVersion: 1, book: { id: 'fox', bookVersion: 3 }, round: 1, send: 'rewrite', changes: [], edits: [], comments: [{ spread: 1, text: 'nice' }] };
const send = (as, body, origin) => call(IN.onRequestPost, req('POST', '/api/inbox', { as, body, origin }));
eq((await send('ed@example.com', { id: 'fox', changes }, 'https://evil.example')).status, 403, 'inbox: cross-site refused');
eq((await send('rita@example.com', { id: 'fox', changes })).body.error, 'read-only', 'read-only reader cannot send back');
eq((await send('nobody@example.com', { id: 'fox', changes })).body.error, 'no-book', 'hidden book: no-book');
eq((await send('ed@example.com', { id: 'lantern-fox', changes: { ...changes, book: { id: 'lantern-fox' } } })).body.error, 'no-book', 'sample book → no-book (file instead)');
eq((await send('ed@example.com', { id: 'fox', changes: { ...changes, format: 'x' } })).body.error, 'bad-changes', 'not a changes file');
eq((await send('ed@example.com', { id: 'fox', changes: { ...changes, book: { id: 'other' } } })).body.error, 'bad-changes', 'changes for another book');
r = await send('ed@example.com', { id: 'fox', changes });
eq(r.status, 200, 'Ed sent it back');
ok(/^inbox\/fox\/\d{14}-[a-z0-9]{6}\.json$/.test(r.body.key), 'stored in the inbox');
eq(pushes.length, 1, 'one push');
ok(!/ed@example|Ed\b|Fox/.test(JSON.stringify(pushes[0])), 'push carries no name, email or title');
await send('boss@example.com', { id: 'fox', changes: { ...changes, send: 'final', round: 2 } });
let ib = await call(IB.onRequestGet, req('GET', '/api/admin/inbox', { as: 'ed@example.com' }));
eq(ib.status, 403, 'readers cannot read the inbox');
ib = await call(IB.onRequestGet, req('GET', '/api/admin/inbox', { as: 'boss@example.com' }));
eq(ib.body.items.length, 2, 'two items');
const edItem = ib.body.items.find(x => x.from === 'ed@example.com');
eq([edItem.id, edItem.title, edItem.name, edItem.kind, edItem.round], ['fox', 'The Fox', 'Ed', 'rewrite', 1], 'item details');
eq(ib.body.items.find(x => x.from === 'boss@example.com').kind, 'final', 'approval kind');
let dl = await call(IB.onRequestGet, req('GET', '/api/admin/inbox?key=' + encodeURIComponent(edItem.key), { as: 'boss@example.com' }));
eq([dl.status, dl.body.format, dl.body.comments[0].text], [200, 'book-editor-changes', 'nice'], 'download is the changes file');
ok(/attachment; filename\*=UTF-8''The%20Fox\.changes\.json/.test(dl.res.headers.get('content-disposition')), 'named after the book');
eq((await call(IB.onRequestGet, req('GET', '/api/admin/inbox?key=' + encodeURIComponent('system/people.json'), { as: 'boss@example.com' }))).body.error, 'bad-key', 'inbox key cannot reach other files');
r = await call(IB.onRequestPost, req('POST', '/api/admin/inbox', { as: 'boss@example.com', body: { key: edItem.key, action: 'done' } }));
eq(r.status, 200, 'done');
ok(!R2.has(edItem.key) && R2.has('inbox-done/' + edItem.key.slice(6)), 'moved to inbox-done (kept)');
eq((await call(IB.onRequestGet, req('GET', '/api/admin/inbox', { as: 'boss@example.com' }))).body.items.length, 1, 'one left');

// ---- Removing a person closes their books; removing a book ----
r = await call(PPL.onRequestDelete, req('DELETE', '/api/admin/people', { as: 'boss@example.com', body: { email: 'rita@example.com' } }));
eq(r.status, 200, 'Rita removed from People');
eq((await L.readIndex(env)).books[0].access['rita@example.com'], undefined, 'Rita no longer on the book');
r = await call(BK.onRequestDelete, req('DELETE', '/api/admin/books', { as: 'boss@example.com', body: { id: 'fox' } }));
eq([r.status, r.body.books], [200, []], 'book removed');
ok(!R2.keys().some(k => k.startsWith('books/fox/')), 'its files are gone');
eq((await lib('library.json', 'boss@example.com')).body.books, [], 'empty Library (not the sample) once one existed');

// ---- The Chinese font from R2 ----
const next = async () => new Response('STATIC', { status: 404 });
let fr = await FONT.onRequestGet({ request: req('GET', '/fonts/NotoSerifSC-Regular.ttf'), env, params: { name: 'NotoSerifSC-Regular.ttf' }, next });
eq(fr.status, 404, 'font not uploaded yet → falls through');
await R2.put('system/fonts/NotoSerifSC-Regular.ttf', new Uint8Array([0, 1, 0, 0]));
fr = await FONT.onRequestGet({ request: req('GET', '/fonts/NotoSerifSC-Regular.ttf'), env, params: { name: 'NotoSerifSC-Regular.ttf' }, next });
eq([fr.status, fr.headers.get('content-type'), (await fr.arrayBuffer()).byteLength], [200, 'font/ttf', 4], 'font served from R2');
fr = await FONT.onRequestGet({ request: req('GET', '/fonts/Nunito.woff2'), env, params: { name: 'Nunito.woff2' }, next });
eq(await fr.text(), 'STATIC', 'other fonts are plain files');

console.log(`library.test: ${pass} passed`);
