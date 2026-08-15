// The deployment, as it actually is.
//
// You asked for a "Terraform state visualizer". There is no Terraform in any of the four
// repositories — no .tf, no .tfstate, not a mention — so a reader for one would be a reader
// for a file that does not exist. This is the same question answered against what is really
// there: the stack is a Docker Compose file, and what builds and ships it is GitHub Actions.
//
// compose-map.mjs already answers the runtime half — which services exist, what depends on
// what, which ports reach the network. This is the other half, and the two together are what
// a state visualizer would have shown: what is declared, and what puts it there.
//
// Text in, structure out. A small YAML reader rather than a dependency, for the same reason
// as compose-map: workflow files are a narrow indentation-only subset, and the API image
// should not grow a parser to draw a diagram.

/** `on:` can be a string, a list, or a map. All three mean "these events". */
function parseTriggers(text) {
  // Located by LINE INDEX, not by indexOf('on:') over the whole document. That substring
  // occurs in ordinary prose in these files' header comments, so slicing from the first match
  // walks the block reader off into unrelated lines. The first version returned `push:` —
  // colon included — which is what a reader looks like when it finds the right answer by luck.
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^on:/.test(l));
  if (at === -1) return [];

  const inline = lines[at].replace(/^on:/, '').trim();
  if (inline && inline !== '|' && !inline.startsWith('#')) {
    const arr = inline.match(/^\[(.*)\]$/);
    if (arr) return arr[1].split(',').map((s) => s.trim()).filter(Boolean);
    return [inline.replace(/:$/, '')];
  }

  // Block form: keys at exactly two spaces, until something returns to column 0.
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const k = line.match(/^ {2}([a-z_]+):/);
    if (k) out.push(k[1]);
  }
  return out;
}

/** Every `${{ secrets.NAME }}` a workflow reads. This is the list that decides whether a
 *  fresh fork can build at all, and it is written nowhere else. */
function parseSecrets(text) {
  return [...new Set([...String(text).matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];
}

/** Job names and the runner each asks for — the runner is the part that silently costs money
 *  or silently cannot run a Windows build. */
function parseJobs(text) {
  const at = text.indexOf('\njobs:');
  if (at === -1) return [];
  const jobs = [];
  let current = null;
  for (const line of text.slice(at + 1).split(/\r?\n/).slice(1)) {
    if (/^\S/.test(line)) break;
    const name = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (name) { current = { name: name[1], runsOn: null, steps: 0 }; jobs.push(current); continue; }
    if (!current) continue;
    const runs = line.match(/^\s+runs-on:\s*(.+)$/);
    if (runs) current.runsOn = runs[1].trim().replace(/^["']|["']$/g, '');
    if (/^\s+- (name|uses|run):/.test(line)) current.steps++;
  }
  return jobs;
}

export function parseWorkflow(name, text) {
  const src = String(text);
  return {
    file: name,
    name: (src.match(/^name:\s*(.+)$/m)?.[1] || name).trim().replace(/^["']|["']$/g, ''),
    triggers: parseTriggers(src),
    jobs: parseJobs(src),
    secrets: parseSecrets(src),
    // What the run PRODUCES, which is the only part a reader of a deployment map cares about
    // beyond "it ran". Matched on the actions rather than guessed from job names.
    publishes: {
      release: /softprops\/action-gh-release|gh release create/.test(src),
      pages: /actions\/deploy-pages|peaceiris\/actions-gh-pages/.test(src),
      artifact: /actions\/upload-artifact/.test(src),
      image: /docker\/build-push-action|docker push/.test(src),
    },
  };
}

/**
 * The map.
 *
 * `secretsNeeded` is the answer to "why does this fail on a fork", and `noSecrets` to "which
 * of these can anybody run". Both are one-line facts that currently live only in whoever set
 * the workflows up.
 */
export function buildInfraMap(workflows, composeMap = null) {
  const parsed = workflows.map(({ name, text }) => parseWorkflow(name, text));
  const secretsNeeded = [...new Set(parsed.flatMap((w) => w.secrets))].sort();
  return {
    counts: {
      workflows: parsed.length,
      jobs: parsed.reduce((n, w) => n + w.jobs.length, 0),
      secretsNeeded: secretsNeeded.length,
      services: composeMap?.counts?.services ?? null,
      publishedPorts: composeMap?.exposedToNetwork?.length ?? null,
    },
    workflows: parsed,
    secretsNeeded,
    // Runs on a fork with no secrets configured. Not a fault — CI usually should — but it is
    // the difference between "a contributor can check their work" and "they cannot".
    noSecrets: parsed.filter((w) => !w.secrets.length).map((w) => w.file),
    // Carried through so one document answers both halves: what is declared, and what ships
    // it. Null when the compose file is not readable from here, which is the case inside the
    // API image — said rather than shown as an empty stack.
    runtime: composeMap
      ? { services: composeMap.services.map((s) => s.name), exposed: composeMap.exposedToNetwork }
      : null,
  };
}
