// O2 (SECURITY_SUMMARY §9): `GET /admin/settings` filtered secrets by row NAME only.
//
// SECRET_SETTING_KEYS drops the rows that are credentials whole (bot token, Ko-fi token…),
// but a credential NESTED inside a value — the codegraph webhook `secret` beside its `url` —
// or pasted into a free-text setting went to every ADMIN whole. Now every value goes through
// stripSecrets. The search engines' verification tokens are public by design (they are in
// every page's HTML) and look exactly like a random key, so they are named and kept.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the admin settings secrets test';
process.env.JWT_SECRET ||= 'admin-settings-secrets-secret';

const MAIL = '@admin-settings-secrets.test';
const K_NESTED = `secapi.test.codegraph.${Date.now()}`;
const K_TEXT = `secapi.test.note.${Date.now()}`;
// Joined at run time: no secret-shaped literal in the source (the CI secret scan).
const WEBHOOK_SECRET = 'whsec_' + 'AbCdEf0123456789GhIjKl';
const STRIPE = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0'].join('_');
const VERIFY = 'rXOxyZounnZasA8Z7oaD3c14JdjS9aKSWvsR1EbUSIQ';
let p, app, jwt, admin, savedVerify;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  savedVerify = await p.adminSetting.findUnique({ where: { key: 'seo.googleVerify' } });
  await p.adminSetting.create({ data: { key: K_NESTED, value: { url: 'https://example.test/hook', secret: 'plain-words-but-named-secret', events: ['push'] } } });
  await p.adminSetting.create({ data: { key: K_TEXT, value: { note: `the stripe key is ${STRIPE} do not share`, signing: WEBHOOK_SECRET } } });
  if (!savedVerify) await p.adminSetting.create({ data: { key: 'seo.googleVerify', value: VERIFY } });
  admin = await p.user.create({ data: { email: `admin-${Date.now()}${MAIL}`, displayName: 'settings admin', role: 'ADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.adminSetting.deleteMany({ where: { key: { in: [K_NESTED, K_TEXT] } } });
  if (!savedVerify) await p.adminSetting.deleteMany({ where: { key: 'seo.googleVerify' } });
  await p.session.deleteMany({ where: { userId: admin?.id || '-' } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

describe('GET /admin/settings strips secrets from every value (O2)', { skip }, () => {
  test('a nested secret field, a secret-shaped value and a key quoted in prose never leave', async () => {
    const s = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
    const cookie = `bcw_session=${jwt.sign({ uid: admin.id, role: 'ADMIN', sid: s.id }, process.env.JWT_SECRET)}`;
    const r = await app.inject({ method: 'GET', url: '/admin/settings', headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(!r.body.includes('plain-words-but-named-secret'), 'a field NAMED secret reached the admin');
    assert.ok(!r.body.includes(WEBHOOK_SECRET), 'a webhook-secret-shaped value reached the admin');
    assert.ok(!r.body.includes(STRIPE), 'a Stripe key quoted in a text reached the admin');
    const st = r.json().settings;
    // What is not a secret is untouched, so the screens that edit these still work.
    assert.equal(st[K_NESTED].url, 'https://example.test/hook');
    assert.deepEqual(st[K_NESTED].events, ['push']);
    assert.match(st[K_TEXT].note, /^the stripe key is \[redacted\] do not share$/);
    // Public by design, and exactly the shape the high-entropy rule would drop.
    assert.equal(typeof st['seo.googleVerify'], 'string');
    assert.ok(st['seo.googleVerify'].length > 0);
  });
});
