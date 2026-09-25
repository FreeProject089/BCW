// What the production images ship, read from the Dockerfiles and the files around them.
//
// Trivy image (.github/workflows/security.yml) failed the api, bot and provisioner images on
// 2026-09-25 for HIGH/CRITICAL advisories in the npm that node:22-alpine bundles (tar,
// brace-expansion, cross-spawn, …), code none of these services runs, and flagged the web
// image (Trivy DS-0002) for running nginx as root. The fix has several parts that only work
// together, and each can come back on its own without any build failing:
//
//   - the runtime stage of api/bot/provisioner deletes npm, npx, corepack and yarn, and the
//     node base is pinned by tag AND digest (one pin, shared by the four images);
//   - nothing those services run at runtime spawns npm/npx (boot-migrate.mjs did, on every
//     container start: it would now die with "npx: not found" and the API would never boot);
//   - no guide or script tells an operator to `docker compose exec api npm run …`;
//   - the web image serves as an unprivileged user on 8080, and every consumer of that port
//     (nginx.conf, the Caddyfile's web_upstream, the compose healthcheck, the DAST instance)
//     agrees on it — a mismatch is a site-wide 502, not a failed test anywhere else.
//
// Pure file reads: no Docker, no database. The images themselves are built and scanned by the
// trivy-image job; this is what keeps the Dockerfiles from drifting back between two scans.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BCWEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = path.resolve(BCWEB, '..');
const read = (p) => fs.readFileSync(p, 'utf8');

/** Dockerfile → stages [{ from, lines }], continuation lines joined into one instruction. */
function stages(file) {
  const joined = read(file).replace(/\\\r?\n/g, ' ');
  const out = [];
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^FROM\s+(\S+)/i.exec(line);
    if (m) { out.push({ from: m[1], lines: [] }); continue; }
    if (out.length) out.at(-1).lines.push(line);
  }
  return out;
}

