// POST /api/admin/invite { email } → { invite: { email, name, token, exp } } — a new one-time sign-in link for someone on
// the list (first sign-in, or a forgotten passcode). Any older link for that person stops working. Admins only.
import { sameOrigin, whoIs, cleanEmail, HttpError, json, errorResponse } from '../../../server/access.js';
import { requireAdmin, newInvite } from '../../../server/session.js';

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    await requireAdmin(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    let email; try { email = cleanEmail(JSON.parse(await request.text()).email); } catch { throw new HttpError(400, 'bad-json'); }
    if (!email) throw new HttpError(400, 'bad-email');
    const who = await whoIs(email, env).catch(e => { if (e.status === 403) throw new HttpError(404, 'not-found'); throw e; });
    const { token, exp } = await newInvite(env, email);
    return json({ invite: { email, name: who.name || '', token, exp } });
  } catch (e) { return errorResponse(e); }
}
