// The secrets map. Source text in, three answers out.
//
// The test that carries the most weight is the boot-guard one. Without it the analyser
// reported eighteen hardcoded secrets on the real tree, thirteen of them the same variable
// that server.mjs already refuses to start without — a report that is right about the words
// and wrong about the risk, which is a report nobody reads twice.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSecretName, findReads, parseEnvExample, guardedAtBoot, buildSecretsMap } from '../src/lib/secrets-map.mjs';
import { PRODUCTION_SECRETS } from '../src/lib/boot-guard.mjs';

describe('isSecretName', () => {
  test('the words that mean "must not be guessable"', () => {
    for (const n of ['JWT_SECRET', 'DISCORD_TOKEN', 'ADMIN_KEY', 'SEED_ADMIN_PASSWORD'])
      assert.equal(isSecretName(n), true, n);
  });

  test('a name that carries a secret word and is not a secret', () => {
    // Without these the report is a third PUBLIC_KEY and REDIS_URL, and the real findings
    // are somewhere below the fold.
    for (const n of ['STRIPE_PUBLIC_KEY', 'TOKEN_URL', 'API_KEY_ID', 'SEARCH_KEYWORD'])
      assert.equal(isSecretName(n), false, n);
  });
});

describe('findReads', () => {
  test('the fallback is captured, with the operator that supplied it', () => {
    const [r] = findReads('a.mjs', "const s = process.env.JWT_SECRET || 'dev';");
    assert.equal(r.name, 'JWT_SECRET');
    assert.equal(r.operator, '||');
    assert.equal(r.fallback, 'dev');
    assert.equal(r.line, 1);
  });

  test('?? is a fallback too', () => {
    assert.equal(findReads('a.mjs', 'process.env.X_TOKEN ?? "z"')[0].fallback, 'z');
  });

  test('a bare read has no fallback', () => {
    const [r] = findReads('a.mjs', 'if (process.env.JWT_SECRET) go();');
    assert.equal(r.operator, null);
    assert.equal(r.fallback, null);
  });

  test('a read followed by an unrelated string is not a fallback', () => {
    // `process.env.X === 'production'` supplies nothing. Reading the quotes without
    // checking for || or ?? would call every comparison a hardcoded secret.
    const [r] = findReads('a.mjs', "if (process.env.NODE_ENV === 'production') go();");
    assert.equal(r.fallback, null);
  });

  test('a commented-out read is not a read', () => {
    // Otherwise a variable somebody deleted years ago still shows up as "missing from
    // .env.example", and the deploy checklist grows a line nothing needs.
    assert.deepEqual(findReads('a.mjs', "// process.env.OLD_TOKEN || 'x'"), []);
    assert.deepEqual(findReads('a.mjs', " * process.env.OLD_TOKEN"), []);
  });

  test('line numbers point at the line', () => {
    const reads = findReads('a.mjs', '\n\nprocess.env.A_KEY\n');
    assert.equal(reads[0].line, 3);
  });
});

describe('parseEnvExample', () => {
  test('declared and commented-out names both count as documented', () => {
    // `# STRIPE_KEY=` IS documentation of a variable — that is exactly what the file is for.
    const n = parseEnvExample('A=1\n# B=\n\n#   C = x\nnot a var\n');
    assert.deepEqual([...n].sort(), ['A', 'B', 'C']);
  });
});

describe('guardedAtBoot', () => {
  const SERVER = `
    if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-insecure-secret')) {
      console.error('[fatal] JWT_SECRET is unset or the insecure default');
      process.exit(1);
    }
  `;
  // The inline scanner on its own, with nothing declared. Passing `[]` is what makes these
  // tests about the SCANNER instead of about the declared list.
  const scanned = (src) => guardedAtBoot([{ src }], []);

  test('a variable a production boot refuses to start without', () => {
    assert.equal(scanned(SERVER).has('JWT_SECRET'), true);
  });

  test('a production branch that does NOT exit guards nothing', () => {
    // Logging a warning and carrying on is the failure mode this whole analyser exists to
    // find. Counting it as a guard would hide the finding behind the finding.
    const warnOnly = "if (process.env.NODE_ENV === 'production' && !process.env.LINK_SECRET) console.warn('unset');";
    assert.equal(scanned(warnOnly).size, 0);
  });

  test('an unrelated variable is not swept in by proximity', () => {
    assert.equal(scanned(SERVER).has('LINK_LOOKUP_SECRET'), false);
  });

  // ── and the half that had no test at all ──────────────────────────────────
  //
  // Every test above uses a STRING that looks like the old server.mjs. That is why this
  // drifted without a red run: the guard moved into boot-guard.mjs, where the names live in
  // a data structure and the NODE_ENV test is behind isProduction(), so the scanner matched
  // nothing in the real files — and the report announced sixteen unguarded secrets, all of
  // which are guarded. The fixture stayed green throughout, because it is a copy of the code
  // as it was.
  test('what the boot guard declares is reported as guarded, whatever shape it is written in', () => {
    for (const s of PRODUCTION_SECRETS) {
      for (const v of s.vars) {
        assert.equal(guardedAtBoot([]).has(v), true,
          `${v} is refused at boot and would be reported as unguarded`);
      }
    }
  });

  test('a name nothing guards is still not guarded', () => {
    // The opposite failure: a list broad enough to mark everything safe is a report that
    // never fires, which is the same uselessness from the other side.
    assert.equal(guardedAtBoot([]).has('STRIPE_SECRET_KEY'), false);
  });
});

