// What .env.example promises, against what this instance actually has.
//
// The secrets map answers "could a secret fall back to a repo value" from the SOURCE. This
// answers the other half, and only a running instance can: of everything the example file
// documents, what is unset here — and, the one that matters, what is still set to the
// example's own value.
//
// `POSTGRES_PASSWORD=change-me` copied verbatim into a deployed .env is not a hypothetical.
// It is the single most common way a Compose stack ends up with a credential that is in the
// repository, and nothing in the codebase would notice: the app starts, the database
// connects, everything works.
//
// VALUES NEVER LEAVE THIS MODULE. Every output is a NAME and a verdict. A tool that reports
// configuration problems by printing the configuration is a worse problem than the one it
// reports — this one is reachable by an admin over HTTP, and an admin session should not be
// a way to read the instance's environment.

/** `NAME=value` from an env-format file, keeping the value — it is needed to compare, and
 *  it is the example file's value, which is public by definition. */
export function parseEnvPairs(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      // A commented-out declaration still DOCUMENTS a variable, and the example value it
      // carries is still the value somebody will paste. Both halves count.
      const c = line.match(/^#\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/);
      if (c) out.set(c[1], stripQuotes(c[2]));
      continue;
    }
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (m) out.set(m[1], stripQuotes(m[2]));
  }
  return out;
}

function stripQuotes(v) {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/**
 * An example value that is a PLACEHOLDER rather than a real default.
 *
 * `NODE_ENV=production` and `DB_PORT=5432` are meant to be copied — reporting them as "still
 * at the example value" is noise that buries the one line that matters. A placeholder is
 * empty, or says change-me, or is one of the obvious stand-ins.
 *
 * This is a judgement, so it is deliberately narrow: a value it fails to recognise is
 * reported (a false alarm somebody dismisses), never silently cleared.
 */
export function isPlaceholder(value) {
  const v = String(value ?? '').trim();
  if (!v) return false; // empty in the example means "no default", not a placeholder value
  return /^(change[-_ ]?me|changeme|replace[-_ ]?me|your[-_ ].*|xxx+|todo|secret|password|dev|dev-only.*|insecure.*|example.*|<.*>)$/i.test(v);
}

/**
 * The diff. Names and verdicts only.
 *
 * `atExampleValue` is the list to read first: documented, set here, and set to exactly what
 * the example file suggests. For a secret-ish name that is a credential anybody with the
 * repository knows.
 */
export function diffConfig(exampleText, env, isSecretName = () => false) {
  const example = parseEnvPairs(exampleText);
  const unset = [];
  const atExampleValue = [];
  const changed = [];

  for (const [name, exampleValue] of example) {
    const actual = env[name];
    if (actual === undefined || actual === '') {
      // An example entry with no value documents a variable without promising a default;
      // unset is then a normal state, not a finding. Reported, but marked.
      unset.push({ name, secret: isSecretName(name), hadDefault: exampleValue !== '' });
      continue;
    }
    if (exampleValue !== '' && actual === exampleValue) {
      const secret = isSecretName(name);
      atExampleValue.push({
        name,
        secret,
        placeholder: isPlaceholder(exampleValue),
        // For a SECRET, matching the example is the finding on its own — how the value
        // happens to look is irrelevant. The placeholder test was written first and it
        // missed the real case on the first live run: this stack's JWT_SECRET, S3_ACCESS_KEY,
        // S3_SECRET_KEY and TELEMETRY_ADMIN_KEY all equal the example file's values, and
        // none of them reads like "change-me", so all four were filed under "meant to be
        // copied". A rule that clears a shared signing key because it looks plausible is
        // worse than no rule.
        concern: secret || isPlaceholder(exampleValue),
      });
      continue;
    }
    changed.push(name);
  }

  // Set here and never documented. Not a fault — plenty of variables are platform-provided
  // (PATH, HOSTNAME, NODE_VERSION) — so this is filtered to names the example file's own
  // naming suggests belong to this app, and everything else is only counted.
  // A minimum prefix length was the first attempt and it was wrong: it dropped S3_*, which
  // is real configuration in this stack, while keeping nothing useful. An explicit list of
  // platform names is narrower and can be read.
  const PLATFORM = new Set([
    'PATH', 'HOME', 'HOSTNAME', 'PWD', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'USER', 'TZ',
    'NODE_VERSION', 'YARN_VERSION', 'NODE_OPTIONS', 'NODE_ENV',
  ]);
  const prefixes = new Set([...example.keys()].map((k) => k.split('_')[0]));
  const known = new Set(example.keys());
  const undocumented = Object.keys(env)
    .filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k) && !known.has(k) && !PLATFORM.has(k) && prefixes.has(k.split('_')[0]));

  return {
    counts: {
      documented: example.size,
      unset: unset.length,
      atExampleValue: atExampleValue.length,
      changed: changed.length,
      undocumented: undocumented.length,
      // Counted, not subtracted: `env.length - example.size` is only right when every
      // documented name is also set, and it goes negative the moment one is not.
      undocumentedTotal: Object.keys(env).filter((k) => !example.has(k)).length,
    },
    unset,
    atExampleValue,
    undocumented,
  };
}
