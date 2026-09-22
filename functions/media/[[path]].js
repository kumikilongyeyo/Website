/* Serves R2 objects at durable /media/<key> URLs.
 *
 * The public page must render URLs that outlive the browser session, which a
 * blob: or data: URL does not. Responses are immutable and long-cached because
 * every key carries a random suffix, so a given URL never changes contents.
 */
// HEAD must be handled explicitly: without it Pages falls through to the
// static asset handler, which answers with the HTML 404 page and its own etag,
// so a client probing a media URL gets text/html and a bogus validator.
export async function onRequestHead(ctx) {
  const res = await onRequestGet(ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function onRequestGet({ params, env, request }) {
  if (!env.PORTFOLIO_MEDIA) {
    return new Response('Media bucket is not bound to this Pages project (expected PORTFOLIO_MEDIA).', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!key) return new Response('No asset key.', { status: 400 });

  const object = await env.PORTFOLIO_MEDIA.get(key).catch(() => null);
  if (!object) {
    return new Response('No such asset.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');

  // Honour conditional requests so repeat views cost nothing.
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}
