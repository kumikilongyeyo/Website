/* Media library endpoints (§6/§17), backed by R2 when it is bound and by KV
 * otherwise.
 *
 * Replaces the old path where uploads were compressed to base64 data URLs and
 * published inside the KV config. That capped the entire site's artwork at
 * roughly 760KB and put image bytes in a store meant for configuration.
 *
 * GET    /api/media            list assets, with use counts (auth)
 * POST   /api/media            upload one file, multipart field "file" (auth)
 * PATCH  /api/media            set label / alt text / status (auth)
 * DELETE /api/media?key=...    move to trash; &purge=1 deletes the bytes (auth)
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
import { json, gate as sharedGate, VERSIONS, CURRENT_KEY, VERSION_KEY, readIndex } from './_lib.js';

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

/* --------------------------------------------------------------- sidecar
 * Labels, alt text and trash state live in one small KV document rather than
 * on the object itself. R2 cannot change customMetadata without rewriting the
 * whole object, so renaming a 12MB illustration would mean re-uploading it;
 * and in the KV backend the metadata sits beside the blob, so editing a label
 * would rewrite the bytes too. A sidecar makes a rename one small write on
 * either backend.
 *
 * One document also means one read to list the library. It assumes a single
 * editor — two people renaming at the same instant, one would win — which is
 * exactly what this project is.
 */
const META_KEY = 'media-meta';

async function readMeta(env) {
  if (!env.PORTFOLIO_CONFIG) return {};
  try {
    const raw = await env.PORTFOLIO_CONFIG.get(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A corrupt sidecar must not make the library unreadable: the blobs are
    // the record, labels are decoration.
    return {};
  }
}

async function writeMeta(env, meta) {
  if (!env.PORTFOLIO_CONFIG) return false;
  try {
    await env.PORTFOLIO_CONFIG.put(META_KEY, JSON.stringify(meta));
    return true;
  } catch { return false; }
}

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Every /media/... URL the published site points at, from one pass over each
 * config. Used to mark assets as unused, so the owner can clear space without
 * guessing which files are safe to remove.
 */
async function usedUrls(env) {
  const out = new Set();
  if (!env.PORTFOLIO_CONFIG) return out;
  for (const version of VERSIONS) {
    let raw;
    try { raw = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(version)); } catch { continue; }
    if (!raw) continue;
    for (const m of raw.matchAll(/\/media\/[A-Za-z0-9/_.\-]+/g)) out.add(m[0]);
  }
  return out;
}

/* The detailed version, for the message shown when a delete is refused: says
 * where each reference lives rather than only how many there are.
 */
