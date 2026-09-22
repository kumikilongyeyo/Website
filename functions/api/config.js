/* Published config: read the live snapshot, and publish a new one.
 *
 * Publishing writes an immutable version snapshot FIRST and only then swaps the
 * live pointer. If anything fails before that last write, the site keeps
 * serving exactly what it served before — a failed publish can never leave the
 * portfolio half-updated or blank.
 */
import {
  CURRENT_KEY, VERSION_KEY, VERSIONS, MAX_BODY,
  json, gate, readIndex, writeIndex, newVersionId, prune,
} from './_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.PORTFOLIO_CONFIG) return json({ state: null, storage: 'unbound' });
  const v = new URL(request.url).searchParams.get('version') || 'studio';
  if (!VERSIONS.includes(v)) return json({ state: null, error: 'Unknown version' }, 400);
  const raw = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(v));
  return json(raw ? JSON.parse(raw) : { state: null });
}

export async function onRequestPost({ request, env }) {
  // The auth probe runs before the storage check so the login flow works even
  // when KV is missing; it only answers "are these credentials right".
  if (!env.EDITOR_USER || !env.EDITOR_PASS) {
    return json({
      error: 'Editor credentials are not configured. Set EDITOR_USER and EDITOR_PASS as secrets on this Pages project, then redeploy.',
      code: 'no-credentials',
    }, 501);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'bad-json' }, 400); }

  const bad = gate(request, env);
  if (body && body._authCheck) {
    // Probe: report only whether the credentials are accepted.
    return bad && bad.status === 401 ? bad : json({ ok: true });
  }
  if (bad) return bad;

  const v = (body && body.version) || 'studio';
  if (!VERSIONS.includes(v) || !body || !body.state) {
    return json({ error: 'Invalid payload', code: 'bad-payload' }, 400);
  }

  const publishedAt = new Date().toISOString();
  const id = newVersionId();
  const snapshot = JSON.stringify({ state: body.state, updatedAt: publishedAt, versionId: id });
  if (snapshot.length > MAX_BODY) {
    return json({
      error: `Config is ${Math.round(snapshot.length / 1024)}KB, over the ${Math.round(MAX_BODY / 1024)}KB limit. Replace uploaded images with hosted URLs.`,
      code: 'too-large',
    }, 413);
  }

  let index = await readIndex(env, v);

  /* First publish since versioning existed: archive whatever is already live so
   * the state the owner is looking at right now is recoverable too. Without
   * this, the first rollback would have nothing earlier to return to.
   */
  if (!index.length) {
    try {
      const existing = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(v));
      if (existing) {
        const priorId = newVersionId();
        await env.PORTFOLIO_CONFIG.put(VERSION_KEY(v, priorId), existing);
        index.unshift({
          id: priorId,
          publishedAt: (JSON.parse(existing).updatedAt) || publishedAt,
          bytes: existing.length,
          label: 'Published before version history existed',
        });
      }
    } catch { /* archiving is best effort; it must not block the publish */ }
  }

  try {
    // 1. immutable snapshot
    await env.PORTFOLIO_CONFIG.put(VERSION_KEY(v, id), snapshot);
    // 2. index
    index.unshift({ id, publishedAt, bytes: snapshot.length, label: (body.label || '').slice(0, 80) });
    index = await prune(env, v, index, id);
    await writeIndex(env, v, index);
    // 3. the live pointer, last — everything above is recoverable, this is the
    //    single step that changes what a visitor sees.
    await env.PORTFOLIO_CONFIG.put(CURRENT_KEY(v), snapshot);
  } catch (e) {
    return json({
      error: 'Could not write to storage: ' + (e && e.message ? e.message : 'unknown KV error') + '. The live site is unchanged.',
      code: 'kv-write-failed',
    }, 502);
  }

  return json({ ok: true, version: v, versionId: id, publishedAt, versions: index.length });
}
