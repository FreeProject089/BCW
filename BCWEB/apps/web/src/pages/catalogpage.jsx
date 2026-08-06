import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Boxes, Download, Link2, Copy, ArrowUpRight, Package, Music2, Palette, ShieldAlert, Fingerprint, Users } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, StarButton } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { ReportButton } from '../ui/report.jsx';
import { useAuth } from './auth.jsx';

const KIND_ICON = { PLUGIN: Package, THEME: Palette, APP: Boxes, PRESET: Music2 };
const KIND_FEED = { PLUGIN: 'plugin', THEME: 'theme', APP: 'app', PRESET: 'app' };

// A public community-catalog page: shows the feed, per-kind "Add to BMM" deeplinks
// (bmm://catalog/<kind>/add-source?url=…) and a copyable feed URL.
export default function CommunityCatalogPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const k = params.get('k') || '';
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [cat, setCat] = useState(undefined); // undefined = loading, null = not found/denied
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/c/${encodeURIComponent(slug)}${k ? `?k=${encodeURIComponent(k)}` : ''}`)
      .then((r) => setCat(r.catalog))
      .catch((x) => { setCat(null); setErr(x.data?.error || 'not_found'); });
  }, [slug, k]);

  const copy = (s) => { navigator.clipboard?.writeText(s); toast.success(t('ccp.copied', 'Copied.')); };

  if (cat === undefined) return <div className="max-w-2xl mx-auto p-8 text-center"><Spinner /></div>;
  if (cat === null) return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Boxes} title={t('ccp.title', 'Community catalog')} />
      <EmptyState icon={err === 'not_whitelisted' || err === 'banned' ? ShieldAlert : Boxes}
        title={err === 'not_whitelisted' ? t('ccp.private.t', 'Private catalog') : err === 'banned' ? t('ccp.banned.t', 'Access blocked') : t('ccp.gone.t', 'Catalog not found')}
        sub={err === 'not_whitelisted' ? t('ccp.private.s', "This catalog is private — you need an invite (or a share link) from its owner.") : err === 'banned' ? t('ccp.banned.s', 'You are not allowed to view this catalog.') : t('ccp.gone.s', 'It may have been removed or suspended.')} />
    </div>
  );

  const feedUrl = (kind) => `${location.origin}/api/c/${cat.slug}/catalog.json?kind=${KIND_FEED[kind]}${cat.keySuffix ? `&k=${encodeURIComponent(k)}` : ''}`;
  const deeplink = (kind) => `bmm://catalog/${KIND_FEED[kind]}/add-source?url=${encodeURIComponent(feedUrl(kind))}`;
  // A catalog serves exactly one kind, and the feed answers `unsupported_type` for any other —
  // so offering a button per kind PRESENT would show buttons that 404 on a legacy multi-kind
  // row. Trust the catalog's own kind, and fall back to kindsPresent only if it has none.
  const own = String(cat.kind || '').toUpperCase();
  const kinds = (own ? [own] : (cat.kindsPresent || [])).filter((kk) => kk && kk !== 'PRESET'); // presets aren't BMM add-source
  const contents = cat.items || [];

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Boxes} title={cat.name}
        subtitle={<>{t('ccp.by', 'by {name}').replace('{name}', cat.owner || '—')} · {cat.itemCount} {t('cc.items', 'items')}{cat.private && <> · <span className="text-amber-400">{t('ccp.private', 'private')}</span></>}</>} />
      {cat.description && <p className="text-sm text-[var(--muted)] mb-3">{cat.description}</p>}
      {/* Who hosts this catalog — link to their profile + copy their BC id. */}
      {cat.owner && <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
        <span className="text-[var(--faint)]">{t('ccp.hostedby', 'Hosted by')}</span>
        {cat.ownerId ? <Link to={`/u/${cat.ownerId}`} className="font-medium hover:text-[var(--primary)] flex items-center gap-1"><Users size={13} /> {cat.owner}</Link> : <span className="font-medium flex items-center gap-1"><Users size={13} /> {cat.owner}</span>}
        {cat.ownerBcId && <button onClick={() => copy(cat.ownerBcId)} title={t('ccp.copybcid', 'Copy the host’s BC id')} className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary)]"><Fingerprint size={11} /> {cat.ownerBcId} <Copy size={10} /></button>}
        <StarButton favorited={cat.favorited} count={cat.favoriteCount} signedIn={!!user}
          post={() => api.post(`/c/${encodeURIComponent(cat.slug)}/favorite`)} />
        <ReportButton targetType="catalog" targetId={cat.slug} targetLabel={cat.name} />
      </div>}

      {kinds.length === 0 ? (
        <EmptyState icon={Boxes} title={t('ccp.empty.t', 'Nothing to add yet')} sub={t('ccp.empty.s', 'This catalog has no BMM-importable content yet.')} />
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('ccp.addto', 'Add to BetterModsManager')}</div>
          {kinds.map((kind) => {
            const Icon = KIND_ICON[kind] || Boxes;
            return (
              <Card key={kind} className="p-4">
                <div className="flex items-center gap-2 mb-2 font-medium"><Icon size={16} className="text-[var(--primary-2)]" /> {t('ccp.kind.' + kind.toLowerCase(), kind)}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={deeplink(kind)}><Button size="sm" variant="primary"><Download size={14} /> {t('ccp.addbmm', 'Add to BMM')}</Button></a>
                  <Button size="sm" variant="ghost" onClick={() => copy(feedUrl(kind))}><Copy size={13} /> {t('ccp.copyurl', 'Copy feed URL')}</Button>
                  <a href={feedUrl(kind)} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1"><ArrowUpRight size={12} /> {t('ccp.view', 'View feed')}</a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {/* What is actually in it. The page used to show a name, a count and a download button
          and nothing else — you had to open the raw feed to find out what you were adding. */}
      {contents.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
            {t('ccp.contents', 'What’s inside')} <span className="text-[var(--muted)] normal-case tracking-normal">· {cat.itemCount} {t('cc.items', 'items')}</span>
          </div>
          <Card className="divide-y divide-[var(--line)] overflow-hidden">
            {contents.map((it) => (
              <div key={it.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{it.name}</span>
                    {it.version && <span className="text-[11px] font-mono text-[var(--faint)]">v{it.version}</span>}
                  </div>
                  {it.description && <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-2">{it.description}</p>}
                  {it.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {it.tags.slice(0, 6).map((tag) => <Badge key={tag} tone="">{tag}</Badge>)}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-[var(--faint)] text-right shrink-0 space-y-0.5">
                  {it.downloads > 0 && <div className="flex items-center gap-1 justify-end"><Download size={10} /> {it.downloads}</div>}
                  {it.size > 0 && <div>{(it.size / 1048576).toFixed(1)} MB</div>}
                  {it.external && <div className="italic">{t('ccp.extern', 'external link')}</div>}
                </div>
              </div>
            ))}
          </Card>
          {cat.itemCount > contents.length && (
            <p className="text-[11px] text-[var(--faint)] mt-1.5">
              {t('ccp.more', 'Showing the first {n} — open the feed for the full list.').replace('{n}', contents.length)}
            </p>
          )}
        </div>
      )}

      <div className="mt-6"><Link to="/catalog" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><Link2 size={14} /> {t('ccp.browse', 'Browse all catalogs')}</Link></div>
    </div>
  );
}
