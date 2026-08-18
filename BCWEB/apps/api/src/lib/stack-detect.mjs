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
    const ignored = [];

    for (const path of Object.keys(files)) {
        if (!COMPOSE_FILES.includes(baseName(path))) continue;
        let doc;
        // A compose file that does not parse is reported by the caller, not guessed at.
        try { doc = parseYaml(files[path]); } catch { continue; }
        const services = doc?.services;
        if (!services || typeof services !== 'object') continue;

        // Not every compose file describes a deployment. BetterInstaller ships one that runs
        // the CI gate in a container — two services, `ci` and `shell` — and the detector took
        // it for the architecture: the project page showed a Rust installer as two boxes
        // called "ci" and "shell", and its three real crates not at all.
        //
        // The test is structural, not a name list. Two things are true of a task runner and
        // of nothing that is deployed:
        //
        //   · nothing is reachable — no service publishes or exposes a port, and none depends
        //     on another, so there is no system here for anything to be part of;
        //   · at least one service BIND-MOUNTS THE PROJECT ITSELF (`.:/app`). A deployed
        //     service ships its code in its image; one that mounts the working tree over it
        //     exists to run commands against your checkout.
        //
        // Both together, because either alone has honest counter-examples: a single worker
        // publishes no port, and a dev database mounts a seed folder.
        const list = Object.values(services).filter((s) => s && typeof s === 'object');
        const anyPort = list.some((s) => s.ports || s.expose || s.network_mode === 'host');
        const anyDep = list.some((s) => s.depends_on);
        const mountsSelf = list.some((s) => {
            const vols = Array.isArray(s.volumes) ? s.volumes : [];
            return vols.some((v) => typeof v === 'string' && /^\.\/?:/.test(v.trim()));
        });
        if (list.length && !anyPort && !anyDep && mountsSelf) { ignored.push(path); continue; }

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
    return { nodes, edges, ignored };
}

/**
 * Which crate depends on which, from the manifests themselves.
 *
 * `bpkg-core = { path = "../bpkg-core" }` is a dependency stated outright — the same class of
 * evidence as compose's `depends_on`, and the reason a Rust workspace was three unconnected
 * boxes: nothing had read it. Only PATH dependencies, because a crate from crates.io is
 * somebody else's code and not part of this diagram.
 */
function cargoPathEdges(files) {
    const edges = [];
    for (const [path, body] of Object.entries(files)) {
        if (baseName(path) !== 'Cargo.toml') continue;
        const me = body.match(/^\s*name\s*=\s*"([^"]+)"/m);
        if (!me) continue;
        const from = slug(me[1]);
        // `dep = { path = "../x" }` on one line, which is how Cargo writes it. The dependency
        // NAME is what the node is called; the path only proves it is local.
        for (const m of body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*\bpath\s*=\s*"[^"]+"/gm)) {
            const to = slug(m[1]);
            if (to !== from) edges.push({ from: to, to: from, label: 'uses' });
        }
    }
    return edges;
}

/**
 * Directories whose contents are not the product: dependencies, build output, and the
 * repository's own tooling.
 *
 * `tools/` earns its place here the hard way — BetterInstaller holds one Python script in it
 * (a PDF check), and that single file was enough to keep a requirements.txt that pins mkdocs
 * on the diagram as a Python application beside three Rust crates.
 */
const TOOLING_DIR = /(^|\/)(node_modules|vendor|target|dist|build|out|\.venv|site|docs?|tools?|scripts?|infra|ci|examples?|samples?)(\/|$)/;

/** The source extensions a manifest of each kind promises. */
const MANIFEST_SOURCE = {
    'package.json': ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.svelte', '.vue'],
    'Cargo.toml': ['.rs'],
    'go.mod': ['.go'],
    'pyproject.toml': ['.py'],
    'requirements.txt': ['.py'],
};

/**
 * Does this manifest have any source under it?
 *
 * BetterInstaller keeps a `requirements.txt` at its root — pinned mkdocs, for building the
 * documentation site — and it was drawn as a Python application beside the three Rust crates
 * that are the actual product. The same shape catches a package.json that exists only to hold
 * a lint script, and a Cargo.toml that is a bare workspace.
 *
 * Answered from the repository's FILE LIST, not from a list of tool names: "mkdocs is
 * documentation" is a judgement that ages, and "there is no Python here" is a fact. With no
 * file list to consult, nothing is dropped — a scan from a picked folder or a zip keeps every
 * manifest it found, exactly as before.
 */
