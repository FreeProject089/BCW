// Site-wide ⌘K / Ctrl-K command palette. THE palette: there is no other one.
//
// Docs used to own ⌘K, and only on its own page; then this global one arrived and the docs
// page kept a second, smaller palette behind its search button. That one rendered INSIDE
// <main> (a `relative z-10` stacking context), so its overlay could never climb above the
// sticky topbar (z-40) whatever z-index it asked for, and it behaved differently from this
// one. It is gone. The docs page now opens this palette narrowed to the docs (scope 'docs'),
// and on /docs a plain ⌘K puts the documentation results first.
//
// Rendered through a portal on <body>, at z 200: above the topbar, modals (z 50), toasts and
// menus, and never trapped by an ancestor's stacking context again.
//
// The matching lives in ./palette-search.js — read the header there for what "semantic" means
// here and why it is not a substring filter. This file is the shell around it, and its job is
// to make sure the expensive parts happen at the right MOMENT:
//
//   · the command list is built once per (language, who is signed in), in a module cache that
//     survives closing and reopening the palette — opening it no longer rebuilds anything;
//   · the index is built once from that list, not per keystroke;
//   · the query is passed through useDeferredValue, so React renders the keystroke first and
//     the (now much bigger) result list at lower priority — typing cannot block;
//   · the rendered list is capped, because nobody scrolls past the eighth row of a palette.
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, CornerDownLeft, FileText, Hash, Compass, Zap, Target, Clock, X, BookOpen } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { canAdmin } from '../lib/roles.js';
import { useTheme } from './theme.jsx';
import { useAuth } from '../pages/auth.jsx';
import { useCharityEnabled } from '../lib/charity-enabled.js';
import { buildIndex, searchIndex } from './palette-search.js';
import { readRecent, pushRecent, onOpenPalette, readDocRecent, pushDocRecent, clearDocRecent } from './palette-recent.js';
import { useShortcutHints, useTouchOnly, Keys } from './shortcuts.jsx';
import { paletteCombo } from '../lib/shortcuts.js';
import './command-palette.css';

// Snapshot the CURRENT view's searchable content — headings, buttons, links, labels, table
// headers, list rows — so ⌘K can find "the thing on this page" and jump to it. Scoped to the
// main content column: the palette overlay and any body-level modal/portal render outside it,
// and the topbar/footer nav are excluded (those are covered by the page directory). Text is
// captured once on open (cheap, bounded) and searched per keystroke through the same index.
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
    out.push({ id: `el:${key}`, kind: 'onpage', title: text, el, tag: el.tagName.toLowerCase() });
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

