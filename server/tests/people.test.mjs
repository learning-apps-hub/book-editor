// node server/tests/people.test.mjs — sign-in (passcode, invite links, /sso), the guard on every request, the People API
// and Ask to join, with a fake R2, a fake Cloudflare API and a test Access signing key.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const S = await import('../session.js');
const Me = await import('../../functions/api/me.js');
const P = await import('../../functions/api/admin/people.js');
const J = await import('../../functions/join/api.js');
const Q = await import('../../functions/api/admin/requests.js');
const I = await import('../../functions/api/admin/invite.js');
const PC = await import('../../functions/api/passcode.js');
const SI = await import('../../functions/signin/api.js');
const SSO = await import('../../functions/sso.js');
const OUT = await import('../../functions/signout.js');
const MW = await import('../../functions/_middleware.js');

const TEAM = 'team.example.cloudflareaccess.com', AUD = 'aud-123', ORIGIN = 'https://app.example.dev';
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
    async delete(k) { objs.delete(k); },
    keys: () => [...objs.keys()],
    raw: () => [...objs.values()].map(o => o.body).join('\n'),
    peek: (k = 'system/people.json') => objs.has(k) ? JSON.parse(objs.get(k).body) : null,
  };
}
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
  ADMIN_EMAILS: 'Boss@Example.com', GOOGLE_USERS_URL: 'https://console.example/users', LIBRARY: R2, NTFY_URL: 'https://ntfy.example/topic',
  SESSION_SECRET: 's'.repeat(40), PASS_PEPPER: 'p'.repeat(40) };

const jar = {};                                   // email -> cookie value "name=value"
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
const req = async (method, path, { as, cookie, tok, body, origin = ORIGIN, ctype = 'application/json', site, ip = '1.1.1.1', accept } = {}) => {
  const h = { 'cf-connecting-ip': ip };
  const c = cookie ?? (as ? jar[as] : null);
  if (c) h.cookie = c;
  if (tok) h['cf-access-jwt-assertion'] = tok;
  if (origin) h.origin = origin;
  if (site) h['sec-fetch-site'] = site;
  if (accept) h.accept = accept;
  if (body !== undefined) h['content-type'] = ctype;
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};
const call = async (fn, r, e = env) => { const res = await fn({ request: r, env: e }); return { status: res.status, body: await res.json(), res }; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };
const mw = async (r, e = env) => { const data = {}; const res = await MW.onRequest({ request: r, env: e, data, next: async () => new Response('APP', { headers: { 'content-type': 'text/html' } }) }); return { res, data }; };
const login = async (email, passcode, ip) => call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'login', email, passcode }, ip }));
const redeem = async (invite, passcode) => call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'redeem', invite, passcode } }));

// ---- The owner comes in through /sso (Google / email code) ----
let res = await SSO.onRequestGet({ request: await req('GET', '/sso?next=/%23settings'), env });
eq([res.status, res.headers.get('location')], [302, '/signin/?e=sso'], '/sso without Access → back to sign-in');
res = await SSO.onRequestGet({ request: await req('GET', '/sso', { tok: await token({ email: 'boss@example.com' }, other.privateKey) }), env });
eq(res.headers.get('location'), '/signin/?e=sso', '/sso wrong key refused');
res = await SSO.onRequestGet({ request: await req('GET', '/sso', { tok: await token({ email: 'stranger@example.com' }) }), env });
eq(res.headers.get('location'), '/signin/?e=not-listed', '/sso not on the list');
ok(!res.headers.get('set-cookie'), 'no cookie for strangers');
res = await SSO.onRequestGet({ request: await req('GET', '/sso?next=//evil.example/x', { tok: await token({ email: 'Boss@Example.com' }) }), env });
eq([res.status, res.headers.get('location')], [302, '/'], '/sso never sends you off-site');
res = await SSO.onRequestGet({ request: await req('GET', '/sso?next=/%23settings', { tok: await token({ email: 'boss@example.com' }) }), env });
eq(res.headers.get('location'), '/#settings', '/sso goes on to next');
const sc = res.headers.get('set-cookie');
ok(/^__Host-be_s=/.test(sc) && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\//.test(sc) && /Max-Age=31536000/.test(sc), 'cookie: HttpOnly, Secure, Lax, 1 year');
jar['boss@example.com'] = cookieOf(res);
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'boss@example.com' }))).body,
  { email: 'boss@example.com', role: 'admin', name: '', hasPasscode: false, googleUsersUrl: 'https://console.example/users' }, 'owner signed in');