function manifestHasSource(path, paths) {
    if (!paths?.length) return true;
    const exts = MANIFEST_SOURCE[baseName(path)];
    if (!exts) return true;
    const dir = dirOf(path);
    const prefix = dir ? `${dir}/` : '';
    return paths.some((f) => f.startsWith(prefix)
        && exts.some((e) => f.endsWith(e))
        // Somebody else's code, and the repository's own tooling, are not the product. The
        // same directories the endpoint scanner already skips for the same reason — one
        // list of "this is not the application", not two that drift.
        && !TOOLING_DIR.test(f));
}

/** package.json / Cargo.toml / go.mod / pyproject: one app per manifest, named by its folder. */
function fromManifests(files, paths) {
    const nodes = [];
    const empty = [];
    for (const [path, body] of Object.entries(files)) {
        if (!manifestHasSource(path, paths)) { empty.push(path); continue; }
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
    // Carried on the array rather than returned as a pair: every caller wants the nodes,
    // and one of them also wants to say what it declined to draw.
    nodes.emptyManifests = empty;
    return nodes;
}


/**
 * A desktop app, as the three processes it really is.
 *
 * ELECTRON only, deliberately. Electron ships one package.json, so the manifest reader saw
 * one box named after the folder and stopped — Better Sound.Maker came back as two boxes both
 * labelled "Node.js" and no lines, while thirteen IPC channels joined them. That is not what
 * the app is: a renderer that draws the window, a main process that holds the privileges, and
 * a preload script that is the only reason the first can reach the second.
 *
 * A Tauri app is left alone. Its two halves are already named by real manifests — the crate
 * and the package — and the call pairing labels the arrow between them with how many `invoke`
 * calls it carries. Replacing that with "Front end → Rust core" would be trading a measured
 * answer for a tidier one.
 *
 * Every node carries the file that proves it. A repo with no electron dependency produces
 * nothing here, and the manifest reader's answer stands.
 */
function fromDesktop(files) {
    const nodes = [];
    const edges = [];
    const pkgPaths = Object.keys(files).filter((p) => baseName(p) === 'package.json');
    let electronAt = null;
    let renderTech = null;
    for (const path of pkgPaths) {
        let pkg; try { pkg = JSON.parse(files[path]); } catch { continue; }
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.electron || deps['electron-builder']) electronAt = electronAt || path;
        if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) electronAt = electronAt; // Tauri is found by its Cargo/conf below
        // What draws the window, when the renderer is not a framework the manifest lists.
        if (!renderTech) {
            const fw = FRAMEWORK.find(([d]) => deps[d]);
            if (fw) renderTech = fw[1];
            else if (deps.vite) renderTech = 'Vite';
        }
    }
    if (!electronAt) return { nodes, edges };

    nodes.push({ id: 'renderer', label: 'Window (renderer)', kind: 'app', tech: renderTech || 'JavaScript', from: electronAt, gen: true });
    // The bridge and the main process are named after the files that are them, when those
    // files were read; otherwise after the folder that holds the manifest.
    const preload = Object.keys(files).find((p) => /(^|\/)preload\.(js|cjs|mjs|ts)$/i.test(p));
    const main = Object.keys(files).find((p) => /(^|\/)(main|index|background)\.(js|cjs|mjs|ts)$/i.test(p) && /electron/i.test(p));
    if (preload) {
        nodes.push({ id: 'preload', label: 'Preload bridge', kind: 'app', tech: 'contextBridge', from: preload, gen: true });
        edges.push({ from: 'renderer', to: 'preload', label: 'window.api' });
        edges.push({ from: 'preload', to: 'main', label: 'IPC' });
    }
    nodes.push({ id: 'main', label: 'Main process', kind: 'app', tech: 'Electron', from: main || electronAt, gen: true });
    if (!preload) edges.push({ from: 'renderer', to: 'main', label: 'IPC' });
    // What a desktop app exists to touch. Not a guess: an app with a main process has the
    // file system, and leaving it off draws a program that talks to nothing.
    nodes.push({ id: 'disk', label: 'Your machine', kind: 'data', tech: 'files', from: main || electronAt, gen: true });
    edges.push({ from: 'main', to: 'disk', label: 'reads / writes' });
    return { nodes, edges };
}

/**
 * Build a stack draft from a repository's files.
 *
 * @param {Record<string,string>} files  path → contents (only the ones worth reading)
 * @returns {{nodes: object[], edges: object[], evidence: string[], notes: string[]}}
 */
