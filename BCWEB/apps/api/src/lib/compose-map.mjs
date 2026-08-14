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
        const inline = value.trim().match(/^\[(.*)\]$/);
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
      const v = item[1].trim().replace(/^["']|["']$/g, '');
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
 */
export function parsePort(spec) {
  const s = String(spec).trim();
  const parts = s.split(':');
  if (parts.length === 1) return { host: null, container: parts[0], bind: null, public: false };
  if (parts.length === 2) return { host: parts[0], container: parts[1], bind: '0.0.0.0', public: true };
  return { host: parts[1], container: parts[2], bind: parts[0], public: !/^(127\.|localhost|::1)/.test(parts[0]) };
}

/**
 * The map, plus what is worth a second look.
 *
 * `exposedToNetwork` is the useful output. It is NOT a list of faults: an edge proxy is
 * supposed to publish 80 and 443. It is the list of things that are reachable from outside
 * the machine, which is a list somebody should be able to recite and usually cannot.
 *
 * On this stack it reports six: Caddy's 80/443/5176, the API's 3000, and MinIO's 9000/9001.
 * The last three are deliberate — guides/run/DEPLOY_EN.md §12 says the compose file
 * publishes them for convenience and that the firewall must close everything but 22/80/443
 * right after the first deploy. Which is the point of showing this at all: that instruction
 * lives in section twelve of a deploy guide, and this is the same fact on a screen somebody
 * looks at more than once.
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
