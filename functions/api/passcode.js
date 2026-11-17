// POST /api/passcode { passcode } — the signed-in person sets or changes their own passcode. This device stays signed in.
import { sameOrigin, HttpError, json, errorResponse } from '../../server/access.js';
import { requireUser, cleanPasscode, setPasscode } from '../../server/session.js';

export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const me = await requireUser(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    const text = await request.text();
    if (text.length > 1024) throw new HttpError(413, 'too-big');
    let b; try { b = JSON.parse(text); } catch { throw new HttpError(400, 'bad-json'); }
    await setPasscode(env, me.email, cleanPasscode(b.passcode));
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
