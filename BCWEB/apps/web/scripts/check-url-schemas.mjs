#!/usr/bin/env node
// `z.string().url()` is not a URL check, and this is the fourth time that mattered.
//
// WHY THIS EXISTS
//
// zod's `.url()` asks `new URL(value)` whether the string parses. `javascript:alert(1)`
// parses. So do `data:` and `vbscript:`. It is a syntax check wearing the name of a safety
// check, which is why it kept being reached for.
//
// Four fields stored through it were rendered as an `<a href>`, and React 18 puts a
// javascript: href into the DOM with a console warning and nothing else — the edge CSP has
// 'unsafe-inline' in script-src, so nothing downstream stops it either:
//
//   marketplace redeemUrl   a seller scoped to ONE project → every visitor to that project
//   OAuth homepageUrl       any signed-in account → the CONSENT screen, where somebody is
//                           deciding whether to hand an app their account
//   repo links.*            any repo owner → the repo page AND the repos listing, so one
//                           hostile repo reaches everyone browsing the list
//
// Each was found by looking at one field. This looks at all of them.
//
// THE RULE: a field whose name says it holds a link uses `httpUrl(max)` from lib.mjs, which
// PARSES and demands http(s). Not `z.string().url()`, and not a `startsWith` either — a
// leading tab and a newline inside the scheme both survive a prefix match and both still run.
//
// Exceptions are listed below WITH the check that replaces them. An exception with no
// reason is how this comes back.
//
// Usage: node scripts/check-url-schemas.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '../../api/src/routes');
const LIB = join(HERE, '../../api/src/lib');

/** Where `z.string().url()` is allowed to stay, and what actually guards the value. */
const ALLOWED = {
  'oidc-provider.mjs:redirectUris':
    'badRedirect() runs on all four write routes and is stricter than httpUrl — it also '
    + 'refuses plain http off localhost, a wildcard host, credentials and a #fragment',
  'webhooks.mjs:url':
    'delivered through safeFetch, which refuses non-http(s) schemes, blocks private and '
    + 'link-local addresses, requires every DNS answer to be public, and re-checks each hop',
};

const fail = [];
const files = readdirSync(ROUTES).filter((f) => f.endsWith('.mjs'));
let checked = 0;
let exempt = 0;

for (const f of files) {
  const src = readFileSync(join(ROUTES, f), 'utf8');
  // `name: z.string().url()` and `name: z.array(z.string().url())`, with the field name.
  for (const m of src.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\.(?:array\(\s*)?z?\.?string\(\)\.url\(\)/g)) {
    checked += 1;
    const key = `${f}:${m[1]}`;
    if (ALLOWED[key]) { exempt += 1; continue; }
    const line = src.slice(0, m.index).split('\n').length;
    fail.push(`${f}:${line}  "${m[1]}" uses z.string().url()\n`
      + '    That accepts javascript:, data: and vbscript: — new URL() parses all three.\n'
      + '    Use httpUrl(max) from lib.mjs, or add it to ALLOWED with the check that guards it.');
  }
}

// The helper itself has to keep parsing rather than prefix-matching. A `startsWith('http')`
// here would pass every test above and let `\tjavascript:` through, because the browser
// strips the whitespace and this would not.
const lib = readFileSync(join(LIB, 'lib.mjs'), 'utf8');
const helper = lib.slice(lib.indexOf('export const httpUrl'), lib.indexOf('export const httpUrl') + 400);
if (!helper.includes('new URL(')) {
  fail.push('httpUrl no longer parses the value.\n'
    + '    A prefix match passes every case a test is likely to try and still admits\n'
    + '    "\\tjavascript:" — the browser strips the whitespace, startsWith does not.');
}
if (!/protocol === 'http:'/.test(helper) || !/protocol === 'https:'/.test(helper)) {
  fail.push('httpUrl no longer checks the protocol against http/https.');
}

if (fail.length) {
  console.error(`✗ url schemas: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`✓ url schemas OK — ${files.length} route file(s), ${checked} z.string().url() use(s), `
  + `${exempt} exempt with a stated reason; httpUrl still parses`);
