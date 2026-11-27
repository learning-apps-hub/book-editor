// /signin/api — Book Editor's own sign-in (open to everyone; the middleware lets it through).
//   POST { action: 'login',  email, passcode }  → { ok } + cookie
//   POST { action: 'invite', invite }           → { email, name, reset }   (who the invite link is for)
//   POST { action: 'redeem', invite, passcode } → { ok } + cookie          (choose a passcode; the link then stops working)
// Wrong passcodes lock that email (5 tries) and that network address (20 tries) for 15 minutes.
import { whoIs, cleanEmail, sameOrigin, HttpError, json, errorResponse } from '../../server/access.js';
import {
  readCreds, checkPasscode, cleanPasscode, emailLock, ipLock, checkLocks, addFailure, clearLock, openInvite, useInvite, makeCookie,
} from '../../server/session.js';

async function body(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
  const text = await request.text();
  if (text.length > 2048) throw new HttpError(413, 'too-big');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
}
const listed = (email, env) => whoIs(email, env).catch(e => { if (e.status === 403) return null; throw e; });
const signedIn = async (env, email, sv) => { const r = json({ ok: true }); r.headers.append('set-cookie', await makeCookie(env, email, sv)); return r; };

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const b = await body(request);
    if (b.action === 'login') {
      const email = cleanEmail(b.email), passcode = String(b.passcode ?? '');
      if (!email) throw new HttpError(400, 'bad-email');
      if (!passcode || passcode.length > 128) throw new HttpError(401, 'wrong');
      const locks = [await emailLock(email), await ipLock(request)];
      await checkLocks(env, locks);
      const me = await listed(email, env), c = me ? await readCreds(env, email) : null;
      const ok = await checkPasscode(env, passcode, c?.pass);
      if (!ok || !me) { await addFailure(env, locks); throw new HttpError(401, 'wrong'); }
      await clearLock(env, locks[0]);
      return signedIn(env, email, c.sv);
    }
    if (b.action === 'invite') {
      const inv = await openInvite(env, b.invite), me = await listed(inv.email, env);
      if (!me) throw new HttpError(404, 'invite-bad');
      return json({ email: inv.email, name: me.name || '', reset: !!inv.creds.pass });
    }
    if (b.action === 'redeem') {
      const passcode = cleanPasscode(b.passcode);
      const inv = await openInvite(env, b.invite);
      if (!(await listed(inv.email, env))) throw new HttpError(404, 'invite-bad');
      const c = await useInvite(env, inv, passcode);
      return signedIn(env, inv.email, c.sv);
    }
    throw new HttpError(400, 'bad-action');
  } catch (e) { return errorResponse(e); }
}
