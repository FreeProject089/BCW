// Full audit Sept 24 2026 (web), W2: a translated string is data, never markup.
//
// `translate_site` lets a translator who is NOT an admin override any string of the site
// (SiteLocale, served by GET /api/site/i18n/:code and layered into t()). Five strings reached
// the page through dangerouslySetInnerHTML, one of them on the public hosting checkout. The
// sweep below is the class gate: an innerHTML sink is allowed only for a named producer whose
// output is escaped or sanitised, and never for t().
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText, parseRich, sitePath } from '../src/lib/rich-text.js';

const html = (text) => renderToStaticMarkup(createElement(RichText, { text }));

describe('RichText', () => {
  test('controls: the shipped markup is drawn as markup', () => {
    assert.equal(html('flagged <b>Official</b> with a <code>bmm://</code> deeplink'),
      '<span>flagged <b>Official</b> with a <code>bmm://</code> deeplink</span>');
    assert.equal(html('I accept the <a href="/legal/terms" target="_blank" class="text-[var(--accent-ink)] underline">Terms</a>.'),
      '<span>I accept the <a class="text-[var(--accent-ink)] underline" href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms</a>.</span>');
    assert.equal(html('Paste the <span class="font-mono">BCR-XXXX-XXXX</span> ID'), '<span>Paste the <span class="font-mono">BCR-XXXX-XXXX</span> ID</span>');
  });

  test('anything that runs is text', () => {
    for (const bad of [
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<script>alert(1)</script>',
      '<b onmouseover=alert(1)>x</b>',
      '<iframe src="https://evil.test"></iframe>',
      '<<b>img src=x onerror=alert(1)>',
    ]) {
      const out = html(bad);
      assert.ok(!/<(img|svg|script|iframe)\b/i.test(out), `${bad} -> ${out}`);
      // A real tag starts with a raw `<`; escaped text is `&lt;`, so this reads tags only.
      assert.ok(!/<[a-z]+[^>]*\son\w+=/i.test(out), `${bad} -> ${out}`);
    }
  });

  test('a link goes to a path on this site or nowhere; classes are an allow-list', () => {
    for (const href of ['javascript:alert(1)', ' javascript:alert(1)', '//evil.test', '/\\evil.test', 'https://evil.test', 'data:text/html,x']) {
      const out = html(`<a href="${href}">x</a>`);
      assert.ok(!out.includes('href='), `${href} -> ${out}`);
    }
    assert.equal(sitePath('/legal/terms'), '/legal/terms');
    assert.equal(sitePath('//evil'), null);
    const over = html('<span class="fixed inset-0 z-50 font-mono">x</span>');
    assert.equal(over, '<span><span class="font-mono">x</span></span>');
  });

  test('unbalanced markup cannot swallow the rest of the sentence', () => {
    assert.deepEqual(parseRich('a </b> b'), ['a ', '</b>', ' b']);
    assert.equal(html('<b>open'), '<span><b>open</b></span>');
  });
});

// ── The sink sweep ────────────────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOTS = [join(HERE, '../src'), join(HERE, '../../../packages/bmd/src'), join(HERE, '../../../packages/bmd-editor/src'), join(HERE, '../../../packages/studio/src')];
// Each producer here returns escaped or sanitised markup, and the file that owns it says why.
const PRODUCERS = /^(?:(?:highlightCode|highlightJson|thumbnailSvg)\(|(?:html|svg)\s*\}\})/;

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(jsx?|tsx?)$/.test(f)) out.push(p);
  }
  return out;
}

describe('innerHTML sinks', () => {
  test('every dangerouslySetInnerHTML is fed by a named escaping producer, never by t()', () => {
    const bad = [];
    let seen = 0;
    for (const root of ROOTS) {
      for (const f of files(root)) {
        const src = readFileSync(f, 'utf8');
        // The expression is read as the rest of the line, not up to a `}`: a string holding
        // `{off}` would end a `[^}]*` early and the sink would not be seen at all.
        for (const m of src.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^\n]*)/g)) {
          seen++;
          const expr = m[1].trim();
          if (!PRODUCERS.test(expr) || /(^|[^\w.])t\(/.test(expr)) bad.push(`${relative(join(HERE, '..'), f)}: ${expr.slice(0, 80)}`);
        }
      }
    }
    assert.ok(seen >= 5, `the sweep found only ${seen} sinks: the pattern no longer matches the code`);
    assert.deepEqual(bad, []);
  });
});
