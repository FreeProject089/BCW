// F23-6 (round 1 owner card, fixed in round 2 on Sept 24 2026): a creator id banned in one
// spelling was served in another.
//
// A Creator ID is the hex of an ed25519 public key, so `ABCD…` and `abcd…` are one identity.
// The catalogue gate (lib.mjs accessListMatches) and the site ban (siteban.mjs) compare it in
// one spelling since F8-2; the REPO gate in routes/hosting-content.mjs kept its own copy of the
// rule with an exact `includes`, and looked the CreatorLink up with the raw header. So a banned
// BMM flipped the case of its own id and two gates missed at once: the key ban, and the account
// ban (the id no longer resolved to the account, and a BMM sync carries no session).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxVerdict, resolveIdentity } from '../src/routes/hosting-content.mjs';

const CID = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';
const repo = { settings: {} };
const req = (h = {}) => ({ headers: h, query: {}, ip: '203.0.113.9' });
const ident = (creatorId) => ({ creatorId, userId: null, discordId: null });

test('a key ban holds whatever the spelling, on both sides', () => {
  for (const [stored, sent] of [[CID, CID.toUpperCase()], [CID.toUpperCase(), CID], [CID, ` ${CID} `]]) {
    const v = sandboxVerdict(repo, req(), [{ bannedKeys: [stored] }], ident(sent));
    assert.equal(v.reason, 'banned', `stored ${stored.slice(0, 6)}… sent ${sent.slice(0, 7)}… was served`);
  }
  // Control: another id is not banned.
  assert.equal(sandboxVerdict(repo, req(), [{ bannedKeys: [CID] }], ident('ff'.repeat(32))).ok, true);
});

test('a key whitelist admits either spelling, and only that id', () => {
  const pol = [{ whitelistOnly: true, whitelistKeys: [CID.toUpperCase()] }];
  assert.equal(sandboxVerdict(repo, req(), pol, ident(CID)).ok, true);
  assert.equal(sandboxVerdict(repo, req(), pol, ident('ff'.repeat(32))).reason, 'not_whitelisted');
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the identity lookup test';
const TAG = `pentestc-f236-${Date.now()}`;
let p, user;

describe('the account behind a creator id resolves in either spelling (db)', { skip }, () => {
  before(async () => {
    const lib = await import('../src/lib/lib.mjs');
    p = await lib.db();
    user = await p.user.create({ data: { email: `${TAG}@bettercommunity.invalid`, displayName: TAG } });
    await p.creatorLink.create({ data: { creatorId: CID, userId: user.id, unlinkableAt: new Date() } });
  });
  after(async () => {
    await p.creatorLink.deleteMany({ where: { userId: user.id } });
    await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await p?.$disconnect?.();
  });

  test('upper case resolves the lower-case link; a wildcard resolves nothing', async () => {
    assert.equal((await resolveIdentity(p, req({ 'x-creator-id': CID.toUpperCase() }))).userId, user.id);
    assert.equal((await resolveIdentity(p, req({ 'x-creator-id': CID }))).userId, user.id, 'control');
    assert.equal((await resolveIdentity(p, req({ 'x-creator-id': '%' }))).userId, null, 'a wildcard named an account');
  });
});
