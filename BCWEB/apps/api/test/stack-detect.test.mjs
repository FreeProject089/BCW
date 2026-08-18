// The repo reader. Its output is published on a public project page as a description of
// somebody's infrastructure, so the tests care most about what it must NOT say.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectStack, interestingPaths } from '../src/lib/stack-detect.mjs';

const COMPOSE = `
services:
  caddy:
    image: caddy:2-alpine
    depends_on: [web, api]
  web:
    build: ./apps/web
  api:
    build: ./apps/api
    depends_on:
      db:
        condition: service_healthy
      redis: {}
  db:
    image: postgres:16-alpine
  redis:
    image: redis:7-alpine
`;

describe('detectStack', () => {
    test('a compose file gives the components AND the wiring', () => {
        const r = detectStack({ 'infra/compose/docker-compose.yml': COMPOSE });
        assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['api', 'caddy', 'db', 'redis', 'web']);
        // depends_on in BOTH forms: a list on caddy, a map on api.
        assert.ok(r.edges.some((e) => e.from === 'db' && e.to === 'api'), 'map form read');
        assert.ok(r.edges.some((e) => e.from === 'redis' && e.to === 'api'), 'map form, empty value');
        assert.ok(r.edges.some((e) => e.from === 'web' && e.to === 'caddy'), 'list form read');
        assert.equal(r.edges.length, 4);
    });

    test('an image that names itself sets the kind and a readable label', () => {
        const r = detectStack({ 'docker-compose.yml': COMPOSE });
        const by = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
        assert.equal(by.db.kind, 'data');
        assert.equal(by.db.label, 'Postgres', 'not "postgres:16-alpine"');
        assert.equal(by.redis.kind, 'data');
        assert.equal(by.caddy.kind, 'edge');
        assert.equal(by.web.kind, 'app', 'built from source, no image to classify it');
    });

    test('a service built from source is classified by its name', () => {
        // No `image:` to read, but the compose file still NAMED it. Found on a real repo: an
        // nginx service built from a local Dockerfile came back as a generic "app".
        const r = detectStack({ 'docker-compose.yml': 'services:\n  nginx:\n    build: ./proxy\n  redis:\n    build: ./cache\n' });
        const by = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
        assert.equal(by.nginx.kind, 'edge');
        assert.equal(by.redis.kind, 'data');
    });

    test('a name that merely starts like a known one is not it', () => {
        // `redismod` is not redis, and `nginxproxymanager` is its own thing. The word boundary
        // is what keeps name-matching from becoming guesswork.
        const r = detectStack({ 'docker-compose.yml': 'services:\n  redismod:\n    build: .\n  nginxthing:\n    build: .\n' });
        for (const n of r.nodes) assert.equal(n.kind, 'app');
    });

    test('a registry path and a tag do not hide the image', () => {
        const r = detectStack({ 'compose.yaml': 'services:\n  cache:\n    image: ghcr.io/acme/redis:7.2@sha256:abc\n' });
        assert.equal(r.nodes[0].kind, 'data');
        assert.equal(r.nodes[0].label, 'Redis');
    });

    test('THE ONE: nothing recognisable returns nothing, not a plausible diagram', () => {
        // This lands on a public page. A three-tier guess would read as a statement of fact
        // about somebody's infrastructure.
        const r = detectStack({ 'README.md': '# hello', 'src/main.c': 'int main(){}' });
        assert.deepEqual(r.nodes, []);
        assert.deepEqual(r.edges, []);
    });

    test('every component says which file produced it', () => {
        const r = detectStack({ 'docker-compose.yml': COMPOSE, 'apps/api/package.json': '{"name":"api","dependencies":{"fastify":"5"}}' });
        assert.deepEqual(r.evidence, ['docker-compose.yml'],
            'compose is what produced every drawn node; the manifest only lent api its tech');
    });

    test("a monorepo's internal packages are counted, not drawn", () => {
        // THE NOISE ONE. Pointed at a real repo this produced four real services beside twelve
        // unconnected boxes — an SDK, the docs site, a scripts folder — because every
        // package.json in the tree became a component. A compose file says what is DEPLOYED.
        const r = detectStack({
            'docker/docker-compose.yml': 'services:\n  server:\n    build: ./server\n  db:\n    image: postgres:16\n',
            'server/package.json': '{"name":"server","dependencies":{"express":"4"}}',
            'docs/package.json': '{"name":"docs","dependencies":{"react":"19"}}',
            'packages/sdk/package.json': '{"name":"sdk"}',
            'e2e/package.json': '{"name":"e2e"}',
        });
        assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['db', 'server']);
        assert.equal(r.nodes.find((n) => n.id === 'server').tech, 'Express', 'but its manifest still lent the framework');
        assert.ok(r.notes.some((n) => /left out/.test(n)), 'and it says so rather than dropping them silently');
    });

    test('the same dependency in two compose files is one connection', () => {
        // A repo with a production compose and an e2e one drew every shared edge twice.
        const one = 'services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:16\n';
        const r = detectStack({ 'docker-compose.yml': one, 'e2e/docker-compose.yml': one });
        assert.equal(r.edges.length, 1);
    });

    test('an edge to a component that was not drawn is dropped', () => {
        const r = detectStack({ 'docker-compose.yml': 'services:\n  api:\n    depends_on: [ghost]\n' });
        assert.deepEqual(r.edges, []);
    });

    test('a manifest names the framework rather than just "Node.js"', () => {
        const r = detectStack({ 'apps/bot/package.json': '{"name":"bot","dependencies":{"discord.js":"14"}}' });
        assert.equal(r.nodes[0].tech, 'discord.js');
        assert.equal(r.nodes[0].kind, 'app');
    });

    test('a workspace root is not a deployable', () => {
        const r = detectStack({ 'package.json': '{"name":"root","workspaces":["apps/*"]}' });
        assert.deepEqual(r.nodes, []);
    });

    test('compose and a manifest describe one component, not two', () => {
        // Both know about `api`. Compose knows the wiring; only the package.json knows it is
        // Fastify — a service built from source has no image for compose to read.
        const r = detectStack({
            'docker-compose.yml': COMPOSE,
            'apps/api/package.json': '{"name":"api","dependencies":{"fastify":"5"}}',
        });
        const api = r.nodes.filter((n) => n.id === 'api');
        assert.equal(api.length, 1, 'not listed twice');
        assert.equal(api[0].tech, 'Fastify', 'the manifest lent what compose could not know');
        assert.ok(r.edges.some((e) => e.from === 'db' && e.to === 'api'), 'and the wiring survived');
    });

    test('a manifest never overrides an image compose already named', () => {
        const r = detectStack({
            'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n',
            'db/package.json': '{"name":"db","dependencies":{"express":"4"}}',
        });
        assert.equal(r.nodes[0].tech, 'postgres:16');
        assert.equal(r.nodes[0].kind, 'data');
    });

    test('broken YAML is skipped, not half-read', () => {
        const r = detectStack({ 'docker-compose.yml': 'services:\n  - [this is not\n   valid: :\n' });
        assert.deepEqual(r.nodes, []);
    });

    test('other manifest kinds are read', () => {
        const r = detectStack({
            'crates/thing/Cargo.toml': '[package]\nname = "thing"\n',
            'svc/go.mod': 'module github.com/acme/svc\n',
            'py/pyproject.toml': '[project]\nname = "pysvc"\n',
        });
        const techs = Object.fromEntries(r.nodes.map((n) => [n.label, n.tech]));
        assert.equal(techs.thing, 'Rust');
        assert.equal(techs.svc, 'Go');
        assert.equal(techs.pysvc, 'Python');
    });

    test('it says when it found components but no wiring', () => {
        const r = detectStack({ 'apps/a/package.json': '{"name":"a"}' });
        assert.ok(r.notes.some((n) => /no connections were found/i.test(n)), r.notes.join(' | '));
    });

    test('and it does NOT say that when the calls supplied the wiring', () => {
        // The note used to be decided on compose alone and printed above the connections it
        // was denying: "listed without connections", with two of them drawn underneath.
        const r = detectStack(
            { 'web/package.json': '{"name":"web"}', 'srv/Cargo.toml': '[package]\nname = "srv"\n' },
            { endpointLinks: [{ from: { file: 'web/a.js' }, to: { file: 'srv/b.rs' } }] },
        );
        assert.equal(r.edges.length, 1);
        assert.ok(!r.notes.some((n) => /no connections were found/i.test(n)), r.notes.join(' | '));
    });

    test('a partly-read repository says its counts are a floor', () => {
        const args = { endpointLinks: [{ from: { file: 'web/a.js' }, to: { file: 'srv/b.rs' } }], callsTruncated: true };
        const files = { 'web/package.json': '{"name":"web"}', 'srv/Cargo.toml': '[package]\nname = "srv"\n' };
        const r = detectStack(files, args);
        assert.equal(r.edges[0].label, '1+ call', 'not "1 call" — we did not read the whole repo');
        assert.ok(r.notes.some((n) => /minimum/i.test(n)), r.notes.join(' | '));
        assert.equal(detectStack(files, { ...args, callsTruncated: false }).edges[0].label, '1 call');
    });

    test('a saved node carries no bookkeeping field', () => {
        const r = detectStack({ 'docker-compose.yml': COMPOSE });
        for (const n of r.nodes) assert.equal(n.from, undefined, 'the "from" path is for the evidence list, not the config');
    });
});

