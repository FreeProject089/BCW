// safeHref(): the render-side scheme check on links that came from stored data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHref } from '../src/lib/safe-href.js';

test('ordinary addresses pass unchanged', () => {
  for (const u of [
    'https://example.com/a?b=c#d', 'http://localhost:5176/x', 'mailto:a@b.c', 'tel:+41000',
    'bmm://catalog/app?url=https%3A%2F%2Fx', '/project/abc', '#top', '?q=1', 'guide.md',
    './x/y', '/a:b', '?next=https://x', 'HTTPS://EXAMPLE.COM',
  ]) assert.equal(safeHref(u), u, u);
});

test('script and document schemes are refused, however they are spelled', () => {
  for (const u of [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'jav\u0000ascript:x', 'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'blob:https://x/y', 'ftp://x',
  ]) assert.equal(safeHref(u), undefined, JSON.stringify(u));
});

test('empty and missing values give no href at all', () => {
  for (const u of [undefined, null, '', '   ']) assert.equal(safeHref(u), undefined);
});
