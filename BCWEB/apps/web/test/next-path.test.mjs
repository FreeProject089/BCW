// Full audit Sept 24 2026 (web), W4: `/auth?next=` may not leave the site, including through an
// API route that redirects. `/api/avatar/<id>` answers 302 to whatever the member stored as
// `avatar.image`, so "a same-origin path" was not the same thing as "stays on the site".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTarget } from '../src/lib/next-path.js';

const O = 'https://bettercommunity.example';
const nt = (s) => nextTarget(s, O);

describe('nextTarget', () => {
  test('pages of the app are router navigations (control)', () => {
    assert.deepEqual(nt('/profile'), { server: false, href: '/profile' });
    assert.deepEqual(nt('/blog/hello?x=1#c'), { server: false, href: '/blog/hello?x=1#c' });
    assert.deepEqual(nt('/teams/join/abc'), { server: false, href: '/teams/join/abc' });
  });

  test('the two server routes that need a real navigation still get one (control)', () => {
    assert.deepEqual(nt('/oauth2/authorize?client_id=a&redirect_uri=b'), { server: true, href: '/oauth2/authorize?client_id=a&redirect_uri=b' });
    assert.deepEqual(nt('/api/telemetry/authorize'), { server: true, href: '/api/telemetry/authorize' });
  });

  test('an API route that redirects is not a destination', () => {
    for (const s of ['/api/avatar/u1', '/api/avatar/u1?size=80', '/api/catalog/x/download', '/oauth2/logout']) {
      assert.equal(nt(s), null, s);
    }
  });

  test('dot segments are resolved before the allow-list is read', () => {
    for (const s of ['/oauth2/authorize/../../api/avatar/u1', '/oauth2/authorize/%2e%2e/%2e%2e/api/avatar/u1', '/api/telemetry/authorize/../../avatar/u1', '/x/../api/avatar/u1']) {
      assert.equal(nt(s), null, s);
    }
  });

  test('other hosts, however spelled, are refused', () => {
    for (const s of ['//evil.test', '/\\evil.test', '/\t/evil.test', 'https://evil.test', ' /evil', 'javascript:alert(1)', '/%0a/evil.test', '', null, undefined, 42]) {
      const r = nt(s);
      assert.ok(r === null || !/evil/.test(new URL(r.href, O).host), JSON.stringify(s));
    }
    assert.equal(nt('//evil.test'), null);
    assert.equal(nt('/\\evil.test'), null);
  });
});

describe('the sign-in page asks nextTarget, and nothing else', () => {
  test('signin.jsx has no hand-rolled ?next= rule left', () => {
    const src = readFileSync(new URL('../src/pages/signin.jsx', import.meta.url), 'utf8');
    assert.ok(src.includes('nextTarget('), 'signin.jsx does not use nextTarget');
    assert.ok(!/next\w*\s*&&\s*next\w*\.startsWith\(/.test(src), 'a startsWith() rule for next is back');
    assert.ok(!/startsWith\('\/api\/'\)/.test(src), 'a blanket /api/ real navigation is back');
  });
});