describe('interestingPaths', () => {
    test('picks the manifests and ignores everything else', () => {
        const got = interestingPaths(['docker-compose.yml', 'README.md', 'apps/api/package.json', 'src/index.js']);
        assert.deepEqual(got, ['docker-compose.yml', 'apps/api/package.json']);
    });

    test("somebody else's code is not this project's shape", () => {
        const got = interestingPaths(['node_modules/x/package.json', 'vendor/y/go.mod', 'dist/package.json', 'target/Cargo.toml']);
        assert.deepEqual(got, []);
    });

    test('deep paths are left out, and the shallowest survive the limit', () => {
        const deep = 'a/b/c/d/e/package.json';
        const got = interestingPaths(['x/package.json', deep, 'package.json']);
        assert.deepEqual(got, ['package.json', 'x/package.json']);
    });

    test('the limit keeps a scan bounded', () => {
        const many = Array.from({ length: 200 }, (_, i) => `p${i}/package.json`);
        assert.equal(interestingPaths(many).length, 40);
    });
});

describe('image tidying', () => {
    test('a content digest and a registry host do not reach the page', () => {
        // Seen on a real repo: 71 characters of sha256 in a component's "built with" line,
        // telling the reader nothing the tag does not.
        const r = detectStack({
            'docker-compose.yml': 'services:\n  cache:\n    image: docker.io/valkey/valkey:9@sha256:3acc0687f2a2e1091fae6450d7842dd658c941338cf0a873ddd9e14b9e4ea4dd\n',
        });
        assert.equal(r.nodes[0].tech, 'valkey/valkey:9');
    });

    test('the org survives, because it says something', () => {
        const r = detectStack({ 'docker-compose.yml': 'services:\n  db:\n    image: ghcr.io/immich-app/postgres:14\n' });
        assert.equal(r.nodes[0].tech, 'immich-app/postgres:14');
    });
});


