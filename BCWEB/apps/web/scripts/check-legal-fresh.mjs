#!/usr/bin/env node
// Do the legal pages still show a true date?
//
// legal.jsx carries `LEGAL_UPDATED`, hand-typed and shown to every reader as "last updated".
// Edit the terms, forget the constant, and the page states in writing a date on which it was
// not written — the one kind of staleness that matters, because a privacy policy is quoted by
// its date and a wrong one looks authoritative.
//
// The rule itself lives in apps/api/src/lib/legal-freshness.mjs and has had tests since the day
// it was written. Nothing ever called it: no route, no script, no CI step. This is that caller
// — the reason the rule exists at all.
//
// Compares the constant against when git says the WORDING last changed, so the check needs no
// memory of its own and cannot go stale.
//
// The wording, not the file. The first version dated the file, and a UX pass that only made the
// table-of-contents links 44px tall (class attributes, not one word of the policy) turned this
// red: the only way to satisfy it was to tell every reader the policy had changed that day,
// which is exactly the false date this check exists to prevent. So a commit whose change to the
// file is class attributes only is skipped, and the date is the newest commit that changed
// anything else. Anything else counts -- a comment, an import, a component -- because a check
// that tries to decide what is "legal text" will one day decide wrong in the quiet direction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkFreshness } from '../../api/src/lib/legal-freshness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// A path may be passed in — that is how the failing case is exercised, since the real file is
// (and should stay) up to date.
const FILES = (process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f))
    : ['src/pages/legal.jsx'].map((f) => path.resolve(here, '..', f)));

// The file with its class attributes removed: `className="..."` and `className={`...`}`.
// Template-literal classes here never nest braces deeper than one `${...}`, which the second
// pattern allows for; anything it cannot parse stays in, so the error is always "counted a
// class-only commit as a wording change", never the other way round.
const stripClasses = (src) => String(src)
    .replace(/className="[^"]*"/g, 'className=""')
    .replace(/className=\{`(?:[^`$]|\$\{[^}]*\})*`\}/g, 'className=""');

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function wordingDate(file) {
    const rel = path.relative(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), file).replace(/\\/g, '/');
    const log = git(['log', '--format=%H %cs', '--', file]).trim().split('\n').filter(Boolean);
    const show = (rev) => { try { return git(['show', `${rev}:${rel}`]); } catch { return null; } };
    for (const line of log) {
        const [sha, date] = line.split(' ');
        const after = show(sha);
        const before = show(`${sha}^`);
        // No parent version (the file was created here, or a root commit): that is a wording date.
        if (before == null || after == null) return date;
        if (stripClasses(after) !== stripClasses(before)) return date;
    }
    return log.length ? log[log.length - 1].split(' ')[1] : '';
}

let bad = 0;
for (const file of FILES) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    if (!fs.existsSync(file)) {
        console.error(`legal-fresh: ${rel} does not exist — this check is pointed at nothing.`);
        process.exit(1);
    }
    let fileDate = '';
    try {
        // The newest commit that changed more than class attributes. A shallow clone has no
        // history to answer with, which checkFreshness reports as unverified rather than
        // passing -- see the CI step's fetch-depth.
        fileDate = wordingDate(file);
    } catch { /* no git: reported below as unverified, never as fine */ }

    const r = checkFreshness(fs.readFileSync(file, 'utf8'), fileDate);
    if (r.ok) { console.log(`legal-fresh OK — ${rel} says ${r.declared}, last changed ${r.fileDate}`); continue; }
    bad++;
    console.error(`legal-fresh: ${rel} — ${r.message}`);
}
process.exit(bad ? 1 : 0);
