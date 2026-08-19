import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, normalizeUrl, hostUnder, findBlock, findAllow, urlsOfMeta } from '../src/lib/urlblock.mjs';

describe('hostOf', () => {
    test('strips scheme, www, port and case', () => {
        for (const u of ['https://WWW.Example.com/a/b', 'http://example.com:8080/x', 'example.com', '//example.com/z']) {
            assert.equal(hostOf(u), 'example.com', u);
        }
    });
    test('a non-web scheme has no host — it must not read as an empty host that matches nothing safely', () => {
        assert.equal(hostOf('javascript:alert(1)'), '');
        assert.equal(hostOf('data:text/html,x'), '');
        assert.equal(hostOf('ftp://example.com/f'), '');
    });
    test('garbage in, empty out', () => {
        for (const u of ['', null, undefined, '   ', 'http://']) assert.equal(hostOf(u), '');
    });
});

describe('normalizeUrl', () => {
    test('same address written five ways collapses to one', () => {
        const want = 'https://example.com/mods/file.zip';
        for (const u of [
            'https://example.com/mods/file.zip',
            'https://WWW.Example.com/mods/file.zip',
            'https://example.com:443/mods/file.zip',
            'https://example.com/mods/file.zip/',
            'https://example.com/mods/file.zip#top',
        ]) assert.equal(normalizeUrl(u), want, u);
    });
    test('the query string is KEPT — it is often the whole identity of a download', () => {
        assert.equal(normalizeUrl('https://example.com/dl?file=a'), 'https://example.com/dl?file=a');
        assert.notEqual(normalizeUrl('https://example.com/dl?file=a'), normalizeUrl('https://example.com/dl?file=b'));
    });
    test('http and https are different addresses and are not merged', () => {
        assert.notEqual(normalizeUrl('http://example.com/x'), normalizeUrl('https://example.com/x'));
    });
    test('a non-default port survives', () => {
        assert.equal(normalizeUrl('http://example.com:8080/x'), 'http://example.com:8080/x');
    });
});

describe('hostUnder', () => {
    test('the host itself and its subdomains', () => {
        assert.ok(hostUnder('example.com', 'example.com'));
        assert.ok(hostUnder('cdn.example.com', 'example.com'));
        assert.ok(hostUnder('a.b.example.com', 'example.com'));
    });
    test('THE SUFFIX BUG: notexample.com is not under example.com', () => {
        assert.equal(hostUnder('notexample.com', 'example.com'), false);
        assert.equal(hostUnder('myexample.com', 'example.com'), false);
        assert.equal(hostUnder('example.com.evil.net', 'example.com'), false);
    });
    test('a rule written with www. still covers the bare domain', () => {
        assert.ok(hostUnder('example.com', 'www.example.com'));
        assert.ok(hostUnder('cdn.example.com', 'www.example.com'));
    });
    test('blocking a subdomain does not block its parent', () => {
        assert.equal(hostUnder('example.com', 'cdn.example.com'), false);
    });
});

