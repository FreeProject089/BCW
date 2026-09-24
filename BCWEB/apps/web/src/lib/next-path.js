// Where the sign-in page may send somebody afterwards (`/auth?next=…`).
//
// The API's own rule (routes/oauth.mjs `safeNext`) is "one leading slash and nothing else".
// The SPA's was `startsWith('/')`, and it did one thing more: a `next` under `/api/` or
// `/oauth2/` was followed with a REAL navigation. So a same-site path was enough to leave the
// site whenever that path is an API route that redirects, and one does for any member:
// `/api/avatar/<id>` answers 302 to the account's `avatar.image`, which PATCH /me stores as
// any string. `/auth?next=/api/avatar/<attacker>` therefore sent a visitor, right after they
// typed their password, wherever the attacker's avatar pointed (full audit Sept 24 2026, W4).
//
// The rule here: the path is read the way the browser will read it (dot segments, `%2e%2e`,
// backslashes and tabs resolved by URL itself), it must stay on this origin, and a real
// navigation is allowed only to the two server routes that need one.
const SERVER_ROUTES = [/^\/oauth2\/authorize(?:\/|$)/, /^\/api\/telemetry\/authorize$/];

/**
 * `{ server: true|false, href }` for a destination this page may go to, or null.
 * `origin` is injectable for tests; in the browser it is the page's own.
 */
export function nextTarget(raw, origin = (typeof window !== 'undefined' ? window.location.origin : 'https://localhost')) {
  const s = typeof raw === 'string' ? raw : '';
  // One leading slash, then not a slash or a backslash (`//host`, `/\host`), and no control
  // characters or whitespace a browser would strip before reading the rest.
  if (!/^\/[^/\\]/.test(s) || /[\u0000- \u007f]/.test(s) || s.length > 1024) return null;
  let u;
  try { u = new URL(s, origin); } catch { return null; }
  if (u.origin !== new URL(origin).origin) return null;
  const href = u.pathname + u.search + u.hash;
  if (SERVER_ROUTES.some((re) => re.test(u.pathname))) return { server: true, href };
  // Any other API or provider path is not a page of this app: refused rather than followed.
  if (/^\/(?:api|oauth2)(?:\/|$)/.test(u.pathname)) return null;
  return { server: false, href };
}
