// A ::: directive's URL attributes cannot break out of the attribute they are written into.
//
// mdToEmailHtml renders the markdown of a broadcast, a newsletter, a contact answer and the
// data export. Its directives take `{href=…}`, `{image=…}` and `{url=…}`, and those were
// checked for an http(s) scheme and then interpolated RAW into `href="…"` / `src="…"`. mdAttrs
// keeps a `"` inside an unquoted or single-quoted value, so
//
//     :::card{href=https://x"onmouseover="alert(1)}
//
// passed the scheme check and closed the attribute: the mail carried an event handler, and
// `{url=https://x/"><img src=https://tracker/…>}` carried arbitrary markup. (Semgrep
// html-in-template-string pointed at the line; the file's own header promised the opposite.)
//
// The assertion is on the STRUCTURE of the output, not on a substring: every <a> and <img>
// the renderer emits must carry only the attributes the renderer writes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mdToEmailHtml } from '../src/lib/mail.mjs';

/** The tags of one name in an HTML string, each with its attribute names (a tolerant tokenizer). */
function tags(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const attrs = [];
    const a = /\s*([^\s="'>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    let t;
    while ((t = a.exec(m[1])) && t[0]) attrs.push(t[1].toLowerCase());
    out.push(attrs);
  }
  return out;
}

const WRITES = { a: ['href', 'style'], img: ['src', 'alt', 'style'] };

function assertOnlyOwnAttributes(html) {
  for (const [name, allowed] of Object.entries(WRITES)) {
    for (const attrs of tags(html, name)) {
      for (const at of attrs) assert.ok(allowed.includes(at), `<${name}> carries "${at}", which the renderer never writes:\n${html}`);
    }
  }
  assert.doesNotMatch(html, /<script/i, 'a <script> tag reached the mail');
}

describe('mail directives: URL attributes stay inside their quotes', () => {
  test('the tokenizer sees an injected attribute (control: the check can fail)', () => {
    // If this passed on a broken tag the tests below would prove nothing.
    assert.deepEqual(tags('<a href="https://x"onmouseover="alert(1)" style="">', 'a'), [['href', 'onmouseover', 'style']]);
  });

  test(':::card{href=…} with a quote in an unquoted value', () => {
    const html = mdToEmailHtml(':::card{href=https://x"onmouseover="alert(1)}\nHello\n:::');
    assertOnlyOwnAttributes(html);
    assert.match(html, /href="https:\/\/x&quot;onmouseover=&quot;alert\(1\)"/);
  });

  test(":::card{image='…'} with a quote in a single-quoted value", () => {
    const html = mdToEmailHtml(":::card{image='https://x/a.png\" onerror=\"alert(1)'}\nHello\n:::");
    assertOnlyOwnAttributes(html);
    assert.equal(tags(html, 'img').length, 1);
  });

  test(':::file{url=…} cannot close the tag and add markup', () => {
    const html = mdToEmailHtml(':::file[Get it]{url=https://x/"><script>alert(1)</script>}\n:::');
    assertOnlyOwnAttributes(html);
    assert.equal(tags(html, 'img').length, 0);
  });

  test('a plain link is unchanged, and a non-http scheme is still dropped', () => {
    const ok = mdToEmailHtml(':::card{href=https://bettercommunity.ch/blog?a=1&b=2}\nHi\n:::');
    assert.match(ok, /href="https:\/\/bettercommunity\.ch\/blog\?a=1&amp;b=2"/);
    const js = mdToEmailHtml(':::card{href=javascript:alert(1)}\nHi\n:::');
    assert.equal(tags(js, 'a').length, 0, 'a javascript: card must not become a link');
  });
});
