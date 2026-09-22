/* Media library endpoints backed by Cloudflare R2 (§17).
 *
 * Replaces the old path where uploads were compressed to base64 data URLs and
 * published inside the KV config. That capped the entire site's artwork at
 * roughly 760KB and put image bytes in a store meant for configuration.
 *
 * GET    /api/media          list assets (auth)
 * POST   /api/media          upload one file, multipart field "file" (auth)
 * DELETE /api/media?key=...  delete, refused while the asset is still in use (auth)
 *
 * Every failure answers with a reason and a machine-readable code, because the
 * Studio surfaces the reason verbatim rather than inventing one (§29).
 */

const MAX_BYTES = 15 * 1024 * 1024;

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function auth(request, env) {
  if (!env.EDITOR_USER || !env.EDITOR_PASS) return false;
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const d = atob(h.slice(6)), i = d.indexOf(':');
    return i > 0 && safeEqual(d.slice(0, i), env.EDITOR_USER) && safeEqual(d.slice(i + 1), env.EDITOR_PASS);
  } catch { return false; }
}

const json = (x, s = 200) => new Response(JSON.stringify(x), {
  status: s,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

// Distinguishes "you are not allowed" from "the server is not set up", so the
// editor never tells someone to check their password over a missing binding.
function gate(request, env) {
  if (!env.EDITOR_USER || !env.EDITOR_PASS) {
    return json({
      error: 'Editor credentials are not configured on this Pages project. Set EDITOR_USER and EDITOR_PASS as secrets, then redeploy.',
      code: 'no-credentials',
    }, 501);
  }
  if (!auth(request, env)) {
    return json({ error: 'Wrong username or password.', code: 'bad-credentials' }, 401);
  }
  if (!env.PORTFOLIO_MEDIA) {
    return json({
      error: 'The media library needs an R2 bucket. Create one in the Cloudflare dashboard and bind it to this Pages project as PORTFOLIO_MEDIA, then redeploy.',
      code: 'r2-unbound',
    }, 503);
  }
  return null;
}

function keyFor(name, mime) {
  const ext = TYPES[mime] || 'bin';
  const stem = (name || 'asset')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
  const d = new Date();
  // Date prefix keeps the bucket browsable; the random suffix makes a
  // collision between two same-named uploads impossible.
  const rand = crypto.randomUUID().split('-')[0];
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${stem}-${rand}.${ext}`;
}

export async function onRequestGet({ request, env }) {
  const bad = gate(request, env);
  if (bad) return bad;
  try {
    const out = [];
    let cursor;
    do {
      const page = await env.PORTFOLIO_MEDIA.list({ limit: 1000, cursor, include: ['customMetadata'] });
      for (const o of page.objects) {
        const meta = o.customMetadata || {};
        out.push({
          key: o.key,
          url: '/media/' + o.key,
          size: o.size,
          uploaded: o.uploaded,
          mime: meta.mime || '',
          filename: meta.filename || o.key.split('/').pop(),
          width: meta.width ? Number(meta.width) : null,
          height: meta.height ? Number(meta.height) : null,
        });
      }
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    out.sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
    return json({ assets: out, count: out.length });
  } catch (e) {
    return json({ error: 'Could not list the media bucket: ' + (e && e.message ? e.message : 'unknown R2 error'), code: 'r2-list-failed' }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const bad = gate(request, env);
  if (bad) return bad;

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload body was not valid multipart form data.', code: 'bad-body' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'No file was attached to the upload.', code: 'no-file' }, 400);
  }

  const mime = file.type || '';
  if (!TYPES[mime]) {
    return json({
      error: `${mime || 'That file type'} is not allowed. Upload JPEG, PNG, WebP, AVIF, GIF, SVG, MP4 or WebM.`,
      code: 'bad-type',
    }, 415);
  }
  if (file.size > MAX_BYTES) {
    return json({
      error: `That file is ${Math.round(file.size / 1048576)}MB, over the ${Math.round(MAX_BYTES / 1048576)}MB limit.`,
      code: 'too-large',
    }, 413);
  }
  if (!file.size) {
    return json({ error: 'That file is empty.', code: 'empty' }, 400);
  }

  const key = keyFor(file.name, mime);
  const width = form.get('width'), height = form.get('height');
  try {
    await env.PORTFOLIO_MEDIA.put(key, file.stream(), {
      httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: {
        mime,
        filename: String(file.name || '').slice(0, 200),
        ...(width ? { width: String(width) } : {}),
        ...(height ? { height: String(height) } : {}),
      },
    });
  } catch (e) {
    return json({ error: 'R2 rejected the upload: ' + (e && e.message ? e.message : 'unknown error'), code: 'r2-put-failed' }, 502);
  }

  return json({
    ok: true,
    asset: {
      key,
      url: '/media/' + key,
      size: file.size,
      mime,
      filename: file.name,
      width: width ? Number(width) : null,
      height: height ? Number(height) : null,
      uploaded: new Date().toISOString(),
    },
  });
}

/* Refuses to delete an asset the published site still points at, and says
 * which objects use it (§17/§29). A referenced asset deleted quietly would
 * leave broken images on the public page with no explanation.
 */
async function referencesTo(env, key) {
  if (!env.PORTFOLIO_CONFIG) return [];
  const url = '/media/' + key;
  const used = [];
  for (const version of ['studio', 'gallery']) {
    let raw;
    try { raw = await env.PORTFOLIO_CONFIG.get('site-config:' + version); } catch { continue; }
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const state = parsed && parsed.state;
    if (!state) continue;
    const scan = (obj, path) => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'string') { if (obj.includes(url)) used.push({ version, path }); return; }
      if (Array.isArray(obj)) { obj.forEach((v, i) => scan(v, `${path}[${i}]`)); return; }
      if (typeof obj === 'object') { for (const k in obj) scan(obj[k], path ? `${path}.${k}` : k); }
    };
    scan(state, '');
  }
  return used;
}

export async function onRequestDelete({ request, env }) {
  const bad = gate(request, env);
  if (bad) return bad;

  const key = new URL(request.url).searchParams.get('key');
  if (!key) return json({ error: 'No asset key was given to delete.', code: 'no-key' }, 400);

  const head = await env.PORTFOLIO_MEDIA.head(key).catch(() => null);
  if (!head) return json({ error: 'That asset is not in the media bucket. It may already be deleted.', code: 'not-found' }, 404);

  const force = new URL(request.url).searchParams.get('force') === '1';
  const used = await referencesTo(env, key);
  if (used.length && !force) {
    const where = used.map(u => `${u.version}: ${u.path}`).slice(0, 6).join(', ');
    return json({
      error: `That asset is still used by ${used.length} published reference${used.length === 1 ? '' : 's'} (${where}). Replace or remove those first, or delete anyway to leave them broken.`,
      code: 'in-use',
      references: used,
    }, 409);
  }

  try {
    await env.PORTFOLIO_MEDIA.delete(key);
  } catch (e) {
    return json({ error: 'R2 rejected the delete: ' + (e && e.message ? e.message : 'unknown error'), code: 'r2-delete-failed' }, 502);
  }
  return json({ ok: true, key, forced: force && used.length > 0, brokenReferences: force ? used : [] });
}
