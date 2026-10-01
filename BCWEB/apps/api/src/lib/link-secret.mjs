// The server-to-server link secret: /link/lookup, the telemetry identity and notify doors, and
// the HMAC of the telemetry SSO token. ONE reader, so the four places cannot disagree again.
//
// Audit Oct 2026, finding 9: two of the four read `LINK_LOOKUP_SECRET || JWT_SECRET`. With the
// variable unset, the session-signing key became a password the telemetry service had to hold
// (and anything that held it could forge every session). Now the chain is the one the boot
// guard checks — `BC_LINK_SECRET || LINK_LOOKUP_SECRET`, then the development literal, which
// boot-guard.mjs refuses in production along with a value equal to JWT_SECRET.
export const DEV_LINK_SECRET = 'dev-link-secret';

export function linkSecret(env = process.env) {
  return env.BC_LINK_SECRET || env.LINK_LOOKUP_SECRET || DEV_LINK_SECRET;
}
