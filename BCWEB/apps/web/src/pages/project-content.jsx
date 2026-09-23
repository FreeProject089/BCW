// A project's own content on its page (PLAN-SEPT23 G2 + G3): the release history as a
// timeline, the project's docs, and its legal pages, for the fixed projects and the Other
// projects alike. `base` is the project's API root: `/projects/<key>` or `/project/<slug>`.
//
// Reading is here; editing lives in editor/project-content-editors.jsx, loaded only when an
// editor opens it, so a visitor never downloads the markdown editor to read a changelog.
// Every body goes through ui/md.jsx, the one renderer (and sanitiser) the blog and the site
// docs use. Nothing here writes HTML.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, CalendarDays, ChevronRight, Copy, Download,
  Filter, Github, Languages, Newspaper, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X, Clock, Eye, EyeOff,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import Markdown, { IconGlyph } from '../ui/md.jsx';
import { Badge, Button, Card, EmptyState, Spinner, useToast, formatBytes, copyText } from '../ui/ui.jsx';

const Editors = lazy(() => import('../editor/project-content-editors.jsx'));

/** Which language of a per-language entry a reader gets: theirs, else English, else the first. */
export function pickLang(content, want) {
  const m = content && typeof content === 'object' ? content : {};
  const has = (l) => m[l] && typeof m[l] === 'object';
  const langs = Object.keys(m).filter(has);
  if (want && has(want)) return { lang: want, entry: m[want], fallback: false, langs };
  if (has('en')) return { lang: 'en', entry: m.en, fallback: !!want && want !== 'en', langs };
  if (langs.length) return { lang: langs[0], entry: m[langs[0]], fallback: !!want, langs };
  return { lang: null, entry: {}, fallback: false, langs };
}

/** A language code's own name, from the site's language list. */
export function useLangName() {
  const { locales } = useI18n();
  return (code) => (locales || []).find((l) => l.code === code)?.nativeName || String(code || '').toUpperCase();
}

function useLoad(url, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, err: null });
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let on = true;
    if (!url) { setState({ data: null, loading: false, err: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    api.get(url).then((d) => on && setState({ data: d, loading: false, err: null }))
      .catch((e) => on && setState({ data: null, loading: false, err: e }));
    return () => { on = false; };
  }, [url, gen, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setGen((g) => g + 1) };
}

/** What the project has: which of the Versions / Docs / legal tabs have something to show. */
export function useProjectContent(base) {
  return useLoad(base ? `${base}/content` : null);
}

const fmtDate = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang || undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const CHANNEL_TONE = { stable: 'green', beta: 'amber', rc: 'blue', alpha: 'red', nightly: 'primary' };

function useChannelLabel() {
  const { t } = useI18n();
  return (c) => ({
    stable: t('pcv.ch.stable', 'Stable'), beta: t('pcv.ch.beta', 'Beta'), rc: t('pcv.ch.rc', 'Release candidate'),
    alpha: t('pcv.ch.alpha', 'Alpha'), nightly: t('pcv.ch.nightly', 'Nightly'),
  }[c] || c);
}

/** A checksum, shortened for the eye and copied whole. */
function Checksum({ value }) {
  const { t } = useI18n(); const toast = useToast();
  if (!value) return null;
  const [algo, hex = ''] = String(value).split(':');
  return (
    <button type="button" title={value} onClick={async () => { await copyText(value); toast.success(t('pcv.copied', 'Checksum copied.')); }}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--muted)] hover:text-[var(--text)] min-w-0">
      <span className="uppercase shrink-0">{algo}</span>
      <span className="truncate max-w-[9rem]">{hex.slice(0, 12)}…{hex.slice(-6)}</span>
      <Copy size={11} className="shrink-0" />
    </button>
  );
}

// ── G2: the version timeline ────────────────────────────────────────────────────────────
/**
 * @param base            the project's API root
 * @param onOpenSnapshot  (version) => void, opens the page as it was (the existing modal)
 */
