// The custom seed v2 (lib/config-transfer.mjs + lib/secret-guard.mjs).
//
// Runs against an in-memory stand-in for the Prisma client, so it needs no database and
// measures the same thing with or without one. Three promises are checked:
//
//   1. no secret leaves. A fake secret is planted in every place one lives on a real install
//      — the four credential rows, a nested `secret` field, secret-shaped values in free-form
//      config, credentials quoted inside prose, the telemetry service's own key — and the
//      test asserts none of those strings appears ANYWHERE in the exported bytes (the JSON and
//      the runnable script);
//   2. what is exported comes back: export → import into an empty install → export again
//      gives the same domains;
//   3. an import is checked with the live routes' schemas and refuses rather than half-writes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle, applyBundle, bundleToScript, DOMAIN_IDS, FORMAT_VERSION } from '../src/lib/config-transfer.mjs';
import { stripSecrets, secretShape, isSecretFieldName, SECRET_SETTING_KEYS } from '../src/lib/secret-guard.mjs';
import { DEFAULT_CONFIG as ONBOARDING_DEFAULT } from '../src/lib/onboarding.mjs';

// ── A tiny Prisma stand-in ────────────────────────────────────────────────────────
function table(idField) {
  const rows = [];
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => r[k] === v);
  const pick = (r, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r });
  return {
    rows,
    findMany: async ({ where, select } = {}) => rows.filter((r) => match(r, where)).map((r) => pick(r, select)),
    findUnique: async ({ where, select }) => { const r = rows.find((x) => match(x, where)); return r ? pick(r, select) : null; },
    findFirst: async ({ where, select }) => { const r = rows.find((x) => match(x, where)); return r ? pick(r, select) : null; },
    create: async ({ data }) => {
      if (idField && rows.some((x) => x[idField] === data[idField])) { const e = new Error('P2002'); e.code = 'P2002'; throw e; }
      const r = { id: `id${rows.length + 1}`, ...structuredClone(data) }; rows.push(r); return r;
    },
    update: async ({ where, data }) => { const r = rows.find((x) => match(x, where)); Object.assign(r, structuredClone(data)); return r; },
    upsert: async ({ where, create, update }) => {
      const r = rows.find((x) => match(x, where));
      if (r) { Object.assign(r, structuredClone(update)); return r; }
      const n = { id: `id${rows.length + 1}`, ...structuredClone(create) }; rows.push(n); return n;
    },
  };
}
function fakeDb() {
  return {
    adminSetting: table('key'), botGuild: table('guildId'), hostingPlan: table(), analyticsGoal: table(),
    docPage: table('slug'), faqItem: table(), badge: table('slug'), project: table('key'),
  };
}
const set = (p, key, value) => p.adminSetting.rows.push({ key, value: structuredClone(value) });

// ── Fake secrets, one per place a real one lives ─────────────────────────────────
// Assembled at run time, never written whole: GitHub push protection matches the SHAPE of
// a credential (sk_live_, whsec_, AKIA, ghp_, a Discord token, a PEM header) and refused the
// push over these fixtures. The test sees exactly the same strings.
const pem = (kind, body) => ['-----BEGIN ', kind, '-----\n', body, '\n-----END ', kind, '-----'].join('');
const S = {
  botToken: ['MTA3NjQ1Njc4OTAxMjM0NTY3OA', 'GhYt9x', 'FAKEfakeFAKEfakeFAKEfakeFAKEfake12'].join('.'),
  kofiToken: 'kofi-verification-FAKE-0f1e2d3c',
  signingPem: pem('PRIVATE KEY', 'MC4CAQAwBQYDK2VwBCIEIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE'),
  attestPem: pem('EC PRIVATE KEY', 'MHcCAQEEIFAKEattestationFAKEattestationFAKEattestation0123'),
  codegraphSecret: 'cg-webhook-FAKE-secret-value',
  discordWebhook: ['https://discord.com/api', 'webhooks', '123456789012345678', 'FAKEwebhookTOKENabcdefABCDEF0123456789'].join('/'),
  kofiField: 'fake-kofi-field-token-0001',
  stripeInText: ['sk', 'live', 'FAKE51HxYzABCDEFGHIJKLMN'].join('_'),
  githubToken: ['ghp', 'FAKEfakeFAKEfakeFAKEfakeFAKEfake0123'].join('_'),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJGQUtFIn0', 'FAKEsignatureFAKEsignature'].join('.'),
  whsecInText: ['whsec', 'FAKEfakeFAKEfakeFAKEfake01'].join('_'),
  awsInValue: 'AKIA' + 'FAKEFAKEFAKEFAKE',
  randomKey: 'q7Z1xK9mP3vB8nR2tL5wY0cH4jF6dS8aG1eU3iO5pQ7rT9uV',
  pemInDoc: pem('RSA PRIVATE KEY', 'MIIEFAKEdocFAKEdocFAKEdocFAKEdoc'),
  argonInDoc: '$argon2id$v=19$m=65536,t=3,p=4$FAKEsalt$FAKEhashFAKEhash',
  botTokenInBadge: ['NzA3NjQ1Njc4OTAxMjM0NTY3OA', 'XyZ9ab', 'FAKEbadgeFAKEbadgeFAKEbadgeFAKE12'].join('.'),
  telemetryAdminKey: 'telemetry-admin-key-FAKE-000',
  studioToken: 'studio-FAKE-token-in-a-per-user-row',
};