describe('connections derived from real calls', () => {
    // The gap this closes: a Tauri app has no compose file, so the detector returned its two
    // halves as unconnected boxes — and its own note said so. The `invoke` calls between them
    // were provable all along and nothing used them.
    const TAURI = {
        'frontend/package.json': '{"name":"frontend","dependencies":{"react":"19"}}',
        'src-tauri/Cargo.toml': '[package]\nname = "bmm"\n',
    };
    const LINKS = [
        { kind: 'tauri', from: { file: 'frontend/src/a.ts' }, to: { file: 'src-tauri/src/cmd.rs' } },
        { kind: 'tauri', from: { file: 'frontend/src/b.ts' }, to: { file: 'src-tauri/src/cmd.rs' } },
    ];

    test('two halves with no compose file are connected by their calls', () => {
        const r = detectStack(TAURI, { endpointLinks: LINKS });
        assert.equal(r.edges.length, 1);
        assert.equal(r.edges[0].from, 'bmm', 'the Rust side is what the front end needs');
        assert.equal(r.edges[0].to, 'frontend');
        assert.equal(r.edges[0].label, '2 calls', 'and the count is the label — a bare arrow says only "related"');
    });

    test('it says the connection came from the source, not from compose', () => {
        const r = detectStack(TAURI, { endpointLinks: LINKS });
        assert.ok(r.notes.some((n) => /from calls found in the source/.test(n)), r.notes.join(' | '));
    });

    test('a call inside ONE component is not a connection', () => {
        // Otherwise every box gets a self-loop.
        const r = detectStack(TAURI, {
            endpointLinks: [{ from: { file: 'frontend/src/a.ts' }, to: { file: 'frontend/src/b.ts' } }],
        });
        assert.deepEqual(r.edges, []);
    });

    test('the nested component wins over a root manifest', () => {
        // `src-tauri/src/x.rs` belongs to src-tauri/Cargo.toml, never to a manifest at the root.
        const r = detectStack({ ...TAURI, 'package.json': '{"name":"root"}' }, { endpointLinks: LINKS });
        assert.ok(r.edges.some((e) => e.from === 'bmm' && e.to === 'frontend'));
    });

    test('a connection compose already stated is not drawn twice', () => {
        const r = detectStack({
            'docker-compose.yml': 'services:\n  web:\n    build: ./web\n  api:\n    build: ./api\n',
            'web/package.json': '{"name":"web"}', 'api/package.json': '{"name":"api"}',
        }, { endpointLinks: [{ from: { file: 'web/x.js' }, to: { file: 'api/y.js' } }] });
        const pairs = r.edges.map((e) => `${e.from}|${e.to}`);
        assert.equal(new Set(pairs).size, pairs.length, 'no duplicate connection');
    });
});