export function ProjectVersions({ base, onOpenSnapshot }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const channelLabel = useChannelLabel();
  const { data, loading, err, reload } = useLoad(`${base}/changelog`);
  const [channel, setChannel] = useState('all');
  const [q, setQ] = useState('');
  const [breakingOnly, setBreakingOnly] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [hidden, setHidden] = useState(() => new Set()); // deleted, inside the undo window
  const [editing, setEditing] = useState(null);          // an entry, or {} for a new one
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => (data?.entries || []).filter((e) => !hidden.has(e.version)), [data, hidden]);
  const channels = useMemo(() => [...new Set(entries.map((e) => e.channel))], [entries]);
  const nq = q.trim().toLowerCase();
  const shown = entries.filter((e) => {
    if (channel !== 'all' && e.channel !== channel) return false;
    const { entry } = pickLang(e.content, lang);
    if (breakingOnly && !(entry?.breaking || []).length) return false;
    if (!nq) return true;
    return [e.version, entry?.title, ...(entry?.highlights || []), ...(entry?.breaking || []), entry?.notes].filter(Boolean).join(' ').toLowerCase().includes(nq);
  });

  const toggle = (v) => setOpen((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });

  const remove = (e) => {
    setHidden((s) => new Set(s).add(e.version));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('be.undo', 'Undo'),
      msg: t('pcv.deleted', 'Version {v} removed from the history.').replace('{v}', e.version),
      onCommit: async () => {
        try { await api.del(`${base}/changelog/${encodeURIComponent(e.version)}`); reload(); }
        catch { toast.error(t('common.failed', 'Failed.')); }
        finally { setHidden((s) => { const n = new Set(s); n.delete(e.version); return n; }); }
      },
      onCancel: () => setHidden((s) => { const n = new Set(s); n.delete(e.version); return n; }),
    });
  };

  const importGithub = async (github) => {
    setBusy(true);
    try {
      const r = await api.post(`${base}/changelog/import`, github ? { github } : {});
      toast.success(r.created
        ? t('pcv.imported', '{n} version(s) imported from {repo}.').replace('{n}', r.created).replace('{repo}', r.repo)
        : t('pcv.imported.none', 'Nothing new on {repo}: every release is already in the history.').replace('{repo}', r.repo));
      reload();
    } catch (x) {
      if (x?.data?.error === 'no_github') setEditing({ _import: true });
      else toast.error(t('pcv.import.fail', 'GitHub could not be read. Try again in a moment.'));
    } finally { setBusy(false); }
  };

  if (loading && !data) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (err) return <EmptyState icon={Clock} title={t('pcv.err', 'The history could not be loaded')} sub={t('pcv.err.s', 'Reload the page to try again.')} />;
  const canEdit = !!data?.canEdit;

  return (
    <div className="max-w-3xl">
      {/* Filters. Only the channels this project actually uses are offered. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <input className="input !ps-9 !py-2 !text-sm" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('pcv.search', 'Search the versions…')} aria-label={t('pcv.search', 'Search the versions…')} />
        </div>
        {channels.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('pcv.channel', 'Channel')}>
            {['all', ...channels].map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c}
                className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${channel === c ? 'border-[var(--primary)] text-[var(--text)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                {c === 'all' ? t('pcv.all', 'All') : channelLabel(c)}
              </button>
            ))}
          </div>
        )}
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={breakingOnly} onChange={(e) => setBreakingOnly(e.target.checked)} />
          <Filter size={12} /> {t('pcv.breakingOnly', 'Breaking changes only')}
        </label>
        {canEdit && (
          <div className="flex flex-wrap gap-2 ms-auto">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => importGithub()}><Github size={14} /> {t('pcv.import', 'Import from GitHub')}</Button>
            <Button size="sm" onClick={() => setEditing({})}><Plus size={14} /> {t('pcv.new', 'New version')}</Button>
          </div>
        )}
      </div>

      {!entries.length ? (
        <EmptyState icon={Clock} title={t('pcv.none', 'No version recorded yet')}
          sub={canEdit ? t('pcv.none.edit', 'Write the first entry, or import the releases already published on GitHub.') : t('pcv.none.s', 'The versions of this project appear here as they are released.')} />
      ) : !shown.length ? (
        <EmptyState icon={Search} title={t('pcv.nomatch', 'No version matches')} sub={t('pcv.nomatch.s', 'Change the filters to see more versions.')}
          action={{ label: t('pcv.reset', 'Reset the filters'), icon: X, onClick: () => { setQ(''); setChannel('all'); setBreakingOnly(false); } }} />
      ) : (
        <>
          <div className="text-xs text-[var(--faint)] mb-3">
            {t('pcv.count', '{n} of {total} versions').replace('{n}', String(shown.length)).replace('{total}', String(entries.length))}
          </div>
          <ol className="relative border-s border-[var(--line)] ms-2 space-y-5">
            {shown.map((e) => {
              const { entry, fallback } = pickLang(e.content, lang);
              const isOpen = open.has(e.version);
              const breaking = entry?.breaking || [];
              const highlights = entry?.highlights || [];
              return (
                <li key={e.version} className="ms-5">
                  <span className={`absolute -start-[7px] mt-5 w-3.5 h-3.5 rounded-full border-2 ${e.current ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-[var(--bg-solid)] border-[var(--line-strong)]'}`} aria-hidden="true" />
                  <Card className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-lg">v{e.version}</h3>
                      <Badge tone={CHANNEL_TONE[e.channel] || ''}>{channelLabel(e.channel)}</Badge>
                      {e.current && <Badge tone="primary">{t('ver.current', 'current')}</Badge>}
                      {!e.published && <Badge tone="amber"><EyeOff size={11} /> {t('pcv.draft', 'Draft')}</Badge>}
                      {breaking.length > 0 && <Badge tone="red"><AlertTriangle size={11} /> {t('pcv.breaking.badge', 'Breaking')}</Badge>}
                      <span className="ms-auto text-xs text-[var(--faint)] inline-flex items-center gap-1"><CalendarDays size={12} /> {e.date ? fmtDate(e.date, lang) : t('pcv.undated', 'Live now')}</span>
                    </div>
                    {entry?.title && <div className="font-medium mt-1.5">{entry.title}</div>}
                    {fallback && <div className="text-[11px] text-[var(--faint)] mt-1 inline-flex items-center gap-1"><Languages size={11} /> {t('pcv.notTranslated', 'Not translated into your language yet.')}</div>}

                    {highlights.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {highlights.map((h, i) => <li key={i} className="flex items-start gap-2 text-sm"><Sparkles size={14} className="text-[var(--accent-ink)] shrink-0 mt-0.5" /> <span className="min-w-0 break-words">{h}</span></li>)}
                      </ul>
                    )}

                    {breaking.length > 0 && (
                      <div className="mt-3 rounded-lg border border-[var(--line)] p-3" style={{ background: 'color-mix(in srgb, var(--error, #e11d48) 7%, transparent)' }}>
                        <div className="text-xs font-semibold inline-flex items-center gap-1.5 mb-1.5"><AlertTriangle size={13} className="text-error" /> {t('pcv.breaking', 'Breaking changes')}</div>
                        <ul className="list-disc ps-5 space-y-1 text-sm">{breaking.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>
                      </div>
                    )}

                    {e.assets?.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {e.assets.map((a) => (
                          <div key={`${a.label}:${a.url}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--line)] px-3 py-2">
                            <Download size={14} className="text-[var(--accent-ink)] shrink-0" />
                            <a href={a.url} rel="noreferrer" download className="text-sm font-medium hover:underline min-w-0 flex-1 truncate" title={a.label}>{a.label}</a>
                            {a.platform && <span className="text-[11px] text-[var(--muted)]">{a.platform}</span>}
                            {Number.isFinite(a.size) && a.size > 0 && <span className="text-[11px] text-[var(--muted)] tabular-nums">{formatBytes(a.size)}</span>}
                            <Checksum value={a.checksum} />
                          </div>
                        ))}
                      </div>
                    )}

                    {entry?.notes && (
                      <div className="mt-3">
                        <button type="button" onClick={() => toggle(e.version)} aria-expanded={isOpen}
                          className="text-sm inline-flex items-center gap-1 text-[var(--accent-ink)] hover:underline">
                          <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          {isOpen ? t('pcv.notes.hide', 'Hide the full notes') : t('pcv.notes.show', 'Read the full notes')}
                        </button>
                        {isOpen && <div className="mt-2 pt-3 border-t border-[var(--line)]"><Markdown>{entry.notes}</Markdown></div>}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {e.links?.blog && (e.links.blog.startsWith('/')
                        ? <Link to={e.links.blog}><Button size="sm" variant="ghost"><Newspaper size={13} /> {t('pcv.blog', 'Announcement')}</Button></Link>
                        : <a href={e.links.blog} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="ghost"><Newspaper size={13} /> {t('pcv.blog', 'Announcement')}</Button></a>)}
                      {e.links?.github && <a href={e.links.github} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="ghost"><Github size={13} /> {t('pcv.github', 'GitHub release')}</Button></a>}
                      {e.snapshot && onOpenSnapshot && <Button size="sm" variant="ghost" onClick={() => onOpenSnapshot(e.version)}><Eye size={13} /> {t('pcv.snapshot', 'The page at this version')}</Button>}
                      {canEdit && (
                        <span className="ms-auto flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(e)} title={t('pcv.edit', 'Edit this version')} aria-label={t('pcv.edit', 'Edit this version')}><Pencil size={13} /></Button>
                          {!e.snapshotOnly && <Button size="sm" variant="ghost" className="!text-error" onClick={() => remove(e)} title={t('common.delete', 'Delete')} aria-label={t('common.delete', 'Delete')}><Trash2 size={13} /></Button>}
                        </span>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {editing && (
        <Suspense fallback={null}>
          <Editors mode={editing._import ? 'github' : 'release'} base={base} entry={editing._import ? null : editing}
            onGithub={(url) => { setEditing(null); importGithub(url); }}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
        </Suspense>
      )}
    </div>
  );
}

// ── G3: docs and legal pages ───────────────────────────────────────────────────────────
/** The "Top / Sub" categories of a page list, as a nested tree (the site docs' rule). */
function buildTree(pages, lang) {
  const root = { name: '', path: '', pages: [], children: new Map() };
  for (const pg of pages) {
    const { entry } = pickLang(pg.langs, lang);
    const parts = String(entry?.category || '').split('/').map((s) => s.trim()).filter(Boolean);
    let node = root; let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, pages: [], children: new Map() });
      node = node.children.get(part);
    }
    node.pages.push(pg);
  }
  const fin = (n) => ({ ...n, children: [...n.children.values()].map(fin) });
  return fin(root);
}

