// node server/tests/people.test.mjs — the People API with a fake R2, a fake Cloudflare API and a test signing key.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const A = await import('../access.js');
const Me = await import('../../functions/api/me.js');
const P = await import('../../functions/api/admin/people.js');
const J = await import('../../functions/join/api.js');
const Q = await import('../../functions/api/admin/requests.js');

const TEAM = 'team.example.cloudflareaccess.com', AUD = 'aud-123', JAUD = 'aud-join', ORIGIN = 'https://app.example.dev';
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const other = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);

const b64 = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
async function token(claims, key = privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const data = b64({ alg: 'RS256', kid }) + '.' + b64({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, iat: now, ...claims });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  return data + '.' + Buffer.from(sig).toString('base64url');
}

// Fake R2 with etags and onlyIf.
function fakeR2() {
  const objs = new Map(); let n = 0;
  return {
    async get(k) { const o = objs.get(k); return o && { etag: o.etag, json: async () => JSON.parse(o.body) }; },
    async put(k, body, o = {}) {
      const obj = objs.get(k);
      if (o.onlyIf?.etagMatches && (!obj || obj.etag !== o.onlyIf.etagMatches)) return null;
      if (o.onlyIf?.uploadedBefore && obj) return null;
      objs.set(k, { body, etag: 'e' + (++n) }); return { etag: 'e' + n };
    },
    peek: (k = 'system/people.json') => objs.has(k) ? JSON.parse(objs.get(k).body) : null,
  };
}
// Fake Cloudflare: certs + policy + revoke.
const cfCalls = [];
let policy = { id: 'pol', name: 'Readers', decision: 'allow', session_duration: '720h', include: [{ email: { email: 'boss@example.com' } }], exclude: [], require: [] };
let cfDown = false; const pushes = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = init.method || 'GET';
  const ok = r => new Response(JSON.stringify({ success: true, result: r }), { status: 200 });
  if (u === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
  if (u === 'https://ntfy.example/topic') { pushes.push({ body: init.body, headers: init.headers }); return new Response('{}'); }
  cfCalls.push({ method, u, body: init.body && JSON.parse(init.body), auth: init.headers?.authorization });
  if (cfDown) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 403 });
  if (u.endsWith('/accounts/acct/access/policies/pol') && method === 'GET') return ok(policy);
  if (u.endsWith('/accounts/acct/access/policies/pol') && method === 'PUT') { policy = { ...policy, ...JSON.parse(init.body) }; return ok(policy); }
  if (u.endsWith('/accounts/acct/access/organizations/revoke_user') && method === 'POST') return ok(true);
  return new Response('{}', { status: 404 });
};

const R2 = fakeR2();
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_POLICY_ID: 'pol', CF_ACCOUNT_ID: 'acct', CF_ACCESS_TOKEN: 'tok',
  ADMIN_EMAILS: 'Boss@Example.com', GOOGLE_USERS_URL: 'https://console.example/users', LIBRARY: R2, JOIN_AUD: JAUD, NTFY_URL: 'https://ntfy.example/topic' };

const req = async (method, path, { email, tok, body, origin = ORIGIN, ctype = 'application/json', site } = {}) => {
  const h = { };
  if (email || tok) h['cf-access-jwt-assertion'] = tok || await token({ email });
  if (origin) h.origin = origin;
  if (site) h['sec-fetch-site'] = site;
  if (body !== undefined) h['content-type'] = ctype;
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};
const call = async (fn, r) => { const res = await fn({ request: r, env }); return { status: res.status, body: await res.json() }; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };

