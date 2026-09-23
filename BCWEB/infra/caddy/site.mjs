#!/usr/bin/env node
// Other sites and apps on this server, behind the same Caddy — `node infra/caddy/site.mjs`.
//
// THE PROBLEM IT SOLVES. Putting a second project on the domain meant editing the one
// Caddyfile that also runs BetterCommunity, and Caddy refuses a WHOLE config over one bad
// directive: a typo in the new block exits Caddy 1 and every site goes down with it, while
// every other container reports healthy. That has already happened here once.
//
// THE DESIGN, in three layers:
//
//   SOURCES (what you edit — the only source of truth)
//     infra/caddy/Caddyfile       BetterCommunity. Never touched to add a site; it imports
//                                 the two folders below.
//     infra/caddy/sites.d/*.caddy one file per extra (sub-)domain, a complete site block
//     infra/caddy/paths.d/*.caddy one file per app mounted on a PATH of the main domain
//     infra/caddy/templates/      one commented template per common case (the CLI fills them)
//
//   OUTPUT (what Caddy runs)
//     infra/caddy/live/Caddyfile  ONE flat file: the base with both imports replaced by the
//                                 files they import. Generated, never edited by hand.
//     infra/caddy/backups/        the previous live file, timestamped, before every swap
//
//   GATE (how the output reaches Caddy)
//     generate → `caddy validate` with the stack's real environment → show the diff →
//     back up the live file → swap → `caddy reload`. A config that does not validate is
//     never installed, and a reload that fails puts the backup straight back.
//
// Both halves of "regenerate, then replace" are here: `apply` does it automatically,
// `build --out FILE` writes the generated file somewhere for you to read and swap in by
// hand, and `diff` shows what would change. The Caddyfile the container STARTS with is
// chosen by infra/caddy/entrypoint.sh, which falls back to a config that validates.
//
//   node infra/caddy/site.mjs help     every command and flag
//
// No dependencies: Node 18+ and the docker CLI. Everything Caddy-side runs in the caddy
// image, so no Caddy binary is needed on the host.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import dns from 'node:dns/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = resolve(HERE, '..', 'compose');
const COMPOSE_FILE = join(COMPOSE_DIR, 'docker-compose.yml');
const IN_CONTAINER = '/etc/caddy';          // where compose mounts infra/caddy (see the guide)
const KEEP_BACKUPS = 20;

// BetterCommunity's cookies. They are scoped to the parent domain in production, so every
// sub-domain receives them; the templates strip them before a request reaches another app.
// Kept here only for the self-test, which checks the templates still name all three.
const SESSION_COOKIES = ['bcw_session', 'bcw_elevated', 'tele_session'];

/** Every path the tool touches, relative to one caddy folder — the real one, or the
 *  throw-away copy the self-test builds. */
function tree(root = HERE) {
    return {
        root,
        base: join(root, 'Caddyfile'),
        dirs: { site: join(root, 'sites.d'), path: join(root, 'paths.d') },
        templates: join(root, 'templates'),
        liveDir: join(root, 'live'),
        live: join(root, 'live', 'Caddyfile'),
        next: join(root, 'live', 'Caddyfile.next'),
        backups: join(root, 'backups'),
        generated: join(root, 'generated', 'Caddyfile'),
        static: join(root, 'static'),
    };
}
const T = tree();

// ── Output ───────────────────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1'), red = c('31'), green = c('32'), yellow = c('33'), dim = c('2');
const say = (s = '') => console.log(s);
const warn = (s) => console.log(yellow('! ') + s);
class Refusal extends Error {}
const die = (s) => { throw new Refusal(s); };

