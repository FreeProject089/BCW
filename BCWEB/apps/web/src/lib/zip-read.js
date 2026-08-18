// Reading a ZIP without loading it.
//
// The inspector used to base64 the whole archive into a JSON body: a 32 MB body limit, an
// 8 MB guard in the UI, and the entire file re-uploaded every time a reviewer clicked a
// second entry. A `.DATABMM` — BMM's "everything I have" export — carries session
// recordings and crash reports and is routinely hundreds of megabytes, so the one file a
// moderator most needs to look inside was the one file the tool refused.
//
// So it is read where it already is. A ZIP's index lives at the END of the file, which means
// listing it costs two small reads no matter how big the archive is:
//
//   · the last 64 KB, to find the end-of-central-directory record;
//   · the central directory itself, which is names and sizes and nothing else.
//
// Nothing is decompressed to list. One entry is decompressed when somebody opens it, through
// the platform's own `DecompressionStream` — no library, and no second copy of the archive.
//
// This also makes the tool's central promise literally true rather than nearly true: the
// archive is never uploaded, so a server that inspects untrusted content cannot be turned
// into a server that stores it.

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;

/** How much of one entry is decoded as text. A moderator reading a 30 MB minified bundle in
 *  a browser panel is nobody's intention; the head of it plus a note is. */
export const TEXT_MAX = 256 * 1024;

/** How many entries are listed. An archive with 40 000 files is a signal in itself, and the
 *  real count is reported even when the list is cut. */
export const LIST_MAX = 2000;

const dv = (buf) => new DataView(buf);

async function slice(file, start, end) {
    const from = Math.max(0, start);
    return new Uint8Array(await file.slice(from, end).arrayBuffer());
}

/**
 * A path that escapes the archive.
 *
 * Checked on the RAW name, before anything normalises it. Same three cases the server's
 * reader reports, and for the same reason: a zip-slip entry is the single most interesting
 * thing a reviewer can be told about, and quietly fixing it hides it.
 */
export function escapesArchive(name) {
    const n = String(name).replace(/\\/g, '/');
    if (n.startsWith('/')) return 'absolute path';
    if (/^[A-Za-z]:/.test(n)) return 'drive letter';
    if (n.split('/').includes('..')) return 'climbs out with ..';
    return null;
}

/** Where the central directory starts, and how many entries it holds. Handles ZIP64, which
 *  is not an edge case here: an archive over 4 GB, or with over 65535 entries, is exactly
 *  the archive somebody cannot open by hand. */
async function findDirectory(file) {
    const tailLen = Math.min(file.size, 65557 + 64);
    const tail = await slice(file, file.size - tailLen, file.size);
    const view = dv(tail.buffer);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip archive');

    let entries = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);
    let cdSize = view.getUint32(eocd + 12, true);

    // ZIP64: the 32-bit fields are saturated and the real ones live in a second record.
    if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
        const loc = eocd - 20;
        if (loc >= 0 && view.getUint32(loc, true) === EOCD64_LOC_SIG) {
            const at = Number(view.getBigUint64(loc + 8, true));
            const rec = await slice(file, at, at + 56);
            const rv = dv(rec.buffer);
            if (rv.getUint32(0, true) === EOCD64_SIG) {
                entries = Number(rv.getBigUint64(32, true));
                cdSize = Number(rv.getBigUint64(40, true));
                cdOffset = Number(rv.getBigUint64(48, true));
            }
        }
    }
    return { entries, cdOffset, cdSize };
}

/** The 64-bit values, when the 32-bit ones are saturated. Order is fixed by the spec and the
 *  fields are only present when their 32-bit counterpart said 0xFFFFFFFF. */
function zip64Extra(extra, need) {
    const view = dv(extra.buffer, extra.byteOffset, extra.byteLength);
    let p = 0;
    while (p + 4 <= extra.length) {
        const id = view.getUint16(p, true);
        const size = view.getUint16(p + 2, true);
        if (id === 0x0001) {
            let q = p + 4;
            const out = {};
            for (const field of need) {
                if (q + 8 > p + 4 + size) break;
                out[field] = Number(view.getBigUint64(q, true));
                q += 8;
            }
            return out;
        }
        p += 4 + size;
    }
    return {};
}

/**
 * The archive as a list: names, sizes, and what looks readable.
 *
 * `text` here is decided by EXTENSION, not by bytes — reading 512 bytes of every entry would
 * mean thousands of ranged reads to draw a list. When an entry is actually opened the bytes
 * decide, and they overrule this. The listing says so rather than pretending.
 */
