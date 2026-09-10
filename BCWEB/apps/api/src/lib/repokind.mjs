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
 *
 * SCANNED, not matched. The obvious regexes for this are quadratic on hostile input and this
 * body comes from a URL somebody registered: `/<pre[^>]*>[\s\S]{0,50000}?<a\s+href=/` spent
 * 1.7 seconds on 200 KB of `<pre>` spam, and `/<(?:title|h1)[^>]*>\s*Index of\s/` spent 3.2 on
 * unclosed tags — once per health check, on every listed repo, forever. indexOf does not
 * backtrack, and the work here is bounded by a fixed number of candidate positions.
 */
export function looksLikeDirectoryIndex(html) {
  const s = String(html || '');
  if (!s || s.length > 4_000_000) return false;
  const head = s.slice(0, 200_000);
  const low = head.toLowerCase();

  // The heading nginx, Apache, Caddy and Python's http.server all write. Found by locating the
  // phrase first — there are few of those — and then looking BACK a little for the tag, rather
  // than scanning forward from every tag for the phrase.
  let titled = false;
  for (let i = low.indexOf('index of'); i !== -1 && !titled; i = low.indexOf('index of', i + 1)) {
    const before = low.slice(Math.max(0, i - 200), i);
    const tag = Math.max(before.lastIndexOf('<title'), before.lastIndexOf('<h1'));
    // The tag has to be open right before the phrase: `>` between them means the phrase is in
    // some other element that merely follows one.
    titled = tag !== -1 && before.indexOf('>', tag) !== -1 && !before.slice(before.indexOf('>', tag) + 1).trim();
  }

  // Or a run of links inside a <pre>. At most five candidate blocks, each searched over a fixed
  // window, so the cost is bounded whatever the document does.
  let pre = false;
  let from = 0;
  for (let n = 0; n < 5 && !pre; n++) {
    const open = low.indexOf('<pre', from);
    if (open === -1) break;
    const gt = low.indexOf('>', open);
    if (gt === -1) break;
    pre = low.indexOf('<a href=', gt) !== -1 && low.indexOf('<a href=', gt) < gt + 50_000;
    from = gt + 1;
  }
  if (!titled && !pre) return false;

  // At least two entries, so a page with one stray link in a <pre> is not a repo.
  let links = 0;
  for (let i = low.indexOf('<a href'); i !== -1 && links < 2; i = low.indexOf('<a href', i + 1)) links++;
  return links >= 2;
}

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
