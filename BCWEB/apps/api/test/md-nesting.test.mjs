// The directive re-fencer. Lives in apps/web, tested here because this is where the runner
// is and the file is plain JS — and because the bug it fixes was invisible: a second step
// rendered with a bullet instead of a "2", which reads as a styling quirk rather than as a
// block that escaped its parent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDirectiveNesting as fix } from '../../web/src/lib/md-nesting.js';

describe('normalizeDirectiveNesting', () => {
    test('THE ONE: two steps written at the same depth both stay inside the block', () => {
        const out = fix([':::steps', ':::step[A]', 'a', ':::', ':::step[B]', 'b', ':::', ':::'].join('\n'));
        const lines = out.split('\n');
        assert.equal(lines[0], '::::steps', 'the wrapper outranks its children');
        assert.equal(lines[7], '::::', 'and its closer matches');
        assert.equal(lines[1], ':::step[A]', 'the children are left at three');
        assert.equal(lines[4], ':::step[B]');
    });

    test('a roadmap keeps its stages', () => {
        const out = fix([':::roadmap{title=R}', ':::stage[Done]{state=done}', '- x', ':::', ':::'].join('\n'));
        assert.ok(out.startsWith('::::roadmap{title=R}'), out.split('\n')[0]);
    });

    test('three levels deep each outrank what they hold', () => {
        const out = fix([':::steps', ':::step[A]', ':::card{title=c}', 'x', ':::', ':::', ':::'].join('\n'));
        const l = out.split('\n');
        assert.equal(l[0], ':::::steps');
        assert.equal(l[1], '::::step[A]');
        assert.equal(l[2], ':::card{title=c}');
    });

    test('a document that already uses 4 colons is not touched', () => {
        // Somebody who wrote `::::` knows the rule and may be nesting deliberately.
        const src = ['::::steps', ':::step[A]', ':::', '::::'].join('\n');
        assert.equal(fix(src), src);
    });

    test('siblings that never nest keep three colons', () => {
        const src = [':::note', 'hi', ':::', '', ':::tip', 'yo', ':::'].join('\n');
        assert.equal(fix(src), src);
    });

    test('`:::` inside a code fence is a sample, not a block', () => {
        const src = ['```md', ':::steps', ':::step[A]', ':::', ':::', '```'].join('\n');
        assert.equal(fix(src), src, 'the reader is meant to copy it exactly as printed');
    });

    test('an unclosed block is left for remark to complain about', () => {
        const src = [':::steps', ':::step[A]', ':::'].join('\n');
        assert.equal(fix(src), src, 'without an end, what is inside it is a guess');
    });

    test('prose with no directives comes back identical', () => {
        const src = '# Title\n\nSome text with a :: colon pair.\n';
        assert.equal(fix(src), src);
    });

    test('blank lines between the steps do not change the pairing', () => {
        const out = fix([':::steps', '', ':::step[A]', '', ':::', '', ':::step[B]', ':::', '', ':::'].join('\n'));
        assert.equal(out.split('\n')[0], '::::steps');
        assert.equal(out.split('\n')[9], '::::');
    });

    test('indented blocks keep their indentation', () => {
        const out = fix(['  :::steps', '  :::step[A]', '  :::', '  :::'].join('\n'));
        assert.equal(out.split('\n')[0], '  ::::steps');
        assert.equal(out.split('\n')[3], '  ::::');
    });
});
