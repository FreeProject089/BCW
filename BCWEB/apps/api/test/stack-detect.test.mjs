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
        assert.ok(r.notes.some((n) => /no compose file/i.test(n)), r.notes.join(' | '));
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