describe('an Electron app is three processes, not one box', () => {
    // It came back as two boxes both labelled "Node.js" with no lines between them, while
    // thirteen IPC channels joined them. The manifest reader is not wrong — it is answering a
    // different question, and for a desktop app the answer it gives is the whole app squashed
    // into its package name.
    const APP = {
        'package.json': '{"name":"better-sound-maker","devDependencies":{"electron":"30","vite":"5"}}',
        'electron/package.json': '{"name":"electron"}',
        'electron/main.js': "const { ipcMain } = require('electron');\nipcMain.handle('fs:writeFile', () => {});",
        'electron/preload.js': "const { contextBridge, ipcRenderer } = require('electron');\ncontextBridge.exposeInMainWorld('electronAPI', { writeFile: () => ipcRenderer.invoke('fs:writeFile') });",
    };

    test('the renderer, the bridge, the main process and the disk', () => {
        const r = detectStack(APP);
        assert.deepEqual(r.nodes.map((n) => n.id), ['renderer', 'preload', 'main', 'disk']);
        assert.equal(r.nodes.find((n) => n.id === 'renderer').tech, 'Vite');
        assert.equal(r.nodes.find((n) => n.id === 'main').tech, 'Electron');
    });

    test('and the path each one goes through', () => {
        const r = detectStack(APP);
        const pairs = r.edges.map((e) => `${e.from}>${e.to}`);
        assert.deepEqual(pairs, ['renderer>preload', 'preload>main', 'main>disk']);
    });

    test('no preload means the renderer talks to main directly', () => {
        const { 'electron/preload.js': _drop, ...noBridge } = APP;
        const r = detectStack(noBridge);
        assert.ok(!r.nodes.some((n) => n.id === 'preload'));
        assert.ok(r.edges.some((e) => e.from === 'renderer' && e.to === 'main'));
    });

    test('a compose file still wins — that is a deployed system, not a desktop app', () => {
        const r = detectStack({ ...APP, 'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n' });
        assert.ok(r.nodes.some((n) => n.id === 'db'));
        assert.ok(!r.nodes.some((n) => n.id === 'preload'));
    });

    test('a plain web project is untouched by any of this', () => {
        const r = detectStack({ 'package.json': '{"name":"site","dependencies":{"next":"14"}}' });
        assert.deepEqual(r.nodes.map((n) => n.id), ['app']);
        assert.equal(r.nodes[0].tech, 'Next.js');
    });

    test('every node it draws is marked as generated', () => {
        // So a rebuild replaces its own boxes and never a hand-placed one.
        const r = detectStack(APP);
        assert.ok(r.nodes.every((n) => n.gen === true));
    });
});

