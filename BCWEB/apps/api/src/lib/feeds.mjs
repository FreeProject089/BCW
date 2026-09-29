// notify (agent-notify): RSS 2.0 and Atom 1.0, written by hand.
//
// Small enough not to need a dependency, and the one thing that has to be right is escaping:
// every string here came from somebody (a notification body, a blog title, an announcement), and
// a feed reader parses it as XML. So every text node and attribute goes through xmlText(), which
// escapes the five XML specials AND drops the characters XML 1.0 forbids outright (C0 controls
// other than tab/newline/return, lone surrogates, U+FFFE/U+FFFF): one of those is not a display
// glitch, it makes the whole document invalid and a strict reader shows nothing at all.
import crypto from 'node:crypto';

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlText(v) {
  return String(v ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 date, what RSS 2.0 wants in pubDate / lastBuildDate. */
export const rfc822 = (d) => new Date(d).toUTCString();
/** RFC 3339, what Atom wants. */
export const rfc3339 = (d) => new Date(d).toISOString();

/** Only an absolute http(s) URL may be a feed link. Anything else becomes the fallback. */
export function feedLink(url, fallback) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch { /* fall through */ }
  return fallback;
}

/**
 * @param {object} ch   { title, link, description, selfUrl, lang }
 * @param {Array} items { id, title, link, description, date, category }
 */
export function buildRss(ch, items) {
  const newest = items.length ? items[0].date : new Date();
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${xmlText(ch.title)}</title>`,
    `<link>${xmlText(ch.link)}</link>`,
    `<description>${xmlText(ch.description)}</description>`,
    `<language>${xmlText(ch.lang || 'en')}</language>`,
    `<lastBuildDate>${rfc822(newest)}</lastBuildDate>`,
    ch.selfUrl ? `<atom:link href="${xmlText(ch.selfUrl)}" rel="self" type="application/rss+xml"/>` : '',
    '<ttl>15</ttl>',
  ];
  for (const it of items) {
    out.push(
      '<item>',
      `<title>${xmlText(it.title)}</title>`,
      `<link>${xmlText(it.link)}</link>`,
      `<guid isPermaLink="false">${xmlText(it.id)}</guid>`,
      `<pubDate>${rfc822(it.date)}</pubDate>`,
      it.description ? `<description>${xmlText(it.description)}</description>` : '',
      it.category ? `<category>${xmlText(it.category)}</category>` : '',
      '</item>',
    );
  }
  out.push('</channel>', '</rss>');
  return out.filter(Boolean).join('\n') + '\n';
}

export function buildAtom(ch, items) {
  const newest = items.length ? items[0].date : new Date();
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xmlText(ch.lang || 'en')}">`,
    `<title>${xmlText(ch.title)}</title>`,
    `<subtitle>${xmlText(ch.description)}</subtitle>`,
    `<id>${xmlText(ch.id || ch.link)}</id>`,
    `<updated>${rfc3339(newest)}</updated>`,
    `<link href="${xmlText(ch.link)}"/>`,
    ch.selfUrl ? `<link rel="self" type="application/atom+xml" href="${xmlText(ch.selfUrl)}"/>` : '',
    `<author><name>${xmlText(ch.author || 'BetterCommunity')}</name></author>`,
  ];
  for (const it of items) {
    out.push(
      '<entry>',
      `<title>${xmlText(it.title)}</title>`,
      `<id>urn:bettercommunity:${xmlText(it.id)}</id>`,
      `<updated>${rfc3339(it.date)}</updated>`,
      `<link href="${xmlText(it.link)}"/>`,
      it.description ? `<summary>${xmlText(it.description)}</summary>` : '',
      it.category ? `<category term="${xmlText(it.category)}"/>` : '',
      '</entry>',
    );
  }
  out.push('</feed>');
  return out.filter(Boolean).join('\n') + '\n';
}

/** A strong ETag over the bytes, quoted. sha256 rather than the cache's blake3: this must work
 *  with or without the native addon, and a feed is small. */
export const etagOf = (text) => `"${crypto.createHash('sha256').update(text).digest('base64url').slice(0, 27)}"`;

/** Answer If-None-Match with a 304 when it matches. Returns true when it did. */
export function notModified(req, reply, etag) {
  reply.header('ETag', etag);
  const inm = String(req.headers['if-none-match'] || '');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    reply.code(304).send();
    return true;
  }
  return false;
}
// fin notify (agent-notify)
