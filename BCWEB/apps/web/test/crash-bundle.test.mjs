// The crash-bundle reader, against the exact bytes BMM writes.
//
// Every fixture below is copied from the writer in BMM's own
// `src-tauri/src/commands/crash.rs` rather than invented — including the column padding in
// metadata.txt, which a `split(':')` parser gets wrong in a way that looks fine (` 1.0.0`
// with a leading space reads identically in a browser and never matches a version filter).
//
// The findings are asserted as rules, not as a golden blob: each test names the one thing it
// is about, so a rule that stops firing is reported by name.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseMetadata, parseSystemInfo, parseLogLines, numberIn,
    decodeMaybeUtf16, scanForSecrets, bundleFindings, LIMITS,
} from '../src/lib/crash-bundle.js';

const META = [
    'BMM VERSION: 1.0.0',
    'TIMESTAMP:   2026-03-14T01:29:06.563+01:00',
    'REASON:      Manual Debug Trigger / Frontend Crash',
    '',
].join('\n');

const SYS = [
    '=== SYSTEM DIAGNOSTICS ===',
    'OS Name:         Windows',
    'OS Version:      11',
    'Kernel Version:  26200',
    'Total Memory:    32690 MB',
    'Free Memory:     12345 MB',
    'CPU Count:       16',
    '',
    '=== PROCESS INFO ===',
    'Memory Usage:    250000 KB',
    'CPU Usage:       1.5%',
    'Process Runtime: 421s',
].join('\n');

const LOG = [
    '--- NEW SESSION STARTED AT 2026-03-14T01:29:06.563466800+01:00 (PID: 13816) ---',
    '[01:29:06.899] [STARTUP] BMM v0.9.6 initialized.',
    '[01:29:06.901] [STARTUP-INFO] Profile Count: 2',
    '[01:29:07.041] [UI] [INFO] [BMM] Invoke: get_available_languages {',
    '  "a": 1',
    '}',
    '[01:29:35.280] [UI] Navigated to view: profiles',
].join('\n');

describe('metadata.txt', () => {
    test('the padded columns are read, without the padding', () => {
        const m = parseMetadata(META);
        assert.equal(m.version, '1.0.0');
        assert.equal(m.reason, 'Manual Debug Trigger / Frontend Crash');
        assert.match(m.timestamp, /^2026-03-14T01:29:06/);
    });

    test('a timestamp keeps its own colons', () => {
        // The failure this exists for: splitting on the first ':' and taking [1] gives
        // "2026-03-14T01" and a bundle that appears to be from a different day.
        assert.equal(parseMetadata(META).timestamp.includes('+01:00'), true);
    });

    test('an empty file is an empty answer, not a throw', () => {
        assert.deepEqual(parseMetadata('').version, '');
    });
});

describe('system_info.txt', () => {
    const s = parseSystemInfo(SYS);

    test('both blocks come back as sections', () => {
        assert.deepEqual(s.sections.map((x) => x.title), ['SYSTEM DIAGNOSTICS', 'PROCESS INFO']);
    });

    test('the values are flattened for the rules to read', () => {
        assert.equal(s.flat['Total Memory'], '32690 MB');
        assert.equal(s.flat['CPU Usage'], '1.5%');
    });

    test('a unit is not a number', () => {
        assert.equal(numberIn('32690 MB'), 32690);
        assert.equal(numberIn('1.5%'), 1.5);
        assert.equal(numberIn('421s'), 421);
        assert.equal(numberIn('n/a'), null);
    });
});

describe('app_logs.txt', () => {
    const lines = parseLogLines(LOG);

    test('the session header survives as its own line', () => {
        assert.match(lines[0].text, /NEW SESSION STARTED/);
    });

    test('the bracketed subsystem is picked out of the message', () => {
        assert.equal(lines[1].tag, 'STARTUP');
        assert.equal(lines[1].ts, '01:29:06.899');
    });

    test('a wrapped JSON payload stays attached to its own line', () => {
        // BMM logs payloads containing newlines, so a physical line that does not start with
        // a timestamp is normal. Counted as lines of their own they become orphans with no
        // time, which is how a tail of "the last 30 lines" ends up showing three.
        const invoke = lines.find((l) => /get_available_languages/.test(l.text));
        assert.match(invoke.text, /"a": 1/);
        assert.equal(lines.filter((l) => l.ts === '').length, 1); // only the session header
    });
});

