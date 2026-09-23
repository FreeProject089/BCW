// A repo row carries five secrets. `ser()` stripped one of them (pentest 2026-09-23).
//
// `ServerRepo` holds, side by side: `dashPassword` (argon2, the login-less dashboard),
// `syncPasswordHash` (argon2, the download password BMM presents), `shareKey` (the whole of
// `/r/<id>?k=…`, which is how a private repo is shared), `accessEmails` (collaborators'
// addresses) and `settings.access.keys` (the sandbox keys a whitelisted client presents).
//
// `ser()` spread the row and removed `dashPassword` alone — with a comment saying it is
// removed "so it can never leak to a client". The other four rode out with it, to the owner
// AND, through `GET /admin/repos`, to every MOD on the site: a moderation tier that is not
// supposed to be able to open a private repo, holding the key to every one of them.
//
// A spread is not an allowlist. These two tests are the standing statement of which columns
// may leave, so the next column added to ServerRepo has to be thought about.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the repo-credential tests';
process.env.JWT_SECRET ||= 'repo-credentials-secret';

let p, app, jwt;
const MAIL = '@repocred.test';
let seq = 0;
const made = [];

const CANARIES = {
  shareKey: 'SHAREKEY-CANARY-0001',
  syncPasswordHash: '$argon2id$v=19$SYNCHASH-CANARY-0002',
  dashPassword: '$argon2id$v=19$DASHHASH-CANARY-0003',
  accessKey: 'ACCESSKEY-CANARY-0004',
  accessIp: '203.0.113.7',
};

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/repos.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.serverRepo.deleteMany({ where: { OR: [{ id: { in: made } }, { ownerId: { in: ids } }] } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `rc-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
async function mkRepo(owner) {
  const r = await p.serverRepo.create({ data: {
    name: `rc repo ${seq}`, ownerId: owner.id, hosted: true, status: 'ONLINE',
    repoUrl: 'https://example.org/r.json', contactEmail: `c${MAIL}`,
    shareKey: CANARIES.shareKey, syncPasswordHash: CANARIES.syncPasswordHash, dashPassword: CANARIES.dashPassword,
    accessEmails: [`collab${MAIL}`],
    settings: { access: { whitelistEnabled: true, ips: [CANARIES.accessIp], keys: [CANARIES.accessKey] }, bans: { ips: [], keys: [] } },
    listed: false, published: true,
  } });
  made.push(r.id);
  return r;
}

describe('a repo row is served by allowlist, not by spread', { skip }, () => {
  test('a MOD listing every repo receives none of their credentials', async () => {
    const victim = await mkUser();
    const mod = await mkUser({ role: 'MOD', totpEnabled: true });
    await mkRepo(victim);
    const r = await app.inject({ method: 'GET', url: '/admin/repos', headers: { cookie: await cookieFor(mod) } });
    assert.equal(r.statusCode, 200, r.body);
    for (const [name, value] of Object.entries(CANARIES)) {
      assert.ok(!r.body.includes(value), `GET /admin/repos handed a MOD the ${name} of somebody else's repo`);
    }
    assert.ok(!r.body.includes(`collab${MAIL}`), 'GET /admin/repos handed a MOD a collaborator address');
    // …while still being useful: the staff screen is told the facts, not the secrets.
    const one = r.json().repos.find((x) => x.id === made[made.length - 1]);
    assert.ok(one, 'the repo is in the staff list');
    assert.equal(one.hasDashPassword, true);
    assert.equal(one.hasSyncPassword, true);
    assert.equal(one.hasShareKey, true);
  });

  test('the owner gets their own share key, and never a password hash', async () => {
    const owner = await mkUser();
    await mkRepo(owner);
    const r = await app.inject({ method: 'GET', url: '/me/repos', headers: { cookie: await cookieFor(owner) } });
    assert.equal(r.statusCode, 200, r.body);
    // Theirs to have: it is how they build the private link, and the whitelist is theirs.
    assert.ok(r.body.includes(CANARIES.shareKey), 'the owner lost the share key they need to share the repo');
    assert.ok(r.body.includes(CANARIES.accessKey), 'the owner lost their own sandbox access keys');
    // Never theirs to have: a password hash is for verifying, not for showing. An argon2
    // hash in a browser response is a hash in a cache, a bug report and a screenshot.
    assert.ok(!r.body.includes(CANARIES.syncPasswordHash), 'GET /me/repos returned the sync password hash');
    assert.ok(!r.body.includes(CANARIES.dashPassword), 'GET /me/repos returned the dashboard password hash');
    const one = r.json().repos[0];
    assert.equal(one.hasSyncPassword, true, 'the fact is reported even though the hash is not');
  });
});
