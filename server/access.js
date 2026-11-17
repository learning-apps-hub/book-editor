// Book Editor server side (Cloudflare Pages Functions): who is signed in, who may use the app, and keeping
// Cloudflare Access in step with the People list the admin keeps in the app.
//
// Nothing personal lives in this public repo. Everything comes from the Pages project's settings:
//   ACCESS_TEAM_DOMAIN  plain   e.g. <team>.cloudflareaccess.com
//   ACCESS_AUD          plain   the Access application's audience tag
//   ACCESS_POLICY_ID    plain   the reusable Access policy that lists the readers
//   CF_ACCOUNT_ID       plain   the Cloudflare account
//   ADMIN_EMAILS        secret  comma-separated; always admins, cannot be removed in the app
//   CF_ACCESS_TOKEN     secret  API token: Access Apps and Policies Edit + Access Organizations Edit, nothing else
//   GOOGLE_USERS_URL    plain   optional: the Google Cloud "Test users" page, shown to admins
// R2 binding LIBRARY holds the People list at system/people.json (the bucket is private).

const PEOPLE_KEY = 'system/people.json';
const CF_API = 'https://api.cloudflare.com/client/v4';
export const ROLES = ['reader', 'admin'];
export const LOGINS = ['google', 'code'];

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

export function errorResponse(e) {
  if (e instanceof HttpError) return json({ error: e.code }, e.status);
  console.error('book-editor api', e && e.stack || e);
  return json({ error: 'server' }, 500);
}

export function cleanEmail(x) {
  const e = String(x ?? '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}
export const adminEmails = env => String(env.ADMIN_EMAILS || '').split(',').map(cleanEmail).filter(Boolean);

// ---- The Access sign-in token (Cf-Access-Jwt-Assertion), checked against the team's public keys ----
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const keyCache = new Map();          // team domain -> { at, keys: Map(kid -> CryptoKey) }

async function teamKeys(team, fetcher, fresh = false) {
  const c = keyCache.get(team);
  if (c && !fresh && Date.now() - c.at < 3600e3) return c.keys;
  const r = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs ${r.status}`);
  const keys = new Map();
  for (const jwk of (await r.json()).keys || []) {
    if (jwk.kty !== 'RSA') continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache.set(team, { at: Date.now(), keys });
  return keys;
}

/** The signed-in email from a valid Access token, else throws 401. */
export async function verifyAccess(request, env, fetcher = fetch) {
  const team = env.ACCESS_TEAM_DOMAIN, aud = env.ACCESS_AUD;
  if (!team || !aud) throw new HttpError(503, 'not-configured');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new HttpError(401, 'signed-out');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'bad-token');
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(b64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))); }
  catch { throw new HttpError(401, 'bad-token'); }
  if (head.alg !== 'RS256') throw new HttpError(401, 'bad-token');
  let key = (await teamKeys(team, fetcher)).get(head.kid);
  if (!key) key = (await teamKeys(team, fetcher, true)).get(head.kid);       // keys rotate
  if (!key) throw new HttpError(401, 'bad-token');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new HttpError(401, 'bad-token');
  const now = Date.now() / 1000;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud) || claims.iss !== `https://${team}` || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) throw new HttpError(401, 'bad-token');
  const email = cleanEmail(claims.email);
  if (!email) throw new HttpError(401, 'bad-token');
  return email;
}

// ---- The People list in R2 ----
export async function readPeople(env) {
  if (!env.LIBRARY) throw new HttpError(503, 'not-configured');
  const obj = await env.LIBRARY.get(PEOPLE_KEY);
  if (!obj) return { people: [], etag: null };
  const data = await obj.json();
  return { people: Array.isArray(data.people) ? data.people : [], etag: obj.etag };
}
export async function writePeople(env, people, etag) {
  const body = JSON.stringify({ format: 'book-editor-people', version: 1, people }, null, 1);
  const opts = { httpMetadata: { contentType: 'application/json' } };
  // Only replace the list we read: two admins saving at once must not undo each other.
  opts.onlyIf = etag ? { etagMatches: etag } : { uploadedBefore: new Date(0) };
  const res = await env.LIBRARY.put(PEOPLE_KEY, body, opts);
  if (res === null) throw new HttpError(409, 'changed');
}

/** { email, role } for someone allowed to use the app, else throws 403. */
export async function whoIs(email, env) {
  if (adminEmails(env).includes(email)) return { email, role: 'admin', fixed: true };
  const { people } = await readPeople(env);
  const p = people.find(x => x.email === email);
  if (!p) throw new HttpError(403, 'not-listed');
  return { email, role: p.role === 'admin' ? 'admin' : 'reader', fixed: false };
}

export async function requireUser(request, env, fetcher) { return whoIs(await verifyAccess(request, env, fetcher), env); }
export async function requireAdmin(request, env, fetcher) {
  const me = await requireUser(request, env, fetcher);
  if (me.role !== 'admin') throw new HttpError(403, 'not-admin');
  return me;
}

/** Writes must come from this site's own pages (no cross-site form or script). */
export function sameOrigin(request) {
  const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if (!origin || origin !== new URL(request.url).origin || (site && site !== 'same-origin')) throw new HttpError(403, 'cross-site');
}

// ---- Cloudflare Access: the readers policy = admins + everyone on the People list ----
async function cf(env, fetcher, method, path, body) {
  if (!env.CF_ACCESS_TOKEN || !env.CF_ACCOUNT_ID) throw new HttpError(503, 'sync-not-configured');
  const r = await fetcher(`${CF_API}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    method, headers: { authorization: `Bearer ${env.CF_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) {
    console.error('cloudflare api', method, path, r.status, JSON.stringify(d.errors || []));
    throw new HttpError(502, 'sync-failed');
  }
  return d.result;
}

export async function syncPolicy(env, people, fetcher = fetch) {
  if (!env.ACCESS_POLICY_ID) throw new HttpError(503, 'sync-not-configured');
  const emails = [...new Set([...adminEmails(env), ...people.map(p => p.email)])].sort();
  if (!emails.length) throw new HttpError(400, 'empty');          // never leave the policy empty
  const path = `/access/policies/${env.ACCESS_POLICY_ID}`;
  const cur = await cf(env, fetcher, 'GET', path);
  await cf(env, fetcher, 'PUT', path, {
    name: cur.name, decision: cur.decision, session_duration: cur.session_duration,
    include: emails.map(email => ({ email: { email } })),
    exclude: cur.exclude || [], require: cur.require || [],
  });
  return emails.length;
}

/** Ends a removed person's Access sessions straight away (otherwise they last up to the session length). */
export async function revokeUser(env, email, fetcher = fetch) {
  await cf(env, fetcher, 'POST', '/access/organizations/revoke_user', { email });
}
