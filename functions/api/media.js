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

// Auth, JSON and the session/CSRF checks are shared with the rest of the admin
// API so there is one place that decides who may write.
import { json, gate as sharedGate } from './_lib.js';

// Delegates identity to the shared gate, then adds the media-specific
// requirement that somewhere to put the file actually exists.
async function gate(request, env) {
  const bad = await sharedGate(request, env);
  if (bad) return bad;
  if (!backend(env)) {
    return json({
      error: 'No media storage is available. Bind an R2 bucket as PORTFOLIO_MEDIA for the best results, or a KV namespace as PORTFOLIO_CONFIG, then redeploy.',
      code: 'no-storage',
    }, 503);
  }
  return null;
}

/* Which store to use. R2 is the right tool for binary media and is preferred
 * whenever it is bound. KV is the fallback because this project already has a
 * KV namespace bound, so the media library works with no additional setup —
 * uploads still get a durable /media/<key> URL and still stay out of the
 * config. KV is not built for large blobs, hence the smaller cap below.
 */
function backend(env) {
  if (env.PORTFOLIO_MEDIA) return 'r2';
  if (env.PORTFOLIO_CONFIG) return 'kv';
  return null;
}

const KV_PREFIX = 'media:';
const KV_MAX_BYTES = 2 * 1024 * 1024;

function capFor(env) {
  return backend(env) === 'r2' ? MAX_BYTES : KV_MAX_BYTES;
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
  const bad = await gate(request, env);
  if (bad) return bad;
  const store = backend(env);
  try {
    const out = [];
    if (store === 'r2') {
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
    } else {
      let cursor;
      do {
        const page = await env.PORTFOLIO_CONFIG.list({ prefix: KV_PREFIX, cursor });
        for (const k of page.keys) {
          const meta = k.metadata || {};
          const key = k.name.slice(KV_PREFIX.length);
          out.push({
            key,
            url: '/media/' + key,
            size: meta.size || 0,
            uploaded: meta.uploaded || '',
            mime: meta.mime || '',
            filename: meta.filename || key.split('/').pop(),
            width: meta.width ? Number(meta.width) : null,
            height: meta.height ? Number(meta.height) : null,
          });
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
    }
    out.sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
    return json({ assets: out, count: out.length, storage: store, limitBytes: capFor(env) });
  } catch (e) {
    return json({ error: `Could not list media from ${store.toUpperCase()}: ` + (e && e.message ? e.message : 'unknown error'), code: 'list-failed' }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const bad = await gate(request, env);
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
  const cap = capFor(env);
  if (file.size > cap) {
    // Name the store, because the limit differs and the fix differs with it.
    return json({
      error: backend(env) === 'kv'
        ? `That file is ${(file.size / 1048576).toFixed(1)}MB, over the ${Math.round(cap / 1048576)}MB limit for KV-backed storage. Save it smaller, or add an R2 bucket to raise the limit to ${Math.round(MAX_BYTES / 1048576)}MB.`
        : `That file is ${(file.size / 1048576).toFixed(1)}MB, over the ${Math.round(cap / 1048576)}MB limit.`,
      code: 'too-large',
    }, 413);
  }
  if (!file.size) {
    return json({ error: 'That file is empty.', code: 'empty' }, 400);
  }

  const key = keyFor(file.name, mime);
  const width = form.get('width'), height = form.get('height');
  const store = backend(env);
  const uploaded = new Date().toISOString();
  try {
    if (store === 'r2') {
      await env.PORTFOLIO_MEDIA.put(key, file.stream(), {
        httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: {
          mime,
          filename: String(file.name || '').slice(0, 200),
          ...(width ? { width: String(width) } : {}),
          ...(height ? { height: String(height) } : {}),
        },
      });
    } else {
      // KV values take an ArrayBuffer directly, so bytes stay bytes — no base64
      // inflation. Metadata has a 1KB ceiling, hence the trimmed filename.
      await env.PORTFOLIO_CONFIG.put(KV_PREFIX + key, await file.arrayBuffer(), {
        metadata: {
          mime,
          filename: String(file.name || '').slice(0, 120),
          size: file.size,
          uploaded,
          ...(width ? { width: String(width) } : {}),
          ...(height ? { height: String(height) } : {}),
        },
      });
    }
  } catch (e) {
    return json({
      error: `${store.toUpperCase()} rejected the upload: ` + (e && e.message ? e.message : 'unknown error'),
      code: store + '-put-failed',
    }, 502);
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
      uploaded,
    },
    storage: store,
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
    // Only the config keys: the KV fallback also stores media blobs in this
    // namespace under media:, and those are not JSON.
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
  const bad = await gate(request, env);
  if (bad) return bad;

  const key = new URL(request.url).searchParams.get('key');
  if (!key) return json({ error: 'No asset key was given to delete.', code: 'no-key' }, 400);

  const store = backend(env);
  const exists = store === 'r2'
    ? await env.PORTFOLIO_MEDIA.head(key).catch(() => null)
    : await env.PORTFOLIO_CONFIG.get(KV_PREFIX + key, 'stream').catch(() => null);
  if (!exists) return json({ error: 'That asset is not in media storage. It may already be deleted.', code: 'not-found' }, 404);

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
    if (store === 'r2') await env.PORTFOLIO_MEDIA.delete(key);
    else await env.PORTFOLIO_CONFIG.delete(KV_PREFIX + key);
  } catch (e) {
    return json({
      error: `${store.toUpperCase()} rejected the delete: ` + (e && e.message ? e.message : 'unknown error'),
      code: store + '-delete-failed',
    }, 502);
  }
  return json({ ok: true, key, forced: force && used.length > 0, brokenReferences: force ? used : [] });
}
