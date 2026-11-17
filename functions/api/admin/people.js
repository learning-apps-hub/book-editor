// /api/admin/people — the admin's People list (who may sign in), kept in R2 and pushed to Cloudflare Access.
//   GET                      → { people: [...], requests: [...waiting to join], fixed: [admin emails set on the server] }
//   POST   { email, name, role, login }  add or change one person (approving a join request = adding that email)
//   DELETE { email }               remove one person and end their sessions
// Admins only; writes only from this site's own pages.
import {
  requireAdmin, sameOrigin, readPeople, writePeople, readRequests, writeRequests, cleanText, NAME_MAX, syncPolicy, revokeUser, adminEmails, cleanEmail,
  ROLES, LOGINS, HttpError, json, errorResponse,
} from '../../../server/access.js';

const MAX_PEOPLE = 200;
const view = async (env, people) => ({ people, requests: (await readRequests(env)).requests, fixed: adminEmails(env) });

async function body(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
  const text = await request.text();
  if (text.length > 4096) throw new HttpError(413, 'too-big');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    const { people } = await readPeople(env);
    return json(await view(env, people));
  } catch (e) { return errorResponse(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const me = await requireAdmin(request, env);
    const b = await body(request);
    const email = cleanEmail(b.email);
    if (!email) throw new HttpError(400, 'bad-email');
    const role = ROLES.includes(b.role) ? b.role : 'reader', login = LOGINS.includes(b.login) ? b.login : 'code';
    const name = cleanText(b.name, NAME_MAX);
    if (name.length < 2) throw new HttpError(400, 'name-needed');
    if (adminEmails(env).includes(email)) throw new HttpError(400, 'fixed-admin');
    const { people, etag } = await readPeople(env);
    const old = people.find(p => p.email === email);
    if (!old && people.length >= MAX_PEOPLE) throw new HttpError(400, 'too-many');
    const next = old
      ? people.map(p => p.email === email ? { ...p, name, role, login, changedAt: new Date().toISOString() } : p)
      : [...people, { email, name, role, login, addedAt: new Date().toISOString(), addedBy: me.email }];
    await syncPolicy(env, next);                 // Access first: the list is only saved once sign-in matches it
    await writePeople(env, next, etag);
    const rq = await readRequests(env);          // approved: no longer waiting
    if (rq.requests.some(x => x.email === email)) {
      try { await writeRequests(env, rq.requests.filter(x => x.email !== email), rq.etag); } catch { /* shown again; approving twice is harmless */ }
    }
    return json(await view(env, next));
  } catch (e) { return errorResponse(e); }
}

export async function onRequestDelete({ request, env }) {
  try {
    sameOrigin(request);
    const me = await requireAdmin(request, env);
    const email = cleanEmail((await body(request)).email);
    if (!email) throw new HttpError(400, 'bad-email');
    if (email === me.email) throw new HttpError(400, 'not-yourself');
    const { people, etag } = await readPeople(env);
    const next = people.filter(p => p.email !== email);
    if (next.length === people.length) throw new HttpError(404, 'not-found');
    await syncPolicy(env, next);
    await writePeople(env, next, etag);
    try { await revokeUser(env, email); } catch { /* already out of the policy; their session just runs out */ }
    return json(await view(env, next));
  } catch (e) { return errorResponse(e); }
}
