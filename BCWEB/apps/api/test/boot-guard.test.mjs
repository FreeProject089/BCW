// What an instance refuses to boot on in production.
//
// The check that matters is the CHAIN one. The link lookup reads
// `BC_LINK_SECRET || LINK_LOOKUP_SECRET || 'dev-link-secret'`, so a guard demanding one
// specific name would reject a deployment that correctly set the other — and a boot guard
// that rejects a correct deployment is a boot guard somebody deletes.
//
// Bot auth is NOT a chain any more (SECURITY_SUMMARY §9 #4): BOT_SHARED_SECRET only. The
// LINK_LOOKUP_SECRET fallback let the telemetry service's secret speak as the bot.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { productionSecretProblems, formatProblems, isProduction, PRODUCTION_SECRETS } from '../src/lib/boot-guard.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOOD = {
  JWT_SECRET: 'a-real-secret-value',
  BOT_SHARED_SECRET: 'the-bot-one',
  LINK_LOOKUP_SECRET: 'another-real-one',
  S3_SECRET_KEY: '6f1c0e9a2b7d4c3e8f5a1b2c3d4e5f60',
};

describe('productionSecretProblems', () => {
  test('a fully configured environment has nothing to say', () => {
    assert.deepEqual(productionSecretProblems(GOOD), []);
  });

  test('an unset secret is reported with every name that would satisfy it', () => {
    const p = productionSecretProblems({ JWT_SECRET: 'x', S3_SECRET_KEY: GOOD.S3_SECRET_KEY });
    assert.equal(p.length, 2);
    assert.deepEqual(p[0], {
      purpose: 'Discord bot authentication',
      vars: ['BOT_SHARED_SECRET'],
      reason: 'unset',
      consequence: 'the /bot/* endpoints would accept anyone',
    });
    assert.deepEqual(p[1].vars, ['BC_LINK_SECRET', 'LINK_LOOKUP_SECRET']);
  });

  test('EITHER name in a chain satisfies it', () => {
    // The bug this exists to avoid. Setting BC_LINK_SECRET alone is a correct deployment.
    assert.deepEqual(productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: undefined, BC_LINK_SECRET: 'y' }), []);
  });

  test('LINK_LOOKUP_SECRET no longer satisfies bot auth (§9 #4)', () => {
    // It used to: a deploy with only the link secret booted, and the telemetry service's
    // secret authorised all sixty /bot/* routes. Now that deploy is refused at boot.
    const p = productionSecretProblems({ JWT_SECRET: 'x', LINK_LOOKUP_SECRET: 'the-link-one', S3_SECRET_KEY: GOOD.S3_SECRET_KEY });
    assert.deepEqual(p.map((x) => [x.purpose, x.reason]), [['Discord bot authentication', 'unset']]);
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
    // Two purposes, two literals: 'dev-bot-secret' for the bot and 'dev-link-secret' for the
    // link lookup. One shared list would clear the wrong one.
    const bot = productionSecretProblems({ ...GOOD, BOT_SHARED_SECRET: 'dev-bot-secret' });
    assert.deepEqual(bot.map((x) => x.purpose), ['Discord bot authentication']);
    const link = productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: 'dev-link-secret' });
    assert.deepEqual(link.map((x) => x.purpose), ['telemetry and server-control link lookup']);
    // The bot's literal in the LINK secret is not the link chain's fallback: nothing to say.
    assert.deepEqual(productionSecretProblems({ ...GOOD, LINK_LOOKUP_SECRET: 'dev-bot-secret' }), []);
  });

  test('the FIRST name set is the one judged — the chain is ||', () => {
    // A later name never overrides an earlier one at runtime, so checking it would be
    // checking a value nothing reads. BC_LINK_SECRET wins, and it is the insecure one.
    const p = productionSecretProblems({ ...GOOD, BC_LINK_SECRET: 'dev-link-secret' });
    assert.deepEqual(p.map((x) => x.vars), [['BC_LINK_SECRET']]);
  });

  test('an empty string is unset, not a value', () => {
    // `FOO=` in a .env file is the classic half-configured deploy, and `||` treats it as
    // absent — so the guard must too, or it clears a secret that falls back at runtime.
    const p = productionSecretProblems({ JWT_SECRET: '', BOT_SHARED_SECRET: 'b', LINK_LOOKUP_SECRET: 'x', S3_SECRET_KEY: GOOD.S3_SECRET_KEY });
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
    assert.match(out, /set one of BOT_SHARED_SECRET \(/);
    assert.match(out, /BC_LINK_SECRET \/ LINK_LOOKUP_SECRET/);
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

// ── the object-storage root secret (S3_SECRET_KEY) ──────────────────────────
//
// .env.example ships `S3_SECRET_KEY=change-me-strong`, and the bundled versitygw takes that
// value AS its root credential. An operator who forgets to change it while S3_DOMAIN makes
// storage public hands root on every upload to whoever read the example file. It has no `||`
// fallback in the code, so the values to refuse are the example file's placeholders, and a
// length floor catches a hand-typed short one.
describe('S3_SECRET_KEY in production', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const EXAMPLE = join(HERE, '..', '..', '..', 'infra', 'compose', '.env.example');
  const S3 = PRODUCTION_SECRETS.find((x) => x.vars.includes('S3_SECRET_KEY'));
  const reasons = (env) => productionSecretProblems(env).filter((p) => p.vars.includes('S3_SECRET_KEY')).map((p) => p.reason);

  test('is declared, with a length floor of 24', () => {
    assert.ok(S3, 'S3_SECRET_KEY is not guarded at boot');
    assert.equal(S3.minLength, 24);
  });

  test('the value .env.example ships is refused', () => {
    const line = readFileSync(EXAMPLE, 'utf8').match(/^S3_SECRET_KEY=(.*)$/m);
    assert.ok(line, 'S3_SECRET_KEY is no longer in .env.example — read this test again');
    assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: line[1].trim() }), ['insecure_default']);
  });

  test('every change-me placeholder in .env.example is refused, whichever line it came from', () => {
    // Pasting the JWT placeholder into the S3 line is the same mistake. A placeholder added to
    // the example file later must be added to the guard too, and this is what says so.
    const placeholders = [...readFileSync(EXAMPLE, 'utf8').matchAll(/^#?\s*[A-Z][A-Z0-9_]*=(change-?me[^\s#]*)/gmi)].map((m) => m[1]);
    assert.ok(placeholders.length >= 4, `found ${placeholders.length} placeholders — the scan stopped matching`);
    for (const v of new Set(placeholders)) {
      assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: v }), ['insecure_default'], `${v} would boot`);
    }
  });

  test('empty or unset is refused', () => {
    assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: '' }), ['unset']);
    assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: undefined }), ['unset']);
  });

  test('shorter than 24 characters is refused; 24 is enough', () => {
    assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: 'a'.repeat(23) }), ['too_short']);
    assert.deepEqual(reasons({ ...GOOD, S3_SECRET_KEY: 'a'.repeat(24) }), []);
  });

  test('the length floor applies to S3 only: the older secrets keep their rule', () => {
    // A length rule on JWT_SECRET & co. would refuse deploys that boot today. Not this card.
    assert.deepEqual(productionSecretProblems({ ...GOOD, JWT_SECRET: 'x', BOT_SHARED_SECRET: 'y' }), []);
  });

  test('the message says to make it longer', () => {
    const out = formatProblems(productionSecretProblems({ ...GOOD, S3_SECRET_KEY: 'short' }));
    assert.match(out, /S3_SECRET_KEY is shorter than 24 characters/);
    assert.match(out, /S3_DOMAIN/);
  });

  test('a real production boot with the example value exits 1 and names it', async () => {
    // The whole path, not the function: server.mjs runs the guard at import and exits before
    // it listens. DATABASE_URL points nowhere so that, if the guard ever stops firing, the
    // server that starts instead cannot touch the test database; the timeout then fails it.
    const env = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'production', SITE_URL: 'https://community.example.org', PORT: '0',
      JWT_SECRET: GOOD.JWT_SECRET, BOT_SHARED_SECRET: GOOD.BOT_SHARED_SECRET, LINK_LOOKUP_SECRET: GOOD.LINK_LOOKUP_SECRET,
      S3_SECRET_KEY: 'change-me-strong',
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none', DIRECT_DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
    };
    const child = spawn(process.execPath, [join(HERE, '..', 'src', 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', () => {});
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { child.kill(); resolve('timeout: the server started'); }, 60_000);
      child.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    assert.equal(code, 1, `exit ${code}; stderr: ${err.slice(0, 400)}`);
    assert.match(err, /refusing to start in production/);
    assert.match(err, /S3_SECRET_KEY is still the value from the repository/);
  });
});
