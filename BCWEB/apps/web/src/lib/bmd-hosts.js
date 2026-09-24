// Which hosts a live B.MD block (`:counter`, `::live`, `::chart`, `:action`, `::include`…) may
// fetch from, besides this site (SECURITY_SUMMARY §9, "apiUrl() has no host allowlist").
//
// md-lite.js sets the kit's `policy.allowApiHosts` to [] before anything renders: same origin
// only. The admin's list (Admin > Settings, stored as AdminSetting `bmd.fetchHosts`, served at
// GET /api/site/bmd-hosts) is then fetched ONCE, by the renderer chunk (ui/md.jsx), so a page
// that shows no markdown never asks. Until it has arrived, an external live block draws "—";
// the fetch is a few hundred bytes and usually lands before the renderer chunk does.
//
// The browser checks again: the site CSP's connect-src must name the host too
// (CSP_CONNECT_SRC_EXTRA on the caddy container), which the admin card says.
import { configureMarkdown } from '@bettercommunity/bmd/config';

let pending = null;

/** Put a list in force for every block rendered from now on. */
export function applyBmdHosts(hosts) {
  configureMarkdown({ policy: { allowApiHosts: Array.isArray(hosts) ? hosts.filter((h) => typeof h === 'string') : [] } });
}

/** The stored list, fetched at most once per page load. Never rejects; a failure keeps []. */
export function loadBmdHosts() {
  if (!pending) {
    pending = fetch('/api/site/bmd-hosts', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { const hosts = Array.isArray(v?.hosts) ? v.hosts : []; applyBmdHosts(hosts); return hosts; })
      .catch(() => { pending = null; return []; });
  }
  return pending;
}
