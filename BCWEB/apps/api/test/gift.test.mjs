// A gift is aimed at somebody by a string a human typed, so the thing worth proving is that a
// typo becomes an error rather than a token pointing at nobody — an unredeemable code that was
// paid for is the worst outcome available here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseGiftTarget, genGiftCode } from '../src/lib/gift.mjs';

test('an e-mail becomes an email token, lower-cased', () => {
    assert.deepEqual(normaliseGiftTarget('Someone@Example.COM'),
        { token: 'email:someone@example.com', label: 'someone@example.com', kind: 'email' });
    assert.equal(normaliseGiftTarget('  a@b.co  ').token, 'email:a@b.co');
});

test('a BC id is accepted however it was pasted', () => {
    // The giver copies it off a profile, out of a chat, or types it from memory. All three
    // reach the same token — matching only the canonical form would reject most real input.
    for (const written of ['BC-7K2M-9XQ4', 'bc 7k2m9xq4', '7K2M9XQ4', 'BC7K2M9XQ4']) {
        const r = normaliseGiftTarget(written);
        assert.equal(r.token, 'bcid:7K2M9XQ4', written);
        assert.equal(r.label, 'BC-7K2M-9XQ4', written);
    }
});

test('nothing typed is a named error, not an empty token', () => {
    for (const empty of ['', '   ', null, undefined]) {
        assert.equal(normaliseGiftTarget(empty).error, 'gift_target_missing', JSON.stringify(empty));
    }
});

test('something that is neither is refused', () => {
    // Refused rather than guessed: a code minted against a token nobody matches is paid for and
    // unredeemable, and the giver finds out weeks later from the person who never got it.
    for (const bad of ['not an id', 'abc', '@nope', 'a@b', 'x@y.', '12345']) {
        assert.equal(normaliseGiftTarget(bad).error, 'gift_target_invalid', bad);
    }
});

test('an over-long address is refused rather than truncated', () => {
    // Truncating would produce a valid-looking token for a different address.
    const long = 'a'.repeat(200) + '@example.com';
    assert.equal(normaliseGiftTarget(long).error, 'gift_target_invalid');
});

test('generated codes are readable and do not repeat', () => {
    const seen = new Set(Array.from({ length: 300 }, () => genGiftCode()));
    assert.equal(seen.size, 300);
    for (const c of seen) {
        assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
        // No 0/O/1/I: these get read aloud and typed back in.
        assert.ok(!/[01IO]/.test(c), c);
    }
});
