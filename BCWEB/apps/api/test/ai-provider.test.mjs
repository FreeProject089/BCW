// laya (agent-laya-bcweb): the optional AI provider layer (lib/moderation/ai.mjs) and its doors
// (routes/ai.mjs).
//
// The layer is driven against a FAKE Laya sidecar: a node http server on 127.0.0.1 that answers
// /v1/systemone the way laya-serve does (answers[q].noul, answers[q].choice + probabilities),
// or slowly, or with garbage, or with a 500 — whichever the test asks for. No model, no Docker,
// no network beyond the loopback, and no call to any real external API: the "external" provider
// is pointed at the same fake server with AI_EXTERNAL_ALLOW_PRIVATE=1, which is exactly the
// switch that lets an operator do the same thing on purpose.
//
// What is pinned: every guard returns null instead of waiting or throwing (timeout, full
// queue, open breaker, rate limit, kill switch by setting AND by env), the cache answers the
// second identical call, the text is cleaned and capped before it leaves, one item is ONE
// request, garbage never throws, the external URL rules, and nothing aiStatus() returns
// contains the key or the URL. The HTTP half (DATABASE_URL-gated like every route test):
// the BMM suggest endpoint's auth, validation and "disabled" answer, the admin doors'
// guard and the kill switch round trip, and the bot door's secret and plan checks.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

delete process.env.REDIS_URL; // the in-process limits, as CI runs them
process.env.JWT_SECRET ||= 'ai-provider-test-secret';
const KEY = ['laya', 'test', 'key', 'not', 'real'].join('-');
process.env.LAYA_API_KEY = KEY;
delete process.env.AI_KILL_SWITCH;
delete process.env.AI_PROVIDER;

const ai = await import('../src/lib/moderation/ai.mjs');

// ── The fake sidecar ─────────────────────────────────────────────────────────────────────────
let mode = 'ok';
let delayMs = 0;
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = null; try { json = JSON.parse(body || 'null'); } catch { /* not JSON */ }
    seen.push({ url: req.url, auth: req.headers.authorization || '', body: json });
    const send = () => {
      if (res.destroyed) return;
      if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok","device":"cpu"}'); }
      if (mode === 'error') { res.writeHead(500); return res.end('boom'); }
      if (mode === 'garbage') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"answers": {'); }
      if (mode === 'badshape') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"answers": {"spam": {"noul": 7}}}'); }
      if (req.url === '/v1/moderations') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ model: 'omni-moderation-test', results: [{ flagged: true, category_scores: { harassment: 0.91, hate: 0.2, 'self-harm': 0.01, sexual: 0.4 } }] }));
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ model: 'chat-test', choices: [{ message: { content: JSON.stringify({ spam: 0.1, phishing: 0.97, toxic: 'high', troll: 0.2 }) } }] }));
      }
      const answers = {};
      for (const [id, q] of Object.entries(json?.questions || {})) {
        if (q.type === 'noul') answers[id] = { noul: id === 'phishing' ? 0.93 : 0.12, confidence: 0.8, answer_confidence: 0.8 };
        else { const labels = Object.keys(q.criteria || {}); answers[id] = { choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.7 : 0.3 / (labels.length - 1)])) }; }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answers, usage: { input_tokens: 10, output_tokens: 0 } }));
    };
    if (delayMs) setTimeout(send, delayMs); else send();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
process.env.LAYA_URL = `http://127.0.0.1:${PORT}`;

// ── Config, without a database ───────────────────────────────────────────────────────────────
let stored = { config: null, killed: false };
const setCfg = (config, killed = false) => { stored = { config, killed }; ai._resetForTests(); ai._setSettingsLoaderForTests(async () => stored); };
const ON = (over = {}) => ({ provider: 'laya', enabled: true, surfaces: { contact: true, crash: true, community: true, discord_automod: true }, bmmSuggest: true, cacheTtlSec: 0, ...over });

after(async () => { ai._setSettingsLoaderForTests(null); ai._resetForTests(); await new Promise((r) => server.close(r)); });
beforeEach(() => { mode = 'ok'; delayMs = 0; seen.length = 0; delete process.env.AI_KILL_SWITCH; delete process.env.AI_PROVIDER; });

