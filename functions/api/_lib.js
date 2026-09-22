/* Shared helpers for the admin API.
 *
 * Underscore-prefixed files are not routed by Pages Functions, so this is
 * importable without becoming a public endpoint.
 */

export const CURRENT_KEY = version => 'site-config:' + version;
export const VERSION_KEY = (version, id) => `version:${version}:${id}`;
export const INDEX_KEY = version => `version-index:${version}`;

export const VERSIONS = ['studio', 'gallery'];
export const MAX_BODY = 800000;
// Twenty snapshots at ~10-30KB each is well inside the 1GB KV allowance, and
// publish costs three writes against a 1,000/day budget.
export const KEEP_VERSIONS = 20;

export function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function auth(request, env) {
  if (!env.EDITOR_USER || !env.EDITOR_PASS) return false;
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const d = atob(h.slice(6)), i = d.indexOf(':');
    return i > 0 && safeEqual(d.slice(0, i), env.EDITOR_USER) && safeEqual(d.slice(i + 1), env.EDITOR_PASS);
  } catch { return false; }
}

export const json = (x, s = 200) => new Response(JSON.stringify(x), {
  status: s,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

/* Distinguishes "not allowed" from "not configured", so the editor never tells
 * someone to check their password over a missing binding.
 */
export function gate(request, env) {
  if (!env.EDITOR_USER || !env.EDITOR_PASS) {
    return json({
      error: 'Editor credentials are not configured on this Pages project. Set EDITOR_USER and EDITOR_PASS as secrets, then redeploy.',
      code: 'no-credentials',
    }, 501);
  }
  if (!auth(request, env)) {
    return json({ error: 'Wrong username or password.', code: 'bad-credentials' }, 401);
  }
  if (!env.PORTFOLIO_CONFIG) {
    return json({
      error: 'The PORTFOLIO_CONFIG KV namespace is not bound to this Pages environment, so there is nowhere to save.',
      code: 'kv-unbound',
    }, 503);
  }
  return null;
}

export async function readIndex(env, version) {
  try {
    const raw = await env.PORTFOLIO_CONFIG.get(INDEX_KEY(version));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt index must not block publishing; the snapshots are the record.
    return [];
  }
}

export async function writeIndex(env, version, list) {
  await env.PORTFOLIO_CONFIG.put(INDEX_KEY(version), JSON.stringify(list.slice(0, KEEP_VERSIONS)));
}

export function newVersionId() {
  // Sorts chronologically as a string, and the suffix prevents a collision
  // between two publishes inside the same second.
  const d = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${d}-${crypto.randomUUID().slice(0, 6)}`;
}

/* Trims old snapshots after a publish. Retention is not rollback: this never
 * touches a version that is still inside the keep window, and never the one
 * currently published.
 */
export async function prune(env, version, list, currentId) {
  const keep = list.slice(0, KEEP_VERSIONS);
  const drop = list.slice(KEEP_VERSIONS).filter(v => v.id !== currentId);
  for (const v of drop) {
    try { await env.PORTFOLIO_CONFIG.delete(VERSION_KEY(version, v.id)); } catch { /* best effort */ }
  }
  return keep;
}
