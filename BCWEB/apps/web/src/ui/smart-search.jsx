// agent-bcw-nav: Laya in the search bars, web side. See lib/smart-search-core.js for the rules.
//
// useSmartSearch asks POST /search/smart once the typing settles, only when the site says the
// feature is on (GET /site/features → search), and never blocks anything: while it thinks,
// and whenever it fails, the page shows its own results in its own order. A 429 quiets it for
// the time the server asked.
//
// <SmartSearchHint> is the one line under a search box: "Looking for mods? Search the catalog"
// when the query seems to belong elsewhere, and a small mark when Laya reordered the results,
// with a way back to the plain order.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { shouldAsk, intentLink } from '../lib/smart-search-core.js';
import { openPalette } from './palette-recent.js';

let siteProbe = null;
let siteState = null; // { ai, anon } once known
function probeSite() {
  if (!siteProbe) {
    siteProbe = api.get('/site/features')
      .then((d) => { siteState = { ai: !!d?.search?.ai, anon: !!d?.search?.anon }; })
      .catch(() => { siteState = { ai: false, anon: false }; })
      .then(() => siteState);
    // Asked again after five minutes, so a long-open tab follows the admin's switch.
    setTimeout(() => { siteProbe = null; }, 5 * 60_000);
  }
  return siteProbe;
}

let quietUntil = 0;

/**
 * @param q           the query as typed
 * @param scope       global | catalog | repos | blog | docs
 * @param candidates  [{ id, title }] the page's first results (toCandidates), or []
 * @param enabled     false to switch it off for this box
 * @returns { intent: {id,p}|null, order: [ids]|null, busy }
 */
export function useSmartSearch({ q, scope = 'global', candidates = [], enabled = true, delay = 450 }) {
  const { user } = useAuth() || {};
  const [site, setSite] = useState(siteState);
  const [res, setRes] = useState({ intent: null, order: null, busy: false });
  const seq = useRef(0);
  const candKey = candidates.map((c) => `${c.id}\u0002${c.title}`).join('\u0001');
  useEffect(() => { if (!site) probeSite().then(setSite); }, [site]);
  useEffect(() => {
    const my = ++seq.current;
    setRes((r) => (r.intent || r.order ? { intent: null, order: null, busy: false } : r));
    if (!enabled || !shouldAsk({ q, site, signedIn: !!user }) || Date.now() < quietUntil) return undefined;
    const id = setTimeout(() => {
      setRes((r) => ({ ...r, busy: true }));
      api.post('/search/smart', { q: String(q).trim(), scope, candidates })
        .then((d) => { if (seq.current === my) setRes({ intent: d?.ai ? d.intent || null : null, order: d?.ai ? d.order || null : null, busy: false }); })
        .catch((e) => {
          const retry = Number(e?.data?.retryAfterSec);
          if (e?.status === 429 && retry > 0) quietUntil = Date.now() + Math.min(retry, 600) * 1000;
          if (seq.current === my) setRes({ intent: null, order: null, busy: false });
        });
    }, delay);
    return () => clearTimeout(id);
    // candKey stands for `candidates` (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, candKey, enabled, site, !!user, delay]);
  return res;
}

const INTENT_LABEL = {
  catalog: ['ss.i.catalog', 'Looking for mods, plugins or themes?', 'ss.go.catalog', 'Search the catalog'],
  repos: ['ss.i.repos', 'Looking for a server repo?', 'ss.go.repos', 'Search the repos'],
  blog: ['ss.i.blog', 'Looking for news?', 'ss.go.blog', 'Open the blog'],
  docs: ['ss.i.docs', 'Looking for help?', 'ss.go.docs', 'Search the docs'],
  projects: ['ss.i.projects', 'Looking for a project?', 'ss.go.projects', 'See the projects'],
  account: ['ss.i.account', 'Looking for your account?', 'ss.go.account', 'Open the settings'],
  people: ['ss.i.people', 'Looking for someone?', 'ss.go.people', 'Find people'],
};

/**
 * The hint line. `here` is the scope the box already searches (no "search the catalog" on the
 * catalog). `reordered` + `onPlain` show the mark and the way back to the plain order.
 */
export function SmartSearchHint({ intent, q, here, reordered = false, onPlain, onGo, onDocs, className = '' }) {
  const { t } = useI18n();
  const show = intent && intent.id !== here && INTENT_LABEL[intent.id];
  if (!show && !reordered) return null;
  const L = show ? INTENT_LABEL[intent.id] : null;
  const to = show ? intentLink(intent.id, q) : null;
  const linkCls = 'inline-flex items-center gap-1 font-medium text-[var(--accent-ink)] hover:underline';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)] ${className}`} aria-live="polite">
      <Sparkles size={12} className="text-[var(--accent-ink)] shrink-0" aria-hidden />
      {show && (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {t(L[0], L[1])}
          {to
            ? <Link to={to} onClick={onGo} className={linkCls}>{t(L[2], L[3])} <ArrowRight size={11} aria-hidden /></Link>
            : <button type="button" onClick={() => { if (onDocs) { onDocs(); return; } onGo?.(); openPalette({ scope: 'docs' }); }} className={linkCls}>{t(L[2], L[3])} <ArrowRight size={11} aria-hidden /></button>}
        </span>
      )}
      {reordered && (
        <span className="inline-flex items-center gap-1.5">
          {t('ss.sorted', 'Best matches first, sorted by Laya.')}
          {onPlain && <button type="button" className="underline hover:text-[var(--text)]" onClick={onPlain}>{t('ss.plain', 'Plain order')}</button>}
        </span>
      )}
    </div>
  );
}

export default useSmartSearch;
