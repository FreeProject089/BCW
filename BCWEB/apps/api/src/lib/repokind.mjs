// What did that URL actually give us?
//
// An external repo is a URL, and until now only ONE answer at that URL counted: a current-format
// repo.json. Anything else came back `valid: false`, which for a listed repo means never
// verified, which means never in the public list.
//
// That quietly excluded the most common way people already publish files — a plain web server
// with directory listing on. BMM has been able to consume one of those from the beginning (it
// walks the listing, and uses the size and date on each row to skip re-hashing unchanged
// files); the platform simply had no vocabulary for it, so anyone who pointed at one got a
// listing that never went public and no explanation.
//
// Two kinds now, and the difference matters to a reader rather than to us: a MANIFEST is a repo
// that describes itself, a LISTING is a directory somebody has to walk. Both are servable, both
// are verifiable, and neither is guessed — each is recognised by something only it has.

/** A current-format BMM manifest. Kept as the one definition, imported by both callers. */
export function looksLikeManifest(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const str = (v) => typeof v === 'string' && v.length > 0;
  return str(parsed.name) && str(parsed.version) && str(parsed.game_name) && str(parsed.created_at)
    && Array.isArray(parsed.profiles);
}

/**
 * Is this HTML a directory index a client could walk?
 *
 * Deliberately narrow. "Contains links" describes every page on the web, and accepting that
 * would mark somebody's homepage as a valid repo — which is worse than refusing it, because a
 * verified listing is a public claim that the thing works.
 *
 * What a directory index has and a normal page does not: a run of links inside a <pre> block,
 * or the `Index of /…` heading every autoindex implementation writes. Both are required to be
 * near the start, since a page that mentions "Index of" in its footer is not one.
 */
export function looksLikeDirectoryIndex(html) {
  const s = String(html || '');
  if (!s || s.length > 4_000_000) return false;
  const head = s.slice(0, 200_000);
  // NOTE the quantifier: {0,50000}, not {0,50_000}. A numeric separator is fine in JS source
  // and is NOT one inside a regex literal -- there it is the literal text "{0,50_000}", so the
  // pattern silently stops being a quantifier and matches nothing. It read as correct, the
  // nginx case still passed (on the title), and only a mutation test showed the branch was
  // never reached.
  // nginx, Apache, Caddy and Python's http.server all write one of these two.
  const titled = /<(?:title|h1)[^>]*>\s*Index of\s/i.test(head);
  const pre = /<pre[^>]*>[\s\S]{0,50000}?<a\s+href=/i.test(head);
  if (!titled && !pre) return false;
  // At least two entries, so a page with one stray link in a <pre> is not a repo.
  const links = (head.match(/<a\s+href=/gi) || []).length;
  return links >= 2;
}

/**
 * Classify what came back from an external repo URL.
 *
 * Returns `{ kind, valid, reason }` where kind is 'manifest' | 'listing' | 'unknown'. The
 * caller decides what to do with it; this only says what it is, so the same answer is available
 * to the health check, the admin view and anything written later.
 */
export function classifyRepoBody(text, contentType = '') {
  const body = String(text || '');
  if (!body.trim()) return { kind: 'unknown', valid: false, reason: 'empty' };
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  if (parsed !== null) {
    return looksLikeManifest(parsed)
      ? { kind: 'manifest', valid: true }
      : { kind: 'unknown', valid: false, reason: 'outdated_format' };
  }
  // Not JSON. A directory index is the other thing a client knows how to read.
  if (looksLikeDirectoryIndex(body)) return { kind: 'listing', valid: true };
  // Content type is a hint, never the decision: a server that says text/html over a manifest,
  // or application/json over a 404 page, is common enough that trusting it would misclassify
  // both. Reported so the panel can say something more useful than "not a manifest".
  return { kind: 'unknown', valid: false, reason: /json/i.test(contentType) ? 'bad_json' : 'not_a_manifest' };
}