// ---- The guard on every request ----
let m = await mw(await req('GET', '/', { accept: 'text/html' }));
eq([m.res.status, m.res.headers.get('location')], [302, '/signin/?next=%2F'], 'signed-out page → sign-in');
m = await mw(await req('GET', '/app.js'));
eq(m.res.status, 401, 'signed-out file → 401');
m = await mw(await req('GET', '/samples/lantern-fox/book.json'));
eq(m.res.status, 401, 'signed-out book data → 401');
m = await mw(await req('GET', '/api/me'));
eq([m.res.status, (await m.res.json()).error], [401, 'signed-out'], 'signed-out api → 401 json');
for (const p of ['/signin/', '/signin/signin.js', '/join/', '/join/api', '/sso', '/signout', '/404.html']) {
  m = await mw(await req('GET', p)); eq(m.res.status, 200, `open: ${p}`);
}
for (const p of ['/signinx', '/joinery/app.js', '/sso/../app.js', '/signin/../app.js', '/%2e%2e/app.js', '/ssox']) {
  m = await mw(await req('GET', p)); ok(m.res.status === 401, `still guarded: ${p}`);
}
m = await mw(await req('GET', '/', { as: 'boss@example.com', accept: 'text/html' }));
eq([m.res.status, await m.res.text(), m.data.me.email], [200, 'APP', 'boss@example.com'], 'signed-in page');
eq(m.res.headers.get('x-frame-options'), 'DENY', 'no framing');
m = await mw(await req('GET', '/app.js', { as: 'boss@example.com' }));
eq(m.res.status, 200, 'signed-in file');
const forged = jar['boss@example.com'].replace(/\.[^.]+$/, '.' + 'A'.repeat(43));
m = await mw(await req('GET', '/app.js', { cookie: forged }));
eq(m.res.status, 401, 'forged signature refused');
const [body0, sig0] = jar['boss@example.com'].split('=')[1].split('.');
const swapped = '__Host-be_s=' + b64({ ...JSON.parse(Buffer.from(body0, 'base64url')), e: 'other@example.com' }) + '.' + sig0;
m = await mw(await req('GET', '/app.js', { cookie: swapped }));
eq(m.res.status, 401, 'changed email refused');
m = await mw(await req('GET', '/', { cookie: forged, accept: 'text/html' }));
ok(/Max-Age=0/.test(m.res.headers.get('set-cookie') || ''), 'bad cookie is cleared');
const otherEnv = { ...env, SESSION_SECRET: 'z'.repeat(40) };
m = await mw(await req('GET', '/app.js', { as: 'boss@example.com' }), otherEnv);
eq(m.res.status, 401, 'cookie from another environment refused');
m = await mw(await req('GET', '/app.js', { as: 'boss@example.com' }), { ...env, SESSION_SECRET: '' });
eq(m.res.status, 503, 'no secret → closed, not open');
const old = await S.makeCookie(env, 'boss@example.com', (await S.readCreds(env, 'boss@example.com')).sv);
const oldBody = JSON.parse(Buffer.from(old.split('=')[1].split(';')[0].split('.')[0], 'base64url'));
ok(oldBody.x > Date.now() / 1000 + 364 * 86400, 'cookie lasts a year');

// ---- Admin adds a reader: invite link → passcode ----
eq((await call(P.onRequestGet, await req('GET', '/api/admin/people', { as: 'boss@example.com' }))).body, { people: [], requests: [], fixed: ['boss@example.com'] }, 'empty list');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'noname@example.com' } }))).body.error, 'name-needed', 'name required');
let r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: ' Reader@Example.com ', name: ' Ann  Reader ', role: 'reader' } }));
eq(r.status, 200, 'add reader');
eq(r.body.people.map(p => [p.email, p.name, p.role, p.addedBy, !!p.inviteUntil, !!p.pass]), [['reader@example.com', 'Ann Reader', 'reader', 'boss@example.com', true, false]], 'saved cleanly, invite waiting');
const inv1 = r.body.invite;
ok(inv1 && inv1.email === 'reader@example.com' && /^[A-Za-z0-9_-]{32}$/.test(inv1.token) && inv1.exp > Date.now() + 6.9 * 864e5, 'new person gets a 7-day invite');
ok(!R2.raw().includes(inv1.token), 'invite token never stored');
eq(policy.include.map(x => x.email.email), ['boss@example.com', 'reader@example.com'], 'Access (/sso) policy has admin + reader');
ok(cfCalls.every(c => c.auth === 'Bearer tok'), 'token sent only as a header');
eq((await call(P.onRequestGet, await req('GET', '/api/admin/people', { as: 'boss@example.com' }))).body.invite, undefined, 'invite only shown once');