function seededInstall() {
  const p = fakeDb();
  // 1. The credential rows.
  set(p, 'bot.token', { token: S.botToken });
  set(p, 'kofi.token', { token: S.kofiToken });
  set(p, 'backup.signingKey', { privateKey: S.signingPem, publicKey: 'pub', createdAt: '2026-01-01' });
  set(p, 'identity.attestation.privateKeyPem', S.attestPem);
  // 2. A nested secret field beside a harmless one.
  set(p, 'codegraph.settings.bmm', { url: 'https://github.com/x/y', secret: S.codegraphSecret });
  // 3. Secret-shaped values in free-form config, under innocent names.
  set(p, 'bot.config', {
    enabled: false,
    alerts: { enabled: true, channelId: '123', webhookUrl: S.discordWebhook, fallback: S.discordWebhook },
    kofi: { enabled: true, channelId: '456', verificationToken: S.kofiField },
    welcome: { joinMessage: `Welcome! (do not paste ${S.stripeInText} here)` },
    notes: [S.jwt, 'fine'],
    economy: { shop: [], season: { every: 'never' }, apiKey: S.randomKey },
  });
  set(p, 'project.bmm', { name: 'BMM', download: { url: 'https://x/y', auth: S.githubToken } });
  set(p, 'site.home', { text: { 'home.hero.title': { en: `Hi ${S.whsecInText}` } }, sections: {}, variant: 'v1', suite: {}, customSections: [] });
  set(p, 'charity.config', { enabled: true, percent: 10, currency: 'chf', association: S.awsInValue });
  // 4. Per-user rows and runtime state that must not travel at all.
  set(p, 'studio.components:u1', { components: [{ token: S.studioToken }] });
  set(p, 'onboarding:u1', { v: 1, state: 'pending', done: [], skipped: [], interests: [] });
  // 5. Credentials quoted inside prose and inside a model row.
  p.docPage.rows.push({ id: 'd1', slug: 'keys', title: 'Keys', body: `Never commit this:\n${S.pemInDoc}\nor ${S.argonInDoc}`, order: 0, published: true, commentsPublic: false });
  p.badge.rows.push({ id: 'b1', slug: 'egg', name: 'Egg', description: '', iconType: 'lucide', icon: 'Egg', color: '#fff', grant: 'manual', trigger: null, rule: null, earnMessage: `psst ${S.botTokenInBadge}`, priority: 0, active: true });
  return p;
}

const telemetry = { read: async () => ({ storageLimitMb: 2048, retentionDays: 30, deleteDelayH: 24, adminKey: S.telemetryAdminKey }) };

