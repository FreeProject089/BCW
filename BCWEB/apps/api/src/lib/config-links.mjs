// Links inside a page config: no `javascript:` (or `vbscript:`) anywhere a link lives.
//
// A project page's config is free-form (`z.record(z.any())`): the editor writes legal cards,
// download buttons, social links, a community button, milestone links… and the public page puts
// each of them straight into an `<a href>` (pages/project.jsx). React 18 renders a javascript:
// href with a console warning and nothing more, and this site's CSP allows inline script, so the
// browser does not stop it either (see httpUrl in lib.mjs for the same class, Sept 9).
//
// Until per-project grants existed, only an admin wrote a config. Now the `pages` right on ONE
// project — given to somebody who is not staff — writes it, and a legal card whose url is
// `javascript:fetch('/api/admin/…',{method:'POST',…})` runs, on the site's origin, with the
// session of every visitor who clicks "Privacy policy" — an admin included (pentest round 2, R10).
//
// Checked where the config is SAVED, not where it is drawn: the page has twenty href sinks and a
// config reaches the public through the GET, the versions, the schedule and the showcase copy.
//
// WHICH STRINGS. Only values that are links: a key named `url` / `href` / `link` / `…Url` /
// `…Href` / `…Link`, and every value under a `links` object. Prose may begin with "Note:" and is
// none of this function's business; a URL key may legitimately hold `https:`, `mailto:`,
// `steam:`, a relative path or a `data:image` preview, so the rule is a DENY list of the schemes
// that run code on click, matched the way the browser's URL parser reads a scheme: leading C0
// controls and spaces dropped, tabs and newlines removed anywhere, case folded.
// `java\tscript:` and ` JavaScript:` are both refused.

const LINK_KEY = /^(url|href|link)s?$|(Url|Href|Link|URL)s?$/;
const DANGEROUS = ['javascript:', 'vbscript:'];

/** Does this string, read as a URL by a browser, run script when followed? */
export function isScriptUrl(v) {
  if (typeof v !== 'string') return false;
  // eslint-disable-next-line no-control-regex
  const norm = v.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '').toLowerCase();
  return DANGEROUS.some((s) => norm.startsWith(s));
}

/**
 * Every link in `config` that would run script, as `[{ path, reason }]` (empty = clean).
 * Walks the whole document; `depth` caps a hostile nesting.
 */
export function configLinkProblems(config) {
  const out = [];
  const walk = (v, path, isLink, depth) => {
    if (depth > 40 || out.length >= 20) return;
    if (typeof v === 'string') { if (isLink && isScriptUrl(v)) out.push({ path: path || '(root)', reason: 'script_url' }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, isLink, depth + 1)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        // The studio pages have their own checker (lib/studio-doc.mjs refuses a script href as
        // `unsafe_url`, with its own rule for values already stored, and guardStudioContent puts
        // them back for a caller without the studio right). Judging them here as well would
        // refuse a save for pages that are about to be discarded, in the wrong error shape.
        if (k === 'canvases') continue;
        // Under `links` (or any link key), every value is a link whatever its own key.
        walk(x, path ? `${path}.${k}` : k, isLink || LINK_KEY.test(k), depth + 1);
      }
    }
  };
  walk(config, '', false, 0);
  return out;
}

/** The 400 body, in the shape the studio's document errors use. */
export const configLinkError = (problems) => ({ error: 'unsafe_link', problems });
