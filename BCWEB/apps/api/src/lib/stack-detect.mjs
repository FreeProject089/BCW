// Reading a repository and saying what it is made of.
//
// The output lands on a PUBLIC project page, so the rule that governs everything here is:
// never state what no file said. Every node carries the path that produced it, and a repo with
// nothing recognisable returns nothing at all rather than a plausible three-tier diagram.
// A guess published as a description of somebody's infrastructure is worse than a blank tab.
//
// Pure: it takes { path: contents } and returns a draft. The fetching — GitHub, a zip — is the
// route's job, because that part is I/O and this part is the part that can be wrong.

import { parse as parseYaml } from 'yaml';

/** Images whose name IS the answer. Matched on the image's repository part, tag ignored. */
const IMAGE_KIND = [
    [/^(postgres|postgis|mysql|mariadb|mongo|redis|valkey|memcached|clickhouse|cockroachdb|influxdb|elasticsearch|opensearch|cassandra|neo4j|minio)\b/, 'data'],
    [/^(caddy|nginx|traefik|haproxy|envoyproxy|apache)\b/, 'edge'],
    [/^(rabbitmq|nats|kafka|bitnami\/kafka)\b/, 'worker'],
];

/** Pretty names for the images people actually run, so a node does not read "postgres:16-alpine". */
const IMAGE_LABEL = {
    postgres: 'Postgres', postgis: 'PostGIS', mysql: 'MySQL', mariadb: 'MariaDB', mongo: 'MongoDB',
    redis: 'Redis', valkey: 'Valkey', memcached: 'Memcached', clickhouse: 'ClickHouse',
    influxdb: 'InfluxDB', elasticsearch: 'Elasticsearch', opensearch: 'OpenSearch',
    cassandra: 'Cassandra', neo4j: 'Neo4j', minio: 'MinIO', caddy: 'Caddy', nginx: 'nginx',
    traefik: 'Traefik', haproxy: 'HAProxy', apache: 'Apache', rabbitmq: 'RabbitMQ',
    nats: 'NATS', kafka: 'Kafka',
};

/** A dependency that tells you what an app IS. First match wins, so order is deliberate. */
const FRAMEWORK = [
    ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@remix-run/react', 'Remix'], ['astro', 'Astro'],
    ['@sveltejs/kit', 'SvelteKit'], ['fastify', 'Fastify'], ['express', 'Express'],
    ['@nestjs/core', 'NestJS'], ['koa', 'Koa'], ['hono', 'Hono'],
    ['discord.js', 'discord.js'], ['telegraf', 'Telegraf'],
    ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['solid-js', 'Solid'],
];

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'node';
const baseName = (p) => String(p).split('/').filter(Boolean).pop() || p;
const dirOf = (p) => { const parts = String(p).split('/'); parts.pop(); return parts.join('/'); };

/** The image's repository part: `ghcr.io/owner/redis:7-alpine` → `redis`. */
function imageName(image) {
    const noTag = String(image).split('@')[0].replace(/:[^/:]*$/, '');
    return noTag.split('/').pop() || noTag;
}

/**
 * The image as a person would write it: no content digest, no registry host.
 *
 * `docker.io/valkey/valkey:9@sha256:3acc06…` is 71 characters of hash on a public page, and the
 * hash tells a reader nothing the tag does not. The org is kept — `immich-app/postgres` says
 * something `postgres` does not.
 */
