// Grouping crashes by their STACK, not by what the sender typed.
//
// The feedback inbox had `fingerprint`, and it was never an answer to "how many people hit
// this bug": it is a dedupe key, hashed from the title plus the head of the body and only
// ever compared inside one sender's dedupe window. Two people meeting the identical panic
// produce two different fingerprints as soon as either machine prints a different path, a
// different pointer or a different line number, which is always.
//
// Every case below is one of the ways two reports of ONE crash look different on the wire,
// and one case is the opposite: the way two DIFFERENT crashes are made to look identical,
// which is the failure that would have shipped silently. BMM captures its backtrace from
// inside the panic hook, so the top of every BMM backtrace is the same six frames of crash
// machinery. A signature over the literal top frames puts every crash BMM has ever produced
// into a single group, prints a large confident number next to it, and is worthless.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stackSignature, normaliseFrame, stackTextOf } from '../src/routes/feedback.mjs';

const sig = (row) => stackSignature(row).sig;

// The shape `format!("{:?}", backtrace::Backtrace::new())` prints, captured from BMM's panic
// hook: the machinery first, then the program.
const alice = `
thread 'main' panicked at src\\commands\\mods.rs:412:18:
index out of bounds: the len is 0 but the index is 3
   0: backtrace::backtrace::trace_unsynchronized::h9f2ab77cd10e4411
             at C:\\Users\\alice\\.cargo\\registry\\backtrace-0.3.69\\src\\backtrace\\mod.rs:66
   1: std::panicking::rust_panic_with_hook::hb18e21cc0177fa19
             at /rustc/abc123/library/std/src/panicking.rs:702
   2: bettermm::commands::crash::generate_report::h00aa11bb22cc33dd
             at C:\\builds\\bmm\\src-tauri\\src\\commands\\crash.rs:272
   3: bettermm::commands::mods::scan_profile::h44ee55ff66007788
             at C:\\builds\\bmm\\src-tauri\\src\\commands\\mods.rs:412
   4: bettermm::commands::mods::refresh::hff00112233445566
             at C:\\builds\\bmm\\src-tauri\\src\\commands\\mods.rs:377
`;

// The same bug, a Linux build, a later point release: different registry path, different
// rustc hash, different symbol hashes, every line number moved.
const bob = `
thread 'main' panicked at src/commands/mods.rs:431:18:
index out of bounds: the len is 0 but the index is 7
   0: backtrace::backtrace::trace_unsynchronized::hdeadbeefdeadbeef
             at /home/bob/.cargo/registry/backtrace-0.3.71/src/backtrace/mod.rs:66
   1: std::panicking::rust_panic_with_hook::h1111222233334444
             at /rustc/zzz999/library/std/src/panicking.rs:711
   2: bettermm::commands::crash::generate_report::h5555666677778888
             at /build/bmm/src-tauri/src/commands/crash.rs:280
   3: bettermm::commands::mods::scan_profile::h9999aaaabbbbcccc
             at /build/bmm/src-tauri/src/commands/mods.rs:431
   4: bettermm::commands::mods::refresh::hddddeeeeffff0000
             at /build/bmm/src-tauri/src/commands/mods.rs:396
`;

// A different bug entirely — and note it shares the first three frames with both of the
// above, because every BMM panic does.
const other = `
thread 'main' panicked at src\\commands\\repo.rs:88:5:
called \`Option::unwrap()\` on a \`None\` value
   0: backtrace::backtrace::trace_unsynchronized::h9f2ab77cd10e4411
             at C:\\Users\\alice\\.cargo\\registry\\backtrace-0.3.69\\src\\backtrace\\mod.rs:66
   1: std::panicking::rust_panic_with_hook::hb18e21cc0177fa19
             at /rustc/abc123/library/std/src/panicking.rs:702
   2: bettermm::commands::crash::generate_report::h00aa11bb22cc33dd
             at C:\\builds\\bmm\\src-tauri\\src\\commands\\crash.rs:272
   3: bettermm::commands::repo::sync_one::h1234123412341234
             at C:\\builds\\bmm\\src-tauri\\src\\commands\\repo.rs:88
`;