/**
 * A project's docs (kind="doc") or legal pages (kind="legal"), with a sidebar, a language
 * switch and, for its editors, the tools to write them. `children` renders under the page list
 * (the legal tab keeps its external link cards there).
 */
export function ProjectPages({ base, kind, children }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const langName = useLangName();
  const [sp, setSp] = useSearchParams();
  const list = useLoad(`${base}/pages/${kind}`);
  const pages = list.data?.pages || [];
  const canEdit = !!list.data?.canEdit;
  const [hidden, setHidden] = useState(() => new Set());
  const visible = pages.filter((p) => !hidden.has(p.slug));
  const want = sp.get('doc');
  const slug = visible.some((p) => p.slug === want) ? want : visible[0]?.slug || null;
  const page = useLoad(slug ? `${base}/pages/${kind}/${encodeURIComponent(slug)}` : null);
  const [readLang, setReadLang] = useState(null); // the reader's choice, else the site language
  const [editing, setEditing] = useState(null);   // { page } | { new: true } | { import: true }
  const [q, setQ] = useState('');
  const Icon = kind === 'legal' ? ShieldCheck : BookOpen;

  const go = (s) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('doc', s); return n; }, { replace: true });
  const titleOf = (pg) => pickLang(pg.langs, readLang || lang).entry?.title || pg.slug;
  const nq = q.trim().toLowerCase();
  const filtered = nq ? visible.filter((pg) => Object.values(pg.langs || {}).some((e) => `${e.title} ${e.category}`.toLowerCase().includes(nq))) : visible;
  const tree = useMemo(() => buildTree(filtered, readLang || lang), [filtered, readLang, lang]);

  const remove = (pg) => {
    setHidden((s) => new Set(s).add(pg.slug));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('be.undo', 'Undo'),
      msg: t('pcd.deleted', 'Page deleted.'),
      onCommit: async () => {
        try { await api.del(`${base}/pages/${kind}/${encodeURIComponent(pg.slug)}`); list.reload(); }
        catch { toast.error(t('common.failed', 'Failed.')); }
        finally { setHidden((s) => { const n = new Set(s); n.delete(pg.slug); return n; }); }
      },
      onCancel: () => setHidden((s) => { const n = new Set(s); n.delete(pg.slug); return n; }),
    });
  };

  if (list.loading && !list.data) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (list.err) return <EmptyState icon={Icon} title={t('pcd.err', 'These pages could not be loaded')} sub={t('pcd.err.s', 'Reload the page to try again.')} />;

  const cur = page.data?.page;
  const picked = cur ? pickLang(cur.content, readLang || lang) : null;
  const tools = canEdit && (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setEditing({ new: true })}><Plus size={14} /> {t('pcd.new', 'New page')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing({ import: true })}><Upload size={14} /> {t('pcd.import', 'Import from a repository')}</Button>
    </div>
  );

  const renderNode = (node, depth) => (
    <div key={node.path || 'root'} className={depth === 0 ? '' : 'mt-2'}>
      {node.name && <div className={`px-1 mb-1 font-bold uppercase tracking-wide text-[var(--faint)] truncate ${depth > 1 ? 'text-[10px]' : 'text-[11px]'}`} title={node.name}>{node.name}</div>}
      <div className={depth > 1 ? 'ms-2 border-s border-[var(--line)] ps-1.5' : ''}>
        {node.pages.map((pg) => (
          <button key={pg.slug} type="button" onClick={() => go(pg.slug)}
            className={`w-full flex items-center gap-2 ps-2.5 pe-2 py-1.5 rounded-lg text-sm text-start transition ${slug === pg.slug ? 'tint-primary text-[var(--accent-ink)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
            <IconGlyph name={pg.icon || (kind === 'legal' ? 'shield' : 'file')} size={14} className="shrink-0" />
            <span className="truncate flex-1" title={titleOf(pg)}>{titleOf(pg)}</span>
            {!pg.published && <span className="text-[10px] text-[var(--warning)] shrink-0">{t('pcv.draft', 'Draft')}</span>}
          </button>
        ))}
        {node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    </div>
  );

  return (
    <div>
      {!visible.length ? (
        <div className="max-w-2xl mb-6">
          {canEdit ? (
            <EmptyState icon={Icon} title={kind === 'legal' ? t('pcd.legal.none', 'No legal page written here yet') : t('pcd.none', 'No documentation written here yet')}
              sub={kind === 'legal'
                ? t('pcd.legal.none.edit', 'Write the privacy policy, the terms or the licence of this project, in every language you need. They are this project’s pages, separate from the site’s own.')
                : t('pcd.none.edit', 'Write the guides of this project here, or import the markdown already in its repository.')}>
              <div className="mt-4 flex justify-center">{tools}</div>
            </EmptyState>
          ) : kind === 'doc' ? (
            <EmptyState icon={Icon} title={t('pcd.none.pub', 'No documentation yet')} sub={t('pcd.none.pub.s', 'The guides of this project will appear here.')} />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start mb-6">
          <aside className="w-full md:w-60 md:shrink-0 md:sticky md:top-20 p-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]">
            {visible.length > 6 && (
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
                <input className="input !ps-8 !py-1.5 !text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pcd.filter', 'Filter the pages…')} aria-label={t('pcd.filter', 'Filter the pages…')} />
              </div>
            )}
            <nav className="space-y-0.5 max-h-[50vh] md:max-h-[calc(100vh-8rem)] overflow-auto no-scrollbar">{renderNode(tree, 0)}</nav>
            {tools && <div className="mt-3 pt-3 border-t border-[var(--line)]">{tools}</div>}
          </aside>

          <div className="flex-1 min-w-0 w-full">
            {page.loading && !cur ? <div className="py-16 grid place-items-center"><Spinner /></div>
              : !cur ? <EmptyState icon={Icon} title={t('pcd.gone', 'This page is not available')} />
              : (
                <article className="card p-5 sm:p-7">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {(picked.entry?.category || '').split('/').map((s) => s.trim()).filter(Boolean).map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs text-[var(--faint)]">{i > 0 && <ChevronRight size={11} />}{c}</span>
                    ))}
                    {/* The language switch: every language this page is written in. */}
                    {picked.langs.length > 1 && (
                      <div className="ms-auto flex flex-wrap gap-1" role="group" aria-label={t('pcd.lang', 'Language of this page')}>
                        {picked.langs.map((l) => (
                          <button key={l} type="button" onClick={() => setReadLang(l)} aria-pressed={picked.lang === l}
                            className={`px-2 py-1 rounded-md text-xs border transition ${picked.lang === l ? 'border-[var(--primary)] text-[var(--text)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                            {langName(l)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-extrabold mb-1 break-words">{picked.entry?.title || cur.slug}</h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--faint)] mb-5">
                    <span>{t('docs.updated', 'Updated')} {fmtDate(cur.updatedAt, lang)}</span>
                    {!cur.published && <Badge tone="amber"><EyeOff size={11} /> {t('pcv.draft', 'Draft')}</Badge>}
                    {cur.source?.url && <a href={cur.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--accent-ink)]"><Github size={11} /> {t('pcd.source', 'Source in the repository')}</a>}
                    {canEdit && (
                      <span className="ms-auto flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ page: cur })}><Pencil size={13} /> {t('docs.edit', 'Edit')}</Button>
                        <Button size="sm" variant="ghost" className="!text-error" onClick={() => remove(cur)} title={t('common.delete', 'Delete')} aria-label={t('common.delete', 'Delete')}><Trash2 size={13} /></Button>
                      </span>
                    )}
                  </div>
                  {picked.fallback && (
                    <div className="mb-5 p-3 rounded-lg border border-[var(--line)] text-sm text-[var(--muted)] flex items-center gap-2">
                      <Languages size={15} className="text-[var(--accent-ink)] shrink-0" />
                      {t('pcd.fallback', 'Not available in your language yet: shown in {lang}.').replace('{lang}', langName(picked.lang))}
                    </div>
                  )}
                  <Markdown>{picked.entry?.body || ''}</Markdown>
                </article>
              )}
          </div>
        </div>
      )}
      {children}
      {editing && (
        <Suspense fallback={null}>
          <Editors mode={editing.import ? 'import' : 'page'} base={base} kind={kind} page={editing.page || null}
            onClose={() => setEditing(null)}
            onSaved={(s) => { setEditing(null); list.reload(); page.reload(); if (s) go(s); }} />
        </Suspense>
      )}
    </div>
  );
}

/** Legal pages first, the external link cards the project already had after them. */
export function ProjectLegalTab({ base, children }) {
  return <ProjectPages base={base} kind="legal">{children}</ProjectPages>;
}

