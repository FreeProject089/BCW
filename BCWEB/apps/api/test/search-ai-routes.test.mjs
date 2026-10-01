// agent-bcw-nav: POST /search/smart on a real database, against a FAKE Laya on 127.0.0.1.
//
// Pinned: off unless the admin switched it on (and the AI layer is up); a signed-out visitor
// only when the admin allows it; what reaches the classifier is the query and the candidates'
// titles, never who asked; the answer only REORDERS what the page sent; the same question is
// served from the cache; the per-visitor, per-account and per-IP limits answer 429 with their
// scope; a classifier that is down, killed or unset answers ai:false with a 200, so the search
// that already worked keeps working. /site/features tells the web whether to ask at all.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the search route tests';
delete process.env.REDIS_URL;
process.env.JWT_SECRET ||= 'search-ai-routes-secret';
process.env.LAYA_API_KEY = ['laya', 'search', 'test'].join('-');
delete process.env.AI_KILL_SWITCH;
delete process.env.AI_PROVIDER;

const MAIL = '@search-ai-routes.test';
let down = false;
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = {}; try { json = JSON.parse(body); } catch { /* */ }
    seen.push({ url: req.url, body: json, raw: body });
    if (down) { res.writeHead(503); return res.end('{}'); }
    const answers = {};
    for (const [id, q] of Object.entries(json?.questions || {})) {
      const keys = Object.keys(q.criteria || {});
      // Intent: "docs". Rerank: the LAST candidate is the best answer, so a reorder shows.
      const pick = keys.includes('docs') ? 'docs' : keys[keys.length - 1];
      answers[id] = { choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ answers }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.LAYA_URL = `http://127.0.0.1:${server.address().port}`;

let p, app, jwt, ai, F, S;
let member;
let features = null;
let layer = { provider: 'laya', enabled: true, cacheTtlSec: 0 };
let killed = false;
const cookies = {};
const setFeatures = (patch) => { features = F.normalizeFeatures(patch); F.invalidateFeatures(); };
const ON = (search = {}) => setFeatures({ features: { search: { enabled: true } }, search: { cacheTtlSec: 0, ...search } });

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  ai = await import('../src/lib/moderation/ai.mjs');
  F = await import('../src/lib/ai-features.mjs');
  S = await import('../src/lib/search-ai.mjs');
  F._setFeaturesLoaderForTests(async () => ({ features, site: null }));
  member = await p.user.create({ data: { email: `member-${Date.now()}${MAIL}`, displayName: 'search member', role: 'USER', emailVerified: true, status: 'active' } });
  const s = await p.session.create({ data: { userId: member.id }, select: { id: true } });
  cookies.member = `bcw_session=${jwt.sign({ uid: member.id, role: member.role, sid: s.id }, process.env.JWT_SECRET)}`;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/search-ai.mjs')).default);
  await app.register((await import('../src/routes/ai-features.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) { await new Promise((r) => server.close(r)); return; }
  try {
    const mine = { user: { email: { endsWith: MAIL } } };
    await p.aiUserUsageDay.deleteMany({ where: mine });
    await p.session.deleteMany({ where: mine });
    await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  } finally {
    F._setFeaturesLoaderForTests(null);
    ai._setSettingsLoaderForTests(null);
    await app?.close();
    await new Promise((r) => server.close(r));
  }
});

beforeEach(() => {
  if (!RUN) return;
  seen.length = 0; down = false; killed = false;
  F._clearLimitsForTests(); F._clearPaidCacheForTests(); S._clearSearchCacheForTests();
  layer = { provider: 'laya', enabled: true, cacheTtlSec: 0 };
  ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed }));
  ON();
});

const CANDS = [{ id: 'p1', title: 'Install a plugin' }, { id: 'p2', title: 'Plugin API' }, { id: 'p3', title: 'Fix a crash on start' }];
let ipN = 0;
const ask = (body, { who = null, ip = null } = {}) => app.inject({
  method: 'POST', url: '/search/smart', payload: body,
  remoteAddress: ip || `10.9.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`,
  headers: who ? { cookie: cookies[who] } : {},
});

