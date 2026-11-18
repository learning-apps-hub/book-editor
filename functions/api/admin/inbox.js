// /api/admin/inbox — what readers sent back (Send back / Approve story), newest first.
//   GET                  → { items: [{ key, id, title, from, name, kind, round, at, size }] }
//   GET ?key=<key>       → that changes file (book-editor-changes), as a download
//   POST { key, action: 'done' }  → moved to inbox-done/ (kept, no longer listed)
// Admins only. eBook Production will read the same inbox later.
import { sameOrigin, HttpError, json, errorResponse } from '../../../server/access.js';
import { requireAdmin } from '../../../server/session.js';
import { listAll } from '../../../server/library.js';

const KEY_RE = /^inbox\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/[0-9]{14}-[a-z0-9]{6}\.json$/;
const keyOk = k => { const s = String(k ?? ''); if (!KEY_RE.test(s)) throw new HttpError(400, 'bad-key'); return s; };
const atOf = k => { const s = k.split('/').pop(); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`; };
const safeName = s => String(s || 'book').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'book';

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const q = new URL(request.url).searchParams;
    if (q.has('key')) {
      const key = keyOk(q.get('key')), obj = await env.LIBRARY.get(key);
      if (!obj) throw new HttpError(404, 'not-found');
      const item = await obj.json(), m = obj.customMetadata || {};
      return new Response(JSON.stringify(item.changes, null, 2) + '\n', { headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName(m.title) + '.changes.json')}`,
      } });
    }
    const items = (await listAll(env, 'inbox/', true)).map(o => {
      const m = o.customMetadata || {};
      return { key: o.key, id: o.key.split('/')[1], title: m.title || '', from: m.from || '', name: m.name || '', kind: m.kind === 'final' ? 'final' : 'rewrite',
        round: Number(m.round) || 1, at: atOf(o.key), size: o.size };
    }).sort((a, b) => b.at.localeCompare(a.at));
    return json({ items });
  } catch (e) { return errorResponse(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    await requireAdmin(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    let b; try { b = JSON.parse(await request.text()); } catch { throw new HttpError(400, 'bad-json'); }
    const key = keyOk(b.key);
    if (b.action !== 'done') throw new HttpError(400, 'bad-action');
    const obj = await env.LIBRARY.get(key);
    if (!obj) throw new HttpError(404, 'not-found');
    await env.LIBRARY.put('inbox-done/' + key.slice('inbox/'.length), await obj.arrayBuffer(), { httpMetadata: { contentType: 'application/json' }, customMetadata: obj.customMetadata || {} });
    await env.LIBRARY.delete(key);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