export function detectStack(files = {}, { endpointLinks = [], callsTruncated = false, paths = [] } = {}) {
    const notes = [];
    const compose = fromCompose(files);
    const composeIds = new Set(compose.nodes.map((n) => n.id));

    // Manifests lend what compose could not know: a service built from source (`build:`, no
    // `image:`) has no tech at all, and its package.json names the framework.
    const manifests = fromManifests(files, paths);
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
    // A desktop app is not one box. Checked BEFORE the manifest fallback, because for an
    // Electron repo the manifests are exactly the answer that was wrong.
    const desktop = compose.nodes.length ? { nodes: [], edges: [] } : fromDesktop(files);
    const extra = compose.nodes.length ? [] : (desktop.nodes.length ? desktop.nodes : manifests);
    const skipped = compose.nodes.length ? manifests.filter((m) => !composeIds.has(m.id)).length : 0;

    const nodes = [...compose.nodes, ...extra];
    // Dedupe by id, keeping the first (compose) — two manifests in sibling folders with the
    // same folder name would otherwise both claim it.
    const byId = new Map();
    for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    const list = [...byId.values()];

    for (const path of manifests.emptyManifests || []) {
        notes.push(`${path} was not drawn as a component: there is no source of its language `
            + 'anywhere under it, so it describes tooling (a docs build, a lint script) rather '
            + 'than something this project runs.');
    }
    for (const path of compose.ignored || []) {
        notes.push(`${path} was not read as the architecture: no service in it publishes a port `
            + 'or depends on another, which is what a build/CI container looks like rather than a '
            + 'deployed system. The manifests were used instead.');
    }
    if (skipped) {
        notes.push(`${skipped} package manifest(s) were left out: a compose file says what is deployed, and the rest are internal packages. Add any of them by hand if they belong here.`);
    }

    // Two compose files declaring the same dependency (a repo with a prod one and an e2e one)
    // produced the same edge twice, and a duplicate edge draws a second line over the first.
    const seenEdge = new Set();
    // Cargo's path dependencies, which are as explicit as compose's depends_on and were being
    // thrown away: a Rust workspace drew one box per crate and not one line between them.
    const edges = [...compose.edges, ...desktop.edges, ...cargoPathEdges(files)].filter((e) => {
        const k = `${e.from} ${e.to}`;
        if (seenEdge.has(k)) return false;
        seenEdge.add(k);
        // An edge to a node that got dropped is not an edge.
        return byId.has(e.from) && byId.has(e.to);
    });

    // Connections nothing else could supply. A repo with no compose file came back as a list
    // of boxes and no lines — which is every Tauri app, where the front end and the Rust are
    // joined by `invoke` calls and by nothing a manifest can see. Added only where they do not
    // duplicate a connection compose already stated: compose is the better source when it
    // exists, because it says intent while these say traffic.
    const derived = edgesFromCalls(list, endpointLinks, { approx: callsTruncated });
    const already = new Set(edges.map((e) => `${e.from}|${e.to}`));
    const extraEdges = derived.filter((e) => !already.has(`${e.from}|${e.to}`) && byId.has(e.from) && byId.has(e.to));
    if (extraEdges.length) {
        notes.push(`${extraEdges.length} connection(s) came from calls found in the source, not from a compose file.`);
        // The count on the line is a floor, not a total: only part of the repository was read.
        // Said here because "102 calls" reads as a measurement, and a public page should not
        // print a number we only partly counted without saying so.
        if (callsTruncated) notes.push('Only part of the source was read, so those call counts are a minimum ("+"), not a total.');
    }
    // Said last, and only if nothing at all connected the boxes — it used to be printed above
    // and contradicted the connections found underneath it.
    if (!edges.length && !extraEdges.length && list.length) {
        notes.push('No connections were found, so the components are listed on their own. Draw them yourself below.');
    }

    const evidence = [...new Set(list.map((n) => n.from))].sort();
    // Two boxes with the same name are two boxes nobody can tell apart. BMM's package.json
    // and its src-tauri/Cargo.toml are BOTH called better-mods-manager, so the diagram drew
    // the name twice and an arrow between them — which reads as a mistake even though both
    // labels are what the manifests say. The directory that produced each one is the
    // disambiguator, and it is a fact rather than a guess.
    const labelCount = new Map();
    for (const n of list) labelCount.set(n.label, (labelCount.get(n.label) || 0) + 1);
    for (const n of list) {
        if (labelCount.get(n.label) < 2) continue;
        const dir = dirOf(n.from || '');
        if (!dir) continue;   // a manifest at the root has no folder to name it after
        // On the TECH line, not appended to the name. A box is 152px wide and clips its title
        // at 17 characters: "better-mods-manager (src-tauri)" and "better-mods-manager" both
        // render as "better-mods-mana…", which is the two identical boxes all over again with
        // extra steps. The second line has room and is already there.
        n.tech = n.tech ? `${n.tech} · ${baseName(dir)}` : baseName(dir);
    }

    // `from` is for the admin to see where a box came from; it is not part of the saved shape.
    // `gen` IS saved: it is how a later rebuild knows which boxes it drew itself and may
    // replace, and which ones a person added and it must never touch.
    const clean = list.map(({ from, ...n }) => ({ ...n, gen: true }));

    return { nodes: clean, edges: [...edges, ...extraEdges], evidence, notes };
}

