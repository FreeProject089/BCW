// The task board's screen, checked against the things it cannot import.
//
// The board is four files that must agree with two others they have no compile-time link to:
// the API's vocabulary (TASK_STATES / TASK_PRIORITIES), and the French dictionary. Both are
// the kind of disagreement that ships green — a state the API accepts and the screen has no
// label for renders as the raw slug `in_progress`, and a missing French entry silently falls
// back to English for every FR reader.
//
// `i18n:check` covers the second one repo-wide, which is why this narrows to THIS feature's
// keys: while somebody else's in-progress screen has the repo-wide check red, a French entry
// missing from this one would be one more line in a list of two hundred and nobody would see
// it. A focused assertion still fails for the right reason.
//
// The JSX is read as TEXT rather than imported: node cannot parse .jsx, and adding a
// transform for one test is a build step for a rule a regex answers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TASK_STATES, TASK_PRIORITIES } from '../../api/src/lib/tasks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const FILES = ['admin-tasks.jsx', 'admin-tasks-vocab.jsx', 'admin-tasks-detail.jsx', 'admin-tasks-teams.jsx'];
const read = (f) => readFileSync(join(SRC, 'pages', f), 'utf8');
const all = FILES.map(read).join('\n');
const vocab = read('admin-tasks-vocab.jsx');

/** The keys of a `const NAME = { … }` map whose entries are `key: { … }`. */
const mapKeys = (src, name) => {
  const start = src.indexOf(`export const ${name} = {`);
  assert.notEqual(start, -1, `${name} not found — this test is measuring nothing`);
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
};

describe('the screen speaks the API’s vocabulary', () => {
  test('every state the API accepts has a label, an icon and a tone on the screen', () => {
    assert.deepEqual(mapKeys(vocab, 'STATE_META').sort(), [...TASK_STATES].sort(),
      'a state with no entry renders as its raw slug, e.g. "in_progress"');
  });
  test('every priority the API accepts has one too', () => {
    assert.deepEqual(mapKeys(vocab, 'PRIORITY_META').sort(), [...TASK_PRIORITIES].sort());
  });
  test('and the screen invents none of its own', () => {
    for (const s of mapKeys(vocab, 'STATE_META')) assert.ok(TASK_STATES.includes(s), `${s} is not a state the API knows`);
  });
  test('the labels are literal t() calls, never a key built from the value', () => {
    // `t(\`atask.state.${s}\`)` is invisible to i18n-check; that is how seven rows once
    // shipped in English with every gate green.
    // The word boundary is load-bearing: without it this matches `api.get(` and `api.post(`
    // and the test fails over every call the file makes. A probe that reports the wrong
    // thing is worse than no probe.
    assert.equal(/\bt\(\s*`/.test(all), false, 'a template-literal i18n key hides from the checker');
  });
});

describe('French', () => {
  const i18n = readFileSync(join(SRC, 'i18n-fr.js'), 'utf8'); // M18: DICT.fr moved here
  // Brace-match DICT.fr the same way scripts/i18n-check.mjs does.
  const frSection = (() => {
    const m = /\n\s{2,4}fr:\s*\{/.exec(i18n);
    assert.ok(m, 'could not find DICT.fr');
    let depth = 0; const start = m.index + m[0].length - 1;
    for (let i = start; i < i18n.length; i++) {
      if (i18n[i] === '{') depth++;
      else if (i18n[i] === '}' && --depth === 0) return i18n.slice(start, i + 1);
    }
    throw new Error('unbalanced DICT.fr');
  })();
  const frKeys = new Set([...frSection.matchAll(/'([A-Za-z0-9_.]+)'\s*:/g)].map((m) => m[1]));
  const used = [...new Set([...all.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map((m) => m[1]))];

  test('this feature uses keys at all (so the two checks below mean something)', () => {
    assert.ok(used.length > 50, `only ${used.length} keys found`);
  });
  test('every key the board uses has a French entry', () => {
    const missing = used.filter((k) => !frKeys.has(k));
    assert.deepEqual(missing, [], 'FR readers get the English fallback for these');
  });
  test('every call carries its English fallback', () => {
    const bare = [...all.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'\s*\)/g)].map((m) => m[1]);
    assert.deepEqual(bare, [], 't(key) with no fallback renders the key itself to English readers');
  });
  test('no em dash in a user-facing string', () => {
    // Prose, not code: only the fallbacks, which are what an English reader sees.
    const bad = [...all.matchAll(/\bt\(\s*'[A-Za-z0-9_.]+'\s*,\s*('[^']*'|"[^"]*")/g)]
      .map((m) => m[1]).filter((s) => s.includes('—'));
    assert.deepEqual(bad, []);
  });
});

describe('house rules the board has to keep', () => {
  test('no Tailwind alpha on a CSS variable', () => {
    // Emits no rule at all in Tailwind 3: the element is drawn with no background.
    const bad = all.match(/\b(?:bg|text|border|ring|from|via|to)-\[var\(--[a-z0-9-]+\)\]\/[0-9]+/g) || [];
    assert.deepEqual(bad, []);
  });
  test('the accent is never used as ink', () => {
    const bad = all.match(/text-\[var\(--primary(?:-2)?\)\]/g) || [];
    assert.deepEqual(bad, []);
  });
  test('every Modal is given `open`', () => {
    for (const f of FILES) {
      for (const m of read(f).matchAll(/<Modal\b([^>]*)>/g)) {
        assert.ok(/\bopen\b/.test(m[1]), `${f}: a <Modal> with no open prop renders nothing at all`);
      }
    }
  });
  test('the inner surfaces are the sanctioned classes, so the translucency setting reaches them', () => {
    assert.ok(/\bpanel-quiet\b/.test(all) && /\btint-warning\b/.test(all));
  });
});

describe('the screen asks the API what it may do', () => {
  test('it draws its buttons from `can` / `states` / `assignable`, not from the role', () => {
    assert.ok(/task\.can\b|can\.(?:edit|assign|release|comment|del)\b/.test(all));
    // Re-deriving the rule here is the failure mode: the half that disagrees draws an
    // enabled button over a 403.
    assert.equal(/role\s*===\s*'(?:ADMIN|SUPERADMIN|MOD)'/.test(all), false,
      'the screen must not re-implement the permission rules');
  });
});