function tidyImage(image) {
    const noDigest = String(image).split('@')[0];
    return noDigest.replace(/^(docker\.io|ghcr\.io|quay\.io|registry\.[\w.-]+|[\w-]+\.azurecr\.io|public\.ecr\.aws)\//, '');
}

function kindForImage(image) {
    const name = imageName(image);
    for (const [re, kind] of IMAGE_KIND) if (re.test(name)) return kind;
    return null;
}

/**
 * Read every compose file we were given.
 *
 * Compose is the richest evidence there is: it names the services, says which image each runs,
 * and `depends_on` states the wiring outright — so nothing has to be inferred from imports.
 */
function fromCompose(files) {
    const nodes = []; const edges = []; const seen = new Set();

    for (const path of Object.keys(files)) {
        if (!COMPOSE_FILES.includes(baseName(path))) continue;
        let doc;
        // A compose file that does not parse is reported by the caller, not guessed at.
        try { doc = parseYaml(files[path]); } catch { continue; }
        const services = doc?.services;
        if (!services || typeof services !== 'object') continue;

        for (const [name, svc] of Object.entries(services)) {
            if (!svc || typeof svc !== 'object') continue;
            const id = slug(name);
            if (seen.has(id)) continue;
            seen.add(id);
            const image = typeof svc.image === 'string' ? svc.image : '';
            const kind = kindForImage(image)
                // No image to read — a service built from source. Its NAME is still something
                // the file said, so a service called `nginx` or `redis` is classified by it.
                // That is reading the config, not guessing at it; what would be a guess is
                // inferring a role from nothing at all.
                || kindForImage(name)
                // Anything else is an app, not "external": external means somebody ELSE runs
                // it, and a compose file is a list of things YOU run.
                || 'app';
            const pretty = image ? IMAGE_LABEL[imageName(image)] : null;
            nodes.push({
                id,
                label: pretty || name,
                kind,
                ...(image ? { tech: tidyImage(image) } : {}),
                from: path,
            });
        }

        // depends_on is both list and map form.
        for (const [name, svc] of Object.entries(services)) {
            const dep = svc?.depends_on;
            const list = Array.isArray(dep) ? dep : (dep && typeof dep === 'object' ? Object.keys(dep) : []);
            for (const d of list) {
                const from = slug(d); const to = slug(name);
                if (seen.has(from) && seen.has(to) && from !== to) edges.push({ from, to });
            }
        }
    }
    return { nodes, edges };
}

/** package.json / Cargo.toml / go.mod / pyproject: one app per manifest, named by its folder. */
function fromManifests(files) {
    const nodes = [];
    for (const [path, body] of Object.entries(files)) {
        const base = baseName(path);
        const dir = dirOf(path);
        // The repo root's own manifest is usually the workspace, not a deployable — but if it is
        // all there is, it is the answer, so it is kept and the caller dedupes.
        const name = dir ? baseName(dir) : 'app';
        const id = slug(name);
        if (base === 'package.json') {
            let pkg; try { pkg = JSON.parse(body); } catch { continue; }
            if (pkg.workspaces) continue;             // a workspace root deploys nothing itself
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            const fw = FRAMEWORK.find(([d]) => deps[d]);
            nodes.push({ id, label: pkg.name ? baseName(pkg.name) : name, kind: 'app', ...(fw ? { tech: fw[1] } : { tech: 'Node.js' }), from: path });
        } else if (base === 'Cargo.toml') {
            const m = body.match(/^\s*name\s*=\s*"([^"]+)"/m);
            if (/^\s*\[workspace\]/m.test(body) && !m) continue;
            nodes.push({ id: slug(m ? m[1] : name), label: m ? m[1] : name, kind: 'app', tech: 'Rust', from: path });
        } else if (base === 'go.mod') {
            const m = body.match(/^\s*module\s+(\S+)/m);
            nodes.push({ id, label: m ? baseName(m[1]) : name, kind: 'app', tech: 'Go', from: path });
        } else if (base === 'pyproject.toml' || base === 'requirements.txt') {
            const m = base === 'pyproject.toml' ? body.match(/^\s*name\s*=\s*"([^"]+)"/m) : null;
            nodes.push({ id: slug(m ? m[1] : name), label: m ? m[1] : name, kind: 'app', tech: 'Python', from: path });
        }
    }
    return nodes;
}

/**
 * Build a stack draft from a repository's files.
 *
 * @param {Record<string,string>} files  path → contents (only the ones worth reading)
 * @returns {{nodes: object[], edges: object[], evidence: string[], notes: string[]}}
 */
export function detectStack(files = {}) {
    const notes = [];
    const compose = fromCompose(files);
    const composeIds = new Set(compose.nodes.map((n) => n.id));

    // Manifests lend what compose could not know: a service built from source (`build:`, no
    // `image:`) has no tech at all, and its package.json names the framework.
    const manifests = fromManifests(files);
    for (const m of manifests) {
        if (!composeIds.has(m.id)) continue;
        const node = compose.nodes.find((n) => n.id === m.id);
        if (node && !node.tech && m.tech) node.tech = m.tech;
    }

    // When a compose file described the system, it IS the system: it lists what actually gets
    // deployed. Every other manifest in a monorepo is an internal package — an SDK, the docs
    // site, a scripts folder — and adding them produced twelve unconnected boxes beside the
    // four real ones on the first repo this was pointed at. They are counted, not drawn, so
    // nothing is dropped silently.
    const extra = compose.nodes.length ? [] : manifests;
    const skipped = compose.nodes.length ? manifests.filter((m) => !composeIds.has(m.id)).length : 0;

    const nodes = [...compose.nodes, ...extra];
    // Dedupe by id, keeping the first (compose) — two manifests in sibling folders with the
    // same folder name would otherwise both claim it.
    const byId = new Map();
    for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    const list = [...byId.values()];

    if (skipped) {
        notes.push(`${skipped} package manifest(s) were left out: a compose file says what is deployed, and the rest are internal packages. Add any of them by hand if they belong here.`);
    }
    if (!compose.nodes.length && list.length) {
        notes.push('No compose file was found, so the components are listed without connections. Draw them yourself below.');
    }

    // Two compose files declaring the same dependency (a repo with a prod one and an e2e one)
    // produced the same edge twice, and a duplicate edge draws a second line over the first.
    const seenEdge = new Set();
    const edges = compose.edges.filter((e) => {
        const k = `${e.from} ${e.to}`;
        if (seenEdge.has(k)) return false;
        seenEdge.add(k);
        // An edge to a node that got dropped is not an edge.
        return byId.has(e.from) && byId.has(e.to);
    });

    const evidence = [...new Set(list.map((n) => n.from))].sort();
    // `from` is for the admin to see where a box came from; it is not part of the saved shape.
    const clean = list.map(({ from, ...n }) => n);

    return { nodes: clean, edges, evidence, notes };
}

/** Which paths are worth fetching. Keeps a repo scan to a handful of files, not a whole tree. */
export function interestingPaths(paths = [], { maxDepth = 3, limit = 40 } = {}) {
    const WANTED = new Set([...COMPOSE_FILES, 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt']);
    return paths
        .filter((p) => {
            if (p.split('/').length - 1 > maxDepth) return false;
            // node_modules and friends describe somebody else's code, not this project's shape.
            if (/(^|\/)(node_modules|vendor|\.git|dist|build|target|\.venv)(\/|$)/.test(p)) return false;
            return WANTED.has(baseName(p));
        })
        // Shallowest first, so the limit keeps the files that describe the project rather than
        // the ones buried in an example folder.
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
        .slice(0, limit);
}
