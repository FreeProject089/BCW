// The compose map. Text in, structure out.
//
// The indentation test is the one that matters: `depends_on` has two forms, and the mapping
// form nests a `condition:` line under each service name. Accepting six-or-more spaces
// turned every one of those into a dependency literally named "condition: service_healthy"
// — seven fake "compose will not start" findings on the real file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompose, parsePort, buildComposeMap } from '../src/lib/compose-map.mjs';

const YAML = `
version: "3"

services:
  db:
    image: postgres:16-alpine
    expose: ["5432"]
    healthcheck:
      test: ["CMD", "pg_isready"]

  api:
    build:
      context: .
    ports: ["3000:3000"]
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl"]

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "127.0.0.1:5176:5176"
    depends_on:
      - api

volumes:
  pgdata:
`;

describe('parseCompose', () => {
  test('finds every service and stops at the next top-level key', () => {
    // `volumes:` at column 0 must close the services block, not become a service.
    assert.deepEqual(parseCompose(YAML).map((s) => s.name), ['db', 'api', 'caddy']);
  });

  test('image, build and healthcheck', () => {
    const [db, api] = parseCompose(YAML);
    assert.equal(db.image, 'postgres:16-alpine');
    assert.equal(db.build, false);
    assert.equal(db.healthcheck, true);
    assert.equal(api.build, true);
    assert.equal(api.image, null);
  });

  test('the depends_on MAPPING form does not invent a "condition" service', () => {
    // The bug this exists for. `condition: service_healthy` sits at eight spaces under the
    // service name; a six-or-more pattern captured it as a dependency.
    const [, api] = parseCompose(YAML);
    assert.deepEqual(api.dependsOn, ['db']);
  });

  test('the depends_on LIST form works too', () => {
    const caddy = parseCompose(YAML)[2];
    assert.deepEqual(caddy.dependsOn, ['api']);
  });

  test('a trailing comment does not hide the ports it follows', () => {
    const inline = parseCompose('services:\n  a:\n    ports: ["9001:9001"]  # console\n');
    assert.deepEqual(inline[0].ports, ['9001:9001']);
    const list = parseCompose('services:\n  a:\n    ports:\n      - "9001:9001" # console\n');
    assert.deepEqual(list[0].ports, ['9001:9001']);
  });

  test('ports as an inline array and as a list', () => {
    const [, api, caddy] = parseCompose(YAML);
    assert.deepEqual(api.ports, ['3000:3000']);
    assert.deepEqual(caddy.ports, ['80:80', '127.0.0.1:5176:5176']);
  });
});

describe('parsePort', () => {
  test('host:container publishes to every interface', () => {
    assert.deepEqual(parsePort('3000:3000'), { host: '3000', container: '3000', bind: '0.0.0.0', public: true });
  });

  test('a loopback bind is not public', () => {
    // One token of YAML is the whole difference between "reachable from the internet" and
    // "reachable from this machine".
    assert.equal(parsePort('127.0.0.1:5176:5176').public, false);
  });

  test('a bare port is published on every interface, on a port Docker picks', () => {
    // Only `expose:` keeps a port inside the network. `ports: ["5432"]` is Postgres on the
    // internet at a random port; this used to say "publishes nothing".
    assert.deepEqual(parsePort('5432'), { host: null, container: '5432', bind: '0.0.0.0', public: true });
  });

  test('a ${VAR:-default} host port does not shift the bind address', () => {
    assert.deepEqual(parsePort('127.0.0.1:${DB_HOST_PORT:-5432}:5432'),
      { host: '${DB_HOST_PORT:-5432}', container: '5432', bind: '127.0.0.1', public: false });
    // A variable bind is whatever the server's .env says: not provably loopback.
    assert.equal(parsePort('${BIND:-127.0.0.1}:3000:3000').public, true);
  });

  test('explicit every-interface binds, IPv6 loopback, and a protocol suffix', () => {
    assert.equal(parsePort('0.0.0.0:80:80').public, true);
    assert.equal(parsePort('[::]:80:80').public, true);
    assert.equal(parsePort('[::1]:9000:9000').public, false);
    assert.deepEqual(parsePort('443:443/udp'), { host: '443', container: '443/udp', bind: '0.0.0.0', public: true });
    // Docker refuses a host name as a bind address, so `localhost` proves nothing.
    assert.equal(parsePort('localhost:3000:3000').public, true);
  });
});

describe('buildComposeMap', () => {
  test('edges, and roots as the ends of the chain', () => {
    const m = buildComposeMap(YAML);
    assert.deepEqual(m.edges, [{ from: 'api', to: 'db' }, { from: 'caddy', to: 'api' }]);
    assert.deepEqual(m.roots, ['caddy']);
  });

  test('a depends_on naming a service that does not exist is reported', () => {
    // compose refuses to start at all on this, so drawing nothing would be the wrong answer.
    const m = buildComposeMap('services:\n  a:\n    image: x\n    depends_on:\n      - ghost\n');
    assert.deepEqual(m.danglingDeps, [{ service: 'a', missing: 'ghost' }]);
  });

  test('only the genuinely public ports are listed', () => {
    const m = buildComposeMap(YAML);
    assert.deepEqual(m.exposedToNetwork.map((e) => `${e.service}:${e.host}`), ['api:3000', 'caddy:80']);
    // 5176 is loopback-bound and 5432 is only exposed inside the network — neither belongs
    // on a list of "things reachable from outside this machine".
  });

  test('counts describe the stack rather than judging it', () => {
    const m = buildComposeMap(YAML);
    assert.deepEqual(m.counts, { services: 3, built: 1, withHealthcheck: 2, publishing: 2 });
  });
});