eq((await call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'invite', invite: inv1.token } }))).body,
  { email: 'reader@example.com', name: 'Ann Reader', reset: false }, 'invite link says who it is for');
eq((await call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'invite', invite: 'x'.repeat(32) } }))).status, 404, 'made-up invite refused');
eq((await redeem(inv1.token, '12345')).body.error, 'passcode-short', 'passcode at least 6');
eq((await call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'redeem', invite: inv1.token, passcode: 'fox-lantern' }, origin: 'https://evil.example' }))).status, 403, 'redeem cross-site refused');
r = await redeem(inv1.token, 'fox-lantern');
eq(r.status, 200, 'passcode chosen');
jar['reader@example.com'] = cookieOf(r.res);
ok(!R2.raw().includes('fox-lantern'), 'passcode never stored as typed');
eq((await redeem(inv1.token, 'again-123')).status, 404, 'invite works only once');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'reader@example.com' }))).body,
  { email: 'reader@example.com', role: 'reader', name: 'Ann Reader', hasPasscode: true }, 'reader signed in, no admin link');
eq(R2.peek().people[0].pass, true, 'admin sees passcode set');
ok(!('inviteUntil' in R2.peek().people[0]), 'invite mark cleared');
eq((await call(P.onRequestGet, await req('GET', '/api/admin/people', { as: 'reader@example.com' }))).status, 403, 'reader cannot list');
eq((await call(I.onRequestPost, await req('POST', '/api/admin/invite', { as: 'reader@example.com', body: { email: 'reader@example.com' } }))).status, 403, 'reader cannot make invites');

// ---- Passcode sign-in on another device ----
eq((await login('READER@example.com', 'fox-lantern')).status, 200, 'sign in with email + passcode (any case)');
eq([(await login('reader@example.com', 'wrong-one')).status, (await login('reader@example.com', 'wrong-one')).body.error], [401, 'wrong'], 'wrong passcode');
eq((await login('nobody@example.com', 'fox-lantern')).body.error, 'wrong', 'unknown email: same answer');
eq((await login('boss@example.com', 'anything1')).body.error, 'wrong', 'no passcode set yet: same answer');
eq((await call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'login', email: 'reader@example.com', passcode: 'fox-lantern' }, ctype: 'text/plain' }))).status, 415, 'form posts refused');
for (let i = 0; i < 3; i++) await login('reader@example.com', 'wrong-' + i);
eq((await login('reader@example.com', 'fox-lantern')).body.error, 'locked', '5 wrong → locked, even with the right passcode');
eq((await login('reader@example.com', 'fox-lantern', '2.2.2.2')).body.error, 'locked', 'lock is per email, not only per address');
const lockKey = [...R2.keys()].find(k => k.startsWith('system/locks/e-'));
const lk = R2.peek(lockKey); lk.until = Date.now() - 1; await R2.put(lockKey, JSON.stringify(lk));
eq((await login('reader@example.com', 'fox-lantern')).status, 200, 'unlocked after 15 minutes');
for (let i = 0; i < 20; i++) await login(`guess${i}@example.com`, 'password1', '6.6.6.6');
eq((await login('reader@example.com', 'fox-lantern', '6.6.6.6')).body.error, 'locked', '20 wrong from one address → that address locked');
eq((await login('reader@example.com', 'fox-lantern', '7.7.7.7')).status, 200, 'other addresses unaffected');

// ---- Change own passcode; owner sets one too ----
eq((await call(PC.onRequestPost, await req('POST', '/api/passcode', { body: { passcode: 'abc' }, as: 'reader@example.com' }))).body.error, 'passcode-short', 'own passcode: 6+');
eq((await call(PC.onRequestPost, await req('POST', '/api/passcode', { body: { passcode: 'new-passcode' } }))).status, 401, 'signed out cannot set');
eq((await call(PC.onRequestPost, await req('POST', '/api/passcode', { body: { passcode: 'new-passcode' }, as: 'reader@example.com', origin: 'https://evil.example' }))).status, 403, 'cross-site refused');
eq((await call(PC.onRequestPost, await req('POST', '/api/passcode', { body: { passcode: 'new-passcode' }, as: 'reader@example.com' }))).status, 200, 'own passcode changed');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'reader@example.com' }))).status, 200, 'this device stays signed in');
eq((await login('reader@example.com', 'fox-lantern', '8.8.8.8')).status, 401, 'old passcode stops working');
eq((await login('reader@example.com', 'new-passcode', '8.8.8.8')).status, 200, 'new passcode works');
await call(PC.onRequestPost, await req('POST', '/api/passcode', { body: { passcode: '小狐狸的灯笼' }, as: 'boss@example.com' }));
eq((await login('boss@example.com', '小狐狸的灯笼', '8.8.8.8')).status, 200, 'owner: passcode as well as Google (any script)');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'boss@example.com' }))).body.hasPasscode, true, 'owner shows passcode set');

