// /api/admin/requests — decline a join request: DELETE { email }. (Approve = add the person on /api/admin/people.)
import { requireAdmin, sameOrigin, readRequests, writeRequests, readPeople, adminEmails, cleanEmail, HttpError, json, errorResponse } from '../../../server/access.js';

export async function onRequestDelete({ request, env }) {
  try {
    sameOrigin(request);
    await requireAdmin(request, env);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json-only');
    let email; try { email = cleanEmail(JSON.parse(await request.text()).email); } catch { throw new HttpError(400, 'bad-json'); }
    if (!email) throw new HttpError(400, 'bad-email');
    const { requests, etag } = await readRequests(env);
    const next = requests.filter(x => x.email !== email);
    if (next.length === requests.length) throw new HttpError(404, 'not-found');
    await writeRequests(env, next, etag);
    const { people } = await readPeople(env);
    return json({ people, requests: next, fixed: adminEmails(env) });
  } catch (e) { return errorResponse(e); }
}
