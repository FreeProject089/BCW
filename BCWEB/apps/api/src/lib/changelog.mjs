// What changed, when, and who did it — for a repo, a catalogue or a pool.
//
// There was a per-repo audit log already, and its weakness is the one every audit log has:
// `detail` is free text, so the row for the most common action on the platform read "sandbox
// settings updated". True, useless, and unanswerable — somebody looking at it wants to know
// WHICH setting and what it was before, which is the only version of this feature worth
// having. That is the difference between a log and a history.
//
// So a change carries a diff: [{ field, from, to }]. Built here rather than at each call site,
// because a diff written nine times is nine chances to leak a password hash into a timeline
// the repo's collaborators can read.
//
// Not file CONTENT versioning. Keeping every version of every uploaded file is a different
// product with a storage bill attached; this records that a file changed, its size and its
// checksum, which is what tells you when something moved and lets you compare against a copy
// you kept.

/**
 * Fields that must never appear in a diff, matched on the LAST path segment.
 *
 * An allowlist would be safer still, but settings are a free-shaped JSON blob that grows, and
 * an allowlist that has to be extended for every new field ends up bypassed. So: a denylist,
 * applied to a flattened path, plus the rule below that an unknown OBJECT is summarised
 * rather than expanded — which is what stops a nested secret being reached at all.
 */
const SECRET = /^(pass|password|passwordhash|hash|secret|token|key|apikey|privatekey|syncpasswordhash|dashpassword|verifytoken|sharekey)$/i;

/** Values a timeline shows as they are. Anything else is described, not printed. */
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * A value, made safe and short enough for one line of a timeline.
 *
 * An array becomes its length, because "the ban list went from 3 entries to 4" is the fact,
 * and printing the entries would put IP addresses in a view a collaborator can read. An
 * object becomes its key count for the same reason.
 */
export function summarise(v, max = 120) {
  if (v === undefined) return null;
  if (v === null) return null;
  // Bracket notation rather than "3 items", for the same reason summaryFor() returns no
  // prose: this string is stored as written and rendered as-is into a page that may be in
  // French. `[3]` and `{3}` carry the fact in no language at all.
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return `{${Object.keys(v).length}}`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The difference between two states, as a list a person can read.
 *
 * `fields` is optional and, when given, restricts the comparison to those top-level keys —
 * used where the object being compared is a whole database row and only a few of its columns
 * are the owner's business.
 *
 * Ordering is stable (the key order of `after`, then anything only in `before`) so two runs
 * over the same change produce the same rows.
 */
export function diffFields(before = {}, after = {}, { fields = null, prefix = '' } = {}) {
  const out = [];
  const keys = fields
    ? fields.slice()
    : [...Object.keys(after || {}), ...Object.keys(before || {}).filter((k) => !(k in (after || {})))];
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    // The last segment, so `access.password` is caught as surely as `password`.
    if (SECRET.test(path.split('.').pop())) continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (b === undefined && a === undefined) continue;
    // A nested object is walked ONE level, which is where the interesting settings live
    // (access.whitelistEnabled, bans.ips). Deeper than that it is summarised — a diff that
    // recurses without limit will eventually print something nobody meant to publish.
    if (!isScalar(a) && !isScalar(b) && !Array.isArray(a) && !Array.isArray(b)
        && (a || b) && typeof (a || b) === 'object' && !prefix) {
      out.push(...diffFields(a || {}, b || {}, { prefix: path }));
      continue;
    }
    const sa = summarise(a);
    const sb = summarise(b);
    if (sa === sb) continue;
    out.push({ field: path, from: sa, to: sb });
  }
  return out;
}

/** Actions a change can carry. A closed list so the timeline can label and icon them, and so
 *  a typo cannot invent a category nobody renders. */
export const CHANGE_ACTIONS = [
  'created', 'settings', 'access', 'publish', 'unpublish', 'file.add', 'file.update',
  'file.remove', 'domain', 'plan', 'transfer', 'listed', 'unlisted', 'deleted', 'restored',
];

/**
 * Write one change.
 *
 * `subject` is `{ repoId }`, `{ catalogId }` or `{ groupId }` — exactly one. The actor's LABEL
 * is frozen at write time rather than joined on read: a history that renames a person
 * retroactively when they change their display name is a history that quietly rewrites
 * itself, and the whole point of the thing is that it does not.
 *
 * Never throws. A timeline entry failing to write must not fail the change it describes — the
 * change already happened, and turning an audit miss into a 500 loses both.
 */
export async function recordChange(p, subject, { actorId = null, actorLabel = '', action, summary = '', changes = null }) {
  try {
    if (!CHANGE_ACTIONS.includes(action)) return null;
    const list = Array.isArray(changes) ? changes.slice(0, 40) : null;
    return await p.changeEvent.create({
      data: {
        repoId: subject.repoId || null,
        catalogId: subject.catalogId || null,
        groupId: subject.groupId || null,
        actorId,
        actorLabel: String(actorLabel || '').slice(0, 120),
        action,
        summary: String(summary || '').slice(0, 300),
        changes: list && list.length ? list : undefined,
      },
    });
  } catch { return null; }
}

/**
 * The one-line summary beside the action.
 *
 * A single change names its field, because "Settings — listing" is worth reading at a glance.
 * SEVERAL changes get nothing: the rows are rendered directly underneath, so a summary would
 * only repeat them — and the obvious "2 fields" would be an English sentence built on the
 * server, travelling straight past i18n into a French page. Nothing here is ever translated,
 * so nothing here may be prose.
 */
export function summaryFor(action, changes) {
  const n = Array.isArray(changes) ? changes.length : 0;
  return n === 1 ? String(changes[0].field || '') : '';
}
