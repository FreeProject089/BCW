// Site-wide ⌘K / Ctrl-K command palette.
//
// Docs used to own ⌘K, and only on its own page. This one is global (mounted once in App) and
// searches the WHOLE site: jump to any page, run a quick action, and full-text search the docs.
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
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, FileText, ArrowRight, Hash, Compass, Zap, Target, Clock } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { useTheme } from './theme.jsx';
import { useAuth } from '../pages/auth.jsx';
import { useCharityEnabled } from '../lib/charity-enabled.js';
import { buildIndex, searchIndex } from './palette-search.js';
import { readRecent, pushRecent, onOpenPalette } from './palette-recent.js';

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
function useCommandIndex(t, lang, signedIn, staff, charityOn) {
  const key = `${lang}|${signedIn ? 1 : 0}|${staff ? 1 : 0}|${charityOn === true ? 1 : 0}`;
  return useMemo(() => {
    if (_defsKey === key && _defsIndex) return _defsIndex;
    const pages = pageDefs(t).filter((pg) => pg.to !== '/charity' || charityOn === true);
    // Actions carry a small weight so a verb ties ahead of a page when the evidence matches:
    // somebody typing "sign out" wants the action, not the profile page it lives on.
    const acts = actionDefs(t, { signedIn, staff }).map((a) => ({ ...a, weight: 120 }));
    _defsKey = key;
    _defsIndex = buildIndex([...pages, ...acts]);
    return _defsIndex;
    // `t` is intentionally not a dependency: it changes identity on every provider render and
    // the language it resolves IS the `lang` key. Depending on it re-ran this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const RENDER_CAP = 24; // rows actually put in the DOM

export default function CommandPalette() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const theme = useTheme();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // The keystroke renders immediately; the result list is allowed to lag by a frame. This is
  // the whole reason typing stays smooth with a few hundred candidates and a typo pass.
  const deferredQ = useDeferredValue(q);
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState([]);
  const [pageEls, setPageEls] = useState(null); // built on open, searched per keystroke
  const [recent, setRecent] = useState(readRecent);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // The phone has no ⌘K, so the mobile bar's search button opens the same palette.
    const offBus = onOpenPalette(() => setOpen(true));
    return () => { window.removeEventListener('keydown', onKey); offBus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(''); setActive(0); setDocs([]);
    setPageEls(buildIndex(collectPageElements()));
    setRecent(readRecent());
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

  // Live docs full-text (the same endpoint the docs page uses), debounced off the DEFERRED
  // query so a fast typist fires one request, not one per character.
  useEffect(() => {
    const n = deferredQ.trim();
    if (!open || n.length < 2) { setDocs([]); return undefined; }
    const id = setTimeout(() => {
      api.get(`/docs/search?q=${encodeURIComponent(n)}`)
        .then((r) => setDocs((r.results || []).slice(0, 6)))
        .catch(() => setDocs([]));
    }, 180);
    return () => clearTimeout(id);
  }, [deferredQ, open]);

  const user = auth?.user;
  const isStaff = !!user && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(user.role);
  const charityOn = useCharityEnabled();
  const index = useCommandIndex(t, lang, !!user, isStaff, charityOn);

  // id → what it does. Rebuilt every render on purpose (see actionDefs): it is nine closures.
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
  }), [lang, setLang, theme, auth, nav]);

  const items = useMemo(() => {
    const n = deferredQ.trim();
    if (!n) {
      // No query: what you used last, then the directory. searchIndex with an empty query
      // already orders by recency, but the two are shown as separate GROUPS here so the list
      // reads as "yours" then "everything" rather than as one reshuffled alphabet.
      const byId = new Map(index.map((e) => [e.item.id, e.item]));
      const recents = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 4)
        .map((it) => ({ ...it, kind: 'recent', cmd: it.kind }));
      const rest = index.map((e) => e.item).filter((it) => !recents.some((r) => r.id === it.id));
      return [...recents, ...rest].slice(0, RENDER_CAP);
    }
    const cmds = searchIndex(index, n, { recent, limit: 8 }).map((r) => ({ ...r.item, score: r.score }));
    const onpage = pageEls ? searchIndex(pageEls, n, { limit: 5, typo: false }).map((r) => ({ ...r.item, score: r.score })) : [];
    const d = docs.map((r) => ({
      id: `doc:${r.slug}:${r.anchor || ''}`, kind: 'doc', title: r.title, section: r.section,
      to: `/docs/${r.slug}${r.anchor ? `#${r.anchor}` : ''}`,
    }));
    // On-page results lead, because "the thing in front of me" is the most contextual answer
    // — UNLESS a command matched outright. Typing "settings" means the Settings page even
    // when some button on this page happens to contain the word, and the old order got that
    // wrong every time.
    const strong = cmds.length > 0 && cmds[0].score >= 5000;
    const out = strong ? [...cmds, ...onpage, ...d] : [...onpage, ...cmds, ...d];
    return out.slice(0, RENDER_CAP);
  }, [deferredQ, docs, index, pageEls, recent]);

  useEffect(() => { setActive(0); }, [deferredQ, docs]);
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, [active, items]);

  const run = useCallback((it) => {
    if (!it) return;
    setOpen(false);
    if (it.kind !== 'onpage' && it.kind !== 'doc') setRecent(pushRecent(it.id));
    const kind = it.cmd || it.kind;
    if (kind === 'action') runners[it.id]?.();
    else if (kind === 'onpage') { setTimeout(() => flashElement(it.el), 30); }
    else if (it.to) nav(it.to);
  }, [nav, runners]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
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
            aria-label={t('cmdk.placeholder', 'Search pages, actions, docs…')}
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
              <div className="text-[12.5px] text-[var(--muted)] mt-1 mx-auto max-w-sm">{t('cmdk.none.s2', 'This understands plain words and forgives a typo. Fewer words usually find more.')}</div>
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => setQ('')} className="btn btn-primary btn-sm">{t('cmdk.none.a', 'Clear the search')}</button>
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <div key={`${it.id}:${i}`}>
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
                <span className="block text-sm text-[var(--text)] truncate" title={it.title}>{it.title}</span>
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
