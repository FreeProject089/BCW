import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Github, MessageSquare, Globe, Fingerprint, FolderGit2, Boxes, Download, Star, Share2, Calendar, Lock, Search, UserX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, EmptyState, Spinner, Input, useToast } from '../ui/ui.jsx';
import Avatar, { avatarOf } from '../ui/Avatar.jsx';
import { Badges } from '../ui/Badges.jsx';
import { ReportButton } from '../ui/report.jsx';

const roleTone = (r) => r === 'SUPERADMIN' || r === 'ADMIN' ? 'red' : r === 'MOD' ? 'amber' : '';
const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;
// Minimal data-fetch hook (mirrors the one in pages.jsx, which isn't exported).
function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true; setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve(fn()).then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

// Public, shareable profile — pseudo, avatar, badges, join date, role, public repos +
// catalogs, and only the connections the owner opted to show. No PII.
export default function PublicProfile() {
  const { id } = useParams();
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, error } = useAsync(() => api.get(`/u/${id}`), [id]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-10"><Loading /></div>;
  if (error) {
    const priv = error.data?.error === 'private_profile';
    return <div className="max-w-3xl mx-auto px-4 py-16">
      <EmptyState icon={priv ? Lock : UserX}
        title={priv ? t('pp.private.t', 'This profile is private') : t('pp.404.t', 'Profile not found')}
        sub={priv ? t('pp.private.s', 'Only the owner and the BetterCommunity team can view it.') : t('pp.404.s', "This user doesn't exist or is no longer available.")} />
    </div>;
  }
  const u = data.profile;
  const av = avatarOf({ avatar: u.avatar, id: u.id });
  const joined = new Date(u.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  const share = () => { navigator.clipboard?.writeText(`${location.origin}/u/${u.id}`); toast.success(t('pp.shared', 'Profile link copied.')); };

  const connRows = [
    ['github', Github, u.connections.github, (v) => `https://github.com/${v}`],
    ['discord', MessageSquare, u.connections.discord, null],
    ['bmm', Fingerprint, u.connections.bmm, null],
    ['website', Globe, u.connections.website, (v) => v],
  ].filter(([, , v]) => v);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <Card className="p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <Avatar variant={av.variant} seed={av.seed || u.id} colors={av.colors} image={av.image} size={88} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{u.displayName}</h1>
              <Badges badges={u.badges} size={17} />
              {u.role !== 'USER' && <Badge tone={roleTone(u.role)}>{u.role}</Badge>}
              {u.private && <Badge tone="amber"><Lock size={11} /> {t('pp.privatebadge', 'private')}</Badge>}
            </div>
            {u.bio && <p className="text-sm text-[var(--muted)] mt-1.5 whitespace-pre-wrap break-words">{u.bio}</p>}
            <div className="text-xs text-[var(--faint)] mt-2 flex items-center gap-1"><Calendar size={12} /> {t('pp.joined', 'Joined')} {joined}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={share}><Share2 size={14} /> {t('pp.share', 'Share')}</Button>
            <ReportButton targetType="user" targetId={u.id} targetLabel={u.displayName} />
          </div>
        </div>
        {connRows.length > 0 && <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-[var(--line)]">
          {connRows.map(([k, Ico, v, href]) => href
            ? <a key={k} href={href(v)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--primary)]"><Ico size={14} /> {v}</a>
            : <span key={k} className="flex items-center gap-1.5 text-sm text-[var(--muted)]"><Ico size={14} /> {v}</span>)}
        </div>}
      </Card>

      {u.badges.length > 0 && <Card className="p-5">
        <h2 className="font-semibold mb-3 text-sm">{t('pp.badges', 'Badges')}</h2>
        <div className="flex flex-wrap gap-2">
          {u.badges.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5 text-sm rounded-lg px-2.5 py-1.5 border border-[var(--line)]" style={{ background: `color-mix(in srgb, ${b.color} 10%, transparent)` }} title={b.description}>
              <Badges badges={[b]} size={15} /> {b.name}
            </span>
          ))}
        </div>
      </Card>}

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-semibold mb-3 text-sm flex items-center gap-2"><FolderGit2 size={15} className="text-[var(--primary-2)]" /> {t('pp.repos', 'Public repos')} ({u.repos.length})</h2>
          {u.repos.length ? <div className="space-y-1.5">
            {u.repos.map((r) => (
              <Link key={r.id} to={`/repo/${r.id}`} className="block rounded-lg p-2 hover:bg-[var(--surface-2)]">
                <div className="text-sm font-medium truncate">{r.name}</div>
                {r.description && <div className="text-xs text-[var(--faint)] truncate">{r.description}</div>}
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-1 mt-0.5"><Star size={11} /> {r.favorites}</div>
              </Link>
            ))}
          </div> : <p className="text-sm text-[var(--faint)]">{t('pp.norepos', 'No public repos.')}</p>}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-3 text-sm flex items-center gap-2"><Boxes size={15} className="text-[var(--primary-2)]" /> {t('pp.catalogs', 'Public catalogs')} ({u.catalogs.length})</h2>
          {u.catalogs.length ? <div className="space-y-1.5">
            {u.catalogs.map((c) => (
              <Link key={c.slug} to={`/c/${c.slug}`} className="block rounded-lg p-2 hover:bg-[var(--surface-2)]">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-2 mt-0.5"><span>{c.items} {t('cc.items', 'items')}</span><span className="flex items-center gap-1"><Download size={11} /> {c.downloads}</span></div>
              </Link>
            ))}
          </div> : <p className="text-sm text-[var(--faint)]">{t('pp.nocatalogs', 'No public catalogs.')}</p>}
        </Card>
      </div>
    </div>
  );
}

// A small standalone user search page (/users). Type a name → click through to a profile.
export function UserSearch() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const { data, loading } = useAsync(() => q.trim().length >= 2 ? api.get(`/users/search?q=${encodeURIComponent(q.trim())}`) : Promise.resolve({ users: [] }), [q]);
  const users = data?.users || [];
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Search size={20} className="text-[var(--primary-2)]" /> {t('us.title', 'Find people')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t('us.sub', 'Search BetterCommunity members by name and open their public profile.')}</p>
      </div>
      <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-10" placeholder={t('us.ph', 'Search a username…')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {q.trim().length < 2 ? <p className="text-sm text-[var(--faint)] text-center py-8">{t('us.type', 'Type at least 2 characters.')}</p>
        : loading ? <Loading /> : users.length ? <div className="space-y-1.5">
          {users.map((u) => { const av = avatarOf({ avatar: u.avatar, id: u.id }); return (
            <Link key={u.id} to={`/u/${u.id}`}><Card className="p-3 flex items-center gap-3 card-hover">
              <Avatar variant={av.variant} seed={av.seed || u.id} colors={av.colors} image={av.image} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badges badges={u.badges} size={14} /></div>
                {u.private && <div className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Lock size={10} /> {t('pp.privatebadge', 'private')}</div>}
              </div>
              {u.role !== 'USER' && <Badge tone={roleTone(u.role)}>{u.role}</Badge>}
            </Card></Link>
          ); })}
        </div> : <EmptyState icon={UserX} title={t('us.none.t', 'No members found')} sub={t('us.none.s', 'Try a different name.')} />}
    </div>
  );
}