/** An Electron/Tauri entry point: the main process, and the preload bridge beside it. */
const DESKTOP_ENTRY = /(^|\/)(electron|electron-main|desktop|src-tauri)\/(main|index|background|preload)\.(js|cjs|mjs|ts)$|(^|\/)preload\.(js|cjs|mjs|ts)$/i;

/** Which paths are worth fetching. Keeps a repo scan to a handful of files, not a whole tree. */
export function interestingPaths(paths = [], { maxDepth = 3, limit = 40 } = {}) {
    const WANTED = new Set([...COMPOSE_FILES, 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt']);
    return paths
        .filter((p) => {
            if (p.split('/').length - 1 > maxDepth) return false;
            // node_modules and friends describe somebody else's code, not this project's shape.
            if (/(^|\/)(node_modules|vendor|\.git|dist|build|target|\.venv)(\/|$)/.test(p)) return false;
            if (WANTED.has(baseName(p))) return true;
            // A desktop app's two entry points. They are not manifests, but they are what
            // makes the app three processes instead of one box — and without reading them
            // there is no file to name the main process and the preload bridge after.
            return DESKTOP_ENTRY.test(p);
        })
        // Shallowest first, so the limit keeps the files that describe the project rather than
        // the ones buried in an example folder.
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
        .slice(0, limit);
}

/**
 * Turn proven cross-file calls into connections between COMPONENTS.
 *
 * The detector reads compose files and manifests. A repo without a compose file therefore comes
 * back as a list of boxes and no lines — I wrote that limitation into its own note, and it is
 * every Tauri app: there is no compose, so nothing said the front end talks to the Rust.
 *
 * The endpoint pairing knows. Collapsed to component level, 2028 proven `invoke` calls become
 * the single edge that was missing — and it is derived from real calls, not from the fact that
 * two folders happen to sit in the same repository.
 *
 * A file belongs to the component whose own manifest sits closest above it: `src-tauri/src/x.rs`
 * belongs to the component from `src-tauri/Cargo.toml`, not to the one at the repo root.
 *
 * @param nodes  components, each carrying the `from` path of the manifest that produced it
 * @param links  from buildEndpointGraph — each with from.file / to.file
 */
export function edgesFromCalls(nodes, links = [], { approx = false } = {}) {
    const dirs = nodes
        .filter((n) => n.from)
        .map((n) => ({ id: n.id, dir: dirOf(n.from) }))
        // Longest first, so a nested component wins over the repo root.
        .sort((a, b) => b.dir.length - a.dir.length);

    const owner = (file) => {
        for (const d of dirs) {
            if (!d.dir) continue;                       // the root owns everything; checked last
            if (file === d.dir || file.startsWith(`${d.dir}/`)) return d.id;
        }
        return dirs.find((d) => !d.dir)?.id || null;    // a root manifest, if there is one
    };

    const counts = new Map();
    for (const l of links) {
        const a = owner(l.from?.file || ''); const b = owner(l.to?.file || '');
        // A call inside one component is not a connection between components. Drawing it would
        // put a self-loop on every box.
        if (!a || !b || a === b) continue;
        const key = `${b}|${a}`;                        // "a needs b" — the direction the map uses
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()].map(([key, n]) => {
        const [from, to] = key.split('|');
        // The count IS the label. "24 calls" is a fact a reader can act on; an unlabelled arrow
        // between two boxes says only that somebody thought they were related.
        const plus = approx ? '+' : '';
        return { from, to, label: n === 1 ? `1${plus} call` : `${n}${plus} calls` };
    });
}
