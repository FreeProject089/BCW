// Small tools for the /dev area that need a server but not a subsystem.
//
// Right now: the catalog/repo feed validator. It exists because the only way to find out
// whether a feed was well-formed was to publish it and watch BMM refuse — a loop with a
// human, a deploy and somebody else's app in it.
import { z } from 'zod';
import { requireRole, requireCap, db } from '../lib/lib.mjs';
import { inspectBmmpa } from '../lib/bmmpa.mjs';
import { inspectAny } from '../lib/bmm-formats.mjs';
import { buildRbacMap } from '../lib/rbac-map.mjs';
import { mapSchema, findIndexDrift } from '../lib/schema-map.mjs';
import { buildComposeMap } from '../lib/compose-map.mjs';
import { buildSecretsMap, isSecretName } from '../lib/secrets-map.mjs';
import { diffConfig } from '../lib/config-diff.mjs';
import { buildDataFlow } from '../lib/data-flow.mjs';
import { buildMigrationMap } from '../lib/migration-map.mjs';
import { buildInfraMap } from '../lib/infra-map.mjs';
import { checkRecipe, nearest } from '../lib/recipe-check.mjs';
import { parse as parseToml } from 'smol-toml';
import { parseRoutes } from '../lib/rbac-map.mjs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { safeFetch } from '../lib/net.mjs';

// What a BMM-native catalog feed has to look like. Written here rather than imported from the
// reader because the reader is forgiving on purpose — it has to keep working against feeds
// published years ago — and a validator that is as forgiving as the reader tells you nothing.
// The rule: the reader accepts it, this says whether you MEANT it.
// The array names a feed may use. Presets are NOT one of them: BetterCommunity publishes
// them under `apps` (see KIND_FEED on the catalog page and the catalog.json renderer, which
// only ever emits apps/plugins/themes), so accepting a `presets` array here would validate a
// shape no reader looks at.
const KINDS = ['app', 'plugin', 'theme'];

const add = (out, level, path, message, hint) => out.push({ level, path, message, hint });

function checkEntry(out, entry, i, kind) {
  const at = `${kind}s[${i}]`;
  if (!entry || typeof entry !== 'object') return add(out, 'error', at, 'Not an object.');
  const need = ['id', 'name', 'version'];
  for (const k of need) {
    if (!entry[k]) add(out, 'error', `${at}.${k}`, `Missing ${k}.`, 'Every entry needs an id, a name and a version.');
  }
  if (entry.id && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(entry.id))) {
    add(out, 'error', `${at}.id`, 'An id may only contain letters, digits, dot, dash and underscore.', 'Ids end up in file paths and URLs.');
  }
  if (entry.version && !/^\d+(\.\d+){0,3}([-+].+)?$/.test(String(entry.version))) {
    add(out, 'warn', `${at}.version`, 'Not a numeric version.', 'BMM compares versions numerically; anything else can never be "newer".');
  }
  const url = entry.download || entry.url;
  if (!url) add(out, 'error', `${at}.download`, 'No download URL.', 'Without it nothing can be installed from this entry.');
  else if (!/^https:\/\//i.test(String(url))) add(out, 'error', `${at}.download`, 'The download URL must be https.', 'BMM refuses plain http downloads.');
  if (entry.sha256 && !/^[a-f0-9]{64}$/i.test(String(entry.sha256))) {
    add(out, 'error', `${at}.sha256`, 'Not a SHA-256 hex digest.', 'It should be 64 hex characters.');
  }
  if (!entry.sha256) add(out, 'warn', `${at}.sha256`, 'No checksum.', 'Without one nobody can tell a corrupted or swapped download from a good one.');
  if (entry.description && String(entry.description).length > 2000) {
    add(out, 'warn', `${at}.description`, 'Very long description.', 'Listings truncate it; the first sentence is what people read.');
  }
}

/** Everything wrong with a feed, in one pass — not the first error. Finding out one problem
 *  per publish is the loop this tool exists to break. */
