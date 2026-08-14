// Test fixtures that clean up after themselves.
//
// They did not. Three of the four suites that create rows had an `after()` hook doing
// nothing but `p.$disconnect()`, so every run left its users, hosting pools, subscriptions
// and repos in the database permanently. One evening's runs had put 23 of 26 accounts in
// the developer's dev database, along with 19 hosting groups and 20 subscriptions — which
// makes every admin screen a wall of noise and every "how many X are there" question
// unanswerable.
//
// Two mechanisms, on purpose:
//
//   · `track()` records what a run created, and `cleanupFixtures()` deletes exactly that.
//     Precise: it cannot touch anything a test did not make.
//   · `sweepTestLocal()` deletes everything carrying the @test.local marker, whoever made
//     it. Blunt, and the only thing that clears debris from runs that predate this file.
//
// Deletion order matters. Postgres rejects a delete whose row is still referenced, and
// discovering that as a P2003 mid-cleanup leaves half the fixtures behind — which is worse
// than not cleaning at all, because the failure is silent and partial.

/** Rows this run created, newest first within each model. */
const created = new Map();

/** Record a row so cleanupFixtures can delete it. Returns the row, so it can wrap a create. */
export function track(model, row) {
  if (!row?.id) return row;
  if (!created.has(model)) created.set(model, []);
  created.get(model).unshift(row.id);
  return row;
}

/**
 * Delete order: children before parents.
 *
 * A user is last because nearly everything points at one. Notifications are in the list
 * because routes under test send them, and their foreign key blocks the user delete with a
 * P2003 that reads like an unrelated failure.
 */
const ORDER = [
  'catalogItem',
  'communityCatalog',
  'serverRepo',
  'payment',
  'subscription',
  'hostingGroup',
  'hostingPlan',
  'notification',
  'sanctionAttachment',
  'sanction',
  'analyticsEvent',
  'interactionEvent',
  'webVital',
  'loginAttempt',
  'user',
];

/**
 * Delete what this run tracked.
 *
 * Never throws. A test suite that fails during cleanup reports a red result for work that
 * actually passed, and the person reads it as "my change broke something".
 */
export async function cleanupFixtures(p) {
  const users = created.get('user') || [];

  // Cascade from the OWNER rather than tracking every row.
  //
  // Everything these suites create — pools, subscriptions, repos, catalogs, notifications —
  // hangs off a user they made. Wrapping each individual create in track() meant editing a
  // dozen call sites and getting the closing parens right in every one; cascading needs the
  // user tracked and nothing else, and it also catches rows a route created as a side effect,
  // which no amount of tracking at the call site would have seen.
  if (users.length) {
    const owned = [
      ['catalogItem', { catalog: { ownerId: { in: users } } }],
      ['communityCatalog', { ownerId: { in: users } }],
      ['serverRepo', { ownerId: { in: users } }],
      ['payment', { userId: { in: users } }],
      ['subscription', { userId: { in: users } }],
      ['hostingGroup', { ownerId: { in: users } }],
      ['notification', { userId: { in: users } }],
      ['sanction', { userId: { in: users } }],
    ];
    for (const [model, where] of owned) {
      if (!p[model]) continue;
      try { await p[model].deleteMany({ where }); } catch { /* see above */ }
    }
  }

  for (const model of ORDER) {
    const ids = created.get(model);
    if (!ids?.length || !p[model]) continue;
    try { await p[model].deleteMany({ where: { id: { in: ids } } }); } catch { /* see above */ }
  }
  created.clear();
}

/**
 * Delete everything marked @test.local, whoever created it.
 *
 * The marker is the convention every suite here already follows. A user who genuinely
 * signed up with a .local address would be caught by this, which is why it is a separate,
 * explicitly-called function rather than something cleanupFixtures does on its own.
 *
 * Returns what it removed, so a caller can report a number instead of asserting success.
 */
export async function sweepTestLocal(p) {
  const users = await p.user.findMany({ where: { email: { endsWith: '@test.local' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return { users: 0 };

  const removed = { users: 0 };
  const byOwner = [
    ['catalogItem', { catalog: { ownerId: { in: ids } } }],
    ['communityCatalog', { ownerId: { in: ids } }],
    ['serverRepo', { ownerId: { in: ids } }],
    ['payment', { userId: { in: ids } }],
    ['subscription', { userId: { in: ids } }],
    ['hostingGroup', { ownerId: { in: ids } }],
    ['notification', { userId: { in: ids } }],
    ['sanction', { userId: { in: ids } }],
  ];
  for (const [model, where] of byOwner) {
    if (!p[model]) continue;
    try { removed[model] = (await p[model].deleteMany({ where })).count; } catch { /* not all models have that shape */ }
  }
  // Audit entries are an HMAC chain: deleting one breaks the next row's prevHash, and the
  // foreign key is Restrict on purpose so a staff action stays attributable. A fixture that
  // acted as staff therefore CANNOT be removed, and saying so beats failing silently.
  const audited = new Set((await p.auditLogEntry.findMany({ where: { actorId: { in: ids } }, select: { actorId: true } })).map((a) => a.actorId));
  const removable = ids.filter((id) => !audited.has(id));
  removed.users = (await p.user.deleteMany({ where: { id: { in: removable } } })).count;
  removed.kept_for_audit_history = audited.size;
  return removed;
}