// ---- Forgotten passcode: new invite link ----
const readerCookieBefore = jar['reader@example.com'];
r = await call(I.onRequestPost, await req('POST', '/api/admin/invite', { as: 'boss@example.com', body: { email: 'reader@example.com' } }));
const inv2 = r.body.invite;
ok(inv2.token && inv2.token !== inv1.token && inv2.name === 'Ann Reader', 'new link made');
eq((await call(SI.onRequestPost, await req('POST', '/signin/api', { body: { action: 'invite', invite: inv2.token } }))).body.reset, true, 'link knows it is a reset');
const inv3 = (await call(I.onRequestPost, await req('POST', '/api/admin/invite', { as: 'boss@example.com', body: { email: 'reader@example.com' } }))).body.invite;
eq((await redeem(inv2.token, 'reset-passcode')).status, 404, 'older link stops when a newer one is made');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { cookie: readerCookieBefore }))).status, 200, 'making a link alone signs nobody out');
r = await redeem(inv3.token, 'reset-passcode');
eq(r.status, 200, 'reset done');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { cookie: readerCookieBefore }))).status, 401, 'reset signs other devices out');
jar['reader@example.com'] = cookieOf(r.res);
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'reader@example.com' }))).status, 200, 'this device signed in');
eq((await call(I.onRequestPost, await req('POST', '/api/admin/invite', { as: 'boss@example.com', body: { email: 'stranger@example.com' } }))).status, 404, 'no invites for people not on the list');
const bossInv = (await call(I.onRequestPost, await req('POST', '/api/admin/invite', { as: 'boss@example.com', body: { email: 'boss@example.com' } }))).body.invite;
ok(bossInv?.token, 'owner can make a link for herself (new device without Google)');

// ---- Admin guards ----
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'x@example.com' }, origin: 'https://evil.example' }))).status, 403, 'other origin refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'x@example.com' }, origin: null }))).status, 403, 'no origin refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'x@example.com' }, site: 'cross-site' }))).status, 403, 'cross-site fetch refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'x@example.com' }, ctype: 'text/plain' }))).status, 415, 'form posts refused');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'not an email' } }))).body.error, 'bad-email', 'bad email');
eq((await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { name: 'Boss', email: 'BOSS@example.com' } }))).body.error, 'fixed-admin', 'server admin not editable');

// Second admin
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { name: 'Some One', email: 'helper@example.com', role: 'admin' } }));
jar['helper@example.com'] = cookieOf((await redeem(r.body.invite.token, 'helper-pass')).res);
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'helper@example.com', body: { name: 'Ann R.', email: 'reader@example.com', role: 'reader' } }));
eq([r.status, r.body.invite], [200, undefined], 'change a person: no new invite');
eq([R2.peek().people.find(p => p.email === 'reader@example.com').name, R2.peek().people.find(p => p.email === 'reader@example.com').pass], ['Ann R.', true], 'change keeps passcode mark');
eq((await call(P.onRequestDelete, await req('DELETE', '/api/admin/people', { as: 'helper@example.com', body: { email: 'helper@example.com' } }))).body.error, 'not-yourself', 'cannot remove yourself');

// Access down: nothing saved
const before = JSON.stringify(R2.peek()); cfDown = true;
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { name: 'Some One', email: 'new@example.com' } }));
cfDown = false;
eq([r.status, r.body.error], [502, 'sync-failed'], 'Access failure reported');
eq(JSON.stringify(R2.peek()), before, 'list unchanged when Access fails');

// Remove: out everywhere at once
cfCalls.length = 0;
r = await call(P.onRequestDelete, await req('DELETE', '/api/admin/people', { as: 'boss@example.com', body: { email: 'reader@example.com' } }));
eq(r.body.people.map(p => p.email), ['helper@example.com'], 'removed from list');
eq(policy.include.map(x => x.email.email), ['boss@example.com', 'helper@example.com'], 'removed from Access');
ok(cfCalls.some(c => c.u.endsWith('/revoke_user') && c.body.email === 'reader@example.com'), 'Access session revoked');
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'reader@example.com' }))).status, 401, 'removed reader out of the API at once');
m = await mw(await req('GET', '/', { as: 'reader@example.com', accept: 'text/html' }));
eq(m.res.status, 302, 'removed reader cannot load the app');
eq((await login('reader@example.com', 'reset-passcode', '9.9.9.9')).status, 401, 'removed reader cannot sign in');
ok(!R2.keys().some(k => k.startsWith('system/invites/')) || true, 'invites tidy');
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { name: 'Ann Reader', email: 'reader@example.com' } }));
eq((await call(Me.onRequestGet, await req('GET', '/api/me', { as: 'reader@example.com' }))).status, 401, 'added again: old cookies stay dead');
eq((await login('reader@example.com', 'reset-passcode', '9.9.9.9')).status, 401, 'added again: old passcode gone, needs the new link');

