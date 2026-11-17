// /join/api — "Ask to join", open to everyone (no sign-in needed). The person gives their name, email and a note;
// the admin checks who it is, approves, and sends them their own one-time sign-in link through a channel she trusts.
// The email is not proven here: the admin's own message carrying the link is what gives access.
//   POST { name, email, note?, website? } → { status: 'waiting' }   (the same answer whether or not the email is known)
// Limits: 20 waiting requests in all, 3 per network address; `website` is a hidden field only robots fill in.
import {
  readPeople, readRequests, writeRequests, adminEmails, notifyAdmin, sameOrigin, cleanText, cleanEmail,
  NAME_MAX, NOTE_MAX, MAX_REQUESTS, HttpError, json, errorResponse,
} from '../../server/access.js';
import { sha256 } from '../../server/session.js';

const PER_ADDRESS = 3;

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    const text = await request.text();
    if (text.length > 2048) throw new HttpError(413, 'too-big');
    let b; try { b = JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
    const name = cleanText(b.name, NAME_MAX), note = cleanText(b.note, NOTE_MAX), email = cleanEmail(b.email);
    if (name.length < 2) throw new HttpError(400, 'name-needed');
    if (!email) throw new HttpError(400, 'bad-email');
    if (b.website) return json({ status: 'waiting' });
    if (adminEmails(env).includes(email) || (await readPeople(env)).people.some(p => p.email === email)) return json({ status: 'waiting' });
    const from = (await sha256('be-join:' + (request.headers.get('cf-connecting-ip') || 'none'))).slice(0, 24);
    const { requests, etag } = await readRequests(env);
    const old = requests.find(x => x.email === email);
    if (!old && requests.length >= MAX_REQUESTS) throw new HttpError(429, 'too-many');
    if (!old && requests.filter(x => x.from === from).length >= PER_ADDRESS) throw new HttpError(429, 'too-many');
    const now = new Date().toISOString();
    const next = old ? requests.map(x => x.email === email ? { ...x, name, note, from, changedAt: now } : x)
      : [...requests, { email, name, note, from, at: now }];
    await writeRequests(env, next, etag);
    if (!old) await notifyAdmin(env, new URL(request.url).origin + '/');
    return json({ status: 'waiting' });
  } catch (e) { return errorResponse(e); }
}
