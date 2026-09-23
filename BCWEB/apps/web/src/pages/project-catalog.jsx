// One project catalogue (G4): /catalog/:scope/:ref/:id.
//
// Four shapes behind one page, as lib/project-catalogs.mjs stores them:
//   custom     a declared schema: the fields become a generic card grid (title, picture, link,
//              the rest as label/value rows), searchable and filterable by tag
//   inline     an uploaded BMM catalog.json: its entries as cards, plus the feed to add in BMM
//   community  a hosted community catalogue: a pointer to its own page
//   official   the project's official items of one kind: a pointer to the filtered catalogue
// Every link and picture was checked http(s) by the server; `safeHref` checks again here,
// because this page is where a bad one would actually run.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Boxes, Download, ExternalLink, LayoutGrid, Package, Search, XCircle } from 'lucide-react';
import { PageHeader, Card, Badge, Button, Input, EmptyState } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import FeedLink from '../ui/feed-link.jsx';
import { ProjectLogo, TagFilter, tagText } from '../ui/catalog-pickers.jsx';
import { IconGlyph } from '../ui/md.jsx';
import { useAsync, Loading, KIND_ICON, kindLabel } from './pages.jsx';

const safeHref = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const fieldLabel = (f, lang) => (String(lang || '').startsWith('fr') && f.labelFr) || f.label;

function Chips({ keys = [], tags = [] }) {
  const { lang } = useI18n();
  const byKey = Object.fromEntries(tags.map((x) => [x.key, x]));
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {keys.map((k) => { const x = byKey[k]; const label = x ? tagText(x, lang) : k; return (
        <span key={k} className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] max-w-full">
          {x && <IconGlyph name={x.icon} size={11} className="text-[var(--accent-ink)] shrink-0" />}
          <span className="truncate" title={label}>{label}</span>
        </span>
      ); })}
    </div>
  );
}