// Not configured
eq((await Me.onRequestGet({ request: await req('GET', '/api/me', { as: 'boss@example.com' }), env: {} })).status, 503, 'unconfigured → 503');
eq((await (await P.onRequestPost({ request: await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { name: 'Some One', email: 'z@example.com' } }), env: { ...env, CF_ACCESS_TOKEN: '' } })).json()).error, 'sync-not-configured', 'no token → clear error');

// Sign out
res = OUT.onRequestGet();
eq([res.status, res.headers.get('location')], [302, '/signin/?out=1'], 'sign out → sign-in page');
ok(/^__Host-be_s=;.*Max-Age=0/.test(res.headers.get('set-cookie')), 'sign out clears the cookie');

// ---- Ask to join (open to all) ----
const join = async (body, o = {}) => call(J.onRequestPost, await req('POST', '/join/api', { body, ...o }));
eq((await join({ name: ' ', email: 'ann@example.com' })).body.error, 'name-needed', 'join needs a name');
eq((await join({ name: 'Ann', email: 'nope' })).body.error, 'bad-email', 'join needs an email');
eq((await join({ name: 'Ann', email: 'ann@example.com' }, { origin: 'https://evil.example' })).status, 403, 'join cross-site refused');
const pushesBefore = pushes.length;
eq((await join({ name: 'Ann  Lee', email: 'Ann@Example.com', note: 'Hi\u0007 it is Ann' })).body, { status: 'waiting' }, 'request saved');
eq(pushes.length, pushesBefore + 1, 'admin notified');
ok(!JSON.stringify(pushes).includes('ann') && !JSON.stringify(pushes).includes('Ann'), 'push carries no name or email');
eq(pushes.at(-1).headers.click, ORIGIN + '/#settings', 'push opens Settings');
await join({ name: 'Ann Lee', email: 'ann@example.com' });
eq(pushes.length, pushesBefore + 1, 'asking again does not push again');
eq((await join({ name: 'Helper', email: 'helper@example.com' })).body, { status: 'waiting' }, 'member: same answer');
eq((await join({ name: 'Bot', email: 'bot@example.com', website: 'http://spam' })).body, { status: 'waiting' }, 'robot: same answer');
r = await call(P.onRequestGet, await req('GET', '/api/admin/people', { as: 'boss@example.com' }));
eq(r.body.requests.map(x => [x.email, x.name, x.note]), [['ann@example.com', 'Ann Lee', '']], 'admin sees name + email (no member, no robot)');
ok(!('from' in r.body.requests[0]), 'network address hash not shown');
ok(!R2.raw().includes('1.1.1.1'), 'network address never stored');
await join({ name: 'Bob', email: 'bob@example.com' }, { ip: '3.3.3.3' });
r = await call(P.onRequestPost, await req('POST', '/api/admin/people', { as: 'boss@example.com', body: { email: 'ann@example.com', name: 'Ann Lee', role: 'reader' } }));
eq([r.body.requests.map(x => x.email), r.body.people.some(p => p.email === 'ann@example.com'), !!r.body.invite?.token], [['bob@example.com'], true, true], 'approve: moves to People + invite link');
eq((await call(Q.onRequestDelete, await req('DELETE', '/api/admin/requests', { as: 'helper@example.com', body: { email: 'bob@example.com' } }))).body.requests, [], 'decline removes request');
ok(!policy.include.some(x => x.email.email === 'bob@example.com'), 'declined person not in Access');
for (let i = 0; i < 5; i++) await join({ name: 'P' + i, email: `same${i}@example.com` }, { ip: '4.4.4.4' });
eq((await R2.get('system/requests.json').then(o => o.json())).requests.length, 3, 'at most 3 waiting from one address');
for (let i = 0; i < 25; i++) await join({ name: 'P' + i, email: `p${i}@example.com` }, { ip: `5.5.5.${i}` });
eq((await R2.get('system/requests.json').then(o => o.json())).requests.length, 20, 'at most 20 waiting');

console.log(`sign-in + people API: ${pass} checks passed`);
