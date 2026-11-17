// /join/api — "Ask to join". Guarded by a second Cloudflare Access app that lets ANY email in after an email code,
// so the email here is proven, never typed. The person adds their name (and an optional note); the admin approves.
//   GET  → { email, status: 'member' | 'waiting' | 'none', name?, note? }
//   POST { name, note? } → { status: 'waiting' }
import {
  verifyAccess, readPeople, readRequests, writeRequests, adminEmails, notifyAdmin, sameOrigin, cleanText,
  NAME_MAX, NOTE_MAX, MAX_REQUESTS, HttpError, json, errorResponse,
} from '../../server/access.js';

const joinEmail = (request, env) => verifyAccess(request, env, fetch, env.JOIN_AUD);

async function status(env, email) {
  if (adminEmails(env).includes(email) || (await readPeople(env)).people.some(p => p.email === email)) return { email, status: 'member' };
  const r = (await readRequests(env)).requests.find(x => x.email === email);
  return r ? { email, status: 'waiting', name: r.name, note: r.note || '' } : { email, status: 'none' };
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.JOIN_AUD) throw new HttpError(503, 'not-configured');
    return json(await status(env, await joinEmail(request, env)));
  } catch (e) { return errorResponse(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.JOIN_AUD) throw new HttpError(503, 'not-configured');
    sameOrigin(request);
    const email = await joinEmail(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    const text = await request.text();
    if (text.length > 2048) throw new HttpError(413, 'too-big');
    let b; try { b = JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
    const name = cleanText(b.name, NAME_MAX), note = cleanText(b.note, NOTE_MAX);
    if (name.length < 2) throw new HttpError(400, 'name-needed');
    if ((await status(env, email)).status === 'member') return json({ status: 'member' });
    const { requests, etag } = await readRequests(env);
    const old = requests.find(x => x.email === email);
    if (!old && requests.length >= MAX_REQUESTS) throw new HttpError(429, 'too-many');
    const now = new Date().toISOString();
    const next = old ? requests.map(x => x.email === email ? { ...x, name, note, changedAt: now } : x)
      : [...requests, { email, name, note, at: now }];
    await writeRequests(env, next, etag);
    if (!old) await notifyAdmin(env, new URL(request.url).origin + '/');
    return json({ status: 'waiting' });
  } catch (e) { return errorResponse(e); }
}
