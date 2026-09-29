// The moderation engine's rules, without a database: every check here is a pure function
// (lib/moderation/*.mjs), so a rule that stops catching a phishing lookalike, or a regex guard
// that lets a catastrophic pattern through, fails here in milliseconds.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fold, skeleton, textHashes, hasWord, editDistance, countInvisible } from '../src/lib/moderation/text.mjs';
import { extractUrls, checkUrl, checkLinks } from '../src/lib/moderation/links.mjs';
import { compilePattern, runPatterns, analyseShape, chunks, LIMITS } from '../src/lib/moderation/patterns.mjs';
import { heuristics } from '../src/lib/moderation/heuristics.mjs';
import { floodReasons, _resetFlood } from '../src/lib/moderation/flood.mjs';
import { normalizePolicy, normalizePolicies, scoreToDecision, applyMode, actionFor, DEFAULT_THRESHOLDS, SURFACES } from '../src/lib/moderation/policy.mjs';
import { trustReasons } from '../src/lib/moderation/trust.mjs';
import { normalizeRules } from '../src/lib/moderation/config.mjs';
import { combine, aiReasons } from '../src/lib/moderation/engine.mjs';

const rules = (list) => list.map((r) => r.rule);

describe('text normalisation', () => {
  test('fold removes invisible characters, accents and Cyrillic lookalikes', () => {
    assert.equal(fold('Fr​ee  NÍTRO'), 'free nitro');
    assert.equal(fold('dіscord'), 'discord'); // Cyrillic і
    assert.equal(countInvisible('a​b‮c﻿'), 3);
  });
  test('skeleton maps leetspeak and collapses repeats', () => {
    assert.equal(skeleton('Fr33 N1TR0!!'), 'frenitro'.replace('frenitro', skeleton('free nitro')));
    assert.equal(skeleton('steeeam'), 'steam');
  });
  test('the loose hash sees through spacing and leet; short texts have none', () => {
    const a = textHashes('Get your FREE nitro here, click now');
    const b = textHashes('get   your fr33 n1tro here!! click now');
    assert.equal(a.loose, b.loose);
    assert.notEqual(a.exact, b.exact);
    assert.equal(textHashes('thanks, that fixed it').loose, null);
    assert.equal(textHashes('thanks, that fixed it').exact, null);
  });
  test('hasWord matches whole words only', () => {
    assert.ok(hasWord('buy cheap pills now', 'cheap pills'));
    assert.ok(!hasWord('scunthorpe united', 'cunt'));
  });
  test('editDistance with early exit', () => {
    assert.equal(editDistance('discord', 'discorcl'), 2);
    assert.equal(editDistance('steamcomunity', 'steamcomunlty'), 1);
    assert.ok(editDistance('abc', 'xyzxyzxyz', 2) > 2);
  });
});

describe('links: extraction', () => {
  test('scheme URLs and bare domains, not file names or versions', () => {
    const urls = extractUrls('see https://example.com/a?b=1, also bit.ly/xyz and file.txt v1.2.3 [x](http://evil.xyz/login).');
    assert.ok(urls.includes('https://example.com/a?b=1'));
    assert.ok(urls.includes('bit.ly/xyz'));
    assert.ok(urls.some((u) => u.startsWith('http://evil.xyz/login')));
    assert.ok(!urls.some((u) => u.includes('file.txt')));
    assert.ok(!urls.some((u) => u.includes('1.2.3')));
  });
  test('javascript: and data: are found', () => {
    assert.ok(extractUrls('click javascript:alert(1)').some((u) => u.startsWith('javascript:')));
  });
});

