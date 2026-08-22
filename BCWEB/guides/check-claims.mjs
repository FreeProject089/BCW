#!/usr/bin/env node
// Do the guides describe THIS stack, or the one it used to be?
//
// check-links.mjs already proves every relative link resolves. That catches a moved file and
// nothing else — a guide can point at a service that no longer exists, an env var nobody
// reads, a script that was renamed, or a file that was deleted, and every link in it still
// resolves perfectly.
//
// So this checks the claims a reader will ACT on, against the thing itself:
//
//   docker compose <service>   must be a service in docker-compose.yml
//   npm run <script>           must exist in the workspace that owns it
//   VAR=  / ${VAR} / `VAR`     must be read by compose or by the API source
//   infra/… paths in backticks must exist on disk
//
// Deliberately NOT a spellchecker for prose. Everything here is a fact somebody can follow
// and be wrong about, which is the only kind of staleness worth failing a build over.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── What is actually true ───────────────────────────────────────────────────
// Paths accepted because git is told to ignore them. Reported at the end rather than
// skipped in silence: "the check found nothing" and "the check waved two things through"
// should not look the same.
const untracked = [];

/** Does git deliberately not track this path?
 *
 *  git's own matcher, via check-ignore — re-implementing .gitignore semantics here would
 *  be a second, wrong answer to a question git already answers exactly. Anything that is
 *  not a clean "yes" (no git, not a repository, an error) counts as NO, so a real broken
 *  path is never waved through by a missing tool.
 */
function gitIgnores(p) {
    try {
        execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: ROOT, stdio: 'ignore' });
        return true;   // exit 0 = ignored
    } catch { return false; }
}

const compose = read(join(ROOT, 'infra/compose/docker-compose.yml'));
const services = new Set(
    compose.split('\n')
        .filter((l) => /^ {2}[a-z0-9_-]+:\s*$/.test(l))
        .map((l) => l.trim().replace(':', '')),
);
// `volumes:` and friends sit at the same indent as a service name.
for (const k of ['volumes', 'networks', 'services', 'secrets', 'configs']) services.delete(k);

const composeVars = new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]));

// Variables the Docker Compose CLI reads out of .env for ITSELF. They never appear as
// `${VAR}` inside docker-compose.yml, because nothing in the file substitutes them — the CLI
// consumes them before parsing. Without this list the checker calls COMPOSE_PROFILES
// undocumented, which is the one failure mode this file's other comments already warn about:
// a check that is wrong once teaches the reader to skim past it when it is right.
//
// COMPOSE_PROFILES is verified, not assumed: with it set in .env, `docker compose config
// --services` lists pgbouncer; without it, it does not.
for (const v of ['COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'COMPOSE_ENV_FILES']) composeVars.add(v);

// Everything that can legitimately READ a variable — not just the API.
//
// A first version scanned compose and apps/api/src only, and reported six of its seven
// findings against variables that were perfectly real: BACKUP_DIR and BACKUP_REMOTE live in
// infra/backup/backup.sh, READY_TIMEOUT in infra/deploy.sh, E2E_BASE_URL in the e2e test. A
// check that cries wolf six times out of seven gets ignored on the seventh, which was the
// only true one.
const consumers = (() => {
    let out = '';
    const walk = (d) => {
        let entries;
        try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(mjs|js|jsx|sh|yml|yaml)$/.test(e.name)) out += read(p);
        }
    };
    walk(join(ROOT, 'apps'));
    walk(join(ROOT, 'infra'));
    walk(join(ROOT, 'loadtest'));
    return out;
})();
// Every way a consumer can name a variable: `process.env.X` in JS, `$X` or `${X}` in shell,
// and a bare mention in a usage comment — `BACKUP_DIR=/mnt ./backup.sh` at the top of a
// script documents a variable it reads, even though that line is a comment.
//
// These three patterns have now been written wrong twice by generating this file through a
// shell heredoc: once turning `\b` into a literal 0x08 (a valid regex that matches nothing,
// so the check passed while seeing no variables at all), and once stripping the backslashes
// out of `\.` and `\s`. Edit them in place; do not regenerate this file from a shell.
const apiVars = new Set([
    ...[...consumers.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    ...[...consumers.matchAll(/\$\{?([A-Z][A-Z0-9_]{3,})/g)].map((m) => m[1]),
    ...[...consumers.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]{3,})=/gm)].map((m) => m[1]),
]);

const scripts = {};
for (const ws of ['apps/api', 'apps/web', 'loadtest']) {
    try { Object.assign(scripts, JSON.parse(read(join(ROOT, ws, 'package.json'))).scripts || {}); }
    catch { /* workspace may not exist */ }
}

// ── The guides ──────────────────────────────────────────────────────────────
const files = [];
(function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) files.push(p);
    }
})(HERE);

