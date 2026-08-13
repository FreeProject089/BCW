import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Server, GitBranch, Link2, Copy, ArrowUpRight, ShieldAlert, Fingerprint, Users, Star, CheckCircle2, Tag, Download, Lock, FolderOpen, FileText, LogIn } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, StarButton } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { ReportButton } from '../ui/report.jsx';

const humanSize = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

// What's inside the repo, downloadable straight from the browser — so you can grab one mod
// without installing BMM first. The API decides who may download (same gate the download
// itself runs) and hands back `access`; this only renders the verdict it's given.
function RepoContents({ id, k }) {
  const { t } = useI18n();
  const [data, setData] = useState(undefined); // undefined = loading, null = failed
  useEffect(() => {
    api.get(`/r/${encodeURIComponent(id)}/contents${k ? `?k=${encodeURIComponent(k)}` : ''}`)
      .then(setData).catch((x) => setData(x.data?.error === 'banned' ? { banned: true } : null));
  }, [id, k]);

  if (data === undefined) return <Card className="p-4 mt-4"><Spinner /></Card>;
  if (data === null) return null;                       // nothing to say — stay quiet
  if (data.banned) return null;                          // the page already reads as denied
  if (data.access?.reason === 'not_hosted') return null; // externally-hosted repo: no files of ours

  const { files = [], total, access } = data;

  if (!access?.canDownload) {
    const needLogin = access?.reason === 'login_required';
    return (
      <Card className="p-4 mt-4">
        <div className="flex items-center gap-2 mb-1.5 font-medium"><Lock size={16} className="text-warning" /> {t('rc.locked.t', 'Downloads are restricted')}</div>
        <p className="text-sm text-[var(--muted)] mb-3">
          {needLogin
            ? t('rc.locked.login', 'This repo only allows people its owner approved. Sign in and we’ll check your account against their list.')
            : t('rc.locked.no', 'Your account isn’t on this repo’s allow-list. Ask the owner for access.')}
        </p>
        {/* /auth, not /login — that route doesn't exist (this shipped as a dead link once). */}
        {needLogin && <Link to="/auth"><Button size="sm" variant="primary"><LogIn size={14} /> {t('rc.signin', 'Sign in to download')}</Button></Link>}
      </Card>
    );
  }

  if (!files.length) return null;

  // Group by top-level folder (mods/, profiles/, …) — that's how a repo is actually laid out.
  const groups = {};
  for (const f of files) {
    const g = f.path.includes('/') ? f.path.split('/')[0] : '/';
    (groups[g] ||= []).push(f);
  }
  const label = (g) => (g === '/' ? t('rc.root', 'Root') : g);

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 font-medium"><FolderOpen size={16} className="text-[var(--primary-2)]" /> {t('rc.title', 'Contents')}</div>
        <span className="text-xs text-[var(--faint)]">
          {t('rc.count', '{n} files · {size}')
            .replace('{n}', String(total?.count ?? files.length))
            .replace('{size}', humanSize(total?.bytes || 0))}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('rc.sub', 'Download a file directly — no BMM needed.')}</p>

      {Object.entries(groups).map(([g, list]) => (
        <div key={g} className="mb-3 last:mb-0">
          <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] mb-1">{label(g)}</div>
          <ul className="divide-y divide-[var(--border)]">
            {list.map((f) => (
              <li key={f.path} className="flex items-center gap-2 py-1.5">
                <FileText size={13} className="text-[var(--faint)] flex-none" />
                <span className="text-sm truncate min-w-0 flex-1" title={f.path}>{f.path.includes('/') ? f.path.slice(g.length + 1) : f.path}</span>
                <span className="text-xs text-[var(--faint)] tabular-nums flex-none">{humanSize(f.size)}</span>
                {/* A plain link: the browser sends the session cookie, so the gate sees the
                    same identity the listing was computed with. */}
                <a href={f.url} download className="flex-none" title={t('rc.dl', 'Download')}>
                  <Button size="sm" variant="ghost"><Download size={13} /></Button>
                </a>
                {/* The link to this ONE file — the common case is sending somebody a single
                    file, not the whole repo. Absolute, because a copied link is going to be
                    pasted somewhere this page's origin means nothing. Copying it is not a
                    way around the access gate: the URL is checked per request, so a
                    restricted repo still refuses whoever opens it. */}
                <Button size="sm" variant="ghost" className="flex-none" title={t('rc.copyurl', 'Copy this file’s link')}
                  onClick={() => { navigator.clipboard?.writeText(new URL(f.url, location.origin).href); toast.success(t('rp.copied', 'Copied.')); }}>
                  <Link2 size={13} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {access.restricted && <p className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Lock size={10} /> {t('rc.youok', 'This repo is restricted — your account is allowed.')}</p>}
    </Card>
  );
}

// Public single Server-Repo page (/r/:id). Shows the repo's metadata + an "Open in BMM"
// deeplink (bmm://repo/connect?url=…) and a copyable repo.json URL. Works for publicly
// listed repos AND for unlisted repos opened through their owner's share link (?k=…) —
// the API gates access; this page just renders whatever it's allowed to see.
export default function RepoPublicPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const k = params.get('k') || '';
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
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
      <PageHeader icon={Server} title={t('rpub.title', 'Server repo')} />
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
          {repo.verified && <> · <span className="text-success inline-flex items-center gap-1"><CheckCircle2 size={12} /> {t('rp.verified', 'verified')}</span></>}
          {!repo.listed && <> · <span className="text-warning">{t('rp.unlisted', 'shared link')}</span></>}</>} />
      {repo.description && <p className="text-sm text-[var(--muted)] mb-3">{repo.description}</p>}

      {repo.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-3">
        {repo.tags.map((tag) => <Badge key={tag} tone=""><Tag size={10} /> {tag}</Badge>)}
      </div>}

      {/* Who owns this repo — profile link + copyable BC id, plus its unique fingerprint. */}
      <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
        <span className="text-[var(--faint)]">{t('rp.ownedby', 'Owned by')}</span>
        <span className="font-medium flex items-center gap-1"><Users size={13} /> {repo.author || '—'}</span>
        {repo.ownerBcId && <button onClick={() => copy(repo.ownerBcId)} title={t('rp.copybcid', 'Copy the owner’s BC id')} className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary)]"><Fingerprint size={11} /> {repo.ownerBcId} <Copy size={10} /></button>}
        {/* The count used to be display-only here; starring was only possible from the /repos
            list, which is the wrong place to decide you want to keep something. */}
        <StarButton favorited={repo.favorited} count={repo.favoriteCount} signedIn={!!user}
          post={() => api.post(`/repos/${encodeURIComponent(repo.id)}/favorite`)} />
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

      <RepoContents id={id} k={k} />

      {repo.links && (repo.links.website || repo.links.discord || repo.links.changelog) && <div className="mt-4 flex flex-wrap gap-2">
        {repo.links.website && <a href={repo.links.website} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Link2 size={13} /> {t('rp.website', 'Website')}</Button></a>}
        {repo.links.discord && <a href={repo.links.discord} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Users size={13} /> Discord</Button></a>}
        {repo.links.changelog && <a href={repo.links.changelog} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ArrowUpRight size={13} /> {t('rp.changelog', 'Changelog')}</Button></a>}
      </div>}

      <div className="mt-6"><Link to="/repos" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"><Link2 size={14} /> {t('rp.browse', 'Browse all repos')}</Link></div>
    </div>
  );
}
