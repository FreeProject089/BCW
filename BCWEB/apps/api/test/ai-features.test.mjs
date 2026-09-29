// aios (agent-bcw-ai-os): the AI features' rules (lib/ai-features.mjs) and key sealing
// (lib/ai-keys.mjs), without a database. The HTTP half is ai-features-routes.test.mjs.
//
// Pinned here: settings can never switch a limit off or make a staff tool public; a sealed key
// round-trips, refuses the wrong owner and a rotated secret, and the envelope does not contain
// the key; a member's provider URL obeys the operator's external-provider rules; the no-AI
// fallbacks answer something sensible; the pre-post check never names a rule, a keyword or a
// list, and ignores the author's account age.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'ai-features-test-secret';
delete process.env.AI_KEYS_SECRET;
delete process.env.AI_EXTERNAL_ALLOW_PRIVATE;

const F = await import('../src/lib/ai-features.mjs');
const K = await import('../src/lib/ai-keys.mjs');

describe('settings are bounded', () => {
  test('defaults: everything a member could use is OFF, BYOK is off, the site key is not for paid plans', () => {
    const c = F.normalizeFeatures(null);
    for (const id of ['suggest_tags', 'detect_language', 'content_check', 'describe', 'summarize']) assert.equal(c.features[id].enabled, false, id);
    assert.equal(c.byok.enabled, false);
    assert.equal(c.site.forPaid, false);
  });
  test('a staff tool cannot be opened to everyone, a limit cannot be zeroed or made infinite', () => {
    const c = F.normalizeFeatures({
      features: { summarize: { enabled: true, audience: 'all' }, describe: { audience: 'bogus', perUserPerDay: 1e9 } },
      limits: { perUserPerMin: 0, perIpPerMin: -5, globalPerDay: 'lots' },
      pricing: { site: { inPerMTok: 1e9 } },
      siteKey: 'sk-should-never-be-stored-here',
    });
    assert.equal(c.features.summarize.audience, 'staff');
    assert.equal(c.features.describe.audience, 'paid');
    assert.equal(c.features.describe.perUserPerDay, F.FEATURE_BOUNDS.perUserPerDay[1]);
    assert.equal(c.limits.perUserPerMin, 1);
    assert.equal(c.limits.perIpPerMin, 1);
    assert.equal(c.limits.globalPerDay, 20000);
    assert.equal(c.pricing.site.inPerMTok, 1000);
    assert.ok(!JSON.stringify(c).includes('sk-should'), 'an unknown key is dropped');
  });
  test('estimateCost: site and external are priced, BYOK and Laya are not', () => {
    const c = F.normalizeFeatures({ pricing: { site: { inPerMTok: 1, outPerMTok: 2 }, external: { inPerMTok: 3 } } });
    assert.equal(F.estimateCost(c, 'site', 1_000_000, 1_000_000), 3);
    assert.equal(F.estimateCost(c, 'external', 1_000_000, 0), 3);
    assert.equal(F.estimateCost(c, 'byok', 1_000_000, 1_000_000), 0);
    assert.equal(F.estimateCost(c, 'laya', 1_000_000, 1_000_000), 0);
  });
});

describe('keys at rest', () => {
  const KEY = ['sk', 'test', 'abcdefghijklmnop1234'].join('-');
  test('sealed, opened by its owner only, never readable in the envelope', () => {
    const env = K.sealKey(KEY, 'user1');
    assert.ok(!env.includes(KEY) && !env.includes('abcdefghijklmnop'));
    assert.equal(K.openKey(env, 'user1'), KEY);
    assert.equal(K.openKey(env, 'user2'), null, 'an envelope copied onto another account opens nothing');
    assert.equal(K.last4(KEY), '1234');
    assert.equal(K.last4('short'), '', 'a short key shows nothing at all');
  });
  test('a rotated secret makes the key unreadable, not wrong', () => {
    const env = K.sealKey(KEY, 'site');
    process.env.AI_KEYS_SECRET = 'rotated-secret-value';
    try { assert.equal(K.openKey(env, 'site'), null); } finally { delete process.env.AI_KEYS_SECRET; }
    assert.equal(K.openKey(env, 'site'), KEY);
  });
  test('an edited envelope is refused', () => {
    const e = JSON.parse(K.sealKey(KEY, 'u'));
    e.data = Buffer.from('tampered').toString('base64');
    assert.equal(K.openKey(JSON.stringify(e), 'u'), null);
  });
  test('the provider URL follows the external-provider rules', () => {
    assert.equal(K.checkBaseUrl('http://api.example.com/v1').ok, false);
    assert.equal(K.checkBaseUrl('https://127.0.0.1/v1').error, 'private_address');
    assert.equal(K.checkBaseUrl('https://10.1.2.3/v1').error, 'private_address');
    assert.equal(K.checkBaseUrl('https://localhost/v1').ok, false);
    assert.equal(K.checkBaseUrl('https://user:pw@api.example.com/v1').error, 'credentials_in_url');
    assert.equal(K.checkBaseUrl('https://api.example.com/v1?key=x').error, 'query_not_allowed');
    const ok = K.checkBaseUrl('https://api.example.com/v1/');
    assert.equal(ok.ok, true);
    assert.equal(ok.url, 'https://api.example.com/v1');
    assert.equal(ok.host, 'api.example.com');
  });
  test('buildSiteKey stores the envelope, the host and 4 characters', () => {
    const b = F.buildSiteKey({ baseUrl: 'https://api.example.com/v1', key: KEY, model: 'gpt-x' });
    assert.ok(b.value);
    assert.ok(!JSON.stringify(b.value).includes(KEY));
    const pub = F.publicSiteKey(b.value);
    assert.deepEqual(Object.keys(pub).sort(), ['host', 'last4', 'model', 'set', 'setAt']);
    assert.equal(pub.last4, '1234');
    assert.equal(F.buildSiteKey({ baseUrl: 'https://api.example.com', key: 'has spaces in it', model: '' }).error, 'bad_key');
  });
});

