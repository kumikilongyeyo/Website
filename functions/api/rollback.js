/* Restores a previous published snapshot.
 *
 * Rollback republishes an existing snapshot; it never deletes history. The
 * version being rolled back FROM stays in the list, so a rollback is itself
 * reversible.
 */
import { CURRENT_KEY, VERSION_KEY, VERSIONS, json, gate, readIndex, writeIndex } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const bad = await gate(request, env);
  if (bad) return bad;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'bad-json' }, 400); }

  const v = (body && body.version) || 'studio';
  const id = body && body.id;
  if (!VERSIONS.includes(v)) return json({ error: 'Unknown version', code: 'bad-version' }, 400);
  if (!id || typeof id !== 'string' || !/^[\w-]{6,64}$/.test(id)) {
    // The id is only ever used to build a key, so it is validated rather than
    // trusted — a caller must not be able to steer the key anywhere.
    return json({ error: 'A valid version id is required.', code: 'bad-id' }, 400);
  }

  const raw = await env.PORTFOLIO_CONFIG.get(VERSION_KEY(v, id));
  if (!raw) return json({ error: 'That version no longer exists. It may have aged out of the history.', code: 'not-found' }, 404);

  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    return json({ error: 'That snapshot is unreadable, so it was not restored. The live site is unchanged.', code: 'corrupt-snapshot' }, 422);
  }
  if (!parsed || !parsed.state) {
    return json({ error: 'That snapshot has no content, so it was not restored. The live site is unchanged.', code: 'empty-snapshot' }, 422);
  }

  try {
    // One write, and only after the snapshot has been read and validated.
    await env.PORTFOLIO_CONFIG.put(CURRENT_KEY(v), raw);
  } catch (e) {
    return json({
      error: 'Could not write to storage: ' + (e && e.message ? e.message : 'unknown KV error') + '. The live site is unchanged.',
      code: 'kv-write-failed',
    }, 502);
  }

  // Record that it happened, without adding a duplicate snapshot.
  const index = await readIndex(env, v);
  const entry = index.find(x => x.id === id);
  if (entry) {
    entry.restoredAt = new Date().toISOString();
    await writeIndex(env, v, index);
  }

  return json({ ok: true, version: v, id, restoredAt: new Date().toISOString(), publishedAt: parsed.updatedAt || null });
}