/** A custom-format entry as a card: the schema decides what goes where. */
function EntryCard({ e, fields, tags }) {
  const { t, lang } = useI18n();
  const title = fields.find((f) => f.type === 'text' && e[f.key]);
  const pic = fields.find((f) => f.type === 'image' && safeHref(e[f.key]));
  const link = fields.find((f) => f.type === 'url' && safeHref(e[f.key]));
  const tagField = fields.find((f) => f.type === 'tags');
  const rest = fields.filter((f) => f.card && f !== title && f !== pic && f !== link && f !== tagField && e[f.key] != null && e[f.key] !== '');
  const name = title ? String(e[title.key]) : t('pcat.untitled', 'Untitled');
  return (
    <Card className="p-0 h-full overflow-hidden flex flex-col">
      {pic && <img src={safeHref(e[pic.key])} alt="" loading="lazy" className="w-full aspect-video object-cover bg-[var(--surface-2)] border-b border-[var(--line)]" />}
      <div className="p-4 flex-1 flex flex-col min-w-0">
        <div className="font-semibold truncate" title={name}>{name}</div>
        {rest.length > 0 && (
          <dl className="mt-2 space-y-1 text-sm">
            {rest.map((f) => (
              <div key={f.key} className={f.type === 'longtext' ? '' : 'flex items-baseline gap-2 min-w-0'}>
                <dt className="text-[11px] uppercase tracking-wider text-[var(--faint)] shrink-0">{fieldLabel(f, lang)}</dt>
                <dd className={`text-[var(--muted)] min-w-0 ${f.type === 'longtext' ? 'whitespace-pre-wrap line-clamp-4' : 'truncate'}`} title={String(e[f.key])}>{String(e[f.key])}</dd>
              </div>
            ))}
          </dl>
        )}
        {tagField && <Chips keys={e[tagField.key] || []} tags={tags} />}
        {link && (
          <div className="mt-auto pt-3">
            <a href={safeHref(e[link.key])} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-ink)] hover:underline">
              <ExternalLink size={13} /> {fieldLabel(link, lang)}
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}

/** An entry of an uploaded catalog.json. */
function FeedCard({ it, tags }) {
  const { t } = useI18n();
  const url = safeHref(it.url);
  const icon = safeHref(it.icon);
  return (
    <Card className="p-4 h-full flex flex-col">
      <div className="flex items-start gap-3 min-w-0">
        {icon ? <img src={icon} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-contain bg-[var(--surface-2)] border border-[var(--line)] shrink-0" />
          : <span className="grid place-items-center w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--accent-ink)] shrink-0"><Package size={18} /></span>}
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate" title={it.name}>{it.name}</div>
          <div className="text-xs text-[var(--faint)] truncate" title={[it.version && `v${it.version}`, it.author].filter(Boolean).join(' · ')}>{[it.version && `v${it.version}`, it.author].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {it.description && <p className="text-sm text-[var(--muted)] mt-2 line-clamp-3">{it.description}</p>}
      <Chips keys={it.tags} tags={tags} />
      {url && <div className="mt-auto pt-3"><a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-ink)] hover:underline"><Download size={13} /> {t('item.download', 'Download')}</a></div>}
    </Card>
  );
}

export default function ProjectCatalogPage() {
  const { scope, ref, id } = useParams();
  const { t } = useI18n();
  const base = `/project-catalogs/${encodeURIComponent(scope)}/${encodeURIComponent(ref)}/${encodeURIComponent(id)}`;
  const { data, loading, err } = useAsync(() => api.get(base), [base]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const c = data?.catalog;
  const tags = data?.tags || [];
  const fields = c?.fields || [];
  const tagField = fields.find((f) => f.type === 'tags');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (c?.format === 'custom') {
      return (c.entries || []).filter((e) => (!tag || (tagField && (e[tagField.key] || []).includes(tag)))
        && (!needle || fields.some((f) => ['text', 'longtext', 'version'].includes(f.type) && String(e[f.key] || '').toLowerCase().includes(needle))));
    }
    return (c?.items || []).filter((it) => (!tag || it.tags.includes(tag)) && (!needle || `${it.name} ${it.description}`.toLowerCase().includes(needle)));
  }, [c, q, tag]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Loading />;
  if (err || !c) return <EmptyState icon={XCircle} title={t('pcat.gone.t', 'Catalogue not found')} sub={t('pcat.gone.s', 'It may have been removed, or this project is not public.')}
    action={{ label: t('item.notfound.a', 'Browse the catalogue'), to: '/catalog', icon: Boxes }} />;
  const project = data.project;
  const back = project.official ? `/catalog?project=${encodeURIComponent(project.ref)}` : `/catalog?showcase=${encodeURIComponent(project.ref)}`;
  const feedPath = `/api${base}/catalog.json`;
  const KindI = (c.kind && KIND_ICON[c.kind]) || LayoutGrid;
  const bmmKind = c.format === 'bmm' && ['APP', 'PLUGIN', 'THEME'].includes(c.kind) ? c.kind.toLowerCase() : null;
  const searchable = c.format === 'custom' || c.source === 'inline';
  return (
    <div>
      <Link to={back} className="text-sm text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1.5 mb-3"><ArrowLeft size={14} /> {project.name}</Link>
      <PageHeader icon={c.icon ? (p) => <IconGlyph name={c.icon} size={p.size} className={p.className} /> : KindI} title={c.name} subtitle={c.description || undefined}
        actions={searchable ? <FeedLink path={feedPath} label={t('pcat.feed', 'This catalogue as JSON')} hint={c.format === 'custom' ? t('pcat.feed.hc', 'The entries and the fields that describe them, for a script or another site.') : t('pcat.feed.hb', 'The catalog.json feed BMM reads. Copy it into BMM → add a source.')} /> : null} />
      <div className="flex items-center gap-2 flex-wrap mb-4 text-sm text-[var(--muted)]">
        <ProjectLogo project={project} size={18} />
        <span className="truncate" title={project.name}>{project.name}</span>
        <Badge tone="">{c.format === 'custom' ? t('pcat.fmt.custom', 'Custom format') : kindLabel(c.kind, project.official ? project.ref : 'bmm')}</Badge>
        {bmmKind && c.source === 'inline' && (
          <a href={`bmm://catalog/${bmmKind}/add-source?url=${encodeURIComponent(`${location.origin}${feedPath}`)}`}><Button size="sm"><Boxes size={13} /> {t('item.json.addbmm', 'Add as BMM source')}</Button></a>
        )}
      </div>
      {c.format === 'bmm' && c.source === 'official' && (
        <Card className="p-5 flex items-center gap-3 flex-wrap">
          <KindI size={18} className="text-[var(--accent-ink)] shrink-0" />
          <div className="flex-1 min-w-0 text-sm">{t('pcat.official.d', 'This catalogue is the project’s official {k} list, reviewed by the team.').replace('{k}', kindLabel(c.kind, project.ref).toLowerCase())}</div>
          <Link to={`/catalog?project=${encodeURIComponent(project.ref)}&kind=${c.kind}`}><Button variant="primary" size="sm"><ArrowUpRight size={14} /> {t('pcat.open', 'Open')}</Button></Link>
        </Card>
      )}
      {c.format === 'bmm' && c.source === 'community' && (
        c.community ? (
          <Card className="p-5 flex items-center gap-3 flex-wrap">
            <Boxes size={18} className="text-success shrink-0" />
            <div className="flex-1 min-w-0 text-sm">{t('pcat.community.d', 'Hosted as a community catalogue:')} <b className="break-words">{c.community.name}</b></div>
            <Link to={`/c/${encodeURIComponent(c.community.slug)}`}><Button variant="primary" size="sm"><ArrowUpRight size={14} /> {t('pcat.open', 'Open')}</Button></Link>
          </Card>
        ) : <EmptyState icon={XCircle} title={t('pcat.community.gone', 'The linked catalogue is not available')} sub={t('pcat.community.gone.s', 'It was removed, suspended or made private by its owner.')} />
      )}
      {searchable && (<>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
            <Input className="!ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pcat.search', 'Search this catalogue…')} aria-label={t('pcat.search', 'Search this catalogue…')} />
          </div>
          {(c.format !== 'custom' || tagField) && <TagFilter value={tag} onChange={setTag} tags={tags} />}
          <span className="text-xs text-[var(--faint)]">{t('pcat.entries', '{n} entries').replace('{n}', rows.length)}</span>
        </div>
        {rows.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {c.format === 'custom' ? rows.map((e) => <EntryCard key={e.id} e={e} fields={fields} tags={tags} />) : rows.map((it) => <FeedCard key={it.id} it={it} tags={tags} />)}
          </div>
        ) : <EmptyState icon={Search} title={t('pcat.empty.t', 'Nothing matches')} sub={t('pcat.empty.s', 'Try another word or another tag.')} />}
      </>)}
    </div>
  );
}
