// Book Editor's own sign-in: each person chooses a passcode from a one-time invite link, then stays signed in on that
// device with a signed cookie. Google / email code (Cloudflare Access on /sso only) is a second way in that ends in
// the same cookie. Nothing personal lives in this public repo; secrets come from the Pages project's settings:
//   SESSION_SECRET  secret  random, 32+ characters, one per environment: signs the sign-in cookie
//   PASS_PEPPER     secret  random, 32+ characters: mixed into every passcode hash (a copied bucket alone is not enough)
// R2 (binding LIBRARY, private bucket):
//   system/creds/<hash of email>.json   { email, sv, pass?: { it, salt, hash }, invite?: { hash, exp } }
//   system/invites/<hash of token>.json { email, exp }      (the token itself is only ever in the invite link)
//   system/locks/<id>.json              { fails, first, until }  (wrong passcodes, per email and per network address)
import { HttpError, cleanEmail, whoIs, readPeople, writePeople } from './access.js';

export const COOKIE = '__Host-be_s';
export const SESSION_DAYS = 365, INVITE_DAYS = 7, PASS_MIN = 6, PASS_MAX = 128, PBKDF2_IT = 20000;
const LOCK_MIN = 15, EMAIL_TRIES = 5, IP_TRIES = 20, CACHE_MS = 30e3;

const enc = new TextEncoder(), dec = new TextDecoder();
export const b64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

const keys = new Map();
async function hmac(secret, data) {
  let k = keys.get(secret);
  if (!k) { k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); keys.set(secret, k); }
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function setting(env, name) {
  const v = env[name];
  if (!v || String(v).length < 32) throw new HttpError(503, 'not-configured');
  return String(v);
}
function bucket(env) { if (!env.LIBRARY) throw new HttpError(503, 'not-configured'); return env.LIBRARY; }
const putJson = (env, key, data) => bucket(env).put(key, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } });
async function getJson(env, key) { const o = await bucket(env).get(key); return o ? o.json() : null; }

// ---- Credentials (passcode hash, invite, session version) ----
const credKey = async email => 'system/creds/' + await sha256('be-creds:' + email) + '.json';
const inviteKey = hash => 'system/invites/' + hash + '.json';
const svCache = new Map();              // email -> { at, sv }; other copies of the server catch up within CACHE_MS
export const readCreds = async (env, email) => getJson(env, await credKey(email));
export async function writeCreds(env, email, c) { await putJson(env, await credKey(email), { ...c, email }); svCache.delete(email); }
export async function deleteCreds(env, email) {
  const c = await readCreds(env, email);
  if (c?.invite?.hash) await bucket(env).delete(inviteKey(c.invite.hash));
  await bucket(env).delete(await credKey(email));
  svCache.delete(email);
}
/** A fresh session version: every cookie made before it stops working. Never reused, even if a person is removed and added again. */
const newSv = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
export async function credsFor(env, email) {
  const c = await readCreds(env, email);
  if (c) return c;
  const fresh = { sv: newSv() };
  await writeCreds(env, email, fresh);
  return fresh;
}
async function currentSv(env, email) {
  const hit = svCache.get(email);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.sv;
  const sv = (await readCreds(env, email))?.sv ?? null;
  svCache.set(email, { at: Date.now(), sv });
  return sv;
}

// ---- Passcodes ----
export function cleanPasscode(p) {
  p = String(p ?? '').normalize('NFC');
  if ([...p].length < PASS_MIN) throw new HttpError(400, 'passcode-short');
  if (p.length > PASS_MAX) throw new HttpError(400, 'passcode-long');
  return p;
}
async function derive(env, passcode, salt, it) {
  const key = await crypto.subtle.importKey('raw', enc.encode(setting(env, 'PASS_PEPPER') + '\u0000' + passcode), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, key, 256));
}
export async function hashPasscode(env, passcode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { it: PBKDF2_IT, salt: b64u(salt), hash: b64u(await derive(env, passcode, salt, PBKDF2_IT)) };
}
/** Same work whether or not the person exists, so the answer time gives nothing away. */
export async function checkPasscode(env, passcode, p) {
  if (!p) { await derive(env, passcode, new Uint8Array(16), PBKDF2_IT); return false; }
  return same(await derive(env, passcode, unb64u(p.salt), p.it), unb64u(p.hash));
}

// ---- Wrong-passcode locks ----
export const emailLock = async email => 'e-' + (await sha256('be-lock:' + email)).slice(0, 40);
export const ipLock = async request => 'i-' + (await sha256('be-ip:' + (request.headers.get('cf-connecting-ip') || 'none'))).slice(0, 40);
const lockKey = id => 'system/locks/' + id + '.json';
export async function checkLocks(env, ids) {
  for (const id of ids) { const s = await getJson(env, lockKey(id)); if (s && s.until > Date.now()) throw new HttpError(429, 'locked'); }
}
export async function addFailure(env, ids) {
  const now = Date.now();
  for (const id of ids) {
    const max = id.startsWith('i-') ? IP_TRIES : EMAIL_TRIES;
    let s = (await getJson(env, lockKey(id))) || { fails: 0, first: now, until: 0 };
    if (now - s.first > 3600e3) s = { fails: 0, first: now, until: 0 };
    s.fails++;
    if (s.fails >= max) s = { fails: 0, first: now, until: now + LOCK_MIN * 60e3 };
    await putJson(env, lockKey(id), s);
  }
}
export const clearLock = (env, id) => bucket(env).delete(lockKey(id));

