// The one JWT_SECRET of the API. Every signer and verifier imports this (lib.mjs re-exports it):
// routes that re-derived it with their own fallbacks ('dev', 'salt') signed with values the boot
// guard (boot-guard.mjs) did not know about. In production the guard refuses to start on the
// default below, so it can only ever be a development value.
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
