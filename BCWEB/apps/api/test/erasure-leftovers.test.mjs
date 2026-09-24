// What erasing an account left behind (SECURITY_SUMMARY §9, "Other open items"):
//
//   · PasswordReset and EmailVerification rows (F23-2 residual) — the tokens are hashed and
//     single-use, but a row that outlives the account is a way back in, written down;
//   · the uploaded avatar picture in object storage — the row's `avatar` was cleared, the
//     bytes stayed, served at the same /api/media URL;
//   · the files attached to the person's feedback, bug and crash reports.
//
// And the one thing it must NOT do on the way: delete a picture that is somebody else's
// because the erased account pointed its avatar at it.
//
// Object storage is not reached: anonymiseAccount takes the delete function, and this test
// records what it is asked to delete.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the erasure leftovers test';
process.env.JWT_SECRET ||= 'erasure-leftovers-secret';

const MAIL = '@erasure-leftovers.test';
const TAG = 'erasure-leftovers-';
let p, anonymiseAccount;
let seq = 0;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  ({ anonymiseAccount } = await import('../src/routes/closure.mjs'));
});

after(async () => {
  if (!RUN) return;
  // Every account this file made, found by id: an erased one no longer has our address.
  const ids = made;
  await p.passwordReset.deleteMany({ where: { userId: { in: ids } } });
  await p.emailVerification.deleteMany({ where: { userId: { in: ids } } });
  await p.feedback.deleteMany({ where: { id: { startsWith: TAG } } });
  await p.mediaHash.deleteMany({ where: { key: { contains: TAG } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
  await p?.$disconnect?.();
});

const made = [];
const mkUser = async (over = {}) => {
  const u = await p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `el-${seq}`, emailVerified: true, status: 'active', ...over } });
  made.push(u.id);
  return u;
};
const mediaKey = () => `blog/${TAG}${crypto.randomUUID()}-me.png`;

describe('erasing an account removes what it left behind', { skip }, () => {
  test('reset and confirmation tokens, the avatar upload, the feedback files', async () => {
    const key = mediaKey();
    const u = await mkUser({ avatar: { image: `/api/media/${key}` } });
    await p.mediaHash.create({ data: { key, kind: 'upload', ownerId: u.id, refType: 'avatar' } });
    await p.passwordReset.create({ data: { userId: u.id, tokenHash: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 3600e3) } });
    await p.emailVerification.create({ data: { userId: u.id, tokenHash: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 3600e3) } });
    const fb = await p.feedback.create({ data: { id: `${TAG}${seq++}`, projectKey: 'bmm', kind: 'crash', userId: u.id, attachments: [{ key: `feedback/bmm/${TAG}x/0-crash.zip`, name: 'crash.zip', size: 10 }, { key: `feedback/bmm/${TAG}x/1-log.txt`, name: 'log.txt', size: 4 }] } });

    const deleted = [];
    await anonymiseAccount(p, { id: u.id, email: u.email }, { removeObject: async (k) => { deleted.push(k); } });

    assert.equal(await p.passwordReset.count({ where: { userId: u.id } }), 0, 'a password-reset row outlived the account');
    assert.equal(await p.emailVerification.count({ where: { userId: u.id } }), 0, 'an e-mail confirmation row outlived the account');
    assert.ok(deleted.includes(key), 'the uploaded avatar stayed in object storage');
    assert.equal(await p.mediaHash.count({ where: { key } }), 0);
    assert.ok(deleted.includes(`feedback/bmm/${TAG}x/0-crash.zip`) && deleted.includes(`feedback/bmm/${TAG}x/1-log.txt`), 'feedback attachments stayed in object storage');
    assert.deepEqual((await p.feedback.findUnique({ where: { id: fb.id } })).attachments, []);
  });

  test('a picture that is not theirs is left alone', async () => {
    const owner = await mkUser();
    const key = mediaKey();
    // The owner's upload — a blog picture, say: nobody's avatar, so only the OWNERSHIP check
    // stands between it and the erasure below.
    await p.mediaHash.create({ data: { key, kind: 'upload', ownerId: owner.id, refType: 'blog' } });
    // The erased account points its avatar at it: allowed by the avatar rule (any /api/media
    // path), and not a licence to delete it.
    const borrower = await mkUser({ avatar: { image: `/api/media/${key}` } });
    const deleted = [];
    await anonymiseAccount(p, { id: borrower.id, email: borrower.email }, { removeObject: async (k) => { deleted.push(k); } });
    assert.deepEqual(deleted, []);
    assert.equal(await p.mediaHash.count({ where: { key } }), 1);
  });

  test('their own upload that another account also uses stays too', async () => {
    const key = mediaKey();
    const u = await mkUser({ avatar: { image: `/api/media/${key}` } });
    await p.mediaHash.create({ data: { key, kind: 'upload', ownerId: u.id, refType: 'avatar' } });
    await mkUser({ avatar: { image: `/api/media/${key}` } });
    const deleted = [];
    await anonymiseAccount(p, { id: u.id, email: u.email }, { removeObject: async (k) => { deleted.push(k); } });
    assert.ok(!deleted.includes(key));
  });
});
