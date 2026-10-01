// aios (agent-bcw-ai-os): the AI features' doors (routes/ai-features.mjs) on a real database,
// against FAKE providers on 127.0.0.1 (an OpenAI-compatible /chat/completions and a Laya
// /v1/systemone). No external AI is ever called: AI_EXTERNAL_ALLOW_PRIVATE=1 is the operator's
// own switch for a provider on their network, and it is what points the calls at the fakes.
//
// Pinned: a member's key goes in and never comes out (not in the answer, not in /ai/me, not in
// the row); plan-aware gates (a paid-only feature refuses a free member, lets a paying one in);
// per-user-per-minute, per-IP and per-feature daily limits answer 429 with the scope; the
// generative call carries the member's own key to the provider they chose and is counted in the
// analytics with its tokens and no text; with the AI off, the language and tag helpers still
// answer (locally); the pre-post check never leaks a rule; the site key is ADMIN-only and never
// read back; the staff tools refuse a member; OS mode's site-wide switch reaches /site/features.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the AI feature route tests';
delete process.env.REDIS_URL;
process.env.JWT_SECRET ||= 'ai-features-routes-secret';
process.env.AI_EXTERNAL_ALLOW_PRIVATE = '1';
// A MEMBER key on 127.0.0.1 is refused even with the operator's switch (ai-secfix, finding 6);
// the test-runner-only door lets these tests keep using their fake provider.
process.env.AI_TEST_ALLOW_PRIVATE_BYOK = '1';
process.env.LAYA_API_KEY = ['laya', 'routes', 'test'].join('-');
delete process.env.AI_KILL_SWITCH;
delete process.env.AI_PROVIDER;

const MAIL = '@ai-features-routes.test';
const MEMBER_KEY = ['sk', 'member', 'Zq9Xw8Vv7Uu6Tt5S'].join('-');
const SITE_KEY = ['sk', 'site', 'Aa1Bb2Cc3Dd4Ee5F'].join('-');
const SECRET_WORDS = 'my-private-notes-canary-77';

