import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, Scale,
  Download, Github, MessageCircle, Heart, Globe, BookOpen, Users, ScrollText, ShieldCheck,
  FileText, ListTodo, Boxes, ExternalLink, FolderGit2, ChevronRight, ChevronDown,
  CheckCircle2, Clock, Circle, CalendarDays, Rocket, Wrench, Sparkles, FlaskConical, Newspaper, Network, Pencil,
  Play, Radio, Megaphone, GitBranch, ShoppingBag, Key, Copy, LayoutTemplate, Lock, Orbit, Search, X
} from 'lucide-react';
import Markdown, { matchesLang, ShowcaseIcon, IconGlyph } from '../ui/md.jsx';

/**
 * A custom tab's stored icon name → the component the tab bar draws.
 *
 * Both tab bars passed `null` here, so a custom tab was the only one in the row without a
 * glyph — while the editor's own description had been promising "a title, an icon and a B.MD
 * document" since it was written. Returns null for an unset or unnamed icon, which is what the
 * `{Icon ? … : null}` guard below expects: a tab that names no icon simply has none, and one
 * that names a glyph nobody has is not a crash.
 */
const tabIcon = (name) => {
  const n = String(name || '').trim();
  if (!n) return null;
  return (props) => <IconGlyph name={n} {...props} />;
};
import CanvasView from '../ui/canvas-view.jsx';
import { ProgressTracker } from '../hero/progress-tracker.jsx';
import { api, uploadPayload } from '../lib/api.js';
import { thumb } from '../lib/img.js';
import { useI18n } from '../i18n.jsx';
import StackMap from '../ui/stack-map.jsx';
import ProjectCodeMap from '../ui/project-code-map.jsx';
import { stackTabEnabled } from '../lib/stack-layout.js';
import { canEditProject } from '../lib/roles.js';
import { useAuth } from './auth.jsx';
import RrwebPreview from '../hero/RrwebPreview.jsx';
import { GithubIcon, KofiIcon, DiscordIcon, RedditIcon, AppLogo, APP_LOGO } from '../ui/brand.jsx';
import { MessageSquare } from 'lucide-react';
import { Button, Card, Badge, PageHeader, EmptyState, Spinner, Modal, Input, Textarea, Field, useToast } from '../ui/ui.jsx';
import { useDraft, DraftBanner } from '../ui/drafts.jsx';
import { ProjectContactBar } from '../ui/project-contact.jsx';
import { useFramedDraft, canvasTabsFor } from '../lib/studio-preview.js';
// G2 + G3: the version timeline, the project's own docs and its legal pages (PLAN-SEPT23).
import { ProjectVersions, ProjectPages, ProjectLegalTab, useProjectContent } from './project-content.jsx';

// Which tab is actually shown. A `?tab=` naming one that is switched OFF must not render it:
// hiding the link while still serving the content means an admin who turns a tab off has not
// turned it off, only made it harder to find. Falls back to the first tab that IS allowed.
function pickTab(want, tabs) {
  return tabs.some(([id]) => id === want) ? want : (tabs[0]?.[0] || 'overview');
}

// Pick an icon that suits the release note from its filename.
function noteIcon(name = '') {
  const n = name.toLowerCase();
  if (/hotfix|patch|fix|bug/.test(n)) return Wrench;
  if (/secur|vuln|cve/.test(n)) return ShieldCheck;
  if (/beta|ptb|rc\b|preview|test|nightly/.test(n)) return FlaskConical;
  if (/feature|new|added|highlight/.test(n)) return Sparkles;
  if (/release|stable|update|changelog|v?\d+\.\d+/.test(n)) return Rocket;
  return FileText;
}

const LINK_META = {
  github: { icon: GithubIcon, label: 'GitHub' }, discord: { icon: DiscordIcon, label: 'Discord' },
  kofi: { icon: KofiIcon, label: 'Ko-fi' }, reddit: { icon: RedditIcon, label: 'Reddit' },
  forum: { icon: Globe, label: 'Forum' }, website: { icon: Globe, label: 'Website' },
  docs: { icon: BookOpen, label: 'Docs' }, source: { icon: GithubIcon, label: 'Source code' },
};
// Order of the generic link buttons on a showcase project page.
const LINK_ORDER = ['github', 'source', 'discord', 'kofi', 'reddit', 'website', 'docs'];
const KNOWN_LINKS = new Set([...LINK_ORDER, 'forum']);

// The project's links row: known links (GitHub/Discord/…) then any number of custom
// links, each its own button with a chosen icon (lucide / simple:brand) + label.
// Back-compat: a legacy single customLabel/customUrl becomes one custom button.
function LinksRow({ links }) {
  if (!links) return null;
  const custom = Array.isArray(links.custom)
    ? links.custom.filter((x) => x && x.url)
    : (links.customUrl ? [{ icon: 'link', label: links.customLabel || 'Link', url: links.customUrl }] : []);
  const known = LINK_ORDER.filter((k) => links[k]);
  if (!known.length && !custom.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      {known.map((k) => { const m = LINK_META[k] || { icon: ExternalLink, label: k }; return (
        <a key={k} href={links[k]} target="_blank" rel="noreferrer"><Button size="sm"><m.icon size={14} className={k === 'kofi' ? 'text-orange-400' : ''} /> {m.label}</Button></a>); })}
      {custom.map((d, i) => (
        <a key={`c${i}`} href={d.url} target="_blank" rel="noreferrer"><Button size="sm">{d.icon ? <ShowcaseIcon icon={d.icon} size={14} /> : <ExternalLink size={14} />} {d.label || 'Link'}</Button></a>
      ))}
    </div>
  );
}
const LEGAL_ICONS = { shield: ShieldCheck, lock: ScrollText, book: BookOpen, file: FileText, scroll: ScrollText, globe: Globe, docs: BookOpen };

// A framed, tilt-on-hover media slot for the overview: image, video, or an rrweb replay.
function MediaFrame({ media, pkey }) {
  const ref = useRef(null);
  const replay = media?.replayUrl || media?.rrwebUrl;
  if (replay) return <AppPreview pkey={pkey || 'app'} replayUrl={replay} />;
  if (!media?.image && !media?.video) return null;
  const move = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; const dy = (e.clientY - r.top) / r.height - 0.5; ref.current.style.transform = `perspective(1200px) rotateY(${dx * 10}deg) rotateX(${-dy * 8}deg) scale(1.01)`; };
  const rest = () => { if (ref.current) ref.current.style.transform = 'perspective(1200px) rotateY(0) rotateX(0) scale(1)'; };
  return (
    <div className="mb-8" style={{ perspective: 1200 }} onMouseMove={move} onMouseLeave={rest}>
      <div ref={ref} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border border-[var(--line-strong)] transition-transform duration-100 ease-out will-change-transform" style={{ background: '#0a0b0f', boxShadow: '0 34px 80px -32px rgba(0,0,0,0.55)' }}>
        {media.video ? <video src={media.video} controls className="w-full block" /> : <img src={thumb(media.image, 768)} alt="" className="w-full block" />}
      </div>
    </div>
  );
}

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [gen, setGen] = useState(0);
  useEffect(() => { let on = true; setLoading(true); fn().then((d) => on && setData(d)).catch((e) => on && setErr(e)).finally(() => on && setLoading(false)); return () => { on = false; }; /* eslint-disable-next-line */ }, [...deps, gen]);
  return { data, loading, err, refetch: () => setGen((g) => g + 1) };
}

