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
import { checkFreshness, legalWordingDate } from '../../api/src/lib/legal-freshness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// A path may be passed in — that is how the failing case is exercised, since the real file is
// (and should stay) up to date.
const FILES = (process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f))
    : ['src/pages/legal.jsx'].map((f) => path.resolve(here, '..', f)));

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
        const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
        const rel = path.relative(root, file).replace(/\\/g, '/');
        const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        fileDate = legalWordingDate(git, rel, { working: fs.readFileSync(file, 'utf8') });
    } catch { /* no git: reported below as unverified, never as fine */ }

    const r = checkFreshness(fs.readFileSync(file, 'utf8'), fileDate);
    if (r.ok) { console.log(`legal-fresh OK — ${rel} says ${r.declared}, last changed ${r.fileDate}`); continue; }
    bad++;
    console.error(`legal-fresh: ${rel} — ${r.message}`);
}
process.exit(bad ? 1 : 0);
