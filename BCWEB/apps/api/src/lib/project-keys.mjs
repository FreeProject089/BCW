// Which project keys exist — asked of the table that knows, not of a constant.
//
// `Project.key` was a Prisma enum, so the same five names were also written out by hand in
// eleven places as `z.enum([...])` or an `includes()` guard. Adding an official project meant
// a schema migration AND finding all eleven, and missing one meant a project that exists in
// the database and is rejected by one route — a 404 on a page that is right there.
//
// The key is a string now and this is the one place that answers "is that a project".
import { db } from './lib.mjs';

/**
 * The five the seed creates.
 *
 * Not a source of truth — the table is — but they cannot be deleted, because every one of
 * them is referenced by something the application assumes exists: `community` is the fallback
 * blog space and is exempt from the visibility gate, and the other four are named in the
 * seeds, the docs and the catalogue feeds.
 */
export const BUILTIN_PROJECT_KEYS = ['community', 'bmm', 'bsm', 'installer', 'developers'];

/**
 * A key must look like one before it goes near the database.
 *
 * Lower-case, starts with a letter, no separators but `-`. That is what the enum enforced for
 * free and what a string column does not: the keys appear in URLs (`/p/bmm`), in catalogue
 * feeds and in permission rows, so an accidental space or slash would be a broken page rather
 * than a rejected form.
 */
export const KEY_SHAPE = /^[a-z][a-z0-9-]{1,30}$/;

// Read on nearly every request that validates a project, and it changes when an admin adds
// one. Cached for a few seconds rather than per-request: long enough to save the round trip,
// short enough that a newly created project works before anybody thinks to reload.
let _keys = null;
let _at = 0;
const TTL_MS = 5000;

/** Every project key, cached briefly. */
export async function projectKeys() {
  if (_keys && Date.now() - _at < TTL_MS) return _keys;
  const p = await db();
  const rows = await p.project.findMany({ select: { key: true } });
  // The built-ins are unioned in rather than assumed present: on a database seeded before
  // this existed, or mid-seed, a missing row must not make an existing route start refusing
  // `bmm`.
  _keys = [...new Set([...BUILTIN_PROJECT_KEYS, ...rows.map((r) => r.key)])];
  _at = Date.now();
  return _keys;
}

/** Forget the cache. Called by whatever creates or deletes a project. */
export function forgetProjectKeys() {
  _keys = null;
}

/** Is this a project? */
export async function isProjectKey(k) {
  return typeof k === 'string' && (await projectKeys()).includes(k);
}