describe('findBlock', () => {
    const RULES = [
        { id: 'r1', scope: 'domain', pattern: 'warez.example' },
        { id: 'r2', scope: 'url', pattern: 'https://cdn.ok.example/bad/file.zip' },
    ];

    test('a domain rule catches a subdomain', () => {
        const hit = findBlock(RULES, ['https://dl.warez.example/x.zip']);
        assert.equal(hit?.rule.id, 'r1');
        assert.equal(hit.url, 'https://dl.warez.example/x.zip');
    });
    test('a url rule catches only that address, not its siblings', () => {
        assert.equal(findBlock(RULES, ['https://cdn.ok.example/bad/file.zip'])?.rule.id, 'r2');
        assert.equal(findBlock(RULES, ['https://cdn.ok.example/bad/other.zip']), null);
    });
    test('a url rule still matches through cosmetic differences', () => {
        assert.equal(findBlock(RULES, ['https://WWW.cdn.ok.example/bad/file.zip/'])?.rule.id, 'r2');
    });
    test('it reports WHICH url tripped, so the refusal can name it', () => {
        const hit = findBlock(RULES, ['https://fine.example/a', 'https://warez.example/b']);
        assert.equal(hit.url, 'https://warez.example/b');
    });
    test('clean input, no rules, empty rules — all null rather than throwing', () => {
        assert.equal(findBlock(RULES, ['https://fine.example/a']), null);
        assert.equal(findBlock([], ['https://warez.example/a']), null);
        assert.equal(findBlock(null, ['https://warez.example/a']), null);
        assert.equal(findBlock(RULES, []), null);
        assert.equal(findBlock(RULES, [null, undefined, '', 42]), null);
    });
    test('a single string is accepted, not only an array', () => {
        assert.equal(findBlock(RULES, 'https://warez.example/x')?.rule.id, 'r1');
    });
    test('a non-http listing cannot be matched by a domain rule by accident', () => {
        assert.equal(findBlock(RULES, ['javascript:location="//warez.example"']), null);
    });
});

describe('allow rules', () => {
    // The case this exists for: a whole host is blocked, but one address on it is fine —
    // the project's own release page under a domain that also serves reuploads.
    const RULES = [
        { id: 'b1', scope: 'domain', pattern: 'mixed.example' },
        { id: 'a1', scope: 'url', allow: true, pattern: 'https://mixed.example/official/release.zip' },
    ];

    test('the allowed address passes while the rest of the domain does not', () => {
        assert.equal(findBlock(RULES, ['https://mixed.example/official/release.zip']), null);
        assert.equal(findBlock(RULES, ['https://mixed.example/warez/x.zip'])?.rule.id, 'b1');
    });
    test('an allow rule beats a block rule regardless of which is more specific', () => {
        const inverted = [
            { id: 'b2', scope: 'url', pattern: 'https://a.example/f.zip' },
            { id: 'a2', scope: 'domain', allow: true, pattern: 'a.example' },
        ];
        // The broad allow wins over the narrow block. Stated as a rule you can hold, not as
        // a specificity contest nobody can predict.
        assert.equal(findBlock(inverted, ['https://a.example/f.zip']), null);
    });
    test('an allow rule normalises like any other — spelling does not decide it', () => {
        assert.equal(findBlock(RULES, ['https://WWW.mixed.example/official/release.zip/']), null);
    });
    test('one allowed url in a set does not rescue a blocked sibling', () => {
        const hit = findBlock(RULES, ['https://mixed.example/official/release.zip', 'https://mixed.example/bad.zip']);
        assert.equal(hit?.url, 'https://mixed.example/bad.zip');
    });
    test('allow-only rules block nothing', () => {
        assert.equal(findBlock([RULES[1]], ['https://anything.example/x']), null);
    });
    test('findAllow names the rule that permitted it, for explaining a decision', () => {
        assert.equal(findAllow(RULES, 'https://mixed.example/official/release.zip')?.id, 'a1');
        assert.equal(findAllow(RULES, 'https://mixed.example/other.zip'), null);
        assert.equal(findAllow(RULES, 'not a url'), null);
    });
});

describe('urlsOfMeta', () => {
    test('collects every URL-bearing field, both spellings', () => {
        const got = urlsOfMeta({
            download_url: 'https://a.example/1', downloadUrl: 'https://b.example/2',
            icon_url: 'https://c.example/3', thumb: 'https://d.example/4',
            name: 'not a url', version: '1.0', count: 3,
        });
        assert.deepEqual(got, ['https://a.example/1', 'https://b.example/2', 'https://c.example/3', 'https://d.example/4']);
    });
    test('a missing or non-object meta is empty, not a throw', () => {
        for (const m of [null, undefined, 'x', 42, {}]) assert.deepEqual(urlsOfMeta(m), []);
    });
});
