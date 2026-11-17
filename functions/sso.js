// /sso — the Google / email-code way in. Cloudflare Access guards this one path (its policy = the People list); once
// Access lets someone through, they get the same Book Editor cookie a passcode gives, and go on to the app.
import { verifyAccess, whoIs, HttpError } from '../server/access.js';
import { credsFor, makeCookie, safeNext } from '../server/session.js';

const go = (to, cookie) => {
  const r = new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
  if (cookie) r.headers.append('set-cookie', cookie);
  return r;
};

export async function onRequestGet({ request, env }) {
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  try {
    const email = await verifyAccess(request, env);
    await whoIs(email, env);
    const c = await credsFor(env, email);
    return go(next, await makeCookie(env, email, c.sv));
  } catch (e) {
    const why = e instanceof HttpError && e.status === 403 ? 'not-listed' : 'sso';
    if (!(e instanceof HttpError)) console.error('sso', e && e.stack || e);
    return go('/signin/?e=' + why);
  }
}
