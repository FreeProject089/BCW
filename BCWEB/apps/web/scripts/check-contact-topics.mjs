#!/usr/bin/env node
// Every `?topic=` a page links to must be a topic the contact form knows.
//
// WHY THIS EXISTS
//
// The hosting page offers three ways to get in touch, and each button carries its own
// `?topic=` — which picks the form's kind AND pre-fills the template that tells somebody what
// to put in the message. contact.jsx keys that off a TOPICS map.
//
// The two live in different files, and a link naming a topic the map has never heard of does
// not fail. The form opens with the generic template, the person writes whatever occurs to
// them, and the reply asks for the five things the template would have collected. That is a
// slow, quiet cost: nobody reports it, because from the outside it looks like a contact form.
//
// The reverse direction is cheap to check at the same time and is worth knowing: a topic in
// the map that nothing links to is either a dead template or, as here, a deliberately kept
// alias for links already sent — so it is reported, not failed.
//
// Usage: node scripts/check-contact-topics.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, '../src/pages');

const contact = readFileSync(join(PAGES, 'contact.jsx'), 'utf8');
const block = contact.slice(contact.indexOf('const TOPICS = {'));
const known = new Set(
  [...block.slice(0, block.indexOf('\n};')).matchAll(/^\s{2}'([a-z0-9-]+)':/gm)].map((m) => m[1]),
);
if (known.size < 2) {
  console.error('✗ could not read TOPICS from contact.jsx');
  process.exit(1);
}

// Where the topics actually come from.
//
// The first version of this script looked for `?topic=<literal>` and found NOTHING, then
// printed a tick — the hosting page builds its links as `/contact?topic=${topic}` from a
// table of rows, so there is no literal in the URL to match. A checker that reports green
// while checking nothing is worse than no checker, so it now reads the table.
//
// Both shapes are collected: a row `['host-project', Icon, …]` feeding a `?topic=${…}`
// template, and a plain literal `?topic=x` if anyone writes one.
const linked = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.jsx?$/.test(e.name)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/[?&]topic=([a-z0-9-]+)/g)) {
      if (!linked.has(m[1])) linked.set(m[1], e.name);
    }
    // A file that interpolates a topic into a /contact link declares its topics somewhere
    // above as the first element of each row. Only files that DO build such a link are read
    // this way, so an unrelated string array elsewhere is never mistaken for a topic.
    if (/[?&]topic=\$\{/.test(src)) {
      for (const m of src.matchAll(/^\s*\[\s*'([a-z0-9-]+)'\s*,/gm)) {
        if (!linked.has(m[1])) linked.set(m[1], e.name);
      }
    }
  }
};
walk(join(HERE, '../src'));
if (linked.size === 0) {
  // The failure this script was written badly enough to have once: nothing found, tick
  // printed. There ARE contact links; finding none means the reader broke, not the app.
  console.error('✗ contact topics: found no ?topic= link at all — this reader is broken, not the app');
  process.exit(1);
}

const fail = [];
for (const [topic, file] of linked) {
  if (!known.has(topic)) {
    fail.push(`${file} links ?topic=${topic}, which contact.jsx does not know\n`
      + '    The form would open with the generic template instead of that topic\'s, silently.\n'
      + `    Add it to TOPICS in contact.jsx, or fix the link.`);
  }
}

if (fail.length) {
  console.error(`✗ contact topics: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}

const unlinked = [...known].filter((t) => !linked.has(t));
console.log(`✓ contact topics OK — ${linked.size} link(s) across the app, all known to the form`
  + (unlinked.length ? `; ${unlinked.length} kept but unlinked (${unlinked.join(', ')})` : ''));