describe('AI provider layer (fake sidecar)', () => {
  test('off by default: null, no request, aiEnabledFor false', async () => {
    setCfg(null);
    assert.equal(await ai.aiAnalyze('contact', { text: 'hello' }), null);
    assert.equal(seen.length, 0);
    await ai.aiLoadConfig();
    assert.equal(ai.aiEnabledFor('contact'), false);
  });

  test('laya: one request per item, every question batched, bearer key, labels in [0,1], category for crash', async () => {
    setCfg(ON());
    const r = await ai.aiAnalyze('crash', { text: 'The game crashed: out of memory in d3d11.dll' });
    assert.ok(r, 'an answer');
    assert.equal(r.provider, 'laya');
    assert.equal(seen.length, 1, 'ONE request for the whole item');
    assert.equal(seen[0].url, '/v1/systemone');
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    assert.deepEqual(Object.keys(seen[0].body.questions).sort(), ['category', 'off_topic', 'spam']);
    assert.equal(seen[0].body.model, 'multilingual');
    for (const v of Object.values(r.labels)) assert.ok(v >= 0 && v <= 1);
    assert.equal(r.category, 'gpu_driver');
    assert.ok(typeof r.latencyMs === 'number');
    const p = await ai.aiAnalyze('contact', { text: 'claim your free nitro', meta: { labels: ['phishing'] } });
    assert.deepEqual(Object.keys(seen[1].body.questions), ['phishing'], 'meta.labels narrows the questions');
    assert.equal(p.labels.phishing, 0.93);
    await ai.aiLoadConfig();
    assert.equal(ai.aiEnabledFor('contact'), true);
    assert.equal(ai.aiEnabledFor('report'), false, 'a surface that is not ticked');
  });

  test('the text is cleaned and capped before it leaves', async () => {
    setCfg(ON({ maxChars: 300 }));
    const long = `<script>alert(1)</script><b>Hi</b> [click](https://evil.example/x) ${'a'.repeat(10_000)}`;
    await ai.aiAnalyze('community', { text: long });
    const sent = seen[0].body.state.body;
    assert.ok(sent.length <= 300, `sent ${sent.length} chars`);
    assert.ok(!sent.includes('<script') && !sent.includes('alert(1)') && !sent.includes('<b>'));
    assert.ok(sent.includes('click (https://evil.example/x)'), 'a Markdown link keeps its URL visible');
    assert.equal(ai.toPlainText('a\u202Eb\u0000c'), 'abc', 'bidi overrides and control characters go');
  });

  test('cache: the same text twice is one request', async () => {
    setCfg(ON({ cacheTtlSec: 60 }));
    const a = await ai.aiAnalyze('contact', { text: 'Buy cheap followers now!!' });
    const b = await ai.aiAnalyze('contact', { text: '  buy CHEAP followers   now!! ' });
    assert.ok(a && b);
    assert.equal(seen.length, 1);
    assert.equal(b.cached, true);
    assert.equal((await ai.aiStatus()).counts.cacheHit, 1);
  });

  test('timeout: null well before a slow sidecar answers', async () => {
    setCfg(ON({ timeoutMs: 300 }));
    delayMs = 2000;
    const t0 = Date.now();
    assert.equal(await ai.aiAnalyze('contact', { text: 'slow one' }), null);
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
    const st = await ai.aiStatus();
    assert.equal(st.counts.timeout, 1);
    assert.equal(st.lastError.message, 'timeout');
  });

  test('breaker: N failures open it, the next call is refused without a request', async () => {
    setCfg(ON({ breakerFailures: 2, breakerOpenSec: 60 }));
    mode = 'error';
    assert.equal(await ai.aiAnalyze('contact', { text: 'one' }), null);
    assert.equal(await ai.aiAnalyze('contact', { text: 'two' }), null);
    const before = seen.length;
    mode = 'ok';
    const r = await ai.aiAnalyzeWithReason('contact', { text: 'three' });
    assert.equal(r.value, null);
    assert.equal(r.reason, 'busy');
    assert.equal(seen.length, before, 'no request while open');
    const st = await ai.aiStatus();
    assert.equal(st.breaker.open, true);
    assert.equal(st.counts.breakerOpen, 1);
  });

  test('queue full: the caller that cannot wait gets null at once', async () => {
    setCfg(ON({ concurrency: 1, maxQueue: 0, timeoutMs: 2000 }));
    delayMs = 400;
    const first = ai.aiAnalyze('contact', { text: 'first' });
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    const second = await ai.aiAnalyzeWithReason('contact', { text: 'second' });
    assert.equal(second.value, null);
    assert.equal(second.reason, 'busy');
    assert.ok(Date.now() - t0 < 200, 'refused without waiting');
    assert.ok(await first, 'the call in flight still completes');
    assert.equal((await ai.aiStatus()).counts.dropped, 1);
  });

  test('a queued caller waits for the slot, then runs', async () => {
    setCfg(ON({ concurrency: 1, maxQueue: 4, queueWaitMs: 3000, timeoutMs: 2000 }));
    delayMs = 150;
    const [a, b] = await Promise.all([ai.aiAnalyze('contact', { text: 'q-a' }), ai.aiAnalyze('contact', { text: 'q-b' })]);
    assert.ok(a && b);
    const st = await ai.aiStatus();
    assert.equal(st.inFlight, 0);
    assert.equal(st.queueDepth, 0);
  });

  test('kill switch by setting: null and no request; the rules are not this module\'s business', async () => {
    setCfg(ON(), true);
    assert.equal(await ai.aiAnalyze('contact', { text: 'x' }), null);
    assert.equal(seen.length, 0);
    const st = await ai.aiStatus();
    assert.equal(st.killed, true);
    assert.equal(st.killedBy, 'setting');
    assert.equal(ai.aiEnabledFor('contact'), false);
  });

  test('kill switch by env wins over the setting', async () => {
    setCfg(ON(), false);
    process.env.AI_KILL_SWITCH = '1';
    assert.equal(await ai.aiAnalyze('contact', { text: 'x' }), null);
    assert.equal(seen.length, 0);
    assert.equal(ai.aiEnabledFor('contact'), false);
    const st = await ai.aiStatus();
    assert.equal(st.killedBy, 'env');
    delete process.env.AI_KILL_SWITCH;
  });

  test('never throws: garbage JSON, a bad shape, junk input, an unknown surface', async () => {
    setCfg(ON());
    mode = 'garbage';
    assert.equal(await ai.aiAnalyze('contact', { text: 'garbage please' }), null);
    mode = 'badshape';
    assert.equal(await ai.aiAnalyze('contact', { text: 'bad shape please' }), null, 'a noul of 7 is not a probability');
    mode = 'ok';
    for (const args of [[undefined], ['contact'], ['contact', null], ['contact', { text: 42 }], ['nope', { text: 'x' }], ['contact', { text: {} }]]) {
      assert.equal(await ai.aiAnalyze(...args), null);
    }
    assert.ok((await ai.aiStatus()).counts.badAnswer >= 2);
    assert.equal(await ai.aiClassify(null, { text: 'x' }), null);
    assert.equal(await ai.aiClassify({ type: 'choice', instructions: 'pick', options: ['only-one'] }, { text: 'x' }), null);
  });

  test('rate limit: the global budget is enforced', async () => {
    setCfg(ON({ globalPerMin: 2 }));
    assert.ok(await ai.aiAnalyze('contact', { text: 'r1' }));
    assert.ok(await ai.aiAnalyze('contact', { text: 'r2' }));
    const r = await ai.aiAnalyzeWithReason('contact', { text: 'r3' });
    assert.equal(r.reason, 'rate_limited');
    assert.equal(seen.length, 2);
  });

  test('rate limit: one user cannot spend everybody\'s budget', async () => {
    setCfg(ON({ perUserPerMin: 1 }));
    assert.ok(await ai.aiAnalyze('contact', { text: 'u1', meta: { userId: 'alice' } }));
    assert.equal((await ai.aiAnalyzeWithReason('contact', { text: 'u2', meta: { userId: 'alice' } })).reason, 'rate_limited');
    assert.ok(await ai.aiAnalyze('contact', { text: 'u3', meta: { userId: 'bob' } }));
  });

  test('aiClassify: a choice among caller options, gated by bmmSuggest', async () => {
    setCfg(ON());
    const r = await ai.aiClassify({ type: 'choice', instructions: 'Which tag?', options: ['weapons', 'maps', 'ui'] }, { text: 'a new rifle pack' });
    assert.equal(r.choice, 'weapons');
    assert.ok(r.probs.weapons > r.probs.maps);
    const n = await ai.aiClassify({ type: 'noul', instructions: 'Adult content?' }, { text: 'a sunny map' });
    assert.equal(n.choice, 'no');
    setCfg(ON({ bmmSuggest: false }));
    const off = await ai.aiClassifyWithReason({ type: 'noul', instructions: 'x?' }, { text: 'y' });
    assert.equal(off.reason, 'disabled');
  });

  test('admin test mode runs past the global switch and the surface toggle, never past the kill switch', async () => {
    setCfg(ON({ enabled: false, surfaces: {} }));
    assert.equal(await ai.aiAnalyze('legal', { text: 'I will sue you' }), null);
    assert.ok(await ai.aiAnalyze('legal', { text: 'I will sue you' }, { adminTest: true }));
    setCfg(ON({ enabled: false }), true);
    assert.equal(await ai.aiAnalyze('legal', { text: 'I will sue you' }, { adminTest: true }), null);
  });

  test('aiStatus never carries the key or the sidecar URL', async () => {
    setCfg(ON());
    mode = 'error';
    await ai.aiAnalyze('contact', { text: `leak ${KEY} http://127.0.0.1:${PORT}/secret` });
    const st = JSON.stringify(await ai.aiStatus());
    assert.ok(!st.includes(KEY), 'the key');
    assert.ok(!st.includes(String(PORT)), 'the URL');
    assert.equal(JSON.parse(st).layaKeySet, true);
  });
});