describe('links: phishing checks', () => {
  test('a script scheme is decisive', () => {
    assert.deepEqual(rules(checkUrl('javascript:alert(1)')), ['link.scheme_script']);
    assert.equal(checkUrl('data:text/html;base64,xx')[0].weight, 100);
  });
  test('an official domain is quiet, even on a gift path', () => {
    assert.deepEqual(checkUrl('https://discord.com/nitro'), []);
    assert.deepEqual(checkUrl('https://github.com/login'), []);
    assert.deepEqual(checkUrl('https://store.steampowered.com/account'), []);
  });
  test('a homoglyph (IDN) lookalike of a protected brand', () => {
    const r = rules(checkUrl('https://dіscord.com/gift/abc')); // Cyrillic і
    assert.ok(r.includes('link.punycode'), r.join());
    assert.ok(r.includes('link.lookalike'), r.join());
  });
  test('one or two edits away from a long brand name', () => {
    assert.ok(rules(checkUrl('https://steamcommunlty.com/tradeoffer')).includes('link.lookalike'));
    assert.ok(rules(checkUrl('https://dlscord.gift/x')).includes('link.lookalike'));
  });
  test('a short brand does not flag every similar word', () => {
    assert.ok(!rules(checkUrl('https://stream.tv/live')).includes('link.lookalike'));
    assert.ok(!rules(checkUrl('https://livestream.com/')).some((x) => x.startsWith('link.brand')));
  });
  test('the brand in front of another domain, with a credential path', () => {
    const r = rules(checkUrl('https://paypal.com.secure-account.xyz/verify/login'));
    assert.ok(r.includes('link.brand_in_subdomain'), r.join());
    assert.ok(r.includes('link.credential_path'), r.join());
    assert.ok(r.includes('link.risky_tld'), r.join());
  });
  test('shorteners and raw IPs', () => {
    assert.ok(rules(checkUrl('https://bit.ly/3abc')).includes('link.shortener'));
    assert.ok(rules(checkUrl('http://185.12.3.4/login')).includes('link.ip_host'));
  });
  test('the admin allowlist wins over every check but the script scheme', () => {
    assert.deepEqual(checkUrl('https://bit.ly/x', { allowDomains: ['bit.ly'] }), []);
    assert.equal(checkUrl('https://evil.example/x', { blockDomains: ['evil.example'] })[0].rule, 'link.blocklisted');
  });
  test('the Terms blocklist (BlockedUrl rows) is a signal too', () => {
    const r = checkUrl('https://cdn.pirate.example/file.zip', { blockedRules: [{ id: 'b1', scope: 'domain', pattern: 'pirate.example' }] });
    assert.equal(r[0].rule, 'link.blocklisted');
  });
  test('many different sites in one message', () => {
    const r = checkLinks(['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'].map((d) => `https://${d}`));
    assert.ok(rules(r.reasons).includes('link.many'));
  });
});

describe('patterns: the catastrophic-regex guard', () => {
  test('refuses the exponential shapes', () => {
    assert.equal(compilePattern('(a+)+$').error, 'nested_quantifier');
    assert.equal(compilePattern('(a|aa)*b').error, 'nested_quantifier');
    assert.equal(compilePattern('(\\w+\\s?)*$').error, 'nested_quantifier');
    assert.equal(compilePattern('(?:x+){10}').error, 'nested_quantifier');
  });
  test('refuses two unbounded quantifiers, backreferences, empty matches, bad syntax', () => {
    assert.equal(compilePattern('.*free.*nitro').error, 'too_many_unbounded');
    assert.equal(compilePattern('(a)\\1').error, 'backreference');
    assert.equal(compilePattern('a*').error, 'matches_empty');
    assert.equal(compilePattern('(').error, 'invalid');
    assert.equal(compilePattern('x'.repeat(LIMITS.maxLen + 1)).error, 'too_long');
  });
  test('accepts the patterns people actually write', () => {
    for (const src of ['fr[e3]{1,3}\\s*n[i1]tro', 'discord\\.gift/\\w+', '(?:free|cheap) (?:robux|vbucks)', 'steam\\s?gift', '\\bbuy\\b.{0,20}followers']) {
      const c = compilePattern(src);
      assert.ok(c.ok, `${src}: ${c.error}`);
    }
  });
  test('character classes and escapes do not fool the shape scanner', () => {
    assert.deepEqual(analyseShape('[(+*)]+x'), { nested: false, unbounded: 1 });
    assert.deepEqual(analyseShape('\\(a+\\)+'), { nested: false, unbounded: 2 });
  });
  test('only i, m, s, u flags survive', () => {
    assert.equal(compilePattern('abc', 'gimsuy').flags, 'imsu');
  });
  test('a long text is matched in bounded chunks', () => {
    const parts = chunks('a'.repeat(5000));
    assert.ok(parts.every((c) => c.length <= LIMITS.chunk));
    assert.ok(parts.length <= LIMITS.maxChunks);
  });
  test('the per-message budget stops the pass and says so', () => {
    const re = compilePattern('never-matches-this').re;
    const list = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, re, weight: 5, label: '' }));
    const r = runPatterns(list, 'x'.repeat(8000), -1);
    assert.equal(r.exhausted, true);
    assert.equal(r.hits.length, 0);
  });
  test('a hit reports its label', () => {
    const c = compilePattern('fr[e3]{2}\\s*nitro');
    const r = runPatterns([{ id: 'n', re: c.re, weight: 40, label: 'free nitro' }], 'get FR33 nitro now');
    assert.deepEqual(r.hits.map((h) => h.label), ['free nitro']);
  });
  test('the rules normaliser drops a bad pattern and says why', () => {
    const { rules: r, errors } = normalizeRules({ patterns: [{ pattern: '(a+)+' }, { pattern: 'ok\\d{2}' }], keywords: [{ term: 'x' }, { term: 'Cheap Pills', weight: 40 }], blockDomains: ['https://Evil.example/path', 'not a domain'] });
    assert.equal(r.patterns.length, 1);
    assert.equal(r.keywords[0].term, 'cheap pills');
    assert.deepEqual(r.blockDomains, ['evil.example']);
    assert.deepEqual(errors.map((e) => `${e.list}:${e.error}`).sort(), ['blockDomains:not_a_domain', 'keywords:too_short', 'patterns:nested_quantifier']);
  });
});

