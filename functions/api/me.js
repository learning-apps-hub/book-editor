// GET /api/me → who is signed in and what they may do. Used by the Settings screen.
import { requireUser, json, errorResponse } from '../../server/access.js';

export async function onRequestGet({ request, env }) {
  try {
    const me = await requireUser(request, env);
    const out = { email: me.email, role: me.role };
    if (me.role === 'admin' && env.GOOGLE_USERS_URL) out.googleUsersUrl = env.GOOGLE_USERS_URL;
    return json(out);
  } catch (e) { return errorResponse(e); }
}
