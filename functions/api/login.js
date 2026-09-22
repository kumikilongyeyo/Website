/* Owner login. Exchanges the password once for a session cookie, so the
 * password stops living in page memory and being re-sent with every action.
 */
import {
  json, passwordOk, createSession, sessionCookie, SESSION_TTL,
  rateLimit, clearRate, clientIp, originOk,
  LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW, SESSION_COOKIE, readCookie, validSession,
} from './_lib.js';

export async function onRequestGet({ request, env }) {
  // Lets the editor ask "am I still signed in" without sending anything.
  return json({ signedIn: await validSession(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (!env.EDITOR_USER || !(env.EDITOR_PASS || env.EDITOR_PASS_HASH)) {
    return json({
      error: 'Editor credentials are not configured on this Pages project. Set EDITOR_USER and EDITOR_PASS as secrets, then redeploy.',
      code: 'no-credentials',
    }, 501);
  }
  if (!env.PORTFOLIO_CONFIG) {
    return json({ error: 'Session storage is unavailable (PORTFOLIO_CONFIG is not bound).', code: 'kv-unbound' }, 503);
  }
  if (!originOk(request)) {
    return json({ error: 'This request did not come from the editor.', code: 'bad-origin' }, 403);
  }

  const ip = clientIp(request);
  const rl = await rateLimit(env, 'login', ip, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW);
  if (!rl.ok) {
    return json({
      error: `Too many sign-in attempts. Try again in about ${Math.round(LOGIN_WINDOW / 60)} minutes.`,
      code: 'rate-limited',
    }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'bad-json' }, 400); }
  const user = typeof body?.user === 'string' ? body.user : '';
  const pass = typeof body?.pass === 'string' ? body.pass : '';
  // Bounded so an oversized payload cannot be used to burn CPU on hashing.
  if (user.length > 200 || pass.length > 400) {
    return json({ error: 'Wrong username or password.', code: 'bad-credentials' }, 401);
  }

  if (!(await passwordOk(env, user, pass))) {
    // Deliberately identical for a wrong user and a wrong password, so neither
    // can be enumerated.
    return json({ error: 'Wrong username or password.', code: 'bad-credentials', attemptsLeft: rl.remaining }, 401);
  }

  await clearRate(env, 'login', ip);
  const token = await createSession(env, { ua: request.headers.get('User-Agent') || '' });
  return new Response(JSON.stringify({ ok: true, expiresInSeconds: SESSION_TTL }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie(token, SESSION_TTL),
    },
  });
}