describe('a compose file that is a task runner, not a deployment', () => {
    // BetterInstaller ships one that runs its CI gate in a container. The detector took it
    // for the architecture: a Rust installer drawn as two boxes called "ci" and "shell", and
    // its three real crates not drawn at all.
    const CI = `services:
  ci:
    build: .
    image: betterinstaller-dev
    working_dir: /app
    volumes:
      - .:/app
      - bi-target:/tmp/target
  shell:
    extends: ci
    command: bash
`;
    const REPO = {
        'docker-compose.yml': CI,
        'crates/bpkg-core/Cargo.toml': '[package]\nname = "bpkg-core"\n',
        'crates/bpkg-cli/Cargo.toml': '[package]\nname = "bpkg-cli"\n',
    };

    test('the crates are drawn, not the containers', () => {
        const r = detectStack(REPO);
        const ids = r.nodes.map((n) => n.id);
        assert.ok(ids.includes('bpkg-core') && ids.includes('bpkg-cli'), ids.join(','));
        assert.ok(!ids.includes('ci') && !ids.includes('shell'), ids.join(','));
    });

    test('and it says which file it declined to read, and why', () => {
        // Silently ignoring a compose file would be its own trap: somebody would wonder why
        // their services are missing and have nothing to read.
        const r = detectStack(REPO);
        assert.ok(r.notes.some((n) => n.includes('docker-compose.yml') && /port/.test(n)), r.notes.join(' | '));
    });

    test('a real deployment is still a deployment', () => {
        // Ports OR depends_on is enough to be a system, whatever it mounts.
        const r = detectStack({
            'docker-compose.yml': 'services:\n  web:\n    build: .\n    ports: ["80:80"]\n    volumes: [".:/app"]\n',
            'package.json': '{"name":"site"}',
        });
        assert.deepEqual(r.nodes.map((n) => n.id), ['web']);
    });

    test('a single worker that publishes nothing is still a deployment', () => {
        // It mounts nothing of the project, so the second signal is absent.
        const r = detectStack({ 'docker-compose.yml': 'services:\n  worker:\n    image: myorg/worker:1\n' });
        assert.deepEqual(r.nodes.map((n) => n.id), ['worker']);
    });
});

describe("Cargo path dependencies", () => {
    test('a workspace draws the lines between its crates', () => {
        // As explicit as compose's depends_on, and thrown away until now: a Rust workspace
        // came back as one box per crate and not one line between them.
        const r = detectStack({
            'crates/bpkg-core/Cargo.toml': '[package]\nname = "bpkg-core"\n',
            'crates/bpkg-cli/Cargo.toml': '[package]\nname = "bpkg-cli"\n[dependencies]\nbpkg-core = { path = "../bpkg-core" }\nclap.workspace = true\n',
            'crates/installer/Cargo.toml': '[package]\nname = "installer"\n[dependencies]\nbpkg-core = { path = "../bpkg-core" }\nslint.workspace = true\n',
        });
        const pairs = r.edges.map((e) => `${e.from}>${e.to}`);
        assert.ok(pairs.includes('bpkg-core>bpkg-cli'), pairs.join(','));
        assert.ok(pairs.includes('bpkg-core>installer'), pairs.join(','));
        assert.equal(pairs.length, 2, 'and nothing else');
    });

    test('a crates.io dependency is not a component', () => {
        // `clap.workspace = true` and `serde = "1"` are somebody else's code.
        const r = detectStack({
            'a/Cargo.toml': '[package]\nname = "a"\n[dependencies]\nserde = "1"\nclap = { version = "4", features = ["derive"] }\n',
        });
        assert.deepEqual(r.edges, []);
    });
});

