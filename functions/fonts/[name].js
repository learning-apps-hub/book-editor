// /fonts/<name> — the big book fonts that are not in the public repo (Noto Serif SC) come from R2 (system/fonts/).
// Everything else under /fonts/ is a plain file of the site. Signed-in people only (the guard in _middleware.js).
const FROM_R2 = new Set(['NotoSerifSC-Regular.ttf']);

export async function onRequestGet({ request, env, params, next }) {
  const name = String(params.name || '');
  if (!FROM_R2.has(name) || !env.LIBRARY) return next();
  const obj = await env.LIBRARY.get('system/fonts/' + name, { onlyIf: request.headers });
  if (!obj) return next();
  const headers = { etag: obj.httpEtag, 'cache-control': 'private, max-age=2592000', 'x-content-type-options': 'nosniff' };
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers: { ...headers, 'content-type': 'font/ttf' } });
}