describe('dxdiag, which is usually UTF-16', () => {
    test('a UTF-16LE BOM is decoded as UTF-16, not as nulls', () => {
        const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
        assert.equal(decodeMaybeUtf16(bytes), 'Hi');
    });

    test('plain UTF-8 is left alone', () => {
        assert.equal(decodeMaybeUtf16(new TextEncoder().encode('Hi')), 'Hi');
    });
});

describe('credentials printed into a log', () => {
    test('a GitHub token is reported, and only a prefix of it is quoted back', () => {
        const hits = scanForSecrets('[01:02:03.000] [BC] using ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789');
        assert.equal(hits.length, 1);
        assert.match(hits[0].what, /GitHub/);
        assert.ok(hits[0].sample.length < 20, hits[0].sample);
    });

    test('an ordinary log line is not a credential', () => {
        assert.deepEqual(scanForSecrets('[01:02:03.000] [UI] Navigated to view: profiles'), []);
    });
});

describe('the findings', () => {
    const base = {
        hasMetadata: true, hasStack: true, kind: 'crash',
        meta: parseMetadata(META), system: parseSystemInfo(SYS),
        logs: parseLogLines(LOG), entries: [], state: null, secrets: [],
    };
    const keys = (b) => bundleFindings(b).map((x) => x.key);

    test('a crash bundle with no stacktrace.txt is called out', () => {
        assert.ok(!keys(base).includes('nostack'));
        assert.ok(keys({ ...base, hasStack: false }).includes('nostack'));
    });

    test('a crash whose log says it shut down cleanly is a contradiction worth naming', () => {
        const logs = [...base.logs, { ts: '01:30:00.000', tag: 'SHUTDOWN', text: '[SHUTDOWN] bye' }];
        assert.ok(keys({ ...base, logs }).includes('shutdowninCrash'));
    });

    test('a machine nearly out of memory', () => {
        const system = parseSystemInfo(SYS.replace('Free Memory:     12345 MB', 'Free Memory:     900 MB'));
        assert.ok(keys({ ...base, system }).includes('lowmem'));
        assert.ok(!keys(base).includes('lowmem'));
    });

    test('a token sitting in the settings snapshot is a bad finding, not a note', () => {
        const f = bundleFindings({ ...base, state: { settings: { github_token: 'ghp_x' } } });
        const hit = f.find((x) => x.key === 'tokeninstate');
        assert.equal(hit.level, 'bad');
    });

    test('the previous session having crashed too is carried through', () => {
        assert.ok(keys({ ...base, state: { settings: { last_session_clean: false } } }).includes('previouscrash'));
    });

    test('a plugin allowed to run programs is a warning', () => {
        const state = { plugin_permissions: { 'some.plugin': { script: true }, quiet: { delete: true } } };
        const hit = bundleFindings({ ...base, state }).find((x) => x.key === 'pluginexec');
        assert.equal(hit.detail, 'some.plugin');
    });

    test('an entry BMM never writes is reported rather than ignored', () => {
        const entries = [{ name: 'metadata.txt' }, { name: 'payload.exe' }];
        const hit = bundleFindings({ ...base, entries }).find((x) => x.key === 'extraentries');
        assert.equal(hit.detail, 'payload.exe');
    });

    test('a path that climbs out of the archive is the worst thing in the list', () => {
        const f = bundleFindings({ ...base, unsafePaths: ['../evil (climbs out with ..)'] });
        assert.equal(f.find((x) => x.key === 'zipslip').level, 'bad');
    });
});

describe('the limits are the ones the UI promises', () => {
    test('they are small, named, and not zero', () => {
        assert.equal(LIMITS.entries, 512);
        assert.equal(LIMITS.totalBytes, 64 * 1024 * 1024);
        assert.equal(LIMITS.entryBytes, 8 * 1024 * 1024);
        assert.ok(LIMITS.ratio > 1 && LIMITS.ratio < 1000);
    });
});
