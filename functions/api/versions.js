/* Lists published version snapshots, and returns one for preview.
 *
 * Admin-only: version history exposes every state the owner has published,
 * including ones deliberately rolled back from.
 */
import { VERSION_KEY, VERSIONS, json, gate, readIndex, writeIndex, CURRENT_KEY } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const bad = await gate(request, env, { readOnly: true });
  if (bad) return bad;

  const url = new URL(request.url);
  const v = url.searchParams.get('version') || 'studio';
  if (!VERSIONS.includes(v)) return json({ error: 'Unknown version', code: 'bad-version' }, 400);

  const id = url.searchParams.get('id');
  if (id) {
    const raw = await env.PORTFOLIO_CONFIG.get(VERSION_KEY(v, id));
    if (!raw) return json({ error: 'That version no longer exists.', code: 'not-found' }, 404);
    return json({ ok: true, id, snapshot: JSON.parse(raw) });
  }

  const index = await readIndex(env, v);
  // Mark which entry is live, so the UI never offers to restore the current one.
  let currentId = null;
  try {
    const cur = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(v));
    if (cur) currentId = JSON.parse(cur).versionId || null;
  } catch { /* the list is still useful without it */ }

  return json({ ok: true, version: v, currentId, versions: index });
}

/* Removes snapshots the owner no longer wants to keep.
 *
 * Retention (prune) drops snapshots that aged past the keep window. This is the
 * deliberate version: the owner asks, and it happens now. The one snapshot that
 * is currently live is never deletable, because deleting it would leave the
 * published site with no entry in its own history and nothing to roll back to.
 */
export async function onRequestDelete({ request, env }) {
  const bad = await gate(request, env);
  if (bad) return bad;

  const url = new URL(request.url);
  const v = url.searchParams.get('version') || 'studio';
  if (!VERSIONS.includes(v)) return json({ error: 'Unknown version', code: 'bad-version' }, 400);

  let currentId = null;
  try {
    const cur = await env.PORTFOLIO_CONFIG.get(CURRENT_KEY(v));
    if (cur) currentId = JSON.parse(cur).versionId || null;
  } catch { /* treated as "nothing is protected by id", handled below */ }

  const index = await readIndex(env, v);
  const scope = url.searchParams.get('scope');
  const id = url.searchParams.get('id');

  let targets;
  if (scope === 'others') {
    targets = index.filter(x => x.id !== currentId);
    if (!targets.length) return json({ error: 'There is nothing to remove — only the live snapshot is kept.', code: 'nothing-to-do' }, 400);
  } else {
    // The id only ever builds a KV key, so it is validated rather than trusted.
    if (!id || typeof id !== 'string' || !/^[\w-]{6,64}$/.test(id)) {
      return json({ error: 'A valid version id is required.', code: 'bad-id' }, 400);
    }
    if (id === currentId) {
      return json({ error: 'That snapshot is the one currently live, so it cannot be removed. Restore a different version first.', code: 'is-current' }, 409);
    }
    const entry = index.find(x => x.id === id);
    if (!entry) return json({ error: 'That version is not in the history.', code: 'not-found' }, 404);
    targets = [entry];
  }

  // The index is written last: a failed key delete then leaves an entry whose
  // snapshot is gone, and restore already reports that honestly. Writing the
  // index first would hide snapshots that still exist and still cost storage.
  let removed = 0;
  const failed = [];
  for (const t of targets) {
    try { await env.PORTFOLIO_CONFIG.delete(VERSION_KEY(v, t.id)); removed++; }
    catch { failed.push(t.id); }
  }
  const gone = new Set(targets.filter(t => !failed.includes(t.id)).map(t => t.id));
  try {
    await writeIndex(env, v, index.filter(x => !gone.has(x.id)));
  } catch (e) {
    return json({
      error: 'The snapshots were deleted but the history list could not be updated: ' + (e && e.message ? e.message : 'unknown KV error'),
      code: 'index-write-failed', removed,
    }, 502);
  }

  if (failed.length) {
    return json({ ok: true, version: v, removed, failed, kept: index.length - removed,
      warning: failed.length + ' snapshot(s) could not be deleted and are still stored.' });
  }
  return json({ ok: true, version: v, removed, kept: index.length - removed });
}
