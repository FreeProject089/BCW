// Site-wide ⌘K / Ctrl-K command palette.
//
// Docs used to own ⌘K, and only on its own page. This one is global (mounted once in App) and
// searches the WHOLE site: jump to any page, run a quick action, and full-text search the docs.
// It is keyword-aware — each page carries aliases (a concept → the page), so "money"/"prix" finds
// Hosting, "don"/"donation" finds Charity, "dark mode"/"langue" finds Settings — which is the
// "feels semantic" part without a vector index. Ranking is a fuzzy scorer over label + aliases.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, FileText, ArrowRight, Hash, Compass, Zap } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';

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
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState([]);
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

  useEffect(() => { if (open) { setQ(''); setActive(0); setDocs([]); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

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

  const actions = useMemo(() => [
    { kind: 'action', label: t('cmdk.switchLang', 'Switch language'), kw: `${t('cmdk.switchLang', 'switch language')} langue lang traduction`.toLowerCase(),
      run: () => setLang(lang === 'fr' ? 'en' : 'fr') },
    { kind: 'action', label: t('cmdk.kofi', 'Support on Ko-fi'), kw: 'kofi support donate tip soutenir don'.toLowerCase(),
      run: () => window.open('https://ko-fi.com/bettercommunity', '_blank', 'noreferrer') },
  ], [t, lang, setLang]);

  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    const pages = pageDefs(t);
    const scored = (arr) => arr.map((x) => ({ ...x, s: score(n, x.kw || x.label.toLowerCase()) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const p = scored(pages);
    const a = scored(actions);
    const d = docs.map((r) => ({
      kind: 'doc', label: r.title, section: r.section, to: `/docs/${r.slug}${r.anchor ? `#${r.anchor}` : ''}`, s: 1,
    }));
    // No query → show the pages as a directory + actions. Query → ranked everything.
    const out = n ? [...p.slice(0, 8), ...d, ...a.slice(0, 3)] : [...pages.map((x) => ({ ...x, s: 1 })), ...actions];
    return out;
  }, [q, docs, actions, t]);

  useEffect(() => { setActive(0); }, [q, docs]);
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = useCallback((it) => {
    if (!it) return;
    setOpen(false);
    if (it.kind === 'action') it.run?.();
    else if (it.to) nav(it.to);
  }, [nav]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  };

  if (!open) return null;
  const icon = (k) => k === 'doc' ? <FileText size={15} /> : k === 'action' ? <Zap size={15} /> : <Compass size={15} />;
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true"
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
          {items.length === 0 && <div className="px-4 py-6 text-sm text-[var(--faint)] text-center">{t('cmdk.none', 'No matches')}</div>}
          {items.map((it, i) => (
            <button key={`${it.kind}:${it.to || it.label}:${i}`} data-active={i === active ? '1' : '0'}
              onMouseEnter={() => setActive(i)} onClick={() => run(it)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${i === active ? 'bg-[var(--surface-2)]' : ''}`}>
              <span className="text-[var(--primary-2)] shrink-0">{icon(it.kind)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-[var(--text)] truncate">{it.label}</span>
                {it.kind === 'doc' && it.section && <span className="block text-[11px] text-[var(--faint)] truncate flex items-center gap-1"><Hash size={10} /> {it.section}</span>}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] shrink-0">
                {it.kind === 'doc' ? t('cmdk.doc', 'Docs') : it.kind === 'action' ? t('cmdk.action', 'Action') : t('cmdk.page', 'Page')}
              </span>
              {i === active && <CornerDownLeft size={13} className="text-[var(--faint)] shrink-0" />}
            </button>
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
