// Every URL B.MD puts on a page goes through here, once.
//
// The sanitiser already refuses `javascript:` and `data:` on `href` and `src`, and that is
// necessary and not sufficient. Three things it does not do:
//
//   · `//evil.com` has no colon before its first slash, so it is not a protocol — it is a
//     "relative" URL to hast-util-sanitize, and a protocol-relative one to a browser. A
//     `:button[Docs]{href=//evil.com}` reads as an internal link in the source and leaves the
//     site when clicked.
//   · A directive's href is built into `hProperties` by the parser. It reaches the sanitiser,
//     so it IS checked — but only for protocol. Nothing decided whether an author may point a
//     download button at a host you have never heard of.
//   · `<a target="_blank">` without `rel` hands the opened page a `window.opener` back to
//     yours. Every generated anchor here sets `rel`, and a hand-written one in raw HTML did
//     not.
//
// So: one function, one policy, and a host that wants a stricter one sets it in config.js
// rather than editing the parser.

/** Schemes that may appear before a colon. Everything else is refused, including `data:`. */
const SAFE_PROTOCOL = /^(https?|mailto|tel|xmpp|irc|ircs):/i;

/**
 * Characters that end the "scheme" part of a URL.
 *
 * A colon AFTER any of these is not a scheme — `/a:b`, `?x=a:b`, `#a:b` are all paths. This
 * is the same rule hast-util-sanitize uses, restated because the answer has to agree with it.
 */
const SCHEME_END = /[/?#]/;

/** Control characters a browser strips before parsing, which is how `java\nscript:` works. */
const STRIP = /[\x00-\x1f\x7f\s]/g;

/**
 * Is this a URL we are willing to emit, and in what form?
 *
 * @param {string} raw            what the author wrote
 * @param {object} [opt]
 * @param {'link'|'media'|'download'} [opt.kind]  what it is for
 * @param {object} [opt.policy]   { allowHosts, allowProtocols, rewrite } — see config.js
 * @returns {{ ok: boolean, href: string, external: boolean, reason?: string }}
 */
export function safeUrl(raw, opt = {}) {
  const kind = opt.kind || 'link';
  const policy = opt.policy || {};
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, href: '', external: false, reason: 'empty' };

  // Whitespace and control characters removed BEFORE the scheme is read. A browser does the
  // same, which is why `java\tscript:alert(1)` is a working javascript: URL and looks like
  // nothing of the sort in a schema that matches on the raw string.
  const url = input.replace(STRIP, '');

  // A fragment or a query on their own stay on the page.
  if (url.startsWith('#') || url.startsWith('?')) return { ok: true, href: url, external: false };

  // Protocol-relative. Refused rather than repaired: `//evil.com` in a document is either a
  // mistake or a trick, and turning it into `https://evil.com` would be helping with both.
  // A browser reads `\` as `/` in an http(s) URL, so `/\evil.com`, `\\evil.com` and `\/evil.com`
  // are all `//evil.com`. Judged on the slash-normalised copy: the raw one has no `//` and used
  // to be classed as a same-origin path, with no rel, no target and no `allowHosts` check
  // (pentest R2, Sept 24 2026; the studio's safeLink refuses the same spellings).
  if (url.replace(/\\/g, '/').startsWith('//')) return { ok: false, href: '', external: true, reason: 'protocol_relative' };

  // A same-origin path. The only shape that is internal by construction.
  if (url.startsWith('/')) return { ok: true, href: url, external: false };

  const colon = url.indexOf(':');
  const slash = url.search(SCHEME_END);
  const hasScheme = colon > -1 && (slash === -1 || colon < slash);

  if (!hasScheme) {
    // A relative path (`guide.md`, `./x`). Internal, and left exactly as written — resolving
    // it here would need to know where the document lives, which this file does not.
    return { ok: true, href: url, external: false };
  }

  const allowed = policy.allowProtocols || SAFE_PROTOCOL;
  const okProtocol = allowed instanceof RegExp ? allowed.test(url)
    : Array.isArray(allowed) ? allowed.some((p) => url.toLowerCase().startsWith(`${p}:`))
      : SAFE_PROTOCOL.test(url);
  if (!okProtocol) return { ok: false, href: '', external: true, reason: 'protocol' };

  // mailto:/tel:/xmpp: have no host to check and are not "external" in the sense that
  // matters here (nothing is opened in a tab).
  if (!/^https?:/i.test(url)) return { ok: true, href: url, external: false };

  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, href: '', external: true, reason: 'unparseable' }; }

  // An allowlist, when the host set one. `example.com` covers `www.example.com` and any other
  // subdomain — a list that made you write every subdomain would be a list nobody keeps.
  const list = kind === 'download' ? (policy.allowDownloadHosts || policy.allowHosts) : policy.allowHosts;
  if (Array.isArray(list) && list.length) {
    const ok = list.some((h) => {
      const want = String(h).toLowerCase().replace(/^\./, '');
      return host === want || host.endsWith(`.${want}`);
    });
    if (!ok) return { ok: false, href: '', external: true, reason: 'host' };
  }

  const href = typeof policy.rewrite === 'function' ? String(policy.rewrite(url, { kind, host }) || url) : url;
  return { ok: true, href, external: true };
}

/**
 * The attributes an anchor needs, given where it points.
 *
 * `noopener` is spelled out beside `noreferrer` even though every browser that supports the
 * second implies the first: the pair is what a reader of this code can check, and one of them
 * has a longer history of being the one that is missing.
 */
export function linkAttrs(url, opt = {}) {
  const r = safeUrl(url, opt);
  if (!r.ok) return null;
  return r.external
    ? { href: r.href, target: '_blank', rel: 'noopener noreferrer' }
    : { href: r.href };
}
