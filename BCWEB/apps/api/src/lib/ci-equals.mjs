// A case-insensitive EQUALS that is an equals.
//
// Prisma compiles `{ equals: v, mode: 'insensitive' }` on Postgres to `"col" ILIKE $1` and
// does not escape the value. So `%` and `_` in `v` are wildcards: measured on the dev DB
// (pentest round 2, Sept 24 2026), `{ email: { equals: '%', mode: 'insensitive' } }` returns
// the first user there is, `'a%@gmail.com'` the first one whose address starts that way, and
// a creator id of `'%'` "is already linked". A value holding a backslash did the opposite and
// matched nothing, because ILIKE read the backslash as its escape character.
//
// Every place that resolves a person or a row from something a user TYPED used that shape
// (a team invite, a project contact, a points gift, a pairing request), and the team invite
// answers with the matched account's id and display name — an oracle that spells out any
// member's e-mail address one prefix at a time.
//
// `ciEquals(v)` is the drop-in replacement: the same query with `\`, `%` and `_` escaped,
// which ILIKE's default escape character (backslash) turns back into literals.

/** Escape the three characters ILIKE/LIKE treat specially. */
export const escapeLike = (v) => String(v ?? '').replace(/[\\%_]/g, (c) => `\\${c}`);

/** `{ equals, mode: 'insensitive' }` that matches the value literally, whatever it holds. */
export const ciEquals = (v) => ({ equals: escapeLike(v), mode: 'insensitive' });
