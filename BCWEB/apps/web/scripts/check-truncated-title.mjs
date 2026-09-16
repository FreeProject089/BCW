#!/usr/bin/env node
// If you clip a value, the whole value has to stay reachable.
//
// `truncate` is the right call in a card or a table cell: a repo name three words too long
// must not push the row apart. What is not right is clipping the only copy of a value and
// leaving no way to read the rest. A member called "Alexandre-Beno…" is a member nobody can
// identify, and the person looking has no idea whether the name continues or the layout is
// broken.
//
// So the rule this enforces is narrow and mechanical: an element that carries `truncate` and
// whose ENTIRE content is one dynamic value must also carry `title` (or `aria-label`), which
// is one hover away and costs nothing. Mixed content (text plus a value, several values,
// nested markup) is not flagged: there the right fix is usually to stop clipping, and a
// machine cannot pick the string to show.
//
// Not a style rule. It is the "never cut the content" rule, in the one shape a script can
// check without guessing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
// <tag …truncate…>{expr}</tag> with nothing else inside.
const EL = /<(\w+)((?:[^<>]|\{[^{}]*\})*?\btruncate\b(?:[^<>]|\{[^{}]*\})*?)>\{([^{}<>]+)\}<\/\1>/g;
// A plain read: a.b?.c, a || 'x', a ?? b. Anything else (a call, a ternary) is left alone.
const PLAIN = /^[\w$]+(?:\??\.[\w$]+)*(?:\s*(?:\|\||\?\?)\s*(?:[\w$]+(?:\??\.[\w$]+)*|'[^']*'|"[^"]*"))*$/;

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : f.endsWith('.jsx') ? [p] : [];
});

let bad = 0;
for (const f of files(SRC)) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(EL)) {
    const [, , attrs, expr] = m;
    if (/\btitle=|\baria-label=/.test(attrs)) continue;
    if (!PLAIN.test(expr.trim())) continue;
    const line = s.slice(0, m.index).split('\n').length;
    console.error(`✗ ${f}:${line}  clips {${expr.trim()}} with no title`);
    bad += 1;
  }
}
if (bad) {
  console.error(`\n${bad} element(s) clip a value and offer no way to read it. Add title={the same value}.`);
  process.exit(1);
}
console.log('✓ every clipped value carries its full text in a title');
