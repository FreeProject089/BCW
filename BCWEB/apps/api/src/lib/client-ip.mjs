// The real client address, in ONE place (code audit, Sept 24 2026: the rule was copied in
// twelve files, all correct today, each one a place for the next change to be missed).
//
// Caddy appends the address it saw to X-Forwarded-For, so the LAST hop is the one that
// cannot be forged by the client (anything before it is whatever the client sent). Without
// the header (tests, a direct connection) Fastify's req.ip. `fallback` keeps each caller's
// previous behaviour when neither exists: some used '0.0.0.0', some let it be undefined.
export function ipOf(req, fallback) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req?.ip || fallback;
}
