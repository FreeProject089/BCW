// agent-bcw-nav: the pure half of Laya in the search bars (the hook is ui/smart-search.jsx,
// the server is POST /search/smart in apps/api/src/routes/search-ai.mjs).
//
// The page's own search always answers first. These helpers only decide whether to ask the AI,
// and apply what it said to a list the page already has: the AI can reorder the first few
// results and suggest where to look, never add or remove a result.

/** Should this query be sent? Site switch on, signed in or allowed signed out, long enough. */
export function shouldAsk({ q, site, signedIn }) {
  if (!site || !site.ai) return false;
  if (!signedIn && !site.anon) return false;
  const n = String(q || '').trim();
  return n.length >= 3 && n.length <= 200;
}

/** The first `max` items as { id, title } for the server. */
export function toCandidates(list, idOf, titleOf, max = 8) {
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    const id = String(idOf(it) ?? '');
    const title = String(titleOf(it) ?? '').trim();
    if (id && title) out.push({ id, title: title.slice(0, 160) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * `list` with its first items in `order` (ids), the rest untouched after them. An order that
 * names an id the list does not hold is ignored for that id; an order computed for a different
 * list (the results changed while the AI was thinking) changes nothing, because it is only
 * applied when its ids are exactly the list's first ids.
 */
export function applyOrder(list, idOf, order) {
  if (!Array.isArray(list) || !Array.isArray(order) || order.length < 2) return list;
  const head = list.slice(0, order.length);
  const ids = head.map((x) => String(idOf(x)));
  const same = ids.length === order.length && [...ids].sort().join('\u0001') === [...order].map(String).sort().join('\u0001');
  if (!same) return list;
  const byId = new Map(head.map((x) => [String(idOf(x)), x]));
  return [...order.map((id) => byId.get(String(id))), ...list.slice(order.length)];
}

/** Where an intent sends the searcher, with the query carried over when the page takes one. */
export function intentLink(intent, q) {
  const enc = encodeURIComponent(String(q || '').trim());
  switch (intent) {
    case 'catalog': return `/catalog?q=${enc}`;
    case 'repos': return `/repos?q=${enc}`;
    case 'blog': return '/blog';
    case 'docs': return null; // the docs search is the palette, opened narrowed (the hint does it)
    case 'projects': return '/projects';
    case 'account': return '/settings';
    case 'people': return `/users?q=${enc}`;
    default: return null;
  }
}