describe('config normalisation', () => {
  test('every knob is bounded, unknown keys (a URL, a key) are dropped', () => {
    const c = ai.normalizeAiConfig({ provider: 'laya', timeoutMs: 1, concurrency: 99, maxQueue: -5, url: 'https://x', key: 'k', externalModel: 'gpt<script>' });
    assert.equal(c.timeoutMs, 200);
    assert.equal(c.concurrency, 8);
    assert.equal(c.maxQueue, 0);
    assert.equal(c.url, undefined);
    assert.equal(c.key, undefined);
    assert.equal(c.externalModel, 'gptscript');
    assert.equal(ai.normalizeAiConfig({ provider: 'gpt' }).provider, 'off');
    assert.equal(ai.normalizeAiConfig(null).enabled, false);
    for (const s of ai.AI_SURFACES) assert.equal(ai.normalizeAiConfig({}).surfaces[s], false, `${s} is off by default`);
  });
});

describe('external provider', () => {
  test('URL rules: https only, no private address, no internal name, no credentials, no query', () => {
    const bad = {
      'http://api.example.com/v1': 'https_required',
      'https://127.0.0.1/v1': 'private_address',
      'https://10.1.2.3/v1': 'private_address',
      'https://[::1]/v1': 'private_address',
      'https://169.254.169.254/latest': 'private_address',
      'https://localhost/v1': 'private_host',
      'https://model.internal/v1': 'private_host',
      'https://intranet/v1': 'private_host',
      'https://user:pw@api.example.com/v1': 'credentials_in_url',
      'https://api.example.com/v1?key=1': 'query_not_allowed',
      'ftp://api.example.com': 'https_required',
      'not a url': 'bad_url',
    };
    for (const [u, e] of Object.entries(bad)) assert.deepEqual({ u, e: ai.validateExternalUrl(u).error }, { u, e });
    assert.equal(ai.validateExternalUrl('https://api.example.com/v1').ok, true);
    assert.equal(ai.validateExternalUrl('http://127.0.0.1:8080/v1', { allowPrivate: true }).ok, true, 'the explicit operator allow');
    assert.equal(ai.validateExternalUrl('file:///etc/passwd', { allowPrivate: true }).ok, false);
  });

  test('moderation mode maps the categories it measures, and only those', async () => {
    process.env.AI_EXTERNAL_URL = `http://127.0.0.1:${PORT}/v1`;
    process.env.AI_EXTERNAL_KEY = KEY;
    process.env.AI_EXTERNAL_ALLOW_PRIVATE = '1';
    try {
      setCfg(ON({ provider: 'external' }));
      const r = await ai.aiAnalyze('contact', { text: 'you are an idiot' });
      assert.equal(r.provider, 'external');
      assert.equal(r.labels.toxic, 0.91);
      assert.equal(r.labels.spam, undefined, 'a moderation endpoint does not measure spam: nothing is invented');
      assert.equal(seen.at(-1).url, '/v1/moderations');
      assert.equal(seen.at(-1).auth, `Bearer ${KEY}`);
      setCfg(ON({ provider: 'external', externalMode: 'chat' }));
      const c = await ai.aiAnalyze('contact', { text: 'claim your gift' });
      assert.equal(c.labels.phishing, 0.97);
      assert.equal(c.labels.toxic, undefined, '"high" is not a probability and is dropped');
      assert.equal(seen.at(-1).body.messages[1].content, 'claim your gift', 'the text travels as the user message, as data');
      const st = JSON.stringify(await ai.aiStatus());
      assert.ok(!st.includes(KEY) && !st.includes(`${PORT}/v1`));
    } finally {
      delete process.env.AI_EXTERNAL_URL; delete process.env.AI_EXTERNAL_KEY; delete process.env.AI_EXTERNAL_ALLOW_PRIVATE;
    }
  });

  test('a refused URL means the provider is not ready: null, no request', async () => {
    process.env.AI_EXTERNAL_URL = `http://127.0.0.1:${PORT}/v1`;
    process.env.AI_EXTERNAL_KEY = KEY;
    try {
      setCfg(ON({ provider: 'external' }));
      assert.equal(await ai.aiAnalyze('contact', { text: 'x' }), null);
      assert.equal(seen.length, 0);
      assert.deepEqual(ai.aiExternalState(), { configured: true, valid: false, error: 'https_required' });
    } finally { delete process.env.AI_EXTERNAL_URL; delete process.env.AI_EXTERNAL_KEY; }
  });
});

