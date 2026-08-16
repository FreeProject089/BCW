// Does the API reference describe routes that exist?
//
// The reference listed `/blog/mine` and `/blog-admin` long after the site stopped calling
// them, and would have gone on listing them after they were deleted — a document has no way
// to notice. The failure is quiet and it points the wrong way: somebody reads the reference,
// writes a client against a path that 404s, and the document looks authoritative while being
// wrong.
//
// One direction only, deliberately. "Documented but gone" is always a defect. "Exists but
// undocumented" is often correct — internal endpoints, webhooks, OAuth machinery — and a test
// that flagged those would be noise nobody reads.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOCS = ['guides/reference/API_Reference_EN.md', 'guides/reference/API_Reference_FR.md'];

/** Every path declared by the API, as written in the route files. */
function declaredRoutes() {
    const dir = path.join(ROOT, 'apps/api/src');
    const out = new Set();
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f);
            else if (e.name.endsWith('.mjs')) {
                const src = fs.readFileSync(f, 'utf8');
                for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) out.add(m[2]);
            }
        }
    };
    walk(dir);
    return out;
}

/** Every `/path` quoted in a table row of the reference. */
function documentedPaths(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const paths = new Set();
    for (const line of src.split('\n')) {
        if (!/^\|\s*(GET|POST|PUT|PATCH|DELETE|GET\/POST)/i.test(line.trim())) continue;
        // Only the second column: the Purpose column quotes query strings and field names too.
        const cols = line.split('|');
        // A cell lists siblings: "`/repos/:id/dashboard` · `/activity` · `/traffic`" means three
        // routes under the same parent, only the first written in full. Read literally, the
        // short ones look like top-level paths that do not exist — which is how the first
        // version of this test produced sixty false alarms.
        let first = null;
        for (const m of (cols[2] || '').matchAll(/`([^`]+)`/g)) {
            for (const raw of m[1].split(/\s+·\s+/)) {
                // A row often shows the query string it accepts; the route is the path.
                const q = raw.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '').split('?')[0].trim();
                if (!q.startsWith('/')) continue;
                if (!first) { first = q; paths.add(q); continue; }
                // The abbreviation is used both ways: after `/repos/:id/dashboard`, `/activity`
                // means the CHILD `/repos/:id/dashboard/activity`, while after
                // `/hosting/:o/:r/repo.json`, `/files/*` means the SIBLING. Accept either.
                const parent = first.slice(0, first.lastIndexOf('/'));
                paths.add({ literal: q, sibling: parent + q, child: first + q, fragment: true });
            }
        }
    }
    return paths;
}

/** A documented path matches a declared one if they agree segment by segment, a
 *  parameter matching a parameter — `[/:id]` marks an optional tail. */
function isDeclared(doc, declared) {
    const norm = (s) => s.replace(/\[|\]/g, '').replace(/\/+$/, '');
    // A trailing `*` in the document means "and everything under it" — one row standing in for
    // a dozen routes (`/server/files*`). Matched as a prefix rather than expanded.
    if (doc.endsWith('*')) {
        const base = norm(doc.slice(0, -1)).replace(/\/+$/, '');
        for (const real of declared) if (real === base || real.startsWith(`${base}/`)) return true;
    }
    const candidates = doc.includes('[') ? [norm(doc), norm(doc.replace(/\[[^\]]*\]/g, ''))] : [norm(doc)];
    for (const cand of candidates) {
        for (const real of declared) {
            const a = cand.split('/'), b = norm(real).split('/');
            if (a.length !== b.length) continue;
            if (a.every((seg, i) => seg === b[i] || seg.startsWith(':') || b[i].startsWith(':') || b[i] === '*')) return true;
        }
    }
    return false;
}

/**
 * Last resort for an abbreviated entry: does ANY declared route end with it?
 *
 * Some cells abbreviate against a base set several rows earlier — `/db/table/:name` under a
 * section about `/server/db`. Reconstructing that needs the prose, so this asks the weaker
 * question instead. It still catches what this test is for: `/bot/blog/unannounced` and
 * `/admin/analytics/vitals/page` were both documented in detail and neither exists anywhere,
 * under any prefix.
 */
function endsSomeRoute(frag, declared) {
    const f = frag.replace(/\*$/, '');
    for (const real of declared) if (real.endsWith(f)) return true;
    return false;
}

describe('the API reference describes routes that exist', () => {
    const declared = declaredRoutes();

    test('the check is looking at something', () => {
        // A scraper that stops matching passes for ever while proving nothing.
        assert.ok(declared.size > 200, `only ${declared.size} routes found in the source`);
        for (const f of DOCS) assert.ok(documentedPaths(f).size > 50, `only ${documentedPaths(f).size} paths found in ${f}`);
    });

    for (const file of DOCS) {
        test(`${file} names no route that has been removed`, () => {
            const missing = [...documentedPaths(file)]
                // A sibling entry is fine if EITHER reading exists — some cells really do list
                // unrelated top-level paths side by side.
                .filter((p) => (typeof p === 'string'
                    ? !isDeclared(p, declared)
                    : !isDeclared(p.literal, declared) && !isDeclared(p.sibling, declared)
                        && !isDeclared(p.child, declared) && !endsSomeRoute(p.literal, declared)))
                .map((p) => (typeof p === 'string' ? p : p.literal)).sort();
            assert.deepEqual(missing, [], `documented but not declared anywhere:\n  ${missing.join('\n  ')}`);
        });
    }

    test('EN and FR document the same paths', () => {
        // They drifted before: a row added to one and not the other means a French reader is
        // told the API is smaller than it is.
        const flat = (f) => new Set([...documentedPaths(f)].map((p) => (typeof p === 'string' ? p : p.literal)));
        const [en, fr] = DOCS.map(flat);
        assert.deepEqual([...en].filter((p) => !fr.has(p)).sort(), [], 'in EN, missing from FR');
        assert.deepEqual([...fr].filter((p) => !en.has(p)).sort(), [], 'in FR, missing from EN');
    });
});
