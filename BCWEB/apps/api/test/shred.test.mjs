// Crypto-shredding: erasing one user must not erase everybody else.
//
// This is a compliance claim, so it is asserted rather than described. The central property
// is the third test: after one user's key is destroyed, THEIR backups are unreadable and
// their neighbour's still restore. A regression that broke that would be invisible until
// somebody tried to restore — or until a regulator asked.
//
// Needs a Postgres (DATABASE_URL); skipped without one, like the other DB tests here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run shred tests';
let p, S;
const made = [];

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  S = await import('../src/lib/shred.mjs');
});
after(async () => {
  if (!RUN) return;
  // Scoped to this test's own users, by an address nothing else uses.
  await p.user.deleteMany({ where: { email: { startsWith: 'shred-t-' } } }).catch(() => {});
  await p?.$disconnect?.();
});

const mkUser = async (tag) => {
  const u = await p.user.create({ data: { email: `shred-t-${tag}-${Date.now()}@invalid.test`, displayName: 'T' } });
  made.push(u.id);
  return u;
};

test('a sealed backup holds no plaintext and names its owner', { skip }, async () => {
  const u = await mkUser('a');
  const secret = JSON.stringify({ email: u.email, note: 'personal' });
  const env = await S.sealForOwner(p, u.id, secret);

  assert.ok(S.isSealed(env), 'the envelope should be recognisable as one');
  assert.equal(S.ownerOf(env), u.id, 'the owner must be readable WITHOUT the key — something has to know which key to fetch');
  assert.ok(!env.includes('personal'), 'the plaintext must not survive in the envelope');
  assert.ok(!env.includes(u.email));

  const back = await S.openBackup(p, env);
  assert.equal(back.ok, true);
  assert.equal(back.text, secret);
});

test('a row with no owner is stored as-is', { skip }, async () => {
  // A config or an admin setting has no personal data to erase and no key to erase it with.
  // Encrypting it anyway would make the whole archive depend on a key table that can never
  // be pruned.
  const plain = '{"theme":"dark"}';
  assert.equal(await S.sealForOwner(p, null, plain), plain);
  assert.equal(S.isSealed(plain), false);
});

test('THE ONE: shredding one user leaves every other user restorable', { skip }, async () => {
  const a = await mkUser('x');
  const b = await mkUser('y');
  const sa = JSON.stringify({ who: 'a' });
  const sb = JSON.stringify({ who: 'b' });
  const ea = await S.sealForOwner(p, a.id, sa);
  const eb = await S.sealForOwner(p, b.id, sb);

  assert.equal((await S.openBackup(p, ea)).text, sa);
  assert.equal((await S.openBackup(p, eb)).text, sb);

  assert.equal(await S.shredUser(p, a.id), true);

  const after = await S.openBackup(p, ea);
  assert.equal(after.ok, false, 'the erased user must no longer be readable');
  assert.equal(after.reason, 'shredded', 'and the reason must be sayable — a restore screen has to explain this, not throw');

  const neighbour = await S.openBackup(p, eb);
  assert.equal(neighbour.ok, true, 'erasing one account must not erase another');
  assert.equal(neighbour.text, sb);
});

test('deleting the user row destroys the key with it', { skip }, async () => {
  // ON DELETE CASCADE. There must be no state where the account is gone and the key that
  // reads its backups is still there.
  const u = await mkUser('z');
  await S.keyForUser(p, u.id);
  assert.equal(await S.hasKey(p, u.id), true);
  await p.user.delete({ where: { id: u.id } });
  assert.equal(await S.hasKey(p, u.id), false);
});

test('a tampered envelope fails loudly rather than returning garbage', { skip }, async () => {
  const u = await mkUser('t');
  const env = await S.sealForOwner(p, u.id, '{"a":1}');
  const bent = JSON.parse(env);
  bent.data = Buffer.from('not the real bytes').toString('base64');
  const r = await S.openBackup(p, JSON.stringify(bent));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unreadable');
});

test('two concurrent first-uses agree on one key', { skip }, async () => {
  // Both miss, both try to create; the loser must READ the winner's key rather than
  // overwrite it — overwriting would orphan whatever the winner had just encrypted.
  const u = await mkUser('c');
  const [k1, k2] = await Promise.all([S.keyForUser(p, u.id), S.keyForUser(p, u.id)]);
  assert.equal(Buffer.compare(k1, k2), 0, 'a race must not mint two keys for one user');
});
