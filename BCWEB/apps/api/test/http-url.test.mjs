// A link somebody will click.
//
// Born red against a real one. `z.string().url()` does not check that a string is a URL of
// any particular kind — it asks `new URL()` whether it parses, and `javascript:alert(1)`
// parses. Eleven fields across the API used it; `redeemUrl` is rendered by the public
// storefront as `<a href={pr.redeemUrl}>`, and React 18 puts a javascript: href into the DOM
// with a console warning and nothing else. This site's CSP carries 'unsafe-inline' in
// script-src, so the browser does not stop it either.
//
// A marketplace seller scoped to a single project — not an admin — could set it, and reach
// every visitor to that project's page.
//
// The check parses rather than matching a prefix, which is the part worth testing: a leading
// tab and an embedded newline both survive `startsWith('http')` and both still run when the
// browser resolves the scheme.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { httpUrl } from '../src/lib/lib.mjs';

const ok = (v) => httpUrl().safeParse(v).success;

describe('httpUrl', () => {
  test('the schemes that execute are refused', () => {
    for (const v of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',            // the scheme is case-insensitive
      'jAvAsCrIpT:alert(1)',
      '\tjavascript:alert(1)',          // leading whitespace is stripped by the parser
      '\njavascript:alert(1)',
      ' javascript:alert(document.cookie)',
      'java\nscript:alert(1)',          // a newline INSIDE the scheme, which browsers ignore
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
    ]) assert.equal(ok(v), false, `${JSON.stringify(v)} must be refused`);
  });

  test('the schemes that read the server are refused too', () => {
    // Not the XSS case: these matter where a stored URL is FETCHED rather than clicked.
    for (const v of ['file:///etc/passwd', 'ftp://x/y', 'gopher://x', 'blob:https://x/y'])
      assert.equal(ok(v), false, `${v} must be refused`);
  });

  test('ordinary links still pass', () => {
    for (const v of [
      'https://bettercommunity.ch',
      'http://localhost:5176/x?y=1#z',
      'https://example.com/a/b?q=%20&r=1',
      'https://user:pass@example.com/p',
      'https://xn--bcher-kva.example',   // punycode
    ]) assert.equal(ok(v), true, `${v} must pass`);
  });

  test('nonsense is refused rather than throwing', () => {
    for (const v of ['', 'not a url', '//example.com', '/relative', 'example.com'])
      assert.equal(ok(v), false, `${JSON.stringify(v)} must be refused`);
  });

  test('a non-string is refused rather than throwing', () => {
    for (const v of [null, undefined, 0, {}, ['https://x']]) assert.equal(ok(v), false);
  });
});
