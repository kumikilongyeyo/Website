/* Serves uploaded media at durable /media/<key> URLs.
 *
 * Prefers R2, falls back to the KV namespace this project already binds so the
 * media library works with no extra Cloudflare setup. Either way the public
 * page renders a URL that outlives the browser session, which a blob: or data:
 * URL does not.
 *
 * Responses are immutable and long-cached because every key carries a random
 * suffix, so a given URL never changes contents.
 */
const KV_PREFIX = 'media:';

// HEAD must be handled explicitly: without it Pages falls through to the static
// asset handler, which answers a media URL with the HTML 404 page and its own
// etag, so a client probing the URL gets text/html and a validator that never
// matches.
export async function onRequestHead(ctx) {
  const res = await onRequestGet(ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function onRequestGet({ params, env, request }) {
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!key) return text('No asset key.', 400);

  const common = {
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };

  /* An SVG is a document, not just a picture: opened directly it can run script
   * in this origin, where the editor session cookie lives. Rendering one in an
   * <img> is unaffected by this policy, so the library keeps working while a
   * hostile upload cannot execute anything.
   */
  const harden = headers => {
    if ((headers.get('content-type') || '').includes('svg')) {
      headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    return headers;
  };

  if (env.PORTFOLIO_MEDIA) {
    const object = await env.PORTFOLIO_MEDIA.get(key).catch(() => null);
    if (object) {
      const headers = new Headers(common);
      object.writeHttpMetadata(headers);
      headers.set('cache-control', common['cache-control']);
      headers.set('etag', object.httpEtag);
      harden(headers);
      if (request.headers.get('if-none-match') === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { headers });
    }
    // Fall through: an asset uploaded before R2 was bound still lives in KV.
  }

  if (env.PORTFOLIO_CONFIG) {
    const found = await env.PORTFOLIO_CONFIG.getWithMetadata(KV_PREFIX + key, { type: 'arrayBuffer' }).catch(() => null);
    if (found && found.value) {
      const meta = found.metadata || {};
      // A weak validator: KV gives no strong etag, and the bytes at a given key
      // never change, so the key itself identifies the content.
      const etag = 'W/"' + key + '"';
      const headers = new Headers({
        ...common,
        'content-type': meta.mime || 'application/octet-stream',
        etag,
      });
      harden(headers);
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(found.value, { headers });
    }
  }

  if (!env.PORTFOLIO_MEDIA && !env.PORTFOLIO_CONFIG) {
    return text('No media storage is bound to this Pages project.', 503);
  }
  return text('No such asset.', 404);
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
