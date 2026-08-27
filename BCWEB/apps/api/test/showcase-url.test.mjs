// Which addresses the landing showcase is willing to put in a `src` or an `href`.
//
// Every item in this list ends up on the two pages the site opens with, as a `<video src>`,
// an `<img src>` or a link somebody clicks. An admin form is a smaller threat surface than
// an open one, and it is still not a reason to accept a scheme nothing needs — a
// `javascript:` href is a script the visitor runs by clicking a project, and a `data:` src
// is a document carrying its own origin.
//
// Pure: no database, no server. It is the rule itself under test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../src/routes/misc.mjs';

describe('what the showcase will point at', () => {
  test('http and https are what media and links normally are', () => {
    assert.equal(safeUrl('https://cdn.example/demo.webm'), true);
    assert.equal(safeUrl('http://old.example/shot.png'), true);
    // Whatever an admin typed around it.
    assert.equal(safeUrl('  https://example/a.png  '), true);
  });

  test('a path on this site is allowed, because that is where an uploaded asset lives', () => {
    assert.equal(safeUrl('/api/assets/hero-bmm'), true);
    assert.equal(safeUrl('/p/bmm'), true);
  });

  test('a protocol-relative URL is NOT a path, however much it looks like one', () => {
    // `//evil.example/x` inherits the page's scheme and goes to another host. It passes any
    // check that only asks "does it start with a slash", which is the check this exists to
    // not be.
    assert.equal(safeUrl('//evil.example/x.png'), false);
  });

  test('javascript: is refused — an href is a thing a visitor clicks', () => {
    assert.equal(safeUrl('javascript:alert(1)'), false);
    // Case and padding are not a way around it.
    assert.equal(safeUrl('JaVaScRiPt:alert(1)'), false);
  });

  test('data: is refused — a document with its own origin is not a picture', () => {
    assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), false);
  });

  test('other schemes nothing here needs are refused rather than tried', () => {
    assert.equal(safeUrl('file:///C:/Windows/win.ini'), false);
    assert.equal(safeUrl('ftp://example/a.png'), false);
    assert.equal(safeUrl('vbscript:msgbox'), false);
  });

  test('empty is not a URL, and is not an error either — the field is optional', () => {
    assert.equal(safeUrl(''), false);
    assert.equal(safeUrl('   '), false);
    assert.equal(safeUrl(undefined), false);
    assert.equal(safeUrl(null), false);
  });

  test('a bare host is refused: it would be read as a relative path at request time', () => {
    // `example.com/a.png` in a src resolves against the current page, so it would fetch
    // https://thissite/example.com/a.png and 404 — a broken panel with a confusing cause.
    assert.equal(safeUrl('example.com/a.png'), false);
  });
});
