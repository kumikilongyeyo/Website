/* Lists published version snapshots, and returns one for preview.
 *
 * Admin-only: version history exposes every state the owner has published,
 * including ones deliberately rolled back from.
 */
import { VERSION_KEY, VERSIONS, json, gate, readIndex, CURRENT_KEY } from './_lib.js';

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
