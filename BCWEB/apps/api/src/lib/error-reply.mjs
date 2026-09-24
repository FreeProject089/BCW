// A failed call to something else (GitHub, Stripe, the mailer, the disk), answered with a
// FIXED error token (SECURITY_SUMMARY §9, O3).
//
// Sixteen routes sent `String(e.message)` to whoever asked. On the public ones that is
// somebody else's error text — an upstream URL, a rate-limit message naming our token's
// account, a filesystem path with the server's layout in it — handed to anybody. The detail is
// what the person FIXING it needs, so it goes to the server log, and into the response only
// for a SUPERADMIN, the one reader the site's own tools are built for.
//
// test/error-reply.test.mjs holds every public route to it.

/** The exception's text, bounded. Never the stack. */
export function errorText(err) {
  return String(err?.message || err || '').slice(0, 300);
}

/**
 * Answer `status` with `{ error: token, ...extra }`, log the detail, and add it as `detail`
 * only when the caller is a SUPERADMIN.
 */
export function errorReply(req, reply, status, token, err, extra = {}) {
  const detail = errorText(err);
  try { req?.log?.warn?.({ route: req?.routeOptions?.url, token, detail }, 'upstream error'); } catch { /* logging never fails a reply */ }
  const body = { error: token, ...extra };
  if (detail && req?.user?.role === 'SUPERADMIN') body.detail = detail;
  return reply.code(status).send(body);
}
