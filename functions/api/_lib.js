/* Shared helpers for the admin API.
 *
 * Underscore-prefixed files are not routed by Pages Functions, so this is
 * importable without becoming a public endpoint.
 */

export const CURRENT_KEY = version => 'site-config:' + version;
export const VERSION_KEY = (version, id) => `version:${version}:${id}`;
export const INDEX_KEY = version => `version-index:${version}`;

export const VERSIONS = ['studio', 'gallery', 'casino'];
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
export async function gate(request, env, opts) {
  if (!env.EDITOR_USER || !(env.EDITOR_PASS || env.EDITOR_PASS_HASH)) {
    return json({
      error: 'Editor credentials are not configured on this Pages project. Set EDITOR_USER and EDITOR_PASS as secrets, then redeploy.',
      code: 'no-credentials',
    }, 501);
  }
  if (!env.PORTFOLIO_CONFIG) {
    return json({
      error: 'The PORTFOLIO_CONFIG KV namespace is not bound to this Pages environment, so there is nowhere to save.',
      code: 'kv-unbound',
    }, 503);
  }
  // A cookie travels automatically, so a state-changing request must also come
  // from this origin.
  if (!(opts && opts.readOnly) && !originOk(request)) {
    return json({ error: 'This request did not come from the editor.', code: 'bad-origin' }, 403);
  }
  if (await validSession(request, env)) return null;
  // Basic auth remains accepted for non-browser use (curl, scripts). The
  // browser no longer sends it: the editor holds a session instead, so the
  // password is not sitting in page memory for the whole session.
  if (auth(request, env)) return null;
  return json({ error: 'Not signed in, or the session has expired.', code: 'no-session' }, 401);
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

/* ---------------------------------------------------------------- sessions
 * Basic auth kept the password in browser memory and re-sent it with every
 * action. A session means the password is used once, at login, and a stolen
 * session can be revoked without changing it.
 */
export const SESSION_COOKIE = '__Host-ks_session';   // __Host- forces Secure + path=/ and no domain
export const SESSION_TTL = 60 * 60 * 12;             // 12 hours
export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_WINDOW = 60 * 15;                 // 15 minutes

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/* Tokens are stored hashed. A leaked KV listing then contains no usable
 * session, only the digest of one.
 */
export const SESSION_KEY = tokenHash => 'session:' + tokenHash;

export function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function createSession(env, meta) {
  const token = newToken();
  const hash = await sha256(token);
  const record = { createdAt: new Date().toISOString(), ua: (meta && meta.ua || '').slice(0, 120) };
  await env.PORTFOLIO_CONFIG.put(SESSION_KEY(hash), JSON.stringify(record), { expirationTtl: SESSION_TTL });
  return token;
}

export async function destroySession(env, token) {
  if (!token) return;
  try { await env.PORTFOLIO_CONFIG.delete(SESSION_KEY(await sha256(token))); } catch { /* best effort */ }
}

export async function validSession(request, env) {
  if (!env.PORTFOLIO_CONFIG) return false;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length < 20 || token.length > 100) return false;
  try {
    return !!(await env.PORTFOLIO_CONFIG.get(SESSION_KEY(await sha256(token))));
  } catch { return false; }
}

export function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/* A cookie is sent automatically by the browser, so a write route must also
 * confirm the request came from this site (§9 CSRF). SameSite=Strict already
 * blocks the common case; this closes the rest.
 */
export function originOk(request) {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  const here = new URL(request.url).origin;
  if (origin) return origin === here;
  if (referer) { try { return new URL(referer).origin === here; } catch { return false; } }
  // No Origin and no Referer means a non-browser client, which cannot be a
  // cross-site request forged by a page.
  return true;
}

/* ---------------------------------------------------------- password check
 * Prefers a PBKDF2 verifier when one is configured; falls back to a
 * constant-time comparison against the plaintext secret so an existing
 * deployment keeps working without a re-setup.
 */
export async function passwordOk(env, user, pass) {
  if (!user || !pass) return false;
  if (!safeEqual(user, env.EDITOR_USER || '')) return false;
  const stored = env.EDITOR_PASS_HASH;
  if (stored && stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const iterations = Math.min(600000, Math.max(1000, parseInt(iterStr, 10) || 100000));
    const salt = Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return safeEqual(b64url(bits), hashB64.replace(/=+$/, ''));
  }
  return safeEqual(pass, env.EDITOR_PASS || '');
}

/* ------------------------------------------------------------ rate limiting
 * KV is eventually consistent, so this is a soft limit: it stops sustained
 * guessing rather than a burst fired in the same instant. That is the right
 * trade for a free-tier personal site, and it is stated rather than implied.
 */
export function clientIp(request) {
  // CF-Connecting-IP is set by the Cloudflare edge and overwrites anything the
  // client sends, so it cannot be forged. X-Forwarded-For can be, and using it
  // as a fallback would let an attacker reset their own limit on every request
  // by changing one header. Without a trusted IP, everyone shares one bucket,
  // which throttles rather than exempts.
  return request.headers.get('CF-Connecting-IP') || 'shared';
}

export async function rateLimit(env, bucket, id, max, windowSec) {
  if (!env.PORTFOLIO_CONFIG) return { ok: true, remaining: max };
  const key = `rl:${bucket}:${id}`;
  let n = 0;
  try { n = parseInt(await env.PORTFOLIO_CONFIG.get(key), 10) || 0; } catch { n = 0; }
  if (n >= max) return { ok: false, remaining: 0 };
  try { await env.PORTFOLIO_CONFIG.put(key, String(n + 1), { expirationTtl: windowSec }); } catch { /* fail open on storage error, not on the check */ }
  return { ok: true, remaining: max - n - 1 };
}

export async function clearRate(env, bucket, id) {
  try { await env.PORTFOLIO_CONFIG.delete(`rl:${bucket}:${id}`); } catch { /* best effort */ }
}
