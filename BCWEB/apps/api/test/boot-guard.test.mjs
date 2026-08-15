// What an instance refuses to boot on in production.
//
// The check that matters is the CHAIN one. Bot auth reads
// `BOT_SHARED_SECRET || LINK_LOOKUP_SECRET || 'dev-bot-secret'`, so a guard demanding one
// specific name would reject a deployment that correctly set the other — and a boot guard
// that rejects a correct deployment is a boot guard somebody deletes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { productionSecretProblems, formatProblems, isProduction, PRODUCTION_SECRETS } from '../src/lib/boot-guard.mjs';

const GOOD = {
  JWT_SECRET: 'a-real-secret-value',
  LINK_LOOKUP_SECRET: 'another-real-one',
};

describe('productionSecretProblems', () => {
  test('a fully configured environment has nothing to say', () => {
    assert.deepEqual(productionSecretProblems(GOOD), []);
  });

  test('an unset secret is reported with every name that would satisfy it', () => {
    const p = productionSecretProblems({ JWT_SECRET: 'x' });
    assert.equal(p.length, 2);
    assert.deepEqual(p[0], {
      purpose: 'Discord bot authentication',
      vars: ['BOT_SHARED_SECRET', 'LINK_LOOKUP_SECRET'],
      reason: 'unset',
      consequence: 'the /bot/* endpoints would accept anyone',
    });
  });

  test('EITHER name in a chain satisfies it', () => {
    // The bug this exists to avoid. Setting BOT_SHARED_SECRET alone is a correct deployment.
    assert.deepEqual(productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: undefined, BOT_SHARED_SECRET: 'x', BC_LINK_SECRET: 'y' }), []);
  });

  test('the value from the repository is reported even though the variable IS set', () => {
    const p = productionSecretProblems({ ...GOOD, JWT_SECRET: 'dev-only-insecure-secret' });
    assert.deepEqual(p, [{
      purpose: 'session tokens',
      vars: ['JWT_SECRET'],
      reason: 'insecure_default',
      consequence: 'anyone could forge a session token, including ADMIN',
    }]);
  });

  test('each chain is judged against ITS OWN fallback', () => {
    // LINK_LOOKUP_SECRET feeds two purposes with different literals: 'dev-bot-secret' for the
    // bot and 'dev-link-secret' for the link lookup. One shared list would clear the wrong one.
    const bot = productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: 'dev-bot-secret' });
    assert.deepEqual(bot.map((x) => x.purpose), ['Discord bot authentication']);
    const link = productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: 'dev-link-secret' });
    assert.deepEqual(link.map((x) => x.purpose), ['telemetry and server-control link lookup']);
  });

  test('the FIRST name set is the one judged — the chain is ||', () => {
    // A later name never overrides an earlier one at runtime, so checking it would be
    // checking a value nothing reads. BOT_SHARED_SECRET wins, and it is the insecure one.
    const p = productionSecretProblems({ ...GOOD, BOT_SHARED_SECRET: 'dev-bot-secret' });
    assert.deepEqual(p.map((x) => x.vars), [['BOT_SHARED_SECRET']]);
  });

  test('an empty string is unset, not a value', () => {
    // `FOO=` in a .env file is the classic half-configured deploy, and `||` treats it as
    // absent — so the guard must too, or it clears a secret that falls back at runtime.
    const p = productionSecretProblems({ JWT_SECRET: '', LINK_LOOKUP_SECRET: 'x' });
    assert.deepEqual(p.map((x) => x.reason), ['unset']);
  });

  test('every declared chain names a consequence, not just a variable', () => {
    // The message is read by somebody at 2am deciding whether to override it.
    for (const s of PRODUCTION_SECRETS) {
      assert.ok(s.consequence && s.consequence.length > 10, `${s.purpose} needs a consequence`);
      assert.ok(s.insecure.length > 0, `${s.purpose} needs the literal fallback it guards`);
    }
  });
});

describe('formatProblems', () => {
  test('names the variables to set and what it costs', () => {
    const out = formatProblems(productionSecretProblems({}));
    assert.match(out, /BOT_SHARED_SECRET \/ LINK_LOOKUP_SECRET/);
    assert.match(out, /accept anyone/);
  });

  test('an insecure default says to change it, not to set it', () => {
    const out = formatProblems(productionSecretProblems({ ...GOOD, JWT_SECRET: 'dev-only-insecure-secret' }));
    assert.match(out, /still the value from the repository/);
  });
});

describe('isProduction', () => {
  test('only an explicit production', () => {
    // Treating "not development" as production would fire on every local run where NODE_ENV
    // is simply unset, and a guard that blocks `node server.mjs` on a laptop gets removed.
    assert.equal(isProduction({ NODE_ENV: 'production' }), true);
    assert.equal(isProduction({}), false);
    assert.equal(isProduction({ NODE_ENV: 'development' }), false);
  });
});
