// The French interface used to lean on the em dash for everything: introducing a list,
// joining two sentences, fencing an aside, tacking a clause on the end. The repo owner
// asked three times, in three different batches, for fewer of them ("tu use tjr trop le —"),
// and the dictionary still held 401 of them across 360 strings. They were rewritten by hand
// into the mark the sentence actually wanted: a colon for an explanation or a list, a full
// stop for two independent clauses, commas or parentheses for a real aside.
//
// This is a RATCHET, not a ban. The em dash is legitimate French typography, and the few
// left are the ones where nothing else reads right (the "— aucun —" style placeholders in
// selects and empty cells). The number below is a CEILING, not a target: it may only ever
// be lowered. If you rewrite another string and the count drops, lower MAX to the new
// number in the same commit, so the total can fall and never climb back.
//
// Run: npm run --prefix apps/web emdash:check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'src', 'i18n.jsx');

// Ceiling, to be lowered and never raised. 9 em dashes in 6 strings, all of them the
// "nothing selected" placeholders: ds.pick.none, chc.poll.none, ve.status.none,
// mkw.review.none, cc.noname, mkadm.f.pick.
const MAX = 9;

const EM = '—';
const src = readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

// The French dictionary only: `fr: {` up to the line that closes it. English is not the
// complaint, and the code below the dictionary is not prose.
const start = lines.findIndex((l) => /^ {2}fr: \{/.test(l));
if (start === -1) {
    console.error('check-em-dash: no `fr: {` block in src/i18n.jsx — did the dictionary move?');
    process.exit(1);
}
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\},?\s*$/.test(lines[i])) { end = i; break; }
}
if (end === -1) {
    console.error('check-em-dash: the `fr: {` block is never closed — did the dictionary move?');
    process.exit(1);
}

// Values only. A key never carries prose, and matching the pair keeps a stray dash in a
// comment from counting as interface text.
const PAIR = /(['"])((?:\\.|(?!\1)[^\\])*?)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*?)\3/g;

let total = 0;
const hits = [];
for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    PAIR.lastIndex = 0;
    let m;
    while ((m = PAIR.exec(line))) {
        const n = (m[4].match(new RegExp(EM, 'g')) || []).length;
        if (n) { total += n; hits.push(`  ${FILE}:${i + 1}  ${m[2]}  (${n})`); }
    }
}

if (total > MAX) {
    console.error(`check-em-dash: ${total} em dashes in the French dictionary, ceiling is ${MAX}.`);
    console.error('Rewrite the new ones: a colon introduces an explanation or a list, a full stop');
    console.error('separates two independent clauses, commas or parentheses fence an aside.');
    console.error(hits.join('\n'));
    process.exit(1);
}

// A drop is the point of the exercise, so it never fails the build — but it does say so,
// because a ceiling nobody lowers stops ratcheting.
if (total < MAX) {
    console.log(`check-em-dash: ${total} em dashes, below the ceiling of ${MAX}. Lower MAX to ${total} in this script to lock the gain in.`);
    process.exit(0);
}

console.log(`check-em-dash: ${total} em dashes in the French dictionary (ceiling ${MAX}), ok`);
