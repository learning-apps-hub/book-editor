// Every request to Book Editor passes here first. Signed-in people (Book Editor's own cookie) get the app; everyone
// else only reaches the sign-in page, the ask-to-join page and /sso (Google / email code via Cloudflare Access).
// Pages and /api calls check that the person is still on the list; plain files (scripts, pictures) check the cookie only.
import { HttpError, json, errorResponse } from '../server/access.js';
import { readCookie, sessionUser, makeCookie, clearCookie, hasCookie, SESSION_DAYS } from '../server/session.js';

const OPEN = [/^\/signin(\/|$)/, /^\/join(\/|$)/, /^\/sso\/?$/, /^\/signout\/?$/, /^\/404\.html$/];
const REFRESH_AFTER_S = 30 * 86400;          // a cookie in use is renewed once a month, so active people never get signed out

function harden(res) {
  const r = new Response(res.body, res);
  r.headers.set('x-frame-options', 'DENY');
  r.headers.set('referrer-policy', 'same-origin');
  r.headers.set('x-content-type-options', 'nosniff');
  return r;
}
const wantsPage = (request, url) => request.method === 'GET' && (
  ['document', 'iframe'].includes(request.headers.get('sec-fetch-dest')) || (request.headers.get('accept') || '').includes('text/html')
  || url.pathname.endsWith('/') || url.pathname.endsWith('.html'));

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  if (OPEN.some(r => r.test(url.pathname))) return harden(await next());
  const page = wantsPage(request, url), full = page || url.pathname.startsWith('/api/');
  try {
    if (!full) {
      if (!(await readCookie(request, env))) throw new HttpError(401, 'signed-out');
      return harden(await next());
    }
    const me = await sessionUser(request, env);
    ctx.data.me = me;
    const res = harden(await next());
    if (me.session.x - Date.now() / 1000 < (SESSION_DAYS * 86400) - REFRESH_AFTER_S) res.headers.append('set-cookie', await makeCookie(env, me.email, me.session.v));
    if (page) res.headers.set('cache-control', 'private, no-cache');
    return res;
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) return harden(errorResponse(e));
    const res = page
      ? new Response(null, { status: 302, headers: { location: '/signin/?next=' + encodeURIComponent(url.pathname + url.search), 'cache-control': 'no-store' } })
      : json({ error: 'signed-out' }, 401);
    if (hasCookie(request)) res.headers.append('set-cookie', clearCookie());
    return harden(res);
  }
}
