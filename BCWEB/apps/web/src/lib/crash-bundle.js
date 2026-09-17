// A BMM crash bundle, read and explained — in the browser, never anywhere else.
//
// BMM writes one of these every time it dies and every time it exits cleanly
// (src-tauri/src/commands/crash.rs). The zip is flat, deflated, and its entries are always
// the same handful of names:
//
//   metadata.txt            BMM VERSION / TIMESTAMP / REASON, always
//   stacktrace.txt          a `backtrace::Backtrace` debug dump — CRASH BUNDLES ONLY
//   system_info.txt         === SYSTEM DIAGNOSTICS === and === PROCESS INFO === blocks
//   app_logs.txt            `[HH:MM:SS.mmm] message`, the last 500 lines of the session
//   state_snapshot.json     the whole AppData — profiles, mods, settings, plugins
//   frontend_dump.json      the webview's side: reason, logs, ipcCalls, actions, metrics
//   dxdiag.txt              Windows crashes only, raw `dxdiag /t`, often UTF-16LE
//   session_replay.bmmreplay  the rrweb recording of the minutes before it went
//
// WHY THE BROWSER. These bundles hold somebody's home directory, their game library, their
// logged API calls and, now and then, a token that got printed. A tool that uploads one to
// be read is a tool that makes a second copy of a stranger's machine on our disk, and the
// honest sentence in the UI is only true if the code makes it true. So: no upload, no
// server round trip, no library — zip-read.js uses the platform's own DecompressionStream
// and reads the archive's index from its tail without inflating anything.
//
// WHY THE LIMITS. This file is fed by whoever mailed us a report, which means it is fed by
// anybody. The named constants below are the whole defence, and they are deliberately small
// enough to be dull: a real BMM bundle is eight entries and a few megabytes.
import { listZip, readZipEntry, readZipEntryBytes, escapesArchive } from './zip-read.js';

/**
 * The refusals, in one place so the UI can print them as the rules rather than as surprises.
 *
 * `entries` and `totalBytes` are the zip-bomb ceiling: 42.zip is 42 KB and 4.5 PB, and the
 * defence is to read the DECLARED sizes out of the central directory and refuse before
 * inflating a single byte, not to inflate and watch the tab die.
 *
 * `ratio` catches the other shape — few entries, enormous each. A deflate stream of zeroes
 * compresses about 1000:1; a real log file manages 5:1 to 20:1. 200 is far enough above
 * anything BMM writes and far below anything built to hurt.
 */
export const LIMITS = {
    entries: 512,                     // a real bundle has 8
    totalBytes: 64 * 1024 * 1024,     // declared, uncompressed, across the whole archive
    entryBytes: 8 * 1024 * 1024,      // any single entry we will inflate
    ratio: 200,                       // uncompressed ÷ compressed, whole archive
    logTail: 200,                     // log lines kept for display
};

/** Every entry BMM's own writer produces, with what it is for. Anything else is unexpected
 *  and the report says so rather than ignoring it. */
export const KNOWN_ENTRIES = [
    'metadata.txt', 'stacktrace.txt', 'system_info.txt', 'app_logs.txt',
    'state_snapshot.json', 'frontend_dump.json', 'dxdiag.txt', 'session_replay.bmmreplay',
];

/* ── Pure parsers ────────────────────────────────────────────────────────────────────── */

/** `BMM VERSION: 1.0.0` / `TIMESTAMP:   …` / `REASON:      …`, padded by the writer. */
export function parseMetadata(text) {
    const out = { version: '', timestamp: '', reason: '', extra: [] };
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = /^([A-Z][A-Z ]+):\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const k = m[1].trim();
        if (k === 'BMM VERSION') out.version = m[2].trim();
        else if (k === 'TIMESTAMP') out.timestamp = m[2].trim();
        else if (k === 'REASON') out.reason = m[2].trim();
        else out.extra.push([k, m[2].trim()]);
    }
    return out;
}

/** The `=== TITLE ===` blocks of system_info.txt, as sections of key/value rows. */
export function parseSystemInfo(text) {
    const sections = [];
    const flat = {};
    let cur = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const head = /^=+\s*(.+?)\s*=+$/.exec(line);
        if (head) { cur = { title: head[1], rows: [] }; sections.push(cur); continue; }
        const kv = /^(.+?):\s+(.*)$/.exec(line);
        if (!kv) continue;
        if (!cur) { cur = { title: '', rows: [] }; sections.push(cur); }
        cur.rows.push([kv[1].trim(), kv[2].trim()]);
        flat[kv[1].trim()] = kv[2].trim();
    }
    return { sections, flat };
}

