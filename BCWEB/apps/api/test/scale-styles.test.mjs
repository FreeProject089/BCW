// A poll's scale can be drawn three ways, and the list of ways is written in three places:
// the rule (poll-answer.mjs), the admin editor's dropdown, and the public renderer's branches.
// The web app cannot import from the API, so they cannot literally share a constant — which
// leaves a check as the only thing standing between them and a silent divergence.
//
// What a divergence costs: an admin picks "hearts" from a dropdown that offers it, the renderer
// has never heard of it and falls through to a number box, and the poll goes out looking
// nothing like the one that was designed. Nothing errors, in any of the three places.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE_STYLES } from '../src/lib/poll-answer.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src/pages');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

/** The styles the admin dropdown offers, read out of the editor itself. */
function editorStyles() {
    const src = read('admin-polls.jsx');
    // The <Select> that writes `config.style`, then every <option value="…"> inside it.
    const i = src.indexOf('style: e.target.value');
    assert.notEqual(i, -1, 'the scale-style dropdown moved — this check is looking at nothing');
    const block = src.slice(i, i + 700);
    return [...block.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
}

/** The styles the public renderer actually draws differently. */
function rendererStyles(src) {
    return [...src.matchAll(/config\??\.style === '([a-z]+)'/g)].map((m) => m[1]);
}

describe('scale styles agree across the three places that know them', () => {
    test('the admin dropdown offers exactly what the rule allows', () => {
        assert.deepEqual([...editorStyles()].sort(), [...SCALE_STYLES].sort());
    });

    test('every style the editor offers is drawn by the renderer', () => {
        // 'number' is the fallback and needs no branch of its own — everything else does, or
        // picking it silently produces the number box.
        const drawn = new Set(rendererStyles(read('polls.jsx')));
        for (const s of editorStyles()) {
            if (s === 'number') continue;
            assert.ok(drawn.has(s), `the editor offers "${s}" and the poll page never draws it`);
        }
    });

    test('the renderer draws nothing the rule would reject', () => {
        // The mirror case: a branch for a style the server normalises away renders once and
        // never again after a reload.
        for (const s of new Set(rendererStyles(read('polls.jsx')))) {
            assert.ok(SCALE_STYLES.includes(s), `the poll page draws "${s}", which the rule does not allow`);
        }
    });

    test('the check is looking at something', () => {
        // Guards that quietly stop finding their subject pass for ever.
        assert.ok(SCALE_STYLES.length >= 2, 'SCALE_STYLES shrank to nothing');
        assert.ok(editorStyles().length >= 2, 'no options found in the editor dropdown');
        assert.ok(rendererStyles(read('polls.jsx')).length >= 1, 'no style branches found in the renderer');
    });
});
