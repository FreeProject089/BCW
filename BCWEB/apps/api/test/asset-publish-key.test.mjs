// assetskey (agent-assets-key): the CI publish key for platform-asset slots.
//
// What is pinned, over HTTP (DATABASE_URL-gated like every route test), with a storage DOUBLE
// in place of the object store (CI has none; `_setAssetStoreForTests`):
//   · who may mint (ADMIN-tier with manage_assets and a fresh TOTP; not a delegated grantee,
//     not /me/api-keys), and that the row holds a hash and the bound slots, never the secret;
//   · the door: a key without `assets:publish` → 403, a slot not bound to the key → 403, an
//     expired or revoked key → 401, an owner who lost the power → 403, and the key opens no
//     admin route at all;
//   · the upload: size cap per slot, storageKey confined to the slot's `ci-` prefix, SHA-256
//     verified against the stored bytes BEFORE the slot moves — a mismatch deletes the new
//     object and the slot keeps serving the old file; both outcomes audit-chained;
//   · the secret never reaches the log, the audit chain, an error body or a listing.
//
// The slots are real rows (`bmm-update-json`, `bmm-laya-offline`), so whatever a developer's
// database holds for them is snapshotted first and put back afterwards.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

delete process.env.REDIS_URL;
process.env.JWT_SECRET ||= 'asset-publish-key-test-secret';

