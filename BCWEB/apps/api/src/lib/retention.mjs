// Analytics retention config (audit §3.6). Kept in its own dependency-free module so
// both the sweeper (which does the purging) and the analytics route (which reads/writes
// the config) can import it without pulling in the sweeper's heavy dependency graph.
//
// Each value is a retention window in DAYS for one append-only analytics table; the
// sweeper deletes rows older than that. A window of 0 (or negative) keeps that table
// forever. Admins override these via the `analytics.retention` AdminSetting.
export const RETENTION_DEFAULTS = { pageviewDays: 365, interactionDays: 120, vitalDays: 120, loginDays: 180 };

// Merge a (possibly partial / untrusted) stored value over the defaults, coercing each
// field to a finite number and falling back to the default when it isn't one.
export function resolveRetention(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const pick = (k) => (Number.isFinite(Number(v[k])) ? Number(v[k]) : RETENTION_DEFAULTS[k]);
  return { pageviewDays: pick('pageviewDays'), interactionDays: pick('interactionDays'), vitalDays: pick('vitalDays'), loginDays: pick('loginDays') };
}
