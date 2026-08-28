// The emoji map, and the four ways a table like this goes wrong.
//
// A duplicate key in an object literal is not an error in JavaScript. The later one silently
// wins, and the one you meant is gone — the same failure the i18n checker exists to catch,
// in a file where it is even easier to make, because two people adding `:fire:` in two
// sections is the natural way this list grows.
//
// The other three are about what the replacement can eat. `replaceEmoji` only substitutes
// names it knows, which is the whole safety argument for letting it loose on every text node
// in every document: `10:30:45`, `3:4` and a French sentence ending in a colon cannot match
// because those names are not in the map. That argument holds only while the map contains no
// name that is a bare number, and while every value is actually an emoji rather than a stray
// letter somebody typed into the wrong column.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '../src/markdown/emoji.js');
if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} is missing — refusing to report success`);
  process.exit(2);
}
const src = readFileSync(FILE, 'utf8');

const { EMOJI, replaceEmoji } = await import(`file://${FILE.replace(/\\/g, '/')}`);
const names = Object.keys(EMOJI);
if (names.length < 100) {
  console.error(`✗ read ${names.length} shortcode(s) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

const problems = [];

// ── 1. Duplicate keys ──
// Read from the SOURCE, not the object: by the time it is an object the duplicate is gone.
// That is the entire point — the evidence only exists in the text.
const body = src.slice(src.indexOf('export const EMOJI = {'), src.indexOf('\n};'));
const seen = new Map();
for (const m of body.matchAll(/(?:^|[{,])\s*'?([a-zA-Z0-9_+-]+)'?\s*:\s*'/gm)) {
  const k = m[1];
  seen.set(k, (seen.get(k) || 0) + 1);
}
for (const [k, n] of seen) {
  if (n > 1) problems.push(`":${k}:" is defined ${n} times — the last one silently wins and the others are gone`);
}

// ── 2. A name that is only digits ──
// `:100:` is a real GitHub shortcode and is fine; `:30:` would make `10:30:45` render as an
// emoji. The rule is not "no digits", it is that a purely numeric name has to be one somebody
// deliberately chose, so it is listed here rather than inferred.
const NUMERIC_OK = new Set(['100']);
for (const k of names) {
  if (/^\d+$/.test(k) && !NUMERIC_OK.has(k)) {
    problems.push(`":${k}:" is a bare number — a timestamp like 10:${k}:45 would render as an emoji`);
  }
}

// ── 3. A value that is not an emoji ──
// A cell holding a letter or a word is a typo that renders as that letter, which reads as a
// broken font rather than as a mistake in a table.
for (const [k, v] of Object.entries(EMOJI)) {
  if (typeof v !== 'string' || !v.length) { problems.push(`":${k}:" has no character`); continue; }
  if (/^[\x20-\x7E]+$/.test(v)) problems.push(`":${k}:" maps to plain ASCII ${JSON.stringify(v)} — that is not an emoji`);
  if ([...v].length > 6) problems.push(`":${k}:" maps to ${[...v].length} code points — too long to be one emoji`);
}

// ── 4. The substitution still leaves ordinary text alone ──
// A behaviour check, not a shape one: the regex is the part that decides whether a document
// full of colons survives, and it is the part somebody will "simplify" one day.
const SAFE = [
  ['10:30:45', 'a timestamp'],
  ['3:4', 'a ratio'],
  ['Attention : rocket : voilà', 'a French sentence with spaced colons'],
  ['https://example.com/x', 'a URL'],
  ['path:rocket:x', 'a colon inside an identifier'],
  [':definitely_not_a_real_shortcode:', 'an unknown shortcode'],
];
for (const [input, what] of SAFE) {
  const out = replaceEmoji(input);
  if (out !== input) problems.push(`${what} was rewritten: ${JSON.stringify(input)} → ${JSON.stringify(out)}`);
}
// And it still does the job.
for (const [input, expected] of [[':rocket:', '🚀'], ['ship it :tada: now', 'ship it 🎉 now'], [':+1:', '👍']]) {
  const out = replaceEmoji(input);
  if (out !== expected) problems.push(`${JSON.stringify(input)} → ${JSON.stringify(out)}, expected ${JSON.stringify(expected)}`);
}

if (problems.length) {
  console.error('✗ emoji map:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ emoji OK — ${names.length} shortcode(s), no duplicates, ordinary text untouched`);
