// The stack, read from docker-compose.yml.
//
// Two questions this answers that nothing else does. What depends on what — so "why did the
// API not come up" has an answer other than reading two hundred lines of YAML. And which
// ports are actually published to the host, which is a security question: a port under
// `ports:` is reachable from the network the machine is on, and a port under `expose:` or
// neither is only reachable from inside the compose network.
//
// That distinction is easy to get wrong by hand and expensive when you do. Postgres bound
// to 0.0.0.0:5432 on a VPS is a database on the internet.
//
// A small YAML reader rather than a dependency: compose files are a narrow, indentation-only
// subset — no anchors, no flow mappings beyond inline arrays — and the API image should not
// grow a parser to draw a diagram. It reports what it understood, so a shape it cannot read
// shows up as a missing service rather than as a confident wrong answer.

/**
 * Services, with the fields worth drawing.
 *
 * Deliberately shallow: two levels of indentation is all a compose file uses for the keys
 * this cares about, and going deeper would mean writing the YAML parser this avoids.
 */
export function parseCompose(text) {
  const lines = String(text).split(/\r?\n/);
  const services = [];
  let inServices = false;
  let cur = null;
  let listKey = null;

  const flush = () => { if (cur) services.push(cur); cur = null; };

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    // Top level: `services:` opens, anything else at column 0 closes.
    if (/^[a-zA-Z]/.test(raw)) {
      flush();
      inServices = /^services:/.test(raw);
      continue;
    }
    if (!inServices) continue;

    // A service name: exactly two spaces of indent.
    const svc = raw.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (svc) {
      flush();
      cur = { name: svc[1], image: null, build: false, ports: [], expose: [], dependsOn: [], volumes: [], healthcheck: false };
      listKey = null;
      continue;
    }
    if (!cur) continue;

    // `key: value`, `key: [a, b]`, or `key:` opening a list.
    const kv = raw.match(/^ {4}([a-zA-Z_]+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      listKey = null;
      if (key === 'image') cur.image = value.trim().replace(/^["']|["']$/g, '');
      else if (key === 'build') cur.build = true;
      else if (key === 'healthcheck') cur.healthcheck = true;
      else if (['ports', 'expose', 'depends_on', 'volumes'].includes(key)) {
        // A trailing `# comment` after an inline array made the whole array unreadable, and an
        // unreadable `ports:` is a published port nobody sees (check-published-ports.mjs).
        const inline = value.replace(/\s+#.*$/, '').trim().match(/^\[(.*)\]$/);
        if (inline) {
          const items = inline[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          if (key === 'depends_on') cur.dependsOn.push(...items);
          else if (key === 'ports') cur.ports.push(...items);
          else if (key === 'expose') cur.expose.push(...items);
          else cur.volumes.push(...items);
        } else {
          listKey = key;
        }
      }
      continue;
    }

    // A list item under the key we last saw.
    //
    // EXACTLY six spaces. `{6}` alone also matches the eight-space `condition:` line under
    // the depends_on mapping form, which turned each of those into a dependency literally
    // named "condition: service_healthy" — seven fake dangling deps on the real file, all
    // of them reported as "compose will fail to start".
    const item = raw.match(/^ {6}(?! )-?\s*(.+?):?\s*$/);
    if (item && listKey) {
      const v = item[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
      if (!v) continue;
      if (listKey === 'depends_on') cur.dependsOn.push(v);
      else if (listKey === 'ports') cur.ports.push(v);
      else if (listKey === 'expose') cur.expose.push(v);
      else cur.volumes.push(v);
      continue;
    }
    // depends_on can be a mapping: `  db:` then `    condition: …`. The 6-space form above
    // catches the name; the condition line is 8 spaces and ignored, which is right — the
    // edge exists either way.
  }
  flush();
  return services;
}

/**
 * A published port, split into what actually matters.
 *
 * "3000:3000" publishes to every interface. "127.0.0.1:3000:3000" publishes to loopback
 * only. The difference is whether the service is reachable from the network the host sits
 * on, and it is one token of YAML.
 *
 * A BARE port under `ports:` ("5432") is NOT private: Docker publishes it on every interface,
 * on a random host port. Only `expose:` keeps a port inside the compose network. This used to
 * report a bare port as "publishes nothing" — the one answer a security map must never give.
 *
 * `${VAR:-default}` holds a colon of its own, so it is set aside before the spec is split
 * (`127.0.0.1:${DB_HOST_PORT:-5432}:5432` is three parts, not four). A bind address that is a
 * variable is not loopback: what it resolves to is the server's .env, which nothing here sees.
 *
 * check-published-ports.mjs (CI) uses this same function, so the admin map and the gate cannot
 * disagree about what is public.
 */
export function parsePort(spec) {
  const vars = [];
  const s = String(spec).trim().replace(/\$\{[^}]*\}/g, (m) => `@@V${vars.push(m) - 1}@@`);
  const back = (x) => (x == null ? x : x.replace(/@@V(\d+)@@/g, (_, i) => vars[Number(i)]));
  let bind = null;
  let rest = s;
  const v6 = s.match(/^\[([^\]]*)\]:(.*)$/);
  if (v6) { bind = v6[1]; rest = v6[2]; }
  const parts = rest.split(':');
  if (!v6 && parts.length >= 3) bind = parts.shift();
  const b = back(bind) ?? '0.0.0.0';
  // One part = container port only: Docker picks the host port, on every interface.
  if (parts.length === 1) return { host: null, container: back(parts[0]), bind: b, public: !isLoopback(b) };
  return { host: back(parts[0]), container: back(parts.slice(1).join(':')), bind: b, public: !isLoopback(b) };
}

/**
 * Loopback, as Docker reads a bind address: 127.0.0.0/8 or ::1. Not `localhost` (Docker
 * refuses a name there), not an empty string, not a variable.
 */
export function isLoopback(bind) {
  const b = String(bind ?? '').trim();
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b) || b === '::1';
}

/**
 * The map, plus what is worth a second look.
 *
 * `exposedToNetwork` is the useful output. It is NOT a list of faults: an edge proxy is
 * supposed to publish 80 and 443. It is the list of things that are reachable from outside
 * the machine, which is a list somebody should be able to recite and usually cannot.
 *
 * On this stack it reports two: Caddy's 80 and 443. Postgres (5432), the API (3000-3009),
 * object storage (9000) and Caddy's local-dev 5176 are published on 127.0.0.1 only
 * (SECURITY_SUMMARY §9 #2; check-published-ports.mjs fails CI otherwise), and
 * loopback is not the network. They used to be on every interface, with only a line in
 * guides/run/DEPLOY_EN.md §12 telling the operator to firewall them — which is the point of
 * showing this at all: the same fact on a screen somebody looks at more than once.
 */
export function buildComposeMap(text) {
  const services = parseCompose(text);
  const names = new Set(services.map((s) => s.name));

  const edges = [];
  const danglingDeps = [];
  for (const s of services) {
    for (const d of s.dependsOn) {
      if (names.has(d)) edges.push({ from: s.name, to: d });
      // A depends_on naming a service that does not exist means compose fails to start at
      // all — worth reporting rather than silently drawing nothing.
      else danglingDeps.push({ service: s.name, missing: d });
    }
  }

  const exposedToNetwork = [];
  for (const s of services) {
    for (const p of s.ports) {
      const parsed = parsePort(p);
      if (parsed.public) exposedToNetwork.push({ service: s.name, spec: p, ...parsed });
    }
  }

  // Nothing depends on these and they depend on things: the ends of the chain, which is
  // where "start order" questions begin.
  const dependedOn = new Set(edges.map((e) => e.to));
  const roots = services.filter((s) => !dependedOn.has(s.name)).map((s) => s.name);

  return {
    services,
    edges,
    roots,
    danglingDeps,
    exposedToNetwork,
    counts: {
      services: services.length,
      built: services.filter((s) => s.build).length,
      withHealthcheck: services.filter((s) => s.healthcheck).length,
      publishing: services.filter((s) => s.ports.length).length,
    },
  };
}
