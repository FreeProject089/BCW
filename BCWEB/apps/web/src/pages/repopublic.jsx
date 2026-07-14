import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Server, GitBranch, Link2, Copy, ArrowUpRight, ShieldAlert, Fingerprint, Users, Star, CheckCircle2, Tag } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Spinner, EmptyState } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { ReportButton } from '../ui/report.jsx';

// Public single Server-Repo page (/r/:id). Shows the repo's metadata + an "Open in BMM"
// deeplink (bmm://repo/connect?url=…) and a copyable repo.json URL. Works for publicly
// listed repos AND for unlisted repos opened through their owner's share link (?k=…) —
// the API gates access; this page just renders whatever it's allowed to see.
export default function RepoPublicPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const k = params.get('k') || '';
  const { t } = useI18n(); const toast = useToast();
  const [repo, setRepo] = useState(undefined); // undefined = loading, null = not found/denied
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/r/${encodeURIComponent(id)}${k ? `?k=${encodeURIComponent(k)}` : ''}`)
      .then((r) => setRepo(r.repo))
      .catch((x) => { setRepo(null); setErr(x.data?.error || 'not_found'); });
  }, [id, k]);

  const copy = (s) => { navigator.clipboard?.writeText(s); toast.success(t('rp.copied', 'Copied.')); };

  if (repo === undefined) return <div className="max-w-2xl mx-auto p-8 text-center"><Spinner /></div>;
  if (repo === null) return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Server} title={t('rp.title', 'Server repo')} />
      <EmptyState icon={ShieldAlert}
        title={t('rp.gone.t', 'Repo not found')}
        sub={t('rp.gone.s', 'It may have been removed, unlisted, or the share link is invalid.')} />
    </div>
  );

  const deeplink = repo.repoJson ? `bmm://repo/connect?url=${encodeURIComponent(repo.repoJson)}` : null;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Server} title={repo.name}
        subtitle={<>{t('rp.by', 'by {name}').replace('{name}', repo.author || '—')}
          {repo.verified && <> · <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={12} /> {t('rp.verified', 'verified')}</span></>}
          {!repo.listed && <> · <span className="text-amber-400">{t('rp.unlisted', 'shared link')}</span></>}</>} />
      {repo.description && <p className="text-sm text-[var(--muted)] mb-3">{repo.description}</p>}

      {repo.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-3">
        {repo.tags.map((tag) => <Badge key={tag} tone=""><Tag size={10} /> {tag}</Badge>)}
      </div>}

      {/* Who owns this repo — profile link + copyable BC id, plus its unique fingerprint. */}
      <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
        <span className="text-[var(--faint)]">{t('rp.ownedby', 'Owned by')}</span>
        <span className="font-medium flex items-center gap-1"><Users size={13} /> {repo.author || '—'}</span>
        {repo.ownerBcId && <button onClick={() => copy(repo.ownerBcId)} title={t('rp.copybcid', 'Copy the owner’s BC id')} className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary)]"><Fingerprint size={11} /> {repo.ownerBcId} <Copy size={10} /></button>}
        {typeof repo.favoriteCount === 'number' && <span className="inline-flex items-center gap-1 text-[var(--faint)]"><Star size={12} /> {repo.favoriteCount}</span>}
        <ReportButton targetType="repo" targetId={repo.id} targetLabel={repo.name} />
      </div>

      {deeplink ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2 font-medium"><GitBranch size={16} className="text-[var(--primary-2)]" /> {t('rp.addto', 'Open in BetterModsManager')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={deeplink}><Button size="sm" variant="primary"><GitBranch size={14} /> {t('rp.openbmm', 'Open in BMM')}</Button></a>
            <Button size="sm" variant="ghost" onClick={() => copy(repo.repoJson)}><Copy size={13} /> {t('rp.copyurl', 'Copy repo.json URL')}</Button>
            <a href={repo.repoJson} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1"><ArrowUpRight size={12} /> {t('rp.view', 'View manifest')}</a>
          </div>
        </Card>
      ) : (
        <EmptyState icon={Server} title={t('rp.nofeed.t', 'No manifest yet')} sub={t('rp.nofeed.s', 'This repo has no published repo.json to import into BMM yet.')} />
      )}

      {repo.links && (repo.links.website || repo.links.discord || repo.links.changelog) && <div className="mt-4 flex flex-wrap gap-2">
        {repo.links.website && <a href={repo.links.website} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Link2 size={13} /> {t('rp.website', 'Website')}</Button></a>}
        {repo.links.discord && <a href={repo.links.discord} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Users size={13} /> Discord</Button></a>}
        {repo.links.changelog && <a href={repo.links.changelog} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ArrowUpRight size={13} /> {t('rp.changelog', 'Changelog')}</Button></a>}
      </div>}

      <div className="mt-6"><Link to="/repos" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><Link2 size={14} /> {t('rp.browse', 'Browse all repos')}</Link></div>
    </div>
  );
}
