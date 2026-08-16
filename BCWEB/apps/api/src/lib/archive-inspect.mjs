// Looking inside a submitted archive, without running any of it.
//
// The inspector read pasted JSON and, for a `.bmmplug` or `.bmmtheme`, told the moderator to
// go and extract it themselves and paste the file from inside. That is the moment the review
// stops: a person deciding whether to publish somebody's plugin is not going to unzip it, find
// the manifest, paste it, then repeat for the four other files they cannot see.
//
// So the archive is listed here, entry by entry, and any entry can be opened. The rules are
// the ones the JSON reader already obeys, made explicit because an archive is a far better
// place to hide something:
//
//   · nothing is executed, ever;
//   · nothing is written to disk — entries are read from the buffer in memory;
//   · a path that climbs out of the archive (`../`, an absolute path, a Windows drive) is
//     REPORTED, not silently normalised. A zip-slip entry is the single most interesting
//     thing a reviewer can be told about, and quietly fixing it hides it;
//   · what is shown is bounded, because a 400 MB entry is not a thing to render.

/** Bytes of a single entry we will hand back as text. Past this the reviewer gets the head of
 *  it and a note — a moderator reading a 30 MB minified bundle in a browser panel is nobody's
 *  intention. */
export const TEXT_MAX = 256 * 1024;

/** How many entries are listed. A zip with 40 000 files is a signal in itself, and the count
 *  is reported even when the list is cut. */
export const LIST_MAX = 2000;

const TEXT_EXT = new Set([
    'json', 'js', 'mjs', 'cjs', 'ts', 'txt', 'md', 'css', 'html', 'htm', 'xml', 'yml', 'yaml',
    'toml', 'ini', 'cfg', 'conf', 'csv', 'svg', 'lua', 'py', 'sh', 'bat', 'ps1', 'rs',
]);

const ext = (p) => String(p).split('.').pop()?.toLowerCase() || '';

/** Is this entry something a person can read? The bytes decide; the extension is only a hint
 *  for the cases the bytes cannot settle. */
export function looksTextual(name, data) {
    // The BYTES decide first. An extension is a claim made by whoever built the archive, and
    // an .exe renamed to .txt is precisely the entry worth catching — trusting the name here
    // would render it as mojibake in a review panel and call it a text file.
    const head = data.subarray(0, Math.min(data.length, 512));
    for (const b of head) if (b === 0) return false;   // a NUL in the first half-kilobyte
    // No NUL in the first half-kilobyte: readable. The extension list is what makes that
    // decision cheap for the common cases, and is deliberately not the last word.
    return true;
}

/**
 * A path that escapes the archive.
 *
 * Checked on the RAW name, before anything normalises it: `../../etc/passwd`, `/etc/passwd`
 * and `C:\Windows\…` are all things an entry has no business being called, and each one is
 * worth showing a reviewer.
 */
export function escapesArchive(name) {
    const n = String(name).replace(/\\/g, '/');
    if (n.startsWith('/')) return 'absolute path';
    if (/^[A-Za-z]:/.test(n)) return 'drive letter';
    if (n.split('/').includes('..')) return 'climbs out with ..';
    return null;
}

/**
 * The archive as a list.
 *
 * `entries` come from zipReadAll as [{ name, data }]. Returns what the panel needs to draw a
 * tree and nothing it does not: no bytes travel here, only their sizes.
 */
export function listArchive(entries) {
    const all = Array.isArray(entries) ? entries : [];
    const rows = all.slice(0, LIST_MAX).map((e) => {
        const name = String(e?.name || '');
        const data = e?.data || Buffer.alloc(0);
        return {
            name,
            size: data.length,
            text: looksTextual(name, data),
            // Named `unsafe` rather than `error`: the entry is real and the reviewer is being
            // shown what it is, not stopped.
            unsafe: escapesArchive(name),
        };
    });
    const suspicious = rows.filter((r) => r.unsafe);
    return {
        total: all.length,
        listed: rows.length,
        truncated: all.length > rows.length,
        bytes: all.reduce((n, e) => n + (e?.data?.length || 0), 0),
        entries: rows,
        // Surfaced at the top rather than left for somebody to spot in a list of 300 rows.
        warnings: suspicious.map((r) => `${r.name} — ${r.unsafe}`),
    };
}

/** One entry, as text, bounded. Returns `{ text, truncated, size }` or null when it is not
 *  something to show as text. */
export function readEntry(entries, name) {
    const hit = (entries || []).find((e) => String(e?.name) === String(name));
    if (!hit) return null;
    const data = hit.data || Buffer.alloc(0);
    if (!looksTextual(hit.name, data)) return { binary: true, size: data.length };
    const slice = data.subarray(0, TEXT_MAX);
    return {
        binary: false,
        size: data.length,
        truncated: data.length > TEXT_MAX,
        text: slice.toString('utf8'),
    };
}
