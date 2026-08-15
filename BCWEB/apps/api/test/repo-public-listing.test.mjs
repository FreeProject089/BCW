// What it takes for a repo to be in the public list, asserted against the route source.
//
// Three separate flags decide it — listed, verified, pendingReview — and they are set by
// four different paths (owner re-list, autoVerify, admin verify, admin reject). The rule
// that matters is that a moderator's rejection cannot be undone by the owner alone, and
// that rule lives in the AND of a where-clause rather than anywhere you would look for it.
//
// Source-level, deliberately: these are conditions in a Prisma query, and a test that mocked
// the database would assert the mock. Reading the route means the assertions fail when the
// query changes, which is when they should.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/routes/repos.mjs'), 'utf8');

/** The body of a named route handler, to the next `app.` registration. */
function routeBody(method, path) {
  const at = SRC.indexOf(`app.${method}('${path}'`);
  assert.notEqual(at, -1, `route ${method.toUpperCase()} ${path} not found`);
  const rest = SRC.slice(at + 1);
  const end = rest.indexOf('\n  app.');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('the public feed', () => {
  test('requires listed AND verified AND not pending', () => {
    // Any one of the three missing is what keeps an unreviewed or rejected repo out, so
    // dropping one silently publishes a whole class of repo.
    //
    // Asserted on the WHERE CLAUSE, not on three separate substrings. The first version
    // looked for `verified: true` anywhere in the handler — and a `select` in the same
    // region contains that exact text, so deleting it from the filter left the test green.
    // A test that passes because it matched a different line is worse than none.
    const body = routeBody('get', '/repos.json');
    const where = body.match(/where:\s*\{[^}]*\}/);
    assert.ok(where, 'no where-clause found in the repos.json handler');
    for (const cond of ['listed: true', 'verified: true', 'pendingReview: false']) {
      assert.ok(where[0].includes(cond), `repos.json must FILTER on ${cond} — found: ${where[0]}`);
    }
  });
});

describe('an owner re-listing their own repo', () => {
  const body = routeBody('post', '/repos/:id/list');

  test('cannot approve themselves — a non-staff re-list goes back into the queue', () => {
    // Without this, the owner of a rejected repo re-lists it, autoVerify finds the content
    // technically valid, and it is public again with no moderator involved.
    assert.ok(body.includes("isStaff ? {} : { pendingReview: true }"), 'non-staff re-list must set pendingReview');
    assert.ok(/\['MOD', 'ADMIN', 'SUPERADMIN'\]/.test(body), 'staff must be the exception, and named');
  });

  test('a repo that fails its technical check is not left listed', () => {
    // The route sets listed:true FIRST so autoVerify can compute `verified`, so the failure
    // path has to undo it — otherwise a failed check leaves the repo listed-but-unverified.
    assert.ok(body.includes("data: { listed: false, pendingReview: false }"), 'must revert on failure');
    assert.ok(body.includes("error: 'sha_invalid'"), 'and say why');
  });
});

describe('a moderator removing a repo from the list', () => {
  const body = routeBody('post', '/admin/repos/:id/reject');

  test('clears all three flags', () => {
    for (const f of ['verified: false', 'pendingReview: false', 'listed: false']) {
      assert.ok(body.includes(f), `reject must set ${f}`);
    }
  });

  test('clears the content hash as well', () => {
    // `sha` means "hash of the last VERIFIED content". Keeping it after a rejection leaves a
    // record asserting the content was checked, at the moment a moderator decided it was not.
    assert.ok(body.includes('sha: null'), 'reject must clear sha');
  });

  test('requires a reason, and sends it', () => {
    assert.ok(body.includes("error: 'reason_required'"), 'a removal with no reason is unanswerable');
    assert.ok(body.includes('repo_rejected'), 'and the owner is told');
  });
});
