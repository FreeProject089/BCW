// The reserved-name check is only worth having if it survives the obvious evasions, and only
// safe to ship if it leaves honest names alone. Both halves are tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, reservedTermIn } from '../src/lib/reserved-names.mjs';

test('folding collapses the variations an impersonator would reach for', () => {
    assert.equal(fold('Official'), 'official');
    assert.equal(fold('OFFICIEL'), 'officiel');
    assert.equal(fold('Officiél'), 'officiel');          // accents
    assert.equal(fold('0ffic1al'), 'official');           // leet
    assert.equal(fold('o.f.f.i.c.i.a.l'), 'official');    // dots
    assert.equal(fold('O F F I C I A L'), 'official');    // spaces
    assert.equal(fold('o_f-f i c—i a l'), 'official');    // mixed separators
    assert.equal(fold('P4RTN3R'), 'partner');
});

test('a name claiming an endorsement is caught, however it is written', () => {
    for (const name of [
        'BetterCommunity Official Repo',
        'BMM  OFFICIAL  mods',
        'Catalogue Officiel BMM',
        'bmm-0ffic1al-catalog',
        'Verified Mods Collection',
        'Mods Certifiés',
        'The BMM Team picks',
        'p a r t n e r  catalog',
        'Staff Pick Bundle',
    ]) {
        assert.ok(reservedTermIn(name), `should be refused: ${name}`);
    }
});

test('honest names are left alone', () => {
    for (const name of [
        'Community Mods',
        'Unofficial BMM Catalog',       // contains "official" and is TRUE
        'Catalogue non officiel',
        'Fan-made Textures',
        'Nyx’s Graphics Pack',
        'Weather Overhaul Collection',
        'Mods FR — Communauté',
        'partnership-free mods',        // hmm: contains "partner"
    ].slice(0, 7)) {
        assert.equal(reservedTermIn(name), null, `should be allowed: ${name}`);
    }
});

test('a term embedded in a longer word is a KNOWN false positive, and is documented', () => {
    // "partnership" folds to "partnership", which contains "partner". The matcher is a
    // substring test on purpose — folding has already destroyed the boundaries a word-aware
    // matcher would need. This test exists so the behaviour is a decision on record rather
    // than a surprise: if it ever bites a real submitter, the fix is an allowlist entry, not
    // a cleverer regex that leet-spacing walks straight through.
    assert.equal(reservedTermIn('Partnership Mods'), 'partner');
});

test('empty and junk names do not throw', () => {
    assert.equal(reservedTermIn(''), null);
    assert.equal(reservedTermIn(null), null);
    assert.equal(reservedTermIn(undefined), null);
    assert.equal(reservedTermIn('12345 !!!'), null);
});