// PAGES — every destination, with concept synonyms (EN+FR) so a search by intent lands the
// page. These are deliberately the words somebody would SAY, not the words on the button:
// "money", "combien ça coûte", "annuler", "facture". A word here is the difference between
// the palette answering and the palette shrugging.
function pageDefs(t) {
  return [
    ['/', t('nav.home', 'Home'), 'home accueil start landing main index depart'],
    ['/catalog', t('nav.catalog', 'Catalog'), 'catalog catalogue mods plugins themes presets browse download install find get parcourir telecharger installer chercher trouver contenu'],
    ['/submit', t('nav.submit', 'Submit content'), 'submit upload publish share send my mod release soumettre publier partager envoyer televerser mettre en ligne'],
    ['/repos', t('nav.repos', 'Server-Repos'), 'repos server repo hosting mirror url depot serveur heberger lien'],
    ['/hosting', t('nav.hosting', 'Hosting'), 'hosting price pricing plan pay cost bill invoice storage quota subscription cancel renew money how much hebergement prix tarif plan payer cout facture stockage abonnement annuler resilier renouveler argent combien'],
    ['/projects', t('nav.projects', 'Other projects'), 'projects showcase other apps software autres projets vitrine logiciels applications'],
    ['/blog', t('nav.blog', 'Blog'), 'blog news posts articles updates changelog actualites nouvelles journal quoi de neuf'],
    ['/docs', t('nav.docs', 'Documentation'), 'docs documentation guide help manual how to tutorial aide manuel comment faire tutoriel'],
    ['/faq', t('nav.faq', 'FAQ'), 'faq questions help answers common aide reponses questions frequentes'],
    ['/charity', t('ch.title', 'Community Charity'), 'charity donation money give association vote fundraiser cagnotte don solidaire reverser association'],
    ['/polls', t('nav.polls', 'Polls'), 'polls vote survey ballot sondage voter scrutin avis'],
    ['/users', t('nav.users', 'Members'), 'users members people community who search someone membres utilisateurs communaute gens qui'],
    ['/profile', t('nav.profile', 'My profile'), 'profile account me my page avatar bio compte profil moi ma page'],
    ['/settings', t('nav.settings', 'Settings'), 'settings preferences options theme dark light mode language privacy cookies reglages parametres theme sombre clair langue preferences confidentialite'],
    ['/notifications', t('nav.notifications', 'Notifications'), 'notifications alerts inbox unread messages alertes non lus boite'],
    ['/contact', t('nav.contact', 'Contact'), 'contact support help ticket report problem write us aide assistance signaler probleme nous ecrire'],
    ['/status', t('nav.status', 'Status'), 'status uptime incidents down outage statut disponibilite panne hors ligne'],
    ['/dev', t('nav.dev', 'Developers'), 'dev developers api sdk integration tools developpeurs outils'],
    ['/myo', t('nav.myo', 'Make your own'), 'myo commission custom build made to order quote hire sur mesure commande creation devis'],
    ['/2fa', t('nav.twofa', '2FA authenticator'), '2fa two factor authenticator totp code security otp securite authentification double facteur'],
  ].map(([to, title, synonyms]) => ({ id: `page:${to}`, kind: 'page', to, title, synonyms }));
}

// ACTIONS — the verbs. `run` is NOT stored here: a closure over `theme`/`auth`/`nav` would
// force the index to be rebuilt whenever one of those identities changed, which is the exact
// per-keystroke rebuild this refactor exists to remove. The index holds ids; the component
// holds a fresh id → function map on every render, which costs nothing.
function actionDefs(t, { signedIn, staff }) {
  const list = [
    ['act:lang', t('cmdk.switchLang', 'Switch language'), 'switch language english french translate langue langage traduction francais anglais changer de langue'],
    ['act:theme', t('cmdk.theme', 'Toggle dark / light theme'), 'theme dark light mode toggle night day contrast thema sombre clair nuit jour basculer'],
    ['act:copy', t('cmdk.copyLink', 'Copy link to this page'), 'copy link url share address copier lien url partager adresse'],
    ['act:top', t('cmdk.top', 'Scroll to top'), 'scroll top up beginning haut debut remonter'],
    ['act:kofi', t('cmdk.kofi', 'Support on Ko-fi'), 'kofi support donate tip coffee soutenir don pourboire cafe'],
  ];
  if (signedIn) {
    list.push(['act:dashboard', t('cmdk.dashboard', 'My dashboard'), 'dashboard billing account subscriptions invoices tableau de bord compte facturation abonnements factures']);
    list.push(['act:redeem', t('cmdk.redeem', 'Redeem a promo code'), 'promo code redeem coupon gift voucher code promo cadeau bon utiliser']);
    list.push(['act:logout', t('cmdk.logout', 'Sign out'), 'logout sign out log off disconnect leave quit deconnexion se deconnecter quitter sortir']);
  }
  if (staff) list.push(['act:admin', t('cmdk.admin', 'Admin dashboard'), 'admin back office moderation queue staff administration moderation file']);
  return list.map(([id, title, synonyms]) => ({ id, kind: 'action', title, synonyms }));
}

