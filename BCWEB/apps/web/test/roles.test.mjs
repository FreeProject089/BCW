// Who the client thinks is staff, and which topbar buttons it will draw.
//
// These four predicates exist BECAUSE they were once written twice: the real topbar in
// App.jsx and its Live preview in admin.jsx each had their own copy, they drifted, and the
// preview ended up showing "Log out" and "Sign in" side by side — two states that can never
// both be true. One rule, imported twice, and now one rule with tests.
//
// None of this grants anything. The server answers again on every write, and these decide
// whether a control is DRAWN. That is why the asymmetry matters and is tested here: a
// control drawn for somebody who cannot use it is a small rudeness, and a control missing
// for somebody who can is a feature they cannot find.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_TIER_ROLES, effectiveCaps, hasProjectGrant, canAdmin, utilAllowed, canEditProject } from '../src/lib/roles.js';

const user = (over = {}) => ({ role: 'USER', permissions: [], ...over });

describe('effectiveCaps', () => {
  test('prefers effectivePermissions — the server folds custom roles into it', () => {
    // The raw `permissions` column holds only the INDIVIDUAL grants. A viewer whose access
    // comes from a custom role has an empty column and a full effectivePermissions, so
    // reading the column would hide the whole feature from exactly those people.
    assert.deepEqual(effectiveCaps(user({ permissions: ['a'], effectivePermissions: ['a', 'b'] })), ['a', 'b']);
  });
  test('falls back to the raw column for an older /me payload', () => {
    assert.deepEqual(effectiveCaps(user({ permissions: ['a'] })), ['a']);
  });
  test('a missing user is no capabilities, not a crash', () => {
    assert.deepEqual(effectiveCaps(null), []);
    assert.deepEqual(effectiveCaps(undefined), []);
  });
});

describe('hasProjectGrant', () => {
  test('the blanket showcase grant counts', () => {
    assert.equal(hasProjectGrant(user({ projectGrants: { allShowcase: true } })), true);
  });
  test('so does a single showcase id, or a single project key', () => {
    assert.equal(hasProjectGrant(user({ projectGrants: { showcaseIds: ['s1'] } })), true);
    assert.equal(hasProjectGrant(user({ projectGrants: { projectKeys: ['bmm'] } })), true);
  });
  test('EMPTY lists are not a grant', () => {
    // `{ showcaseIds: [] }` is the shape /me sends for somebody with no grants at all, and
    // an empty array is truthy. Reading it as a grant would put the dashboard's project tabs
    // in front of every signed-in account.
    assert.equal(hasProjectGrant(user({ projectGrants: { allShowcase: false, showcaseIds: [], projectKeys: [] } })), false);
  });
  test('no grants object at all is false, not undefined', () => {
    assert.equal(hasProjectGrant(user()), false);
    assert.equal(hasProjectGrant(null), false);
  });
});

describe('canAdmin', () => {
  test('every admin-tier role qualifies', () => {
    for (const role of ADMIN_TIER_ROLES) assert.equal(canAdmin(user({ role })), true, role);
  });
  test('a plain USER with one capability qualifies — that is what a capability IS', () => {
    assert.equal(canAdmin(user({ permissions: ['manage_blog'] })), true);
  });
  test('a per-project grantee qualifies with no role and no capability', () => {
    assert.equal(canAdmin(user({ projectGrants: { projectKeys: ['bmm'] } })), true);
  });
  test('a signed-in account with none of the three does not', () => {
    assert.equal(canAdmin(user()), false);
  });
  test('nobody signed in is false rather than a throw', () => {
    assert.equal(canAdmin(null), false);
    assert.equal(canAdmin(undefined), false);
  });
});

describe('utilAllowed', () => {
  test('the signed-in buttons need a user', () => {
    for (const key of ['notifications', 'dashboard', 'profile', 'logout']) {
      assert.equal(utilAllowed(key, user()), true, `${key} with a user`);
      assert.equal(utilAllowed(key, null), false, `${key} with nobody`);
    }
  });
  test('sign-in is the exact opposite of log-out — they can never both be drawn', () => {
    // This is the bug the module was extracted for. Asserted as a pair rather than one at a
    // time, because the failure was not either answer being wrong: it was the two answers
    // disagreeing about the same viewer.
    for (const who of [null, user(), user({ role: 'ADMIN' })]) {
      assert.notEqual(utilAllowed('login', who), utilAllowed('logout', who));
    }
  });
  test('the admin button follows canAdmin exactly', () => {
    assert.equal(utilAllowed('admin', user({ role: 'MOD' })), true);
    assert.equal(utilAllowed('admin', user()), false);
    assert.equal(utilAllowed('admin', null), false);
  });
  test('everything else is for everyone, signed in or not', () => {
    for (const key of ['projects', 'lang', 'theme', 'settings']) {
      assert.equal(utilAllowed(key, null), true, key);
      assert.equal(utilAllowed(key, user()), true, key);
    }
  });
  test('an unknown key is allowed, not hidden', () => {
    // The nav config can only further HIDE a button, so defaulting to "allowed" is the
    // failure an admin can correct. Defaulting to hidden would make a button added to the
    // config invisible with nothing to say why.
    assert.equal(utilAllowed('something-new', user()), true);
  });
});

describe('canEditProject', () => {
  test('manage_projects edits anything', () => {
    assert.equal(canEditProject(user({ effectivePermissions: ['manage_projects'] }), 'bmm'), true);
  });
  test('a per-project key edits THAT project and no other', () => {
    const u = user({ projectGrants: { projectKeys: ['bmm'] } });
    assert.equal(canEditProject(u, 'bmm'), true);
    assert.equal(canEditProject(u, 'bsm'), false);
  });
  test('a Set of keys works as well as an array', () => {
    // /me sends an array; the same predicate is called with the Set the client builds. Both
    // shapes have shipped, so both are pinned.
    const u = user({ projectGrants: { projectKeys: new Set(['bmm']) } });
    assert.equal(canEditProject(u, 'bmm'), true);
    assert.equal(canEditProject(u, 'bsm'), false);
  });
  test('no user, or no project key, is false', () => {
    assert.equal(canEditProject(null, 'bmm'), false);
    assert.equal(canEditProject(user({ effectivePermissions: ['manage_projects'] }), ''), false);
    assert.equal(canEditProject(user({ effectivePermissions: ['manage_projects'] }), undefined), false);
  });
  test('a showcase grant is NOT a project-page grant', () => {
    // Two different objects with two different lists. Treating them as one would draw the
    // "Edit page" link on a project for somebody granted a showcase and nothing else.
    assert.equal(canEditProject(user({ projectGrants: { allShowcase: true, showcaseIds: ['s1'] } }), 'bmm'), false);
  });
});