describe('BMM suggest: task → question (pure)', async () => {
  const { suggestQuestion } = await import('../src/routes/ai.mjs');
  test('tags and category need the caller\'s options; language and crash have defaults; nsfw is yes/no', () => {
    assert.deepEqual(suggestQuestion('tags', []), { error: 'options_required' });
    assert.equal(suggestQuestion('tags', ['a', 'b']).type, 'choice');
    assert.equal(suggestQuestion('language', []).options.includes('fr'), true);
    assert.equal(suggestQuestion('crash_triage', []).options.includes('out_of_memory'), true);
    assert.equal(suggestQuestion('nsfw').type, 'noul');
    assert.deepEqual(suggestQuestion('poem'), { error: 'bad_task' });
  });
});

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the AI route tests';
const MAIL = '@ai-provider.test';

describe('routes/ai.mjs over HTTP', { skip }, () => {
  let app, p, jwt, user, admin, moder, cookieUser, cookieAdmin, cookieMod;
  before(async () => {
    if (!RUN) return;
    p = await (await import('../src/lib/lib.mjs')).db();
    jwt = (await import('jsonwebtoken')).default;
    user = await p.user.create({ data: { email: `u-${Date.now()}${MAIL}`, displayName: 'ai user', role: 'USER', emailVerified: true, status: 'active' } });
    admin = await p.user.create({ data: { email: `a-${Date.now()}${MAIL}`, displayName: 'ai admin', role: 'ADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
    const su = await p.session.create({ data: { userId: user.id }, select: { id: true } });
    const sa = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
    cookieUser = `bcw_session=${jwt.sign({ uid: user.id, role: 'USER', sid: su.id }, process.env.JWT_SECRET)}`;
    cookieAdmin = `bcw_session=${jwt.sign({ uid: admin.id, role: 'ADMIN', sid: sa.id }, process.env.JWT_SECRET)}`;
    // A delegated moderator: an ordinary USER holding manage_moderation and nothing else.
    moder = await p.user.create({ data: { email: `m-${Date.now()}${MAIL}`, displayName: 'ai moderator', role: 'USER', permissions: ['manage_moderation'], totpEnabled: true, emailVerified: true, status: 'active' } });
    const sm = await p.session.create({ data: { userId: moder.id }, select: { id: true } });
    cookieMod = `bcw_session=${jwt.sign({ uid: moder.id, role: 'USER', sid: sm.id }, process.env.JWT_SECRET)}`;
    const Fastify = (await import('fastify')).default;
    app = Fastify();
    await app.register((await import('@fastify/cookie')).default);
    await app.register((await import('../src/routes/ai.mjs')).default);
    await app.register((await import('../src/routes/links.mjs')).default);
    await app.ready();
  });
  after(async () => {
    if (!RUN) return;
    ai._setSettingsLoaderForTests(null);
    await p.adminSetting.deleteMany({ where: { key: { in: [ai.AI_CONFIG_KEY, ai.AI_KILLED_KEY] } } });
    await p.auditLogEntry.deleteMany({ where: { actor: { email: { endsWith: MAIL } } } }).catch(() => {});
    await p.session.deleteMany({ where: { user: { email: { endsWith: MAIL } } } });
    await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
    await app?.close();
  });
  const post = (url, payload, cookie, headers = {}) => app.inject({ method: 'POST', url, payload, headers: { ...(cookie ? { cookie } : {}), ...headers } });

  test('suggest: anonymous is 401, a bogus Bearer key is judged as a key (401 or 503), never as a session', async () => {
    setCfg(ON());
    assert.equal((await post('/ai/bmm/suggest', { task: 'nsfw', text: 'x' })).statusCode, 401);
    const k = await post('/ai/bmm/suggest', { task: 'nsfw', text: 'x' }, cookieUser, { authorization: 'Bearer short' });
    assert.ok([401, 503].includes(k.statusCode), `${k.statusCode} ${k.body}`);
  });

  test('suggest: validation (task, text length, ≤ 50 options of ≤ 64 chars)', async () => {
    setCfg(ON());
    for (const body of [
      { task: 'poem', text: 'x' },
      { task: 'nsfw', text: '' },
      { task: 'nsfw', text: 'x'.repeat(4001) },
      { task: 'tags', text: 'x', options: Array.from({ length: 51 }, (_, i) => `t${i}`) },
      { task: 'tags', text: 'x', options: ['a'.repeat(65), 'b'] },
      { task: 'tags', text: 'x', options: ['only'] },
    ]) {
      const r = await post('/ai/bmm/suggest', body, cookieUser);
      assert.equal(r.statusCode, 400, JSON.stringify(body).slice(0, 80));
    }
  });

  test('suggest: off unless bmmSuggest; then the contract shape', async () => {
    setCfg(ON({ bmmSuggest: false }));
    let r = await post('/ai/bmm/suggest', { task: 'nsfw', text: 'a map' }, cookieUser);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { ok: false, reason: 'disabled' });
    setCfg(ON());
    r = await post('/ai/bmm/suggest', { task: 'category', text: 'a rifle', options: ['weapons', 'maps'] }, cookieUser);
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.provider, 'laya');
    assert.equal(j.result.choice, 'weapons');
    assert.equal(typeof j.result.probs.maps, 'number');
  });

  test('admin doors: a USER is refused; the kill switch round-trips through the database', async () => {
    ai._setSettingsLoaderForTests(null); // the real loader: the database
    ai._resetForTests();
    assert.equal((await app.inject({ method: 'GET', url: '/admin/ai', headers: { cookie: cookieUser } })).statusCode, 403);
    const put = await app.inject({ method: 'PUT', url: '/admin/ai/config', headers: { cookie: cookieAdmin }, payload: { provider: 'laya', enabled: true, surfaces: { contact: true }, timeoutMs: 5 } });
    assert.equal(put.statusCode, 200, put.body);
    assert.equal(put.json().config.timeoutMs, 200, 'clamped');
    assert.equal((await app.inject({ method: 'PUT', url: '/admin/ai/config', headers: { cookie: cookieAdmin }, payload: { url: 'https://x' } })).statusCode, 400, 'no URL can be stored');
    let k = await post('/admin/ai/kill', { killed: true }, cookieAdmin);
    assert.deepEqual(k.json(), { ok: true, killed: true, killedBy: 'setting' });
    assert.equal(await ai.aiAnalyze('contact', { text: 'hello' }), null);
    assert.equal(seen.length, 0);
    const st = (await app.inject({ method: 'GET', url: '/admin/ai', headers: { cookie: cookieAdmin } })).json().status;
    assert.equal(st.killed, true);
    k = await post('/admin/ai/kill', { killed: false }, cookieAdmin);
    assert.equal(k.json().killed, false);
    assert.ok(await ai.aiAnalyze('contact', { text: 'hello again' }), 'released: calls go through again');
  });

  test('admin doors are delegated with manage_moderation; switching the AI back on stays ADMIN', async () => {
    ai._setSettingsLoaderForTests(null);
    ai._resetForTests();
    const g = await app.inject({ method: 'GET', url: '/admin/ai', headers: { cookie: cookieMod } });
    assert.equal(g.statusCode, 200, g.body);
    const put = await app.inject({ method: 'PUT', url: '/admin/ai/config', headers: { cookie: cookieMod }, payload: { enabled: true } });
    assert.equal(put.statusCode, 200, put.body);
    let k = await post('/admin/ai/kill', { killed: true }, cookieMod);
    assert.equal(k.statusCode, 200, k.body);
    assert.equal(k.json().killed, true);
    k = await post('/admin/ai/kill', { killed: false }, cookieMod);
    assert.equal(k.statusCode, 403, 'a moderator may pull the switch, never release it');
    assert.equal(k.json().detail, 'admin_only_to_unkill');
    k = await post('/admin/ai/kill', { killed: false }, cookieAdmin);
    assert.equal(k.statusCode, 200, k.body);
    assert.equal(k.json().killed, false);
  });

  test('BMM key: a NEW link key carries ai:suggest, works on an unconfirmed address; an old notifications-only key is not widened', async () => {
    const { BMM_KEY_SCOPES, hashApiKey } = await import('../src/lib/lib.mjs');
    assert.deepEqual([...BMM_KEY_SCOPES], ['notifications:read', 'ai:suggest']);
    // Minted by the real door BMM uses for an already-linked account.
    const unverified = await p.user.create({ data: { email: `bmm-${Date.now()}${MAIL}`, displayName: 'bmm user', role: 'USER', emailVerified: false, status: 'active' } });
    const su = await p.session.create({ data: { userId: unverified.id }, select: { id: true } });
    const cookie = `bcw_session=${jwt.sign({ uid: unverified.id, role: 'USER', sid: su.id }, process.env.JWT_SECRET)}`;
    const old = await p.apiKey.create({ data: { userId: unverified.id, label: 'BMM notifications', prefix: 'old', hash: hashApiKey(`old-key-${Date.now()}-not-real-000000`), scopes: ['notifications:read'] } });
    const minted = await post('/me/notifications-key', {}, cookie);
    assert.equal(minted.statusCode, 200, minted.body);
    const secret = minted.json().secret;
    const row = await p.apiKey.findUnique({ where: { hash: hashApiKey(secret) } });
    assert.deepEqual(row.scopes, ['notifications:read', 'ai:suggest']);
    assert.deepEqual((await p.apiKey.findUnique({ where: { id: old.id } })).scopes, ['notifications:read'], 'an existing key keeps its scopes');

    setCfg(ON());
    const r = await post('/ai/bmm/suggest', { task: 'category', text: 'a rifle', options: ['weapons', 'maps'] }, null, { authorization: `Bearer ${secret}` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ok, true, 'the email gate does not apply to a key call');
    setCfg(ON({ bmmSuggest: false }));
    assert.deepEqual((await post('/ai/bmm/suggest', { task: 'nsfw', text: 'a map' }, null, { authorization: `Bearer ${secret}` })).json(), { ok: false, reason: 'disabled' });
    // A key without the scope is refused, whatever the switch says.
    const oldSecret = `narrow-key-${Date.now()}-not-real-0000000`;
    await p.apiKey.create({ data: { userId: unverified.id, label: 'narrow', prefix: 'nar', hash: hashApiKey(oldSecret), scopes: ['notifications:read'] } });
    setCfg(ON());
    const n = await post('/ai/bmm/suggest', { task: 'nsfw', text: 'x' }, null, { authorization: `Bearer ${oldSecret}` });
    assert.equal(n.statusCode, 403);
    assert.equal(n.json().error, 'insufficient_scope');
  });

  test('bot door: the shared secret, then the plan (402 without aiAutomod)', async () => {
    setCfg(ON());
    const body = { guildId: '123456789012345678', text: 'free nitro https://dlscord.gift/x', checks: ['phishing'] };
    assert.equal((await post('/bot/ai/automod', body, null, { 'x-bot-secret': 'wrong' })).statusCode, 401);
    const { BOT_SECRET } = await import('../src/lib/lib.mjs');
    assert.equal((await post('/bot/ai/automod', { ...body, checks: ['poem'] }, null, { 'x-bot-secret': BOT_SECRET() })).statusCode, 400);
    const r = await post('/bot/ai/automod', body, null, { 'x-bot-secret': BOT_SECRET() });
    // No plan on a throwaway database, and aiAutomod is paid by default.
    assert.equal(r.statusCode, 402, r.body);
    assert.deepEqual(r.json(), { ok: false, error: 'plan_required', feature: 'aiAutomod' });
  });
});