/** `32690 MB` / `250000 KB` / `1.5%` / `421s` → a number, or null when it is not one. */
export function numberIn(v) {
    const m = /(-?[\d.]+)/.exec(String(v ?? ''));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/**
 * app_logs.txt as lines.
 *
 * Not every physical line starts with a timestamp: BMM logs JSON payloads that carry their
 * own newlines, so a wrapped continuation is a real and common shape. A continuation is
 * attached to the line above it instead of becoming a timestamp-less orphan.
 */
export function parseLogLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const m = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s?(.*)$/.exec(raw);
        if (m) {
            const rest = m[2];
            const tag = /^\[([A-Z][A-Z0-9_ -]*)\]/.exec(rest);
            out.push({ ts: m[1], tag: tag ? tag[1] : '', text: rest });
        } else if (out.length && raw.length) {
            out[out.length - 1].text += `\n${raw}`;
        } else if (raw.length) {
            out.push({ ts: '', tag: '', text: raw });
        }
    }
    return out;
}

/** dxdiag comes back UTF-16LE often enough that decoding it as UTF-8 produces a column of
 *  nulls and a reviewer concluding the file is corrupt. The BOM decides. */
export function decodeMaybeUtf16(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Things that look like a credential, so the reviewer is told BEFORE they paste the log into
 * a ticket.
 *
 * Deliberately shape-based and deliberately not "fixed": nothing here redacts anything. A
 * tool that silently scrubbed a bundle would be hiding the one thing worth acting on, which
 * is that BMM printed a secret to a file it then mails to us.
 */
const SECRET_PATTERNS = [
    [/\bgh[pousr]_[A-Za-z0-9]{16,}/, 'a GitHub token'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
    [/\bAuthorization:\s*Bearer\s+\S{12,}/i, 'an Authorization header'],
    [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/, 'a JSON Web Token'],
    [/\b(?:api[_-]?key|secret|password)\s*[=:]\s*["']?\S{8,}/i, 'a key, secret or password'],
];

/** `[{ what, sample }]` for a blob of text, at most one hit per pattern. */
export function scanForSecrets(text) {
    const s = String(text || '');
    const out = [];
    for (const [re, what] of SECRET_PATTERNS) {
        const m = re.exec(s);
        if (m) out.push({ what, sample: `${m[0].slice(0, 12)}…` });
    }
    return out;
}

/* ── The findings ────────────────────────────────────────────────────────────────────── */

/**
 * What is wrong, or worth knowing, about a parsed bundle.
 *
 * Pure: it takes the parsed pieces, not the file, so every rule below can be asserted in a
 * test without building a zip. `level` is 'bad' | 'warn' | 'info'; `key` is what the UI
 * translates; `detail` is the raw value, which is never a translated string because it comes
 * out of somebody's machine.
 */
export function bundleFindings(b) {
    const f = [];
    const add = (level, key, detail = '') => f.push({ level, key, detail });

    if (!b.hasMetadata) add('bad', 'nometa');
    if (b.unsafePaths?.length) add('bad', 'zipslip', b.unsafePaths.slice(0, 5).join(', '));

    const reason = b.meta?.reason || '';
    if (b.kind === 'crash' && !b.hasStack) add('warn', 'nostack');
    if (/uncontrolled shutdown|dirty legacy session/i.test(reason)) add('info', 'dirty');
    if (/Clean Exit/i.test(reason)) add('info', 'clean');

    // A crash session's log should not contain a clean shutdown marker, and a clean one
    // should. When they disagree, the zip and the log are telling two different stories and
    // the log is the one that was written at the time.
    if (b.logs?.length) {
        const shutdown = b.logs.some((l) => /\[SHUTDOWN\]/.test(l.text));
        if (b.kind === 'crash' && shutdown) add('warn', 'shutdowninCrash');
        if (b.kind === 'session' && !shutdown) add('warn', 'noshutdownInSession');
        const errs = b.logs.filter((l) => /\b(ERROR|PANIC|FATAL)\b/.test(l.text)).length;
        if (errs) add('warn', 'logerrors', String(errs));
    }

    // Memory. `Free Memory` is reported by the crash writer next to `Total Memory`, both in
    // MB, so the ratio is the one system fact a bundle can actually settle.
    const total = numberIn(b.system?.flat?.['Total Memory']);
    const free = numberIn(b.system?.flat?.['Free Memory']);
    if (total && free != null && free / total < 0.05) add('warn', 'lowmem', `${free} / ${total} MB`);
    const proc = numberIn(b.system?.flat?.['Memory Usage']);              // KB
    if (proc && proc > 2 * 1024 * 1024) add('warn', 'bigproc', `${Math.round(proc / 1024)} MB`);
    const runtime = numberIn(b.system?.flat?.['Process Runtime']);        // seconds
    if (runtime != null && runtime < 20) add('info', 'earlycrash', `${runtime}s`);

    // The settings that were in effect. `last_session_clean: false` means this is at least
    // the second crash in a row, which turns one report into a pattern.
    const st = b.state?.settings;
    if (st && typeof st === 'object') {
        if (st.last_session_clean === false) add('info', 'previouscrash');
        if (st.fs_security_mode && st.fs_security_mode !== 'strict') add('info', 'fsmode', String(st.fs_security_mode));
        if (st.github_token) add('bad', 'tokeninstate');
    }
    if (Array.isArray(b.state?.installed_plugins) && b.state.installed_plugins.length) {
        add('info', 'plugins', String(b.state.installed_plugins.length));
    }
    const perms = b.state?.plugin_permissions;
    if (perms && typeof perms === 'object') {
        const risky = Object.entries(perms)
            .filter(([, v]) => v && typeof v === 'object' && (v.command || v.script))
            .map(([k]) => k);
        if (risky.length) add('warn', 'pluginexec', risky.slice(0, 5).join(', '));
    }

    for (const hit of b.secrets || []) add('bad', 'secret', `${hit.what} (${hit.sample})`);

    const unexpected = (b.entries || []).map((e) => e.name).filter((n) => !KNOWN_ENTRIES.includes(n));
    if (unexpected.length) add('info', 'extraentries', unexpected.slice(0, 6).join(', '));

    return f;
}

/* ── The read ────────────────────────────────────────────────────────────────────────── */

const textOf = async (file, row) => {
    if (!row) return null;
    if (row.size > LIMITS.entryBytes) return { tooBig: true, text: '' };
    const got = await readZipEntry(file, row);
    if (got.binary) return { binary: true, text: '' };
    return got;
};

const jsonOf = async (file, row) => {
    const got = await textOf(file, row);
    if (!got || got.binary || got.tooBig || got.truncated) return null;
    try { return JSON.parse(got.text); } catch { return null; }
};

/**
 * The whole thing: list, refuse, read the known entries, parse, judge.
 *
 * Returns `{ refused }` and nothing else when a limit is hit, so a caller cannot accidentally
 * render half of a hostile archive. Everything else is parsed values — no HTML, no markup, no
 * `dangerouslySetInnerHTML` anywhere downstream: an entry is text and is rendered as text.
 */
export async function analyseBundle(file, { name = '' } = {}) {
    const listing = await listZip(file);
    const rows = listing.entries;

    const declared = rows.reduce((n, r) => n + (r.size || 0), 0);
    const packed = rows.reduce((n, r) => n + (r.compressedSize || 0), 0);
    if (listing.total > LIMITS.entries) {
        return { refused: { why: 'entries', got: listing.total, limit: LIMITS.entries } };
    }
    if (declared > LIMITS.totalBytes) {
        return { refused: { why: 'size', got: declared, limit: LIMITS.totalBytes } };
    }
    // Ratio last: it is the least certain of the three, and saying "too many entries" when
    // that is the real problem is more useful than "suspicious compression".
    if (packed > 4096 && declared / packed > LIMITS.ratio) {
        return { refused: { why: 'ratio', got: Math.round(declared / packed), limit: LIMITS.ratio } };
    }

    const find = (n) => rows.find((r) => r.name.toLowerCase() === n && !escapesArchive(r.name));
    const metaRow = find('metadata.txt');
    const stackRow = find('stacktrace.txt');

    const [metaTxt, stackTxt, sysTxt, logTxt] = await Promise.all([
        textOf(file, metaRow), textOf(file, stackRow),
        textOf(file, find('system_info.txt')), textOf(file, find('app_logs.txt')),
    ]);
    const state = await jsonOf(file, find('state_snapshot.json'));
    const frontend = await jsonOf(file, find('frontend_dump.json'));

    // dxdiag is read as BYTES because it is usually UTF-16LE; readZipEntry would decode it as
    // UTF-8 and hand back a column of replacement characters.
    let dxdiag = null;
    const dxRow = find('dxdiag.txt');
    if (dxRow && dxRow.size <= LIMITS.entryBytes) {
        try { dxdiag = decodeMaybeUtf16(await readZipEntryBytes(file, dxRow)).slice(0, 200_000); }
        catch { dxdiag = null; }
    }

    const meta = parseMetadata(metaTxt?.text || '');
    const system = parseSystemInfo(sysTxt?.text || '');
    const logs = parseLogLines(logTxt?.text || '');
    const replayRow = find('session_replay.bmmreplay');

    const kind = stackRow ? 'crash'
        : /Clean Exit/i.test(meta.reason) ? 'session'
            : /^crash_/i.test(name) ? 'crash'
                : /^session_/i.test(name) ? 'session' : 'unknown';

    const bundle = {
        refused: null,
        name,
        kind,
        entries: rows.map((r) => ({ name: r.name, size: r.size, compressedSize: r.compressedSize, unsafe: r.unsafe })),
        total: listing.total,
        truncated: listing.truncated,
        declaredBytes: declared,
        packedBytes: packed,
        unsafePaths: rows.filter((r) => r.unsafe).map((r) => `${r.name} (${r.unsafe})`),
        hasMetadata: !!metaRow,
        hasStack: !!stackRow,
        hasReplay: !!replayRow,
        replaySize: replayRow?.size || 0,
        meta,
        system,
        logs,
        stack: stackTxt?.text || '',
        stackTooBig: !!stackTxt?.tooBig,
        state,
        frontend,
        dxdiag,
        // The secret scan reads the log and the frontend dump, which is where BMM prints
        // request payloads. The state snapshot is checked by field name instead.
        secrets: scanForSecrets(`${logTxt?.text || ''}\n${frontend ? JSON.stringify(frontend).slice(0, 400_000) : ''}`),
    };
    bundle.findings = bundleFindings(bundle);
    return bundle;
}