describe('one crash, two machines', () => {
    test('different paths, line numbers and symbol hashes still group together', () => {
        assert.equal(sig({ meta: { stack: alice } }), sig({ meta: { stack: bob } }));
    });

    test('the group is not weak — it was built from frames', () => {
        assert.equal(stackSignature({ meta: { stack: alice } }).weak, false);
        assert.ok(stackSignature({ meta: { stack: alice } }).frames.length > 0);
    });

    test('a different bug is a different group, despite the identical panic prefix', () => {
        assert.notEqual(sig({ meta: { stack: alice } }), sig({ meta: { stack: other } }));
    });

    test('the signature starts at the program, not at the panic machinery', () => {
        // If the leading run of hook frames were kept, the first frame of every BMM crash
        // would be `backtrace::…` and the two bugs above would collide.
        const frames = stackSignature({ meta: { stack: alice } }).frames;
        assert.ok(!/backtrace::|std::panicking|commands::crash/.test(frames[0]), frames[0]);
        assert.match(frames[0], /scan_profile/);
    });
});

describe('a frame, normalised', () => {
    test('a Windows path and a POSIX path of the same frame are one frame', () => {
        assert.equal(
            normaliseFrame('   3: bettermm::commands::mods::scan_profile::h4444 at C:\\builds\\bmm\\src\\mods.rs:412'),
            normaliseFrame('   3: bettermm::commands::mods::scan_profile::h9999 at /build/bmm/src/mods.rs:431'),
        );
    });

    test('a JS frame loses its file position and its build hash', () => {
        assert.equal(
            normaliseFrame('    at loadProfile (https://x.test/assets/index-9a8b7c6d.js:12:3456)'),
            normaliseFrame('    at loadProfile (https://x.test/assets/index-0011aabb.js:99:1)'),
        );
    });
});

describe('a report with no stack at all', () => {
    // BMM's own crash reports are exactly this: the trace is inside the attached zip, and the
    // body is what the person typed. The grouping has to admit that it is guessing.
    const a = { title: 'BMM closed while scanning E:\\DCS (4210 mods)', body: '' };
    const b = { title: 'BMM closed while scanning C:\\Games\\DCS (98 mods)', body: '' };

    test('it is marked weak', () => {
        assert.equal(stackSignature(a).weak, true);
    });

    test('two tellings of the same story still meet, once paths and numbers are out', () => {
        assert.equal(sig(a), sig(b));
    });

    test('a different complaint does not', () => {
        assert.notEqual(sig(a), sig({ title: 'The repository list is empty', body: '' }));
    });

    // The limit, written down rather than discovered later: a path is recognised up to the
    // first space, so `E:\DCS World` leaves the word `World` behind in the message and that
    // report lands in its own group. Message grouping is a fallback and this is why it is
    // labelled as one on the screen — the fix is a stack, not a cleverer regex, because the
    // next surprise is a mod name with a space in it.
    test('a path with a space in it does not group, and that is the known limit', () => {
        assert.notEqual(sig(a), sig({ title: 'BMM closed while scanning E:\\DCS World (4210 mods)', body: '' }));
    });
});

describe('the index derived from the bundle wins', () => {
    // The admin screen opens the attached crash zip in the browser, reads the real backtrace
    // and posts back the signature. That reading saw the stack; this one is reading prose.
    test('meta._crash.sig overrules whatever the body looks like', () => {
        const row = { title: 'it crashed', body: alice, meta: { _crash: { sig: 'abc123def456', weak: false, frames: ['x'] } } };
        const s = stackSignature(row);
        assert.equal(s.sig, 'abc123def456');
        assert.equal(s.source, 'bundle');
    });

    test('a report with no index falls back to reading the text', () => {
        assert.equal(stackSignature({ body: alice }).source, 'text');
    });
});

describe('where the stack is read from', () => {
    test('a dedicated field beats the body', () => {
        assert.equal(stackTextOf({ meta: { stack: 'S' }, body: 'B' }), 'S');
    });

    test('an array of frames is joined, not stringified', () => {
        assert.equal(stackTextOf({ meta: { backtrace: ['a', 'b'] } }), 'a\nb');
    });

    test('no field anywhere falls through to the body', () => {
        assert.equal(stackTextOf({ meta: { pow: 'x' }, body: 'B' }), 'B');
    });
});
