// /library/… — the private Library, served from R2 to signed-in people, each seeing only the books opened to them.
//   GET /library/library.json      the Library list for this person (404 while no book was ever added: the app shows the sample)
//   GET /library/<id>/<file>       one file of a book this person may see (book.json, story.json, pictures/…)
import { HttpError, json, errorResponse } from '../../server/access.js';
import { sessionUser } from '../../server/session.js';
import { readIndex, libraryFor, canOn, bookPrefix, typeOf, ID_RE, PATH_RE } from '../../server/library.js';

export async function onRequestGet({ request, env, params }) {
  try {
    const me = await sessionUser(request, env);
    const segs = [].concat(params.path || []);
    const { books, exists } = await readIndex(env);
    if (segs.length === 1 && segs[0] === 'library.json') {
      if (!exists) throw new HttpError(404, 'no-library');
      return json(libraryFor(me, books));
    }
    const [id, ...rest] = segs, path = rest.join('/');
    if (!ID_RE.test(id || '') || !PATH_RE.test(path)) throw new HttpError(404, 'not-found');
    const entry = books.find(b => b.id === id);
    if (!canOn(me, entry)) throw new HttpError(404, 'not-found');          // never says whether a hidden book exists
    const obj = await env.LIBRARY.get(bookPrefix(id, entry.v) + path, { onlyIf: request.headers });
    if (!obj) throw new HttpError(404, 'not-found');
    const headers = { etag: obj.httpEtag, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' };
    if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers: { ...headers, 'content-type': typeOf(path) } });
  } catch (e) { return errorResponse(e); }
}
