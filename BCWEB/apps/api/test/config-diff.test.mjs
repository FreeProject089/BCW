// .env.example against a live environment.
//
// The rule this whole module is built around: VALUES NEVER LEAVE IT. The last test asserts
// that on the real output shape, because a tool that reports configuration problems by
// printing the configuration is a worse problem than the one it reports — and this one is
// reachable by an admin over HTTP.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvPairs, isPlaceholder, diffConfig } from '../src/lib/config-diff.mjs';

describe('parseEnvPairs', () => {
  test('declared and commented-out entries both carry their example value', () => {
    // A commented-out line still documents the variable AND still carries the value somebody
    // will paste. Both halves matter.
    const p = parseEnvPairs('A=1\n# B=change-me\nC=\n\nnot a var\n');
    assert.deepEqual([...p], [['A', '1'], ['B', 'change-me'], ['C', '']]);
  });

  test('quotes around a value are not part of it', () => {
    assert.equal(parseEnvPairs('A="x y"').get('A'), 'x y');
    assert.equal(parseEnvPairs("A='x y'").get('A'), 'x y');
  });
});

describe('isPlaceholder', () => {
  test('the values that mean "replace this"', () => {
    for (const v of ['change-me', 'CHANGEME', 'your-domain.com', 'xxxx', 'TODO', '<secret>', 'dev-only-insecure-secret'])
      assert.equal(isPlaceholder(v), true, v);
  });

  test('a real default meant to be copied is not a placeholder', () => {
    // NODE_ENV=production and DB_PORT=5432 are meant to be copied. Reporting them buries
    // the one line that matters under a dozen that do not.
    for (const v of ['production', '5432', 'postgresql://db:5432/bcweb', 'us-east-1'])
      assert.equal(isPlaceholder(v), false, v);
  });

  test('empty means "no default", not a placeholder value', () => {
    assert.equal(isPlaceholder(''), false);
    assert.equal(isPlaceholder(undefined), false);
  });
});

describe('diffConfig', () => {
  const EXAMPLE = [
    'POSTGRES_PASSWORD=change-me',
    'JWT_SECRET=',
    'NODE_ENV=production',
    'S3_REGION=us-east-1',
    'MAIL_FROM=',
  ].join('\n');
  const isSecret = (n) => /SECRET|PASSWORD|TOKEN|KEY/.test(n);

  test('a value copied verbatim from the example is the finding', () => {
    // The single most common way a Compose stack ends up with a credential that is in the
    // repository. Nothing else in the codebase would notice: the app starts and works.
    const d = diffConfig(EXAMPLE, { POSTGRES_PASSWORD: 'change-me', JWT_SECRET: 'real', NODE_ENV: 'production', S3_REGION: 'eu-west-1', MAIL_FROM: 'a@b.c' }, isSecret);
    const pw = d.atExampleValue.find((x) => x.name === 'POSTGRES_PASSWORD');
    assert.deepEqual(pw, { name: 'POSTGRES_PASSWORD', secret: true, placeholder: true, concern: true });
  });

  test('a SECRET at the example value is a concern even when the value looks real', () => {
    // The case the placeholder rule missed on the first live run. This stack's JWT_SECRET,
    // S3_ACCESS_KEY, S3_SECRET_KEY and TELEMETRY_ADMIN_KEY all equal the example file's
    // values, and none of them reads like "change-me" — so all four were filed under "meant
    // to be copied" while being shared credentials sitting in the repository.
    const ex = 'JWT_SECRET=h7Kq2mZpX4vNwR8tLb\nS3_REGION=us-east-1';
    const d = diffConfig(ex, { JWT_SECRET: 'h7Kq2mZpX4vNwR8tLb', S3_REGION: 'us-east-1' }, isSecret);
    const j = d.atExampleValue.find((x) => x.name === 'JWT_SECRET');
    assert.equal(j.placeholder, false, 'the value does not look like a placeholder');
    assert.equal(j.concern, true, 'and it is still a concern, because the name is a secret');
    // A non-secret keeping a real default is not a concern; that is the whole point of
    // having two flags rather than one.
    assert.equal(d.atExampleValue.find((x) => x.name === 'S3_REGION').concern, false);
  });

  test('a real default left as-is is reported, but not as a placeholder', () => {
    const d = diffConfig(EXAMPLE, { NODE_ENV: 'production' }, isSecret);
    const n = d.atExampleValue.find((x) => x.name === 'NODE_ENV');
    assert.equal(n.placeholder, false);
  });

  test('unset is marked with whether the example promised a default', () => {
    // An example entry with no value documents a variable without promising anything, so
    // unset is a normal state there and a gap where a default existed.
    const d = diffConfig(EXAMPLE, {}, isSecret);
    const by = Object.fromEntries(d.unset.map((u) => [u.name, u.hadDefault]));
    assert.equal(by.JWT_SECRET, false);
    assert.equal(by.POSTGRES_PASSWORD, true);
  });

  test('an empty string counts as unset, not as a changed value', () => {
    const d = diffConfig(EXAMPLE, { JWT_SECRET: '' }, isSecret);
    assert.equal(d.unset.some((u) => u.name === 'JWT_SECRET'), true);
    assert.equal(d.counts.changed, 0);
  });

  test('platform variables are not reported as undocumented app config', () => {
    // PATH, HOSTNAME and NODE_VERSION are in every container. Listing them makes the
    // undocumented list useless, so it is filtered to names sharing a prefix with the
    // example file's own — and the unfiltered total is still counted, not hidden.
    const d = diffConfig(EXAMPLE, { PATH: '/usr/bin', HOSTNAME: 'x', S3_BUCKET: 'b', NODE_ENV: 'production' }, isSecret);
    assert.deepEqual(d.undocumented, ['S3_BUCKET']);
    assert.ok(d.counts.undocumentedTotal >= 3);
  });

  test('NO VALUE from the environment appears anywhere in the output', () => {
    // The rule the module exists under. An admin session must not be a way to read the
    // instance's environment.
    const env = { POSTGRES_PASSWORD: 'change-me', JWT_SECRET: 'S3CR3T-live-value', S3_REGION: 'eu-west-1', ODD_ONE: 'another-secret-value' };
    const blob = JSON.stringify(diffConfig(EXAMPLE, env, isSecret));
    for (const v of ['S3CR3T-live-value', 'eu-west-1', 'another-secret-value']) {
      assert.equal(blob.includes(v), false, `leaked ${v}`);
    }
  });
});