export function validateFeed(doc) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    add(out, 'error', '', 'The top level must be a JSON object.');
    return out;
  }
  const known = KINDS.filter((k) => Array.isArray(doc[`${k}s`]));
  if (!known.length) {
    const hasPresets = Array.isArray(doc.presets);
    add(out, 'error', '', 'No entries found.',
      hasPresets
        ? 'Found a `presets` array — BetterCommunity publishes presets inside `apps`, and nothing reads `presets`. Rename it.'
        : `Expected at least one of: ${KINDS.map((k) => `${k}s`).join(', ')} — each an array.`);
  }
  for (const k of KINDS) {
    const arr = doc[`${k}s`];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { add(out, 'error', `${k}s`, 'Must be an array.'); continue; }
    const seen = new Map();
    arr.forEach((e, i) => {
      checkEntry(out, e, i, k);
      const id = e && e.id;
      if (id) {
        if (seen.has(id)) add(out, 'error', `${k}s[${i}].id`, `Duplicate id "${id}" (also at index ${seen.get(id)}).`, 'An id must be unique within its list — the second one is unreachable.');
        else seen.set(id, i);
      }
    });
  }
  if (doc.version !== undefined && typeof doc.version !== 'number' && typeof doc.version !== 'string') {
    add(out, 'warn', 'version', 'The feed version should be a number or a string.');
  }
  if (!doc.updated && !doc.updatedAt) {
    add(out, 'warn', '', 'No `updated` timestamp.', 'Clients use it to skip a feed that has not changed.');
  }
  return out;
}