describe('shape heuristics', () => {
  test('capitals, repetition, zalgo, invisible characters, mass mentions', () => {
    assert.ok(rules(heuristics('THIS IS ALL IN CAPITALS FOR NO REASON')).includes('heur.caps'));
    assert.ok(rules(heuristics('buyyyyyyyyyyyyyyyy now')).includes('heur.repetition'));
    assert.ok(rules(heuristics('spam spam spam spam spam spam spam spam')).includes('heur.repetition'));
    assert.ok(rules(heuristics('h̶̵̴e̷̸̡l̢̧̨l̴̵̶o')).includes('heur.zalgo'));
    assert.ok(rules(heuristics('pay​​pal​')).includes('heur.invisible'));
    assert.ok(rules(heuristics('hey @everyone look')).includes('heur.mass_mentions'));
    assert.ok(rules(heuristics('<@123456> <@123457> <@123458> <@123459> <@123450>', { discord: true })).includes('heur.mass_mentions'));
  });
  test('ordinary text and separator lines stay quiet', () => {
    assert.deepEqual(heuristics('The download button is grey on the catalog page.'), []);
    assert.deepEqual(heuristics('----------------------------------\nStack trace\n=================='), []);
    assert.deepEqual(heuristics('Café, crème brûlée, naïve résumé'), []);
  });
});

describe('flood and duplicates (in memory, REDIS_URL unset)', () => {
  const policy = { flood: { max: 3, windowSec: 60 }, dup: { windowSec: 600, crossAuthors: 3 } };
  const h = textHashes('A message long enough to have both hashes, really');
  test('over the limit is flood.rate, far over it is flood.burst', async () => {
    _resetFlood();
    const who = { authorId: 'u-flood', ip: '10.0.0.1' };
    const seen = [];
    for (let i = 0; i < 7; i++) seen.push(rules(await floodReasons('contact', who, { exact: null, loose: null }, policy)));
    assert.deepEqual(seen[2], []);
    assert.ok(seen[3].includes('flood.rate'));
    assert.ok(seen[6].includes('flood.burst'));
  });
  test('an anonymous sender is counted by address; accounts behind one address are not', async () => {
    _resetFlood();
    let last = [];
    for (let i = 0; i < 4; i++) last = rules(await floodReasons('contact', { ip: '10.0.0.9' }, { exact: null, loose: null }, policy));
    assert.ok(last.includes('flood.rate'));
    _resetFlood();
    for (let i = 0; i < 6; i++) last = rules(await floodReasons('contact', { authorId: `office-${i}`, ip: '10.0.0.9' }, { exact: null, loose: null }, policy));
    assert.deepEqual(last, [], 'six colleagues behind one NAT are six people');
  });
  test('the same text twice from one sender, and from three senders', async () => {
    _resetFlood();
    const p0 = { ...policy, flood: { max: 0, windowSec: 60 } };
    assert.deepEqual(rules(await floodReasons('contact', { authorId: 'a' }, h, p0)), []);
    assert.ok(rules(await floodReasons('contact', { authorId: 'a' }, h, p0)).includes('dup.same_author'));
    await floodReasons('contact', { authorId: 'b' }, h, p0);
    assert.ok(rules(await floodReasons('contact', { authorId: 'c' }, h, p0)).includes('dup.cross_author'));
  });
  test('a near-duplicate (same skeleton) is caught', async () => {
    _resetFlood();
    const p0 = { ...policy, flood: { max: 0, windowSec: 60 } };
    await floodReasons('contact', { authorId: 'n' }, textHashes('Get your FREE nitro here, click now'), p0);
    const r = rules(await floodReasons('contact', { authorId: 'n' }, textHashes('get   your fr33 n1tro here!! click now'), p0));
    assert.ok(r.includes('dup.near'), r.join());
  });
  test('a dry run counts nothing', async () => {
    _resetFlood();
    for (let i = 0; i < 10; i++) assert.deepEqual(await floodReasons('contact', { authorId: 'dry' }, h, policy, { count: false }), []);
  });
});

