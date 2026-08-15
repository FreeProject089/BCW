// Secrets an instance must not run on in production, checked once at boot.
//
// server.mjs already refused to start on the default JWT_SECRET. The secrets map found the
// rest: `process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret'` in four route files, with no
// guard anywhere. An instance deployed without that variable does not fail — it authenticates
// the Discord bot endpoints and the telemetry link lookup with a value that is in the
// repository. It fails open, silently, and everything works.
//
// A failed boot is loud and fixed in a minute. A silent one is found by whoever reads the
// repository first.
//
// Checked PER PURPOSE, not per variable name. Bot auth reads
// `BOT_SHARED_SECRET || LINK_LOOKUP_SECRET || 'dev-bot-secret'`, so demanding one specific
// name would reject a deployment that correctly set the other. The rule is the one the code
// actually implements: at least one name in the chain must be set, and to something other
// than the fallback that chain would otherwise use.

/**
 * One thing a secret protects, and the chain of variables that can supply it.
 *
 * `insecure` are the literal fallbacks in the source. Kept as values rather than "any short
 * string": the check is "did the deploy leave the repository's own value in place", which is
 * a fact, not a judgement about entropy.
 */
export const PRODUCTION_SECRETS = [
  {
    purpose: 'session tokens',
    vars: ['JWT_SECRET'],
    insecure: ['dev-only-insecure-secret'],
    consequence: 'anyone could forge a session token, including ADMIN',
  },
  {
    purpose: 'Discord bot authentication',
    vars: ['BOT_SHARED_SECRET', 'LINK_LOOKUP_SECRET'],
    insecure: ['dev-bot-secret'],
    consequence: 'the /bot/* endpoints would accept anyone',
  },
  {
    purpose: 'telemetry and server-control link lookup',
    vars: ['BC_LINK_SECRET', 'LINK_LOOKUP_SECRET'],
    insecure: ['dev-link-secret'],
    consequence: 'the link lookup and server-control endpoints would accept anyone',
  },
];

/**
 * What is wrong, or an empty list.
 *
 * `unset` and `insecure` are reported separately because they are different mistakes: one is
 * a deploy that forgot a variable, the other is a deploy that copied the example file.
 */
export function productionSecretProblems(env, secrets = PRODUCTION_SECRETS) {
  const problems = [];
  for (const s of secrets) {
    // The first name that is set is the one the code will use — the chain is `||`, so a
    // later name never overrides an earlier one, and checking the others would be checking
    // a value nothing reads.
    const used = s.vars.find((v) => env[v] !== undefined && env[v] !== '');
    if (!used) {
      problems.push({ purpose: s.purpose, vars: s.vars, reason: 'unset', consequence: s.consequence });
      continue;
    }
    if (s.insecure.includes(env[used])) {
      problems.push({ purpose: s.purpose, vars: [used], reason: 'insecure_default', consequence: s.consequence });
    }
  }
  return problems;
}

/** The message a person reads at 2am, naming the variable and what it costs. */
export function formatProblems(problems) {
  return problems
    .map((p) => {
      const what = p.reason === 'unset'
        ? `set one of ${p.vars.join(' / ')}`
        : `${p.vars[0]} is still the value from the repository — change it`;
      return `  · ${p.purpose}: ${what} (otherwise ${p.consequence})`;
    })
    .join('\n');
}

/**
 * Is this a production boot?
 *
 * `NODE_ENV === 'production'` only, deliberately. Treating "anything that is not development"
 * as production would fire on every local run where NODE_ENV is simply unset, and a guard
 * that blocks `node server.mjs` on a laptop is a guard somebody removes. The supported deploy
 * sets it — infra/compose/docker-compose.yml does, on the api service — so the gap is a
 * hand-rolled deployment that forgets it, which is documented rather than papered over.
 */
export function isProduction(env) {
  return env.NODE_ENV === 'production';
}
