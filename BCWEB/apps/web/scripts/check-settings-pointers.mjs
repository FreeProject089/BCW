// Every "this is configured elsewhere" link points at a setting that exists.
//
// Half the settings governing an admin screen live on ANOTHER screen, and until these
// pointers existed the screen said nothing: somebody looking at product files had no way to
// learn that the pool they draw from is a number on Hosting settings, let alone which tab.
//
// The destination is DERIVED — `SettingsPointer` looks the group up in the settings catalog
// rather than carrying a `?s=settings&hs=capacity` written beside it — so a setting moved to
// another group re-points every pointer on every screen. That leaves exactly one way for one
// to break: naming a key that is not in the catalog. Then `HS_TAB_OF_KEY[first]` is
// undefined, the component renders NOTHING, and the screen silently goes back to not saying
// where its settings are. No error, no blank space, no way to notice.
//
// So: every key named in a pointer must exist. And the first key especially, because it is
// the one that decides where the link goes.
//
//   node scripts/check-settings-pointers.mjs
import { readFileSync } from 'node:fs';

const SRC = 'src/pages/admin.jsx';
const CATALOG = 'src/lib/hosting-settings.js';

const src = readFileSync(SRC, 'utf8');
const catalog = readFileSync(CATALOG, 'utf8');

// The catalog's keys, read as text: importing it would work and would also mean this check
// stops running the moment that module gains an import of its own.
const known = new Set([...catalog.matchAll(/^\s*\['([a-zA-Z][a-zA-Z0-9._]*)',/gm)].map((m) => m[1]));
if (known.size < 20) {
  console.error(`✗ read ${known.size} setting key(s) from ${CATALOG} — the shape moved, so this check cannot be trusted`);
  process.exit(2);
}

// `<SettingsPointer … keys={['a', 'b']}`. The attribute may sit before or after className.
const pointers = [...src.matchAll(/<SettingsPointer[^>]*?keys=\{\[([^\]]*)\]\}/gs)];
if (pointers.length === 0) {
  console.error('✗ found no <SettingsPointer> at all — either they were removed or this pattern is stale');
  process.exit(2);
}

const bad = [];
let total = 0;
for (const m of pointers) {
  const keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (keys.length === 0) { bad.push('a pointer with an empty key list — it renders nothing'); continue; }
  keys.forEach((k, i) => {
    total++;
    if (!known.has(k)) {
      bad.push(i === 0
        ? `"${k}" is the FIRST key of a pointer and is not a setting — the whole link disappears`
        : `"${k}" is named by a pointer and is not a setting — it renders as a raw key`);
    }
  });
}

// A pointer whose keys are all in one group is the normal case; one that spans groups is
// fine too (the first key wins), but worth saying out loud, because the reader of the
// sentence is told about settings on a tab the link does not open.
const groupOf = {};
for (const g of catalog.matchAll(/gk: '([a-z]+)', icon: '[^']*', keys: \[([\s\S]*?)\n  \] \}/g)) {
  for (const k of g[2].matchAll(/\['([a-zA-Z][a-zA-Z0-9._]*)',/g)) groupOf[k[1]] = g[1];
}
const split = [];
for (const m of pointers) {
  const keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((k) => known.has(k));
  const groups = [...new Set(keys.map((k) => groupOf[k]).filter(Boolean))];
  if (groups.length > 1) split.push(`${keys.join(', ')} → ${groups.join(' + ')}`);
}

if (bad.length) {
  console.error('✗ a settings pointer names something that is not a setting:\n');
  for (const b of bad) console.error(`    ${b}`);
  console.error(`
  SettingsPointer derives its destination from the key, so an unknown one has nowhere to go
  and the component returns null — the screen loses the link with nothing to show for it.
  Fix the key, or add the setting to ${CATALOG}.
`);
  process.exit(1);
}

console.log(`✓ settings pointers OK — ${pointers.length} pointer(s), ${total} key(s), all real`);
if (split.length) {
  console.log(`  note: ${split.length} pointer(s) name keys from more than one tab; the FIRST key decides where the link goes:`);
  for (const sline of split) console.log(`    ${sline}`);
}