describe('policies: score → decision', () => {
  test('thresholds', () => {
    const th = DEFAULT_THRESHOLDS;
    assert.equal(scoreToDecision(0, th), 'ALLOW');
    assert.equal(scoreToDecision(th.flag, th), 'FLAG');
    assert.equal(scoreToDecision(th.review, th), 'REVIEW');
    assert.equal(scoreToDecision(th.quarantine, th), 'QUARANTINE');
    assert.equal(scoreToDecision(th.block + 50, th), 'BLOCK');
  });
  test('modes', () => {
    const P = (mode) => normalizePolicy('contact', { mode });
    assert.deepEqual(applyMode('BLOCK', P('auto')), { decision: 'BLOCK', status: 'open' });
    assert.deepEqual(applyMode('BLOCK', P('flag')), { decision: 'FLAG', status: 'open' });
    assert.deepEqual(applyMode('FLAG', P('review')), { decision: 'REVIEW', status: 'open' });
    assert.deepEqual(applyMode('BLOCK', P('analyze')), { decision: 'ALLOW', status: 'logged' });
    assert.deepEqual(applyMode('ALLOW', P('auto')), { decision: 'ALLOW', status: null });
  });
  test('report and legal always end in REVIEW, whatever is stored', () => {
    for (const s of ['report', 'legal']) {
      const pol = normalizePolicy(s, { mode: 'auto' });
      assert.equal(pol.mode, 'review');
      assert.equal(pol.sensitive, true);
      assert.equal(applyMode('BLOCK', pol).decision, 'REVIEW');
      assert.equal(applyMode('ALLOW', pol).decision, 'REVIEW');
      assert.equal(applyMode('ALLOW', pol).status, null, 'a clean report opens no case: its own queue is the review');
    }
  });
  test('thresholds are forced to climb; junk falls back to defaults', () => {
    const pol = normalizePolicy('contact', { thresholds: { flag: 50, review: 10, quarantine: 'x', block: 20 } });
    assert.ok(pol.thresholds.flag <= pol.thresholds.review && pol.thresholds.review <= pol.thresholds.quarantine && pol.thresholds.quarantine <= pol.thresholds.block);
    assert.equal(normalizePolicy('contact', { mode: 'nonsense' }).mode, 'flag');
    assert.deepEqual(Object.keys(normalizePolicies(null)).sort(), [...SURFACES].sort());
  });
  test('what the caller does with a decision', () => {
    assert.equal(actionFor('BLOCK', { canRefuse: true }), 'refuse');
    assert.equal(actionFor('BLOCK', { canHold: true }), 'hold');
    assert.equal(actionFor('BLOCK', {}), 'allow');
    assert.equal(actionFor('QUARANTINE', { canRefuse: true }), 'allow');
    assert.equal(actionFor('QUARANTINE', { canHold: true }), 'hold');
    assert.equal(actionFor('REVIEW', { canHold: true, canRefuse: true }), 'allow');
  });
});

describe('scoring', () => {
  test('one weight per rule, keywords add up (capped), overrides apply', () => {
    const c = combine([
      { rule: 'link.shortener', weight: 20, detail: 'a' }, { rule: 'link.shortener', weight: 20, detail: 'b' },
      { rule: 'text.keyword', weight: 60, detail: 'x' }, { rule: 'text.keyword', weight: 60, detail: 'y' },
      { rule: 'heur.caps', weight: 10 },
    ], { 'heur.caps': 0 });
    const by = Object.fromEntries(c.map((r) => [r.rule, r.weight]));
    assert.equal(by['link.shortener'], 20);
    assert.equal(by['text.keyword'], 100);
    assert.equal(by['heur.caps'], 0);
  });
  test('trust amplifies content that already scored, never creates a case alone', () => {
    const fresh = { ageDays: 0.1, verified: false, staff: false, status: 'active', sanctions: 0 };
    assert.deepEqual(trustReasons(fresh, { contentScore: 0 }), []);
    assert.deepEqual(rules(trustReasons(fresh, { contentScore: 20 })).sort(), ['trust.new_account', 'trust.unverified']);
    assert.equal(trustReasons({ ...fresh, staff: true }, { contentScore: 0 })[0].rule, 'trust.staff');
  });
  test('AI probabilities become small weights', () => {
    const r = aiReasons({ provider: 'laya', labels: { spam: 0.95, phishing: 0.8, toxic: 0.2, 'bad label!': 1 } });
    assert.deepEqual(r.map((x) => [x.rule, x.weight]), [['ai.spam', 25], ['ai.phishing', 12]]);
    assert.deepEqual(aiReasons(null), []);
  });
});
