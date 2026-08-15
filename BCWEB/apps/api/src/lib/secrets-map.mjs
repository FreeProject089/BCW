// Which environment variables the code reads, and how.
//
// Three questions nothing answered. Is there a variable the code needs that .env.example
// never mentions — the deploy that comes up and then fails on the first request that touches
// it. Is there one documented and never read — dead configuration somebody keeps carrying
// forward. And, the one that matters: does a SECRET have a hardcoded fallback?
//
// That last one is a real vulnerability shape, not a tidiness concern. `process.env.JWT_SECRET
// || 'dev'` means an instance deployed without that variable set does not fail — it signs
// tokens with a value anybody reading the repository knows. It fails open, silently, and
// looks fine.
//
// Pure text in, structure out: no environment is read, so this reports what the code WOULD
// do rather than what this machine happens to have set.

/** `||` and `??` both provide a fallback; `?.` and `?:` do not. Matched separately so the
 *  operator can be reported — they behave differently for an empty string, and "set but
 *  blank" is a real deploy mistake. */
const READ = /process\.env\.([A-Z][A-Z0-9_]*)\s*(\|\||\?\?)?\s*(?:(['"`])((?:(?!\3).)*)\3)?/g;

/** A name that means the value must not be guessable. Substrings rather than an exact list:
 *  the codebase names things STRIPE_WEBHOOK_SECRET and DISCORD_TOKEN and ADMIN_KEY, and a
 *  list of exact names would go stale the first time somebody adds one. */
const SECRETISH = /(SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|PRIVATE)/;

/** Names that carry a secret-ish word but are not secrets. Listed, because the alternative
 *  is a report where a third of the findings are `PUBLIC_KEY` and nobody reads the rest. */
const NOT_SECRET = /(PUBLIC|_URL$|_HOST$|_PORT$|_ID$|KEYWORD)/;

export function isSecretName(name) {
  return SECRETISH.test(name) && !NOT_SECRET.test(name);
}

/** Every read, with the fallback if the line supplies one literally. */
export function findReads(filename, src) {
  const out = [];
  const lines = String(src).split(/\r?\n/);
  lines.forEach((line, i) => {
    // Comments describe; they do not read. Counting them produces variables that no
    // deployment needs and that a "missing from .env.example" report then demands.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const m of line.matchAll(READ)) {
      out.push({
        name: m[1],
        file: filename,
        line: i + 1,
        operator: m[2] || null,
        fallback: m[2] ? (m[4] ?? null) : null,
      });
    }
  });
  return out;
}

/** Names declared in a .env.example, including the commented-out ones — a line that says
 *  `# STRIPE_KEY=` is documentation of a variable, which is what this is comparing against. */
export function parseEnvExample(text) {
  const names = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.trim().match(/^#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * The three answers.
 *
 * `hardcodedSecrets` is the one to read first. A non-empty fallback on a secret-ish name is
 * an instance that starts without the variable and signs, verifies or authenticates with a
 * value that is in the repository.
 *
 * An EMPTY fallback (`|| ''`) is not that. It is usually a deliberate "this feature is off
 * unless configured", and reporting it beside a real hardcoded secret is how a report gets
 * ignored.
 */
/**
 * Variables a production boot guard refuses to start without.
 *
 * The pattern is a `NODE_ENV === 'production'` test that names the variable and calls
 * process.exit. server.mjs has exactly one, for JWT_SECRET, and it is the difference
 * between a fallback that can be reached in production and one that cannot.
 *
 * Without this the report listed eighteen hardcoded secrets, thirteen of which were the
 * same already-guarded variable — and a report that is right about the words and wrong
 * about the risk gets read once.
 */
export function guardedAtBoot(files) {
  const guarded = new Set();
  for (const { src } of files) {
    const text = String(src);
    for (const m of text.matchAll(/NODE_ENV\s*===\s*'production'[\s\S]{0,400}?process\.exit/g)) {
      for (const v of m[0].matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) guarded.add(v[1]);
    }
  }
  return guarded;
}

export function buildSecretsMap(files, envExample) {
  const reads = files.flatMap(({ name, src }) => findReads(name, src));
  const documented = parseEnvExample(envExample);

  const used = new Map();
  for (const r of reads) {
    if (!used.has(r.name)) used.set(r.name, { name: r.name, secret: isSecretName(r.name), reads: [] });
    used.get(r.name).reads.push(r);
  }

  const guarded = guardedAtBoot(files);
  const hardcodedSecrets = [];
  for (const v of used.values()) {
    if (!v.secret) continue;
    for (const r of v.reads) {
      if (!r.fallback) continue;
      // Guarded ones are still listed — a guard can be deleted, and seeing the fallback
      // is how you know one is needed — but marked, so the unguarded ones are the ones
      // that stand out.
      hardcodedSecrets.push({
        name: v.name, fallback: r.fallback, file: r.file, line: r.line,
        guardedInProduction: guarded.has(v.name),
      });
    }
  }

  const undocumented = [...used.values()]
    .filter((v) => !documented.has(v.name))
    .map((v) => ({ name: v.name, secret: v.secret, reads: v.reads.length, first: `${v.reads[0].file}:${v.reads[0].line}` }));

  const unused = [...documented].filter((n) => !used.has(n));

  return {
    counts: {
      read: used.size,
      documented: documented.size,
      secretish: [...used.values()].filter((v) => v.secret).length,
      guardedAtBoot: guarded.size,
    },
    variables: [...used.values()].map((v) => ({ name: v.name, secret: v.secret, reads: v.reads.length })).sort((a, b) => b.reads - a.reads),
    hardcodedSecrets,
    undocumented,
    unused,
  };
}