const { CI_ASSET_SLOTS, ASSET_PUBLISH_SCOPE, CI_KEY_MAX_DAYS, hashStoredObject } = await import('../src/lib/asset-publish.mjs');
const { API_SCOPES } = await import('../src/lib/lib.mjs');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// RFC 6238, the same arithmetic lib/totp.mjs verifies — written out here so the test does not
// borrow the implementation it is checking.
function totpNow(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const out = [];
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | A.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(out)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

describe('asset-publish: the pure half', () => {
  test('the scope is NOT a public-API scope, so /me/api-keys can never mint it', () => {
    assert.equal(ASSET_PUBLISH_SCOPE, 'assets:publish');
    assert.ok(!Object.keys(API_SCOPES).includes(ASSET_PUBLISH_SCOPE));
  });
  test('the three BMM slots, each with its own ceiling; the pack slot fits the 327 MB pack', () => {
    assert.deepEqual(Object.keys(CI_ASSET_SLOTS).sort(), ['bmm-laya-offline', 'bmm-update-json', 'bmm-update-manifest']);
    assert.ok(CI_ASSET_SLOTS['bmm-laya-offline'].maxBytes >= 327125837);
    assert.ok(CI_ASSET_SLOTS['bmm-update-json'].maxBytes <= 8 * 1024 ** 2, 'a manifest slot cannot hold a model');
    assert.ok(CI_KEY_MAX_DAYS <= 90);
  });
  test('hashStoredObject streams: chunks in, one hash and the byte count out', async () => {
    const parts = [Buffer.from('abc'), Buffer.from('def'), new Uint8Array([1, 2, 3])];
    const r = await hashStoredObject(async () => ({ body: Readable.from(parts) }), 'k');
    assert.equal(r.size, 9);
    assert.equal(r.sha256, sha(Buffer.concat([Buffer.from('abcdef'), Buffer.from([1, 2, 3])])));
  });
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the asset-publish route tests';
const MAIL = '@asset-publish-key.test';
const SLOTS = ['bmm-update-json', 'bmm-laya-offline'];

describe('asset-publish: routes over HTTP', { skip }, () => {
  let app, p, admin, grantee, cookieAdmin, cookieGrantee, totpSecret, snapshot = [];
  const logs = [];
  const objects = new Map();   // the storage double
  const deleted = [];
  const secrets = [];          // every secret minted here, checked against the log at the end

  before(async () => {
    if (!RUN) return;
    const lib = await import('../src/lib/lib.mjs');
    p = await lib.db();
    const jwt = (await import('jsonwebtoken')).default;
    snapshot = await p.platformAsset.findMany({ where: { key: { in: SLOTS } } });
    await p.platformAsset.deleteMany({ where: { key: { in: SLOTS } } });
    totpSecret = (await import('../src/lib/totp.mjs')).generateSecret();
    admin = await p.user.create({ data: { email: `a-${Date.now()}${MAIL}`, displayName: 'assets admin', role: 'ADMIN', totpEnabled: true, totpSecret, emailVerified: true, status: 'active' } });
    grantee = await p.user.create({ data: { email: `g-${Date.now()}${MAIL}`, displayName: 'assets grantee', role: 'USER', permissions: ['manage_assets'], totpEnabled: true, totpSecret, emailVerified: true, status: 'active' } });
    const sa = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
    const sg = await p.session.create({ data: { userId: grantee.id }, select: { id: true } });
    cookieAdmin = `bcw_session=${jwt.sign({ uid: admin.id, role: 'ADMIN', sid: sa.id }, process.env.JWT_SECRET)}`;
    cookieGrantee = `bcw_session=${jwt.sign({ uid: grantee.id, role: 'USER', sid: sg.id }, process.env.JWT_SECRET)}`;

    const routes = await import('../src/routes/platform-assets.mjs');
    routes._setAssetStoreForTests({
      presignPut: async (key, { contentType, size }) => `https://store.invalid/${key}?type=${encodeURIComponent(contentType)}&size=${size}`,
      getObject: async (key) => {
        if (!objects.has(key)) throw new Error('NoSuchKey');
        const b = objects.get(key);
        return { body: Readable.from([b.subarray(0, 3), b.subarray(3)]), contentType: 'application/octet-stream', length: b.length };
      },
      deleteObject: async (key) => { deleted.push(key); objects.delete(key); },
    });
    const Fastify = (await import('fastify')).default;
    app = Fastify({ logger: { level: 'trace', stream: { write: (l) => logs.push(l) } } });
    await app.register((await import('@fastify/cookie')).default);
    await app.register(routes.default);
    await app.register((await import('../src/routes/api-keys.mjs')).default);
    await app.ready();
  });

  after(async () => {
    if (!RUN) return;
    (await import('../src/routes/platform-assets.mjs'))._setAssetStoreForTests(null);
    const ids = [admin?.id, grantee?.id].filter(Boolean);
    await p.platformAsset.deleteMany({ where: { key: { in: SLOTS } } });
    for (const row of snapshot) await p.platformAsset.create({ data: row }).catch(() => {});
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.apiKey.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });

  const inject = (method, url, { cookie, bearer, payload } = {}) => app.inject({
    method, url, payload,
    headers: { ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  });
  const mint = async (body, cookie = cookieAdmin) => {
    // An owner holds at most five live CI keys; each test starts from none of its own.
    await p.apiKey.updateMany({ where: { userId: admin.id, revokedAt: null, scopes: { has: 'assets:publish' } }, data: { revokedAt: new Date() } });
    const r = await inject('POST', '/admin/assets/ci-keys', { cookie, payload: { totp: totpNow(totpSecret), expiresInDays: 7, ...body } });
    if (r.statusCode === 201) secrets.push(r.json().secret);
    return r;
  };
  /** presign → the store receives the bytes → confirm. `declared` overrides the hash sent. */
  const publish = async (key, slot, bytes, { declared, version = '1.2.3', contentType } = {}) => {
    const ct = contentType || CI_ASSET_SLOTS[slot].types[0];
    const pre = await inject('POST', `/ci/assets/${slot}/presign`, { bearer: key, payload: { filename: `${slot}.bin`, contentType: ct, size: bytes.length, sha256: sha(bytes) } });
    if (pre.statusCode !== 200) return { pre };
    const { storageKey } = pre.json();
    objects.set(storageKey, bytes);
    const put = await inject('PUT', `/ci/assets/${slot}`, { bearer: key, payload: { filename: `${slot}.bin`, contentType: ct, size: bytes.length, sha256: declared || sha(bytes), storageKey, version } });
    return { pre, put, storageKey };
  };

  test('minting: ADMIN + manage_assets + a fresh TOTP; a delegated grantee and /me/api-keys cannot', async () => {
    assert.equal((await mint({ slots: ['bmm-update-json'] }, cookieGrantee)).statusCode, 403, 'manage_assets without the ADMIN role');
    assert.equal((await inject('POST', '/admin/assets/ci-keys', { cookie: cookieAdmin, payload: { slots: ['bmm-update-json'], expiresInDays: 7, totp: '000000' } })).statusCode, 401);
    assert.equal((await mint({ slots: ['bmm-installer'] })).statusCode, 400, 'a slot outside the CI registry');
    assert.equal((await mint({ slots: ['bmm-update-json'], expiresInDays: CI_KEY_MAX_DAYS + 1 })).statusCode, 400, 'longer than the max lifetime');
    assert.equal((await inject('POST', '/admin/assets/ci-keys', { cookie: cookieAdmin, payload: { slots: ['bmm-update-json'], totp: totpNow(totpSecret) } })).statusCode, 400, 'no expiry = no key');
    const me = await inject('POST', '/me/api-keys', { cookie: cookieAdmin, payload: { scopes: ['assets:publish'], totp: totpNow(totpSecret) } });
    assert.equal(me.statusCode, 400);
    assert.equal(me.json().error, 'no_scopes');

    const r = await mint({ slots: ['bmm-update-json', 'bmm-update-json'], label: 'resign' });
    assert.equal(r.statusCode, 201);
    const { key, secret } = r.json();
    assert.match(secret, /^bck_/);
    assert.deepEqual(key.assetSlots, ['bmm-update-json'], 'deduplicated');
    const row = await p.apiKey.findUnique({ where: { id: key.id } });
    assert.deepEqual(row.scopes, ['assets:publish']);
    assert.notEqual(row.hash, secret);
    assert.ok(!JSON.stringify(row).includes(secret), 'the row never holds the secret');
    assert.ok(row.expiresAt > new Date() && row.expiresAt < new Date(Date.now() + 8 * 86400_000));
    const list = await inject('GET', '/admin/assets/ci-keys', { cookie: cookieAdmin });
    assert.equal(list.statusCode, 200);
    assert.ok(!list.body.includes(secret), 'the listing shows the prefix, never the secret');
    assert.ok(list.json().keys.some((k) => k.id === key.id && k.prefix === secret.slice(0, 12)));
  });

  test('wrong scope → 403: an ordinary API key of the same admin cannot publish', async () => {
    const plain = `bck_${crypto.randomBytes(32).toString('base64url')}`;
    secrets.push(plain);
    const { hashApiKey } = await import('../src/lib/lib.mjs');
    await p.apiKey.create({ data: { userId: admin.id, label: 'plain', prefix: plain.slice(0, 12), hash: hashApiKey(plain), scopes: ['account:read'], assetSlots: ['bmm-update-json'] } });
    const r = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: plain, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha('{}') } });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error, 'insufficient_scope');
  });

  test('slot not in the allowlist → 403, on both routes, and for a slot outside the registry', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json'] })).json();
    const pre = await inject('POST', '/ci/assets/bmm-laya-offline/presign', { bearer: secret, payload: { filename: 'x.zip', contentType: 'application/zip', size: 10, sha256: sha('x') } });
    assert.equal(pre.statusCode, 403);
    assert.equal(pre.json().error, 'slot_not_allowed');
    const put = await inject('PUT', '/ci/assets/bmm-laya-offline', { bearer: secret, payload: { filename: 'x.zip', contentType: 'application/zip', size: 1, sha256: sha('x'), storageKey: 'platform/bmm-laya-offline/ci-1-x.zip' } });
    assert.equal(put.statusCode, 403);
    assert.equal((await inject('POST', '/ci/assets/bmm-installer/presign', { bearer: secret, payload: {} })).statusCode, 403);
  });

  test('expired or revoked → 401 invalid_key, and a revoke is audit-chained', async () => {
    const { key, secret } = (await mint({ slots: ['bmm-update-json'] })).json();
    await p.apiKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha('{}') } });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().error, 'invalid_key');

    const k2 = (await mint({ slots: ['bmm-update-json'] })).json();
    assert.equal((await inject('POST', `/admin/assets/ci-keys/${k2.key.id}/revoke`, { cookie: cookieAdmin })).statusCode, 200);
    assert.equal((await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: k2.secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha('{}') } })).statusCode, 401);
    assert.ok(await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'assets.ci_key_revoked' } }));
    assert.equal((await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: 'bck_not-a-real-key-at-all-000000000', payload: {} })).statusCode, 401);
  });

  test('the key opens no admin route: list, delete, JSON edit and the session presign all refuse it', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json'] })).json();
    for (const [m, u] of [['GET', '/admin/assets'], ['DELETE', '/admin/assets/bmm-update-json'], ['PUT', '/admin/assets/json/bmm-update-json'],
      ['POST', '/admin/assets/presign'], ['PUT', '/admin/assets/file/bmm-update-json'], ['GET', '/admin/assets/ci-keys'], ['POST', '/admin/assets/ci-keys'], ['GET', '/v1/account']]) {
      const r = await inject(m, u, { bearer: secret, payload: m === 'GET' || m === 'DELETE' ? undefined : {} });
      assert.ok([401, 403, 503].includes(r.statusCode), `${m} ${u} answered ${r.statusCode}`);
    }
  });

  test('happy path: presign, upload, confirm; the slot serves the bytes; the publish is audit-chained', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json', 'bmm-laya-offline'] })).json();
    const bytes = Buffer.from(JSON.stringify({ version: '1.2.3', signed: true }));
    const { pre, put, storageKey } = await publish(secret, 'bmm-update-json', bytes);
    assert.equal(pre.statusCode, 200);
    assert.match(storageKey, /^platform\/bmm-update-json\/ci-/);
    assert.equal(put.statusCode, 200, put.body);
    assert.equal(put.json().sha256, sha(bytes));
    const row = await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } });
    assert.equal(row.storageKey, storageKey);
    assert.equal(row.sha256, sha(bytes));
    assert.equal(row.version, '1.2.3');
    assert.equal(Number(row.size), bytes.length);
    const served = await inject('GET', '/assets/bmm-update-json');
    assert.equal(served.statusCode, 200);
    assert.equal(served.body, bytes.toString());
    const audit = await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'assets.ci_publish' }, orderBy: { createdAt: 'desc' } });
    assert.ok(audit && audit.detail.includes(sha(bytes)) && audit.detail.includes('bmm-update-json'));
    assert.ok(audit.hash && audit.prevHash, 'on the HMAC chain');

    // A second publish replaces the first and removes its object.
    const next = Buffer.from('{"version":"1.2.4"}');
    const second = await publish(secret, 'bmm-update-json', next, { version: '1.2.4' });
    assert.equal(second.put.statusCode, 200);
    assert.ok(deleted.includes(storageKey), 'the previous object is deleted after the switch');
  });

  test('hash mismatch → 422, the new object is deleted, the slot keeps its old file', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json'] })).json();
    const before = await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } });
    assert.ok(before?.storageKey, 'the happy path left a file in the slot');
    const evil = Buffer.from('{"version":"9.9.9","tampered":true}');
    const { put, storageKey } = await publish(secret, 'bmm-update-json', evil, { declared: sha('{"version":"9.9.9"}') });
    assert.equal(put.statusCode, 422);
    assert.equal(put.json().error, 'hash_mismatch');
    const afterRow = await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } });
    assert.equal(afterRow.storageKey, before.storageKey);
    assert.equal(afterRow.sha256, before.sha256);
    assert.ok(!objects.has(storageKey) && objects.has(before.storageKey), 'new object gone, old one kept');
    assert.ok(await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'assets.ci_publish_rejected', detail: { contains: 'hash_mismatch' } } }));
    // A declared size that is not what arrived is refused the same way.
    const real = Buffer.from('{"a":1}');
    const pre = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha(real) } });
    objects.set(pre.json().storageKey, real);
    const sizeLie = await inject('PUT', '/ci/assets/bmm-update-json', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha(real), storageKey: pre.json().storageKey } });
    assert.equal(sizeLie.statusCode, 422);
    assert.equal(sizeLie.json().error, 'size_mismatch');
    assert.equal((await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } })).storageKey, before.storageKey);
  });

  test('the dashboard confirm honours a declared SHA-256 the same way', async () => {
    const before = await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } });
    const sk = 'platform/bmm-update-json/1-dash.json';
    objects.set(sk, Buffer.from('{"x":1}'));
    const bad = await inject('PUT', '/admin/assets/file/bmm-update-json', { cookie: cookieAdmin, payload: { filename: 'u.json', contentType: 'application/json', size: 7, storageKey: sk, sha256: sha('{"x":2}') } });
    assert.equal(bad.statusCode, 422);
    assert.equal((await p.platformAsset.findUnique({ where: { key: 'bmm-update-json' } })).storageKey, before.storageKey);
    assert.ok(!objects.has(sk));
  });

  test('per-slot size cap, content type and storageKey confinement', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json', 'bmm-laya-offline'] })).json();
    const big = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: CI_ASSET_SLOTS['bmm-update-json'].maxBytes + 1, sha256: sha('x') } });
    assert.equal(big.statusCode, 413);
    const pack = await inject('POST', '/ci/assets/bmm-laya-offline/presign', { bearer: secret, payload: { filename: 'laya-offline-1.zip', contentType: 'application/zip', size: 327125837, sha256: sha('x') } });
    assert.equal(pack.statusCode, 200, 'the real pack size fits its slot');
    const type = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: secret, payload: { filename: 'u.html', contentType: 'text/html', size: 5, sha256: sha('x') } });
    assert.equal(type.statusCode, 415);
    for (const sk of ['platform/bmm-laya-offline/ci-1-x', 'platform/bmm-update-json/1-x', 'platform/bmm-update-json/ci-../../x', 'blog/x']) {
      const r = await inject('PUT', '/ci/assets/bmm-update-json', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha('{}'), storageKey: sk } });
      assert.equal(r.statusCode, 400, sk);
    }
  });

  test('an owner who lost the power takes the key down with them', async () => {
    const { secret } = (await mint({ slots: ['bmm-update-json'] })).json();
    await p.user.update({ where: { id: admin.id }, data: { role: 'USER' } });
    try {
      const r = await inject('POST', '/ci/assets/bmm-update-json/presign', { bearer: secret, payload: { filename: 'u.json', contentType: 'application/json', size: 2, sha256: sha('{}') } });
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().error, 'owner_not_permitted');
    } finally { await p.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
  });

  test('the secret never reaches the log, the audit chain or an error body', async () => {
    assert.ok(secrets.length >= 5, 'the tests above minted keys');
    const text = logs.join('\n');
    assert.ok(text.length > 0, 'the logger was on');
    const audit = await p.auditLogEntry.findMany({ where: { actorId: admin.id }, select: { detail: true } });
    for (const s of secrets) {
      assert.ok(!text.includes(s) && !text.includes(s.slice(4)), 'a secret in the request log');
      assert.ok(!audit.some((a) => a.detail.includes(s.slice(4))), 'a secret in the audit chain');
    }
  });
});
