// The export's redaction, checked against the REAL schema rather than against itself.
//
// user-export.test.mjs exercises the logic on a miniature dmmf. That is the right shape for
// the logic and it cannot catch the failure that actually happened: three of the patterns
// were ANCHORED — `/^password$/`, `/^secret$/`, `/^token$/` — so `dashPassword`, `secretHash`
// and `tokenHash` sailed straight through. Nothing errored. The export succeeded and a repo
// owner's file contained the argon2 hash of their dashboard password.
//
// Reading the pattern list and believing it is what let that stand. This walks every field
// name declared in schema.prisma instead, so the next column called `resetSecretHash` fails
// HERE, on the machine of whoever added it, rather than in somebody's subject access request.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isRedactedField, isThirdPartyField, relationRole } from '../src/lib/user-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, '..', '..', '..', 'packages', 'db', 'schema.prisma');

/** model -> { scalars: [name], userFks: [fk] }, parsed from the schema text. */
function readSchema() {
  const text = readFileSync(SCHEMA, 'utf8');
  const models = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const open = /^model\s+(\w+)\s*\{/.exec(line);
    if (open) { cur = models[open[1]] = { name: open[1], scalars: [], userFks: [] }; continue; }
    if (/^\}/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const rel = /^\s{2,}(\w+)\s+User(\?|\[\])?\s+@relation\([^)]*fields:\s*\[(\w+)\]/.exec(line);
    if (rel) { cur.userFks.push(rel[3]); continue; }
    const f = /^\s{2,}(\w+)\s+(\w+)/.exec(line);
    if (f) cur.scalars.push(f[1]);
  }
  return models;
}

/** Every (model, field) that would be exported VERBATIM: a subject row's own columns. */
function subjectFields(models) {
  const out = [];
  for (const m of Object.values(models)) {
    if (m.name === 'User') continue; // the account row is redacted on its own path
    for (const fk of m.userFks) {
      if (relationRole(fk) !== 'subject') continue;
      for (const f of m.scalars) out.push({ model: m.name, field: f, fk });
    }
  }
  return out;
}

describe('the redaction list against the real schema', () => {
  test('the schema parses at all — a silent zero would make every test below pass', () => {
    const models = readSchema();
    assert.ok(Object.keys(models).length > 50, `only ${Object.keys(models).length} models parsed`);
    assert.ok(models.User, 'User model not found');
    assert.ok(subjectFields(models).length > 100, 'no subject fields found — the FK regex has drifted');
  });

  test('no credential-looking column on a subject row is exported', () => {
    // `password`, `secret`, `token`, `apiKey` anywhere in the name, plus a bare `hash`.
    // A COMPOUND hash (contentHash, fileHash) is about the person's own file and is allowed.
    const CREDENTIAL = /password|secret|(^|[a-z])token|apikey/i;
    const leaked = subjectFields(readSchema())
      .filter(({ field }) => (CREDENTIAL.test(field) || /^(prev)?hash$/i.test(field)))
      .filter(({ field }) => !isRedactedField(field))
      .map(({ model, field, fk }) => `${model}.${field} (via ${fk})`);
    assert.deepEqual([...new Set(leaked)].sort(), [],
      'a credential would be exported verbatim — add a pattern to NEVER_EXPORT');
  });

  test('no column full of OTHER people is exported verbatim', () => {
    // The subject/actor split handles a row that is about somebody else. It does nothing for
    // a row that is genuinely theirs with a column of third parties in it — which is what
    // ServerRepo.accessEmails was: every collaborator's e-mail, in the owner's export.
    const THIRD = /accessemails|accesscreatorids|whitelist|banned|^members$|^voters$/i;
    const leaked = subjectFields(readSchema())
      .filter(({ field }) => THIRD.test(field))
      .filter(({ field }) => !isRedactedField(field) && !isThirdPartyField(field))
      .map(({ model, field, fk }) => `${model}.${field} (via ${fk})`);
    assert.deepEqual([...new Set(leaked)].sort(), [],
      'other people would be exported by name — add a pattern to THIRD_PARTY');
  });

  test('ordinary personal data is still NOT redacted — over-redacting empties the export', () => {
    // The opposite failure, and the one nobody reports: a pattern so broad the file arrives
    // with nothing in it. `displayName` and `createdAt` must survive whatever is added above.
    for (const f of ['displayName', 'createdAt', 'name', 'slug', 'bio', 'locale']) {
      assert.equal(isRedactedField(f), false, `${f} should not be redacted`);
      assert.equal(isThirdPartyField(f), false, `${f} should not be withheld as third-party`);
    }
    // The compound hashes that describe the person's OWN content.
    for (const f of ['contentHash', 'fileHash', 'sha256']) {
      assert.equal(isRedactedField(f), false, `${f} is about their own file and should stay`);
    }
  });
});