export default async function devtoolRoutes(app) {
  // Read a submitted BMM automation file without running it.
  //
  // The moderation problem this solves: somebody submits a .bmmpa and the only way to know
  // what is in it is to import it into a real BMM — which is the commitment, made by the
  // person who is supposed to be deciding whether to allow it. This answers from the
  // document alone: what it would do, what permissions it grants itself, what it reaches
  // outside BMM, and the full text of any script it carries.
  //
  // Takes the parsed JSON in the body rather than a URL or an upload. Nothing is fetched
  // and nothing is written: a tool for inspecting untrusted content must not become a way
  // to make the server retrieve untrusted content.
  //
  // manage_catalogs, because this is for reviewing submissions — the same audience that
  // approves the catalog items these arrive as.
  app.post('/admin/bmmpa/inspect', {
    preHandler: requireCap('manage_catalogs', 'MOD'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    // A .bmmpa is JSON of unbounded shape, so it is parsed as a raw value rather than
    // described field by field. The size cap is what keeps that safe.
    bodyLimit: 2 * 1024 * 1024,
  }, async (req, reply) => {
    const b = z.object({ doc: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const report = inspectBmmpa(b.data.doc);
    if (!report.ok) return reply.code(400).send({ error: 'unreadable', detail: report.error });
    return report;
  });

  // The database as the two files define it, plus the drift between them.
  //
  // schema.prisma says what the models are; the migrations say what was done. An index
  // created in raw SQL and never declared in the schema is the case that matters: the next
  // generated migration proposes DROPPING it, because a diff believes the schema.
  //
  // The files live in the image under /app/prisma (the Dockerfile flattens packages/db to
  // there) and under packages/db in a dev checkout. Both are tried, and failing to find
  // either is an error rather than an empty map — a map built from nothing reports no
  // drift, which is the most dangerous answer this can give.
  app.get('/admin/schema-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const here = nodePath.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      nodePath.resolve(here, '../../prisma'),
      nodePath.resolve(here, '../../../../packages/db'),
    ];
    let base = null;
    for (const c of candidates) {
      try { await fsp.access(nodePath.join(c, 'schema.prisma')); base = c; break; } catch { /* try the next */ }
    }
    if (!base) return reply.code(500).send({ error: 'schema_not_found', tried: candidates });

    const schema = await fsp.readFile(nodePath.join(base, 'schema.prisma'), 'utf8');
    let migrations = [];
    try {
      const dir = nodePath.join(base, 'migrations');
      const names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      migrations = (await Promise.all(names.map(async (name) => {
        try { return { name, sql: await fsp.readFile(nodePath.join(dir, name, 'migration.sql'), 'utf8') }; }
        catch { return null; }
      }))).filter(Boolean);
    } catch { /* a checkout without migrations still has a schema worth mapping */ }

    const map = mapSchema(schema);
    if (!map.models.length) return reply.code(500).send({ error: 'parsed_nothing' });
    const drift = findIndexDrift(schema, migrations);
    return {
      models: map.models.length,
      relations: map.edges.length,
      migrations: migrations.length,
      // The widest models and the most depended-on ones: the two lists somebody actually
      // wants, rather than 104 rows they will not read.
      widest: [...map.models].sort((a, b) => b.fields.length - a.fields.length).slice(0, 8)
        .map((m) => ({ name: m.name, fields: m.fields.length })),
      mostDependedOn: (() => {
        const inbound = new Map();
        for (const e of map.edges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
        return [...inbound].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, inbound: n }));
      })(),
      drift,
    };
  });

  // Which guard protects which route, read from the route files themselves.
  //
  // Read at request time rather than at boot: this is looked at rarely and the files are
  // a megabyte, so holding the parse in memory for the lifetime of the process would cost
  // more than it saves.
  //
  // ADMIN, not a capability. It reports where the holes are, which is the one map you
  // would want first if you were looking for one — and there is no capability that means
  // "may see the security posture", so the blunt check is the honest one.
  app.get('/admin/rbac-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    // Resolved from this module rather than from cwd: the API is started from different
    // directories in dev and in the container, and a relative path silently reads nothing.
    const dir = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)));
    let files = [];
    try {
      const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.mjs'));
      files = await Promise.all(names.map(async (name) => ({
        name, src: await fsp.readFile(nodePath.join(dir, name), 'utf8'),
      })));
    } catch (e) {
      return reply.code(500).send({ error: 'unreadable', detail: String(e).slice(0, 200) });
    }
    const map = buildRbacMap(files);
    // A map built from zero files would report zero problems, which is the most
    // dangerous possible answer from a tool like this.
    if (!map.total) return reply.code(500).send({ error: 'parsed_nothing', files: files.length });
    return map;
  });

  // The stack and what it publishes to the network, read from docker-compose.yml.
  //
  // `exposedToNetwork` is the list this exists for. DEPLOY_EN.md §12 says the compose file
  // publishes the API and MinIO for convenience and that the firewall must close everything
  // but 22/80/443 immediately after the first deploy — a sentence in section twelve of a
  // guide, which is not where a fact like that survives. This is the same fact somewhere
  // somebody looks.
  //
  // The compose file is NOT in the API image (nothing copies infra/ into it), so in a
  // container this reports not_found rather than an empty stack. An empty stack publishes
  // no ports, which would read as "nothing exposed" — the wrong answer, confidently.
  app.get('/admin/compose-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    // ONE candidate, not a list. In the image the module sits at /app/src/routes and every
    // `../` chain clamps at the filesystem root, so a second and third guess resolve to the
    // exact same path — a list that reads like thoroughness and searches one place.
    const here = nodePath.dirname(fileURLToPath(import.meta.url));
    const candidate = nodePath.resolve(here, '../../../../infra/compose/docker-compose.yml');
    let text = null;
    try { text = await fsp.readFile(candidate, 'utf8'); } catch { /* answered below */ }
    if (text == null) return reply.code(404).send({ error: 'compose_not_found' });

    const map = buildComposeMap(text);
    if (!map.services.length) return reply.code(500).send({ error: 'parsed_nothing' });
    return map;
  });

  // Which environment variables the code reads, and whether a secret can fall back to a
  // value that is in the repository.
  //
  // The fallback VALUE is deliberately not returned. It is in the source and anyone who
  // should be fixing this can read it there; an endpoint that hands out a signing key an
  // instance may actually be using is a worse thing than the finding it reports. The
  // file:line is what makes it actionable, and that is returned in full.
  app.get('/admin/secrets-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const srcRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [];
    const walk = async (dir) => {
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        const p = nodePath.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith('.mjs')) files.push({ name: nodePath.relative(srcRoot, p), src: await fsp.readFile(p, 'utf8') });
      }
    };
    try { await walk(srcRoot); } catch (e) {
      return reply.code(500).send({ error: 'unreadable', detail: String(e).slice(0, 200) });
    }
    if (!files.length) return reply.code(500).send({ error: 'parsed_nothing' });

    // .env.example ships with the repo, not with the image. Without it the "documented"
    // half of the answer is unavailable — which is said, rather than reported as "every
    // variable is undocumented".
    let envExample = null;
    try { envExample = await fsp.readFile(nodePath.resolve(srcRoot, '../../../infra/compose/.env.example'), 'utf8'); }
    catch { /* answered by envExampleFound below */ }

    const map = buildSecretsMap(files, envExample ?? '');
    return {
      counts: map.counts,
      envExampleFound: envExample != null,
      variables: map.variables,
      // Split rather than flagged: the unguarded ones are the finding, and a list where
      // they sit among thirteen already-guarded entries is a list nobody finishes.
      liveFallbacks: map.hardcodedSecrets.filter((h) => !h.guardedInProduction)
        .map(({ name, file, line }) => ({ name, file, line })),
      guardedFallbacks: map.hardcodedSecrets.filter((h) => h.guardedInProduction)
        .map(({ name, file, line }) => ({ name, file, line })),
      undocumented: envExample ? map.undocumented : null,
      unused: envExample ? map.unused : null,
    };
  });

  // What builds and ships this stack.
  //
  // You asked for a Terraform state visualizer; there is no Terraform in any of the four
  // repositories. This answers the same question against what exists: compose-map covers the
  // runtime half (which services, which ports), and this covers the other — the GitHub
  // Actions workflows, what each publishes, and which secrets a fresh clone would need.
  //
  // Like the compose map, .github/ is not copied into the API image, so in a container this
  // returns 404 rather than an empty stack. "No workflows" would read as "nothing builds
  // this", which is the wrong answer said confidently.
  app.get('/admin/infra-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const here = nodePath.dirname(fileURLToPath(import.meta.url));
    const workflows = [];
    for (const d of [
      nodePath.resolve(here, '../../../../.github/workflows'),
      nodePath.resolve(here, '../../../../../.github/workflows'),
    ]) {
      try {
        for (const f of await fsp.readdir(d)) {
          if (!/[.]ya?ml$/.test(f)) continue;
          workflows.push({ name: f, text: await fsp.readFile(nodePath.join(d, f), 'utf8') });
        }
      } catch { continue; /* try the next */ }
      // STOP at the first directory that answered. The two candidates exist because the API
      // sits at a different depth in a checkout than in the image — and in the image they
      // resolve to the SAME directory, because `path.resolve` clamps at `/`. Reading both
      // counted every workflow twice: two workflows, eight jobs, and `ci.yml` listed twice
      // under "needs no secrets". It only surfaced once the directory was actually readable
      // from the container, which is to say the moment the map started working.
      if (workflows.length) break;
    }
    if (!workflows.length) return reply.code(404).send({ error: 'workflows_not_found' });

    // The runtime half when the compose file is readable from here — one document rather
    // than two screens somebody has to hold side by side.
    let compose = null;
    try {
      compose = buildComposeMap(await fsp.readFile(nodePath.resolve(here, '../../../../infra/compose/docker-compose.yml'), 'utf8'));
    } catch { /* buildInfraMap reports runtime: null, which says "not checked" */ }

    return buildInfraMap(workflows, compose);
  });

  // The migration history, and where the folder and the database disagree.
  //
  // The schema map compares schema.prisma against the SQL. This is the other axis, and two
  // of its three answers need a live database:
  //
  //   · a migration recorded as applied whose FOLDER IS GONE. Prisma re-validates a checksum
  //     per migration, so a deleted or renamed folder breaks `migrate deploy` on every other
  //     machine — the one where it was deleted keeps working, which is what makes it hard to
  //     notice.
  //   · a migration started and never finished, or rolled back. The database is then in a
  //     state no migration describes and the next deploy refuses to run at all.
  //
  // A database failure degrades to the on-disk half rather than a 500: "here is the history,
  // I could not reach the database" is an answer; "48 migrations pending" would be a lie.
  app.get('/admin/migration-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const here = nodePath.dirname(fileURLToPath(import.meta.url));
    let base = null;
    for (const c of [nodePath.resolve(here, '../../prisma'), nodePath.resolve(here, '../../../../packages/db')]) {
      try { await fsp.access(nodePath.join(c, 'migrations')); base = c; break; } catch { /* try the next */ }
    }
    if (!base) return reply.code(404).send({ error: 'migrations_not_found' });

    const dir = nodePath.join(base, 'migrations');
    const names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const onDisk = (await Promise.all(names.map(async (name) => {
      try { return { name, sql: await fsp.readFile(nodePath.join(dir, name, 'migration.sql'), 'utf8') }; }
      catch { return null; }
    }))).filter(Boolean);
    if (!onDisk.length) return reply.code(500).send({ error: 'parsed_nothing' });

    let applied = [];
    let hasDatabase = true;
    try {
      const p = await db();
      applied = await p.$queryRaw`
        SELECT migration_name, finished_at, rolled_back_at
        FROM _prisma_migrations`;
    } catch { hasDatabase = false; }

    return buildMigrationMap(onDisk, applied, hasDatabase);
  });

  // Where the data goes: which route touches which table, and what a request with no
  // session can write.
  //
  // The schema map draws the models; the RBAC map says which guard sits on which route.
  // Neither answers "what can an unauthenticated request WRITE", because that needs both:
  // an unguarded route is normal (public feeds, sign-in, webhooks), an unguarded route that
  // CREATES rows is a question. On this codebase the answer is 18, and every one of them is
  // deliberate — which is exactly why it should be a list somebody can look at rather than
  // a thing everybody assumes.
  app.get('/admin/data-flow', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const dir = nodePath.dirname(fileURLToPath(import.meta.url));
    let files = [];
    try {
      const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.mjs'));
      files = await Promise.all(names.map(async (name) => ({
        name, src: await fsp.readFile(nodePath.join(dir, name), 'utf8'),
      })));
    } catch (e) {
      return reply.code(500).send({ error: 'unreadable', detail: String(e).slice(0, 200) });
    }
    const map = buildDataFlow(files, parseRoutes);
    // Zero routes would report zero public writes, which is the most reassuring wrong
    // answer this could give.
    if (!map.counts.routes) return reply.code(500).send({ error: 'parsed_nothing' });
    return map;
  });

  // What .env.example promises, against what THIS instance actually has.
  //
  // The secrets map reads the source and answers "could a secret fall back to a repo value".
  // Only a running instance can answer the other half: of everything documented, what is
  // unset here, and what is still set to the example file's own value.
  //
  // POSTGRES_PASSWORD=change-me copied verbatim into a deployed .env is the single most
  // common way a Compose stack ends up with a credential that is in the repository, and
  // nothing else would notice — the app starts, the database connects, everything works.
  //
  // No VALUE is returned, only names and verdicts, and diffConfig enforces that with a test.
  // An admin session must not become a way to read this instance's environment.
  app.get('/admin/config-diff', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const srcRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
    let example = null;
    try { example = await fsp.readFile(nodePath.resolve(srcRoot, '../../../infra/compose/.env.example'), 'utf8'); }
    catch { /* answered below */ }
    // Without the example there is no question to answer — and an empty example would report
    // every variable as undocumented, which reads as a catastrophe and means nothing.
    if (example == null) return reply.code(404).send({ error: 'env_example_not_found' });

    return diffConfig(example, process.env, isSecretName);
  });

  // Inspect ANY BMM document — automations, mod lists, session replays, navbar configs.
  //
  // The queue had one button, for .bmmpa. Everything else a person can submit or attach
  // arrived as a blob a moderator could only judge by its filename, which is a guess
  // rather than a decision.
  //
  // Same shape as the .bmmpa route and for the same reasons: the parsed value in the
  // body, never a URL — a tool for inspecting untrusted content must not become a way to
  // make the server fetch untrusted content. Nothing is executed, fetched or written.
  app.post('/admin/inspect', {
    preHandler: requireCap('manage_catalogs', 'MOD'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    bodyLimit: 8 * 1024 * 1024,
  }, async (req, reply) => {
    const b = z.object({ doc: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const report = inspectAny(b.data.doc);
    // 200 with ok:false, not a 4xx: "this is not a format I know" is an ANSWER about the
    // file, and the body carries the keys it did find so the caller can say what it saw.
    return report;
  });

  // Paste or point. Signed in, because it makes an outbound request on the caller's behalf —
  // anonymous would make this a URL prober with our IP on it.
  /** The key `bpkg schema --out …` output is uploaded under. */
  const SCHEMA_KEY = 'installer-schema';

  /**
   * Check an installer.toml against the schema that will actually read it.
   *
   * The failure is silent by construction: no struct in bpkg-core's config.rs uses
   * `deny_unknown_fields`, so serde discards any key it does not recognise. Write
   * `[[componentss]]` and the installer builds perfectly with no components — nothing errors,
   * nothing warns, and it surfaces as a missing feature in a shipped installer.
   *
   * The schema is NEVER written out here. It is the artifact `bpkg schema` derives from the
   * Rust types, uploaded as a JSON platform asset. A copy of the schema in JavaScript would be
   * wrong the first time somebody adds a field, and wrong silently — the same bug this catches.
   */
  app.post('/dev/validate-recipe', {
    preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({ body: z.string().max(500_000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: 'Send the installer.toml as `body`.' });

    const p = await db();
    const asset = await p.platformAsset.findUnique({ where: { key: SCHEMA_KEY } }).catch(() => null);
    const schema = asset?.kind === 'json' ? asset.json : null;
    // Said plainly rather than guessed at. Without the artifact every key in a perfectly good
    // recipe looks unknown, and a confidently wrong answer is worse than no answer.
    if (!schema?.keys?.length) {
      return reply.send({
        ok: false, error: 'schema_missing',
        hint: 'Run `bpkg schema --out schema/installer-schema.json` in BetterInstaller and upload it as the platform asset "installer-schema".',
      });
    }

    let doc;
    try { doc = parseToml(b.data.body); }
    catch (e) {
      // The parser names the line, which is the most useful thing anybody gets out of broken
      // TOML — and a recipe that does not parse is a different problem from one that does.
      return reply.send({ ok: false, error: 'bad_toml', message: String(e?.message || e) });
    }

    const r = checkRecipe(doc, schema);
    if (r.error) return reply.send({ ok: false, error: r.error });
    return {
      ...r,
      // The suggestion is the point of reporting a typo: `componentss` → `components`.
      dropped: r.dropped.map((path) => ({ path, ...(nearest(path, schema.keys) || {}) })),
      schema: { version: schema.bpkgVersion || null, keys: schema.keys.length, generatedAt: asset.updatedAt || null },
    };
  });

  app.post('/dev/validate-feed', {
    preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({
      url: z.string().url().max(500).optional(),
      body: z.string().max(2_000_000).optional(),
    }).refine((v) => v.url || v.body, { message: 'url or body' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: 'Send a url or a body.' });

    let text = b.data.body || '';
    let fetched = null;
    if (!text) {
      try {
        // safeFetch, not fetch: the URL comes from the caller and a plain fetch here would
        // reach anything the container can.
        const res = await safeFetch(b.data.url, { signal: AbortSignal.timeout(10_000) });
        text = (await res.text()).slice(0, 2_000_000);
        fetched = { status: res.status, contentType: res.headers.get('content-type') || null, bytes: text.length };
        if (!res.ok) return reply.send({ ok: false, fetched, problems: [{ level: 'error', path: '', message: `The URL answered ${res.status}.`, hint: 'A feed has to be readable without credentials.' }] });
      } catch (e) {
        const msg = String(e?.message || e);
        return reply.send({ ok: false, problems: [{ level: 'error', path: '', message: msg.startsWith('ssrf_') ? 'That address is not reachable from here (private or blocked).' : `Could not fetch it: ${msg}`, hint: 'The feed must be on a public https URL.' }] });
      }
    }

    let doc;
    try { doc = JSON.parse(text); }
    catch (e) {
      // The parser's own message names the offset, which is the most useful thing anybody
      // gets out of a broken JSON file.
      return reply.send({ ok: false, fetched, problems: [{ level: 'error', path: '', message: `Not valid JSON: ${String(e?.message || e)}`, hint: 'A trailing comma and a smart quote are the usual two.' }] });
    }

    const found = validateFeed(doc);
    const errors = found.filter((f) => f.level === 'error').length;
    const counts = KINDS.reduce((a, k) => (Array.isArray(doc[`${k}s`]) ? { ...a, [k]: doc[`${k}s`].length } : a), {});
    return { ok: errors === 0, fetched, counts, problems: found };
  });
}
