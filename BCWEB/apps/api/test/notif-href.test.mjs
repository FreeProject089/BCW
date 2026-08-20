// A notification's link is written by whatever code path notified the user — a webhook, the
// bot, a sweeper. So the thing worth proving is that it can only ever point back into this
// app, and that a bad value costs the notification its link rather than the notification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNotifHref } from '../src/lib/lib.mjs';

test('an in-app path is kept, hash and query included', () => {
    assert.equal(safeNotifHref('/dashboard#transfers'), '/dashboard#transfers');
    assert.equal(safeNotifHref('/polls/abc?k=xyz'), '/polls/abc?k=xyz');
    assert.equal(safeNotifHref('  /repos  '), '/repos');
});

test('anything that leaves this origin is refused', () => {
    for (const bad of [
        'https://evil.example',
        'http://evil.example',
        // Protocol-relative: a browser reads this as another host, not as a path.
        '//evil.example',
        // Some parsers treat a backslash as a slash, so this can escape the origin too.
        '/\\evil.example',
        'javascript:alert(1)',
        'data:text/html,<script>',
        'mailto:someone@example.com',
    ]) {
        assert.equal(safeNotifHref(bad), null, bad);
    }
});

test('an empty or missing link is simply no link', () => {
    for (const empty of ['', '   ', null, undefined, 0, false]) {
        assert.equal(safeNotifHref(empty), null, JSON.stringify(empty));
    }
});

test('a relative path with no leading slash is refused', () => {
    // "dashboard" would resolve against whatever page is open, so the same notification would
    // lead somewhere different depending on where it was read.
    assert.equal(safeNotifHref('dashboard'), null);
    assert.equal(safeNotifHref('./dashboard'), null);
    assert.equal(safeNotifHref('../admin'), null);
});

test('a very long link is cut rather than refused', () => {
    // Losing a query string is better than losing the destination: the page it names is still
    // the right page.
    const long = '/x'.padEnd(500, 'y');
    const out = safeNotifHref(long);
    assert.equal(out.length, 300);
    assert.ok(out.startsWith('/x'));
});