export async function listZip(file) {
    const { entries, cdOffset, cdSize } = await findDirectory(file);
    const cd = await slice(file, cdOffset, cdOffset + cdSize);
    const view = dv(cd.buffer);
    const dec = new TextDecoder('utf-8');

    const rows = [];
    let p = 0;
    let total = 0;
    while (p + 46 <= cd.length && view.getUint32(p, true) === CEN_SIG) {
        const rec = p;
        const method = view.getUint16(p + 10, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));

        let compressedSize = view.getUint32(p + 20, true);
        let size = view.getUint32(p + 24, true);
        let localOffset = view.getUint32(p + 42, true);
        if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
            const need = [];
            if (size === 0xffffffff) need.push('size');
            if (compressedSize === 0xffffffff) need.push('compressedSize');
            if (localOffset === 0xffffffff) need.push('localOffset');
            const got = zip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), need);
            if (got.size !== undefined) size = got.size;
            if (got.compressedSize !== undefined) compressedSize = got.compressedSize;
            if (got.localOffset !== undefined) localOffset = got.localOffset;
        }

        p = rec + 46 + nameLen + extraLen + commentLen;
        // A directory entry is a name ending in '/' with no content. Listing them adds rows
        // nobody can open.
        if (name.endsWith('/')) continue;
        total++;
        if (rows.length >= LIST_MAX) continue;
        rows.push({
            name,
            size,
            compressedSize,
            method,
            localOffset,
            text: looksTextualByName(name),
            unsafe: escapesArchive(name),
        });
    }

    return {
        total: total || entries,
        listed: rows.length,
        truncated: total > rows.length,
        bytes: rows.reduce((n, r) => n + r.size, 0),
        entries: rows,
        // Surfaced at the top rather than left for somebody to spot in a list of 300 rows.
        warnings: rows.filter((r) => r.unsafe).map((r) => `${r.name} — ${r.unsafe}`),
    };
}

const TEXT_EXT = new Set([
    'json', 'js', 'mjs', 'cjs', 'ts', 'txt', 'md', 'css', 'html', 'htm', 'xml', 'yml', 'yaml',
    'toml', 'ini', 'cfg', 'conf', 'csv', 'svg', 'lua', 'py', 'sh', 'bat', 'ps1', 'rs', 'log',
    'bmmpa', 'bmmreplay', 'mm',
]);

function looksTextualByName(name) {
    return TEXT_EXT.has(String(name).split('.').pop()?.toLowerCase() || '');
}

async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * One entry's bytes, decompressed on its own.
 *
 * Reads the local header to find where the data starts — the central directory records the
 * header's offset, and the header's own name/extra lengths are the only thing that says how
 * far past it the bytes begin. They differ from the central copy often enough that trusting
 * the central lengths reads garbage.
 */
export async function readZipEntryBytes(file, row) {
    const head = await slice(file, row.localOffset, row.localOffset + 30);
    const hv = dv(head.buffer);
    const nameLen = hv.getUint16(26, true);
    const extraLen = hv.getUint16(28, true);
    const start = row.localOffset + 30 + nameLen + extraLen;
    const raw = await slice(file, start, start + row.compressedSize);
    if (row.method === 0) return raw;
    if (row.method === 8) return inflateRaw(raw);
    throw new Error(`compression method ${row.method} is not supported`);
}

/**
 * One entry, as text, bounded — or the fact that it is not text.
 *
 * The BYTES decide, overruling the extension the listing guessed from: an `.exe` renamed to
 * `.txt` is precisely the entry worth catching, and rendering it as mojibake would call it a
 * text file.
 */
export async function readZipEntry(file, row) {
    // A refusal that names the size, rather than a tab that hangs: past this, decompressing
    // costs more memory than looking at it can be worth.
    if (row.size > 64 * 1024 * 1024) {
        return { binary: false, size: row.size, tooBig: true, truncated: true, text: '' };
    }
    const bytes = await readZipEntryBytes(file, row);
    const head = bytes.subarray(0, Math.min(bytes.length, 512));
    for (const b of head) {
        if (b === 0) return { binary: true, size: bytes.length };
    }
    const cut = bytes.subarray(0, TEXT_MAX);
    return {
        binary: false,
        size: bytes.length,
        truncated: bytes.length > TEXT_MAX,
        text: new TextDecoder('utf-8').decode(cut),
    };
}