describe('the no-AI fallbacks', () => {
  test('language by function words', () => {
    assert.equal(F.detectLanguageLocal('Ceci est une extension pour le jeu, avec des options dans la page.').lang, 'fr');
    assert.equal(F.detectLanguageLocal('This is a plugin for the game and it adds a map with the tools you need.').lang, 'en');
    assert.equal(F.detectLanguageLocal('Das ist eine Erweiterung und sie ist nicht mit der alten Version kompatibel.').lang, 'de');
    assert.equal(F.detectLanguageLocal('ok').lang, null);
  });
  test('tags by word overlap, best first', () => {
    const r = F.suggestTagsLocal('A texture pack that improves weapons and armor textures', ['Textures', 'Weapons', 'Maps', 'User interface']);
    assert.deepEqual(r.map((x) => x.tag).sort(), ['Textures', 'Weapons']);
    assert.deepEqual(F.suggestTagsLocal('nothing relevant', ['Maps']), []);
  });
  test('near-duplicates cluster, different texts do not', () => {
    const items = [
      { id: 'a', text: 'The download link on the catalog page for the texture pack is broken and returns 404' },
      { id: 'b', text: 'the download link on the catalog page for the texture pack is broken, it returns a 404' },
      { id: 'c', text: 'Please add a dark theme to the settings screen of the manager' },
    ];
    const c = F.clusterDuplicates(items, 0.4);
    assert.equal(c.length, 1);
    assert.deepEqual(c[0].ids.sort(), ['a', 'b']);
  });
  test('triage: held, high-score and old cases come first; the AI weighs less than the rules', () => {
    const now = Date.now();
    const fresh = new Date(now).toISOString();
    const held = F.triageScore({ held: true, score: 10, createdAt: fresh }, now).score;
    const rules = F.triageScore({ score: 120, createdAt: fresh }, now).score;
    const aiOnly = F.triageScore({ score: 10, ai: { labels: { spam: 0.95 } }, createdAt: fresh }, now).score;
    const plain = F.triageScore({ score: 10, createdAt: fresh }, now).score;
    const old = F.triageScore({ score: 10, createdAt: new Date(now - 72 * 3600_000).toISOString() }, now);
    assert.ok(held > plain && rules > aiOnly && aiOnly > plain);
    assert.ok(old.score > plain && old.why.includes('old'));
  });
  test('crash causes by keyword', () => {
    assert.equal(F.crashCauseLocal('panicked: out of memory while allocating 2 GB'), 'out_of_memory');
    assert.equal(F.crashCauseLocal('DXGI_ERROR_DEVICE_REMOVED in d3d12'), 'gpu_driver');
    assert.equal(F.crashCauseLocal('could not load vcruntime140.dll'), 'missing_dependency');
    assert.equal(F.crashCauseLocal('something odd happened'), 'other');
  });
});

describe('the pre-post check is coarse', () => {
  test('categories, never a rule name, a keyword or a list', () => {
    const w = F.coarseWarnings({
      decision: 'REVIEW',
      reasons: [
        { rule: 'text.keyword', weight: 30, detail: 'free nitro' },
        { rule: 'link.lookalike', weight: 40, detail: 'dlscord.gift looks like discord.com' },
        { rule: 'heur.caps', weight: 5, detail: '80% capitals' },
      ],
    });
    assert.equal(w.level, 'likely');
    assert.deepEqual(w.categories, ['links', 'shape', 'wording']);
    const dump = JSON.stringify(w);
    assert.ok(!/nitro|dlscord|keyword|lookalike|caps/.test(dump), dump);
  });
  test('the author\'s account age is not the text\'s fault', () => {
    const w = F.coarseWarnings({ decision: 'REVIEW', reasons: [{ rule: 'trust.new_account', weight: 40 }, { rule: 'trust.unverified', weight: 20 }] });
    assert.deepEqual(w, { level: 'ok', categories: [] });
  });
  test('a known false positive cancels out', () => {
    const w = F.coarseWarnings({ reasons: [{ rule: 'text.keyword', weight: 30 }, { rule: 'fp.known', weight: -30 }] });
    assert.deepEqual(w, { level: 'ok', categories: [] });
  });
});
