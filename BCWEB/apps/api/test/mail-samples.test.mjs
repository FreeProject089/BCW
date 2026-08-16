// The mail gallery.
//
// Its whole reason for existing is that looking at a mail used to require CAUSING one. So the
// tests care about two things: that a sample is built by the same shell the real sender uses,
// and that nothing in the gallery could ever leak or send.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_SAMPLES, MAIL_GROUPS, renderSample } from '../src/lib/mail-samples.mjs';

describe('the catalogue', () => {
    test('every sample builds real HTML', () => {
        for (const s of MAIL_SAMPLES) {
            const html = s.build();
            assert.match(html, /<html|<table|<body/i, `${s.id} produced nothing that looks like a mail`);
            assert.ok(html.length > 300, `${s.id} is suspiciously short`);
        }
    });

    test('every sample belongs to a group that exists', () => {
        // Otherwise it renders in no column and is invisible in the one screen built to show it.
        const ids = new Set(MAIL_GROUPS.map((g) => g.id));
        for (const s of MAIL_SAMPLES) assert.ok(ids.has(s.group), `${s.id} is in group "${s.group}"`);
    });

    test('ids are unique', () => {
        const seen = new Set();
        for (const s of MAIL_SAMPLES) {
            assert.ok(!seen.has(s.id), `duplicate id ${s.id}`);
            seen.add(s.id);
        }
    });

    test('THE ONE: no sample carries anything that looks like a real token or address', () => {
        // A screenshot of this page must never be a leak, and a preview holding a live-looking
        // link invites somebody to click it.
        for (const s of MAIL_SAMPLES) {
            const html = s.build();
            assert.ok(!/[a-f0-9]{32,}/i.test(html), `${s.id} contains something shaped like a token`);
            const mails = html.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
            for (const m of mails) {
                assert.match(m, /example\.com$|localhost$/, `${s.id} contains ${m}`);
            }
        }
    });
});

describe('renderSample', () => {
    test('an unknown id is null, not an empty mail', () => {
        assert.equal(renderSample('nope'), null);
    });

    test('auto keeps the media query — that is what a real send does', () => {
        assert.match(renderSample('verify'), /@media \(prefers-color-scheme: dark\)/);
    });

    test('dark applies the same declarations unconditionally', () => {
        const dark = renderSample('verify', 'dark');
        assert.ok(!/@media \(prefers-color-scheme: dark\)/.test(dark), 'the query is gone');
        assert.match(dark, /\.bc-bg\{background:#0a0907/, 'and its rules are still there');
    });

    test('light drops them', () => {
        const light = renderSample('verify', 'light');
        assert.ok(!/prefers-color-scheme/.test(light));
        assert.ok(!/#0a0907/.test(light), 'no dark background survives into the light preview');
    });

    test('the three schemes differ only in that block', () => {
        // If they differed anywhere else the preview would stop being what gets sent.
        const strip = (h) => h.replace(/<style>[\s\S]*?<\/style>/, '');
        assert.equal(strip(renderSample('verify', 'dark')), strip(renderSample('verify', 'light')));
    });
});
