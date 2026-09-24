// Pentest round 2 (Sept 24 2026): a case-insensitive "equals" that was a LIKE.
//
// Prisma turns `{ equals: v, mode: 'insensitive' }` into `ILIKE $1` on Postgres without
// escaping `v`, so `%` and `_` typed by a user were wildcards. The team invite
// (POST /me/teams/:id/members) answers with the matched account's id and display name, so
// `a%@gmail.com`, then `ab%@gmail.com`, ... spelled out members' e-mail addresses; the bot's
// points gift, the project contact picker and the pairing request had the same shape.
// See lib/ci-equals.mjs.
//
// Three layers: the helper itself (pure), the gate (no raw insensitive equals left in src),
// and the real resolver against the real database (a fixture account, removed afterwards).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeLike, ciEquals } from '../src/lib/ci-equals.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('escapeLike escapes exactly the three ILIKE specials', () => {
  assert.equal(escapeLike('a%b_c\\d'), 'a\\%b\\_c\\\\d');
  assert.equal(escapeLike('plain@example.com'), 'plain@example.com');
  assert.equal(escapeLike(null), '');
  assert.deepEqual(ciEquals('x%'), { equals: 'x\\%', mode: 'insensitive' });
});

/** Every .mjs under src, comments stripped (a comment naming the bug must not satisfy or fail the gate). */
function sources(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') sources(f, out); }
    else if (e.name.endsWith('.mjs') && e.name !== 'ci-equals.mjs') out.push([f, fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')]);
  }
  return out;
}

test('no raw `equals … mode: insensitive` is left in src (use ciEquals)', () => {
  const hits = [];
  for (const [f, code] of sources()) {
    // An object literal holding both keys, in either order, on one logical span.
    const re = /\{\s*equals:\s*[^{}]*?mode:\s*'insensitive'[^{}]*\}|\{\s*mode:\s*'insensitive'[^{}]*?equals:[^{}]*\}/g;
    for (const m of code.matchAll(re)) hits.push(`${path.relative(SRC, f)}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(hits, [], 'an insensitive equals on a typed value is an ILIKE: wrap the value with ciEquals()');
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the resolver tests';
const TAG = `pentestc-like-${Date.now()}`;
let p, fixture, resolveUser;

describe('resolving a person from typed text is literal (db)', { skip }, () => {
  before(async () => {
    const lib = await import('../src/lib/lib.mjs');
    ({ resolveUser } = await import('../src/lib/economy-shop.mjs'));
    p = await lib.db();
    fixture = await p.user.create({ data: { email: `${TAG}@bettercommunity.invalid`, displayName: `${TAG} name` } });
  });
  after(async () => {
    await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await p?.$disconnect?.();
  });

  test('a wildcard names nobody', async () => {
    for (const q of ['%', '%@%', `${TAG.slice(0, 12)}%@bettercommunity.invalid`, '_%', `${TAG} nam_`]) {
      const u = await resolveUser(p, q);
      assert.equal(u, null, `${JSON.stringify(q)} resolved to an account (${u?.id})`);
    }
  });

  test('the exact address or name still resolves, in any case (control)', async () => {
    assert.equal((await resolveUser(p, fixture.email.toUpperCase()))?.id, fixture.id);
    assert.equal((await resolveUser(p, `${TAG} NAME`))?.id, fixture.id);
  });
});
