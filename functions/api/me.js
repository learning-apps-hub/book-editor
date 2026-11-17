// GET /api/me → who is signed in and what they may do. Used by the Settings screen.
import { json, errorResponse } from '../../server/access.js';
import { requireUser, readCreds } from '../../server/session.js';

export async function onRequestGet({ request, env }) {
  try {
    const me = await requireUser(request, env);
    const c = await readCreds(env, me.email);
    const out = { email: me.email, role: me.role, name: me.name || '', hasPasscode: !!c?.pass };
    if (me.role === 'admin' && env.GOOGLE_USERS_URL) out.googleUsersUrl = env.GOOGLE_USERS_URL;
    return json(out);
  } catch (e) { return errorResponse(e); }
}