describe('no secret leaves', () => {
  test('none of the planted secrets appears anywhere in the exported bytes', async () => {
    const p = seededInstall();
    const bundle = await buildBundle({ p, telemetry }, DOMAIN_IDS, { generatedAtIso: '2026-09-22T00:00:00Z' });
    const bytes = JSON.stringify(bundle) + bundleToScript(bundle);
    for (const [name, secret] of Object.entries(S)) {
      assert.ok(!bytes.includes(secret), `${name} leaked into the export`);
      // A distinctive slice too, so a partially mangled copy is caught as well.
      assert.ok(!bytes.includes(secret.slice(4, 24)), `${name} (fragment) leaked into the export`);
    }
  });

  test('the credential rows are listed as excluded, the stripped fields as redacted', async () => {
    const bundle = await buildBundle({ p: seededInstall(), telemetry });
    const excluded = bundle.manifest.excluded.map((e) => e.key);
    for (const k of SECRET_SETTING_KEYS) assert.ok(excluded.includes(k), `${k} not reported as excluded`);
    assert.ok(excluded.includes('studio.components:u1') && excluded.includes('onboarding:u1'));
    const redacted = bundle.manifest.redacted.map((r) => `${r.key}|${r.path}`);
    assert.ok(redacted.includes('codegraph.settings.bmm|secret'));
    assert.ok(redacted.some((r) => r.startsWith('bot.config|alerts.webhookUrl')));
    assert.ok(redacted.some((r) => r.startsWith('bot.config|welcome.joinMessage')), 'embedded key not reported');
    // Prose keeps its words; only the key is replaced.
    const doc = bundle.domains.content.rows.docPage[0];
    assert.match(doc.body, /Never commit this:/);
    assert.match(doc.body, /\[redacted\]/);
  });

  test('the telemetry service export carries its limits and nothing else', async () => {
    const bundle = await buildBundle({ p: fakeDb(), telemetry }, ['telemetry']);
    assert.deepEqual(bundle.domains.telemetry.service, { storageLimitMb: 2048, retentionDays: 30, deleteDelayH: 24 });
  });

  test('detection is by shape and structure, not only by name', () => {
    // A value that looks like a key is removed whatever it is called…
    assert.equal(secretShape(S.stripeInText), 'stripe_secret');
    assert.equal(secretShape(S.randomKey), 'high_entropy');
    assert.equal(stripSecrets({ harmless: S.discordWebhook }).removed[0].reason, 'discord_webhook_url');
    // …and an innocent value under a secret name is removed too…
    assert.equal(isSecretFieldName('client_secret'), true);
    assert.equal(isSecretFieldName('webhookUrl'), true);
    // …while ordinary ids, URLs and settings ABOUT credentials stay.
    for (const ok of ['cmtj9ruqp0004c7o121sajwso', 'https://github.com/FreeProject089/BetterModsManager', '3f2a8c1e-4b5d-4e6f-9a7b-1c2d3e4f5a6b', '/api/media/blog/abc.png'])
      assert.equal(secretShape(ok), null, ok);
    assert.deepEqual(stripSecrets({ requirePassword: true, tokenTtlDays: 30 }).removed, []);
  });
});

// ── Round trip ────────────────────────────────────────────────────────────────────
function cleanInstall() {
  const p = fakeDb();
  set(p, 'bot.config', { enabled: true, alerts: { enabled: false, channelId: '' }, economy: { shop: [{ id: 'vip', price: 100 }], season: { every: 'weekly', hour: 3 } } });
  set(p, 'bot.i18n', { fr: { 'welcome.title': 'Bienvenue' } });
  set(p, 'hosting.reservedFreeGB', 5);
  set(p, 'pricing.perGBCents', 30);
  set(p, 'features.paymentsEnabled', true);
  set(p, 'telemetry.storageLimitGB', 2);
  set(p, 'analytics.retention', { pageviewDays: 0, interactionDays: 30, vitalDays: 30, loginDays: 30, errorDays: 30, replayDays: 30 });
  set(p, 'alerts.thresholds', { cpuPct: 90 });
  set(p, 'site.theme', { accent: '#112233', accent2: '#445566', mode: 'dark', preset: '', light: null, dark: null, shared: null, gradients: null, logoLight: '', logoDark: '' });
  set(p, 'nav.config', { enabled: true, items: [{ type: 'link', label: 'Docs', to: '/docs' }] });
  set(p, 'footer.config', { enabled: false, columns: [] });
  set(p, 'seo.pages', [{ path: '/about', title: 'About' }]);
  set(p, 'charity.config', { enabled: true, percent: 12, currency: 'eur', association: 'Red Cross' });
  set(p, 'reports.config', { imageMaxMB: 5, maxImagesPerMsg: 4 });
  set(p, 'myo.consultationCents', 2500);
  set(p, 'guide.custom', [{ id: 'hello', heading: { en: 'H' }, title: { en: 'T' }, body: { en: 'B' } }]);
  set(p, 'project.bmm', { name: 'BMM', tagline: 'Mods' });
  set(p, 'codegraph.settings.bmm', { url: 'https://github.com/x/y' });
  set(p, 'onboarding.config', ONBOARDING_DEFAULT);
  p.botGuild.rows.push({ guildId: '147398111627169383', memberMode: 'none', logChannelId: null, storeLogs: false, storageQuotaBytes: 0n });
  p.hostingPlan.rows.push({ id: 'h1', name: 'Repo 5GB', storageGB: 5, uploadLimitKbps: 2048, cpuShare: 0.5, priceMonthlyCents: 300, active: true, boostsPerPeriod: 0, boostPeriodMonths: 1, boostDays: 7 });
  p.hostingPlan.rows.push({ id: 'h2', name: 'Admin grant', storageGB: 1, uploadLimitKbps: 1, cpuShare: 0.5, priceMonthlyCents: 0, active: false, boostsPerPeriod: 0, boostPeriodMonths: 1, boostDays: 7 });
  p.analyticsGoal.rows.push({ id: 'g1', name: 'Signup', kind: 'submit', path: '/auth', label: null, target: 100, active: true });
  p.docPage.rows.push({ id: 'd1', slug: 'intro', title: 'Intro', titleFr: 'Intro FR', category: 'General', body: '# Hi', order: 1, published: true, commentsPublic: false });
  p.faqItem.rows.push({ id: 'f1', question: 'What?', answer: 'This.', category: 'General', order: 0, published: true });
  p.badge.rows.push({ id: 'b1', slug: 'early', name: 'Early', description: 'x', iconType: 'lucide', icon: 'Star', color: '#f59e0b', grant: 'manual', trigger: null, rule: null, earnMessage: '', priority: 1, active: true });
  return p;
}

