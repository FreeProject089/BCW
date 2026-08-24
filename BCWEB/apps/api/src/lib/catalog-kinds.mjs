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
export const CATALOG_KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET', 'MODPACK', 'TUTORIAL'];

/** The same, lower-case — what the public API and BMM's feeds use on the wire. */
export const CATALOG_KINDS_LOWER = CATALOG_KINDS.map((k) => k.toLowerCase());

/**
 * The order catalogue TYPES appear in, including `repo`.
 *
 * `repo` is not a CatalogKind — a server repo is a different object with its own table — but
 * it is a type an index lists alongside the others, so the ordering has to know about it.
 */
export const INDEX_TYPE_ORDER = [...CATALOG_KINDS_LOWER, 'repo'];

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
