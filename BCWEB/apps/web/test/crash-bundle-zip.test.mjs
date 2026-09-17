// The crash reader against a REAL archive, not against parsed pieces.
//
// The unit tests beside this one feed the parsers strings, which proves the rules and proves
// nothing about the part that actually breaks: reading a zip from its tail, inflating one
// entry, and refusing an archive that is not a crash bundle but a weapon. Those paths only
// exist when there are bytes, so this builds the bytes — a minimal zip writer, deflate-raw,
// the same shape BMM's `zip::ZipWriter` produces.
//
// The refusals are the reason this file is worth its length. A limit that is never exercised
// is a limit nobody knows is off by a factor of a thousand, and the whole promise of the tool
// ("it is read here, in your browser") rests on the refusals holding when the file is hostile.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Blob } from 'node:buffer';
import { analyseBundle, LIMITS } from '../src/lib/crash-bundle.js';

/* ── A minimal zip writer ───────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** `[[name, contents]]` → a Buffer holding a deflate-compressed zip. */
function makeZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of files) {
        const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        const packed = deflateRawSync(raw);
        const nameBuf = Buffer.from(name, 'utf8');
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
        lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
        lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(raw.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
        locals.push(lh, nameBuf, packed);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
        ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(raw.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
        ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
        ch.writeUInt32LE(offset, 42);
        central.push(ch, nameBuf);

        offset += lh.length + nameBuf.length + packed.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}
const asFile = (buf) => new Blob([buf]);

/* ── A crash bundle exactly as crash.rs writes one ──────────────────────────────────── */

const STACK = [
    '   0: backtrace::backtrace::trace_unsynchronized::h9f2ab77cd10e4411',
    '             at C:\\Users\\alice\\.cargo\\registry\\backtrace-0.3.69\\src\\backtrace\\mod.rs:66',
    '   1: bettermm::commands::crash::generate_report::h00aa11bb22cc33dd',
    '             at C:\\builds\\bmm\\src-tauri\\src\\commands\\crash.rs:272',
    '   2: bettermm::commands::mods::scan_profile::h44ee55ff66007788',
    '             at C:\\builds\\bmm\\src-tauri\\src\\commands\\mods.rs:412',
].join('\n');

const BUNDLE = [
    ['metadata.txt', 'BMM VERSION: 1.0.0\nTIMESTAMP:   2026-03-14T01:29:06.563+01:00\nREASON:      index out of bounds: the len is 0 but the index is 3\n'],
    ['stacktrace.txt', STACK],
    ['system_info.txt', '=== SYSTEM DIAGNOSTICS ===\nOS Name:         Windows\nOS Version:      11\nTotal Memory:    32690 MB\nFree Memory:     12345 MB\n\n=== PROCESS INFO ===\nMemory Usage:    250000 KB\nProcess Runtime: 421s\n'],
    ['app_logs.txt', '--- NEW SESSION STARTED AT 2026-03-14T01:29:06+01:00 (PID: 13816) ---\n[01:29:06.899] [STARTUP] BMM v1.0.0 initialized.\n[01:29:35.280] [UI] Navigated to view: profiles\n[01:29:36.001] [ERROR] scan failed\n'],
    ['state_snapshot.json', JSON.stringify({ profiles: [{ id: 'a' }, { id: 'b' }], mods: [], active_profile_id: 'a', installed_plugins: ['p1'], plugin_permissions: { p1: { script: true } }, settings: { language: 'fr', last_session_clean: false } })],
];

describe('a real crash bundle', () => {
    test('it is recognised as a crash, with the version and the panic reason', async () => {
        const b = await analyseBundle(asFile(makeZip(BUNDLE)), { name: 'crash_2026-03-14_01-29-06.zip' });
        assert.equal(b.refused, null);
        assert.equal(b.kind, 'crash');
        assert.equal(b.meta.version, '1.0.0');
        assert.match(b.meta.reason, /index out of bounds/);
    });

    test('the backtrace really was inflated, not merely listed', async () => {
        const b = await analyseBundle(asFile(makeZip(BUNDLE)), { name: 'crash_x.zip' });
        assert.match(b.stack, /scan_profile/);
        assert.equal(b.hasStack, true);
    });

    test('the machine and the log come through', async () => {
        const b = await analyseBundle(asFile(makeZip(BUNDLE)), { name: 'crash_x.zip' });
        assert.equal(b.system.flat['OS Name'], 'Windows');
        assert.equal(b.logs.length, 4);
        assert.equal(b.state.settings.language, 'fr');
    });

    test('the findings fire on the real thing', async () => {
        const b = await analyseBundle(asFile(makeZip(BUNDLE)), { name: 'crash_x.zip' });
        const keys = b.findings.map((x) => x.key);
        assert.ok(keys.includes('previouscrash'), keys.join(','));
        assert.ok(keys.includes('pluginexec'), keys.join(','));
        assert.ok(keys.includes('logerrors'), keys.join(','));
        assert.ok(keys.includes('noshutdownInSession') === false); // it is a crash, not a session
    });

    test('a clean-exit bundle is not called a crash', async () => {
        const clean = BUNDLE.filter(([n]) => n !== 'stacktrace.txt')
            .map(([n, c]) => (n === 'metadata.txt' ? [n, c.replace(/REASON:.*/, 'REASON:      Clean Exit (UI Close Button)')] : [n, c]));
        const b = await analyseBundle(asFile(makeZip(clean)), { name: 'session_x.zip' });
        assert.equal(b.kind, 'session');
        assert.ok(b.findings.map((x) => x.key).includes('clean'));
    });
});

describe('an archive that is not a crash bundle', () => {
    test('a zip with no metadata.txt is read and reported, not mistaken for one', async () => {
        const b = await analyseBundle(asFile(makeZip([['hello.txt', 'hi']])), { name: 'x.zip' });
        assert.equal(b.hasMetadata, false);
        assert.ok(b.findings.map((x) => x.key).includes('nometa'));
    });

    test('an entry that climbs out of the archive is flagged and never opened', async () => {
        const b = await analyseBundle(asFile(makeZip([...BUNDLE, ['../../evil.txt', 'x']])), { name: 'crash_x.zip' });
        assert.equal(b.unsafePaths.length, 1);
        assert.ok(b.findings.some((x) => x.key === 'zipslip' && x.level === 'bad'));
        // Still readable: the legitimate entries were not thrown away with the bad one.
        assert.equal(b.meta.version, '1.0.0');
    });

    test('an entry BMM never writes is named in the findings', async () => {
        const b = await analyseBundle(asFile(makeZip([...BUNDLE, ['payload.exe', 'MZ']])), { name: 'crash_x.zip' });
        const hit = b.findings.find((x) => x.key === 'extraentries');
        assert.equal(hit.detail, 'payload.exe');
    });
});

describe('the refusals hold', () => {
    test('too many entries, and nothing was inflated to find out', async () => {
        const many = Array.from({ length: LIMITS.entries + 8 }, (_, i) => [`f${i}.txt`, 'x']);
        const b = await analyseBundle(asFile(makeZip(many)), { name: 'x.zip' });
        assert.equal(b.refused.why, 'entries');
        assert.equal(b.meta, undefined);   // the parse never ran
    });

    test('a compression bomb is refused on its declared ratio', async () => {
        // 8 MB of zeroes deflates to a few kilobytes: the archive is tiny and claims to
        // expand hundreds of times, which is the shape and not the size that matters.
        const bomb = makeZip([['metadata.txt', 'BMM VERSION: 1.0.0\n'], ['bomb.txt', Buffer.alloc(8 * 1024 * 1024, 0x41)]]);
        const b = await analyseBundle(asFile(bomb), { name: 'crash_x.zip' });
        assert.equal(b.refused.why, 'ratio');
        assert.ok(b.refused.got > LIMITS.ratio);
    });

    test('a bundle inside the limits is not refused', async () => {
        const b = await analyseBundle(asFile(makeZip(BUNDLE)), { name: 'crash_x.zip' });
        assert.equal(b.refused, null);
    });
});