// Sign-in checks
eq((await call(Me.onRequestGet, await req('GET', '/api/me'))).status, 401, 'no token → 401');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await token({ email: 'boss@example.com' }, other.privateKey) }))).status, 401, 'wrong key → 401');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await token({ email: 'boss@example.com', aud: ['x'] }) }))).status, 401, 'wrong audience → 401');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await token({ email: 'boss@example.com', exp: 1 }) }))).status, 401, 'expired → 401');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await token({ email: 'boss@example.com', iss: 'https://evil.example' }) }))).status, 401, 'wrong issuer → 401');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await token({ email: 'boss@example.com' }, privateKey, 'nokid') }))).status, 401, 'unknown key id → 401');
const tamper = (await token({ email: 'stranger@example.com' })).split('.'); tamper[1] = b64({ aud: [AUD], iss: `https://${TEAM}`, exp: 9e9, email: 'boss@example.com' });
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: tamper.join('.') }))).status, 401, 'tampered claims → 401');
eq(await call(Me.onRequestGet, await req('GET', '/api/me', { email: 'boss@example.com' })),
  { status: 200, body: { email: 'boss@example.com', role: 'admin', googleUsersUrl: 'https://console.example/users' } }, 'server admin');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { email: 'stranger@example.com' }))).status, 403, 'not listed → 403');

// Admin: add
eq((await call(P.onRequestGet, await req('GET', '/api/admin/people', { email: 'boss@example.com' }))).body, { people: [], requests: [], fixed: ['boss@example.com'] }, 'empty list');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'noname@example.com' } }))).body.error, 'name-needed', 'name required');
let r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: ' Reader@Example.com ', name: ' Ann  Reader ', role: 'reader', login: 'google' } }));
eq(r.status, 200, 'add reader');
eq(r.body.people.map(p => [p.email, p.name, p.role, p.login, p.addedBy]), [['reader@example.com', 'Ann Reader', 'reader', 'google', 'boss@example.com']], 'saved cleanly');
eq(policy.include.map(x => x.email.email), ['boss@example.com', 'reader@example.com'], 'Access policy has admin + reader');
eq(policy.session_duration, '720h', 'policy keeps its session length');
ok(cfCalls.every(c => c.auth === 'Bearer tok'), 'token sent only as a header');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { email: 'reader@example.com' }))).body, { email: 'reader@example.com', role: 'reader' }, 'reader sees no admin link');
eq((await call(P.onRequestGet, await req('GET', '/api/admin/people', { email: 'reader@example.com' }))).status, 403, 'reader cannot list');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'reader@example.com', body: { email: 'x@example.com' } }))).status, 403, 'reader cannot add');

// Admin: guards
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'x@example.com' }, origin: 'https://evil.example' }))).status, 403, 'other origin refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'x@example.com' }, origin: null }))).status, 403, 'no origin refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'x@example.com' }, site: 'cross-site' }))).status, 403, 'cross-site fetch refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'x@example.com' }, ctype: 'text/plain' }))).status, 415, 'form posts refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'not an email' } }))).body.error, 'bad-email', 'bad email');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { name: 'Boss', email: 'BOSS@example.com' } }))).body.error, 'fixed-admin', 'server admin not editable');

// Promote a second admin, who then manages people
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { name: 'Some One', email: 'helper@example.com', role: 'admin', login: 'code' } }));
eq(r.status, 200, 'add admin');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'helper@example.com', body: { name: 'Some One', email: 'reader@example.com', role: 'reader', login: 'code' } }))).body.people.find(p => p.email === 'reader@example.com').login, 'code', 'change login method');
eq((await call(P.onRequestDelete, await req('DELETE', '/api/admin/people', { email: 'helper@example.com', body: { email: 'helper@example.com' } }))).body.error, 'not-yourself', 'cannot remove yourself');

// Access down: nothing saved
const before = JSON.stringify(R2.peek()); cfDown = true;
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { name: 'Some One', email: 'new@example.com' } }));
cfDown = false;
eq([r.status, r.body.error], [502, 'sync-failed'], 'Access failure reported');
eq(JSON.stringify(R2.peek()), before, 'list unchanged when Access fails');

// Remove: policy updated + session revoked
cfCalls.length = 0;
r = await call(P.onRequestDelete, await req('DELETE', '/api/admin/people', { email: 'boss@example.com', body: { email: 'reader@example.com' } }));
eq(r.body.people.map(p => p.email), ['helper@example.com'], 'removed from list');
eq(policy.include.map(x => x.email.email), ['boss@example.com', 'helper@example.com'], 'removed from Access');
ok(cfCalls.some(c => c.u.endsWith('/revoke_user') && c.body.email === 'reader@example.com'), 'session revoked');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { email: 'reader@example.com' }))).status, 403, 'removed reader locked out of API at once');

