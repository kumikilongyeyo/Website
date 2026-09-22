/* Ends the session server-side, so signing out actually revokes rather than
 * just forgetting the cookie locally.
 */
import { json, destroySession, readCookie, SESSION_COOKIE, sessionCookie } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const token = readCookie(request, SESSION_COOKIE);
  if (env.PORTFOLIO_CONFIG) await destroySession(env, token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie('', 0),
    },
  });
}
