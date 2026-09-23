// The studio's author-supplied values, at the points where they reach a sink.
//
// A studio page is written by a per-project editor and read by every visitor, including the
// admins who review it. So every value an author types that ends up in an `href`, a `style`
// or a `<style>` element is filtered here, in pure functions the renderer calls — and each
// hostile shape below is one that a filter of this kind has let through somewhere before
// (PLAN-STUDIO-2026 section 1.4, S1 to S5).
//
// Imported as a namespace and looked up INSIDE each test, so a missing export fails that test
// by name instead of throwing at import and taking the whole file down with one message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as canvas from '../src/lib/canvas.js';
import * as cssScope from '../src/lib/css-scope.js';

const fn = (mod, name) => {
  assert.equal(typeof mod[name], 'function', `${name} is not exported`);
  return mod[name];
};

// Every spelling a browser still reads as a script, a different origin or nothing at all.
const HOSTILE_LINKS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  '\x01javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  '//evil.example/x',
  '/\\evil.example/x',
  '/\t/evil.example/x',
  '\\\\evil.example/x',
];

test('S1: safeLink refuses every script, data and protocol-relative spelling', () => {
  for (const bad of HOSTILE_LINKS) assert.equal(canvas.safeLink(bad), '', `accepted ${JSON.stringify(bad)}`);
  for (const ok of ['/p/bmm', '#top', 'https://example.com/a', 'http://example.com', 'mailto:a@b.c']) {
    assert.equal(canvas.safeLink(ok), ok, `refused ${ok}`);
  }
});

test('S1: a button link or download target goes through the link policy', () => {
  const buttonTarget = fn(canvas, 'buttonTarget');
  for (const bad of HOSTILE_LINKS) {
    assert.equal(buttonTarget({ type: 'link', href: bad }).href, '', `link accepted ${JSON.stringify(bad)}`);
    assert.equal(buttonTarget({ type: 'download', href: bad }).href, '', `download accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(buttonTarget({ type: 'link', href: 'https://example.com' }), { type: 'link', href: 'https://example.com', external: true, reason: '' });
  assert.equal(buttonTarget({ type: 'link', href: '/docs' }).external, false);
  // A download is a file: an anchor or a mail address is not one.
  assert.equal(buttonTarget({ type: 'download', href: '#top' }).href, '');
  assert.equal(buttonTarget({ type: 'download', href: 'mailto:a@b.c' }).href, '');
  assert.equal(buttonTarget({ type: 'download', href: '/uploads/x.zip' }).href, '/uploads/x.zip');
});

test('S1: a dropdown item goes through the same policy', () => {
  const menuItemHref = fn(canvas, 'menuItemHref');
  for (const bad of HOSTILE_LINKS) assert.equal(menuItemHref(bad), '', `accepted ${JSON.stringify(bad)}`);
  assert.equal(menuItemHref('/p/bmm'), '/p/bmm');
});

test('S2: the api action is inert, and says why', () => {
  const buttonTarget = fn(canvas, 'buttonTarget');
  const r = buttonTarget({ type: 'api', path: '/api/admin/users/x/role', method: 'POST', open: 'url' });
  assert.equal(r.type, 'inert');
  assert.equal(r.href, '');
  assert.equal(r.reason, 'api_removed');
  assert.ok(!canvas.BUTTON_ACTIONS.includes('api'), 'the editor still offers the api action');
});

test('S2: scroll takes an element id, never a free selector', () => {
  const buttonTarget = fn(canvas, 'buttonTarget');
  assert.equal(buttonTarget({ type: 'scroll', target: '#pricing' }).href, '#pricing');
  assert.equal(buttonTarget({ type: 'scroll', target: '' }).href, '#top');
  for (const bad of ['body > div', 'a[href^=x]', '#a, #b', '#x:has(input)']) {
    assert.equal(buttonTarget({ type: 'scroll', target: bad }).type, 'inert', `accepted ${bad}`);
  }
});

test('S3: a forged block id is rewritten at normalisation', () => {
  const forged = 'x"]{}body{background:url(https://evil.example/p)}[data-anim="';
  const c = canvas.normalizeCanvas({ id: 'c"]{}*{color:red}', blocks: [
    { id: forged, kind: 'box', x: 0, y: 0, w: 100, h: 100 },
    { id: 'ok_id-1', kind: 'box', x: 0, y: 200, w: 100, h: 100 },
  ] });
  assert.match(c.blocks[0].id, /^[A-Za-z0-9_-]{1,60}$/);
  assert.equal(c.blocks[1].id, 'ok_id-1', 'a conforming id is left alone');
  assert.match(c.id, /^[A-Za-z0-9_-]{1,60}$/);
  // Two forged ids must not collapse onto one.
  const d = canvas.normalizeCanvas({ blocks: [{ id: '"a' }, { id: '"b' }] });
  assert.notEqual(d.blocks[0].id, d.blocks[1].id);
});

test('S4: safeCssValue refuses what fetches, accepts what paints', () => {
  const safeCssValue = fn(cssScope, 'safeCssValue');
  for (const bad of [
    'url(https://evil.example/p.png)',
    'url("//evil.example/p.png")',
    '#fff url(https://evil.example/p.png)',
    '\\75 rl(https://evil.example/p.png)',
    'image-set("https://evil.example/p.png" 1x)',
    '-webkit-image-set(url(https://evil.example/p.png) 1x)',
    'expression(alert(1))',
    'red;background:url(https://evil.example/p)',
    'red}body{color:red',
  ]) assert.equal(safeCssValue(bad), '', `accepted ${JSON.stringify(bad)}`);
  for (const ok of ['#fff', 'rgba(0,0,0,.5)', 'var(--primary)', 'color-mix(in srgb, var(--primary) 10%, transparent)',
    'linear-gradient(90deg, #000, #fff)', 'url(/uploads/a.png) center/cover', 'transparent']) {
    assert.equal(safeCssValue(ok), ok, `refused ${ok}`);
  }
  assert.equal(safeCssValue(''), '');
  assert.equal(safeCssValue(undefined), '');
});

test('S5: position fixed and sticky are refused in the page stylesheet and inline', () => {
  const { css, refused } = cssScope.scopeCss('.a{position:fixed;inset:0;color:red}.b{position: sticky}.c{position:relative}', '[data-cv="c1"]');
  assert.ok(!/fixed|sticky/i.test(css), `the scoped sheet kept it: ${css}`);
  assert.ok(/color:red/.test(css), 'the rest of the rule went with it');
  assert.ok(/position:relative/.test(css), 'an ordinary position was refused too');
  assert.ok(refused.some((r) => /position/.test(r)), 'the refusal was not reported');
  // Escaped, as the browser reads it.
  assert.ok(!/fixed/i.test(cssScope.scopeCss('.a{position:\\66 ixed}', '[data-cv="c1"]').css));
  const inline = cssScope.safeInlineStyle('position: fixed; inset: 0; color: red');
  assert.equal(inline.position, undefined);
  assert.equal(inline.color, 'red');
  assert.equal(cssScope.safeInlineStyle('position: \\66 ixed').position, undefined);
  assert.equal(cssScope.safeInlineStyle('position: absolute').position, 'absolute');
});