// The built command list, cached across opens. Keyed by everything that can change it, so a
// language switch or a sign-in rebuilds it and nothing else does. `_defsKey` is compared as a
// string: cheap, and it cannot go stale the way a hand-maintained invalidation does.
let _defsKey = null;
let _defsIndex = null;
function useCommandIndex(t, lang, signedIn, staff, charityOn, keys) {
  const key = `${lang}|${signedIn ? 1 : 0}|${staff ? 1 : 0}|${charityOn === true ? 1 : 0}|${keys ? 1 : 0}`;
  return useMemo(() => {
    if (_defsKey === key && _defsIndex) return _defsIndex;
    const pages = pageDefs(t).filter((pg) => pg.to !== '/charity' || charityOn === true);
    // Actions carry a small weight so a verb ties ahead of a page when the evidence matches:
    // somebody typing "sign out" wants the action, not the profile page it lives on.
    const acts = actionDefs(t, { signedIn, staff }).map((a) => ({ ...a, weight: 120 }));
    // Where the shortcuts are listed and rebound. Not offered on a touch-only device, which
    // has no keys to bind.
    if (keys) acts.push({ id: 'act:shortcuts', kind: 'action', weight: 120, title: t('cmdk.shortcuts', 'Keyboard shortcuts'), synonyms: 'keyboard shortcuts keys hotkeys bindings rebind alt raccourcis clavier touches' });
    _defsKey = key;
    _defsIndex = buildIndex([...pages, ...acts]);
    return _defsIndex;
    // `t` is intentionally not a dependency: it changes identity on every provider render and
    // the language it resolves IS the `lang` key. Depending on it re-ran this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// Wrap each query term in <mark> (the docs palette's highlighting, kept with the merge): a
// multi-word search marks every word wherever it lands, matching the server's ranking.
function highlight(text, q) {
  const s = String(text || '');
  const terms = [...new Set(String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2))];
  if (!terms.length) return s;
  const low = s.toLowerCase();
  const parts = []; let i = 0;
  while (i < s.length) {
    let best = -1, bestLen = 0;
    for (const tm of terms) { const idx = low.indexOf(tm, i); if (idx >= 0 && (best < 0 || idx < best)) { best = idx; bestLen = tm.length; } }
    if (best < 0) { parts.push(s.slice(i)); break; }
    if (best > i) parts.push(s.slice(i, best));
    parts.push(<mark key={best} className="cmdk-hl">{s.slice(best, best + bestLen)}</mark>);
    i = best + bestLen;
  }
  return parts;
}

// Server hits → rows, grouped DocSearch-style: the page, then its matching sections under it.
function docRows(results) {
  const byPage = new Map();
  for (const r of results) {
    if (!byPage.has(r.slug)) byPage.set(r.slug, { page: null, sections: [] });
    const g = byPage.get(r.slug);
    if (r.section) g.sections.push(r); else g.page = r;
  }
  const out = [];
  for (const [slug, g] of byPage) {
    const head = g.page || { slug, title: g.sections[0]?.title, category: g.sections[0]?.category };
    out.push(docRow(head, false));
    for (const s of g.sections) out.push(docRow(s, true));
  }
  return out;
}
const docRow = (r, sub, group = 'doc') => ({
  id: `doc:${r.slug}:${r.anchor || ''}`, kind: 'doc', group, sub, raw: r,
  title: sub ? r.section : r.title, context: sub ? r.title : r.category, snippet: sub ? '' : r.snippet,
  to: `/docs/${r.slug}${r.anchor ? `#${r.anchor}` : ''}`,
});

const RENDER_CAP = 24; // rows actually put in the DOM

export default function CommandPalette() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const theme = useTheme();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(null); // null = everything, 'docs' = the documentation only
  const [q, setQ] = useState('');
  // The keystroke renders immediately; the result list is allowed to lag by a frame. This is
  // the whole reason typing stays smooth with a few hundred candidates and a typo pass.
  const deferredQ = useDeferredValue(q);
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [pageEls, setPageEls] = useState(null); // built on open, searched per keystroke
  const [recent, setRecent] = useState(readRecent);
  const [docRecent, setDocRecent] = useState(readDocRecent);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const hints = useShortcutHints();
  const touchOnly = useTouchOnly();
  const onDocs = /^\/docs(\/|$)/.test(loc.pathname);
  const docsOnly = scope === 'docs';
  const docsFirst = docsOnly || onDocs;

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => { if (!v) setScope(null); return !v; });
      } else if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // The phone has no ⌘K, so the mobile bar's search button opens the same palette; the
    // docs page's search button opens it narrowed to the docs.
    const offBus = onOpenPalette((d) => { setScope(d?.scope || null); setOpen(true); });
    return () => { window.removeEventListener('keydown', onKey); offBus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(''); setActive(0); setDocs([]);
    setPageEls(buildIndex(collectPageElements()));
    setRecent(readRecent());
    setDocRecent(readDocRecent());
    const id = setTimeout(() => inputRef.current?.focus(), 20);
    // Lock the page behind the palette, the way the shared Modal in ui.jsx does. (Spelled
    // without the angle brackets on purpose: check-modal-open.mjs greps the source for a
    // Modal tag with no `open` prop, and a comment is source.) This is a real
    // aria-modal dialog over a full-screen overlay, but the page under it still scrolled:
    // on a phone, a flick aimed at the result list scrolls the site instead, and the
    // overlay you are reading slides over different content. Measured by
    // scripts/audit-ux.mjs --modals as bodyLocked:false while every other modal check passed.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(id); document.body.style.overflow = prevOverflow; };
  }, [open]);

  // Live docs full-text (the endpoint the docs page always used), debounced off the DEFERRED
  // query so a fast typist fires one request, not one per character. More hits when the docs
  // are what is being searched.
  useEffect(() => {
    const n = deferredQ.trim();
    if (!open || n.length < 2) { setDocs([]); setDocsLoading(false); return undefined; }
    setDocsLoading(true);
    const id = setTimeout(() => {
      api.get(`/docs/search?q=${encodeURIComponent(n)}`)
        .then((r) => setDocs((r.results || []).slice(0, docsFirst ? 14 : 6)))
        .catch(() => setDocs([]))
        .finally(() => setDocsLoading(false));
    }, 160);
    return () => clearTimeout(id);
  }, [deferredQ, open, docsFirst]);

  const user = auth?.user;
  // The nav's own rule for "may see the admin entry" (lib/roles.js), not a role list re-typed.
  const isStaff = canAdmin(user);
  const charityOn = useCharityEnabled();
  const index = useCommandIndex(t, lang, !!user, isStaff, charityOn, !touchOnly);

  // id → what it does. Rebuilt every render on purpose (see actionDefs): it is ten closures.
  const runners = useMemo(() => ({
    'act:lang': () => setLang(lang === 'fr' ? 'en' : 'fr'),
    'act:theme': () => theme?.toggle?.(),
    'act:copy': () => { try { navigator.clipboard?.writeText(location.href); } catch { /* denied */ } },
    'act:top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    'act:kofi': () => window.open('https://ko-fi.com/bettercommunity', '_blank', 'noreferrer'),
    'act:dashboard': () => nav('/dashboard'),
    'act:redeem': () => nav('/dashboard?tab=billing#redeem'),
    'act:logout': () => auth?.logout?.(),
    'act:admin': () => nav('/admin'),
    'act:shortcuts': () => nav('/settings#shortcuts'),
  }), [lang, setLang, theme, auth, nav]);

  const items = useMemo(() => {
    const n = deferredQ.trim();
    if (!n) {
      if (docsOnly) return docRecent.map((r) => docRow(r, !!r.section, 'docrecent'));
      // No query: what you used last, then the directory. searchIndex with an empty query
      // already orders by recency, but the two are shown as separate GROUPS here so the list
      // reads as "yours" then "everything" rather than as one reshuffled alphabet.
      const byId = new Map(index.map((e) => [e.item.id, e.item]));
      const recents = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 4)
        .map((it) => ({ ...it, group: 'recent', cmd: it.kind }));
      const rest = index.map((e) => e.item).filter((it) => !recents.some((r) => r.id === it.id)).map((it) => ({ ...it, group: it.kind }));
      const docR = onDocs ? docRecent.slice(0, 4).map((r) => docRow(r, !!r.section, 'docrecent')) : [];
      return [...docR, ...recents, ...rest].slice(0, RENDER_CAP);
    }
    const d = docRows(docs);
    if (docsOnly) return d.slice(0, RENDER_CAP);
    const cmds = searchIndex(index, n, { recent, limit: 8 }).map((r) => ({ ...r.item, group: r.item.kind, score: r.score }));
    const onpage = pageEls ? searchIndex(pageEls, n, { limit: 5, typo: false }).map((r) => ({ ...r.item, group: 'onpage', score: r.score })) : [];
    // On /docs the documentation leads: that is what somebody reading the manual is looking
    // for. Elsewhere, on-page results lead, because "the thing in front of me" is the most
    // contextual answer — UNLESS a command matched outright. Typing "settings" means the
    // Settings page even when some button on this page happens to contain the word.
    if (docsFirst) return [...d, ...cmds, ...onpage].slice(0, RENDER_CAP);
    const strong = cmds.length > 0 && cmds[0].score >= 5000;
    const out = strong ? [...cmds, ...onpage, ...d] : [...onpage, ...cmds, ...d];
    return out.slice(0, RENDER_CAP);
  }, [deferredQ, docs, index, pageEls, recent, docRecent, docsOnly, docsFirst, onDocs]);

  useEffect(() => { setActive(0); }, [deferredQ, docs, scope]);
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, [active, items]);

  const run = useCallback((it) => {
    if (!it) return;
    setOpen(false);
    if (it.kind === 'doc') setDocRecent(pushDocRecent(it.raw));
    else if (it.kind !== 'onpage') setRecent(pushRecent(it.id));
    const kind = it.cmd || it.kind;
    if (kind === 'action') runners[it.id]?.();
    else if (kind === 'onpage') { setTimeout(() => flashElement(it.el), 30); }
    else if (it.to) nav(it.to);
  }, [nav, runners]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Home' && !q) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && !q) { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
    // Backspace on an empty field widens a narrowed search back to everything.
    else if (e.key === 'Backspace' && !q && scope) { e.preventDefault(); setScope(null); }
  };

  if (!open || typeof document === 'undefined') return null;
  const icon = (it) => it.kind === 'doc' ? (it.sub ? <Hash size={14} /> : <FileText size={15} />)
    : it.group === 'recent' ? <Clock size={15} /> : it.kind === 'action' ? <Zap size={15} /> : it.kind === 'onpage' ? <Target size={15} /> : <Compass size={15} />;
  const groupLabel = (g) => g === 'doc' ? t('cmdk.doc', 'Docs') : g === 'docrecent' ? t('cmdk.docrecent', 'Recent in the docs')
    : g === 'action' ? t('cmdk.action', 'Action') : g === 'onpage' ? t('cmdk.onpage', 'On this page')
    : g === 'recent' ? t('cmdk.recent', 'Recent') : t('cmdk.page', 'Page');
  const n = q.trim();
  const placeholder = docsOnly ? t('docs.search.ph', 'Search the documentation…') : t('cmdk.placeholder', 'Search pages, actions, docs…');

  return createPortal(
    <div className="cmdk-overlay" role="dialog" aria-modal="true" aria-label={placeholder}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk-panel anim-fade">
        <div className="cmdk-head">
          <Search size={17} className="text-[var(--faint)] shrink-0" aria-hidden />
          {docsOnly && (
            <button type="button" className="cmdk-scope" onClick={() => { setScope(null); inputRef.current?.focus(); }}
              title={t('cmdk.scope.clear', 'Search everything instead')} aria-label={t('cmdk.scope.clear', 'Search everything instead')}>
              <BookOpen size={12} aria-hidden /> {t('cmdk.scope.docs', 'Docs')} <X size={11} aria-hidden />
            </button>
          )}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder={placeholder} aria-label={placeholder}
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list"
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-[var(--text)] placeholder:text-[var(--faint)]" />
          {docsLoading && n.length >= 2 && <span className="cmdk-spin" aria-hidden />}
          {touchOnly
            ? <button type="button" className="cmdk-close" onClick={() => setOpen(false)} aria-label={t('common.close', 'Close')} title={t('common.close', 'Close')}><X size={16} /></button>
            : <kbd className="cmdk-kbd">Esc</kbd>}
        </div>
        <div ref={listRef} id="cmdk-list" role="listbox" className="cmdk-list">
          {items.length === 0 && (docsOnly && n.length < 2 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">{t('docs.search.hint', 'Search titles and section headings across the docs.')}</div>
          ) : docsLoading && n.length >= 2 ? (
            <div className="px-4 py-8 grid place-items-center"><span className="cmdk-spin" aria-hidden /></div>
          ) : (
            /* "No matches" alone leaves the typed text on screen with nothing to do about it.
               The list is empty because THIS query excluded everything, so say which query and
               put the way back one press away. No Card here on purpose: the palette is a popup
               on --bg-solid, and a Card surface can be translucent. */
            <div className="px-4 py-8 text-center">
              <div className="text-sm font-semibold break-words">{t('cmdk.none', 'No match for “{q}”').replace('{q}', q)}</div>
              <div className="text-[12.5px] text-[var(--muted)] mt-1 mx-auto max-w-sm">{t('cmdk.none.s2', 'This understands plain words and forgives a typo. Fewer words usually find more.')}</div>
              <div className="mt-3 flex justify-center gap-2 flex-wrap">
                <button type="button" onClick={() => setQ('')} className="btn btn-primary btn-sm">{t('cmdk.none.a', 'Clear the search')}</button>
                {docsOnly && <button type="button" onClick={() => setScope(null)} className="btn btn-sm">{t('cmdk.scope.clear', 'Search everything instead')}</button>}
              </div>
            </div>
          ))}
          {items.map((it, i) => {
            const hint = hints.get(it.id);
            return (
              <div key={`${it.id}:${i}`}>
                {/* A header when the group changes, so a mixed list reads as groups: where
                    "things on this page" end and "the manual" begins. */}
                {(i === 0 || items[i - 1].group !== it.group) && (
                  <div className="cmdk-group">
                    <span>{groupLabel(it.group)}</span>
                    {it.group === 'docrecent' && (
                      <button type="button" className="cmdk-group-a" onClick={() => setDocRecent(clearDocRecent())}>
                        <X size={11} aria-hidden /> {t('docs.search.clearrecent', 'Clear')}
                      </button>
                    )}
                  </div>
                )}
                <button type="button" role="option" aria-selected={i === active} data-active={i === active ? '1' : '0'}
                  onMouseMove={() => { if (i !== active) setActive(i); }} onClick={() => run(it)}
                  className={`cmdk-row ${it.sub ? 'is-sub' : ''} ${i === active ? 'is-active' : ''}`}>
                  <span className="cmdk-ico" aria-hidden>{icon(it)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="cmdk-title">{it.kind === 'doc' ? highlight(it.title, n) : it.title}</span>
                    {it.kind === 'doc' && (it.context || it.snippet) && (
                      <span className="cmdk-sub">{it.snippet ? highlight(it.snippet, n) : it.context}</span>
                    )}
                  </span>
                  {hint && <Keys caps={hint} className="cmdk-hint" />}
                  {i === active && !touchOnly && <CornerDownLeft size={13} className="text-[var(--faint)] shrink-0" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
        {!touchOnly && (
          <div className="cmdk-foot">
            <span className="flex items-center gap-1"><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> {t('cmdk.navigate', 'navigate')}</span>
            <span className="flex items-center gap-1"><kbd className="cmdk-kbd">↵</kbd> {t('cmdk.open', 'open')}</span>
            {scope && <span className="flex items-center gap-1"><kbd className="cmdk-kbd">⌫</kbd> {t('cmdk.scope.widen', 'search everything')}</span>}
            <span className="ms-auto flex items-center gap-1"><Keys combo={paletteCombo()} /> {t('cmdk.toggle', 'open or close')}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
