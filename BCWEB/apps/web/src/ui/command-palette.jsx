// Site-wide ⌘K / Ctrl-K command palette.
//
// Docs used to own ⌘K, and only on its own page. This one is global (mounted once in App) and
// searches the WHOLE site: jump to any page, run a quick action, and full-text search the docs.
// It is keyword-aware — each page carries aliases (a concept → the page), so "money"/"prix" finds
// Hosting, "don"/"donation" finds Charity, "dark mode"/"langue" finds Settings — which is the
// "feels semantic" part without a vector index. Ranking is a fuzzy scorer over label + aliases.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, FileText, ArrowRight, Hash, Compass, Zap, Target, Clock } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { useTheme } from './theme.jsx';
import { useAuth } from '../pages/auth.jsx';
import { useCharityEnabled } from '../lib/charity-enabled.js';

// Snapshot the CURRENT view's searchable content — headings, buttons, links, labels, table
// headers, list rows — so ⌘K can find "the thing on this page" and jump to it. Scoped to the
// main content column: the palette overlay and any body-level modal/portal render outside it,
// and the topbar/footer nav are excluded (those are covered by the page directory). Text is
// captured once on open (cheap, bounded) and filtered per keystroke.
function collectPageElements() {
  const root = document.querySelector('main') || document.getElementById('app-main') || document.querySelector('[data-page-root]') || document.body;
  const els = root.querySelectorAll('h1,h2,h3,h4,button,a[href],[role="button"],label,summary,th,[data-cmdk-target]');
  const seen = new Set();
  const out = [];
  for (const el of els) {
    if (el.closest('.cmdk-overlay') || el.closest('nav') || el.closest('header') || el.closest('footer')) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2 || text.length > 90) continue;
    const key = `${el.tagName}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Visible only — a jump to something the user can't see reads as broken.
    if (el.offsetParent === null && el.getClientRects().length === 0) continue;
    out.push({ text, el, tag: el.tagName.toLowerCase() });
    if (out.length >= 400) break;
  }
  return out;
}

// Scroll to and briefly highlight an element the palette matched.
function flashElement(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('cmdk-flash');
  setTimeout(() => el.classList.remove('cmdk-flash'), 1400);
  if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch { /* not focusable */ } }
}

// What you picked last, so an empty palette opens on the four things you actually use rather
// than on an alphabet of every page. Only destinations are remembered — an action carries a
// closure, which does not survive a page load, and a half-restored action is worse than none.
const RECENT_KEY = 'bcw.cmdk.recent';
const RECENT_MAX = 4;
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, RECENT_MAX) : []; }
  catch { return []; }
}
function pushRecent(item) {
  if (!item?.to) return;
  try {
    const next = [{ to: item.to, label: item.label }, ...readRecent().filter((r) => r.to !== item.to)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

// PAGES — every destination, with concept aliases (EN+FR) so a search by intent lands the page.
function pageDefs(t) {
  return [
    ['/', t('nav.home', 'Home'), 'home accueil start landing'],
    ['/catalog', t('nav.catalog', 'Catalog'), 'catalog catalogue mods plugins themes presets browse download parcourir télécharger'],
    ['/submit', t('nav.submit', 'Submit content'), 'submit upload publish share soumettre publier partager envoyer'],
    ['/repos', t('nav.repos', 'Server-Repos'), 'repos server repo hosting dépôt serveur héberger'],
    ['/hosting', t('nav.hosting', 'Hosting'), 'hosting price plan pay storage subscription money hébergement prix plan payer stockage abonnement argent'],
    ['/projects', t('nav.projects', 'Other projects'), 'projects showcase other autres projets vitrine'],
    ['/blog', t('nav.blog', 'Blog'), 'blog news posts articles actualités nouvelles'],
    ['/docs', t('nav.docs', 'Documentation'), 'docs documentation guide help manual aide manuel'],
    ['/faq', t('nav.faq', 'FAQ'), 'faq questions help answers aide réponses'],
    ['/charity', t('ch.title', 'Community Charity'), 'charity donation money give association vote cagnotte don solidaire association reverser'],
    ['/polls', t('nav.polls', 'Polls'), 'polls vote survey sondage voter'],
    ['/users', t('nav.users', 'Members'), 'users members people community membres utilisateurs communauté'],
    ['/profile', t('nav.profile', 'My profile'), 'profile account me compte profil moi'],
    ['/settings', t('nav.settings', 'Settings'), 'settings preferences theme dark mode language réglages paramètres thème sombre langue préférences'],
    ['/notifications', t('nav.notifications', 'Notifications'), 'notifications alerts alertes'],
    ['/contact', t('nav.contact', 'Contact'), 'contact support help aide'],
    ['/status', t('nav.status', 'Status'), 'status uptime incidents statut disponibilité'],
    ['/dev', t('nav.dev', 'Developers'), 'dev developers api développeurs'],
    ['/myo', t('nav.myo', 'Make your own'), 'myo commission custom build made to order sur mesure commande création'],
    ['/2fa', t('nav.twofa', '2FA authenticator'), '2fa two factor authenticator totp code sécurité authentification'],
  ].map(([to, label, kw]) => ({ kind: 'page', to, label, kw: `${label} ${kw}`.toLowerCase() }));
}

// Fuzzy score: substring > word-start subsequence > loose subsequence. 0 = no match.
function score(q, text) {
  if (!q) return 0.001;
  const i = text.indexOf(q);
  if (i === 0) return 1000;
  if (i > 0) return 700 - i + (text[i - 1] === ' ' ? 200 : 0);
  // subsequence
  let ti = 0, hits = 0, wordStart = 0, prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    for (let j = ti; j < text.length; j++) { if (text[j] === c) { found = j; break; } }
    if (found === -1) return 0;
    hits++;
    if (found === 0 || text[found - 1] === ' ') wordStart++;
    if (found === prev + 1) hits++;
    prev = found; ti = found + 1;
  }
  return 200 + hits * 6 + wordStart * 20;
}

export default function CommandPalette() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const theme = useTheme();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState([]);
  const [pageEls, setPageEls] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => { if (open) { setQ(''); setActive(0); setDocs([]); setPageEls(collectPageElements()); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  // Live docs full-text (the same endpoint the docs page uses), debounced.
  useEffect(() => {
    if (!open || q.trim().length < 2) { setDocs([]); return undefined; }
    const id = setTimeout(() => {
      api.get(`/docs/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setDocs((r.results || []).slice(0, 6)))
        .catch(() => setDocs([]));
    }, 160);
    return () => clearTimeout(id);
  }, [q, open]);

  const user = auth?.user;
  const isStaff = user && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(user.role);
  const actions = useMemo(() => {
    const list = [
      { kind: 'action', label: t('cmdk.switchLang', 'Switch language'), kw: `${t('cmdk.switchLang', 'switch language')} langue lang traduction english français`.toLowerCase(),
        run: () => setLang(lang === 'fr' ? 'en' : 'fr') },
      { kind: 'action', label: t('cmdk.theme', 'Toggle dark / light theme'), kw: 'theme dark light mode toggle thème sombre clair mode'.toLowerCase(),
        run: () => theme?.toggle?.() },
      { kind: 'action', label: t('cmdk.copyLink', 'Copy link to this page'), kw: 'copy link url share copier lien url partager'.toLowerCase(),
        run: () => { try { navigator.clipboard?.writeText(location.href); } catch { /* denied */ } } },
      { kind: 'action', label: t('cmdk.top', 'Scroll to top'), kw: 'scroll top haut début'.toLowerCase(),
        run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
      { kind: 'action', label: t('cmdk.kofi', 'Support on Ko-fi'), kw: 'kofi support donate tip soutenir don'.toLowerCase(),
        run: () => window.open('https://ko-fi.com/bettercommunity', '_blank', 'noreferrer') },
    ];
    if (user) {
      list.push({ kind: 'action', label: t('cmdk.dashboard', 'My dashboard'), kw: 'dashboard billing account tableau de bord compte facturation'.toLowerCase(), run: () => nav('/dashboard') });
      list.push({ kind: 'action', label: t('cmdk.redeem', 'Redeem a promo code'), kw: 'promo code redeem coupon gift code promo cadeau'.toLowerCase(), run: () => nav('/dashboard?tab=billing#redeem') });
      list.push({ kind: 'action', label: t('cmdk.logout', 'Sign out'), kw: 'logout sign out disconnect déconnexion se déconnecter quitter'.toLowerCase(), run: () => auth?.logout?.() });
    }
    if (isStaff) list.push({ kind: 'action', label: t('cmdk.admin', 'Admin dashboard'), kw: 'admin back office moderation administration'.toLowerCase(), run: () => nav('/admin') });
    return list;
  }, [t, lang, setLang, theme, auth, user, isStaff, nav]);

  // Re-read on open, not once at mount: the list changes as you use the palette, and a stale
  // copy would show you what you picked two sessions ago.
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { if (open) setRecent(readRecent()); }, [open]);
  // Community Charity is an admin switch; off, /charity says "not running" and the entry
  // here would lead there. Hidden until the probe says the programme is on.
  const charityOn = useCharityEnabled();

  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    const pages = pageDefs(t).filter((pg) => pg.to !== '/charity' || charityOn === true);
    const scored = (arr) => arr.map((x) => ({ ...x, s: score(n, x.kw || x.label.toLowerCase()) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const p = scored(pages);
    const a = scored(actions);
    const d = docs.map((r) => ({
      kind: 'doc', label: r.title, section: r.section, to: `/docs/${r.slug}${r.anchor ? `#${r.anchor}` : ''}`, s: 1,
    }));
    // Content of the page you're ON — the most contextual result, so it leads when querying.
    const onpage = n ? pageEls.map((x) => ({ kind: 'onpage', label: x.text, el: x.el, s: score(n, x.text.toLowerCase()) }))
      .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 6) : [];
    // Docs are capped like everything else. Uncapped, a broad word ("hosting") returned every
    // matching heading in the manual and pushed the actions off the bottom of the list — the
    // palette answered a question nobody asked and hid the one they did.
    // No query → what you used last, then the directory + actions. Query → on-page first
    // (the most contextual answer), then pages, docs, actions.
    const out = n
      ? [...onpage, ...p.slice(0, 6), ...d.slice(0, 6), ...a.slice(0, 5)]
      : [...recent.map((r) => ({ kind: 'recent', label: r.label, to: r.to, s: 1 })),
         ...pages.map((x) => ({ ...x, s: 1 })), ...actions];
    return out;
  }, [q, docs, actions, pageEls, recent, t, charityOn]);

  useEffect(() => { setActive(0); }, [q, docs]);
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = useCallback((it) => {
    if (!it) return;
    setOpen(false);
    pushRecent(it);
    if (it.kind === 'action') it.run?.();
    else if (it.kind === 'onpage') { setTimeout(() => flashElement(it.el), 30); }
    else if (it.to) nav(it.to);
  }, [nav]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  };

  if (!open) return null;
  const icon = (k) => k === 'doc' ? <FileText size={15} /> : k === 'action' ? <Zap size={15} /> : k === 'onpage' ? <Target size={15} /> : k === 'recent' ? <Clock size={15} /> : <Compass size={15} />;
  const kindLabel = (k) => k === 'doc' ? t('cmdk.doc', 'Docs') : k === 'action' ? t('cmdk.action', 'Action')
    : k === 'onpage' ? t('cmdk.onpage', 'On this page') : k === 'recent' ? t('cmdk.recent', 'Recent') : t('cmdk.page', 'Page');
  return (
    <div className="cmdk-overlay fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true"
      style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-xl rounded-2xl border border-[var(--line-strong)] overflow-hidden anim-fade"
        style={{ background: 'var(--bg-solid)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)' }}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--line)]">
          <Search size={17} className="text-[var(--faint)] shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder={t('cmdk.placeholder', 'Search pages, actions, docs…')}
            className="flex-1 bg-transparent outline-none text-[15px] text-[var(--text)] placeholder:text-[var(--faint)]" />
          <kbd className="text-[10px] text-[var(--faint)] border border-[var(--line)] rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[54vh] overflow-auto py-1.5">
          {/* "No matches" alone leaves the typed text on screen with nothing to do about it.
              The list is empty because THIS query excluded everything, so say which query and
              put the way back to the full list one press away. No Card here on purpose: the
              palette is a popup on --bg-solid, and a Card surface can be translucent. */}
          {items.length === 0 && (
            <div className="px-4 py-8 text-center">
              <div className="text-sm font-semibold break-words">{t('cmdk.none', 'No match for “{q}”').replace('{q}', q)}</div>
              <div className="text-[12.5px] text-[var(--muted)] mt-1 mx-auto max-w-sm">{t('cmdk.none.s', 'This searches page names, their keywords and the manual. Fewer words usually find more.')}</div>
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => setQ('')} className="btn btn-primary btn-sm">{t('cmdk.none.a', 'Clear the search')}</button>
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <div key={`${it.kind}:${it.to || it.label}:${i}`}>
            {/* A header when the kind changes. The rows carried only a small icon and a right-
                hand tag, so a mixed list read as one undifferentiated column — you could not see
                where "things on this page" ended and "the manual" began. */}
            {(i === 0 || items[i - 1].kind !== it.kind) && (
              <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{kindLabel(it.kind)}</div>
            )}
            <button data-active={i === active ? '1' : '0'}
              onMouseEnter={() => setActive(i)} onClick={() => run(it)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${i === active ? 'bg-[var(--surface-2)]' : ''}`}>
              <span className="text-[var(--accent-ink)] shrink-0">{icon(it.kind)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-[var(--text)] truncate" title={it.label}>{it.label}</span>
                {it.kind === 'doc' && it.section && <span className="block text-[11px] text-[var(--faint)] truncate flex items-center gap-1"><Hash size={10} /> {it.section}</span>}
              </span>
              {i === active && <CornerDownLeft size={13} className="text-[var(--faint)] shrink-0" />}
            </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[var(--line)] text-[10px] text-[var(--faint)] flex items-center gap-3">
          <span className="flex items-center gap-1"><ArrowRight size={10} className="rotate-90" />/<ArrowRight size={10} className="-rotate-90" /> {t('cmdk.navigate', 'navigate')}</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={10} /> {t('cmdk.open', 'open')}</span>
        </div>
      </div>
    </div>
  );
}
