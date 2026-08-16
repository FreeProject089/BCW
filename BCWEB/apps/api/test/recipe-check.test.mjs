// Checking an installer.toml against the schema that will actually read it.
//
// The whole feature exists for one silent failure: serde drops keys it does not recognise, so
// `[[componentss]]` builds an installer with no components and says nothing. Every test here
// is about reporting that WITHOUT reporting things that are fine — a checker that cries about
// valid keys gets turned off, and then it catches nothing at all.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';
import { keyPaths, checkRecipe, nearest } from '../src/lib/recipe-check.mjs';

const schema = {
    keys: [
        'app', 'app.id', 'app.name', 'app.version',
        'install', 'install.main_exe', 'install.create_shortcuts',
        // NOT in keys[] — the real artifact lists what the engine READS, and the dead ones
        // are exactly what it does not. The fixture said otherwise and hid a double report.
        'components', 'components[].id', 'components[].name', 'components[].paths',
        'theme', 'theme.accent',
    ],
    knownDead: ['install.default_dir', 'install.allow_portable'],
};

describe('keyPaths', () => {
    test('an array of tables collapses to one shape, however many entries', () => {
        // components.0.id would report the second component's every key as unknown.
        const doc = parse('[[components]]\nid = "a"\n\n[[components]]\nid = "b"\nname = "B"\n');
        assert.deepEqual([...keyPaths(doc)].sort(), ['components', 'components[].id', 'components[].name']);
    });

    test('a leaf array is a VALUE, not a path', () => {
        // Walking into it would invent `paths[]` as a key nobody declared.
        const doc = parse('[[components]]\npaths = ["bin/", "mcp/"]\n');
        assert.deepEqual([...keyPaths(doc)].sort(), ['components', 'components[].paths']);
    });

    test('a nested table contributes itself and its children', () => {
        const doc = parse('[app]\nid = "x"\n');
        assert.deepEqual([...keyPaths(doc)].sort(), ['app', 'app.id']);
    });
});

describe('checkRecipe', () => {
    test('a typo is the finding — this is the bug the feature exists for', () => {
        // `[[componentss]]` parses, the installer builds with no components, nothing warns.
        const doc = parse('[app]\nid = "x"\n\n[[componentss]]\nid = "a"\n');
        const r = checkRecipe(doc, schema);
        assert.equal(r.ok, false);
        // ONE finding, naming the table. The fields under it are consequences, not mistakes.
        assert.deepEqual(r.dropped, ['componentss']);
    });

    test('a clean recipe is clean, and unset keys are not a problem', () => {
        const doc = parse('[app]\nid = "x"\nname = "X"\n\n[install]\nmain_exe = "x.exe"\n');
        const r = checkRecipe(doc, schema);
        assert.equal(r.ok, true);
        assert.deepEqual(r.dropped, []);
        assert.ok(r.unset.includes('theme.accent'), 'unset keys are reported, as an answer to "what else is there?"');
        assert.equal(r.counts.dropped, 0);
    });

    test('a key the schema knows but nothing reads is named separately', () => {
        // It parses and does nothing, which is worse than a typo because it looks correct —
        // and it is NOT "dropped", so reporting it in that list would be wrong.
        const doc = parse('[app]\nid = "x"\n\n[install]\ndefault_dir = "C:/x"\n');
        const r = checkRecipe(doc, schema);
        assert.equal(r.ok, true, 'a dead key is not a dropped key');
        assert.deepEqual(r.dead, ['install.default_dir']);
        assert.deepEqual(r.dropped, []);
    });

    test('a parent table is not reported for having children', () => {
        // `[install]` itself is in the schema; a checker that compared parents would flag
        // every section whose children are declared — noise standing where the finding goes.
        const doc = parse('[install]\nmain_exe = "x.exe"\n');
        assert.deepEqual(checkRecipe(doc, schema).dropped, []);
    });

    test('an empty schema refuses to judge rather than calling everything unknown', () => {
        // THE ONE that matters most. If the artifact is missing or malformed, every key in a
        // perfectly good recipe looks dropped — a confidently wrong answer, which is worse
        // than no answer.
        const doc = parse('[app]\nid = "x"\n');
        assert.deepEqual(checkRecipe(doc, { keys: [] }), { ok: false, error: 'schema_empty' });
        assert.deepEqual(checkRecipe(doc, null), { ok: false, error: 'schema_empty' });
    });

    test('counts describe what was compared, not just what failed', () => {
        const doc = parse('[app]\nid = "x"\nnope = 1\n');
        const r = checkRecipe(doc, schema);
        assert.equal(r.counts.known, schema.keys.length);
        assert.equal(r.counts.dropped, 1);
        assert.ok(r.counts.used >= 2);
    });
});

describe('nearest', () => {
    test('names the word it meant, which is the point of reporting a typo', () => {
        // I expected null here and was wrong: `componentss` and `components` are both at the
        // top level, so they ARE siblings and the suggestion is exactly what a reader wants.
        assert.equal(nearest('componentss', schema.keys)?.key, 'components');
        assert.equal(nearest('install.main_exee', schema.keys)?.key, 'install.main_exe');
    });

    test('only within the same table — the same typo in two places is two mistakes', () => {
        assert.equal(nearest('app.main_exe', schema.keys), null);
    });

    test('conservative: no suggestion for a short name or a distant one', () => {
        // Every three-letter word is close to every other, so a suggestion there is a guess
        // wearing the clothes of a fact.
        assert.equal(nearest('app.idx', schema.keys), null);
        assert.equal(nearest('install.something_else_entirely', schema.keys), null);
    });
});
