// Do the codebase-maps guides still quote the numbers the maps actually report?
//
// CODEBASE_MAPS_EN.md and _FR.md describe the output of the eight admin maps. Every concrete
// figure in them went stale at once and nobody noticed, because a document has no way to
// notice: the route total had drifted by four hundred, "exactly one data-loss migration" had
// become two, and "five live secret fallbacks" was still printed a month after the last one
// was fixed. The last of those is the dangerous shape — a security claim that decayed in the
// reassuring direction, which a reader acts on by NOT looking.
//
// So the two pages pin the figures somebody would act on in a table keyed by a stable
// identifier, and this rebuilds each map from the source and compares. The keys are identical
// in both languages on purpose: the labels are translated, the check is not.
//
// Deliberately NOT checked: route, model and call totals. They move every week, they are
// written in the pages as dated snapshots, and a test that failed on every new endpoint would
// be switched off within a month. This covers only figures that are rare to change and
// expensive to be wrong about.
//
// No database and no server: every builder here is a pure function of the files on disk, which
// is the property that lets this run in CI next to the unit tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSecretsMap } from '../src/lib/secrets-map.mjs';
import { findIndexDrift } from '../src/lib/schema-map.mjs';
import { buildMigrationMap } from '../src/lib/migration-map.mjs';
import { buildComposeMap } from '../src/lib/compose-map.mjs';
import { buildInfraMap } from '../src/lib/infra-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOCS = ['guides/reference/CODEBASE_MAPS_EN.md', 'guides/reference/CODEBASE_MAPS_FR.md'];

/** Every `.mjs` under a directory, as { name, src } — the shape every builder takes. */
function readTree(dir, base = dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...readTree(p, base));
        else if (e.name.endsWith('.mjs')) out.push({ name: path.relative(base, p), src: fs.readFileSync(p, 'utf8') });
    }
    return out;
}

function readMigrations() {
    const dir = path.join(ROOT, 'packages/db/migrations');
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
            const f = path.join(dir, d.name, 'migration.sql');
            return fs.existsSync(f) ? { name: d.name, sql: fs.readFileSync(f, 'utf8') } : null;
        })
        .filter(Boolean);
}

/**
 * The figures, rebuilt from the source with the same inputs the routes in devtools.mjs use.
 *
 * The workflow directory is the same two-candidate search the infra-map route does, first
 * match wins. `release.yml` lives in the repository ABOVE both of them, which is why this
 * reports one workflow and the page says so in words.
 */
function measure() {
    const apiSrc = path.join(ROOT, 'apps/api/src');
    const files = readTree(apiSrc);
    const envExample = path.join(ROOT, 'infra/compose/.env.example');
    const secrets = buildSecretsMap(files, fs.existsSync(envExample) ? fs.readFileSync(envExample, 'utf8') : '');

    const schema = fs.readFileSync(path.join(ROOT, 'packages/db/schema.prisma'), 'utf8');
    const migrations = readMigrations();
    const drift = findIndexDrift(schema, migrations);
    // No database: the on-disk half is what this page quotes, and the destructive count is
    // answered by the SQL alone.
    const migMap = buildMigrationMap(migrations, [], false);

    const compose = buildComposeMap(fs.readFileSync(path.join(ROOT, 'infra/compose/docker-compose.yml'), 'utf8'));

    let workflows = [];
    for (const d of [path.join(ROOT, '.github/workflows'), path.resolve(ROOT, '../.github/workflows')]) {
        if (!fs.existsSync(d)) continue;
        workflows = fs.readdirSync(d).filter((f) => /[.]ya?ml$/.test(f))
            .map((f) => ({ name: f, text: fs.readFileSync(path.join(d, f), 'utf8') }));
        if (workflows.length) break;
    }
    const infra = buildInfraMap(workflows, compose);

    // A map built from nothing reports nothing wrong, which is the most dangerous answer this
    // family of tools can give — and a test that believed it would go green on a broken read.
    assert.ok(files.length > 50, `read ${files.length} API modules — the tree moved, this check cannot be trusted`);
    assert.ok(migrations.length > 50, `read ${migrations.length} migrations — the tree moved, this check cannot be trusted`);
    assert.ok(compose.services.length > 5, `read ${compose.services.length} services — the compose file moved`);
    assert.ok(workflows.length > 0, 'found no workflow directory — the infra map figures cannot be checked');

    return {
        liveSecretFallbacks: secrets.hardcodedSecrets.filter((h) => !h.guardedInProduction).length,
        dataLossMigrations: migMap.counts.destructive,
        indexDrift: drift.orphaned.length,
        publishedPorts: compose.exposedToNetwork.length,
        workflows: infra.counts.workflows,
        workflowJobs: infra.counts.jobs,
        workflowSecrets: infra.counts.secretsNeeded,
    };
}

/** The pinned table: rows of `| \`key\` | anything | **N** |`. */
function pinned(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const out = new Map();
    for (const line of src.split('\n')) {
        const m = line.match(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|[^|]*\|\s*\*\*(\d+)\*\*\s*\|\s*$/);
        if (m) out.set(m[1], Number(m[2]));
    }
    return out;
}

describe('codebase-maps guides', () => {
    const actual = measure();

    for (const doc of DOCS) {
        test(`${doc} pins the figures the maps report`, () => {
            const table = pinned(doc);
            assert.equal(table.size, Object.keys(actual).length,
                `${doc}: read ${table.size} pinned row(s), expected ${Object.keys(actual).length} — the table shape moved`);
            for (const [key, value] of Object.entries(actual)) {
                assert.ok(table.has(key), `${doc}: no pinned row for \`${key}\``);
                assert.equal(table.get(key), value,
                    `${doc}: \`${key}\` says ${table.get(key)}, the maps report ${value} — update the row and the prose around it`);
            }
        });
    }

    // The two pages are a translation pair. A figure corrected in one and not the other is the
    // failure this whole document family exists to stop, and it is invisible to a reader who
    // only opens one language.
    test('EN and FR pin the same values', () => {
        const [en, fr] = DOCS.map(pinned);
        assert.deepEqual([...fr].sort(), [...en].sort());
    });
});
