// No source file carries a byte that is not text.
//
// `tasks.mjs` shipped with a literal NUL inside a sentinel id: `['\0none']`, where the
// author meant a value that matches no row. It parsed, it linted, `node --check` was happy,
// and the only visible symptom was that grep called the file binary and stopped printing
// matches from it.
//
// It would not have stayed harmless. Postgres rejects NUL in a text value, so the first
// staff member on no team who filtered that board by team would have got a query error
// instead of an empty list, from a branch that exists precisely to return nothing.
//
// The web app has had `check-encoding.mjs` for a while, for the same family of problem
// (a BOM that is invisible to git, fine to npm, and killed a Docker build). The API had
// nothing. This is that check, as a test, so it runs wherever the suite runs.
//
// The allowed control characters are tab, newline and carriage return. Everything else in
// that range is a mistake somebody could not see: a NUL from a mangled escape, a backspace
// from a generated regex (this repo has met that one too, where `\b` became 0x08 and the
// regex matched nothing while staying green), a form feed from a paste.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const CODE = /\.(mjs|js|json)$/;

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (f === 'node_modules') return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : CODE.test(f) ? [p] : [];
});

const NAMES = { 0: 'NUL', 8: 'BACKSPACE', 11: 'VERTICAL TAB', 12: 'FORM FEED', 27: 'ESCAPE', 127: 'DELETE' };

describe('the source is text', () => {
  const files = walk(ROOT);
  // If the walk finds nothing the assertions below are vacuously true, which is the way a
  // check like this usually dies.
  test('there is something to check', () => {
    assert.ok(files.length > 50, `walked ${files.length} file(s) under src/, expected the whole API`);
  });

  test('no control byte outside tab, newline and carriage return', () => {
    const bad = [];
    for (const f of files) {
      const b = readFileSync(f);
      for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c === 9 || c === 10 || c === 13 || c >= 32) continue;
        const line = b.subarray(0, i).toString('utf8').split('\n').length;
        bad.push(`${f.split(/[\\/]/).slice(-2).join('/')}:${line} 0x${c.toString(16).padStart(2, '0')} ${NAMES[c] || ''}`.trim());
        break; // one report per file is enough to go and look
      }
    }
    assert.deepEqual(bad, [], `control byte(s) in source:\n  ${bad.join('\n  ')}`);
  });

  test('no byte-order mark', () => {
    // A BOM is valid UTF-8 and invisible in git's diff. It has broken a Docker build here
    // before, with every lint green.
    const bom = files.filter((f) => {
      const b = readFileSync(f);
      return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    });
    assert.deepEqual(bom, [], 'these files start with a UTF-8 BOM');
  });
});