describe('round trip', () => {
  test('export → import into an empty install → export again gives the same domains', async () => {
    const a = cleanInstall();
    const first = await buildBundle({ p: a }, DOMAIN_IDS, { generatedAtIso: 'x' });
    // The per-customer plan did not travel; the catalogue one did.
    assert.deepEqual(first.domains.hosting.rows.hostingPlan.map((x) => x.name), ['Repo 5GB']);

    const b = fakeDb();
    const dry = await applyBundle({ p: b, role: 'SUPERADMIN' }, JSON.parse(JSON.stringify(first)));
    assert.equal(dry.ok, true, JSON.stringify(dry.domains.filter((d) => !d.ok)));
    assert.equal(b.adminSetting.rows.length, 0, 'a check-only import wrote something');

    const done = await applyBundle({ p: b, role: 'SUPERADMIN' }, JSON.parse(JSON.stringify(first)), { apply: true });
    assert.equal(done.ok, true);
    const second = await buildBundle({ p: b }, DOMAIN_IDS, { generatedAtIso: 'x' });

    // Every setting and every row came back…
    const keys = (bd) => Object.fromEntries(Object.entries(bd.domains).map(([id, d]) => [id, {
      settings: d.settings.map((s) => s.key).sort(),
      rows: Object.fromEntries(Object.entries(d.rows).map(([m, list]) => [m, list.length])),
    }]));
    assert.deepEqual(keys(second), keys(first));
    // …with the values the admin screens would have stored. The live schemas fill their own
    // defaults (the route does exactly that on save), so a value already in that form comes
    // back unchanged:
    const val = (bd, dom, key) => bd.domains[dom].settings.find((s) => s.key === key).value;
    for (const [dom, key] of [['bot', 'bot.config'], ['economy', 'bot.config#economy'], ['projects', 'project.bmm'], ['hosting', 'pricing.perGBCents'], ['analytics', 'analytics.retention'], ['site', 'site.theme']])
      assert.deepEqual(val(second, dom, key), val(first, dom, key), key);
    assert.deepEqual(second.domains.content.rows, first.domains.content.rows);
    assert.deepEqual(second.domains.hosting.rows, first.domains.hosting.rows);
    assert.deepEqual(second.domains.goals.rows, first.domains.goals.rows);

    // …and one pass is a fixed point: importing the second export changes nothing more.
    const c = fakeDb();
    await applyBundle({ p: c, role: 'SUPERADMIN' }, JSON.parse(JSON.stringify(second)), { apply: true });
    const third = await buildBundle({ p: c }, DOMAIN_IDS, { generatedAtIso: 'x' });
    assert.deepEqual(third.domains, second.domains);
  });

  test('bot and economy both land in bot.config without undoing each other', async () => {
    const first = await buildBundle({ p: cleanInstall() }, ['bot', 'economy']);
    const b = fakeDb();
    set(b, 'bot.config', { enabled: false, economy: { shop: [] } });
    await applyBundle({ p: b, role: 'SUPERADMIN' }, first, { apply: true });
    const cfg = b.adminSetting.rows.find((r) => r.key === 'bot.config').value;
    assert.equal(cfg.enabled, true);
    assert.deepEqual(cfg.economy.shop, [{ id: 'vip', price: 100 }]);
  });

  test('importing only the bot keeps the local economy', async () => {
    const first = await buildBundle({ p: cleanInstall() }, ['bot']);
    const b = fakeDb();
    set(b, 'bot.config', { enabled: false, economy: { shop: [{ id: 'local', price: 1 }] } });
    await applyBundle({ p: b, role: 'SUPERADMIN' }, first, { apply: true });
    assert.deepEqual(b.adminSetting.rows.find((r) => r.key === 'bot.config').value.economy.shop, [{ id: 'local', price: 1 }]);
  });

  test('a secret the target already holds survives an import that could not carry it', async () => {
    const first = await buildBundle({ p: seededInstall() }, ['projects']);
    const b = fakeDb();
    set(b, 'codegraph.settings.bmm', { url: 'https://old', secret: 'LOCAL-secret' });
    const r = await applyBundle({ p: b, role: 'SUPERADMIN' }, first, { apply: true, only: ['projects'] });
    assert.equal(r.ok, true, JSON.stringify(r.domains));
    assert.deepEqual(b.adminSetting.rows.find((x) => x.key === 'codegraph.settings.bmm').value, { url: 'https://github.com/x/y', secret: 'LOCAL-secret' });
  });
});