describe('buildSecretsMap', () => {
  const FILES = [
    { name: 'server.mjs', src: "if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) { process.exit(1); }" },
    { name: 'lib.mjs', src: "const j = process.env.JWT_SECRET || 'dev-only-insecure-secret';" },
    // Deliberately a secret the boot guard does NOT declare. LINK_LOOKUP_SECRET used to
    // stand here and is now guarded for real, which turned this fixture's "unguarded"
    // example into a guarded one — so the test that exists to prove the two are told apart
    // was asserting that a protected secret is unprotected.
    { name: 'bot.mjs', src: "const l = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';" },
    { name: 'mail.mjs', src: "const from = process.env.MAIL_FROM || '';\nconst h = process.env.MAIL_HOST;" },
    // Secret-ish AND empty: the case that reaches the fallback test at all. MAIL_FROM does
    // not — it is filtered out one line earlier for not being a secret, so a suite built on
    // it alone stays green when the empty check breaks.
    { name: 'kofi.mjs', src: "const k = process.env.KOFI_TOKEN || '';" },
  ];
  const ENV = 'NODE_ENV=\nJWT_SECRET=\nMAIL_FROM=\nMAIL_HOST=\nKOFI_TOKEN=\nOLD_UNUSED=\n';

  test('a guarded fallback and a live one are both listed, and told apart', () => {
    const m = buildSecretsMap(FILES, ENV);
    const by = Object.fromEntries(m.hardcodedSecrets.map((h) => [h.name, h.guardedInProduction]));
    assert.deepEqual(by, { JWT_SECRET: true, STRIPE_SECRET_KEY: false });
  });

  test('an empty fallback is not a hardcoded secret', () => {
    // `|| ''` is "this feature is off unless configured". Listing it beside a real signing
    // key is how a five-line report becomes a fifty-line one.
    const m = buildSecretsMap(FILES, ENV);
    assert.equal(m.hardcodedSecrets.some((h) => h.name === 'KOFI_TOKEN'), false);
    assert.equal(m.hardcodedSecrets.some((h) => h.name === 'MAIL_FROM'), false);
  });

  test('read but never documented — the deploy that comes up and then fails', () => {
    const m = buildSecretsMap(FILES, ENV);
    assert.deepEqual(m.undocumented.map((u) => u.name), ['STRIPE_SECRET_KEY']);
    assert.equal(m.undocumented[0].secret, true);
    assert.equal(m.undocumented[0].first, 'bot.mjs:1');
  });

  test('documented and never read — configuration somebody keeps carrying forward', () => {
    assert.deepEqual(buildSecretsMap(FILES, ENV).unused, ['OLD_UNUSED']);
  });

  test('NODE_ENV is a read like any other and does not become a finding', () => {
    const m = buildSecretsMap(FILES, ENV);
    assert.equal(m.hardcodedSecrets.some((h) => h.name === 'NODE_ENV'), false);
  });

  test('counts describe the source rather than judging it', () => {
    const m = buildSecretsMap(FILES, ENV);
    // `read` counts distinct NAMES, not reads: JWT_SECRET appears in two files and once.
    //
    // guardedAtBoot is no longer a count of what the FIXTURE guards — it is what the real
    // boot guard declares plus anything the fixture guards inline, which is the number a
    // person reading the report needs. Asserted against the declaration so it moves when
    // the guard does, rather than being a magic number that pins today's list.
    const declared = new Set(PRODUCTION_SECRETS.flatMap((x) => x.vars));
    assert.deepEqual(m.counts, {
      read: 6, documented: 6, secretish: 3,
      guardedAtBoot: new Set([...declared, 'JWT_SECRET']).size,
    });
  });
});