describe('a manifest with no source under it', () => {
    // BetterInstaller keeps a requirements.txt at its root — pinned mkdocs, for building the
    // documentation — and it was drawn as a Python application beside the three Rust crates
    // that are the actual product.
    const FILES = {
        'requirements.txt': 'mkdocs==1.6.1\nmkdocs-material==9.5.44\n',
        'crates/bpkg-core/Cargo.toml': '[package]\nname = "bpkg-core"\n',
    };
    const PATHS = ['requirements.txt', 'crates/bpkg-core/Cargo.toml', 'crates/bpkg-core/src/lib.rs', 'mkdocs.yml'];

    test('is not a component', () => {
        const r = detectStack(FILES, { paths: PATHS });
        assert.deepEqual(r.nodes.map((n) => n.id), ['bpkg-core']);
    });

    test('and the page says which one was left out, and why', () => {
        const r = detectStack(FILES, { paths: PATHS });
        assert.ok(r.notes.some((n) => n.includes('requirements.txt') && /tooling/.test(n)), r.notes.join(' | '));
    });

    test('a manifest WITH source is drawn', () => {
        const r = detectStack(
            { 'api/requirements.txt': 'fastapi\n' },
            { paths: ['api/requirements.txt', 'api/main.py'] },
        );
        assert.deepEqual(r.nodes.map((n) => n.id), ['api']);
    });

    test('source that is only in vendored or built folders does not count', () => {
        const r = detectStack(
            { 'package.json': '{"name":"tooling"}' },
            { paths: ['package.json', 'node_modules/x/index.js', 'dist/bundle.js'] },
        );
        assert.deepEqual(r.nodes, []);
    });

    test('with NO file list, nothing is dropped', () => {
        // A scan from a picked folder or a zip sends manifests and no tree; guessing there
        // would silently delete components from a diagram that was fine before.
        const r = detectStack(FILES);
        // The root manifest is named 'app' — there is no folder to name it after.
        assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['app', 'bpkg-core']);
    });
});

describe('two components with the same name', () => {
    test('are told apart by the folder that produced them', () => {
        // BMM's package.json and its src-tauri/Cargo.toml are BOTH called
        // better-mods-manager, so the diagram drew the name twice with an arrow between —
        // which reads as a mistake even though both labels are what the manifests say.
        const r = detectStack({
            'frontend/package.json': '{"name":"better-mods-manager"}',
            'src-tauri/Cargo.toml': '[package]\nname = "better-mods-manager"\n',
        }, { paths: ['frontend/package.json', 'frontend/src/a.js', 'src-tauri/Cargo.toml', 'src-tauri/src/main.rs'] });
        // On the TECH line, not the title: a box clips its title at 17 characters, so
        // "better-mods-manager (src-tauri)" and "better-mods-manager" both render as
        // "better-mods-mana…" — the two identical boxes again, with extra steps.
        assert.deepEqual(r.nodes.map((n) => n.tech).sort(), ['Node.js · frontend', 'Rust · src-tauri']);
        assert.deepEqual([...new Set(r.nodes.map((n) => n.label))], ['better-mods-manager']);
    });

    test('a manifest at the root is tagged with what it is built from', () => {
        // There is no folder to name it after, and "better-mods-manager" twice is the problem
        // this exists to solve.
        const r = detectStack({
            'package.json': '{"name":"better-mods-manager","dependencies":{"react":"19"}}',
            'src-tauri/Cargo.toml': '[package]\nname = "better-mods-manager"\n',
        }, { paths: ['package.json', 'src/a.js', 'src-tauri/Cargo.toml', 'src-tauri/src/main.rs'] });
        // The root manifest keeps its bare tech — there is no folder to add — and the one in
        // a folder gains it, which is enough to tell them apart.
        assert.deepEqual(r.nodes.map((n) => n.tech).sort(), ['React', 'Rust · src-tauri']);
    });

    test('a unique name is left alone', () => {
        const r = detectStack({
            'web/package.json': '{"name":"web"}',
            'api/package.json': '{"name":"api"}',
        }, { paths: ['web/package.json', 'web/a.js', 'api/package.json', 'api/b.js'] });
        assert.deepEqual(r.nodes.map((n) => n.label).sort(), ['api', 'web']);
    });
});
