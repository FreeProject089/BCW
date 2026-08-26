// What a catalogue can hold, written ONCE.
//
// This list was spelled out as a literal in eleven places across the API — two KINDS consts,
// six zod enums, a seed generator and a type-order array. Adding a kind meant finding all
// eleven, and the ones that were missed would not fail: a zod enum silently rejects the new
// value as invalid input, and a TYPE_ORDER that has not heard of it sorts it to the end. Both
// look like the feature "not working yet" rather than like a list that was not updated.
//
// So: one array, and everything else derived from it.

/** The database enum values, and the canonical order everything sorts by. */
export const CATALOG_KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET', 'MODPACK', 'TUTORIAL', 'LIST'];

/** The same, lower-case — what the public API and BMM's feeds use on the wire. */
export const CATALOG_KINDS_LOWER = CATALOG_KINDS.map((k) => k.toLowerCase());

/**
 * The order catalogue TYPES appear in, including `repo`.
 *
 * `repo` is not a CatalogKind — a server repo is a different object with its own table — but
 * it is a type an index lists alongside the others, so the ordering has to know about it.
 */
export const INDEX_TYPE_ORDER = [...CATALOG_KINDS_LOWER, 'repo'];

/**
 * Kinds that are a DOCUMENT rather than a set of items.
 *
 *   repo_index     a list of Server Repos       — BMM's "Browse Server Repositories" reads it
 *   catalog_index  a list of catalogues         — BMM's catalogue index reads it
 *
 * Not CatalogKind values, and not by oversight: that enum drives moderation queues, per-item
 * payload uploads and feedField() plurals, none of which apply to a document with no items.
 * They live in the `kinds String[]` column instead, which needs no migration, and their
 * raw-only invariant is enforced at the API boundary like every other catalogue rule.
 */
export const DOCUMENT_KINDS = ['repo_index', 'catalog_index'];

/** The top-level array each document kind carries — what the reader will look for. */
export const DOCUMENT_KIND_FIELD = { repo_index: 'repos', catalog_index: 'catalogs' };

/** True when this kind is a document (no items, raw mode only). */
export const isDocumentKind = (v) => DOCUMENT_KINDS.includes(String(v || '').toLowerCase());

/** Everything a catalogue may declare itself as, lower-case — items and documents alike. */
export const ALL_HOSTABLE_LOWER = [...CATALOG_KINDS_LOWER, ...DOCUMENT_KINDS];

/** True when `v` names a kind, whatever case it arrives in. */
export const isCatalogKind = (v) => CATALOG_KINDS.includes(String(v || '').toUpperCase());

/**
 * The feed field a kind's items are published under — `plugins`, `themes`, `presets`,
 * `modpacks`.
 *
 * Derived rather than mapped, because the rule really is "the plural of the kind": a mapping
 * would be a second list to keep in step with the first, which is the thing this file exists
 * to stop.
 */
export const feedField = (kind) => `${String(kind).toLowerCase()}s`;