// Not configured
const bare = await Me.onRequestGet({ request: await req('GET', '/api/me', { email: 'boss@example.com' }), env: {} });
eq(bare.status, 503, 'unconfigured → 503');
const noTok = { ...env, CF_ACCESS_TOKEN: '' };
eq((await (await P.onRequestPost({ request: await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { name: 'Some One', email: 'z@example.com' } }), env: noTok })).json()).error, 'sync-not-configured', 'no token → clear error');

// ---- Ask to join ----
const jtok = email => token({ email, aud: [JAUD] });
eq((await call(J.onRequestGet, await req('GET', '/join/api', { email: 'ann@example.com' }))).status, 401, 'main-app token refused on /join');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { tok: await jtok('helper@example.com') }))).status, 401, 'join token refused on the app');
eq((await call(J.onRequestGet, await req('GET', '/join/api', { tok: await jtok('Ann@Example.com') }))).body, { email: 'ann@example.com', status: 'none' }, 'new person: none');
eq((await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok('ann@example.com'), body: { name: ' ' } }))).body.error, 'name-needed', 'join needs a name');
eq((await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok('ann@example.com'), body: { name: 'Ann' }, origin: 'https://evil.example' }))).status, 403, 'join cross-site refused');
eq((await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok('ann@example.com'), body: { name: 'Ann  Lee', note: 'Hi\u0007 it is Ann' } }))).body, { status: 'waiting' }, 'request saved');
eq(pushes.length, 1, 'admin notified');
ok(!JSON.stringify(pushes).includes('ann') && !JSON.stringify(pushes).includes('Ann'), 'push carries no name or email');
eq(pushes[0].headers.click, ORIGIN + '/#settings', 'push opens Settings');
await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok('ann@example.com'), body: { name: 'Ann Lee' } }));
eq(pushes.length, 1, 'asking again does not push again');
eq((await call(J.onRequestGet, await req('GET', '/join/api', { tok: await jtok('ann@example.com') }))).body.status, 'waiting', 'waiting shown');
eq((await call(J.onRequestGet, await req('GET', '/join/api', { tok: await jtok('helper@example.com') }))).body.status, 'member', 'member shown');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { email: 'ann@example.com' }))).status, 403, 'waiting person cannot use the app');
r = await call(P.onRequestGet, await req('GET', '/api/admin/people', { email: 'boss@example.com' }));
eq(r.body.requests.map(x => [x.email, x.name, x.note]), [['ann@example.com', 'Ann Lee', '']], 'admin sees name + email');
await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok('bob@example.com'), body: { name: 'Bob' } }));
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { email: 'boss@example.com', body: { email: 'ann@example.com', name: 'Ann Lee', role: 'reader', login: 'code' } }));
eq([r.body.requests.map(x => x.email), r.body.people.some(p => p.email === 'ann@example.com')], [['bob@example.com'], true], 'approve moves request to People');
ok(policy.include.some(x => x.email.email === 'ann@example.com'), 'approved person in Access');
eq((await call(Q.onRequestDelete, await req('DELETE', '/api/admin/requests', { email: 'helper@example.com', body: { email: 'bob@example.com' } }))).body.requests, [], 'decline removes request');
ok(!policy.include.some(x => x.email.email === 'bob@example.com'), 'declined person not in Access');
eq((await call(Q.onRequestDelete, await req('DELETE', '/api/admin/requests', { email: 'ann@example.com', body: { email: 'x@example.com' } }))).status, 403, 'reader cannot decline');
for (let i = 0; i < 25; i++) await call(J.onRequestPost, await req('POST', '/join/api', { tok: await jtok(`p${i}@example.com`), body: { name: 'P' + i } }));
eq((await R2.get('system/requests.json').then(o => o.json())).requests.length, 20, 'at most 20 waiting');

console.log(`people API: ${pass} checks passed`);
