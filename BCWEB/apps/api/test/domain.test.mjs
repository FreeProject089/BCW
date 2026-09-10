// Which hostnames we agree to serve, and who may claim one.
//
// This is a certificate-issuance decision, not a formatting one: a host that passes here is
// a host the edge will obtain a TLS certificate for on demand, for whoever pointed a CNAME at
// us. Every case below is something that would otherwise be a way to make us issue one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHost, isServableHost, isOurOwnHost, domainEligible, txtMatches, genVerifyToken } from '../src/lib/domain.mjs';

describe('normaliseHost', () => {
  test('folds case and drops the trailing dot', () => {
    assert.equal(normaliseHost('Mods.Example.COM.'), 'mods.example.com');
  });

  test('accepts what people actually paste', () => {
    // The browser shows a URL, so that is what lands in the field.
    assert.equal(normaliseHost('https://mods.example.com/repo.json'), 'mods.example.com');
    assert.equal(normaliseHost('  mods.example.com/  '), 'mods.example.com');
    assert.equal(normaliseHost('mods.example.com:8443'), 'mods.example.com');
  });

  test('gives one falsy answer for junk', () => {
    for (const x of ['', '   ', null, undefined, 'https://']) assert.equal(normaliseHost(x), '');
  });
});

describe('isServableHost', () => {
  test('an ordinary subdomain is fine', () => {
    assert.equal(isServableHost('mods.example.com'), true);
    assert.equal(isServableHost('a.b.c.example.co.uk'), true);
  });

  test('a wildcard is refused', () => {
    // On-demand issuance cannot produce a wildcard certificate, so accepting the string
    // would store a row promising something that can never work.
    assert.equal(isServableHost('*.example.com'), false);
  });

  test('a single label is refused', () => {
    assert.equal(isServableHost('localhost'), false);
    assert.equal(isServableHost('com'), false);
  });

  test('an IP address is refused', () => {
    assert.equal(isServableHost('192.168.1.10'), false);
    assert.equal(isServableHost('[::1]'), false);
  });

  test('underscores and empty labels are refused', () => {
    assert.equal(isServableHost('_dmarc.example.com'), false);
    assert.equal(isServableHost('mods..example.com'), false);
    assert.equal(isServableHost('.example.com'), false);
  });

  test('an over-long label or host is refused', () => {
    assert.equal(isServableHost(`${'a'.repeat(64)}.example.com`), false);
    assert.equal(isServableHost(`${'a'.repeat(63)}.example.com`), true);
    assert.equal(isServableHost(`${`${'a'.repeat(60)}.`.repeat(5)}example.com`.padEnd(260, 'x')), false);
  });

  test('a URL still resolves to its host', () => {
    assert.equal(isServableHost('https://mods.example.com/'), true);
  });
});

describe('isOurOwnHost', () => {
  test('our apex and anything under it cannot be claimed', () => {
    assert.equal(isOurOwnHost('bettercommunity.test', 'bettercommunity.test'), true);
    assert.equal(isOurOwnHost('www.bettercommunity.test', 'bettercommunity.test'), true);
    assert.equal(isOurOwnHost('a.b.bettercommunity.test', 'bettercommunity.test'), true);
  });

  test('a name that merely ENDS with the same letters is not ours', () => {
    // "notbettercommunity.test" ends with "bettercommunity.test" as a string. The dot in the
    // comparison is the whole difference between a suffix check and a subdomain check.
    assert.equal(isOurOwnHost('notbettercommunity.test', 'bettercommunity.test'), false);
  });

  test('no site host configured means nothing is refused on that ground', () => {
    assert.equal(isOurOwnHost('mods.example.com', ''), false);
  });
});

describe('domainEligible', () => {
  const hosted = (over = {}) => ({ hosted: true, hostPath: 'me/repo', group: { id: 'g', freePlan: false }, ...over });

  test('a hosted thing in a paid pool may have one', () => {
    assert.deepEqual(domainEligible(hosted()), { ok: true });
  });

  test('the free tier may not', () => {
    assert.equal(domainEligible(hosted({ group: { id: 'g', freePlan: true } })).reason, 'free_plan');
  });

  test('something with no pool may not', () => {
    assert.equal(domainEligible(hosted({ group: null })).reason, 'no_pool');
  });

  test('a repo we do not host may not — there is nothing here to serve at that name', () => {
    assert.equal(domainEligible({ hosted: false, hostPath: null, group: { freePlan: false } }).reason, 'not_hosted');
  });

  test('nothing is not eligible', () => {
    assert.equal(domainEligible(null).reason, 'not_found');
  });
});

describe('txtMatches', () => {
  const TOK = 'bcwv_0123456789abcdef0123456789abcdef';

  test('a plain record matches', () => {
    assert.equal(txtMatches([[TOK]], TOK), true);
  });

  test('a record split into chunks is joined before comparing', () => {
    // One TXT record may be several strings; a resolver hands them back separately and they
    // are only meaningful concatenated.
    assert.equal(txtMatches([['bcwv_0123456789abcdef', '0123456789abcdef']], TOK), true);
  });

  test('quotes and whitespace some providers add do not break it', () => {
    assert.equal(txtMatches([[`  "${TOK}"  `]], TOK), true);
  });

  test('a zone full of other records does not match', () => {
    assert.equal(txtMatches([['v=spf1 -all'], ['google-site-verification=x']], TOK), false);
  });

  test('an empty answer, and an empty token, never match', () => {
    assert.equal(txtMatches([], TOK), false);
    assert.equal(txtMatches(null, TOK), false);
    // The dangerous one: a row whose token was never set must not be verifiable by a zone
    // that publishes an empty TXT.
    assert.equal(txtMatches([['']], ''), false);
  });
});

describe('genVerifyToken', () => {
  test('is prefixed and unguessable', () => {
    const t = genVerifyToken();
    assert.match(t, /^bcwv_[0-9a-f]{32}$/);
    assert.equal(new Set(Array.from({ length: 100 }, genVerifyToken)).size, 100);
  });
});
