// Who may touch ONE project's marketplace.
//
// Until now: nobody but an ADMIN, and an ADMIN could touch every project's. A scoped custom
// role could already say "edits the BSM page" and "writes the BSM blog" — `scopeRights`
// knew exactly two rights and FILTERED OUT anything else — so the person running a project
// could edit its page, publish its articles, and not list a product on it. The only way to
// let them was to make them an admin of the whole site.
//
// `marketScopeAllows` is that decision, pure: given the grants a user holds and the page a
// product sits on, may they administer it? Every wrong answer is a permission bug, and the
// expensive direction is obvious — one page's manager reaching another page's products, or
// its money.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { marketScopeAllows } from '../src/routes/marketplace.mjs';

/** No grants at all — an ordinary signed-in account. */
const NONE = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
const grants = (o = {}) => ({
  allShowcase: !!o.allShowcase,
  showcaseIds: new Set(o.showcaseIds || []),
  projectKeys: new Set(o.projectKeys || []),
});

describe('marketScopeAllows — site-wide power', () => {
  test('a manager reaches every page', () => {
    // canManage* is passed in already resolved, because working out whether somebody holds
    // manage_projects needs the database and this decision must not.
    assert.equal(marketScopeAllows({ manageAll: true }, NONE, { projectKey: 'bmm' }), true);
    assert.equal(marketScopeAllows({ manageAll: true }, NONE, { showcaseProjectId: 'x' }), true);
    // Even a product attached to NOTHING, which only an admin can be looking at.
    assert.equal(marketScopeAllows({ manageAll: true }, NONE, {}), true);
  });
});

describe('marketScopeAllows — a scoped grant', () => {
  test('the page granted, and only that page', () => {
    const g = grants({ projectKeys: ['bsm'] });
    assert.equal(marketScopeAllows({}, g, { projectKey: 'bsm' }), true);
    assert.equal(marketScopeAllows({}, g, { projectKey: 'bmm' }), false);
  });

  test('a project grant is not a showcase grant', () => {
    // The two id spaces are different and a key could coincide with a cuid. Crossing them
    // would hand somebody the products of a page they were never granted.
    const g = grants({ projectKeys: ['abc123'] });
    assert.equal(marketScopeAllows({}, g, { showcaseProjectId: 'abc123' }), false);
  });

  test('allShowcase covers every showcase page and NO fixed project', () => {
    // allShowcase means "every other project's page" — the admin-created ones. It has never
    // meant BMM or BSM, and reading it that way here would silently promote a showcase
    // moderator to selling on the flagship products.
    const g = grants({ allShowcase: true });
    assert.equal(marketScopeAllows({}, g, { showcaseProjectId: 'anything' }), true);
    assert.equal(marketScopeAllows({}, g, { projectKey: 'bmm' }), false);
  });

  test('a product on no page is refused to a grantee', () => {
    // There is no scope to match, so there is no grant that covers it. Only site-wide power
    // reaches an unattached product — otherwise the way to reach every product would be to
    // create one with no page.
    const g = grants({ projectKeys: ['bsm'], allShowcase: true });
    assert.equal(marketScopeAllows({}, g, {}), false);
    assert.equal(marketScopeAllows({}, g, { projectKey: '' }), false);
    assert.equal(marketScopeAllows({}, g, null), false);
  });

  test('no grants and no power is no', () => {
    assert.equal(marketScopeAllows({}, NONE, { projectKey: 'bmm' }), false);
    assert.equal(marketScopeAllows(undefined, undefined, { projectKey: 'bmm' }), false);
  });
});

describe('marketScopeAllows — the scope string it agrees with', () => {
  test('it matches on the same scope the margin and the payee use', async () => {
    // Three things are decided per page: who may edit the products, what cut we take, and
    // where the money goes. They must agree about what "this page" means, or a manager
    // edits products whose margin is filed under a different key.
    const { feeScopeOf } = await import('../src/routes/marketplace.mjs');
    for (const product of [{ projectKey: 'bsm' }, { showcaseProjectId: 'sc1' }]) {
      const scope = feeScopeOf(product);
      const g = product.projectKey
        ? grants({ projectKeys: [product.projectKey] })
        : grants({ showcaseIds: [product.showcaseProjectId] });
      assert.equal(marketScopeAllows({}, g, product), true, scope);
    }
  });
});

describe('marketScopeAllows — a product naming TWO pages', () => {
  // Found by a pentest, not by reading. The predicate used to answer on the first id it saw:
  //
  //   if (product.projectKey) return grants.projectKeys.has(product.projectKey);
  //
  // so a grantee for one project page sent their own projectKey AND a showcase id they had
  // no rights to in the same create. The first branch answered true, the second id was never
  // looked at, and the product appeared in that showcase page's public shop — which lists by
  // showcaseProjectId alone — at whatever price they set. The showcase id on its own was
  // correctly refused with 403; adding a page they owned bypassed the refusal.
  //
  // The routes now refuse a body naming both. These cases are the second layer: rows that
  // already exist that way must be refused rather than half-allowed.
  const mine = grants({ projectKeys: ['bsm'], showcaseIds: ['sc-mine'] });

  test('their own project plus a showcase page they do NOT hold is refused', () => {
    assert.equal(marketScopeAllows({}, mine, { projectKey: 'bsm', showcaseProjectId: 'sc-theirs' }), false);
  });

  test('their own showcase page plus a project they do NOT hold is refused — the same trick, mirrored', () => {
    assert.equal(marketScopeAllows({}, mine, { projectKey: 'bmm', showcaseProjectId: 'sc-mine' }), false);
  });

  test('allShowcase does not cover the project half either', () => {
    assert.equal(marketScopeAllows({}, grants({ allShowcase: true }), { projectKey: 'bmm', showcaseProjectId: 'anything' }), false);
  });

  test('holding BOTH pages is allowed — the rule is "no page they lack", not "only one page"', () => {
    assert.equal(marketScopeAllows({}, mine, { projectKey: 'bsm', showcaseProjectId: 'sc-mine' }), true);
  });

  test('a product attached to nothing is refused, not waved through', () => {
    assert.equal(marketScopeAllows({}, mine, {}), false);
    assert.equal(marketScopeAllows({}, mine, { projectKey: null, showcaseProjectId: null }), false);
    assert.equal(marketScopeAllows({}, mine, { projectKey: '', showcaseProjectId: '' }), false);
  });

  test('a site-wide manager still reaches a two-page row', () => {
    assert.equal(marketScopeAllows({ manageAll: true }, NONE, { projectKey: 'x', showcaseProjectId: 'y' }), true);
  });
});
