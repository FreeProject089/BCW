#!/usr/bin/env node
// No URL in the bundle may name a domain that is not ours.
//
// Found three times in one audit: `https://bettercommunity.app/...` — .app, a TLD this
// project has never owned — hardcoded into the developer page's copyable snippets, the
// try-it panel's fallback and a showcase mockup. A visitor who pasted the curl example got a
// request to somebody else's site, or to nothing, and no check said a word: it is a valid
// URL, valid JSX and valid English.
//
// The rule this enforces is narrower than "no hardcoded URLs", on purpose:
//   · `location.origin` is the right way to show an address, and it is what everything else
//     here uses — in dev it says localhost because that is where your key works right now,
//     deployed it says the deployed domain;
//   · a literal fallback for the no-window case must be the real domain, bettercommunity.ch;
//   · `bettercommunity.` followed by anything else is the bug, wherever it appears.
//
// The server side needs no gate: boot-guard.mjs already refuses a production boot whose
// SITE_URL is unset, localhost or http, so every API fallback is unreachable in prod.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const OK_TLD = 'ch';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
if (files.length < 50) {
  console.error(`✗ only ${files.length} source files found — the walk is broken, refusing to report success`);
  process.exit(2);
}

const findings = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/bettercommunity\.([a-z]{2,10})/gi)) {
    if (m[1].toLowerCase() === OK_TLD) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push({ file: relative('.', file), line, found: m[0] });
  }
}

if (findings.length) {
  console.error(`✗ a domain that is not ours is written into the bundle:\n`);
  for (const f of findings) console.error(`    ${f.file}:${f.line}  ${f.found}`);
  console.error(`\n  The site's address is bettercommunity.${OK_TLD}. For anything shown to a`);
  console.error('  visitor, use location.origin so dev shows dev and prod shows prod.');
  process.exit(1);
}
console.log(`✓ no foreign domain in the bundle — ${files.length} file(s), only bettercommunity.${OK_TLD} appears`);
