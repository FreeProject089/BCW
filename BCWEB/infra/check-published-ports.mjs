#!/usr/bin/env node
// Fails when a compose file publishes a port to the network that is not Caddy's 80/443.
//
//   node BCWEB/infra/check-published-ports.mjs              scan every compose file in BCW
//   node BCWEB/infra/check-published-ports.mjs --selftest   prove the check still catches things
//
// WHY. Production `docker ps` on 2026-10-06 listed the API (3003-3005), MinIO's S3 API and its
// admin CONSOLE (9000/9001) and Caddy's local-dev 5176 on 0.0.0.0 and [::]. The API reached
// directly skips everything Caddy does: security headers, the real-IP rewrite (so it trusts a
// client-written X-Forwarded-For for rate limits, bans and audit IPs), the /api/domains/ask
// block and the anti-bot rules. The compose file had been fixed on 2026-09-24; the server ran an
// older one. Nothing would have caught the next `"3000:3000"` either: a firewall is not a
// defence here, because Docker writes its own iptables rules ahead of ufw, and the production
// host is an Alpine LXC with no ufw at all.
//
// THE RULE. Every `ports:` entry binds 127.0.0.1 (or ::1), except the `caddy` service of the
// main stack (BCWEB/infra/compose/docker-compose.yml) publishing 80 and 443 (tcp, and udp for
// HTTP/3) to themselves. Anything else that must be public goes through Caddy.
//
// FAIL CLOSED. What this cannot read is a failure, not a pass: the long `target:`/`host_ip:`
// syntax, a `ports:` key the parser did not attach to a service, a bind address that is a
// ${VARIABLE} (its value is the server's .env, which CI never sees), `network_mode: host`.
// A gate that skips what it does not understand reports green on exactly the file that needed it.
//
// The port parser is the admin compose map's (apps/api/src/lib/compose-map.mjs), so the map
// an admin reads and this gate cannot disagree about what is public. CRLF-safe: a Windows
// checkout splits on \r?\n there, and here.
import { readdirSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCompose, parsePort } from '../apps/api/src/lib/compose-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BCW_ROOT = resolve(HERE, '../..');
const MAIN_STACK = 'BCWEB/infra/compose/docker-compose.yml';
// container port -> what the host side must be. 80 for ACME + the http->https redirect, 443 for
// the sites, 443/udp for HTTP/3.
const EDGE_PORTS = new Set(['80', '80/tcp', '443', '443/tcp', '443/udp']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '.claude', 'live', 'backups']);
const COMPOSE_NAME = /^(docker-)?compose([.-][\w.-]*)?\.ya?ml$/i;
const LONG_SYNTAX = /^(target|published|host_ip|protocol|mode|name|app_protocol)\s*:/;

/** Violations in one compose file's text, as human-readable strings. */
export function checkComposeText(rel, text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  const out = [];
  const services = parseCompose(src);
  const isMain = rel.split(sep).join('/') === MAIN_STACK;

  if (/^services:/m.test(src) && services.length === 0) {
    out.push(`${rel}: has a services: section this check could not read (indentation other than 2 spaces?)`);
  }

  // Every `ports:` key must be one the parser attached to a service, or it was not checked.
  let portKeys = 0;
  lines.forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    const m = raw.match(/^(\s*)ports\s*:/);
    if (m) {
      portKeys++;
      if (m[1].length !== 4) out.push(`${rel}:${i + 1}: a ports: key at an unexpected indentation; this check cannot vouch for it`);
    }
    if (/^\s+network_mode\s*:\s*["']?host["']?\s*(#.*)?$/.test(raw)) {
      out.push(`${rel}:${i + 1}: network_mode: host publishes every port the container opens, on every interface`);
    }
  });
  const withPorts = services.filter((s) => s.ports.length > 0).length;
  if (portKeys !== withPorts) {
    out.push(`${rel}: ${portKeys} ports: key(s) but ${withPorts} read; an unread one is a published port nobody checked`);
  }

  for (const s of services) {
    for (const spec of s.ports) {
      if (LONG_SYNTAX.test(spec)) {
        out.push(`${rel}: ${s.name}: long port syntax ("${spec}"); write "127.0.0.1:<host>:<container>" so it can be checked`);
        continue;
      }
      const p = parsePort(spec);
      if (!p.public) continue;
      const edge = isMain && s.name === 'caddy' && EDGE_PORTS.has(p.container)
        && p.host === p.container.replace(/\/(tcp|udp)$/, '')
        && (p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '');
      if (edge) continue;
      const why = p.bind.includes('${') ? 'its bind address is a variable, not provably loopback'
        : p.host == null ? 'a bare container port is published on EVERY interface (use expose: to keep it internal)'
          : `bound to ${p.bind}`;
      out.push(`${rel}: ${s.name}: "${spec}" is reachable from the network (${why}). Bind it to 127.0.0.1, or route it through Caddy.`);
    }
  }
  return out;
}

function findComposeFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) findComposeFiles(full, acc); }
    else if (COMPOSE_NAME.test(name)) acc.push(full);
  }
  return acc;
}

export function scan(root = BCW_ROOT) {
  const files = findComposeFiles(root);
  const violations = [];
  for (const f of files) violations.push(...checkComposeText(relative(root, f), readFileSync(f, 'utf8')));
  return { files: files.map((f) => relative(root, f).split(sep).join('/')), violations };
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────
// Each case runs twice, LF and CRLF. A check that stopped catching a shape fails here.
const CASES = [
  ['the current main-stack shape passes', MAIN_STACK, `services:
  db:
    ports:
      - "127.0.0.1:\${DB_HOST_PORT:-5432}:5432"
  api:
    ports: ["127.0.0.1:3000-3009:3000"]
  caddy:
    ports: ["127.0.0.1:5176:5176", "80:80", "443:443", "443:443/udp"]
`, 0],
  ['the production shape of 2026-10-06 fails on every port', MAIN_STACK, `services:
  minio:
    ports: ["9000:9000", "9001:9001"]
  api:
    ports: ["3000-3009:3000"]
  caddy:
    ports: ["5176:5176", "80:80", "443:443"]
`, 4],
  ['explicit 0.0.0.0 and [::] fail', MAIN_STACK, `services:
  api:
    ports:
      - "0.0.0.0:3000:3000"
      - "[::]:3001:3000"
`, 2],
  ['a bare container port fails', MAIN_STACK, `services:
  db:
    ports: ["5432"]
`, 1],
  ['a variable bind address fails', MAIN_STACK, `services:
  api:
    ports: ["\${API_BIND:-127.0.0.1}:3000:3000"]
`, 1],
  ['80/443 are allowed for caddy only', MAIN_STACK, `services:
  web:
    ports: ["80:80"]
`, 1],
  ['80/443 are allowed in the main stack only', 'BCWEB/other/docker-compose.yml', `services:
  caddy:
    ports: ["443:443"]
`, 1],
  ['caddy may not remap the edge ports', MAIN_STACK, `services:
  caddy:
    ports: ["8443:443"]
`, 1],
  ['the long syntax fails closed', MAIN_STACK, `services:
  api:
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
`, 1],
  ['a trailing comment does not hide a port', MAIN_STACK, `services:
  minio:
    ports: ["9001:9001"]  # console
`, 1],
  ['network_mode: host fails', MAIN_STACK, `services:
  app:
    network_mode: host
`, 1],
  ['a ports: key the parser cannot attach fails', MAIN_STACK, `services:
   api:
     ports: ["3000:3000"]
`, 2],
  ['::1 is loopback', MAIN_STACK, `services:
  s3:
    ports: ["[::1]:9000:9000"]
`, 0],
];

function selftest() {
  let bad = 0;
  for (const [name, rel, text, expected] of CASES) {
    for (const [eol, t] of [['LF', text], ['CRLF', text.replace(/\n/g, '\r\n')]]) {
      const got = checkComposeText(rel.split('/').join(sep), t);
      const ok = expected === 0 ? got.length === 0 : got.length >= expected;
      if (!ok) { bad++; console.error(`FAIL [${eol}] ${name}: expected ${expected} violation(s), got ${got.length}\n  ${got.join('\n  ')}`); }
    }
  }
  // And the file walk: a nested compose file is found, node_modules is not.
  const dir = mkdtempSync(join(tmpdir(), 'ports-'));
  try {
    const nested = join(dir, 'a', 'b');
    const nm = join(dir, 'node_modules', 'x');
    for (const d of [nested, nm]) mkdirSync(d, { recursive: true });
    writeFileSync(join(nested, 'compose.yaml'), 'services:\r\n  x:\r\n    ports: ["8081:80"]\r\n');
    writeFileSync(join(nm, 'docker-compose.yml'), 'services:\n  y:\n    ports: ["1:1"]\n');
    const r = scan(dir);
    if (r.files.length !== 1 || r.violations.length !== 1) { bad++; console.error(`FAIL walk: ${JSON.stringify(r)}`); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  if (bad) { console.error(`check-published-ports selftest: ${bad} failure(s)`); process.exit(1); }
  console.log(`check-published-ports selftest: ${CASES.length} cases x LF/CRLF + file walk OK`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.includes('--selftest')) selftest();
  else {
    const { files, violations } = scan();
    if (!files.length) { console.error('check-published-ports: no compose file found — the walk is broken, not the stack clean'); process.exit(1); }
    if (violations.length) {
      console.error(`Ports published to the network (only caddy 80/443 may be):\n  ${violations.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`check-published-ports: ${files.length} compose file(s), only caddy 80/443 reach the network\n  ${files.join('\n  ')}`);
  }
}
