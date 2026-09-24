// O1 (SECURITY_SUMMARY §9): a private catalogue's share key, handed to a reader it admitted
// WITHOUT the key.
//
// `catalogGate` admits a reader to a private catalogue by the key (`?k=`) or by its access
// list (an IP, a creator id, an account). `GET /c/:slug` answered with the shared serialiser,
// which named `shareKey` — so a whitelisted reader who never held the link received it, and
// could pass it to anybody. The key is now only on the owner's own routes.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the catalogue share-key test';
process.env.JWT_SECRET ||= 'catalog-sharekey-secret';

const MAIL = '@catalog-sharekey.test';
let p, app, jwt, owner, cat;
const shareKey = crypto.randomBytes(12).toString('base64url');
const WL_IP = '203.0.113.77';

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/catalogs.mjs')).default);
  await app.ready();
  owner = await p.user.create({ data: { email: `owner-${Date.now()}${MAIL}`, displayName: 'cat owner', emailVerified: true, status: 'active' } });
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  cat = await p.communityCatalog.create({ data: {
    name: `sharekey cat ${stamp}`, slug: `sharekey-${stamp}`, ownerId: owner.id, mode: 'managed', kinds: ['app'],
    visibility: 'private', listed: false, status: 'ACTIVE', shareKey,
    // The reader below is admitted by IP, never having been given the link.
    access: { ips: [WL_IP] },
  } });
});

after(async () => {
  if (!RUN) return;
  await p.communityCatalog.deleteMany({ where: { ownerId: owner?.id || '-' } });
  await p.session.deleteMany({ where: { userId: owner?.id || '-' } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

describe('a private catalogue’s share key (O1)', { skip }, () => {
  test('a reader admitted by the access list reads the catalogue but not its key', async () => {
    const r = await app.inject({ method: 'GET', url: `/c/${cat.slug}`, headers: { 'x-forwarded-for': WL_IP } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().catalog.slug, cat.slug);
    assert.ok(!r.body.includes(shareKey), 'the share key was handed to a reader who never held it');
    assert.equal('shareKey' in r.json().catalog, false);
  });

  test('a stranger is still refused', async () => {
    const r = await app.inject({ method: 'GET', url: `/c/${cat.slug}`, headers: { 'x-forwarded-for': '198.51.100.1' } });
    assert.equal(r.statusCode, 403);
  });

  test('the owner still gets it, on their own routes', async () => {
    const s = await p.session.create({ data: { userId: owner.id }, select: { id: true } });
    const cookie = `bcw_session=${jwt.sign({ uid: owner.id, role: owner.role, sid: s.id }, process.env.JWT_SECRET)}`;
    const list = await app.inject({ method: 'GET', url: '/me/catalogs', headers: { cookie } });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().catalogs.find((c) => c.id === cat.id)?.shareKey, shareKey);
    const one = await app.inject({ method: 'GET', url: `/me/catalogs/${cat.id}`, headers: { cookie } });
    assert.equal(one.json().catalog.shareKey, shareKey);
  });
});