describe('an import is checked, and refuses rather than half-writes', () => {
  const bundleWith = (domains) => ({ manifest: { format: 'bcweb-custom-seed', version: FORMAT_VERSION }, domains });

  test('a value the admin screen would refuse is refused, and its domain is not written', async () => {
    const b = fakeDb();
    const r = await applyBundle({ p: b, role: 'SUPERADMIN' }, bundleWith({
      site: { settings: [
        { key: 'footer.config', value: { enabled: false, columns: [] } },
        // PUT /admin/nav refuses an external `to`; so must the import.
        { key: 'nav.config', value: { enabled: true, items: [{ type: 'link', label: 'Evil', to: 'javascript:alert(1)' }] } },
      ] },
    }), { apply: true });
    assert.equal(r.ok, false);
    assert.equal(r.domains[0].items.find((i) => i.id === 'nav.config').status, 'invalid');
    assert.equal(b.adminSetting.rows.length, 0, 'the valid half of a refused domain was written');
  });

  test('a credential row, a planted secret or a key from another domain is refused', async () => {
    const r = await applyBundle({ p: fakeDb(), role: 'SUPERADMIN' }, bundleWith({
      bot: { settings: [
        { key: 'bot.token', value: { token: 'x' } },
        { key: 'bot.config', value: { enabled: true, webhook: S.discordWebhook } },
        { key: 'site.theme', value: {} },
      ] },
    }));
    const st = Object.fromEntries(r.domains[0].items.map((i) => [i.id, i.status]));
    assert.deepEqual(st, { 'bot.token': 'refused', 'bot.config': 'refused', 'site.theme': 'refused' });
  });

  test('a SUPERADMIN-only setting needs a SUPERADMIN, as on its own screen', async () => {
    const r = await applyBundle({ p: fakeDb(), role: 'ADMIN' }, bundleWith({
      hosting: { settings: [{ key: 'marketplace.feePercentBp', value: 500 }] },
    }));
    assert.equal(r.domains[0].items[0].error, 'superadmin_required');
  });

  test('not a seed, or another version of the format', async () => {
    assert.equal((await applyBundle({ p: fakeDb() }, { hello: 1 })).error, 'not_a_seed');
    assert.equal((await applyBundle({ p: fakeDb() }, { manifest: { format: 'bcweb-custom-seed', version: 99 }, domains: {} })).error, 'unsupported_version');
  });

  test('a hand-edited plan without a price does not become a free plan', async () => {
    const r = await applyBundle({ p: fakeDb(), role: 'SUPERADMIN' }, bundleWith({
      hosting: { rows: { hostingPlan: [{ name: 'X', storageGB: 1, uploadLimitKbps: 1, priceMonthlyCents: null, active: true }] } },
    }));
    assert.equal(r.domains[0].items[0].status, 'invalid');
  });
});