const problems = [];
const seen = { service: new Set(), script: new Set(), env: new Set(), path: new Set() };

for (const f of files.sort()) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const src = read(f);
    const lineOf = (i) => src.slice(0, i).split('\n').length;

    for (const m of src.matchAll(/docker compose (?:-f \S+ )?(?:up -d |restart |logs -f |exec |build |stop |start )?([a-z][a-z0-9_-]*)/g)) {
        const name = m[1];
        // Verbs and flags that follow `docker compose`, not service names.
        if (['up', 'down', 'ps', 'logs', 'exec', 'build', 'restart', 'pull', 'run', 'stop', 'start', 'config', 'version'].includes(name)) continue;
        if (services.has(name) || seen.service.has(name)) continue;
        seen.service.add(name);
        problems.push(`${rel}:${lineOf(m.index)}  docker compose "${name}" — no such service`);
    }

    for (const m of src.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
        const name = m[1];
        if (scripts[name] || seen.script.has(name)) continue;
        seen.script.add(name);
        problems.push(`${rel}:${lineOf(m.index)}  npm run "${name}" — in no workspace package.json`);
    }

    // A variable a guide tells you to SET — at the START of a line, which is how a dotenv
    // block and an `export` line both look.
    //
    // NOT inline backticks mid-sentence: "subscriber `NUMSUB=1`" is a Redis metric being
    // quoted, not configuration being prescribed, and flagging it taught the reader to skim
    // past this check's output.
    for (const m of src.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]{3,})=/gm)) {
        const name = m[1];
        if (composeVars.has(name) || apiVars.has(name) || seen.env.has(name)) continue;
        seen.env.add(name);
        problems.push(`${rel}:${lineOf(m.index)}  ${name}= — read by neither compose nor the API`);
    }

    for (const m of src.matchAll(/`(infra\/[\w./-]+|apps\/[\w./-]+|packages\/[\w./-]+)`/g)) {
        const p = m[1];
        if (p.endsWith('/') || seen.path.has(p)) continue;
        if (existsSync(join(ROOT, p))) continue;
        // Absent from a checkout ON PURPOSE is not a broken claim.
        //
        // This check ran existsSync against the WORKING TREE, so it passed on a developer's
        // machine and failed in CI on two paths that are correct: `infra/compose/.env`, the
        // file every deploy guide tells you to create, and
        // `apps/api/node_modules/.prisma/client`, the directory the Prisma two-client trap
        // requires you to mirror a generated client into. Both are .gitignored. "Fixing"
        // the guides would have deleted two instructions a reader genuinely needs.
        if (gitIgnores(p)) { untracked.push({ path: p, rel }); continue; }
        seen.path.add(p);
        problems.push(`${rel}:${lineOf(m.index)}  \`${p}\` — no such file`);
    }
}

// The reverse question: does the .env REFERENCE cover every variable the example ships?
//
// Everything above asks "does what a guide names exist". This asks "does what exists get
// named" — the opposite failure, and the quieter one: a variable nobody documented is not a
// broken link, it is a setting the operator never learns about. It was 59/64 when this was
// added, and the five missing ones included REPO_PUBLIC_BASE, which silently hands out repo
// URLs pointing at the visitor's own machine when left on localhost.
{
    const example = read(join(ROOT, 'infra/compose/.env.example'));
    const declared = new Set([...example.matchAll(/^#?([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
    for (const lang of ['FR', 'EN']) {
        const ref = read(join(HERE, `run/ENV_${lang}.md`));
        if (!ref) continue;
        for (const v of declared) {
            if (ref.includes(v)) continue;
            problems.push(`guides/run/ENV_${lang}.md  ${v} — in .env.example, explained nowhere`);
        }
    }
}

console.log(`checked ${files.length} guides against ${services.size} services, ${Object.keys(scripts).length} scripts, ${composeVars.size + apiVars.size} env vars\n`);
// Said out loud, always. A path waved through because git ignores it is still a path a
// reader cannot see until they create it, and "nothing to report" should not look the
// same as "two things accepted on trust".
if (untracked.length) {
    // One line per PATH, not per mention: `infra/compose/.env` is named by fourteen guides
    // and printing it fourteen times buries the one entry that is not it.
    const byPath = new Map();
    for (const u of untracked) byPath.set(u.path, (byPath.get(u.path) || 0) + 1);
    console.log(`${byPath.size} path(s) a reader must create or generate (git ignores them):`);
    for (const [p, n] of [...byPath].sort()) console.log(`  \`${p}\`  — named by ${n} guide${n > 1 ? 's' : ''}`);
    console.log('');
}
if (!problems.length) {
    console.log('every service, script, variable and path a guide names exists');
    process.exit(0);
}
for (const p of problems) console.log('  ' + p);
console.log(`\n${problems.length} claim(s) a reader would follow and find nothing.`);
process.exit(1);