// Download button(s) for a project header. One entry = a plain button. Several
// entries (installer + portable + source code…) = the primary option as the
// main button plus a chevron dropdown listing every choice with its label —
// instead of a cluttered row of look-alike buttons.
function DownloadMenu({ downloads = [], children, pkey }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);
  // Count a real download click (fire-and-forget) so the headline counter can show it. Only when
  // a project key is known — the version-history modal has none, and a click there isn't a fresh
  // download of the current build.
  const fireDl = () => { if (pkey) { try { api.post(`/projects/${pkey}/downloads/click`).catch(() => {}); } catch { /* ignore */ } } };
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); clearTimeout(closeTimer.current); };
  }, []);
  // Open on hover (with a small close grace period so moving the cursor from the
  // button down into the menu doesn't dismiss it), and still toggle on click.
  const hoverOpen = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hoverClose = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 160); };
  const list = downloads.filter((d) => d.url);
  if (!list.length) return children || null;
  const primary = list.find((d) => d.primary) || list[0];
  // Per-download icon: a chosen lucide/simple icon, else the source-vs-download
  // heuristic. `white` renders it on the solid primary button (currentColor).
  const dlIcon = (d, size = 16, cls = '') => d.icon
    ? <ShowcaseIcon icon={d.icon} size={size} className={cls} />
    : (/^source|code|src/i.test(d.label || '') ? <FolderGit2 size={size} className={cls} /> : <Download size={size} className={cls} />);
  if (list.length === 1) {
    return (<>
      <a href={primary.url} download rel="noreferrer" onClick={fireDl}><Button variant="primary">{dlIcon(primary)} {primary.label}</Button></a>
      {children}
    </>);
  }
  return (
    <div className="relative inline-flex" ref={ref} onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      {/* ONE gradient across the whole split button, painted by this wrapper.
          Before, each half was its own .btn-primary, and .btn-primary fills with
          `linear-gradient(120deg, var(--primary), var(--primary-2))` — so the gradient
          restarted on the 30px chevron, producing a visible step at the seam. The halves are
          now transparent (`!bg-none`) and this one surface shows through both. */}
      <div className="inline-flex rounded-[10px] overflow-hidden"
        style={{ background: 'linear-gradient(120deg, var(--primary), var(--primary-2))', boxShadow: '0 6px 20px -8px var(--primary-glow)' }}>
        <a href={primary.url} download rel="noreferrer" className="inline-flex" onClick={fireDl}>
          <Button variant="primary" className="!bg-none !rounded-none !shadow-none">{dlIcon(primary)} {primary.label}</Button>
        </a>
        {/* The divider was `border-white/25` — invisible the moment the accent is a pastel,
            which site themes can now make it. --on-primary is the ink already chosen for
            THIS accent, so the separator follows it. */}
        <span aria-hidden="true" className="self-stretch w-px my-2 shrink-0"
          style={{ background: 'color-mix(in srgb, var(--on-primary) 35%, transparent)' }} />
        <Button variant="primary" className="!bg-none !rounded-none !shadow-none !px-2.5"
          aria-label={t('dl.more', 'More download options')} aria-expanded={open} aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </Button>
      </div>
      {children}
      {open && (
        <div role="menu"
          className="absolute start-0 top-full mt-2 min-w-[15rem] max-w-[22rem] rounded-xl border border-[var(--line-strong)] p-1 z-[60] anim-fade"
          style={{ background: 'var(--bg-solid)', boxShadow: 'var(--shadow-lg, 0 18px 50px -12px rgba(0,0,0,0.5))' }}>
          {list.map((d) => {
            const isPrimary = d === primary;
            return (
              <a key={`${d.label}:${d.url}`} href={d.url} download rel="noreferrer" role="menuitem" onClick={() => { setOpen(false); fireDl(); }}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors">
                <span className={`shrink-0 ${isPrimary ? 'text-[var(--accent-ink)]' : 'text-[var(--muted)]'}`}>{dlIcon(d, 15)}</span>
                <span className="min-w-0 flex-1 truncate" title={d.label}>{d.label}</span>
                {/* A dot, not the word "default": the label is often already long, and the
                    row used to end in an all-caps English word in the French UI. */}
                {isPrimary && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--primary)' }}
                  title={t('dl.default', 'Default download')} />}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Version-history modal — click a project's version badge to browse past versions and
// open the page's info + downloads as they were at that version. `endpoint` is the
// project's API base ('/projects/bmm' or '/project/<slug>'); works for every project.
function VersionHistoryModal({ endpoint, currentVersion, onClose, initial = null }) {
  const { t, lang } = useI18n();
  const [versions, setVersions] = useState(null);
  const [sel, setSel] = useState(null);       // { version, createdAt, config }
  const [loadingSel, setLoadingSel] = useState(false);
  useEffect(() => {
    let on = true;
    api.get(`${endpoint}/versions`).then((r) => { if (on) setVersions(r.versions || []); }).catch(() => on && setVersions([]));
    return () => { on = false; };
  }, [endpoint]);
  // Opened from a version of the Versions tab: show that one, not the empty picker.
  useEffect(() => { if (initial) open(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (v) => {
    setLoadingSel(true);
    try { const r = await api.get(`${endpoint}/versions/${encodeURIComponent(v)}`); setSel(r); }
    catch { setSel(null); } finally { setLoadingSel(false); }
  };
  const cfg = sel?.config || {};
  const notes = lang === 'fr' && cfg.taglineFr ? cfg.taglineFr : cfg.tagline;
  return (
    <Modal open onClose={onClose} title={t('ver.title', 'Version history')} icon={Clock} width="max-w-2xl">
      <div className="grid sm:grid-cols-[190px_1fr] gap-4 min-h-[280px]">
        {/* Version list */}
        <div className="sm:border-e sm:border-[var(--line)] sm:pe-3 max-h-[60vh] overflow-auto scroll-thin">
          {versions == null ? <div className="p-4 text-center"><Spinner /></div>
            : versions.length === 0 ? <div className="text-sm text-[var(--faint)] p-2">{t('ver.none', 'No version history yet.')}</div>
            : <div className="space-y-1">
                {versions.map((v) => (
                  <button key={v.version} onClick={() => open(v.version)}
                    className={`w-full text-start px-3 py-2 rounded-lg border text-sm transition press-sm ${sel?.version === v.version ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}>
                    <div className="flex items-center gap-2"><span className="font-medium">v{v.version}</span>{v.current && <Badge tone="primary">{t('ver.current', 'current')}</Badge>}</div>
                    {v.createdAt && <div className="text-[11px] text-[var(--faint)]">{new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
                  </button>
                ))}
              </div>}
        </div>
        {/* Selected version detail */}
        <div>
          {loadingSel ? <div className="p-6 text-center"><Spinner /></div>
            : !sel ? <div className="text-sm text-[var(--faint)] grid place-items-center h-full py-8"><span className="flex items-center gap-2"><Clock size={15} /> {t('ver.pick', 'Pick a version to see it as it was.')}</span></div>
            : <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-lg">{cfg.name || ''} <span className="text-[var(--accent-ink)]">v{sel.version}</span></h3>{versions?.find((x) => x.version === sel.version)?.current && <Badge tone="primary">{t('ver.current', 'current')}</Badge>}</div>
                {notes && <p className="text-sm text-[var(--muted)]">{notes}</p>}
                {Array.isArray(cfg.downloads) && cfg.downloads.some((d) => d.url)
                  ? <div className="flex items-center gap-2 flex-wrap pt-1"><DownloadMenu downloads={cfg.downloads} /></div>
                  : <div className="text-sm text-[var(--faint)]">{t('ver.nodl', 'No downloads recorded for this version.')}</div>}
                {(cfg.releaseNotes?.owner || cfg.releaseNotes) && <div className="text-xs text-[var(--faint)] pt-1">{t('ver.notes.hint', 'Release notes for this version are on the project’s Releases tab.')}</div>}
              </div>}
        </div>
      </div>
    </Modal>
  );
}

function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const total = Math.max(0, new Date(target).getTime() - now);
  const s = Math.floor(total / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, done: total <= 0 };
}

// A CTA button that can point anywhere — internal (/blog/…, /docs/…) via router
// Link, or an external URL via a normal anchor.
function CtaButton({ button }) {
  if (!button?.url) return null;
  const internal = button.url.startsWith('/');
  const inner = <Button variant="primary">{button.label || 'Learn more'} <ArrowRight size={15} /></Button>;
  return <div className="mt-6">{internal ? <Link to={button.url}>{inner}</Link> : <a href={button.url} target="_blank" rel="noreferrer">{inner}</a>}</div>;
}

// The countdown itself — logo + title + digits + markdown + optional CTA. Shared by
// the full-page takeover teaser AND the inline "Countdown" first tab, so both modes
// look identical. `bare` drops the "Coming soon" chip/heading chrome for the tab.
function CountdownBlock({ announcement, done, cd, bare }) {
  const { t } = useI18n();
  const unit = (v, label) => (
    <div className="flex flex-col items-center">
      <div className="text-3xl md:text-4xl font-extrabold tabular-nums bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 min-w-[4.5rem] text-center">{String(v).padStart(2, '0')}</div>
      <div className="text-[11px] text-[var(--faint)] uppercase tracking-wider mt-1.5">{label}</div>
    </div>
  );
  return (
    <div className={`max-w-2xl mx-auto text-center ${bare ? 'py-4' : 'py-10'}`}>
      {announcement.logo && <img src={announcement.logo} alt="" className="w-20 h-20 rounded-2xl object-contain mx-auto mb-5 shadow-lg bg-[var(--surface-2)] border border-[var(--line)] p-1.5" />}
      {!bare && <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent-ink)] mb-2"><Sparkles size={13} /> {t('prj.comingsoon', "Coming soon")}</div>}
      {(announcement.title || !bare) && <h1 className={`${bare ? 'text-2xl' : 'text-3xl md:text-4xl'} font-extrabold tracking-tight mb-4`}>{announcement.title || 'Something big is coming'}</h1>}
      {!done ? (
        <div className="flex items-center justify-center gap-2 md:gap-4 my-8">
          {unit(cd.days, 'days')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.hours, 'hours')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.minutes, 'min')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.seconds, 'sec')}
        </div>
      ) : <div className="my-8 text-[var(--muted)]">Revealing…</div>}
      {announcement.markdown && <div className="text-start"><Markdown>{announcement.markdown}</Markdown></div>}
      <CtaButton button={announcement.button} />
    </div>
  );
}

// Full-page "coming soon" takeover — served instead of the real page while the
// countdown runs (announceShowPage = false). Reveals (refetches) when it ends.
function AnnouncementTeaser({ announcement, onReveal }) {
  const cd = useCountdown(announcement.revealAt);
  useEffect(() => { if (cd.done) onReveal?.(); }, [cd.done]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CountdownBlock announcement={announcement} cd={cd} done={cd.done} />;
}

// Inline "Countdown" first tab (announceShowPage = true) — the page is reachable,
// this just adds the countdown alongside it. Reveals the page when it ends.
function CountdownPanel({ announcement, onReveal }) {
  const cd = useCountdown(announcement.revealAt);
  useEffect(() => { if (cd.done) onReveal?.(); }, [cd.done]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CountdownBlock announcement={announcement} cd={cd} done={cd.done} bare />;
}

/**
 * @param {object} [props.preview]  the studio's "page preview": `{ key, config, tab }` renders
 *        THIS component with a config it was handed instead of one it fetched, so the author
 *        sees the page exactly as a visitor will — same tabs, same renderer — with the draft
 *        canvas in place. Absent on the real route.
 */
export default function ProjectPage({ preview: previewProp = null }) {
  // The studio's page preview frames THIS route and posts the draft (lib/studio-preview.js);
  // absent, and on every real visit, this is null and nothing changes.
  const framed = useFramedDraft('project');
  const preview = previewProp || framed;
  const params = useParams();
  const key = preview?.key ?? params.key;
  const { t } = useI18n();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const wantTab = sp.get('tab') || preview?.tab || 'overview';
  const [showVersions, setShowVersions] = useState(false);
  const previewConfig = preview?.config || null;
  const { data, loading, err } = useFetch(() => (previewConfig
    ? Promise.resolve({ config: previewConfig, showBlogTab: false })
    : api.get(`/projects/${key}`)), [key, previewConfig]);
  // The project's marketplace — the tab only appears when it actually sells something.
  const market = useFetch(() => api.get(`/marketplace/products?projectKey=${encodeURIComponent(key)}`).catch(() => ({ products: [] })), [key]);
  const marketProducts = market.data?.products || [];
  // What the project wrote beside its page (G2 + G3). Not in the studio's preview: that
  // renders a draft config, and these live in their own tables.
  const extra = useProjectContent(preview ? null : `/projects/${key}`);
  const ex = extra.data || {};
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  if (err?.status === 403) return <EmptyState icon={Lock} title={t('proj.notAvailable', 'Not available')} sub={t('proj.noAccess', "You don't have access to this page.")}
    action={{ label: t('proj.err.a', 'See the projects'), to: '/projects', icon: Boxes }} />;
  if (err) return <EmptyState as="h1" icon={Boxes} title={t('proj.notFound', 'Project not found')}
    sub={t('proj.notFound.s2', 'This address does not match any project, it may have been renamed or removed.')}
    action={{ label: t('proj.err.a', 'See the projects'), to: '/projects', icon: Boxes }} />;
  const c = data.config;
  const hasCatalog = key === 'bmm' || key === 'bsm';
  // A page of one's own, on the fixed projects too. These were showcase-only, which meant the
  // projects people actually visit were the ones that could not be personalised at all.
  const customTabs = (Array.isArray(c.customTabs) ? c.customTabs : [])
    .filter((ct) => ct && ct.id && String(ct.title || '').trim() && String(ct.body || '').trim());
  // One rule for both project pages (lib/studio-preview.js). In the studio's preview the page
  // being previewed is offered whatever its state, or the preview fell back to Overview.
  const canvasTabs = canvasTabsFor(c, preview ? preview.tab : null, t('pce.canvases.untitled', 'Untitled page'));
  const tabs = [
    ['overview', t('proj.overview'), ListTodo],
    // The project's own docs: shown once a page exists, and to its editors so they can write the first.
    (ex.docs > 0 || ex.canEdit) && ['docs', t('proj.docs', 'Docs'), BookOpen],
    c.releaseNotes && ['releases', t('proj.releases'), ScrollText],
    (c.version || ex.releases > 0 || ex.canEdit) && ['versions', t('proj.versions', 'Versions'), Clock],
    ['community', t('proj.community'), Users],
    // The admin switch AND something to draw — see stackTabEnabled, which both kinds of
    // project page share so the rule cannot drift between them.
    stackTabEnabled(c.stack) && ['stack', c.stack.title || t('proj.stack', 'How it runs'), Network],
    data.showBlogTab && ['blog', t('proj.blog'), Newspaper],
    marketProducts.length > 0 && ['market', t('proj.market', 'Marketplace'), ShoppingBag],
    (c.releaseNotes || c.links?.github || c.timeline?.length) && ['activity', t('proj.activity', 'Activity'), CalendarDays],
    ['legal', t('proj.legal'), ShieldCheck],
    // Last, so adding one never moves a tab somebody has already linked to.
    ...customTabs.map((ct) => [`x-${ct.id}`, ct.title, tabIcon(ct.icon)]),
    ...canvasTabs.map((cv) => [`c-${cv.id}`, cv.title, LayoutTemplate]),
  ].filter(Boolean);
  const tab = pickTab(wantTab, tabs);

  return (
    <div>
      {/* header */}
      {/* N8 (agent-landing-N): the actions have their own row UNDER the name. Beside it they
          took most of the line, so a two-word project name wrapped word by word. The row starts
          where the name starts (the logo's 64px + the 20px gap from md up) and wraps cleanly;
          `empty:hidden` drops it when a project has no action to offer. */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          {APP_LOGO[key]
            ? <img src={APP_LOGO[key]} alt="" className="logo-plate w-16 h-16 rounded-2xl object-contain shrink-0 bg-[var(--surface-2)] border border-[var(--line)] p-1.5" />
            : <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-brand-2 shrink-0"><span className="text-2xl font-extrabold text-[var(--on-primary)]">{c.name?.[0] || 'B'}</span></div>}
          <div className="flex-1 min-w-0 on-backdrop">
            <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap"><h1 className="text-3xl font-extrabold min-w-0 break-words">{c.name}</h1>{c.version && <button onClick={() => (preview ? setShowVersions(true) : setSp((p) => { const n = new URLSearchParams(p); n.set('tab', 'versions'); return n; }))} title={t('ver.open', 'Version history')} className="press-sm"><Badge tone="primary"><Clock size={11} /> v{c.version}</Badge></button>}</div>
            <p className="text-[var(--muted)] mt-1">{c.tagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 md:ps-[84px] empty:hidden">
          <DownloadMenu downloads={c.downloads} pkey={key} />
          {hasCatalog && <Link to={`/catalog?project=${key}`}><Button><Boxes size={16} /> {t('proj.browse')}</Button></Link>}
          {/* The project's own contact: write to it, and for whoever answers, its inbox. */}
          {!preview && <ProjectContactBar projectRef={key} />}
          {/* The way BACK to the editor, for somebody who may edit this page.
              The config has always been editable — in an admin section, reached from a menu,
              two pages from the thing it describes. So the person who spots that a diagram is
              wrong is looking at the diagram, and the fix is somewhere else entirely. This is
              the link between the two.

              Shown only to somebody who actually holds the grant; canEditProject is the same
              predicate the admin screen uses, imported rather than re-derived — a preview
              that re-derives a rule is how the topbar ended up offering "Log out" and
              "Sign in" at once. */}
          {canEditProject(user, key) && (
            <Link to={`/admin?s=projects&key=${key}`}>
              <Button title={t('proj.edit.h', 'Edit this page, text, links, downloads, and the How it runs diagram')}>
                <Pencil size={15} /> {t('proj.edit', 'Edit page')}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {showVersions && <VersionHistoryModal endpoint={`/projects/${key}`} currentVersion={c.version} initial={typeof showVersions === 'string' ? showVersions : null} onClose={() => setShowVersions(false)} />}

      {/* links row */}
      <LinksRow links={c.links} />

      {/* tabs */}
      <div className="flex gap-2 mb-6 border-b border-[var(--line)] overflow-x-auto no-scrollbar">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {/* Not every tab has an icon: a custom tab is a title and a B.MD body, and it
                passes null here. React throws on a null element type — "Element type is
                invalid" — so one custom tab took the whole page down, which is the one thing
                an optional extra must never do. */}
            {Icon ? <Icon size={15} /> : null} {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} pkey={key} />}
      {tab === 'activity' && <ProjectActivity endpoint={`/projects/${key}/activity`} timeline={c.timeline} githubUrl={c.links?.github} />}
      {tab === 'releases' && <Releases pkey={key} />}
      {tab === 'versions' && <ProjectVersions base={`/projects/${key}`} onOpenSnapshot={(v) => setShowVersions(v)} />}
      {tab === 'docs' && <ProjectPages base={`/projects/${key}`} kind="doc" />}
      {tab === 'community' && <Community c={c} communityUrl={contribUrlOf(c) ? `/projects/${key}/community` : null} />}
      {tab === 'stack' && (
        <>
          <StackMap stack={c.stack} t={t} />
          {c.stack?.showCodeMap && <ProjectCodeMap projectKey={key} t={t} />}
          {/* Again here, because this is the tab whose content is most often wrong: a box
              named after a folder that was renamed, a component that no longer exists. The
              person who notices is looking at THIS. */}
          {canEditProject(user, key) && (
            <Link to={`/admin?s=projects&key=${key}`}
              className="inline-flex items-center gap-1.5 mt-6 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition">
              <Pencil size={12} /> {t('proj.edit.stack', 'Edit this diagram')}
            </Link>
          )}
        </>
      )}
      {tab === 'blog' && <ProjectBlogTab project={key} />}
      {tab === 'market' && <Marketplace pkey={key} products={marketProducts} onChanged={market.refetch} />}
      {tab === 'legal' && (preview ? <Legal c={c} />
        : <ProjectLegalTab base={`/projects/${key}`}><Legal c={c} quiet={ex.legal > 0} /></ProjectLegalTab>)}
      {tab.startsWith('c-') && (() => {
        const cv = canvasTabs.find((x) => `c-${x.id}` === tab);
        return cv ? <CanvasView canvas={cv} /> : null;
      })()}
      {tab.startsWith('x-') && (() => {
        const ct = customTabs.find((x) => `x-${x.id}` === tab);
        // Same wrapper the showcase page uses — two renderings of "a custom tab" would
        // drift, and a reader moving between a project and an Other project would see the
        // same feature look like two different things.
        return ct ? <Card className="p-5 sm:p-6"><Markdown>{ct.body}</Markdown></Card> : null;
      })()}
    </div>
  );
}

// BMM live-session preview. The recording already contains the app window, so we
// show it FRAMELESS (no chrome, no background) — it just floats.
function AppPreview({ pkey, replayUrl }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const useReplay = replayUrl && !failed;
  const mods = [['F/A-18C Sound Overhaul', 'Sound', true], ['Cockpit Glass HD', 'Cockpit', true], ['VFA-103 Liveries', 'Liveries', false], ['AB Afterburner FX', 'Effects', true], ['Carrier Ops Pack', 'Mission', false]];
  if (useReplay) {
    const move = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; const dy = (e.clientY - r.top) / r.height - 0.5; ref.current.style.transform = `perspective(1200px) rotateY(${dx * 18}deg) rotateX(${-dy * 15}deg) scale(1.02)`; };
    const rest = () => { if (ref.current) ref.current.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg) scale(1)'; };
    return (
      <div className="mb-8" style={{ perspective: 1200 }} onMouseMove={move} onMouseLeave={rest}>
        {/* simple framed window (no monitor bezel/stand) */}
        <div ref={ref} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border border-[var(--line-strong)] transition-transform duration-100 ease-out will-change-transform"
          style={{ transformOrigin: 'center', background: '#0a0b0f', boxShadow: '0 34px 80px -32px rgba(0,0,0,0.55)' }}>
          <RrwebPreview url={replayUrl} onFail={() => setFailed(true)} />
        </div>
      </div>
    );
  }
  const onMove = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; ref.current.style.transform = `perspective(1400px) rotateX(8deg) rotateY(${dx * 6}deg)`; };
  const reset = () => { if (ref.current) ref.current.style.transform = 'perspective(1400px) rotateX(10deg)'; };
  return (
    <div className="mb-8 -mt-2" style={{ perspective: 1400 }} onMouseMove={onMove} onMouseLeave={reset}>
      <div ref={ref} className="rounded-2xl overflow-hidden border border-[var(--line)] mx-auto max-w-3xl transition-transform duration-300"
        style={{ transform: 'perspective(1400px) rotateX(10deg)', transformOrigin: 'center top', background: 'var(--bg-solid)', boxShadow: '0 40px 90px -34px rgba(0,0,0,0.55)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#15171e', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="w-3 h-3 rounded-full bg-error-bg" /><span className="w-3 h-3 rounded-full bg-warning-bg" /><span className="w-3 h-3 rounded-full bg-success-bg" />
          <div className="flex-1 mx-3 h-6 rounded-md flex items-center px-3 text-[11px] text-slate-400" style={{ background: '#0d0f15', border: '1px solid rgba(255,255,255,0.06)' }}>{pkey.toUpperCase()} — {pkey === 'bmm' ? 'Mods' : pkey === 'bsm' ? 'Presets' : 'Library'}</div>
        </div>
        <div className="grid grid-cols-[130px_1fr]" style={{ background: '#0d0f15', color: '#e2e6ee', minHeight: 270 }}>
          <aside className="p-3" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-1.5 font-bold text-sm mb-3"><img src="/logo.png" alt="" className="logo-plate w-5 h-5 rounded" /><span style={{ color: '#f59e0b' }}>{pkey.toUpperCase()}</span></div>
            {['Installed', 'Catalog', 'Plugins', 'Themes', 'Server Repos', 'Settings'].map((s, i) => (
              <div key={s} className="px-2 py-1.5 rounded-lg text-xs mb-0.5" style={i === 0 ? { background: 'rgba(249,115,22,0.15)', color: '#fdba74' } : { color: '#9aa0ac' }}>{s}</div>
            ))}
          </aside>
          <main className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold">{t('prj.installedmods', "Installed mods")}</div><div className="text-[11px] px-2 py-1 rounded-md" style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74' }}>+ Add mod</div></div>
            <div className="space-y-2">
              {mods.map(([name, cat, on]) => (
                <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: '#15171e', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="w-7 h-7 rounded-md grid place-items-center text-xs font-bold" style={{ background: 'linear-gradient(135deg,#f97316,#f59e0b)', color: '#fff' }}>{name[0]}</div>
                  <div className="flex-1 min-w-0"><div className="text-xs font-medium truncate" title={name}>{name}</div><div className="text-[10px]" style={{ color: '#6f685d' }}>{cat}</div></div>
                  <div className="w-8 h-4 rounded-full relative" style={{ background: on ? '#f59e0b' : '#2a2d36' }}><div className="w-3 h-3 rounded-full bg-white absolute top-0.5" style={{ left: on ? 18 : 3 }} /></div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// ProgressTracker moved to ./progress-tracker.jsx (shared with the blog/docs
// `:::roadmap` Markdown block). Re-exported so existing importers (e.g.
// project-config-editor.jsx) keep resolving it from here.
export { ProgressTracker };

// Git-linked activity (B13): a commit heatmap, span stats, contributors and release markers,
// from GET /projects/:key/activity. Shared by the official and showcase project pages.
//
// The heatmap is a magnitude field, so it uses ONE hue light→dark (var(--primary) mixed with
// transparent) with a neutral empty cell and a Less→More legend — never a rainbow.
function heatColor(count) {
  if (!count) return 'var(--surface-2)';
  const pctMix = count >= 12 ? 100 : count >= 7 ? 75 : count >= 3 ? 50 : 28;
  return `color-mix(in srgb, var(--primary) ${pctMix}%, transparent)`;
}

// Project timeline (Prmtp123 §8): the manually-added events from config.timeline, MERGED with
// B13's git release markers into one chronological list — so a project's history reads in one
// place whether an entry came from a GitHub release or was written by hand.
const TL_KINDS = {
  release: 'primary', prerelease: 'amber', update: 'blue', announcement: 'primary', message: '', custom: '',
};
const TL_LABEL = { release: 'Release', prerelease: 'Pre-release', update: 'Update', announcement: 'Announcement', message: 'Message', custom: 'Event' };
export const TL_KIND_KEYS = ['release', 'update', 'announcement', 'message', 'custom'];
function buildTimeline(manual, gitMarkers) {
  const norm = (Array.isArray(manual) ? manual : [])
    .filter((e) => e && e.date && (e.title || e.body))
    .map((e) => ({ kind: TL_KINDS[e.kind] !== undefined ? e.kind : 'custom', date: String(e.date).slice(0, 10), title: e.title || '', body: e.body || '', url: /^https?:\/\//i.test(e.url || '') ? e.url : '', manual: true }));
  const git = (Array.isArray(gitMarkers) ? gitMarkers : [])
    .map((m) => ({ kind: m.kind === 'prerelease' ? 'prerelease' : 'release', date: m.date, title: m.title || m.tag || '', tag: m.tag, body: m.body || '', url: '', manual: false }));
  return [...norm, ...git].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function ProjectActivity({ endpoint, timeline, githubUrl }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState(false);
  // A tapped heatmap day. The hover title answers "how many commits" on desktop; a phone has
  // no hover, so tapping a cell shows the same detail in a line below — and links out to that
  // day on GitHub when the repo is known.
  const [selDay, setSelDay] = useState(null);
  const { data, loading, err } = useFetch(() => api.get(`${endpoint}${messages ? '?messages=1' : ''}`), [endpoint, messages]);
  const manual = Array.isArray(timeline) ? timeline : [];
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  // No git source (or GitHub unreachable): still show a hand-written timeline if there is one.
  if (err) {
    const tl = buildTimeline(manual, []);
    if (!tl.length) return <EmptyState icon={CalendarDays} title={t('act.err', 'Could not load activity')} sub={t('act.err.d', 'The repository may be private, or GitHub is rate-limiting reads right now.')} />;
    return <div className="space-y-6"><TimelineCard tl={tl} showBody={messages} onToggleBody={setMessages} t={t} /></div>;
  }
  const a = data || {};
  if (a.computing) return <EmptyState icon={CalendarDays} title={t('act.computing', 'Preparing activity…')} sub={t('act.computing.d', 'GitHub is building this repository’s statistics, open this tab again in a moment.')} />;

  const weeks = [];
  for (let i = 0; i < (a.heatmap || []).length; i += 7) weeks.push(a.heatmap.slice(i, i + 7));
  const maxContrib = Math.max(1, ...(a.contributors || []).map((c) => c.commits));
  const spanValue = a.spanYears >= 1 ? `${a.spanYears} y` : `${a.spanMonths} mo`;

  const Stat = ({ value, label, sub }) => (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs text-[var(--muted)] mt-0.5">{label}</div>
      {sub ? <div className="text-[11px] text-[var(--faint)] mt-0.5 truncate" title={sub}>{sub}</div> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat value={a.totalCommits ?? 0} label={t('act.commits', 'Commits')} />
        <Stat value={a.activeDays ?? 0} label={t('act.activedays', 'Active days')} sub={t('act.lastyear', 'last 12 months')} />
        <Stat value={spanValue} label={t('act.span', 'Worked over')} sub={a.firstCommit && a.lastCommit ? `${a.firstCommit} → ${a.lastCommit}` : ''} />
        <Stat value={(a.contributors || []).length} label={t('act.contributors', 'Contributors')} />
      </div>

      {!!weeks.length && (
        <Card className="p-5 overflow-x-auto">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">{t('act.heatmap', 'Commits per day')} <span className="text-[var(--faint)] font-normal">· {t('act.lastyear', 'last 12 months')}</span>{a.source?.branch && <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--accent-ink)]" title={t('act.branch.h', 'This project pins a branch; the activity is read from its commits (a rolling year).')}><GitBranch size={10} /> {a.source.branch}</span>}{a.source?.imported && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--muted)]" title={t('act.imported.h', 'Commits read from a git log the maintainers exported ({d}), the whole history, not just what GitHub’s statistics cover.').replace('{d}', a.source.importedAt ? new Date(a.source.importedAt).toLocaleDateString() : '')}><GitBranch size={10} /> {t('act.imported', 'full history')}{a.source.importedFrom ? ` · ${a.source.importedFrom}` : ''}</span>}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--faint)]">
              {t('act.less', 'Less')}
              {[0, 2, 4, 8, 13].map((n) => <span key={n} className="w-3 h-3 rounded-sm border border-[var(--line)]" style={{ backgroundColor: heatColor(n) }} />)}
              {t('act.more', 'More')}
            </div>
          </div>
          <div className="flex gap-[3px]" style={{ minWidth: 'max-content' }}>
            {weeks.map((wk, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {wk.map((d) => (
                  <button key={d.date} type="button" title={`${d.date}: ${d.count} ${t('act.commitsl', 'commit(s)')}`}
                    onClick={() => setSelDay((s) => (s?.date === d.date ? null : d))}
                    aria-label={`${d.date}: ${d.count}`}
                    className={`w-3 h-3 rounded-sm transition ${selDay?.date === d.date ? 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]' : ''}`}
                    style={{ backgroundColor: heatColor(d.count) }} />
                ))}
              </div>
            ))}
          </div>
          {/* The tapped day, in words — the detail a phone can't get from a hover title. */}
          {selDay ? (
            <div className="text-xs text-[var(--muted)] mt-3 flex items-center gap-2 flex-wrap">
              <b className="text-[var(--text)]">{selDay.date}</b> — {selDay.count} {t('act.commitsl', 'commit(s)')}
              {githubUrl && /github\.com\//.test(githubUrl) && (
                <a href={`${githubUrl.replace(/\/+$/, '')}/commits${a.source?.branch ? `/${encodeURIComponent(a.source.branch)}` : ''}?since=${selDay.date}&until=${selDay.date}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--accent-ink)] hover:underline">
                  <Github size={11} /> {t('act.viewday', 'View that day on GitHub')}
                </a>
              )}
            </div>
          ) : a.busiestDay ? <div className="text-[11px] text-[var(--muted)] mt-3">{t('act.busiest', 'Busiest day')}: {a.busiestDay.date} — {a.busiestDay.count} {t('act.commitsl', 'commit(s)')} · <span className="text-[var(--faint)]">{t('act.tapday', 'tap any day for details')}</span></div> : null}
        </Card>
      )}

      {/* Commits by year — the whole history, one bar per year, so a project's life can be
          compared year to year (not just the trailing 12 months the heatmap shows). Only when
          there is more than one year to compare. */}
      {(a.perYear || []).length > 1 && (() => {
        const maxY = Math.max(1, ...a.perYear.map((y) => y.commits));
        return (
          <Card className="p-5">
            <div className="text-sm font-semibold mb-3">{t('act.byyear', 'Commits by year')} <span className="text-[var(--faint)] font-normal">· {t('act.byyear.all', 'all time')}</span></div>
            <div className="space-y-2">
              {a.perYear.map((y) => (
                <div key={y.year} className="flex items-center gap-3">
                  <div className="w-12 shrink-0 text-sm tabular-nums font-medium">{y.year}</div>
                  <div className="flex-1 h-4 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${(y.commits / maxY) * 100}%`, backgroundColor: 'var(--primary)' }} /></div>
                  <div className="w-14 text-end text-xs tabular-nums text-[var(--muted)]">{y.commits}</div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {!!(a.contributors || []).length && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3">{t('act.contributors', 'Contributors')}</div>
          <div className="space-y-2">
            {a.contributors.slice(0, 20).map((c) => {
              // A real face beside the name. The avatar + name link to the GitHub profile when
              // we have it; otherwise it's a plain row (a monogram fallback if there's no photo).
              const Name = c.url ? 'a' : 'div';
              const nameProps = c.url ? { href: c.url, target: '_blank', rel: 'noreferrer' } : {};
              return (
                <div key={c.name} className="flex items-center gap-3">
                  {c.avatar
                    ? <img src={c.avatar} alt="" loading="lazy" className="w-7 h-7 rounded-full shrink-0 border border-[var(--line)] bg-[var(--surface-2)]" />
                    : <span className="w-7 h-7 rounded-full shrink-0 grid place-items-center bg-[var(--surface-2)] border border-[var(--line)] text-[11px] font-semibold text-[var(--muted)]">{String(c.name || '?').slice(0, 1).toUpperCase()}</span>}
                  <Name {...nameProps} className={`w-28 sm:w-32 shrink-0 truncate text-sm ${c.url ? 'hover:text-[var(--accent-ink)] hover:underline' : ''}`} title={c.name}>{c.name}</Name>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(c.commits / maxContrib) * 100}%`, backgroundColor: 'var(--primary)' }} />
                  </div>
                  <div className="w-12 text-end text-xs tabular-nums text-[var(--muted)]">{c.commits}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(() => { const tl = buildTimeline(manual, a.markers); return tl.length
        ? <TimelineCard tl={tl} showBody={messages} onToggleBody={setMessages} t={t} />
        : null; })()}
    </div>
  );
}

// One chronological card of timeline entries (manual events + git releases). The "show notes"
// toggle reveals the git release bodies (fetched with ?messages=1) and any manual event body.
function TimelineCard({ tl, showBody, onToggleBody, t }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-sm font-semibold">{t('act.timeline', 'Timeline')}</div>
        <label className="flex items-center gap-2 text-[12px] text-[var(--muted)] cursor-pointer select-none">
          <input type="checkbox" className="accent-[var(--primary)]" checked={showBody} onChange={(e) => onToggleBody(e.target.checked)} />
          {t('act.shownotes', 'Show notes')}
        </label>
      </div>
      <div className="space-y-2">
        {tl.map((m, i) => (
          <div key={`${m.date}-${i}`} className="rounded-lg border border-[var(--line)] p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TL_KINDS[m.kind] || ''}>{m.tag || t(`tl.kind.${m.kind}`, TL_LABEL[m.kind] || m.kind)}</Badge>
              {m.title ? (m.url
                ? <a href={m.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{m.title}</a>
                : <span className="text-sm font-medium">{m.title}</span>) : null}
              <span className="text-[11px] text-[var(--faint)] ms-auto">{m.date}</span>
            </div>
            {/* Notes render as Markdown now (a release body or a hand-written event both read
                better with headings, lists and links than as one pre-wrapped block). */}
            {showBody && m.body ? <div className="text-[12px] text-[var(--muted)] mt-2 leading-relaxed prose-sm"><Markdown>{m.body}</Markdown></div> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

// A YouTube / Twitch / direct-media URL, resolved to how it should be shown. Twitch needs the
// host as its `parent`, which is why it is read from location here rather than baked in.
function embedFor(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  const tvVid = u.match(/twitch\.tv\/videos\/(\d+)/);
  if (tvVid) return { type: 'iframe', src: `https://player.twitch.tv/?video=${tvVid[1]}&parent=${host}&autoplay=false` };
  const tvCh = u.match(/twitch\.tv\/([A-Za-z0-9_]+)/);
  if (tvCh) return { type: 'iframe', src: `https://player.twitch.tv/?channel=${tvCh[1]}&parent=${host}&autoplay=false` };
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) return { type: 'video', src: u };
  return { type: 'link', src: u };
}

const FEAT_META = {
  update: { icon: Rocket, tone: 'primary', label: 'Update' },
  video: { icon: Play, tone: '', label: 'Video' },
  live: { icon: Radio, tone: 'red', label: 'Live' },
  message: { icon: Megaphone, tone: 'amber', label: 'Announcement' },
};

function FeaturedCard({ f, t }) {
  const meta = FEAT_META[f.kind] || FEAT_META.update;
  const Icon = meta.icon;
  const embed = (f.kind === 'video' || f.kind === 'live') ? embedFor(f.url) : null;
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      {embed?.type === 'iframe' && (
        <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
          <iframe title={f.title || meta.label} src={embed.src} className="absolute inset-0 w-full h-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      )}
      {embed?.type === 'video' && <video src={embed.src} controls preload="metadata" className="w-full max-h-72 bg-black" />}
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <Badge tone={meta.tone}>{f.kind === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse me-1 inline-block" />}<Icon size={11} /> {t(`proj.feat.${f.kind}`, meta.label)}</Badge>
          {f.title && <span className="font-semibold text-sm">{f.title}</span>}
        </div>
        {f.body && <div className="text-[13px] text-[var(--muted)] leading-relaxed prose-sm"><Markdown>{f.body}</Markdown></div>}
        {embed?.type === 'link' && f.url && <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent-ink)] hover:underline mt-2">{t('proj.feat.open', 'Open')} <ExternalLink size={11} /></a>}
      </div>
    </Card>
  );
}

// A configurable headline counter. Three kinds:
//   static    — a fixed number the admin types (downloads, members, a version…).
//   countdown — ticks down to a target date/time, live, then shows a done label.
//   live      — pulls a number from a source URL (a GitHub-releases download total, a hosting
//               stats endpoint, anything that returns a number or {value|count|downloads}),
//               refreshing on a light interval. This is the "download counter from the page,
//               or anything else" case, without hardcoding one source.
// Milliseconds-to-target countdown (distinct from the object-returning useCountdown above,
// which the announcement banner uses). The headline Counter needs the raw ms to format itself.
function useCountdownMs(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  const ms = target ? new Date(target).getTime() - now : 0;
  return ms;
}
function useLiveNumber(source) {
  const [n, setN] = useState(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = source.startsWith('/') ? await api.get(source) : await fetch(source).then((x) => x.json());
        const v = typeof r === 'number' ? r : (r?.value ?? r?.count ?? r?.downloads ?? r?.total);
        if (alive && typeof v === 'number' && Number.isFinite(v)) setN(v);
      } catch { /* keep the last good value, or the static fallback below */ }
    };
    pull();
    const id = setInterval(pull, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [source]);
  return n;
}
function Counter({ cnt, pkey }) {
  const { t } = useI18n();
  const kind = ['countdown', 'live', 'downloads'].includes(cnt.kind) ? cnt.kind : 'static';
  const ms = useCountdownMs(kind === 'countdown' ? cnt.target : null);
  // 'downloads' reads the real click count for this project; 'live' reads an arbitrary URL.
  const liveSrc = kind === 'live' ? cnt.source : (kind === 'downloads' && pkey ? `/projects/${pkey}/downloads/count` : null);
  const live = useLiveNumber(liveSrc);
  let value = cnt.value;
  if (kind === 'live' || kind === 'downloads') value = (live != null ? live.toLocaleString() : (cnt.value || '—'));
  if (kind === 'countdown') {
    if (!cnt.target) return null;
    if (ms <= 0) value = cnt.doneLabel || cnt.value || '🎉';
    else {
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      const pad = (x) => String(x).padStart(2, '0');
      value = d > 0 ? `${d}${t('proj.cnt.d', 'd')} ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
    }
  }
  return (
    <div className="rounded-2xl border border-[var(--line)] p-6 text-center"
      style={{ backgroundImage: 'linear-gradient(to bottom right, color-mix(in srgb, var(--primary) 6%, transparent), transparent)' }}>
      <div className="text-4xl sm:text-5xl font-extrabold tabular-nums gradient-text">{value}</div>
      {cnt.label && <div className="text-sm text-[var(--muted)] mt-1">{cnt.label}</div>}
      {cnt.sub && <div className="text-xs text-[var(--faint)] mt-0.5">{cnt.sub}</div>}
    </div>
  );
}

function Overview({ c, pkey, progressUrl }) {
  const { t, lang } = useI18n();
  // Progress comes from a dedicated endpoint (remote source or inline config).
  const url = progressUrl || `/projects/${pkey}/progress`;
  const { data, loading } = useFetch(() => api.get(url).catch(() => null), [url]);
  const prog = data?.progress;
  const featured = (Array.isArray(c.featured) ? c.featured : []).filter((f) => f && (f.title || f.url || f.body)).slice(0, 8);
  // A counter is worth showing when it can actually render something: a value/label (static),
  // a target (countdown), or a source (live).
  const cc = c.counter;
  const counter = cc && cc.enabled !== false && (cc.value || cc.label || (cc.kind === 'countdown' && cc.target) || (cc.kind === 'live' && cc.source) || cc.kind === 'downloads') ? cc : null;
  const hasAnything = c.media || c.replayUrl || featured.length || counter || prog;
  return (
    <div className="space-y-8">
      {c.media && <MediaFrame media={c.media} pkey={pkey} />}
      {!c.media && c.replayUrl && <AppPreview pkey={pkey} replayUrl={c.replayUrl} />}

      {/* A headline number the project wants front and centre — downloads, members, a version,
          a live countdown — whatever the admin sets. */}
      {counter && <Counter cnt={counter} pkey={pkey} />}

      {/* Highlights — updates, videos, live streams, announcements — the "more than a roadmap"
          part of the overview. */}
      {featured.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles size={16} className="text-[var(--accent-ink)]" /> {t('proj.featured', 'Highlights')}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {featured.map((f, i) => <FeaturedCard key={i} f={f} t={t} />)}
          </div>
        </div>
      )}

      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading')}</div>
        : prog ? <ProgressTracker data={prog} title={t('proj.progress')} lang={lang} />
        : !hasAnything ? (
          <EmptyState icon={Sparkles} title={t('proj.overview.empty.t', 'This page is just getting started')}
            sub={t('proj.overview.empty.s', 'Highlights, a progress tracker, and the latest updates will appear here as the project takes shape. Check the other tabs for more.')} />
        ) : null}
    </div>
  );
}

function Releases({ pkey, releasesUrl }) {
  const { t, lang } = useI18n();
  const url = releasesUrl || `/projects/${pkey}/releases`;
  const { data, loading, err } = useFetch(() => api.get(url), [url]);
  const [active, setActive] = useState(null); // the note open in the reader
  const [md, setMd] = useState(''); const [mdLoading, setMdLoading] = useState(false);
  const [closed, setClosed] = useState({}); // per-folder collapse overrides

  // Keep only notes for the active language (*_EN / *_FR + neutral).
  const allFiles = data?.files || [];
  let files = allFiles.filter((f) => matchesLang(f.name, lang));
  if (!files.length) files = allFiles;

  // Load the selected note's markdown into the reader modal.
  useEffect(() => {
    if (!active) { setMd(''); return; }
    setMdLoading(true); setMd('');
    fetch(active.rawUrl).then((r) => r.text()).then(setMd).catch(() => setMd('*Failed to load.*')).finally(() => setMdLoading(false));
  }, [active]);

  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>;
  if (err || !allFiles.length) return <EmptyState icon={ScrollText} title={t('proj.rel.none.t', 'No release notes yet')}
    sub={t('proj.rel.none.s', 'Release notes are read from the project’s GitHub repository, and none have been published there yet.')}
    hint={t('proj.rel.none.h', 'The GitHub source is set by the project’s admins.')} />;

  const groups = {};
  for (const f of files) (groups[f.dir || 'Latest'] ||= []).push(f);
  const dirs = Object.keys(groups);
  // Collapsed by default when there are several folders; a lone folder stays open.
  const defClosed = dirs.length > 1;
  const isClosed = (dir) => (dir in closed ? closed[dir] : defClosed);
  const toggle = (dir) => setClosed((s) => ({ ...s, [dir]: !isClosed(dir) }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><ScrollText size={16} className="text-[var(--accent-ink)]" /> {t('proj.releases')}</h2>
        <span className="text-xs text-[var(--muted)]">{files.length} {lang === 'fr' ? 'note(s)' : 'note(s)'}</span>
      </div>

      <div className="space-y-3">
        {dirs.map((dir) => {
          const gclosed = isClosed(dir);
          return (
            <Card key={dir} className="p-0 overflow-hidden">
              <button onClick={() => toggle(dir)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--surface-2)] transition text-start">
                <FolderGit2 size={14} className="text-[var(--accent-ink)] shrink-0" />
                <span className="font-medium text-sm truncate" title={dir}>{dir}</span>
                <Badge>{groups[dir].length}</Badge>
                <ChevronDown size={16} className={`ms-auto shrink-0 text-[var(--faint)] transition-transform ${gclosed ? '-rotate-90' : ''}`} />
              </button>
              {!gclosed && (
                <div className="border-t border-[var(--line)] divide-y divide-[var(--line)]">
                  {groups[dir].map((f) => { const I = noteIcon(f.name); return (
                    <button key={f.path} onClick={() => setActive(f)} className="group w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-[var(--surface-2)] transition">
                      <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] group-hover:bg-[var(--bg-solid)] transition shrink-0"><I size={16} className="text-[var(--accent-ink)]" /></span>
                      <span className="flex-1 min-w-0 text-sm font-medium truncate" title={f.name}>{f.name}</span>
                      <span className="text-xs text-[var(--muted)] flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">{lang === 'fr' ? 'Lire' : 'Read'} <ChevronRight size={13} /></span>
                    </button>
                  ); })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Reader — a modal on every breakpoint, with a clear close affordance. */}
      {active && (
        <Modal open onClose={() => setActive(null)} title={active.name} icon={noteIcon(active.name)} width="max-w-3xl"
          footer={<Button variant="ghost" onClick={() => setActive(null)}>{lang === 'fr' ? 'Fermer' : 'Close'}</Button>}>
          {mdLoading ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading')}</div>
            : <div className="max-h-[65vh] overflow-auto pe-1"><Markdown>{md}</Markdown></div>}
        </Modal>
      )}
    </div>
  );
}

function MessageTicker({ messages }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  useEffect(() => { if (messages.length < 2) return; const id = setInterval(() => setI((x) => (x + 1) % messages.length), 4500); return () => clearInterval(id); }, [messages.length]);
  if (!messages.length) return null;
  return (
    <section>
      <h2 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare size={16} className="text-[var(--accent-ink)]" /> {t('proj.messages')}</h2>
      <Card className="p-8 text-center relative overflow-hidden min-h-[120px] grid place-items-center">
        <p key={i} className="anim-fade text-lg md:text-xl text-[var(--text)] max-w-2xl mx-auto leading-relaxed">“{messages[i].message}”</p>
        {messages.length > 1 && <div className="flex gap-1.5 justify-center mt-5">{messages.map((_, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-[var(--primary)]' : 'bg-[var(--line-strong)]'}`} />)}</div>}
      </Card>
    </section>
  );
}

// Contributor categories. Early-access and PTB testers keep their own per-person
// tag (their `role`) but live under ONE combined category.
const CAT_META = {
  staff: { label: 'Staff', order: 0 },
  kofi: { label: 'Ko-fi Supporters', order: 1 },
  testers: { label: 'Early Access Tester & PTB Tester', order: 2 },
  contributors: { label: 'Contributors', order: 3 },
};
function resolveCat(p) {
  const cat = (p.category || '').toLowerCase();
  const sub = (p.subcategory || '').toLowerCase();
  if (cat === 'staff') return 'staff';
  if (cat === 'tester' || sub === 'early_access' || sub === 'ptb' || sub === 'early-access') return 'testers';
  if (cat === 'kofi' || cat === 'ko-fi' || cat === 'supporter') return 'kofi';
  return 'contributors';
}
const toMessages = (arr) => (arr || []).map((m) => (typeof m === 'string' ? { message: m } : m)).filter((m) => m.message);

// Contributors, their messages and the JSON URL live under `community.*` in the current
// config shape — what the visual editor writes and what the showcase pages read — but at the
// top level in configs written before that migration. Prefer the current location, fall back
// to the legacy one, so a project page renders whichever an admin actually saved.
//
// This is the whole of the "I configure contributors/legal and nothing shows" bug: the
// editor moved to `community.*` and `legal[]`, and only the fixed-project renderers were left
// reading the old flat shape.
const contribOf = (c) => (Array.isArray(c.community?.contributors) && c.community.contributors.length ? c.community.contributors : (c.contributors || []));
const messagesOf = (c) => (c.community?.messages ?? c.messages);
const contribUrlOf = (c) => c.community?.contributorsUrl || c.contributorsUrl || '';

function Community({ c, communityUrl }) {
  const { t } = useI18n();
  const [people, setPeople] = useState(contribOf(c));
  const [messages, setMessages] = useState(toMessages(messagesOf(c)));
  useEffect(() => {
    if (!communityUrl) { setPeople(contribOf(c)); setMessages(toMessages(messagesOf(c))); return; }
    let on = true;
    // Proxied through the API (cached + covered by "Refresh site caches") instead
    // of a direct browser fetch to the raw GitHub URL, which no admin action
    // could ever force to refresh.
    api.get(communityUrl).then(({ data: d }) => {
      if (!on || !d) return;
      const base = c.pfpBase || '';
      setPeople((d.contributors || []).map((p) => ({
        name: p.display_name || p.username || p.name, role: p.role, description: p.description,
        category: resolveCat(p),
        pfp: p.pfp ? (/^https?:/.test(p.pfp) ? p.pfp : base + p.pfp.replace(/^\/+/, '')) : '',
        links: { github: p.github, website: p.website },
      })));
      // Prefer the real community messages shipped alongside the contributors.
      if (Array.isArray(d.messages) && d.messages.length) setMessages(toMessages(d.messages));
    }).catch(() => {});
    return () => { on = false; };
  }, [communityUrl]);
  const cats = {};
  for (const p of people) { (cats[p.category || 'contributors'] ||= []).push(p); }
  const ordered = Object.entries(cats).sort((a, b) => (CAT_META[a[0]]?.order ?? 9) - (CAT_META[b[0]]?.order ?? 9));
  if (!people.length && !messages.length) return <EmptyState icon={Users} title={t('proj.nocontrib')}
    sub={t('proj.nocontrib.s', 'The people credited on this project are listed here, and none have been published yet.')}
    hint={t('proj.nocontrib.h', 'The contributor list is set by the project’s admins.')} />;
  return (
    <div className="space-y-10">
      <MessageTicker messages={messages} />
      {ordered.map(([cat, list]) => (
        <section key={cat}>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Users size={16} className="text-[var(--accent-ink)]" /> {CAT_META[cat]?.label || cat} <span className="text-sm font-normal text-[var(--faint)]">· {list.length}</span></h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((p, i) => (
              <Card key={i} hover className="p-5 group transition-all duration-200 hover:-translate-y-1">
                <div className="flex items-center gap-3">
                  {p.pfp ? <img src={p.pfp} alt="" loading="lazy" className="w-12 h-12 rounded-full object-cover border border-[var(--line)] transition-transform duration-200 group-hover:scale-110 group-hover:border-[var(--primary)]" />
                    : <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] border border-[var(--line)] grid place-items-center text-[var(--text)] font-bold transition-transform duration-200 group-hover:scale-110">{(p.name || '?')[0]}</div>}
                  <div className="min-w-0"><div className="font-semibold truncate group-hover:text-[var(--accent-ink)] transition-colors" title={p.name}>{p.name}</div><div className="text-xs text-[var(--accent-ink)]">{p.role}</div></div>
                </div>
                {p.description && <p className="text-sm text-[var(--muted)] mt-3 line-clamp-3">{p.description}</p>}
                {p.links && <div className="flex gap-2 mt-3">{Object.entries(p.links).filter(([, v]) => v).map(([k, v]) => { const m = LINK_META[k] || { icon: ExternalLink }; return <a key={k} href={v} target="_blank" rel="noreferrer" className="text-[var(--muted)] hover:text-[var(--accent-ink)]"><m.icon size={16} /></a>; })}</div>}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// A legal card's icon name (as stored by toCurrentShape) to a component.
const LEGAL_ICON = { ShieldCheck, Scale: ShieldCheck, FileText, ScrollText, BookOpen };

function Legal({ c, quiet = false }) {
  const { t } = useI18n();
  const { lang } = useI18n();
  const pick = (en, fr) => (lang === 'fr' && fr) ? fr : en;
  // The current shape is an ARRAY of {icon, title, url} cards (what the editor writes and the
  // showcase page renders); older configs store an OBJECT of fixed license/tos/privacy/readme
  // links. Read whichever this project has.
  const arr = Array.isArray(c.legal) ? c.legal : null;
  const obj = (!arr && c.legal && typeof c.legal === 'object') ? c.legal : {};
  const docs = arr
    ? arr.filter((card) => card && card.url).map((card) => ({
        icon: LEGAL_ICON[card.icon] || ShieldCheck, title: card.title || 'Document', sub: card.sub || '', url: card.url,
      }))
    : [
      obj.licenseUrl && { icon: Scale, title: obj.license || 'License', sub: 'Open-source license', url: obj.licenseUrl },
      (obj.tos || obj.tosFr) && { icon: ShieldCheck, title: 'Terms of Use', sub: 'How you may use the app', url: pick(obj.tos, obj.tosFr) },
      (obj.privacy || obj.privacyFr) && { icon: FileText, title: 'Privacy Policy', sub: 'How your data is handled', url: pick(obj.privacy, obj.privacyFr) },
      (obj.readme || obj.readmeFr) && { icon: BookOpen, title: 'README', sub: 'Project documentation', url: pick(obj.readme, obj.readmeFr) },
    ].filter(Boolean);
  // The license summary card only applies to the legacy object shape.
  const legacyLicense = obj.license;
  // The project's own legal pages are drawn above: an empty list of links is not "no legal documents".
  if (!docs.length && quiet) return null;
  if (!docs.length) return <EmptyState icon={ShieldCheck} title={t('proj.legal.none', 'No legal documents')}
    sub={t('proj.legal.none.s', 'The licence, terms, privacy policy and README for this project appear here, and none have been published yet.')}
    hint={t('proj.legal.noneSub', 'License / ToS / Privacy / README are set in the admin dashboard.')} />;
  return (
    <div className="max-w-2xl">
      {legacyLicense && <Card className="p-5 mb-4 flex items-center gap-3 bg-gradient-to-r from-[var(--primary)] to-transparent">
        <ShieldCheck size={20} className="text-[var(--accent-ink)]" />
        <div className="flex-1"><div className="font-semibold">{t('proj.licensedUnder', 'Licensed under')} {legacyLicense}</div><div className="text-xs text-[var(--muted)]">{t('proj.openSource', 'This project is open source.')}</div></div>
      </Card>}
      <div className="grid sm:grid-cols-2 gap-3">
        {docs.map((d) => (
          <a key={d.title} href={d.url} target="_blank" rel="noreferrer">
            <Card hover className="p-4 flex items-center gap-3 h-full"><d.icon size={18} className="text-[var(--accent-ink)]" />
              <div className="flex-1 min-w-0"><div className="font-medium">{d.title}</div><div className="text-xs text-[var(--muted)]">{d.sub}</div></div>
              <ExternalLink size={15} className="text-[var(--faint)]" /></Card>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  Other projects (showcase)  ───────────────────────── */

// Public list of admin-curated "other projects".
/**
 * Asking for a project to be listed here.
 *
 * Shown ONLY when an admin has opened one of the two doors. With both shut this renders
 * nothing at all — not a disabled button, not a "coming soon": an invitation on a site whose
 * owner is not reading submissions is worse than no invitation.
 *
 * The free and paid doors are independent. Either, both, or neither.
 */
function RequestListing() {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', short: '', url: '', icon: '', description: '', pitch: '', isOpenSource: true, license: '', ownership: 'owner' });
  const [proof, setProof] = useState(null);   // { key, name } once uploaded (closed-source)
  const [uploading, setUploading] = useState(false);
  const [tos, setTos] = useState(false);      // accepted the Submission Terms
  const [payAck, setPayAck] = useState(false); // acknowledged the payment is non-refundable

  useEffect(() => { api.get('/showcase-requests/config').then(setCfg).catch(() => setCfg(null)); }, []);

  // A kept draft (ui/drafts.jsx). Twelve fields, a pitch written for a human to read, and a
  // last step that leaves for Stripe — coming back from an abandoned checkout used to mean
  // coming back to an empty form. `proof` rides along because it is a {key, name} pointing at
  // an upload that already happened, not the file itself; `tos` and `payAck` deliberately do
  // not, because an acknowledgement restored from a cache is one nobody gave this time.
  // Declared above the early return below: hooks cannot be conditional.
  const draftValue = useMemo(() => ({ f, proof }), [f, proof]);
  const draft = useDraft({
    scope: 'showcase-request', id: null, value: draftValue,
    onRestore: (v) => { if (v.f) setF((s) => ({ ...s, ...v.f })); setProof(v.proof || null); setOpen(true); },
  });

  if (!cfg || (!cfg.requestsEnabled && !cfg.paidEnabled)) return null;

  const money = (c, cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((c || 0) / 100);
  // Estimate formatting — hours if under two days, else rounded days.
  const dur = (h) => (h >= 48 ? t('rl.days', '{n} days').replace('{n}', String(Math.round(h / 24))) : t('rl.hours', '{n}h').replace('{n}', String(h)));
  const est = cfg.estimate;
  const closed = !f.isOpenSource;
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  const uploadProof = async (file) => {
    if (!file) return;
    setUploading(true);
    try { const key = await uploadPayload('PROOF', file); setProof({ key, name: file.name }); }
    catch (e) { toast.error(e?.status === 413 ? t('rl.prooftoobig', 'That file is too large (25 MB max).') : e?.status === 415 ? t('rl.proofbadtype', 'Use an image or a PDF.') : t('rl.prooffail', 'Upload failed.')); }
    finally { setUploading(false); }
  };

  // The gate: name + label + accepted terms, plus either a licence (open-source) or ownership
  // + proof (closed-source). The paid button additionally needs the non-refundable ack.
  const baseOk = !!user && f.name.trim() && f.short.trim() && tos
    && (closed ? (f.ownership === 'owner' && !!proof) : !!f.license.trim());

  const submit = async (paid) => {
    if (!f.name.trim() || !f.short.trim()) return toast.error(t('rl.need', 'A name and a short label are required.'));
    setBusy(true);
    try {
      const r = await api.post('/showcase-requests', {
        ...f, paid, tosAccepted: tos,
        proofKey: proof?.key || '', proofName: proof?.name || '',
      });
      // A paid request answers with a checkout URL. Following it is the whole point, so it
      // happens here rather than behind a second button somebody has to find.
      draft.clear();
      if (r?.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      toast.success(t('rl.sent2', 'Sent \u2014 we will reply either way. If we need more detail, you will find a thread in your dashboard under Reports & contact.'));
      setOpen(false);
      setF({ name: '', short: '', url: '', icon: '', description: '', pitch: '', isOpenSource: true, license: '', ownership: 'owner' });
      setProof(null); setTos(false); setPayAck(false);
    } catch (e) {
      const code = e?.body?.error;
      toast.error(
        code === 'too_many_open' ? t('rl.toomany', 'You already have the maximum number of requests waiting for an answer.')
          : code === 'payments_unavailable' ? t('rl.nopay', 'Payments are unavailable right now \u2014 your request was saved, unpaid.')
            : code === 'tos_required' ? t('rl.tosreq', 'Please accept the Submission Terms first.')
              : code === 'closed_needs_owner' ? t('rl.closedowner', 'A closed-source project can only be submitted by its rights-holder.')
                : code === 'closed_needs_proof' ? t('rl.closedproof', 'A closed-source project needs proof of rights attached.')
                  : code === 'license_required' ? t('rl.licreq', 'Name the licence for an open-source project.')
                    : code === 'bad_proof_key' ? t('rl.badproof', 'That proof upload was not recognised \u2014 try uploading it again.')
                      : t('rl.fail', 'Could not send that.'));
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5 mt-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[var(--accent-ink)] shrink-0">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t('rl.title', 'Built something? Ask to be listed here.')}</div>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t('rl.sub', 'Tell us what it is and we will take a look. Every request gets an answer, and a page only goes up once somebody here has read it.')}
          </p>
        </div>
        {!open && <Button onClick={() => setOpen(true)}>{t('rl.open', 'Ask to be listed')}</Button>}
      </div>

      <DraftBanner draft={draft} what={t('draft.w.listing', 'listing request')} className="mt-4" />

      {open && (
        <div className="mt-4 pt-4 border-t border-[var(--line)]">
          {!user && <p className="text-sm text-warning mb-3">{t('rl.signin', 'Sign in first \u2014 a request is a conversation, and we need somewhere to send the answer.')}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('rl.name', 'Project name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="My Project" /></Field>
            {/* Not derived from the name: "Better Sound Maker" would become "BET", and the
                whole point of the field is that a person picks the letters. */}
            <Field label={t('rl.short', 'Short label')} hint={t('rl.shorthint', '3\u20134 characters, shown on the card and in the topbar.')}>
              <Input value={f.short} maxLength={8} onChange={(e) => setF({ ...f, short: e.target.value })} placeholder="MYP" />
            </Field>
            <Field label={t('rl.url', 'Where it lives')}><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://github.com/you/project" /></Field>
            <Field label={t('rl.icon', 'Icon URL')}><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} placeholder="https://…/icon.png" /></Field>
            <div className="sm:col-span-2">
              <Field label={t('rl.desc', 'What it does')}><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t('rl.pitch', 'Why it belongs here')} hint={t('rl.pitchhint', 'The part a reviewer actually reads.')}>
                <Textarea rows={3} value={f.pitch} onChange={(e) => setF({ ...f, pitch: e.target.value })} />
              </Field>
            </div>

            {/* ── Licence, source & ownership ─────────────────────────────── */}
            <div className="sm:col-span-2 pt-2 border-t border-[var(--line)]">
              <div className="text-xs font-semibold mb-2">{t('rl.src.h', 'Licence & ownership')}</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {[['open', true], ['closed', false]].map(([k, v]) => (
                  <button key={k} type="button" onClick={() => set({ isOpenSource: v, ownership: v ? f.ownership : 'owner' })}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition ${f.isOpenSource === v ? 'border-[var(--primary)] panel text-[var(--accent-ink)] font-medium' : 'border-[var(--line)] panel text-[var(--muted)] hover:b-primary'}`}>
                    {k === 'open' ? t('rl.src.open', 'Open source') : t('rl.src.closed', 'Closed source')}
                  </button>
                ))}
              </div>

              {f.isOpenSource ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label={t('rl.license', 'Licence')} hint={t('rl.license.h', 'e.g. MIT, GPL-3.0, Apache-2.0.')}>
                    <Input value={f.license} onChange={(e) => set({ license: e.target.value })} placeholder="MIT" />
                  </Field>
                  <Field label={t('rl.own', 'Your relationship to it')}>
                    <div className="flex flex-col gap-1.5 pt-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="ownership" checked={f.ownership === 'owner'} onChange={() => set({ ownership: 'owner' })} /> {t('rl.own.owner', 'It’s my project')}</label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="ownership" checked={f.ownership === 'fan'} onChange={() => set({ ownership: 'fan' })} /> {t('rl.own.fan', 'A project I like (not mine)')}</label>
                    </div>
                  </Field>
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--line)] panel p-3">
                  <p className="text-[11px] text-[var(--muted)] mb-2">{t('rl.closed.note', 'We list closed-source projects too — but only at the request of the rights-holder, and only with proof of rights (a licence, an invoice, a signed statement). Your document is stored privately, shown only to review staff, and deleted once we decide.')}</p>
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => uploadProof(e.target.files?.[0])} />
                    <span className="btn btn-sm">{uploading ? <Spinner /> : (proof ? t('rl.proof.replace', 'Replace proof') : t('rl.proof.add', 'Attach proof of rights'))}</span>
                    {proof && <span className="text-xs text-success truncate max-w-[200px]">✓ {proof.name}</span>}
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Estimated wait \u2014 shown BEFORE paying. Queue-driven, and explicitly an estimate:
              paying is priority, not a guarantee. */}
          {est && (
            <div className="mt-4 rounded-lg border border-[var(--line)] panel p-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Clock size={13} className="text-[var(--accent-ink)]" />
                <span className="text-[var(--muted)]">{t('rl.est.free', 'Typical wait: {r}').replace('{r}', `${dur(est.freeLowH)}\u2013${dur(est.freeHighH)}`)}</span>
                {cfg.paidEnabled && <span className="text-[var(--muted)]">\u00b7 {t('rl.est.paid', 'paid (priority): {r}').replace('{r}', `${dur(est.paidLowH)}\u2013${dur(est.paidHighH)}`)}</span>}
              </div>
              <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('rl.est.note', 'An estimate, from how many requests are waiting right now ({n} pending) \u2014 not a promise. Paying moves you up the queue but does not guarantee a time: you may still wait.').replace('{n}', String(est.pendingCount))}</p>
            </div>
          )}

          {/* The terms gate. The buttons stay disabled until these are ticked. */}
          <div className="mt-3 space-y-1.5">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={tos} onChange={(e) => setTos(e.target.checked)} />
              <span>{t('rl.tos.pre', 'I have read and accept the')} <Link to="/legal/submissions" target="_blank" className="text-[var(--accent-ink)] underline">{t('rl.tos.link', 'Submission Terms')}</Link>{t('rl.tos.post', ', and I confirm my declarations above are accurate.')}</span>
            </label>
            {cfg.paidEnabled && (
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={payAck} onChange={(e) => setPayAck(e.target.checked)} />
                <span>{t('rl.pay.ack', 'I understand a paid review fee is NON-REFUNDABLE \u2014 it buys a place in the queue and priority, not a listing and not a guaranteed time.')}</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3">
            {cfg.requestsEnabled && (
              <Button disabled={busy || !baseOk} onClick={() => submit(false)}>{busy ? <Spinner /> : t('rl.send', 'Send the request')}</Button>
            )}
            {cfg.paidEnabled && (
              <Button variant={cfg.requestsEnabled ? 'ghost' : 'primary'} disabled={busy || !baseOk || !payAck} onClick={() => submit(true)}>
                {t('rl.pay', 'Pay {p} to be reviewed sooner').replace('{p}', money(cfg.priceCents, cfg.currency))}
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          </div>
          {!user && <p className="text-[11px] text-warning mt-2">{t('rl.signin.short', 'Sign in to submit \u2014 we need somewhere to send the answer.')}</p>}

          {cfg.maxOpenPerUser > 0 && (
            <p className="text-[11px] text-[var(--faint)] mt-1">
              {t('rl.cap', 'Up to {n} requests can be waiting for an answer at once.').replace('{n}', String(cfg.maxOpenPerUser))}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * "Other projects" — the /projects grid.
 *
 * Three things were wrong with it, and only one of them was cosmetic.
 *
 *   · The cards did not line up. Each one is a `<Card h-full>` inside a bare `<Link>`, and an
 *     `<a>` is display:inline, so `h-full` resolved against a box with no height: a row of
 *     three cards was three different heights, stepping down wherever a tagline happened to
 *     stop. The Link is a block that fills its grid cell now, and the cards match.
 *   · There was no way to tell a shipped project from an announced one except a small line of
 *     grey text, and no way to find anything: no search, no count, no ordering. A grid is
 *     fine for six projects and useless for thirty.
 *   · The icon was `Boxes`, which is also the catalogue's icon, the topbar's Projects icon
 *     and the icon on two of its own empty states. `Orbit` belongs to this page: the Better*
 *     projects orbiting the one in the middle is what the page is for, and it matches the
 *     orb the whole site is built around.
 */
export function OtherProjects() {
  const { t } = useI18n();
  const { data, loading } = useFetch(() => api.get('/showcase'), []);
  const projects = data?.projects || [];
  const [q, setQ] = useState('');
  const nq = q.trim().toLowerCase();
  const match = (p) => !nq || `${p.name} ${p.announceTitle || ''} ${p.tagline || ''}`.toLowerCase().includes(nq);
  const shown = projects.filter(match);
  // Announced-but-not-out projects go last. They are the ones you cannot use yet, and leading
  // a list of projects with things that do not exist yet is the wrong first impression — the
  // countdown page is still one click away, exactly where it was.
  const ordered = [...shown].sort((a, b) => (a.isAnnouncing ? 1 : 0) - (b.isAnnouncing ? 1 : 0));
  const soon = ordered.filter((p) => p.isAnnouncing).length;
  return (
    <div>
      <PageHeader icon={Orbit} title={t('nav.projects') || 'Projects'} subtitle={t('projects.sub') || 'More from the Better* ecosystem.'} />
      {/* The search appears once there is enough to search. Below that it is a control that
          does nothing but take a row. */}
      {!loading && projects.length > 5 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <input className="input !ps-9" placeholder={t('proj.search', 'Search projects…')} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]" aria-label={t('common.clear', 'Clear')}><X size={15} /></button>}
        </div>
      )}
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>
        : ordered.length ? (
          <>
            {projects.length > 5 && (
              <div className="text-xs text-[var(--faint)] mb-2">
                {t('proj.count', '{n} projects').replace('{n}', String(ordered.length))}
                {soon > 0 && ` · ${t('proj.countsoon', '{n} still to come').replace('{n}', String(soon))}`}
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ordered.map((p) => (
                <Link key={p.slug} to={`/project/${p.slug}`} className="block h-full group">
                  <Card hover className="p-5 h-full flex flex-col">
                    <div className="flex items-center gap-3">
                      {p.icon
                        ? <div className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0 p-1.5 text-[var(--accent-ink)]"><ShowcaseIcon icon={p.icon} size={28} rounded={8} /></div>
                        : <div className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] font-extrabold text-sm shrink-0">{p.short}</div>}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" title={p.isAnnouncing ? (p.announceTitle || p.name) : p.name}>{p.isAnnouncing ? (p.announceTitle || p.name) : p.name}</div>
                        {p.isAnnouncing && <div className="text-[11px] text-[var(--accent-ink)] flex items-center gap-1"><Clock size={11} /> {t('prj.comingsoon', 'Coming soon')}</div>}
                      </div>
                    </div>
                    {p.tagline && <p className="text-sm text-[var(--muted)] mt-3 line-clamp-3">{p.tagline}</p>}
                    {/* Pinned to the bottom of a card that now has a bottom. Without it the
                        only thing telling you a card is a link was the cursor. */}
                    <div className="flex-1" />
                    <div className="mt-3 pt-2.5 border-t border-[var(--line)] text-[12px] text-[var(--faint)] group-hover:text-[var(--accent-ink)] transition inline-flex items-center gap-1">
                      {p.isAnnouncing ? t('proj.seeteaser', 'See the countdown') : t('proj.openpage', 'Open the project')} <ArrowRight size={12} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        ) : nq ? <EmptyState icon={Search} title={t('proj.nomatch', 'No matches')}
          sub={t('proj.nomatch.s', 'No project here matches what you typed.')}
          action={{ label: t('common.clear', 'Clear'), icon: X, onClick: () => setQ('') }} />
          : <EmptyState icon={Orbit} title={t('proj.list.none', 'No projects yet')} sub={t('proj.list.noneSub', 'Featured projects will appear here.')}
            action={{ label: t('proj.list.none.a', 'Browse the catalogue'), to: '/catalog', icon: Boxes }} />}
      <RequestListing />
    </div>
  );
}

function ShowcaseCommunity({ cfg, c, slug }) {
  const { t } = useI18n();
  if (cfg.community?.url) return (
    <Card className="p-8 text-center">
      <Users size={28} className="mx-auto text-[var(--accent-ink)] mb-3" />
      <div className="font-semibold mb-4">{t('proj.community')}</div>
      <a href={cfg.community.url} target="_blank" rel="noreferrer"><Button variant="primary"><ExternalLink size={15} /> {t('prj.opencommunity', "Open community")}</Button></a>
    </Card>
  );
  return <Community c={c} communityUrl={c.contributorsUrl ? `/showcase/${slug}/community` : null} />;
}

function ShowcaseLegal({ legal, lang, quiet = false }) {
  const { t } = useI18n();
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.en ?? Object.values(v)[0]) : v;
  if (!legal.length && quiet) return null;
  if (!legal.length) return <EmptyState icon={ShieldCheck} title={t('proj.legal.none', 'No legal documents')}
    sub={t('proj.legal.none.s', 'The licence, terms, privacy policy and README for this project appear here, and none have been published yet.')}
    hint={t('proj.legal.noneSub', 'License / ToS / Privacy / README are set in the admin dashboard.')} />;
  return (
    <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
      {legal.map((card, i) => {
        const Ic = LEGAL_ICONS[card.icon] || ShieldCheck;
        const inner = (
          <Card hover={!!card.url} className="p-4 flex items-start gap-3 h-full">
            <Ic size={18} className="text-[var(--accent-ink)] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0"><div className="font-medium">{pick(card.title)}</div>{card.text && <div className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{pick(card.text)}</div>}</div>
            {card.url && <ExternalLink size={15} className="text-[var(--faint)] shrink-0" />}
          </Card>
        );
        return card.url ? <a key={i} href={card.url} target="_blank" rel="noreferrer">{inner}</a> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// A showcase project page — same tabs as BMM/BSM, driven entirely by admin config.
/** `preview` — see ProjectPage: `{ project, tab }`, the studio's page preview with a draft config. */
export function ShowcaseProjectPage({ preview: previewProp = null }) {
  const framed = useFramedDraft('showcase');
  const preview = previewProp || framed;
  const params = useParams();
  const slug = preview?.project?.slug ?? params.slug;
  const { t, lang } = useI18n();
  const [sp, setSp] = useSearchParams();
  const [showVersions, setShowVersions] = useState(false);
  const previewProject = preview?.project || null;
  const { data, loading, err, refetch } = useFetch(() => (previewProject
    ? Promise.resolve({ project: previewProject })
    : api.get(`/showcase/${slug}`)), [slug, previewProject]);
  // The storefront existed only on the fixed project pages, so a product attached to a
  // showcase page — which the admin form now makes possible — had nowhere to be sold. Keyed
  // on the showcase id, which is what the product carries. `?.` because this runs before the
  // page has loaded and `data.project` is not there yet on the first pass.
  const scId = data?.project?.id || '';
  const market = useFetch(() => (scId
    ? api.get(`/marketplace/products?showcaseProjectId=${encodeURIComponent(scId)}`).catch(() => ({ products: [] }))
    : Promise.resolve({ products: [] })), [scId]);
  const marketProducts = market.data?.products || [];
  // G2 + G3, as on the fixed projects. Waits for the page, so a countdown takeover asks nothing.
  const extra = useProjectContent(!previewProject && data?.project ? `/project/${slug}` : null);
  const ex = extra.data || {};
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  if (err?.status === 403) return <EmptyState icon={Lock} title={t('proj.notAvailable', 'Not available')} sub={t('proj.noAccess', "You don't have access to this page.")}
    action={{ label: t('proj.err.a', 'See the projects'), to: '/projects', icon: Boxes }} />;
  if (err) return <EmptyState as="h1" icon={Boxes} title={t('proj.notFound', 'Project not found')}
    sub={t('proj.notFound.s2', 'This address does not match any project, it may have been renamed or removed.')}
    action={{ label: t('proj.err.a', 'See the projects'), to: '/projects', icon: Boxes }} />;
  // Full-takeover countdown (no page behind it).
  if (data.announcement && !data.project) return <AnnouncementTeaser announcement={data.announcement} onReveal={refetch} />;
  const proj = data.project; const cfg = proj.config || {}; const T = cfg.tabs || {};
  // Custom tabs: id + title + B.MD body, defined by whoever owns the project. Filtered to the
  // complete ones — a tab with no body opens onto nothing, which is worse than no tab.
  const customTabs = (Array.isArray(cfg.customTabs) ? cfg.customTabs : [])
    .filter((ct) => ct && ct.id && String(ct.title || '').trim() && String(ct.body || '').trim());
  // Hand-placed pages, from the studio. Same rule as a custom tab: one that would open onto
  // nothing is not offered at all. A canvas with no blocks IS nothing — an empty plane reads
  // as a broken tab, not as a design choice.
  const canvasTabs = canvasTabsFor(cfg, preview ? preview.tab : null, t('pce.canvases.untitled', 'Untitled page'));
  // Inline countdown → adds a "Countdown" FIRST tab, page stays reachable.
  const inlineCountdown = data.announcement && data.announcementInline ? data.announcement : null;
  const c = {
    name: proj.name, tagline: cfg.tagline, downloads: cfg.downloads || [], links: cfg.links || {},
    releaseNotes: cfg.releaseNotes, media: cfg.overview, replayUrl: cfg.overview?.replayUrl,
    contributors: cfg.community?.contributors || [], messages: cfg.community?.messages || [], contributorsUrl: cfg.community?.contributorsUrl,
    stack: cfg.stack,
  };
  const tabs = [
    inlineCountdown && ['countdown', t('proj.countdown', 'Countdown'), Clock],
    ['overview', t('proj.overview'), ListTodo],
    (ex.docs > 0 || ex.canEdit) && ['docs', t('proj.docs', 'Docs'), BookOpen],
    (T.releases && cfg.releaseNotes?.owner) && ['releases', t('proj.releases'), ScrollText],
    (cfg.version || ex.releases > 0 || ex.canEdit) && ['versions', t('proj.versions', 'Versions'), Clock],
    T.community && ['community', t('proj.community'), Users],
    proj.showBlogTab && ['blog', t('proj.blog'), Newspaper],
    // Same rule as the built-in projects below: the admin switch decides, and a switch that
    // is on with nothing described would show an empty tab.
    stackTabEnabled(cfg.stack, T) && ['stack', cfg.stack.title || t('proj.stack', 'How it runs'), Network],
    (cfg.releaseNotes?.owner || cfg.links?.github || cfg.timeline?.length) && ['activity', t('proj.activity', 'Activity'), CalendarDays],
    (T.legal || ex.legal > 0 || ex.canEdit) && ['legal', t('proj.legal'), ShieldCheck],
    // Custom tabs. The eight above are the ones the platform knows how to build; these are the
    // ones a project needs and nobody anticipated — a title, an icon and a B.MD document. They
    // come last so adding one never moves a tab somebody has linked to, and an empty one is not
    // offered at all (a tab that opens onto nothing is worse than a missing tab).
    ...customTabs.map((ct) => [`x-${ct.id}`, ct.title, tabIcon(ct.icon)]),
    ...canvasTabs.map((cv) => [`c-${cv.id}`, cv.title, LayoutTemplate]),
    marketProducts.length > 0 && ['market', t('proj.market', 'Marketplace'), ShoppingBag],
  ].filter(Boolean);
  // Default to the countdown tab when one is present and no explicit tab chosen.
  const activeTab = pickTab(sp.get('tab') || preview?.tab || (inlineCountdown ? 'countdown' : 'overview'), tabs);
  return (
    <div>
      {/* N8 (agent-landing-N): name and tagline get the full width, the actions a row of their
          own under them, aligned with the name (same layout as the official project page). */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          {proj.icon
            ? <div className="grid place-items-center w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0 p-2 text-[var(--accent-ink)]"><ShowcaseIcon icon={proj.icon} size={44} rounded={10} /></div>
            : <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-brand-2 shrink-0"><span className="text-xl font-extrabold text-[var(--on-primary)]">{proj.short}</span></div>}
          <div className="flex-1 min-w-0 on-backdrop"><div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap"><h1 className="text-3xl font-extrabold min-w-0 break-words">{proj.name}</h1>{cfg.version && <button onClick={() => (preview ? setShowVersions(true) : setSp((p) => { const n = new URLSearchParams(p); n.set('tab', 'versions'); return n; }))} title={t('ver.open', 'Version history')} className="press-sm"><Badge tone="primary"><Clock size={11} /> v{cfg.version}</Badge></button>}</div>{cfg.tagline && <p className="text-[var(--muted)] mt-1">{cfg.tagline}</p>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 md:ps-[84px] empty:hidden">
          <DownloadMenu downloads={cfg.downloads} />
          {!preview && <ProjectContactBar projectRef={`sc:${slug}`} />}
        </div>
      </div>

      {showVersions && <VersionHistoryModal endpoint={`/project/${slug}`} currentVersion={cfg.version} initial={typeof showVersions === 'string' ? showVersions : null} onClose={() => setShowVersions(false)} />}

      <LinksRow links={cfg.links} />

      <div className="flex gap-2 mb-6 border-b border-[var(--line)] overflow-x-auto no-scrollbar">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${activeTab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'} ${id === 'countdown' ? 'text-[var(--accent-ink)]' : ''}`}>
            {/* Not every tab has an icon: a custom tab is a title and a B.MD body, and it
                passes null here. React throws on a null element type — "Element type is
                invalid" — so one custom tab took the whole page down, which is the one thing
                an optional extra must never do. */}
            {Icon ? <Icon size={15} /> : null} {label}
          </button>
        ))}
      </div>

      {activeTab === 'countdown' && inlineCountdown && <CountdownPanel announcement={inlineCountdown} onReveal={refetch} />}
      {activeTab === 'overview' && <Overview c={c} pkey={slug} progressUrl={`/showcase/${slug}/progress`} />}
      {activeTab === 'releases' && <Releases releasesUrl={`/showcase/${slug}/releases`} />}
      {activeTab === 'versions' && <ProjectVersions base={`/project/${slug}`} onOpenSnapshot={(v) => setShowVersions(v)} />}
      {activeTab === 'docs' && <ProjectPages base={`/project/${slug}`} kind="doc" />}
      {activeTab === 'activity' && <ProjectActivity endpoint={`/showcase/${slug}/activity`} timeline={cfg.timeline} />}
      {activeTab === 'community' && <ShowcaseCommunity cfg={cfg} c={c} slug={slug} />}
      {activeTab === 'blog' && <ProjectBlogTab page={slug} />}
      {/* A showcase page has no code snapshot of its own — those are keyed on the fixed
          projects, so the map is only offered there. */}
      {activeTab === 'stack' && <StackMap stack={cfg.stack} t={t} />}
      {activeTab === 'legal' && (preview ? <ShowcaseLegal legal={cfg.legal || []} lang={lang} />
        : <ProjectLegalTab base={`/project/${slug}`}><ShowcaseLegal legal={cfg.legal || []} lang={lang} quiet={ex.legal > 0} /></ProjectLegalTab>)}
      {activeTab === 'market' && <Marketplace pkey={slug} products={marketProducts} onChanged={market.refetch} />}
      {activeTab.startsWith('c-') && (() => {
        const cv = canvasTabs.find((x) => `c-${x.id}` === activeTab);
        return cv ? <CanvasView canvas={cv} /> : null;
      })()}
      {activeTab.startsWith('x-') && (() => {
        const ct = customTabs.find((x) => `x-${x.id}` === activeTab);
        return ct ? <Card className="p-5 sm:p-6"><Markdown>{ct.body}</Markdown></Card> : null;
      })()}
    </div>
  );
}

// A project page's own "Blog" tab — only this project's/page's posts (via the
// existing GET /blog?project=<key> or ?page=<slug> filter, opt-in per project).
function ProjectBlogTab({ project, page }) {
  const { t, lang } = useI18n();
  const qs = project ? `project=${project}` : `page=${page}`;
  const { data, loading } = useFetch(() => api.get(`/blog?${qs}`), [project, page]);
  const posts = data?.posts || [];
  const pick = (p) => (lang === 'fr' ? { title: p.titleFr || p.title, excerpt: p.excerptFr || p.excerpt } : { title: p.title, excerpt: p.excerpt });
  const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>;
  if (!posts.length) return <EmptyState icon={Newspaper} title={t('proj.noposts')}
    sub={t('proj.noposts.s', 'Posts written about this project appear here, and there are none yet.')}
    action={{ label: t('proj.noposts.a', 'Read the blog'), to: '/blog', icon: Newspaper }} />;
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
      {posts.map((p) => { const v = pick(p); return (
        <Link key={p.id} to={`/blog/${p.slug}`}>
          <Card hover className="overflow-hidden h-full flex flex-col">
            {p.cover ? <img src={thumb(p.cover, 512)} alt="" className="w-full h-40 object-cover" /> : <div className="w-full h-40 bg-[var(--surface-2)] border border-[var(--line)] grid place-items-center"><Newspaper size={32} className="text-[var(--accent-ink)] opacity-80" /></div>}
            <div className="p-4 flex-1 flex flex-col">
              <div className="text-xs text-[var(--faint)]">{fmt(p.publishedAt)}</div>
              <div className="font-bold mt-1 leading-snug">{v.title}</div>
              {v.excerpt && <div className="text-sm text-[var(--muted)] mt-1.5 line-clamp-2 flex-1">{v.excerpt}</div>}
            </div>
          </Card>
        </Link>
      ); })}
    </div>
  );
}

// ── A project's marketplace (public) ─────────────────────────────────────────
// Products a project sells. A free product delivers on click; a paid one opens Stripe checkout
// and the delivery lands (via the webhook) in the buyer's dashboard. What comes back — a key or
// some content — is shown inline with a copy button.
function Marketplace({ pkey, products = [], onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const [got, setGot] = useState({}); // productId → delivery (key/content) after a free buy
  const [dl, setDl] = useState(null);
  // The purchase id is what authorises the download, so it has to come back from the buy —
  // a product id would let anybody who knows it ask for the file.
  const download = async (pr, d) => {
    if (!d?.purchaseId) return;
    setDl(pr.id);
    try {
      const r = await api.get(`/marketplace/purchases/${d.purchaseId}/download`);
      if (r?.url) window.open(r.url, '_blank', 'noopener');
      else toast.error(t('mk.dlfail', 'That download could not be prepared.'));
    } catch (e) {
      // A lapsed subscription is not a failure to prepare the file — it is the one refusal
      // the buyer can act on, so it says so instead of hiding behind the generic message.
      toast.error(e?.data?.error === 'subscription_ended'
        ? t('mk.dlended', 'Your subscription to this product has ended.')
        : t('mk.dlfail', 'That download could not be prepared.'));
    }
    finally { setDl(null); }
  };

  const buy = async (pr) => {
    if (!user) { toast.error(t('mk.login', 'Sign in to buy.')); return; }
    setBusy(pr.id);
    try {
      if (pr.priceCents > 0) {
        const r = await api.post(`/marketplace/products/${pr.id}/checkout`, {});
        if (r.url) { window.location.href = r.url; return; }
        toast.error(t('common.failed', 'Failed.'));
      } else {
        const r = await api.post(`/marketplace/products/${pr.id}/buy`, {});
        if (r.ok) { setGot((g) => ({ ...g, [pr.id]: { ...(r.purchase?.delivery || {}), purchaseId: r.purchase?.id } })); onChanged?.(); toast.success(t('mk.done', 'Done, it’s yours.')); }
      }
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'out_of_stock' ? t('mk.oos', 'Sold out.') : e === 'checkout_required' ? t('mk.checkout', 'Payment required.') : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };
  const money = (pr) => (pr.priceCents > 0 ? `${(pr.priceCents / 100).toFixed(2)} ${(pr.currency || 'usd').toUpperCase()}` : t('mk.free', 'Free'));
  // A recurring price without its cadence is a lie of omission: "9.99 USD" and
  // "9.99 USD / month" are different offers, and only one of them is what is charged.
  const every = (pr) => {
    if (pr.billing !== 'subscription') return '';
    const n = Number(pr.intervalMonths) || 1;
    return n === 1 ? t('mk.per.month', '/ month')
      : n === 12 ? t('mk.per.year', '/ year')
      : t('mk.per.n', '/ {n} months').replace('{n}', n);
  };

  if (!products.length) return <EmptyState icon={ShoppingBag} title={t('mk.empty.t', 'Nothing for sale yet')}
    sub={t('mk.empty.s2', 'This is the project’s marketplace, and its team has not put anything on sale.')}
    action={{ label: t('mk.empty.a', 'Browse the catalogue'), to: '/catalog?project=bmm', icon: Boxes }} />;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {products.map((pr) => {
        const d = got[pr.id];
        const soldOut = !pr.inStock;
        return (
          <Card key={pr.id} className="p-4 flex flex-col">
            <div className="flex items-start gap-2 mb-1">
              <span className="w-9 h-9 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--accent-ink)]">{pr.deliveryKind.startsWith('key') ? <Key size={16} /> : <ShoppingBag size={16} />}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-tight">{pr.name}</div>
                <div className="text-sm font-bold text-[var(--accent-ink)] tabular-nums">
                  {money(pr)}{every(pr) && <span className="font-normal text-[var(--muted)]"> {every(pr)}</span>}
                </div>
              </div>
            </div>
            {pr.description && <p className="text-sm text-[var(--muted)] leading-relaxed mb-3">{pr.description}</p>}
            {/* Shown BEFORE the sale as well as after. "And then what" is the question people
                ask before paying, and a shop that only answers it afterwards is one people
                leave without buying. */}
            {(pr.redeemNote || pr.redeemUrl) && (
              <div className="text-[11px] text-[var(--muted)] mb-3 rounded-lg border border-[var(--line)] p-2 space-y-1">
                {pr.redeemNote && <div className="whitespace-pre-wrap break-words">{pr.redeemNote}</div>}
                {pr.redeemUrl && <a href={pr.redeemUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-ink)] hover:underline break-all"><ExternalLink size={11} /> {t('mk.redeem', 'Where to use it')}</a>}
              </div>
            )}
            {d ? (
              <div className="mt-auto rounded-lg border b-success tint-success-soft p-2.5">
                <div className="text-[11px] font-semibold text-[var(--success)] uppercase tracking-wide mb-1">{t('mk.yours', 'Yours')}</div>
                {d.key && <button type="button" onClick={() => { try { navigator.clipboard?.writeText(d.key); toast.success(t('common.copied', 'Copied.')); } catch { /* denied */ } }} className="inline-flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--line)] max-w-full"><Key size={12} className="shrink-0" /><span className="truncate" title={d.key}>{d.key}</span><Copy size={11} className="opacity-60 shrink-0" /></button>}
                {d.content && <div className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">{d.content}</div>}
                {d.role && <div className="text-xs text-[var(--muted)]">{t('mk.role', 'A Discord role will be granted shortly.')}</div>}
                {/* A file is fetched through the purchase, not linked from the product: the URL
                    is minted per click and expires, which is the whole reason this delivery
                    exists instead of a link pasted into the content field. */}
                {d.fileKey && (
                  <Button size="sm" className="mt-1" disabled={dl === pr.id} onClick={() => download(pr, d)}>
                    {dl === pr.id ? <Spinner /> : <><Download size={13} /> {d.fileName || t('mk.dl', 'Download')}</>}
                  </Button>
                )}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="btn btn-sm mt-1"><ExternalLink size={13} /> {t('mk.open', 'Open')}</a>}
                {d.licensed && <div className="text-[11px] text-[var(--faint)] mt-1">{t('mk.licensed', 'This key is yours alone, keep it, it is recorded against this purchase.')}</div>}
                {d.error && <div className="text-xs text-[var(--error)]">{t('mk.derr', 'Delivery issue, contact the project.')}</div>}
                {/* Repeated here on purpose. This is the moment somebody is holding a key and
                    wondering what to do with it, and the copy above has scrolled away. */}
                {pr.redeemUrl && <a href={pr.redeemUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-ink)] hover:underline mt-1.5 break-all"><ExternalLink size={11} /> {t('mk.redeem', 'Where to use it')}</a>}
              </div>
            ) : (
              <Button variant="primary" className="mt-auto justify-center" disabled={busy === pr.id || soldOut} onClick={() => buy(pr)}>
                {soldOut ? t('mk.oos', 'Sold out') : busy === pr.id ? <Spinner /> : <>{pr.priceCents > 0 ? <ShoppingBag size={14} /> : <Download size={14} />} {pr.priceCents > 0 ? t('mk.buy', 'Buy') : t('mk.get', 'Get')}</>}
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
