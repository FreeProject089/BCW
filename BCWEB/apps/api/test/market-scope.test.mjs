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