// ── Fake providers ─────────────────────────────────────────────────────────────────────────
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = {}; try { json = JSON.parse(body); } catch { /* */ }
    seen.push({ url: req.url, auth: req.headers.authorization || '', body: json });
    if (req.url === '/v1/chat/completions' && String(req.headers.authorization || '').includes('rejected')) { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1/chat/completions') {
      return res.end(JSON.stringify({ model: 'fake-gpt', choices: [{ message: { content: 'A tidy texture pack for the game.' } }], usage: { prompt_tokens: 42, completion_tokens: 9 } }));
    }
    const answers = {};
    for (const [id, q] of Object.entries(json?.questions || {})) {
      if (q.type === 'noul') answers[id] = { noul: 0.1 };
      else { const l = Object.keys(q.criteria || {}); answers[id] = { choice: l.includes('fr') ? 'fr' : l[0], probabilities: Object.fromEntries(l.map((x, i) => [x, (l.includes('fr') ? x === 'fr' : i === 0) ? 0.8 : 0.2 / (l.length - 1)])) }; }
    }
    return res.end(JSON.stringify({ answers }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/v1`;
process.env.LAYA_URL = `http://127.0.0.1:${server.address().port}`;

let p, app, jwt, ai, F, U;
let member, payer, admin, mod;
let plan;
let features = null;           // the in-process ai.features (the loader is swapped)
let layer = { provider: 'off', enabled: false };
const cookies = {};

const setFeatures = (patch) => { features = F.normalizeFeatures(patch); F.invalidateFeatures(); };

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await lockRow(p, 'aios:ai.features+site+os');
  jwt = (await import('jsonwebtoken')).default;
  ai = await import('../src/lib/moderation/ai.mjs');
  F = await import('../src/lib/ai-features.mjs');
  U = await import('../src/lib/ai-usage.mjs');
  ai._resetForTests();
  ai._setSettingsLoaderForTests(async () => ({ config: layer, killed: false }));
  F._setFeaturesLoaderForTests(async () => ({ features, site: (await p.adminSetting.findUnique({ where: { key: 'ai.siteKey' } }))?.value ?? null }));
  const t = Date.now();
  const mk = (name, role = 'USER') => p.user.create({ data: { email: `${name}-${t}${MAIL}`, displayName: `aios ${name}`, role, totpEnabled: role !== 'USER', emailVerified: true, status: 'active' } });
  member = await mk('member'); payer = await mk('payer'); admin = await mk('admin', 'ADMIN'); mod = await mk('mod', 'MOD');
  plan = await p.hostingPlan.create({ data: { name: `aios plan ${t}`, storageGB: 1, uploadLimitKbps: 1000, priceMonthlyCents: 500 } });
  await p.subscription.create({ data: { userId: payer.id, planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400_000) } });
  for (const u of [member, payer, admin, mod]) {
    const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
    cookies[u.id] = `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
  }
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/ai-features.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) { await new Promise((r) => server.close(r)); return; }
  try {
    const ids = [member, payer, admin, mod].filter(Boolean).map((u) => u.id);
    // By address, not by this run's ids: a run that died half-way left its rows too.
    const mine = { user: { email: { endsWith: MAIL } } };
    await p.aiUserKey.deleteMany({ where: mine });
    await p.aiUserUsageDay.deleteMany({ where: mine });
    await p.subscription.deleteMany({ where: mine });
    await p.hostingPlan.deleteMany({ where: { name: { startsWith: 'aios plan ' }, subscriptions: { none: {} } } }).catch(() => {});
    if (plan) await p.hostingPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await p.adminSetting.deleteMany({ where: { key: { in: ['ai.siteKey', 'ai.features', 'os.enabled'] } } });
    await p.session.deleteMany({ where: { OR: [{ userId: { in: ids } }, mine] } });
    await p.auditLogEntry.deleteMany({ where: { actor: { email: { endsWith: MAIL } } } });
    await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  } finally {
    F._setFeaturesLoaderForTests(null);
    ai._setSettingsLoaderForTests(null);
    await unlockRow(p, 'aios:ai.features+site+os').catch(() => {});
    await app?.close();
    await new Promise((r) => server.close(r));
  }
});

beforeEach(() => {
  if (!RUN) return;
  seen.length = 0;
  F._clearLimitsForTests(); F._clearPaidCacheForTests();
  layer = { provider: 'off', enabled: false };
  ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed: false }));
  setFeatures({ byok: { enabled: true }, features: { suggest_tags: { enabled: true }, detect_language: { enabled: true }, content_check: { enabled: true }, describe: { enabled: true, audience: 'paid', paidPerUserPerDay: 50 }, summarize: { enabled: true } }, limits: { perUserPerMin: 50, perIpPerMin: 100 } });
});

const call = (u, method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { ...(u ? { cookie: cookies[u.id] } : {}), ...headers } });

describe('AI features: members', { skip }, () => {
  test('a member\'s key goes in and never comes out', async () => {
    const put = await call(member, 'PUT', '/ai/key', { baseUrl: BASE, key: MEMBER_KEY, model: 'fake-gpt' });
    assert.equal(put.statusCode, 200, put.body);
    assert.ok(!put.body.includes(MEMBER_KEY));
    assert.equal(put.json().key.last4, MEMBER_KEY.slice(-4));
    const me = await call(member, 'GET', '/ai/me');
    assert.equal(me.statusCode, 200, me.body);
    assert.ok(!me.body.includes(MEMBER_KEY) && !me.body.includes('/v1'), 'neither the key nor the path reaches the browser');
    assert.equal(me.json().byok.key.set, true);
    const row = await p.aiUserKey.findUnique({ where: { userId: member.id } });
    assert.ok(!row.keySecret.includes(MEMBER_KEY), 'the row holds an envelope, not the key');
  });

  test('BYOK off: the door is shut', async () => {
    setFeatures({ byok: { enabled: false } });
    const r = await call(member, 'PUT', '/ai/key', { baseUrl: BASE, key: MEMBER_KEY });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error, 'byok_off');
  });

  test('a paid-only feature refuses a free member and serves a paying one, with THEIR key, counted without text', async () => {
    const free = await call(member, 'POST', '/ai/describe', { name: 'Pack', notes: SECRET_WORDS });
    assert.equal(free.statusCode, 403);
    assert.equal(free.json().error, 'plan_required');
    await call(payer, 'PUT', '/ai/key', { baseUrl: BASE, key: MEMBER_KEY, model: 'fake-gpt' });
    const ok = await call(payer, 'POST', '/ai/describe', { name: 'Pack', notes: SECRET_WORDS, lang: 'en' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().ok, true, ok.body);
    assert.equal(ok.json().provider, 'byok');
    const sent = seen.find((s) => s.url === '/v1/chat/completions');
    assert.equal(sent.auth, `Bearer ${MEMBER_KEY}`);
    assert.ok(JSON.stringify(sent.body).includes(SECRET_WORDS), 'the notes went to the provider they chose');
    await U.flushAiUsage(p);
    const rows = await p.aiUsageDay.findMany({ where: { feature: 'describe', provider: 'byok' } });
    assert.ok(rows.length >= 1);
    assert.ok(rows.some((r) => r.tokensIn >= 42 && r.tokensOut >= 9));
    assert.ok(!JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)).includes(SECRET_WORDS));
    const mine = await p.aiUserUsageDay.findFirst({ where: { userId: payer.id, feature: 'describe' } });
    assert.ok(mine && mine.calls >= 1);
  });

  test('the daily allowance is per feature and answers 429 with the scope', async () => {
    setFeatures({ byok: { enabled: true }, features: { describe: { enabled: true, audience: 'all', perUserPerDay: 1, paidPerUserPerDay: 1 } } });
    await call(member, 'PUT', '/ai/key', { baseUrl: BASE, key: MEMBER_KEY });
    await p.aiUserUsageDay.deleteMany({ where: { userId: member.id } });
    const a = await call(member, 'POST', '/ai/describe', { name: 'One' });
    assert.equal(a.json().ok, true, a.body);
    const b = await call(member, 'POST', '/ai/describe', { name: 'Two' });
    assert.equal(b.statusCode, 429, b.body);
    assert.equal(b.json().error, 'quota_reached');
    assert.equal(b.json().scope, 'feature');
    assert.ok(Number(b.headers['retry-after']) > 0);
  });

  test('per user per minute, and per IP', async () => {
    setFeatures({ features: { detect_language: { enabled: true } }, limits: { perUserPerMin: 2, perIpPerMin: 100 } });
    for (let i = 0; i < 2; i++) assert.equal((await call(member, 'POST', '/ai/suggest', { task: 'language', text: 'this is a text in english for the test' })).statusCode, 200);
    const third = await call(member, 'POST', '/ai/suggest', { task: 'language', text: 'this is a text in english for the test' });
    assert.equal(third.statusCode, 429);
    assert.equal(third.json().scope, 'user');
    F._clearLimitsForTests();
    setFeatures({ features: { detect_language: { enabled: true } }, limits: { perUserPerMin: 100, perIpPerMin: 1 } });
    await call(member, 'POST', '/ai/suggest', { task: 'language', text: 'this is a text' });
    const other = await call(payer, 'POST', '/ai/suggest', { task: 'language', text: 'this is a text' });
    assert.equal(other.statusCode, 429, 'a second account on the same address shares the IP budget');
    assert.equal(other.json().scope, 'ip');
  });

  test('AI off: language and tags still answer, locally', async () => {
    const l = await call(member, 'POST', '/ai/suggest', { task: 'language', text: 'Ceci est une extension pour le jeu avec des options dans la page' });
    assert.equal(l.json().source, 'local');
    assert.equal(l.json().result.lang, 'fr');
    const t = await call(member, 'POST', '/ai/suggest', { task: 'tags', text: 'better weapons textures', options: ['Weapons', 'Maps', 'Textures'] });
    assert.equal(t.json().source, 'local');
    assert.deepEqual(t.json().result.tags.map((x) => x.tag).sort(), ['Textures', 'Weapons']);
    assert.equal(seen.length, 0, 'nothing left the process');
  });

  test('AI on (Laya): the classifier answers, through the moderation pipeline', async () => {
    layer = { provider: 'laya', enabled: true, cacheTtlSec: 0 };
    ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed: false }));
    const l = await call(member, 'POST', '/ai/suggest', { task: 'language', text: 'Bonjour, ceci est un texte' });
    assert.equal(l.json().source, 'ai', l.body);
    assert.equal(l.json().result.lang, 'fr');
    assert.ok(seen.some((s) => s.url === '/v1/systemone'));
  });

  test('the pre-post check is coarse and never names a rule', async () => {
    const r = await call(member, 'POST', '/ai/check', { text: 'FREE NITRO!!! claim now at https://dlscord-gift.example/login and enter your password' });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.ok(['ok', 'maybe', 'likely'].includes(j.level));
    assert.ok(!/link\.|text\.|heur\.|trust\.|keyword|lookalike/.test(r.body), r.body);
  });

  test('generative with no key: a clear reason, no call', async () => {
    setFeatures({ byok: { enabled: true }, features: { describe: { enabled: true, audience: 'all' } } });
    await p.aiUserKey.deleteMany({ where: { userId: member.id } });
    const r = await call(member, 'POST', '/ai/describe', { name: 'X' });
    assert.equal(r.json().ok, false);
    assert.equal(r.json().reason, 'no_key');
    assert.equal(seen.length, 0);
  });

  test('a key the provider rejects says so', async () => {
    setFeatures({ byok: { enabled: true }, features: { describe: { enabled: true, audience: 'all' } } });
    await call(member, 'PUT', '/ai/key', { baseUrl: BASE, key: 'sk-rejected-key-000000' });
    const r = await call(member, 'POST', '/ai/describe', { name: 'X' });
    assert.equal(r.json().reason, 'key_rejected');
  });

  test('a member cannot reach the staff tools', async () => {
    for (const [m, u] of [['GET', '/admin/ai/usage'], ['GET', '/admin/ai/features'], ['GET', '/admin/ai/triage'], ['PUT', '/admin/ai/site-key']]) {
      const r = await call(member, m, u, m === 'PUT' ? { baseUrl: BASE, key: SITE_KEY } : undefined);
      assert.equal(r.statusCode, 403, `${m} ${u}`);
    }
  });
});

describe('AI features: staff', { skip }, () => {
  test('the site key is ADMIN-only, sealed, never read back, and used for staff summaries', async () => {
    const byMod = await call(mod, 'PUT', '/admin/ai/site-key', { baseUrl: BASE, key: SITE_KEY });
    assert.equal(byMod.statusCode, 403, 'a moderator (no manage_moderation) is refused');
    const put = await call(admin, 'PUT', '/admin/ai/site-key', { baseUrl: BASE, key: SITE_KEY, model: 'fake-gpt' });
    assert.equal(put.statusCode, 200, put.body);
    assert.ok(!put.body.includes(SITE_KEY));
    const row = await p.adminSetting.findUnique({ where: { key: 'ai.siteKey' } });
    assert.ok(!JSON.stringify(row.value).includes(SITE_KEY));
    const get = await call(admin, 'GET', '/admin/ai/features');
    assert.ok(!get.body.includes(SITE_KEY) && !get.body.includes('/v1'));
    assert.equal(get.json().siteKey.set, true);
    const fb = await p.feedback.create({ data: { id: `aios-fb-${Date.now()}`, projectKey: 'bmm', kind: 'bug', title: 'Crash on start', body: 'It crashes when I open the settings.' } });
    try {
      const s = await call(admin, 'POST', '/admin/ai/summarize', { kind: 'feedback', id: fb.id });
      assert.equal(s.statusCode, 200, s.body);
      assert.equal(s.json().provider, 'site', s.body);
      assert.equal(seen.find((x) => x.url === '/v1/chat/completions').auth, `Bearer ${SITE_KEY}`);
    } finally { await p.feedback.delete({ where: { id: fb.id } }).catch(() => {}); }
    const del = await call(admin, 'DELETE', '/admin/ai/site-key');
    assert.equal(del.json().siteKey.set, false);
  });

  test('the usage dashboard: ranges, totals, top users, no text', async () => {
    U.recordAi({ feature: 'suggest_tags', provider: 'laya', outcome: 'ok', latencyMs: 90, userId: member.id });
    const r = await call(admin, 'GET', '/admin/ai/usage?range=30d');
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.equal(j.range, '30d');
    assert.equal(j.series.length, 30);
    assert.ok(j.total.calls >= 1);
    assert.ok(j.byFeature.some((f) => f.key === 'suggest_tags'));
    assert.ok(j.topUsers.some((u) => u.userId === member.id));
  });

  test('features settings round-trip, bounded', async () => {
    const r = await call(admin, 'PUT', '/admin/ai/features', { features: { describe: { enabled: true, audience: 'paid' } }, limits: { perUserPerMin: 7 } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().config.limits.perUserPerMin, 7);
    const bad = await call(admin, 'PUT', '/admin/ai/features', { limits: { perUserPerMin: 0 } });
    assert.equal(bad.statusCode, 400);
    const sneaky = await call(admin, 'PUT', '/admin/ai/features', { siteKey: SITE_KEY });
    assert.equal(sneaky.statusCode, 400, 'unknown keys are refused, not stored');
  });

  test('triage ranks open cases; held first', async () => {
    const mk = (d) => p.moderationCase.create({ data: { surface: 'community', decision: 'FLAG', score: 20, status: 'open', excerpt: 'aios triage fixture', ...d } });
    const a = await mk({ held: false });
    const b = await mk({ held: true });
    try {
      const r = await call(admin, 'GET', '/admin/ai/triage');
      assert.equal(r.statusCode, 200, r.body);
      const ids = r.json().cases.map((c) => c.id);
      assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
    } finally { await p.moderationCase.deleteMany({ where: { id: { in: [a.id, b.id] } } }); }
  });
});

describe('OS mode site-wide switch', { skip }, () => {
  test('on by default, off when the admin says so', async () => {
    await p.adminSetting.deleteMany({ where: { key: 'os.enabled' } });
    assert.equal((await call(null, 'GET', '/site/features')).json().os.enabled, true);
    await p.adminSetting.create({ data: { key: 'os.enabled', value: false } });
    const r = (await call(null, 'GET', '/site/features')).json();
    assert.equal(r.os.enabled, false);
    assert.equal(r.os.beta, true);
    const { checkAdminSetting } = await import('../src/routes/misc.mjs');
    assert.equal((await checkAdminSetting(p, 'os.enabled', 'no')).ok, false, 'a boolean or nothing');
    assert.equal((await checkAdminSetting(p, 'ai.siteKey', { keySecret: 'x' })).status, 409, 'the site key never goes through the generic door');
  });
});

describe('suggestion feedback (POST /ai/feedback)', { skip }, () => {
  const peek = (feature) => U._peekAiUsageForTests().rows.filter((r) => r.feature === feature);
  test('applied / dismissed become counts under the helper and its provider, and nothing else', async () => {
    U._resetAiUsageForTests();
    let r = await call(member, 'POST', '/ai/feedback', { feature: 'suggest_tags', outcome: 'accepted', provider: 'laya', field: 'tags', n: 2 });
    assert.equal(r.statusCode, 200, r.body);
    r = await call(member, 'POST', '/ai/feedback', { feature: 'suggest_tags', outcome: 'rejected', provider: 'local', field: 'tags' });
    assert.equal(r.statusCode, 200, r.body);
    r = await call(member, 'POST', '/ai/feedback', { feature: 'describe', outcome: 'rejected', provider: 'byok', field: 'description' });
    assert.equal(r.statusCode, 200, r.body);
    const tags = peek('suggest_tags');
    assert.equal(tags.find((x) => x.provider === 'laya').accepted, 2);
    assert.equal(tags.find((x) => x.provider === 'rules').rejected, 1, 'word matching is counted as rules');
    assert.equal(peek('describe')[0].rejected, 1);
    assert.equal(U._peekAiUsageForTests().users.length, 0, 'feedback is never tied to an account');
    // The old verdict shape still works.
    r = await call(member, 'POST', '/ai/feedback', { feature: 'content_check', verdict: 'wrong' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(peek('content_check')[0].falsePositive, 1);
    U._resetAiUsageForTests();
  });
  test('validation: unknown helper, outcome, provider, field or count, text, a staff helper from a member, no session', async () => {
    U._resetAiUsageForTests();
    const bad = [
      { feature: 'nope', outcome: 'accepted' },
      { feature: 'suggest_tags', outcome: 'loved' },
      { feature: 'suggest_tags', outcome: 'accepted', provider: 'https://x' },
      { feature: 'suggest_tags', outcome: 'accepted', field: 'password' },
      { feature: 'suggest_tags', outcome: 'accepted', n: 0 },
      { feature: 'suggest_tags', outcome: 'accepted', n: 21 },
      { feature: 'suggest_tags', outcome: 'accepted', text: SECRET_WORDS },
      { feature: 'suggest_tags', outcome: 'accepted', verdict: 'wrong' },
    ];
    for (const body of bad) {
      const r = await call(member, 'POST', '/ai/feedback', body);
      assert.equal(r.statusCode, 400, JSON.stringify(body));
    }
    let r = await call(member, 'POST', '/ai/feedback', { feature: 'summarize', outcome: 'accepted' });
    assert.equal(r.statusCode, 403);
    r = await call(null, 'POST', '/ai/feedback', { feature: 'suggest_tags', outcome: 'accepted' });
    assert.equal(r.statusCode, 401);
    assert.equal(U._peekAiUsageForTests().rows.length, 0, 'nothing refused was counted');
    r = await call(mod, 'POST', '/ai/feedback', { feature: 'summarize', outcome: 'accepted', provider: 'site' });
    assert.equal(r.statusCode, 200, 'staff may rate a staff helper');
    assert.ok(!JSON.stringify(U._peekAiUsageForTests()).includes(SECRET_WORDS));
    U._resetAiUsageForTests();
  });
});
