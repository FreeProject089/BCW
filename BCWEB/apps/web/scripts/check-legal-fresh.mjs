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
// Compares the constant against when git says the FILE last changed, so the check needs no
// memory of its own and cannot go stale.
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

let bad = 0;
for (const file of FILES) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    if (!fs.existsSync(file)) {
        console.error(`legal-fresh: ${rel} does not exist — this check is pointed at nothing.`);
        process.exit(1);
    }
    let fileDate = '';
    try {
        // The last commit that touched it. A shallow clone has no history to answer with, which
        // checkFreshness reports as unverified rather than passing — see the CI step's
        // fetch-depth.
        fileDate = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8' }).trim();
    } catch { /* no git: reported below as unverified, never as fine */ }

    const r = checkFreshness(fs.readFileSync(file, 'utf8'), fileDate);
    if (r.ok) { console.log(`legal-fresh OK — ${rel} says ${r.declared}, last changed ${r.fileDate}`); continue; }
    bad++;
    console.error(`legal-fresh: ${rel} — ${r.message}`);
}
process.exit(bad ? 1 : 0);
