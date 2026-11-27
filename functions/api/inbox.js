// POST /api/inbox { id, changes } — Send back / Approve story straight to the author: the changes file goes into the
// private inbox in R2 (inbox/<book id>/…). Only for a Library book this person may edit. The author's phone gets a
// push with no names or emails in it. The admin reads the inbox in Settings (/api/admin/inbox).
import { sameOrigin, HttpError, json, errorResponse } from '../../server/access.js';
import { sessionUser } from '../../server/session.js';
import { readIndex, canOn, listAll, ID_RE } from '../../server/library.js';

const MAX_BYTES = 2 * 1024 * 1024, MAX_WAITING = 500;
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const rand6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const me = await sessionUser(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    const text = await request.text();
    if (text.length > MAX_BYTES) throw new HttpError(413, 'too-big');
    let b; try { b = JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
    const id = String(b.id ?? ''), ch = b.changes;
    if (!ID_RE.test(id)) throw new HttpError(400, 'bad-book');
    if (ch?.format !== 'book-editor-changes' || ch.formatVersion !== 1 || ch.book?.id !== id) throw new HttpError(400, 'bad-changes');
    const { books } = await readIndex(env);
    const entry = books.find(x => x.id === id), can = canOn(me, entry);
    if (!can) throw new HttpError(404, 'no-book');                   // not a Library book (e.g. the sample): the app saves a file
    if (can !== 'edit') throw new HttpError(403, 'read-only');
    if ((await listAll(env, 'inbox/')).length >= MAX_WAITING) throw new HttpError(507, 'inbox-full');
    const kind = ch.send === 'final' ? 'final' : 'rewrite', round = Math.max(1, Math.floor(Number(ch.round) || 1));
    const title = entry.titles?.[entry.languages?.[0]] || Object.values(entry.titles || {})[0] || id;
    const key = `inbox/${id}/${stamp()}-${rand6()}.json`;
    const item = { format: 'book-editor-inbox-item', version: 1, at: new Date().toISOString(), from: { email: me.email, name: me.name || '' }, changes: ch };
    await env.LIBRARY.put(key, JSON.stringify(item, null, 1), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { from: me.email, name: (me.name || '').slice(0, 80), kind, round: String(round), title: String(title).slice(0, 200) },
    });
    if (env.NTFY_URL) {
      try {
        await fetch(env.NTFY_URL, { method: 'POST', body: kind === 'final' ? 'A reader approved a story. Open Settings to see it.' : 'A reader sent a story back. Open Settings to see it.',
          headers: { title: 'Book Editor: story sent back', tags: 'books', click: new URL(request.url).origin + '/#settings' } });
      } catch { /* the inbox has it; the push is only a nudge */ }
    }
    return json({ ok: true, key });
  } catch (e) { return errorResponse(e); }
}
