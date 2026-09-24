// The site's link policy for studio actions (PLAN-STUDIO-2026 decision D7, phase 5), read once.
//
// Which hosts a studio block's `external` step may open: `{ mode: 'block' | 'allow', hosts }`,
// an admin setting served by GET /api/site/studio-links. The rule itself (hostAllowed,
// normalizeLinkPolicy) is the studio package's, the one the API saves under; this only fetches
// the value, once per page load, and shares it between every canvas on the page.
//
// Until it has arrived the default applies (every https host), which is also what the API
// uses when nothing is stored. The "you are leaving" screen asks again (`loadStudioLinks`)
// before it offers to continue, so a host an admin blocked cannot be opened through the gap.
import { useEffect, useState } from 'react';
import { normalizeLinkPolicy, DEFAULT_LINK_POLICY } from './canvas.js';

let cached = null;
let pending = null;

/** The policy, fetched at most once. Never rejects: a failed read answers the default. */
export function loadStudioLinks() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/api/site/studio-links', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { cached = normalizeLinkPolicy(v || DEFAULT_LINK_POLICY); return cached; })
      .catch(() => { pending = null; return normalizeLinkPolicy(DEFAULT_LINK_POLICY); });
  }
  return pending;
}

/** After the admin saved a new policy: this tab uses it at once. */
export function setStudioLinks(value) { cached = normalizeLinkPolicy(value); pending = null; }

/** The policy, for a component: the default first, the stored one once it is known. */
export function useStudioLinks() {
  const [policy, setPolicy] = useState(() => cached || normalizeLinkPolicy(DEFAULT_LINK_POLICY));
  useEffect(() => {
    let alive = true;
    loadStudioLinks().then((v) => { if (alive) setPolicy(v); });
    return () => { alive = false; };
  }, []);
  return policy;
}
