#!/usr/bin/env node
// The admin guide has to describe the dashboard that exists.
//
// It was written once, as prose about the screens, and then left to drift: a reader sitting on
// a screen had no way to reach the page about it (two "Learn more" links existed on the whole
// site, both pointing at hosting settings), and nothing noticed when a tab was added and the
// guide was not. The Languages screen, which is the one tab a translator who is not an admin
// can reach, had no entry at all.
//
// GUIDE_TABS names, per entry, the tabs it documents. That is what the per-screen Guide link
// resolves through, so this file checks the two ways it can be wrong:
//   · a tab in the sidebar that no entry claims — the guide is behind the product;
//   · an entry claiming a tab that no longer exists — the guide is ahead of it, and the link
//     from that screen would resolve to nothing.
// Plus the older failure: a `?s=guide&g=<id>` link naming an entry that is not there.
//
// Two ids are exempt by name and by reason: `hostingsettings` and `economy` document a group
// of SETTINGS rather than a screen, and are reached from the pointers beside those settings.
import { readFileSync } from 'node:fs';

const guide = readFileSync('src/pages/admin-guide.jsx', 'utf8');
const admin = readFileSync('src/pages/admin.jsx', 'utf8');

const SETTINGS_ONLY = new Set(['hostingsettings', 'economy']);

// The entries, as written: G('id', …
const entries = new Set([...guide.matchAll(/\bG\('([a-z0-9-]+)'/g)].map((m) => m[1]));
// The map, read out of the GUIDE_TABS literal.
const mapBody = guide.slice(guide.indexOf('export const GUIDE_TABS = {'), guide.indexOf('\n};', guide.indexOf('export const GUIDE_TABS = {')));
const mapped = new Map([...mapBody.matchAll(/^\s{2}([a-z0-9-]+): \[([^\]]*)\]/gm)]
  .map((m) => [m[1], [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])]));
// The tabs, as the sidebar declares them: { id: 'x', label: t('adm.tab…
const tabs = new Set([...admin.matchAll(/\{ id: '([a-z0-9-]+)', label: t\('adm\.tab/g)].map((m) => m[1]));

let bad = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); bad += 1; };

if (entries.size < 10 || mapped.size < 10 || tabs.size < 20) {
  console.error(`✗ read ${entries.size} entr(ies), ${mapped.size} mapping(s) and ${tabs.size} tab(s) — the shape moved, so this check cannot be trusted`);
  process.exit(2);
}

for (const [id, list] of mapped) {
  if (!entries.has(id)) fail(`GUIDE_TABS names "${id}", which is not an entry in GUIDE`);
  for (const tab of list) if (!tabs.has(tab)) fail(`the guide entry "${id}" claims the tab "${tab}", which the sidebar no longer has`);
}
for (const id of entries) {
  if (!mapped.has(id) && !SETTINGS_ONLY.has(id)) fail(`the guide entry "${id}" names no screen, so nothing links to it`);
}
// `guide` documents itself and needs no entry.
for (const tab of tabs) {
  if (tab === 'guide') continue;
  const owner = [...mapped].find(([, list]) => list.includes(tab));
  if (!owner) fail(`the tab "${tab}" is in the sidebar and no guide entry covers it`);
}
// Every deep link names a real entry.
for (const m of admin.matchAll(/\?s=guide&g=([a-z0-9-]+)/g)) {
  if (!entries.has(m[1])) fail(`a link points at ?g=${m[1]}, which is not a guide entry`);
}

if (bad) {
  console.error(`\n${bad} problem(s): the guide and the dashboard disagree about what exists.`);
  process.exit(1);
}
console.log(`✓ guide covers the dashboard — ${entries.size} entr(ies) over ${tabs.size} tab(s), every link resolves`);