describe('search: Laya in the search bars', { skip }, () => {
  test('off by default: ai:false, no call', async () => {
    setFeatures(null);
    const r = await ask({ q: 'crash on start', scope: 'docs', candidates: CANDS });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { ai: false, reason: 'feature_off' });
    assert.equal(seen.length, 0);
  });

  test('on: an intent and a reorder of what the page sent, and nothing else', async () => {
    const r = await ask({ q: 'crash on start', scope: 'docs', candidates: CANDS }, { who: 'member' });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.equal(j.ai, true, r.body);
    assert.deepEqual(j.intent, { id: 'docs', p: 0.9 });
    assert.deepEqual([...j.order].sort(), ['p1', 'p2', 'p3'], 'the same results, only reordered');
    assert.equal(j.order[0], 'p3', 'the clearly better answer moved up');
  });

  test('what reaches the classifier: the query and the titles, never who asked', async () => {
    await ask({ q: 'crash on start', scope: 'docs', candidates: CANDS }, { who: 'member' });
    assert.ok(seen.length >= 1);
    const sent = seen.map((s) => s.raw).join('\n');
    assert.ok(sent.includes('crash on start'));
    assert.ok(!sent.includes(member.id) && !sent.includes(member.email) && !sent.includes('10.9.'), 'no account, no address');
  });

  test('signed out: only when the admin allows it', async () => {
    ON({ anon: false });
    const no = await ask({ q: 'dark theme', scope: 'catalog' });
    assert.deepEqual(no.json(), { ai: false, reason: 'sign_in' });
    ON({ anon: true });
    const yes = await ask({ q: 'dark theme', scope: 'catalog' });
    assert.equal(yes.json().ai, true, yes.body);
  });

  test('a paid-only search refuses a signed-out visitor politely', async () => {
    setFeatures({ features: { search: { enabled: true, audience: 'paid' } }, search: { cacheTtlSec: 0 } });
    const r = await ask({ q: 'dark theme' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().reason, 'sign_in');
  });

  test('the same question is answered from the cache', async () => {
    ON({ cacheTtlSec: 300 });
    const a = await ask({ q: 'Dark  Theme', scope: 'catalog', candidates: CANDS });
    assert.equal(a.json().cached, false, a.body);
    const n = seen.length;
    const b = await ask({ q: 'dark theme', scope: 'catalog', candidates: CANDS });
    assert.equal(b.json().cached, true);
    assert.equal(seen.length, n, 'no second call');
    assert.deepEqual(b.json().order, a.json().order);
  });

  test('limits: per signed-out visitor, per account, per IP — each with its scope', async () => {
    ON({ perAnonPerMin: 1 });
    assert.equal((await ask({ q: 'maps one' }, { ip: '10.1.1.1' })).statusCode, 200);
    const anon = await ask({ q: 'maps two' }, { ip: '10.1.1.1' });
    assert.equal(anon.statusCode, 429, anon.body);
    assert.equal(anon.json().scope, 'anon');
    assert.ok(Number(anon.headers['retry-after']) > 0);

    F._clearLimitsForTests();
    ON({ perUserPerMin: 1 });
    assert.equal((await ask({ q: 'maps one' }, { who: 'member', ip: '10.1.1.2' })).statusCode, 200);
    const user = await ask({ q: 'maps two' }, { who: 'member', ip: '10.1.1.3' });
    assert.equal(user.statusCode, 429);
    assert.equal(user.json().scope, 'user');

    F._clearLimitsForTests();
    ON({ perIpPerMin: 1, perAnonPerMin: 50 });
    await ask({ q: 'maps one' }, { ip: '10.1.1.4' });
    const ip = await ask({ q: 'maps two' }, { who: 'member', ip: '10.1.1.4' });
    assert.equal(ip.statusCode, 429);
    assert.equal(ip.json().scope, 'ip', 'an account on the same address shares the address budget');
  });

  test('the account\'s daily allowance', async () => {
    setFeatures({ features: { search: { enabled: true, perUserPerDay: 1, paidPerUserPerDay: 1 } }, search: { cacheTtlSec: 0 } });
    await p.aiUserUsageDay.deleteMany({ where: { userId: member.id } });
    const U = await import('../src/lib/ai-usage.mjs');
    U._resetAiUsageForTests();
    assert.equal((await ask({ q: 'first search' }, { who: 'member' })).json().ai, true);
    const r = await ask({ q: 'second search' }, { who: 'member' });
    assert.equal(r.statusCode, 429, r.body);
    assert.equal(r.json().reason, 'quota_reached');
  });

  test('graceful: AI off, killed, or Laya down answer ai:false with a 200', async () => {
    layer = { provider: 'off', enabled: false };
    ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed: false }));
    let r = await ask({ q: 'crash on start', candidates: CANDS });
    assert.deepEqual(r.json(), { ai: false, reason: 'ai_off' });

    layer = { provider: 'laya', enabled: true, cacheTtlSec: 0 }; killed = true;
    ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed }));
    r = await ask({ q: 'crash on start', candidates: CANDS });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ai, false);

    killed = false; down = true;
    ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: layer, killed }));
    r = await ask({ q: 'crash on start', candidates: CANDS });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ai, false);
  });

  test('too short, or a bad body', async () => {
    assert.deepEqual((await ask({ q: 'a' })).json(), { ai: false, reason: 'too_short' });
    assert.equal((await ask({ q: 'ok', scope: 'everything' })).statusCode, 400);
    assert.equal((await ask({ q: 'ok', extra: 1 })).statusCode, 400);
  });

  test('/site/features says whether to ask at all', async () => {
    let r = await app.inject({ method: 'GET', url: '/site/features' });
    assert.deepEqual(r.json().search, { ai: true, anon: true });
    setFeatures(null);
    r = await app.inject({ method: 'GET', url: '/site/features' });
    assert.equal(r.json().search.ai, false);
  });
});