async function referencesTo(env, key) {
  if (!env.PORTFOLIO_CONFIG) return [];
  const url = '/media/' + key;
  const used = [];
  for (const version of VERSIONS) {
    let raw;
    // Only the config keys: the KV fallback also stores media blobs in this
    // namespace under media:, and those are not JSON.
    try { raw = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(version)); } catch { continue; }
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

/* Which saved version snapshots point at this asset.
 *
 * The live check above decides whether a delete is refused; this one only
 * informs, and it exists because purging the bytes is what actually breaks
 * history. Rolling back to a version that referenced a purged file would
 * restore a page with a missing image and no explanation. It reads the
 * snapshots only on a purge, which is rare, rather than on every listing.
 */
async function historyReferencesTo(env, key) {
  if (!env.PORTFOLIO_CONFIG) return [];
  const url = '/media/' + key;
  const hits = [];
  for (const version of VERSIONS) {
    let index = [];
    try { index = await readIndex(env, version); } catch { continue; }
    for (const entry of index) {
      let raw;
      try { raw = await env.PORTFOLIO_CONFIG.get(VERSION_KEY(version, entry.id)); } catch { continue; }
      if (raw && raw.includes(url)) hits.push({ version, id: entry.id, publishedAt: entry.publishedAt, label: entry.label || '' });
    }
  }
  return hits;
}

/* Lists EVERY store that holds media, not just the preferred one.
 *
 * Binding R2 to a project that already uploaded to KV used to make those
 * earlier assets vanish from the library: the public /media/ route still
 * served them, so the published page looked fine, but the owner could no
 * longer see, rename or delete artwork they had uploaded. Reading both stores
 * means adding R2 is additive — nothing to migrate, nothing lost.
 */
async function listRaw(env) {
  const out = [];
  if (env.PORTFOLIO_MEDIA) {
    let cursor;
    do {
      const page = await env.PORTFOLIO_MEDIA.list({ limit: 1000, cursor, include: ['customMetadata'] });
      for (const o of page.objects) {
        const meta = o.customMetadata || {};
        out.push({
          key: o.key,
          store: 'r2',
          size: o.size,
          uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded || ''),
          mime: meta.mime || '',
          filename: meta.filename || o.key.split('/').pop(),
          width: meta.width ? Number(meta.width) : null,
          height: meta.height ? Number(meta.height) : null,
          sha: meta.sha || '',
        });
      }
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
  }
  if (env.PORTFOLIO_CONFIG) {
    const seen = new Set(out.map(a => a.key));
    let cursor;
    do {
      const page = await env.PORTFOLIO_CONFIG.list({ prefix: KV_PREFIX, cursor });
      for (const k of page.keys) {
        const meta = k.metadata || {};
        const key = k.name.slice(KV_PREFIX.length);
        if (seen.has(key)) continue;
        out.push({
          key,
          store: 'kv',
          size: meta.size || 0,
          uploaded: meta.uploaded || '',
          mime: meta.mime || '',
          filename: meta.filename || key.split('/').pop(),
          width: meta.width ? Number(meta.width) : null,
          height: meta.height ? Number(meta.height) : null,
          sha: meta.sha || '',
        });
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  }
  return out;
}

/* Which store actually holds a key, rather than which one we would write to
 * now. Delete and dedupe both need this once two stores are live.
 */
async function locate(env, key) {
  if (env.PORTFOLIO_MEDIA) {
    const head = await env.PORTFOLIO_MEDIA.head(key).catch(() => null);
    if (head) return { store: 'r2', head };
  }
  if (env.PORTFOLIO_CONFIG) {
    const found = await env.PORTFOLIO_CONFIG.getWithMetadata(KV_PREFIX + key, 'stream').catch(() => null);
    if (found && found.value) return { store: 'kv', meta: found.metadata || {} };
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const bad = await gate(request, env);
  if (bad) return bad;
  const store = backend(env);
  try {
    const [raw, meta, used] = await Promise.all([listRaw(env), readMeta(env), usedUrls(env)]);
    const assets = raw.map(a => {
      const side = meta[a.key] || {};
      const url = '/media/' + a.key;
      return {
        variants: side.variants || [],
        ...a,
        url,
        label: side.label || '',
        alt: side.alt || '',
        status: side.status === 'trashed' ? 'trashed' : 'active',
        trashedAt: side.trashedAt || null,
        sha: a.sha || side.sha || '',
        inUse: used.has(url),
      };
    });
    // Variants belong to their parent, not to the grid: showing them would
    // list one artwork three times.
    const variantKeys = new Set();
    for (const k of Object.keys(meta)) for (const v of (meta[k].variants || [])) variantKeys.add(v.key);
    const visible = assets.filter(a => !variantKeys.has(a.key));
    visible.sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
    const active = visible.filter(a => a.status === 'active');
    return json({
      assets: visible,
      count: visible.length,
      activeCount: active.length,
      trashedCount: visible.length - active.length,
      unusedCount: active.filter(a => !a.inUse).length,
      // Totals count the variants too: they are real bytes against the quota.
      bytesUsed: assets.reduce((n, a) => n + (a.size || 0), 0),
      storage: store,
      limitBytes: capFor(env),
    });
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

  const store = backend(env);
  const width = form.get('width'), height = form.get('height');
  const uploaded = new Date().toISOString();

  // Read once: the same bytes are hashed for the duplicate check and then
  // written, so a 12MB upload is not streamed twice.
  let buf;
  try { buf = await file.arrayBuffer(); } catch {
    return json({ error: 'The upload stream ended early. Nothing was stored.', code: 'read-failed' }, 400);
  }
  const sha = hex(await crypto.subtle.digest('SHA-256', buf));

  /* Re-uploading a file already in the library returns the existing asset
   * instead of storing the bytes twice. On a free tier that is the difference
   * between a library that fits and one that does not, and it keeps a single
   * artwork from appearing three times in the grid.
   */
  const meta = await readMeta(env);
  const dupKey = Object.keys(meta).find(k => meta[k] && meta[k].sha === sha);
  if (dupKey) {
    const found = await locate(env, dupKey);
    if (found) {
      // A duplicate of something in the trash is a change of mind, not a new
      // file: bring it back rather than refusing or storing a second copy.
      const wasTrashed = meta[dupKey].status === 'trashed';
      if (wasTrashed) {
        meta[dupKey] = { ...meta[dupKey], status: 'active', trashedAt: null };
        await writeMeta(env, meta);
      }
      const size = found.store === 'r2' ? found.head.size : (meta[dupKey].size || file.size);
      return json({
        ok: true,
        deduped: true,
        restored: wasTrashed,
        asset: {
          key: dupKey,
          url: '/media/' + dupKey,
          size,
          mime: meta[dupKey].mime || mime,
          filename: meta[dupKey].filename || file.name,
          label: meta[dupKey].label || '',
          alt: meta[dupKey].alt || '',
          status: 'active',
          sha,
          width: meta[dupKey].width || null,
          height: meta[dupKey].height || null,
          uploaded: meta[dupKey].uploaded || uploaded,
        },
        storage: store,
      });
    }
    // The sidecar outlived the blob. Drop the stale entry and store the file.
    delete meta[dupKey];
  }

  /* A variant is a smaller rendering of an asset already in the library, made
   * by the browser at upload time. It is stored as an ordinary object and
   * recorded against its parent, so the page can offer a phone an 800px file
   * instead of a 4000px one. Resizing in the browser keeps this on the free
   * tier — the alternative is a paid image-resizing service.
   */
  const parent = form.get('variantOf');
  const variantWidth = parseInt(form.get('variantWidth'), 10) || 0;
  if (parent && variantWidth) {
    if (!meta[parent]) {
      return json({ error: 'That variant has no parent asset in the library.', code: 'no-parent' }, 400);
    }
    const vkey = keyFor(file.name, mime);
    try {
      if (store === 'r2') {
        await env.PORTFOLIO_MEDIA.put(vkey, buf, {
          httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: { mime, sha, filename: String(file.name || '').slice(0, 200), width: String(variantWidth), variantOf: parent },
        });
      } else {
        await env.PORTFOLIO_CONFIG.put(KV_PREFIX + vkey, buf, {
          metadata: { mime, sha, filename: String(file.name || '').slice(0, 120), size: file.size, uploaded, width: variantWidth, variantOf: parent },
        });
      }
    } catch (e) {
      return json({ error: `${store.toUpperCase()} rejected the variant: ` + (e && e.message ? e.message : 'unknown error'), code: store + '-put-failed' }, 502);
    }
    const list = (meta[parent].variants || []).filter(v => v.width !== variantWidth);
    list.push({ key: vkey, width: variantWidth, size: file.size, mime });
    list.sort((a, b) => a.width - b.width);
    meta[parent] = { ...meta[parent], variants: list };
    await writeMeta(env, meta);
    return json({ ok: true, variant: true, parent, asset: { key: vkey, url: '/media/' + vkey, width: variantWidth, size: file.size, mime } });
  }

  const key = keyFor(file.name, mime);
  try {
    if (store === 'r2') {
      await env.PORTFOLIO_MEDIA.put(key, buf, {
        httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: {
          mime,
          sha,
          filename: String(file.name || '').slice(0, 200),
          ...(width ? { width: String(width) } : {}),
          ...(height ? { height: String(height) } : {}),
        },
      });
    } else {
      // KV values take an ArrayBuffer directly, so bytes stay bytes — no base64
      // inflation. Metadata has a 1KB ceiling, hence the trimmed filename.
      await env.PORTFOLIO_CONFIG.put(KV_PREFIX + key, buf, {
        metadata: {
          mime,
          sha,
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

  meta[key] = {
    sha,
    mime,
    filename: String(file.name || '').slice(0, 200),
    size: file.size,
    uploaded,
    status: 'active',
    label: '',
    alt: '',
    ...(width ? { width: Number(width) } : {}),
    ...(height ? { height: Number(height) } : {}),
  };
  // The sidecar is an index, not the record: if this write fails the file is
  // still stored and still listed, only without a label.
  const sidecarOk = await writeMeta(env, meta);

  return json({
    ok: true,
    deduped: false,
    sidecar: sidecarOk,
    asset: {
      key,
      url: '/media/' + key,
      size: file.size,
      mime,
      filename: file.name,
      label: '',
      alt: '',
      status: 'active',
      sha,
      width: width ? Number(width) : null,
      height: height ? Number(height) : null,
      uploaded,
      inUse: false,
    },
    storage: store,
  });
}

/* Label, alt text and restore-from-trash. Touches only the sidecar, so it
 * never rewrites an image to change a caption.
 */
export async function onRequestPatch({ request, env }) {
  const bad = await gate(request, env);
  if (bad) return bad;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'bad-json' }, 400); }
  const key = body && body.key;
  if (!key || typeof key !== 'string') return json({ error: 'No asset key was given.', code: 'no-key' }, 400);

  const meta = await readMeta(env);
  const entry = meta[key] || {};

  if (typeof body.label === 'string') entry.label = body.label.trim().slice(0, 120);
  if (typeof body.alt === 'string') entry.alt = body.alt.trim().slice(0, 300);
  if (body.status === 'active') { entry.status = 'active'; entry.trashedAt = null; }
  else if (body.status === 'trashed') { entry.status = 'trashed'; entry.trashedAt = new Date().toISOString(); }

  meta[key] = entry;
  if (!await writeMeta(env, meta)) {
    return json({ error: 'Could not save the change to storage. Nothing was updated.', code: 'meta-write-failed' }, 502);
  }
  return json({ ok: true, key, label: entry.label || '', alt: entry.alt || '', status: entry.status || 'active' });
}

/* Delete moves an asset to the trash by default. The bytes only go when the
 * owner asks a second time with purge=1 — a mis-click should not destroy the
 * only copy of an illustration, and there is no undo for R2 or KV.
 */
export async function onRequestDelete({ request, env }) {
  const bad = await gate(request, env);
  if (bad) return bad;

  const params = new URL(request.url).searchParams;
  const key = params.get('key');
  if (!key) return json({ error: 'No asset key was given to delete.', code: 'no-key' }, 400);

  const store = backend(env);
  const held = await locate(env, key);
  if (!held) return json({ error: 'That asset is not in media storage. It may already be deleted.', code: 'not-found' }, 404);

  const purge = params.get('purge') === '1';
  const force = params.get('force') === '1';
  const used = await referencesTo(env, key);
  if (used.length && !force) {
    const where = used.map(u => `${u.version}: ${u.path}`).slice(0, 6).join(', ');
    return json({
      error: `That asset is still used by ${used.length} published reference${used.length === 1 ? '' : 's'} (${where}). Replace or remove those first, or delete anyway to leave them broken.`,
      code: 'in-use',
      references: used,
    }, 409);
  }

  const meta = await readMeta(env);
  if (!purge) {
    meta[key] = { ...(meta[key] || {}), status: 'trashed', trashedAt: new Date().toISOString() };
    if (!await writeMeta(env, meta)) {
      return json({ error: 'Could not record the change to storage. The asset was not moved to the trash.', code: 'meta-write-failed' }, 502);
    }
    return json({ ok: true, key, trashed: true, purged: false, forced: force && used.length > 0, brokenReferences: force ? used : [] });
  }

  /* Purging is the only irreversible step here, so it is also the only one that
   * checks history. Answering 409 the first time gives the owner the count and
   * a way to proceed; confirm=1 says they read it.
   */
  const inHistory = await historyReferencesTo(env, key);
  if (inHistory.length && params.get('confirm') !== '1') {
    return json({
      error: `${inHistory.length} saved version${inHistory.length === 1 ? ' still references' : 's still reference'} this file. Deleting the bytes cannot be undone, and rolling back to ${inHistory.length === 1 ? 'that version' : 'those versions'} would show a missing image. Move it to the trash instead, or confirm to delete anyway.`,
      code: 'in-history',
      historyReferences: inHistory,
    }, 409);
  }

  try {
    // A variant has no life of its own, so it goes with its parent rather than
    // being left behind as bytes nothing can reach. Each is removed from the
    // store that actually holds it: after R2 is added, a parent and its
    // variants can legitimately live in different ones.
    const doomed = [key, ...((meta[key] && meta[key].variants) || []).map(v => v.key)];
    for (const k of doomed) {
      const where = k === key ? held : await locate(env, k);
      if (!where) continue;
      if (where.store === 'r2') await env.PORTFOLIO_MEDIA.delete(k);
      else await env.PORTFOLIO_CONFIG.delete(KV_PREFIX + k);
    }
  } catch (e) {
    return json({
      error: `${store.toUpperCase()} rejected the delete: ` + (e && e.message ? e.message : 'unknown error'),
      code: store + '-delete-failed',
    }, 502);
  }
  delete meta[key];
  await writeMeta(env, meta);
  return json({
    ok: true, key, trashed: false, purged: true,
    forced: force && used.length > 0,
    brokenReferences: force ? used : [],
    historyReferences: inHistory,
  });
}