// ---- Invites: a one-time link, valid INVITE_DAYS, for one person ----
export async function newInvite(env, email) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const hash = await sha256('be-invite:' + token), exp = Date.now() + INVITE_DAYS * 864e5;
  const c = await credsFor(env, email);
  if (c.invite?.hash) await bucket(env).delete(inviteKey(c.invite.hash));         // only the newest link works
  await putJson(env, inviteKey(hash), { email, exp });
  await writeCreds(env, email, { ...c, invite: { hash, exp } });
  await markPerson(env, email, { inviteUntil: new Date(exp).toISOString() });
  return { token, exp };
}
/** { email, creds, hash } for a live invite token, else throws 404. */
export async function openInvite(env, token) {
  token = String(token ?? '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'invite-bad');
  const hash = await sha256('be-invite:' + token);
  const idx = await getJson(env, inviteKey(hash));
  const email = cleanEmail(idx?.email);
  if (!email || !(idx.exp > Date.now())) throw new HttpError(404, 'invite-bad');
  const c = await readCreds(env, email);
  if (!c?.invite || c.invite.hash !== hash || !(c.invite.exp > Date.now())) throw new HttpError(404, 'invite-bad');
  return { email, creds: c, hash };
}
export async function useInvite(env, inv, passcode) {
  const { email, creds, hash } = inv;
  const next = { ...creds, pass: await hashPasscode(env, passcode) };
  delete next.invite;
  if (creds.pass) next.sv = newSv();               // a reset: other devices are signed out
  await writeCreds(env, email, next);
  await bucket(env).delete(inviteKey(hash));
  await clearLock(env, await emailLock(email));
  await markPerson(env, email, { pass: true, inviteUntil: null });
  return next;
}
export async function setPasscode(env, email, passcode) {
  const c = await credsFor(env, email);
  await writeCreds(env, email, { ...c, pass: await hashPasscode(env, passcode) });
  await markPerson(env, email, { pass: true });
}

/** Keeps the admin's view of each person (passcode set? invite waiting?) in the People list. Never fails the caller. */
async function markPerson(env, email, patch) {
  for (let i = 0; i < 3; i++) {
    try {
      const { people, etag } = await readPeople(env);
      if (!people.some(p => p.email === email)) return;           // owner set on the server: not on the list
      const next = people.map(p => {
        if (p.email !== email) return p;
        const q = { ...p, ...patch };
        for (const k of Object.keys(q)) if (q[k] === null) delete q[k];
        return q;
      });
      await writePeople(env, next, etag);
      return;
    } catch (e) { if (e?.code !== 'changed') { console.error('markPerson', e); return; } }
  }
}

// ---- The sign-in cookie ----
export async function makeCookie(env, email, sv) {
  const x = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = b64u(enc.encode(JSON.stringify({ e: email, v: sv, x })));
  const sig = b64u(await hmac(setting(env, 'SESSION_SECRET'), 'be-session:' + body));
  return `${COOKIE}=${body}.${sig}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
export const hasCookie = request => (request.headers.get('cookie') || '').split(/;\s*/).some(c => c.startsWith(COOKIE + '='));

/** The cookie's contents { e, v, x } if it is ours, unchanged and not expired; else null. Cheap: no storage reads. */
export async function readCookie(request, env) {
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig, extra] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !sig || extra !== undefined) return null;
  let s;
  try {
    if (!same(await hmac(setting(env, 'SESSION_SECRET'), 'be-session:' + body), unb64u(sig))) return null;
    s = JSON.parse(dec.decode(unb64u(body)));
  } catch (e) { if (e instanceof HttpError) throw e; return null; }
  if (!s || !cleanEmail(s.e) || !(s.x > Date.now() / 1000)) return null;
  return s;
}

/** { email, role, fixed, session } for a signed-in person who is still on the list, else throws 401. */
export async function sessionUser(request, env) {
  const s = await readCookie(request, env);
  if (!s) throw new HttpError(401, 'signed-out');
  let me;
  try { me = await whoIs(s.e, env); } catch (e) { if (e.status === 403) throw new HttpError(401, 'signed-out'); throw e; }
  if ((await currentSv(env, s.e)) !== s.v) throw new HttpError(401, 'signed-out');
  return { ...me, session: s };
}
export async function requireUser(request, env) { return sessionUser(request, env); }
export async function requireAdmin(request, env) {
  const me = await sessionUser(request, env);
  if (me.role !== 'admin') throw new HttpError(403, 'not-admin');
  return me;
}

/** Where to go after signing in: a path on this site only. */
export function safeNext(x) {
  const s = String(x ?? '');
  return /^\/(?![\/\\])[^\s]*$/.test(s) && s.length < 500 ? s : '/';
}
