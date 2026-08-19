// Blocking a URL or a domain from being listed again.
//
// The Terms promise this, in the section about listings that point somewhere else: when a
// listing is only a LINK, removing it is most of what we can do, and the rest is stopping the
// same address from being posted straight back. That promise was written before the mechanism
// existed. This is the mechanism.
//
// The matching is deliberately dull, because a clever matcher that is wrong is worse than a
// blunt one that is predictable — somebody has to be able to look at a rule and say what it
// will and will not catch.
//
//   scope 'url'     the exact address, after normalisation. Path and query count.
//   scope 'domain'  that host AND everything under it. Blocking `example.com` catches
//                   `cdn.example.com`; it does NOT catch `notexample.com`, which is the
//                   suffix bug every naive implementation of this ships with.
//
// What it deliberately does NOT do: regex, wildcards, or substring matching. A rights holder
// notice names an address, and the answer to "why was my link refused" must be a rule you can
// read, not a pattern you must simulate.

/** The host of a URL, lowercased, without a leading `www.` and without the port.
 *  Returns '' for anything unparseable — a string that is not a URL cannot be blocked as
 *  one, and pretending otherwise would let a malformed entry match everything. */
export function hostOf(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    // A bare `example.com/x` is what people paste; URL() needs a scheme to see a host at all.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u;
    try { u = new URL(withScheme); } catch { return ''; }
    // Only web addresses. A `javascript:` or `data:` listing is a different problem and must
    // not be silently treated as a host of ''.
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
}

/** A URL reduced to what two people would agree is "the same address": lowercase scheme and
 *  host, no `www.`, no default port, no trailing slash, no fragment.
 *
 *  The query string is KEPT. On this platform a query string is frequently the whole
 *  identity of a download (`?file=`, `?id=`, a share key), so dropping it would make one
 *  block rule silently cover a hundred unrelated files. */
export function normalizeUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u;
    try { u = new URL(withScheme); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')))
        ? `:${u.port}` : '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${host}${port}${path}${u.search}`;
}

/** Does `host` fall under `domain` — itself, or a subdomain of it?
 *
 *  The dot is the whole point. `endsWith('example.com')` also matches `notexample.com`, which
 *  blocks a stranger's site because somebody reported a lookalike. */
export function hostUnder(host, domain) {
    const h = String(host || '').toLowerCase();
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    if (!h || !d) return false;
    return h === d || h.endsWith(`.${d}`);
}

/**
 * The first rule that catches any of `urls`, or null.
 *
 * Takes the rules as an argument rather than reading the database, so the decision can be
 * tested without one — the same reason announce-route.mjs was pulled out of its posting loop.
 *
 * @param rules [{ id, scope: 'url'|'domain', pattern }]
 * @param urls  strings; nullish and non-http entries are skipped rather than treated as ''
 * @returns {{rule: object, url: string}|null} which rule, and which of the URLs tripped it
 */
export function findBlock(rules, urls) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => typeof u === 'string' && u.trim());
    if (!list.length || !rules?.length) return null;
    for (const url of list) {
        const norm = normalizeUrl(url);
        const host = hostOf(url);
        if (!norm && !host) continue;   // not a web address; nothing here can match it
        for (const rule of rules) {
            if (rule.scope === 'domain') {
                if (hostUnder(host, rule.pattern)) return { rule, url };
            } else if (norm && normalizeUrl(rule.pattern) === norm) {
                return { rule, url };
            }
        }
    }
    return null;
}

/** Every URL worth checking on a catalog item's meta blob. Kept here rather than at each
 *  call site so a new URL-bearing field is added in ONE place — three call sites each
 *  reaching into `meta` by hand is how one of them ends up checking two fields out of three. */
export function urlsOfMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return [m.download_url, m.downloadUrl, m.icon_url, m.iconUrl, m.thumb, m.source_url, m.sourceUrl]
        .filter((u) => typeof u === 'string' && u.trim());
}
