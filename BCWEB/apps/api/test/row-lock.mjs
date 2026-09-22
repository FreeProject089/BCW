// A lock two TEST FILES can share, for a row only one of them may own at a time.
//
// `node --test test/*.test.mjs` runs each file in its own process, in parallel. That is fine
// for tests that create their own tagged rows and delete them again — and wrong for the
// handful that must stand up a SINGLETON AdminSetting (`kofi.goal`, a config row): two files
// writing the same key interleave, each snapshots the other's fixture as "the real value",
// and puts it back afterwards. The symptom is a failure in whichever file lost the race, with
// the other file's fixture in the diff, and it moves between runs.
//
// So a file that owns a singleton takes a Postgres SESSION advisory lock named after the key
// first. Prisma gives each file its own client, so each has its own session; the lock is
// released explicitly and, if a file crashes, by the connection closing.
//
// Not a database constraint and not for src/ — this exists only to serialize test files.

/** FNV-1a → the signed 32-bit int pg_advisory_lock wants. Same name ⇒ same lock. */
function lockKey(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

// pg_advisory_lock() returns void and Prisma's $queryRaw cannot deserialize a void column
// ("Failed to deserialize column of type 'void'"), so the blocking form is unusable from here.
// pg_try_advisory_lock returns a boolean; polling it is the same wait, in JS.
const SPIN_MS = 25;

/** Block until this session owns `name`. Call in before(). */
export async function lockRow(p, name, timeoutMs = 120_000) {
  const key = lockKey(name);
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [{ got }] = await p.$queryRawUnsafe('SELECT pg_try_advisory_lock($1::int) AS got', key);
    if (got) return;
    // Never wait for ever: a leaked lock would hang the whole test run with no output.
    if (Date.now() > until) throw new Error(`row-lock: timed out waiting for '${name}'`);
    await new Promise((r) => setTimeout(r, SPIN_MS));
  }
}

/** Give it back. Call in after() — never throws, an after() that throws hides the real failure. */
export async function unlockRow(p, name) {
  await p.$queryRawUnsafe('SELECT pg_advisory_unlock($1::int) AS released', lockKey(name)).catch(() => {});
}
