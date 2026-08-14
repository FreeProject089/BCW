// French entries whose value is still the English text.
//
// i18n-check cannot see these and never will: it asks "does this key have a French entry",
// and these keys do. The entry just happens to hold the English string, so a French reader
// gets English on an otherwise translated page — the exact failure a missing-key check is
// blind to by construction.
//
// Advisory, not a gate. Most matches are legitimate — "Webhooks", "SSO", "Type", "Question",
// "Discord" are the same word in both languages — and a check that fails on those would be a
// check people learn to ignore, which is worse than not having one. Run it, read the list,
// judge each line.
//
//   node scripts/i18n-untranslated.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const DICT = 'src/i18n.jsx';

// Identical in both languages on purpose. Extend it rather than "fixing" a false positive:
// a word listed here is a decision recorded, and the next person does not have to make it
// again.
const SAME = new Set([
  'blog', 'docs', 'discord', 'version', 'versions', 'note', 'notes', 'options', 'option',
  'format', 'formats', 'admin', 'installer', 'stripe', 'sandbox', 'orientation', 'url', 'urls',
  'json', 'csv', 'api', 'apis', 'contact', 'transparent', 'important', 'description',
  'descriptions', 'documentation', 'application', 'applications', 'date', 'dates', 'position',
  'questions', 'question', 'images', 'image', 'style', 'styles', 'permissions', 'permission',
  'signature', 'signatures', 'instructions', 'label', 'labels', 'preset', 'presets', 'plugin',
  'plugins', 'sessions', 'session', 'action', 'actions', 'expiration', 'notification',
  'notifications', 'navigation', 'attention', 'services', 'service', 'messages', 'message',
  'invitations', 'invitation', 'suggestions', 'audio', 'video', 'animation', 'animations',
  'ratio', 'zoom', 'mode', 'modes', 'moderation', 'destination', 'destinations', 'variables',
  'variable', 'total', 'totals', 'badges', 'badge', 'agent', 'agents', 'test', 'tests',
  'production', 'compression', 'configuration', 'configurations', 'reset', 'usage', 'php',
  'md', 'html', 'css', 'svg', 'webhooks', 'webhook', 'sso', 'endpoint', 'endpoints', 'slug',
  'type', 'types', 'info', 'bio', 'tags', 'max', 'pool', 'pools', 'plan', 'app', 'apps',
  'diff', 'ping', 'globe', 'lobby', 'compact', 'mobile', 'photo', 'local', 'accent', 'page',
  'pages', 'intact', 'urgent', 'active', 'inactive', 'standard', 'configurable', 'consultant',
  'participants', 'performance', 'interactions', 'occurrences', 'newsletter', 'cookies',
  'sanctions', 'creator id', 'route', 'items',
]);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

// The English fallback of each key, from its t('key', 'English') call site.
const en = new Map();
const CALL = /t\(\s*'([A-Za-z0-9._-]+)'\s*,\s*(['"])((?:\\.|(?!\2).)*)\2/g;
for (const file of walk(SRC)) {
  const txt = fs.readFileSync(file, 'utf8');
  for (const m of txt.matchAll(CALL)) if (!en.has(m[1])) en.set(m[1], m[3]);
}

// The French half of the dictionary. Matched per ENTRY, not per line: the dictionary packs
// several entries onto one line, and a line-anchored pattern swallows every later entry into
// the first one's value — which is how a check like this quietly reports nonsense.
const dict = fs.readFileSync(DICT, 'utf8');
const frStart = dict.indexOf("'notif.none': 'Aucune notification'");
if (frStart < 0) { console.error('Could not find the French dictionary — has the anchor moved?'); process.exit(2); }
const ENTRY = /'([A-Za-z0-9._-]+)':\s*(['"])((?:\\.|(?!\2).)*)\2/g;
const fr = new Map();
for (const m of dict.slice(frStart).matchAll(ENTRY)) if (!fr.has(m[1])) fr.set(m[1], m[3]);

const hits = [];
for (const [k, e] of en) {
  const f = fr.get(k);
  if (f === undefined || f !== e) continue;
  if (!/[A-Za-z]/.test(e)) continue;                       // numbers, symbols, emoji
  if (SAME.has(e.trim().toLowerCase().replace(/[.…!?:]+$/, ''))) continue;
  hits.push([k, e]);
}

hits.sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, e] of hits) console.log(`${k.padEnd(34)} ${e.slice(0, 70)}`);
console.log();
console.log(`${hits.length} French entr${hits.length === 1 ? 'y is' : 'ies are'} still holding English text`);
console.log(`(checked ${en.size} keys with an English fallback against ${fr.size} French entries)`);
console.log('Advisory: read each one. If it is the same word in both languages, add it to SAME.');
