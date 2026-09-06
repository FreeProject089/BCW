// Does every link in this document go somewhere?
//
// A page is written once and read for years, and the links are the part that ages: a heading
// gets renamed and the `#anchor` under it points at nothing, a page moves and the `/docs/old`
// path 404s, an `http://` survives a site's move to TLS. None of it errors — a dead link is not
// a syntax error anywhere — so the only way to know is to look, and this looks.
//
// Pure: a string in, a list of issues out. An editor shows them beside the text; a build
// step fails on them; a CI job prints them. What is checked is what can be checked without a
// network: anchors against the document's own headings, internal paths against the page map
// the host supplies, and the shapes that are wrong on their face.
import { extractHeadings, extractLinks } from './ast.js';
import { safeUrl } from './url.js';
import { slugify } from './directives.js';

/**
 * @param {string} md
 * @param {object} [opt]
 * @param {object} [opt.pageMap]     `{ '/docs/x': { title } }` — every internal path that exists.
 *                                   Without it, internal paths are not judged.
 * @param {string[]} [opt.anchors]   extra ids that exist on the page (e.g. from a layout)
 * @param {object} [opt.policy]      the URL policy — `safeUrl`'s
 * @param {boolean} [opt.warnHttp]   flag plain `http://` links (default true)
 * @returns {{ ok: boolean, issues: Array<{ level: 'error'|'warning', code: string, href: string, text: string, line?: number, hint: string }> , count: number }}
 */
export function validateLinks(md, opt = {}) {
  const issues = [];
  const headings = new Set([...extractHeadings(md, opt).map((h) => h.id), ...(opt.anchors || []).map((a) => String(a).replace(/^#/, ''))]);
  const links = extractLinks(md, opt);
  const pages = opt.pageMap ? new Set(Object.keys(opt.pageMap).map((k) => k.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/')) : null;
  const push = (level, code, l, hint) => issues.push({ level, code, href: l.href, text: l.text, line: l.line, hint });
  for (const l of links) {
    const href = String(l.href || '').trim();
    if (!href) { push('error', 'empty', l, 'The link has no destination.'); continue; }
    if (href.startsWith('#')) {
      const id = href.slice(1);
      if (!id) { push('warning', 'empty-anchor', l, 'A bare “#” goes to the top of the page.'); continue; }
      if (!headings.has(id) && !headings.has(slugify(id))) push('error', 'missing-anchor', l, `No heading on this page has the id “${id}”.`);
      continue;
    }
    if (href.startsWith('//')) { push('error', 'protocol-relative', l, 'Starts with “//” — the renderer refuses it. Write the full https:// URL.'); continue; }
    if (/^javascript:|^data:|^vbscript:/i.test(href)) { push('error', 'unsafe-protocol', l, 'This protocol is stripped by the sanitiser.'); continue; }
    const r = safeUrl(href, { kind: l.kind === 'image' ? 'media' : 'link', policy: opt.policy });
    if (!r.ok) { push('error', `refused-${r.reason || 'url'}`, l, 'The URL policy refuses this destination.'); continue; }
    if (/^http:\/\//i.test(href) && opt.warnHttp !== false) push('warning', 'insecure', l, 'Plain http:// — most sites answer on https:// now.');
    if (href.startsWith('/') && pages) {
      const [path, hash] = href.split('#');
      const clean = path.replace(/[?].*$/, '').replace(/\/+$/, '') || '/';
      if (!pages.has(clean)) push('error', 'missing-page', l, `“${clean}” is not a known page.`);
      else if (hash && opt.pageMap[clean]?.anchors && !opt.pageMap[clean].anchors.includes(hash)) push('warning', 'missing-anchor', l, `“${clean}” has no “#${hash}” section (as far as the page map knows).`);
    }
    if (/\s/.test(href)) push('warning', 'whitespace', l, 'The URL contains whitespace — it is probably broken.');
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues, count: links.length };
}