const NODE_IMAGES = {
  api: path.join(BCWEB, 'apps/api/Dockerfile'),
  bot: path.join(BCWEB, 'apps/bot/Dockerfile'),
  provisioner: path.join(BCWEB, 'apps/provisioner/Dockerfile'),
};
const WEB = path.join(BCWEB, 'apps/web/Dockerfile');
const PINNED = /^[a-z0-9./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/;
const PACKAGE_MANAGERS = [
  '/usr/local/lib/node_modules/npm', '/usr/local/lib/node_modules/corepack',
  '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/corepack',
  '/usr/local/bin/yarn', '/usr/local/bin/yarnpkg',
];

describe('node runtime images (api, bot, provisioner)', () => {
  for (const [name, file] of Object.entries(NODE_IMAGES)) {
    const st = stages(file);
    const final = st.at(-1);

    test(`${name}: the runtime stage deletes npm, npx, corepack and yarn`, () => {
      assert.ok(st.length >= 2, `${name}: one stage only — npm ci must run in a build stage, not in the image that ships`);
      const rm = final.lines.filter((l) => /^RUN\b/i.test(l) && /\brm\s+-rf\b/.test(l)).join(' ');
      for (const p of PACKAGE_MANAGERS) assert.ok(rm.includes(p), `${name}: the runtime stage does not remove ${p}`);
    });

    test(`${name}: nothing in the runtime stage runs a package manager`, () => {
      for (const l of final.lines) {
        if (/^(RUN|CMD|ENTRYPOINT)\b/i.test(l)) {
          const cmd = l.replace(/\brm\s+-rf\b.*$/, '');
          assert.doesNotMatch(cmd, /\b(npm|npx|corepack|yarn)\b/, `${name}: "${l}" needs a package manager the image no longer has`);
        }
      }
    });

    test(`${name}: every node base is pinned by tag and digest, and runs as a non-root user`, () => {
      for (const s of st.filter((x) => x.from.startsWith('node:'))) {
        assert.match(s.from, PINNED, `${name}: FROM ${s.from} is not pinned by digest`);
      }
      const user = final.lines.filter((l) => /^USER\b/i.test(l)).at(-1);
      assert.ok(user && !/^USER\s+(root|0)(:|\s|$)/i.test(user), `${name}: the runtime stage must end on a non-root USER`);
    });
  }

  test('api, bot, provisioner and web share ONE node pin (bumped together)', () => {
    const pins = new Set();
    for (const file of [...Object.values(NODE_IMAGES), WEB]) {
      for (const s of stages(file)) if (s.from.startsWith('node:')) pins.add(s.from);
    }
    assert.equal(pins.size, 1, `several node bases: ${[...pins].join(', ')}`);
  });
});

describe('no npm/npx at runtime, in code or in the operator guides', () => {
  const SPAWN = /\b(?:execSync|execFileSync|execFile|exec|spawnSync|spawn|run|sh|shCapture)\(\s*[`'"](?:npx|npm|corepack|yarn)\b/;

  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  test('the api, bot and provisioner sources never spawn a package manager', () => {
    const hits = [];
    let files = 0;
    for (const app of ['api', 'bot', 'provisioner']) {
      for (const f of walk(path.join(BCWEB, 'apps', app, 'src')).filter((p) => /\.m?js$/.test(p))) {
        files++;
        read(f).split(/\r?\n/).forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (SPAWN.test(line)) hits.push(`${path.relative(BCWEB, f)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    assert.ok(files > 50, `read ${files} source files — the tree moved, this check cannot be trusted`);
    assert.deepEqual(hits, [], 'use src/lib/prisma-cli.mjs (node + the prisma CLI entry), not npx');
  });

  test('no guide or script runs npm/npx inside the api, bot or provisioner container', () => {
    const hits = [];
    const texts = [path.join(BCWEB, 'README.md'), ...walk(path.join(BCWEB, 'guides')), ...walk(path.join(BCWEB, 'infra'))]
      .filter((p) => /\.(md|sh|ps1|ya?ml|bat|txt)$/.test(p));
    for (const f of texts) {
      read(f).split(/\r?\n/).forEach((line, i) => {
        if (/\b(?:exec|run)\s+(?:-T\s+|--rm\s+)*(?:api|bot|provisioner)\s+(?:npm|npx)\b/.test(line)) hits.push(`${path.relative(BCWEB, f)}:${i + 1}`);
      });
    }
    assert.ok(texts.length > 40, `read ${texts.length} guide/script files — the tree moved`);
    assert.deepEqual(hits, [], 'the container has no npm: write `docker compose exec api node src/<script>.mjs`');
  });
});

describe('web image: unprivileged nginx on 8080, and every consumer of that port agrees', () => {
  const st = stages(WEB);
  const final = st.at(-1);
  const nginxPort = () => {
    const ports = [...read(path.join(BCWEB, 'apps/web/nginx.conf')).matchAll(/^\s*listen\s+(?:\[::\]:)?(\d+)/gm)].map((m) => Number(m[1]));
    assert.ok(ports.length, 'nginx.conf has no listen directive');
    return ports;
  };

  test('the served stage is nginx-unprivileged, pinned, not root, on a port above 1024', () => {
    assert.match(final.from, /^nginxinc\/nginx-unprivileged:/, `FROM ${final.from}: nginx:alpine runs its master process as root (Trivy DS-0002)`);
    assert.match(final.from, PINNED, `FROM ${final.from} is not pinned by digest`);
    const user = final.lines.filter((l) => /^USER\b/i.test(l)).at(-1);
    assert.ok(user && !/^USER\s+(root|0)(:|\s|$)/i.test(user), 'the served stage must end on a non-root USER');
    for (const p of nginxPort()) assert.ok(p > 1024, `nginx.conf listens on ${p}: an unprivileged process cannot bind it`);
    const exposed = final.lines.filter((l) => /^EXPOSE\b/i.test(l)).map((l) => Number(l.split(/\s+/)[1]));
    assert.deepEqual(exposed, nginxPort(), 'EXPOSE and nginx.conf disagree');
  });

  test('Caddyfile web_upstream, the compose healthcheck and the DAST instance use that port and image', () => {
    const [port] = nginxPort();
    const caddy = read(path.join(BCWEB, 'infra/caddy/Caddyfile'));
    const block = /\(web_upstream\)\s*\{[\s\S]*?\n\}/.exec(caddy)?.[0] || '';
    assert.match(block, new RegExp(`\\bport\\s+${port}\\b`), `(web_upstream) does not dial port ${port}: every page would be a 502`);
    assert.doesNotMatch(caddy.replace(/^\s*#.*$/gm, ''), /\bweb:80\b/, 'a live `web:80` upstream remains in the Caddyfile');

    const compose = read(path.join(BCWEB, 'infra/compose/docker-compose.yml'));
    const web = /\n {2}web:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(compose)?.[1] || '';
    assert.ok(web, 'no `web:` service in infra/compose/docker-compose.yml');
    assert.match(web, new RegExp(`127\\.0\\.0\\.1:${port}/`), `the web healthcheck does not probe port ${port}`);

    const dast = read(path.join(REPO, '.github/workflows/dast.yml'));
    const img = /^\s*NGINX_IMAGE:\s*(\S+)/m.exec(dast)?.[1];
    assert.equal(img, final.from, 'dast.yml serves the web with another nginx image than production (NGINX_IMAGE)');
  });
});