// ── What a user may type ─────────────────────────────────────────────────────────────────
// Every value below ends up as TEXT inside a Caddyfile. A space, a brace, a quote or a newline
// would let a value open its own directive or block, so each check is an allow-list of the
// characters that value can legitimately contain — never a list of what to strip.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const RE = {
    domain: new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`),
    name: /^[a-z0-9][a-z0-9-]{0,62}$/,
    upstream: /^([a-z0-9][a-z0-9_.-]{0,252}):(\d{1,5})$/,
    path: /^(?:\/[a-z0-9][a-z0-9._~-]{0,62}){1,8}$/i,
};
// Paths the BetterCommunity block already routes somewhere. Mounting an app on one of them
// would take that route away from the site (the API, OAuth, certificates…).
const RESERVED_PATHS = ['api', 'hosting', 'og', 'assets', 'oauth2', '.well-known', 'sitemap.xml', 'robots.txt', 'repos.json', 'catalog.json'];
// Ports that are Caddy itself on this machine: proxying to them loops back into Caddy.
const CADDY_PORTS = [80, 443, 2019];

export function checkDomain(v) {
    const d = String(v || '').trim().toLowerCase().replace(/\.$/, '');
    if (/^[a-z]+:\/\//.test(d)) die(`give the domain alone, without ${d.split('//')[0]}// (use --http for a plain-HTTP test site)`);
    if (!RE.domain.test(d)) die(`"${v}" is not a host name (letters, digits, hyphens and dots, e.g. shop.example.com)`);
    if (/^[0-9.]+$/.test(d)) die(`"${v}" is an IP address — Caddy needs a name to get a certificate`);
    return d;
}
export function checkName(v) {
    const n = String(v || '').trim().toLowerCase();
    if (!RE.name.test(n)) die(`"${v}" is not a usable name (lowercase letters, digits, hyphens; up to 63)`);
    return n;
}
export function checkPort(v) {
    const p = Number(v);
    if (!Number.isInteger(p) || p < 1 || p > 65535) die(`"${v}" is not a port (1-65535)`);
    if (CADDY_PORTS.includes(p)) die(`port ${p} is Caddy's own on this machine — the program cannot be listening there, and proxying to it would loop back into Caddy. Move the program to another port (e.g. 8081).`);
    return p;
}
export function checkUpstream(v) {
    const s = String(v || '').trim().toLowerCase();
    const m = RE.upstream.exec(s);
    if (!m) die(`"${v}" is not <name>:<port> (e.g. myapp:3000 — the container's name and the port it listens on INSIDE the container)`);
    checkPort(m[2]);
    return s;
}
export function checkPath(v) {
    let p = String(v || '').trim();
    // Git Bash on Windows rewrites an argument that starts with / into a Windows path before
    // node ever sees it (`/status` arrives as `C:/Program Files/Git/status`).
    if (/^[a-z]:[\\/]/i.test(p)) die(`"${v}" — your shell turned the path into a Windows path. Write it without the leading slash (--path status) or set MSYS_NO_PATHCONV=1.`);
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/+$/, '');
    if (!RE.path.test(p)) die(`"${v}" is not a usable path (e.g. /status — letters, digits, . _ ~ -, no trailing slash)`);
    const first = p.split('/')[1].toLowerCase();
    if (RESERVED_PATHS.includes(first)) die(`/${first} is already routed by the BetterCommunity block — pick another path or use a sub-domain`);
    return p;
}
export function checkTarget(v) {
    let u;
    try { u = new URL(String(v || '').trim()); } catch { die(`"${v}" is not a URL (e.g. https://example.com)`); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') die(`"${v}" must start with https:// (or http://)`);
    if (u.username || u.password) die('a redirect target cannot carry credentials');
    if ((u.pathname && u.pathname !== '/') || u.search || u.hash) die(`"${v}": give the origin only (https://example.com) — the visitor's own path and query are appended`);
    checkDomain(u.hostname);
    return u.origin;
}

// ── Templates → a drop-in file ───────────────────────────────────────────────────────────
const KINDS = {
    service:  { dir: 'site', help: 'a (sub-)domain → a container on the compose network (--domain, --to name:port)' },
    host:     { dir: 'site', help: 'a (sub-)domain → a program on THIS machine, on its own port (--domain, --port)' },
    path:     { dir: 'path', help: 'a path of the BetterCommunity domain → an app (--path, --to name:port | --port)' },
    static:   { dir: 'site', help: 'a (sub-)domain → a folder of files in infra/caddy/static/<dir> (--domain, --dir [--spa])' },
    redirect: { dir: 'site', help: 'a (sub-)domain that redirects, e.g. www → the bare domain (--domain, --to https://…)' },
};
const META = '# bcweb-site ';

/** Fill a template. `values` are already validated; nothing here trusts them further. */
export function render(t, kind, values, today = new Date().toISOString().slice(0, 10)) {
    const src = readFileSync(join(t.templates, `${kind}.caddy`), 'utf8').replace(/\r\n/g, '\n');
    const body = src.split('\n').filter((l) => !l.startsWith('#!')).join('\n');
    const filled = body.replace(/__([A-Z]+)__/g, (m, k) => {
        if (!(k in values)) throw new Error(`template ${kind}.caddy uses ${m} and nothing fills it`);
        return String(values[k]);
    });
    const meta = { kind, name: values.NAME, address: values.ADDRESS ?? values.PATH, upstream: values.UPSTREAM ?? values.TARGET ?? (values.PORT ? `host.docker.internal:${values.PORT}` : undefined) ?? (values.DIR ? `static/${values.DIR}` : undefined) };
    return `${META}${JSON.stringify(meta)}\n# Written by infra/caddy/site.mjs on ${today}. Edit it if you like, then: node infra/caddy/site.mjs apply\n#\n${filled}`;
}

function dropins(t, which, ext = '.caddy') {
    const d = t.dirs[which];
    if (!existsSync(d)) return [];
    // Byte order, which is what Caddy's own glob uses — the inlined order must be the order
    // Caddy would have imported them in, or `build` and the base would not be the same config.
    return readdirSync(d).filter((f) => f.endsWith(ext)).sort();
}
function metaOf(text) {
    const line = text.split('\n').find((l) => l.startsWith(META));
    if (!line) return null;
    try { return JSON.parse(line.slice(META.length)); } catch { return null; }
}

// ── Sources → the generated Caddyfile ────────────────────────────────────────────────────
const IMPORT_DROPIN = /^(\s*)import\s+(sites|paths)\.d\/\*\.caddy\s*$/;
// `import name` (a snippet) is fine anywhere; an import naming a FILE is not, because the
// generated file lives in live/ and a relative path would resolve somewhere else there.
const IMPORT_FILE = /^\s*import\s+\S*[/*]/;

function sourcesHash(t) {
    const h = createHash('sha256');
    h.update(readFileSync(t.base));
    for (const which of ['site', 'path']) for (const f of dropins(t, which)) { h.update(`\0${which}/${f}\0`); h.update(readFileSync(join(t.dirs[which], f))); }
    return h.digest('hex').slice(0, 16);
}

const HEADER_LINES = 7;   // the generated file's banner; origin() skips it

/** The base with both drop-in imports replaced by the files they import, in Caddy's order. */
export function build(t = T) {
    if (!existsSync(t.base)) die(`${t.base} is missing`);
    const base = readFileSync(t.base, 'utf8').replace(/\r\n/g, '\n');
    const found = { sites: false, paths: false };
    const out = [
        '# ════════════════════════════════════════════════════════════════════════════════════',
        '# GENERATED by infra/caddy/site.mjs — do not edit this file, it is rewritten on every apply.',
        '# Sources: infra/caddy/Caddyfile (BetterCommunity) + sites.d/*.caddy + paths.d/*.caddy.',
        '# Change a source, then `node infra/caddy/site.mjs apply` (or `build --out` to review first).',
        `# sources-sha256: ${sourcesHash(t)}`,
        '# ════════════════════════════════════════════════════════════════════════════════════',
        '',
    ];
    if (out.length !== HEADER_LINES) throw new Error('header length changed: update HEADER_LINES');
    for (const line of base.split('\n')) {
        const m = IMPORT_DROPIN.exec(line);
        if (!m) {
            if (IMPORT_FILE.test(line)) die(`the base imports a file (${line.trim()}) — only sites.d/ and paths.d/ can be inlined`);
            out.push(line);
            continue;
        }
        const [, indent, kind] = m;
        found[kind] = true;
        const which = kind === 'sites' ? 'site' : 'path';
        const files = dropins(t, which);
        out.push(`${indent}# ━━ ${kind}.d/ — ${files.length} file(s), inlined by site.mjs; edit infra/caddy/${kind}.d/, not this ━━`);
        for (const f of files) {
            const text = readFileSync(join(t.dirs[which], f), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
            const left = text.match(/__[A-Z]+__/);
            if (left) die(`${kind}.d/${f} still has the placeholder ${left[0]} — replace it (or write the file with \`site.mjs add\`)`);
            for (const l of text.split('\n')) if (IMPORT_FILE.test(l)) die(`${kind}.d/${f} imports a file (${l.trim()}) — put the content in the drop-in itself`);
            out.push(`${indent}# ── ${kind}.d/${f} ──`);
            for (const l of text.split('\n')) out.push(l ? indent + l : '');
        }
        out.push(`${indent}# ━━ end ${kind}.d/ ━━`);
    }
    for (const [k, ok] of Object.entries(found)) if (!ok) die(`the base Caddyfile no longer has \`import ${k}.d/*.caddy\` — the ${k}.d/ files would be silently left out`);
    return out.join('\n').replace(/\n*$/, '\n');
}

// ── Docker: validate, reload, look inside ────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
    return { ok: r.status === 0, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '', error: r.error };
}
// The project directory only, exactly like infra/zdd.sh: compose then finds docker-compose.yml
// itself AND honours COMPOSE_FILE / COMPOSE_PROJECT_NAME from .env, so a server that layers an
// override file gets the same caddy service here as everywhere else. `-f` would ignore them.
const compose = (...args) => run('docker', ['compose', '--project-directory', COMPOSE_DIR, ...args]);

function caddyImage() {
    const y = existsSync(COMPOSE_FILE) ? readFileSync(COMPOSE_FILE, 'utf8') : '';
    const m = /\n  caddy:\s*\n(?:\s{4}.*\n)*?\s{4}image:\s*(\S+)/.exec(y);
    return m ? m[1] : 'caddy:2-alpine';
}

/** The values compose would give the caddy service, read from infra/compose/.env — only for
 *  the fallback path, when `docker compose run` itself cannot start. */
function envFromDotenv(t) {
    const want = new Set([...readFileSync(t.base, 'utf8').matchAll(/\{\$([A-Z0-9_]+)/g)].map((m) => m[1]));
    const file = join(COMPOSE_DIR, '.env');
    const env = [];
    if (!existsSync(file)) return env;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m && want.has(m[1])) env.push('-e', `${m[1]}=${m[2].replace(/^(['"])(.*)\1$/, '$2')}`);
    }
    return env;
}

// Caddy's info logs and compose's container chatter, dropped: what is left is the error.
const caddyOutput = (s) => s.split('\n').filter((l) => !/^\{"level":"(info|debug)"/.test(l) && !/^\s*Container \S+ (Creating|Created|Starting|Started|Stopping|Stopped|Removing|Removed)\s*$/.test(l)).join('\n').trim();

/** Caddy reports an error as `<generated file>:519`, a line nobody wrote. Say which source
 *  line that is — a drop-in and its own line number, or the base Caddyfile — using the
 *  markers build() leaves in the generated text. */
function origin(text, n) {
    const lines = text.split('\n');
    let baseLine = 0, cur = null, curStart = 0, inSection = false;
    for (let i = 0; i < Math.min(n, lines.length); i++) {
        const l = lines[i], ln = i + 1;
        if (ln <= HEADER_LINES) continue;
        if (/# ━━ (sites|paths)\.d\/ — /.test(l)) { inSection = true; cur = null; baseLine++; continue; }
        if (/# ━━ end (sites|paths)\.d\/ ━━/.test(l)) { inSection = false; cur = null; continue; }
        if (inSection) { const m = /# ── ((?:sites|paths)\.d\/\S+) ──$/.exec(l); if (m) { cur = m[1]; curStart = ln; } continue; }
        baseLine++;
    }
    return inSection && cur ? `${cur} line ${n - curStart}` : `Caddyfile line ${baseLine}`;
}
const explain = (out, text) => out.replace(/(?:Caddyfile\.next|\.check\.caddy|live\/Caddyfile):(\d+)/g, (m, n) => `${m} ${bold(`(= infra/caddy/${origin(text, Number(n))})`)}`);

/** `caddy validate` on a file under `t.root`, with the environment the stack really runs with.
 *
 *  First choice is `docker compose run` of the caddy service itself: same image, same
 *  environment (so SITE_DOMAIN is the real one and a clash with it is caught), same
 *  extra_hosts. It works whether caddy is running or not. The folder is mounted at a path of
 *  its own so it never collides with the service's own mount of /etc/caddy. */
export function validate(t, file, { composeFirst = true } = {}) {
    const rel = relative(t.root, file).replace(/\\/g, '/');
    const target = `/bcw-caddy/${rel}`;
    const mount = `${t.root}:/bcw-caddy:ro`;
    if (composeFirst && existsSync(COMPOSE_FILE)) {
        const r = compose('run', '--rm', '--no-deps', '-T', '-v', mount, 'caddy', 'caddy', 'validate', '--config', target, '--adapter', 'caddyfile');
        // Did CADDY answer, or did compose fail before Caddy ran (no .env, docker down)?
        if (r.ok || /"level":|adapting config|Error: /.test(r.out) && !/no such service|variable is not set|required variable/i.test(r.out)) {
            return { ok: r.ok, how: 'docker compose run caddy (your real .env)', out: caddyOutput(r.out) };
        }
    }
    const r = run('docker', ['run', '--rm', ...envFromDotenv(t), '-v', mount, caddyImage(), 'caddy', 'validate', '--config', target, '--adapter', 'caddyfile']);
    if (r.error || /Cannot connect to the Docker daemon|error during connect/i.test(r.out)) die(`docker is not reachable — cannot validate, so nothing will be installed.\n${r.out || r.error}`);
    return { ok: r.ok, how: `docker run ${caddyImage()} (env from infra/compose/.env)`, out: caddyOutput(r.out) };
}

function caddyRunning() {
    const r = compose('ps', '--status', 'running', '-q', 'caddy');
    return r.ok && r.stdout.trim() !== '';
}
/** Does the RUNNING container see this exact file? False when compose still mounts only the
 *  base Caddyfile — the folder mount from the guide is not in place yet. */
function containerSees(t, file) {
    const rel = relative(t.root, file).replace(/\\/g, '/');
    const r = compose('exec', '-T', 'caddy', 'sha256sum', `${IN_CONTAINER}/${rel}`);
    const mine = createHash('sha256').update(readFileSync(file)).digest('hex');
    return r.ok && r.stdout.startsWith(mine);
}
function reload(configInContainer) {
    return compose('exec', '-T', 'caddy', 'caddy', 'reload', '--config', configInContainer, '--adapter', 'caddyfile');
}

const MOUNT_HELP = `The caddy container does not see infra/caddy/ as a folder yet, so a generated file cannot reach it.
Add these two lines to the caddy service in infra/compose/docker-compose.yml (once):

    command: ["sh", "/etc/caddy/entrypoint.sh"]
    volumes:
      - ../caddy:/etc/caddy:ro          # replaces ../caddy/Caddyfile:/etc/caddy/Caddyfile:ro

then: docker compose up -d caddy   (a few seconds of downtime, once) — guides/run/CADDY_SITES_EN.md`;

// ── Diff ─────────────────────────────────────────────────────────────────────────────────
function showDiff(oldText, newText, labels) {
    if (oldText === newText) { say(dim('(no difference)')); return false; }
    const dir = join(T.root, 'live');
    mkdirSync(dir, { recursive: true });
    const a = join(dir, '.diff-a'), b = join(dir, '.diff-b');
    try {
        writeFileSync(a, oldText); writeFileSync(b, newText);
        const r = run('git', ['diff', '--no-index', tty ? '--color' : '--no-color', '-U3', a, b]);
        if (r.error) { say(`(git not found: ${oldText.split('\n').length} → ${newText.split('\n').length} lines; use \`build --out\` and your own diff tool)`); return true; }
        // git names the two temp files; name them after what they are instead.
        const plain = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
        say(`--- ${labels[0]}\n+++ ${labels[1]}`);
        say(r.stdout.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(plain(l))).join('\n'));
    } finally { rmSync(a, { force: true }); rmSync(b, { force: true }); }
    return true;
}

// ── Confirm ──────────────────────────────────────────────────────────────────────────────
async function ask(question, def = '') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { const a = (await rl.question(`${question}${def ? dim(` [${def}]`) : ''} `)).trim(); return a || def; }
    finally { rl.close(); }
}
async function confirm(question, yes) {
    if (yes) return true;
    if (!process.stdin.isTTY) die('not a terminal and --yes not given: nothing was changed');
    return /^(y|yes|o|oui)$/i.test(await ask(`${question} (y/N)`));
}

// ── apply: the only way a config reaches Caddy ───────────────────────────────────────────
// Milliseconds kept: two applies in the same second must not share (and overwrite) a backup.
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function backups(t = T) {
    return existsSync(t.backups) ? readdirSync(t.backups).filter((f) => f.startsWith('Caddyfile.')).sort() : [];
}

/** Validate → diff → confirm → back up → swap → reload; restore the backup if the reload
 *  fails. `text` defaults to a fresh build; `rollback` and `apply --from` pass a file. */
async function apply({ text, yes = false, label = 'generated' } = {}) {
    text ??= build();
    mkdirSync(T.liveDir, { recursive: true });
    const current = existsSync(T.live) ? readFileSync(T.live, 'utf8') : null;
    if (current === text) { say(green('✓ ') + 'live/Caddyfile is already exactly this — nothing to do.'); return true; }

    writeFileSync(T.next, text);
    try {
        say(dim('validating the whole config…'));
        const v = validate(T, T.next);
        if (!v.ok) {
            say(red('✗ Caddy refuses this config') + dim(` (${v.how})`));
            say(explain(v.out, text));
            say(red('Nothing was installed or reloaded; Caddy keeps serving what it serves now.'));
            return false;
        }
        say(green('✓ ') + `valid ${dim(`(${v.how})`)}`);

        say(bold(`\nChanges to live/Caddyfile${current ? '' : ' (first apply — compared with the base Caddyfile it replaces)'}:`));
        showDiff(current ?? readFileSync(T.base, 'utf8'), text, [current ? 'live' : 'base', label]);
        if (!(await confirm('\nInstall this and reload Caddy?', yes))) { say('Not applied. Nothing changed.'); return false; }

        const running = caddyRunning();
        if (running && !containerSees(T, T.next)) { say(red('✗ ') + MOUNT_HELP); return false; }

        let backup = null;
        if (current !== null) {
            mkdirSync(T.backups, { recursive: true });
            backup = join(T.backups, `Caddyfile.${stamp()}`);
            copyFileSync(T.live, backup);
        }
        renameSync(T.next, T.live);                      // atomic: never a half-written live file
        say(green('✓ ') + `installed live/Caddyfile${backup ? dim(` (previous → backups/${basename(backup)})`) : ''}`);

        if (!running) {
            say(yellow('caddy is not running') + ' — it will load this file at its next start (entrypoint.sh validates it again then).');
        } else {
            const r = reload(`${IN_CONTAINER}/live/Caddyfile`);
            if (!r.ok) {
                say(red('✗ caddy reload failed:') + '\n' + caddyOutput(r.out));
                if (backup) copyFileSync(backup, T.live); else rmSync(T.live, { force: true });
                const back = reload(`${IN_CONTAINER}/${backup ? 'live/Caddyfile' : 'Caddyfile'}`);
                say(back.ok ? yellow('Previous config restored and reloaded.') : red('Restoring ALSO failed to reload — Caddy keeps its last good config in memory; run `site.mjs status`.'));
                return false;
            }
            say(green('✓ ') + 'Caddy reloaded (graceful — no connection dropped).');
        }
        for (const old of backups().slice(0, -KEEP_BACKUPS)) rmSync(join(T.backups, old), { force: true });
        return true;
    } finally {
        rmSync(T.next, { force: true });
    }
}

// ── After an add: the two things that go wrong next (DNS, the upstream) ──────────────────
async function checkDns(domain) {
    if (domain.endsWith('.localhost')) return;
    const addrs = [];
    for (const f of ['resolve4', 'resolve6']) { try { addrs.push(...(await dns[f](domain))); } catch { /* none of that family */ } }
    if (!addrs.length) warn(`${domain} does not resolve yet. Create an A record → this server's IPv4 (AAAA for IPv6); Caddy gets the certificate once it resolves, by itself.`);
    else say(dim(`DNS: ${domain} → ${addrs.join(', ')} — this must be THIS server's public address, or the certificate cannot be issued.`));
}
function probe(upstream) {
    if (!caddyRunning()) return;
    const r = compose('exec', '-T', 'caddy', 'wget', '-T', '5', '-O', '/dev/null', `http://${upstream}/`);
    if (r.ok || /server returned error/i.test(r.out)) { say(green('✓ ') + `Caddy reaches ${upstream}.`); return; }
    warn(`Caddy cannot reach ${upstream} yet — the site will answer 502 until it can:\n  ${r.out.trim().split('\n').pop()}`);
    if (upstream.startsWith('host.docker.internal')) say(dim('  A program on the host must listen on 0.0.0.0 (or the Docker bridge address), not only 127.0.0.1 — and a firewall must let the Docker network in. See the guide, "502".'));
    else if (/bad address/i.test(r.out)) say(dim('  No container by that name on the caddy network. Is it running, and attached to bcweb_default? See the guide.'));
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────
async function cmdAdd(kind, o) {
    if (!KINDS[kind]) die(`add what? ${Object.keys(KINDS).join(' | ')}\n${Object.entries(KINDS).map(([k, v]) => `  ${k.padEnd(9)} ${v.help}`).join('\n')}`);
    const interactive = process.stdin.isTTY && !o.yes;
    const need = async (key, question, check, def) => {
        if (o[key] !== undefined) return check(o[key]);
        if (!interactive) die(`missing --${key}`);
        for (;;) { try { return check(await ask(question, def)); } catch (e) { if (!(e instanceof Refusal)) throw e; say(red(e.message)); } }
    };

    const v = {};
    let domain = null, upstream = null;
    if (kind !== 'path') {
        domain = await need('domain', 'Domain or sub-domain (e.g. shop.example.com):', checkDomain);
        v.DOMAIN = domain;
        v.ADDRESS = o.http ? `http://${domain}` : domain;
    }
    if (kind === 'service') upstream = v.UPSTREAM = await need('to', 'Container and port inside it (e.g. myapp:3000):', checkUpstream);
    if (kind === 'host') { v.PORT = await need('port', 'Port the program listens on, on this machine (e.g. 8081):', checkPort); upstream = `host.docker.internal:${v.PORT}`; }
    if (kind === 'path') {
        v.PATH = await need('path', 'Path on the main domain (e.g. /status):', checkPath);
        if (o.port !== undefined) upstream = `host.docker.internal:${checkPort(o.port)}`;
        else upstream = await need('to', 'Container:port, or host.docker.internal:<port> for a program on this machine:', checkUpstream);
        v.UPSTREAM = upstream;
        warn(`${v.PATH} shares BetterCommunity's origin: the app can act with a visitor's session, and gets the site's CSP. A sub-domain avoids both.`);
    }
    if (kind === 'static') {
        v.DIR = await need('dir', 'Folder name under infra/caddy/static/ :', checkName, domain.split('.')[0]);
        v.SPA = o.spa ? 'try_files {path} /index.html' : '';
    }
    if (kind === 'redirect') v.TARGET = await need('to', 'Redirect to (origin only, e.g. https://example.com):', checkTarget);

    const defName = kind === 'path' ? `path-${v.PATH.slice(1).replace(/[/._~]+/g, '-')}` : domain.replace(/\./g, '-');
    v.NAME = o.name !== undefined ? checkName(o.name) : checkName(defName.slice(0, 63).replace(/-+$/, ''));

    const which = KINDS[kind].dir;
    const file = join(T.dirs[which], `${v.NAME}.caddy`);
    const previous = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (previous !== null && !o.force) die(`${relative(HERE, file).replaceAll(sep, "/")} already exists — pass --force to replace it, or --name to pick another`);

    const text = render(T, kind, v);
    if (o['dry-run']) { say(text); return true; }
    mkdirSync(T.dirs[which], { recursive: true });
    writeFileSync(file, text);
    say(green('✓ ') + `wrote ${relative(resolve(HERE, '..', '..'), file).replace(/\\/g, '/')}`);
    if (kind === 'static') {
        const d = join(T.static, v.DIR);
        if (!existsSync(d)) { mkdirSync(d, { recursive: true }); say(dim(`created infra/caddy/static/${v.DIR}/ — put index.html and the rest there`)); }
    }

    // Sources are never left holding a file that breaks the build: validate now even with
    // --no-apply, and put things back if Caddy refuses.
    const undo = () => { if (previous !== null) writeFileSync(file, previous); else rmSync(file, { force: true }); say(yellow(`${basename(file)} ${previous !== null ? 'restored' : 'removed'} — the sources are as they were.`)); };
    let ok;
    try {
        if (o['no-apply']) {
            const tmp = join(T.liveDir, '.check.caddy');
            mkdirSync(T.liveDir, { recursive: true });
            const built = build();
            writeFileSync(tmp, built);
            try { const r = validate(T, tmp); ok = r.ok; if (!ok) say(red('✗ Caddy refuses the result:\n') + explain(r.out, built)); else say(green('✓ ') + `the whole config validates ${dim(`(${r.how})`)} — not applied (--no-apply). Next: site.mjs diff, then apply.`); }
            finally { rmSync(tmp, { force: true }); }
        } else {
            ok = await apply({ yes: o.yes, label: `with ${v.NAME}` });
        }
    } catch (e) { undo(); throw e; }
    if (!ok && !existsSync(file)) return false;
    if (!ok) {
        // apply() returns false both for "Caddy refused" and for "you said no"; only the first
        // is a reason to take the file back out.
        const tmp = join(T.liveDir, '.check.caddy');
        writeFileSync(tmp, build());
        let refused;
        try { refused = !validate(T, tmp).ok; } finally { rmSync(tmp, { force: true }); }
        if (refused) undo(); else say(dim(`${basename(file)} kept in the sources; apply it later with: node infra/caddy/site.mjs apply`));
        return false;
    }
    if (domain) await checkDns(domain);
    if (upstream && !o['no-apply']) probe(upstream);
    return true;
}

function cmdList() {
    const live = existsSync(T.live) ? readFileSync(T.live, 'utf8') : '';
    let n = 0;
    for (const [which, label] of [['site', 'sites.d'], ['path', 'paths.d']]) {
        for (const f of [...dropins(T, which), ...dropins(T, which, '.caddy.off')]) {
            const text = readFileSync(join(T.dirs[which], f), 'utf8').replace(/\r\n/g, '\n');
            const m = metaOf(text) || {};
            const off = f.endsWith('.off');
            const inLive = live.includes(`# ── ${label}/${f} ──\n`);
            const state = off ? dim('removed (.off)') : !live ? yellow('not generated yet') : inLive ? green('live') : yellow('pending apply');
            say(`${bold(f.replace(/\.caddy(\.off)?$/, '').padEnd(28))} ${(m.kind || 'hand-written').padEnd(12)} ${String(m.address || '').padEnd(32)} → ${String(m.upstream || '').padEnd(34)} ${state}`);
            n++;
        }
    }
    if (!n) say(dim('No extra sites yet. Add one: node infra/caddy/site.mjs add host --domain shop.example.com --port 8081'));
    return true;
}

async function cmdRemove(name, o) {
    const n = checkName(name);
    const hit = ['site', 'path'].map((w) => join(T.dirs[w], `${n}.caddy`)).find(existsSync);
    if (!hit) die(`no sites.d/${n}.caddy or paths.d/${n}.caddy (see: site.mjs list)`);
    const off = `${hit}.off`;
    renameSync(hit, off);
    say(green('✓ ') + `${basename(hit)} → ${basename(off)} (kept; rename it back to restore)`);
    if (o['no-apply']) { say(dim('Not applied (--no-apply). Next: site.mjs apply')); return true; }
    const ok = await apply({ yes: o.yes, label: `without ${n}` });
    if (!ok && existsSync(off) && !existsSync(hit)) { renameSync(off, hit); say(yellow(`${basename(hit)} put back — nothing changed.`)); }
    return ok;
}

function cmdBuild(o) {
    const text = build();
    const out = resolve(o.out || T.generated);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    say(green('✓ ') + `generated → ${out}`);
    // Validate a copy INSIDE infra/caddy, which is what gets mounted; the generated file has
    // no relative imports, so where the copy sits changes nothing.
    const tmp = join(T.liveDir, '.check.caddy');
    mkdirSync(T.liveDir, { recursive: true });
    writeFileSync(tmp, text);
    try {
        const v = validate(T, tmp);
        if (!v.ok) { say(red('✗ INVALID — do not install it:\n') + explain(v.out, text)); return false; }
        say(green('✓ ') + `valid ${dim(`(${v.how})`)}`);
    } finally { rmSync(tmp, { force: true }); }
    say(`To install it by hand: review it, copy it over infra/caddy/live/Caddyfile, then\n  node infra/caddy/site.mjs reload\nOr let the tool do the same with a backup:  node infra/caddy/site.mjs apply --from ${(relative(process.cwd(), out) || out).replaceAll(sep, "/")}`);
    return true;
}

function cmdDiff(o) {
    const text = build();
    const againstPath = o.against ? resolve(o.against) : existsSync(T.live) ? T.live : T.base;
    if (!o.against && againstPath === T.base) say(dim('No live/Caddyfile yet: comparing with the base Caddyfile Caddy runs today.'));
    const changed = showDiff(readFileSync(againstPath, 'utf8'), text, [relative(HERE, againstPath).replace(/\\/g, '/'), 'generated']);
    return !changed;   // exit 1 when they differ, like diff(1)
}

/** Validate what is installed, then reload it — for a live file swapped in by hand. */
function cmdReload() {
    const file = existsSync(T.live) ? T.live : T.base;
    const v = validate(T, file);
    if (!v.ok) { say(red(`✗ ${relative(HERE, file)} does not validate — NOT reloading (Caddy keeps its current config):\n`) + explain(v.out, readFileSync(file, 'utf8'))); return false; }
    if (!caddyRunning()) { say(yellow('caddy is not running; nothing to reload.')); return true; }
    if (file === T.live && !containerSees(T, T.live)) { say(red('✗ ') + MOUNT_HELP); return false; }
    const r = reload(`${IN_CONTAINER}/${relative(HERE, file).replace(/\\/g, '/')}`);
    say(r.ok ? green('✓ ') + `reloaded ${relative(HERE, file).replace(/\\/g, '/')}` : red('✗ reload failed:\n') + caddyOutput(r.out));
    return r.ok;
}

async function cmdRollback(which, o) {
    const all = backups();
    if (!all.length) die('no backups yet (one is made before every apply)');
    if (o.list || which === 'list') { for (const b of all) say(b); return true; }
    const pick = which ? all.find((b) => b === which || b === `Caddyfile.${which}`) : all[all.length - 1];
    if (!pick) die(`no backup named ${which} (site.mjs rollback list)`);
    say(`Rolling back to backups/${pick} — the current live file is itself backed up first, so this can be undone the same way.`);
    return apply({ text: readFileSync(join(T.backups, pick), 'utf8'), yes: o.yes, label: pick });
}

function cmdStatus() {
    const hash = sourcesHash(T);
    if (!existsSync(T.live)) say(`${yellow('●')} no live/Caddyfile — Caddy runs the base Caddyfile (+ drop-ins through its imports). First apply: site.mjs apply`);
    else {
        const m = /sources-sha256: (\w+)/.exec(readFileSync(T.live, 'utf8'));
        say(m && m[1] === hash ? `${green('●')} live/Caddyfile matches the sources` : `${yellow('●')} the sources changed since the last apply — see: site.mjs diff, then apply`);
    }
    const running = caddyRunning();
    say(`${running ? green('●') : yellow('●')} caddy container ${running ? 'running' : 'NOT running'}`);
    if (running) {
        const folder = compose('exec', '-T', 'caddy', 'test', '-f', `${IN_CONTAINER}/entrypoint.sh`).ok;
        say(folder ? `${green('●')} infra/caddy/ is mounted as a folder` : `${yellow('●')} only the base Caddyfile is mounted — apply cannot reach Caddy yet:\n${MOUNT_HELP}`);
        const logs = compose('logs', '--no-log-prefix', '--tail', '2000', 'caddy');
        const last = logs.out.split('\n').filter((l) => l.includes('[bcweb-caddy]')).pop();
        if (last) say(dim(`last start: ${last.trim()}`));
    }
    say(dim(`backups: ${backups().length} (latest ${backups().pop() || '—'})`));
    return true;
}

// ── selftest: what CI runs (no .env, no running stack) ───────────────────────────────────
function cmdSelftest() {
    let failed = 0;
    const check = (name, cond, extra = '') => { say(`${cond ? green('ok  ') : red('FAIL')} ${name}${!cond && extra ? `\n${extra}` : ''}`); if (!cond) failed++; };
    const refuses = (fn, v) => { try { fn(v); return false; } catch (e) { return e instanceof Refusal; } };

    // 1. The input checks are the only thing between a typed value and a Caddyfile directive.
    for (const bad of ['a.com {', 'a.com\nb', 'a.com b.com', 'http://a.com', '*.a.com', 'a', '1.2.3.4', 'a..com', '-a.com', 'a.com"', 'a.com}']) check(`domain refuses ${JSON.stringify(bad)}`, refuses(checkDomain, bad));
    for (const bad of ['app:3000 {', 'app', 'app:0', 'app:70000', 'app:443', 'app:80', 'a b:1', 'app:3000\nx']) check(`upstream refuses ${JSON.stringify(bad)}`, refuses(checkUpstream, bad));
    for (const bad of ['/api', '/api/x', '/hosting', '/a b', '/a{', '/.well-known', '/', '/a\nb']) check(`path refuses ${JSON.stringify(bad)}`, refuses(checkPath, bad));
    for (const bad of ['javascript:alert(1)', 'https://a.com/x', 'https://a.com?q', 'https://u:p@a.com', 'ftp://a.com']) check(`redirect target refuses ${JSON.stringify(bad)}`, refuses(checkTarget, bad));
    check('domain accepts shop.example.com', checkDomain('Shop.Example.com.') === 'shop.example.com');
    check('path normalises /status/', checkPath('status/') === '/status');

    // 2. Throw-away copies of this folder — one per scenario — then ONE caddy container that
    //    validates and adapts all of them (a container start is the slow part, not Caddy).
    const root = join(HERE, `.selftest-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    try {
        const mk = (name) => {
            const t = tree(join(root, name));
            for (const d of [t.templates, t.dirs.site, t.dirs.path, t.liveDir]) mkdirSync(d, { recursive: true });
            copyFileSync(T.base, t.base);
            for (const f of readdirSync(T.templates)) copyFileSync(join(T.templates, f), join(t.templates, f));
            return t;
        };
        const put = (t, which, name, text) => writeFileSync(join(t.dirs[which], `${name}.caddy`), text);
        const empty = mk('empty');
        writeFileSync(empty.live, build(empty));

        const t = mk('full');
        const samples = {
            service:  { NAME: 'app-example-com', DOMAIN: 'app.example.com', ADDRESS: 'app.example.com', UPSTREAM: 'myapp:3000' },
            host:     { NAME: 'shop-example-com', DOMAIN: 'shop.example.com', ADDRESS: 'shop.example.com', PORT: 8081 },
            static:   { NAME: 'docs-example-com', DOMAIN: 'docs.example.com', ADDRESS: 'docs.example.com', DIR: 'docs', SPA: 'try_files {path} /index.html' },
            redirect: { NAME: 'www-example-com', DOMAIN: 'www.example.com', ADDRESS: 'www.example.com', TARGET: 'https://example.com' },
            path:     { NAME: 'path-status', PATH: '/status', UPSTREAM: 'host.docker.internal:3001' },
        };
        for (const [kind, v] of Object.entries(samples)) {
            const text = render(t, kind, v, '2000-01-01');
            check(`template ${kind}: every placeholder filled`, !/__[A-Z]+__/.test(text));
            if (kind !== 'static' && kind !== 'redirect') check(`template ${kind}: strips all ${SESSION_COOKIES.length} session cookies`, SESSION_COOKIES.every((k) => text.includes(k)));
            put(t, KINDS[kind].dir, v.NAME, text);
        }
        put(t, 'path', 'path-two', render(t, 'path', { NAME: 'path-two', PATH: '/two/deep', UPSTREAM: 'other:8080' }, '2000-01-01'));
        writeFileSync(t.live, build(t));
        // entrypoint.sh's last resort: the base with the two imports removed (same filter).
        writeFileSync(join(t.root, 'core.caddy'), readFileSync(t.base, 'utf8').split('\n').filter((l) => !/^[ \t]*import[ \t]+(sites|paths)\.d\//.test(l)).join('\n'));

        // The failures the whole tool exists for: each must be REFUSED.
        const broken = mk('broken');
        put(broken, 'site', 'typo', 'typo.example.com {\n\treverse_proxy myapp:3000 {\n\t\tnot_a_directive yes\n\t}\n}\n');
        writeFileSync(broken.live, build(broken));
        const dupe = mk('dupe');
        put(dupe, 'site', 'a', 'app.example.com {\n\trespond one\n}\n');
        put(dupe, 'site', 'b', 'app.example.com {\n\trespond two\n}\n');
        writeFileSync(dupe.live, build(dupe));
        const leftover = mk('leftover');
        put(leftover, 'site', 'x', 'x.example.com {\n\treverse_proxy __UPSTREAM__\n}\n');
        check('a hand-copied template with a placeholder left is refused before Caddy', refuses(build, leftover));

        const expect = {
            'empty/Caddyfile': [true, 'the base with NO drop-ins validates (a fresh checkout)'],
            'empty/live/Caddyfile': [true, 'the generated file with no drop-ins validates'],
            'full/Caddyfile': [true, 'base + one drop-in of every kind validates'],
            'full/live/Caddyfile': [true, 'the generated flat file validates'],
            'full/core.caddy': [true, 'entrypoint fallback (BetterCommunity alone) validates'],
            'broken/live/Caddyfile': [false, 'a drop-in with a bad directive is refused'],
            'dupe/live/Caddyfile': [false, 'two blocks for the same name are refused'],
        };
        const script = [
            'for f in "$@"; do',
            '  if caddy validate --config "/w/$f" --adapter caddyfile >/tmp/o 2>&1; then echo "@@V $f 0"; else echo "@@V $f 1"; grep -v \'"level":"info"\' /tmp/o | tail -n 3 | sed "s|^|@@E $f |"; fi',
            'done',
            'echo "@@A base $(caddy adapt --config /w/full/Caddyfile --adapter caddyfile 2>/dev/null)"',
            'echo "@@A live $(caddy adapt --config /w/full/live/Caddyfile --adapter caddyfile 2>/dev/null)"',
        ].join('\n');
        const r = run('docker', ['run', '--rm', '-v', `${root}:/w:ro`, caddyImage(), 'sh', '-c', script, 'sh', ...Object.keys(expect)]);
        if (r.error || !r.out.includes('@@V')) die(`could not run ${caddyImage()} in docker:\n${r.out || r.error}`);
        for (const [f, [want, name]] of Object.entries(expect)) {
            const m = new RegExp(`^@@V ${f.replace(/[./]/g, '\\$&')} (\\d)`, 'm').exec(r.out);
            const errs = r.out.split('\n').filter((l) => l.startsWith(`@@E ${f} `)).map((l) => '     ' + l.slice(5 + f.length)).join('\n');
            check(name, m && (m[1] === '0') === want, errs);
        }
        // The generated file must be the SAME config as the base-with-imports, not merely a
        // valid one. The only legitimate difference: file_server hides the file its block was
        // loaded from, which is sites.d/x.caddy in one and live/Caddyfile in the other.
        const json = (k) => (new RegExp(`^@@A ${k} (.*)$`, 'm').exec(r.out)?.[1] || '').replace(/"\/w\/[^"]*"/g, '"<config file>"');
        check('the generated file adapts to the identical JSON config as base + imports', json('base').length > 100 && json('base') === json('live'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
    say(failed ? red(`\n${failed} check(s) failed`) : green('\nall checks passed'));
    return failed === 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────────────────
const HELP = `${bold('node infra/caddy/site.mjs')} — other sites and apps behind BetterCommunity's Caddy

  ${bold('add')} <kind> [flags]   write a drop-in from a template, validate everything, apply
${Object.entries(KINDS).map(([k, v]) => `      ${k.padEnd(9)} ${v.help}`).join('\n')}
      --name N     file name (default from the domain)   --http   plain HTTP (local tests)
      --force      replace an existing file              --no-apply  write + validate only
      --dry-run    print the file, write nothing
  ${bold('list')}                  every drop-in, and whether it is live
  ${bold('remove')} <name>          disable one (renamed to .caddy.off), then apply

  ${bold('build')} [--out FILE]     regenerate the full Caddyfile and validate it (manual install)
  ${bold('diff')} [--against FILE]  what would change against live/Caddyfile
  ${bold('apply')} [--from FILE]    regenerate (or take FILE) → validate → diff → backup → swap → reload
  ${bold('reload')}                validate the installed file, then reload (after a hand swap)
  ${bold('rollback')} [NAME|list]   reinstall the latest (or a named) backup, same gate
  ${bold('status')}                sources vs live, container, mount, last start
  ${bold('selftest')}              every template through Caddy (what CI runs)

  --yes   answer yes to the confirmation (needed when not in a terminal)
Guide: guides/run/CADDY_SITES_EN.md (FR: CADDY_SITES_FR.md)`;

async function main() {
    const { values: o, positionals: p } = parseArgs({
        allowPositionals: true,
        options: {
            domain: { type: 'string' }, to: { type: 'string' }, port: { type: 'string' }, path: { type: 'string' },
            dir: { type: 'string' }, name: { type: 'string' }, out: { type: 'string' }, against: { type: 'string' },
            from: { type: 'string' }, spa: { type: 'boolean' }, http: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
            force: { type: 'boolean' }, 'no-apply': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, list: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
    });
    const [cmd, arg] = p;
    if (!cmd || o.help || cmd === 'help') { say(HELP); return true; }
    switch (cmd) {
        case 'add': return cmdAdd(arg, o);
        case 'list': case 'ls': return cmdList();
        case 'remove': case 'rm': if (!arg) die('remove which? (site.mjs list)'); return cmdRemove(arg, o);
        case 'build': return cmdBuild(o);
        case 'diff': return cmdDiff(o);
        case 'apply': {
            if (!o.from) return apply({ yes: o.yes });
            const text = readFileSync(resolve(o.from), 'utf8');
            if (!text.includes('GENERATED by infra/caddy/site.mjs')) warn(`${o.from} was not generated by site.mjs — installing it anyway, after validation.`);
            return apply({ text, yes: o.yes, label: basename(o.from) });
        }
        case 'reload': return cmdReload();
        case 'rollback': return cmdRollback(arg, o);
        case 'status': return cmdStatus();
        case 'selftest': return cmdSelftest();
        default: die(`unknown command "${cmd}" — node infra/caddy/site.mjs help`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
        if (e instanceof Refusal) { console.error(red('✗ ') + e.message); process.exit(1); }
        console.error(e); process.exit(2);
    });
}
