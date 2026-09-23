// What `npm run seed:demo` created, recorded row by row — the only thing `clear-demo` is
// allowed to delete.
//
// It used to find its rows by a NAME: catalog items whose slug starts with `demo-`, users
// whose email starts with `demo-author-`. Both are shapes a real user can produce. A catalog
// item's slug is derived from its project + name, so an item submitted under a project keyed
// `demo` is slugged `demo-…` and was indistinguishable from seed data: `clear-demo` would
// have deleted real, owner-uploaded content, and `seed:demo` would have replaced it on every
// run. No error, no warning — the row is simply gone.
//
// So the seeder now writes the ids it created into one AdminSetting row and clear-demo
// deletes BY ID, intersected with that record. An id is a cuid the seeder itself minted; a
// real user cannot make one appear in this row (no route writes this key — `PUT
// /admin/settings/:key` refuses unknown keys, and nothing else touches it).
//
// The key deliberately does NOT start with `demo.`: that prefix belonged to the admin demo
// MODE (retired Sept 23), whose stop deleted every `demo.*` setting, and a database that ran
// it may still hold an inert `demo.session` row. Keeping the record out of that namespace
// means no cleanup of it can ever take the seeder's record with it.
export const SEED_RECORD_KEY = 'seed.demoRows';

/** The ids the last `seed:demo` run created. Empty (never null) when it never ran. */
export async function readSeedRecord(p) {
  const row = await p.adminSetting.findUnique({ where: { key: SEED_RECORD_KEY } });
  const v = row?.value || {};
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []);
  return { itemIds: ids(v.itemIds), userIds: ids(v.userIds), at: typeof v.at === 'string' ? v.at : null };
}

/** Replace the record with what this run created. */
export async function writeSeedRecord(p, { itemIds = [], userIds = [] } = {}) {
  const value = { itemIds: [...new Set(itemIds)], userIds: [...new Set(userIds)], at: new Date().toISOString() };
  await p.adminSetting.upsert({ where: { key: SEED_RECORD_KEY }, create: { key: SEED_RECORD_KEY, value }, update: { value } });
  return value;
}
