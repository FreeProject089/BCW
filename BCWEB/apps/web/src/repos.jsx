import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Server, GitBranch, Star, Plus, Pencil, Trash2, UploadCloud, Eye, EyeOff, CheckCircle2,
  XCircle, Clock, ShieldCheck, ExternalLink, Tag, Users, HardDrive, Settings2, Receipt, Printer, Rocket,
  Files, FileText, FileJson, FolderUp, CreditCard, Search, X, Wifi, WifiOff, Zap, Lock, Download, Copy, RefreshCw, AlertTriangle, LayoutDashboard, MoreHorizontal, Ticket,
  Ban, Globe, Shield, ChevronDown, Fingerprint,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, uploadRepoFile } from './api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal } from './ui.jsx';
import { useUploads } from './uploads.jsx';
import { useI18n } from './i18n.jsx';
import { useAuth } from './auth.jsx';

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, loading, reload };
}
const gb = (n) => (Number(n) / 1024 ** 3).toFixed(1);
// Adaptive size so small files don't all read "0.0 MB".
const fmtSize = (n) => { n = Number(n) || 0; if (n < 1024) return `${n} B`; if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`; if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`; return `${(n / 1024 ** 3).toFixed(2)} GB`; };

// Compact overflow menu for a repo card's secondary actions (keeps the row tidy).
// The dropdown is PORTALED to <body> and fixed-positioned so it escapes the card's
// stacking context (cards use backdrop-filter → the menu would otherwise render
// behind sibling cards).
function RepoMenu({ children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const toggle = () => {
    if (!open && btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); }
    setOpen((v) => !v);
  };
  return (
    <span ref={btnRef} className="inline-flex">
      <Button size="sm" onClick={toggle} title="More actions"><MoreHorizontal size={16} /></Button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="fixed z-[100] w-56 rounded-xl border border-[var(--line-strong)] py-1 overflow-hidden anim-fade" style={{ top: pos.top, right: pos.right, background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }} onClick={() => setOpen(false)}>
            {children}
          </div>
        </>, document.body)}
    </span>
  );
}
function MenuItem({ icon: I, onClick, danger, children }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--surface-2)] ${danger ? 'text-red-400' : 'text-[var(--text)]'}`}>
      {I && <I size={14} className={danger ? '' : 'text-[var(--faint)]'} />} {children}
    </button>
  );
}

// Public repo.json URL: hosted repos serve at /hosting/<hostPath>/repo.json; a listed
// non-hosted repo exposes its external repo.json (repoUrl).
function repoJsonUrl(r) {
  if (r.hosted && r.hostPath && r.published) return `${location.origin}/hosting/${r.hostPath}/repo.json`;
  return r.repoUrl || r.publicUrl || '';
}
// Force a real file download (S3 URLs are cross-origin, so the `download` attr alone
// won't trigger a save — fetch the bytes into a blob first).
async function forceDownload(url, filename) {
  try {
    const res = await fetch(url); const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { window.open(url, '_blank'); }
}

/* ── Public list ── */
export function ReposPage() {
  const toast = useToast(); const { t } = useI18n(); const { user } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/repos'), []);
  const repos = data?.repos || [];
  const copyJson = (r) => { const u = repoJsonUrl(r); if (!u) return toast.error(t('repos.copy.none', 'No repo.json URL.')); navigator.clipboard?.writeText(u); toast.success(t('repos.copy.ok', 'repo.json link copied.')); };
  const feedUrl = `${location.origin}/repos.json`;
  // Keep the public listing live — statuses refresh automatically.
  useEffect(() => { const id = setInterval(reload, 60_000); return () => clearInterval(id); /* eslint-disable-next-line */ }, []);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [hostedOnly, setHostedOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  // Optimistic local overlay so a click updates instantly, without waiting on a
  // full-list refetch — reload() (on the next 60s tick) reconciles with the server.
  const [favOverlay, setFavOverlay] = useState({}); // { [repoId]: { favorited, favoriteCount } }
  const toggleFavorite = async (r) => {
    if (!user) return toast.error(t('repos.fav.signin', 'Sign in to favorite repos.'));
    const cur = favOverlay[r.id] || { favorited: r.favorited, favoriteCount: r.favoriteCount };
    setFavOverlay((o) => ({ ...o, [r.id]: { favorited: !cur.favorited, favoriteCount: cur.favoriteCount + (cur.favorited ? -1 : 1) } }));
    try { const res = await api.post(`/repos/${r.id}/favorite`); setFavOverlay((o) => ({ ...o, [r.id]: res })); }
    catch { setFavOverlay((o) => ({ ...o, [r.id]: cur })); toast.error(t('repos.fav.failed', 'Failed.')); }
  };

  const allTags = [...new Set(repos.flatMap((r) => r.tags || []))].sort();
  const withOverlay = repos.map((r) => ({ ...r, ...(favOverlay[r.id] || {}) }));
  const filtered = withOverlay.filter((r) => {
    if (hostedOnly && !r.hosted) return false;
    if (onlineOnly && r.status !== 'ONLINE') return false;
    if (favOnly && !r.favorited) return false;
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (q) { const s = q.toLowerCase(); if (!`${r.name} ${r.description || ''} ${(r.tags || []).join(' ')} ${r.owner?.displayName || ''}`.toLowerCase().includes(s)) return false; }
    return true;
  });

  return (
    <div>
      <PageHeader icon={Server} title={t('repos.title', 'Server Repos')} subtitle={t('repos.sub', 'Verified community repositories — featured ones first.')} />

      {/* aggregate feed URL — a single repo.json index of every listed repo */}
      <Card className="p-3 mb-4 flex items-center gap-2.5 flex-wrap">
        <FileJson size={16} className="text-[var(--primary-2)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--faint)]">{t('repos.feed.label', 'Aggregate feed — all listed repos in one repo.json')}</div>
          <code className="text-xs text-[var(--muted)] break-all">{feedUrl}</code>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" onClick={() => { navigator.clipboard?.writeText(feedUrl); toast.success(t('repos.feed.copied', 'Feed URL copied.')); }}><Copy size={13} /> {t('repos.copylink', 'Copy link')}</Button>
          <a href={feedUrl} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={13} /> {t('repos.feed.open', 'Open')}</Button></a>
        </div>
      </Card>

      {/* search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input className="input !pl-9" placeholder={t('repos.search', 'Search repos, tags, authors…')} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]"><X size={15} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setHostedOnly((v) => !v)} className={`btn ${hostedOnly ? 'btn-primary' : ''}`}><Rocket size={14} /> {t('repos.hostedonly', 'Hosted only')}</button>
          <button onClick={() => setOnlineOnly((v) => !v)} className={`btn ${onlineOnly ? 'btn-primary' : ''}`}><Wifi size={14} /> {t('repos.onlineonly', 'Online only')}</button>
          {user && <button onClick={() => setFavOnly((v) => !v)} className={`btn ${favOnly ? 'btn-primary' : ''}`}><Star size={14} /> {t('repos.favonly', 'Favorited')}</button>}
        </div>
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <button onClick={() => setTag('')} className={`text-xs px-2.5 py-1 rounded-full border ${!tag ? 'border-[var(--primary)] text-[var(--text)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{t('repos.alltags', 'All')}</button>
          {allTags.map((tg) => (
            <button key={tg} onClick={() => setTag(tg === tag ? '' : tg)} className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 ${tag === tg ? 'border-[var(--primary)] text-[var(--text)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}><Tag size={10} /> {tg}</button>
          ))}
        </div>
      )}

      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : !repos.length ? <EmptyState icon={Server} title={t('repos.empty.t', 'No repos listed yet')} sub={t('repos.empty.s', 'Verified public repositories will appear here.')} />
        : !filtered.length ? <EmptyState icon={Search} title={t('repos.nomatch.t', 'No matches')} sub={t('repos.nomatch.s', 'Try a different search or clear the filters.')} />
        : (
          <>
            <div className="text-xs text-[var(--faint)] mb-2">{filtered.length} {filtered.length === 1 ? t('repos.one', 'repo') : t('repos.many', 'repos')}</div>
            <div className="grid md:grid-cols-2 gap-4">
              {filtered.map((r) => {
                const online = r.status === 'ONLINE';
                return (
                  <Card key={r.id} hover className={`p-5 ${r.featured ? 'border-[var(--ring)]' : ''}`} style={r.featured ? { boxShadow: '0 0 0 1px var(--primary), 0 16px 40px -18px var(--primary-glow)' } : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold flex items-center gap-2 min-w-0"><GitBranch size={16} className="text-[var(--primary-2)] shrink-0" /> <span className="truncate">{r.name}</span></div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {r.featured && <Badge tone="amber"><Star size={11} /> {t('repos.featured', 'Featured')}</Badge>}
                        <Badge tone="green"><ShieldCheck size={11} /> {t('repos.verified', 'Verified')}</Badge>
                        <button onClick={() => toggleFavorite(r)} title={r.favorited ? t('repos.unfavorite', 'Unfavorite') : t('repos.favorite', 'Favorite')}
                          className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border ${r.favorited ? 'border-amber-400/50 text-amber-400 bg-amber-400/10' : 'border-[var(--line)] text-[var(--faint)] hover:text-amber-400'}`}>
                          <Star size={12} fill={r.favorited ? 'currentColor' : 'none'} /> {r.favoriteCount || 0}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-[var(--faint)] mt-1 flex items-center gap-3">
                      <span className="flex items-center gap-1"><Users size={12} /> {r.owner?.displayName}</span>
                      {r.hosted && <span className={`flex items-center gap-1 ${online ? 'text-emerald-400' : 'text-[var(--faint)]'}`}>{online ? <Wifi size={12} /> : <WifiOff size={12} />} {online ? t('repos.online', 'Online') : t('repos.offline', 'Offline')}</span>}
                    </div>
                    {r.description && <p className="text-sm text-[var(--muted)] mt-2 line-clamp-2">{r.description}</p>}
                    {r.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{r.tags.map((tg) => <button key={tg} onClick={() => setTag(tg)}><Badge><Tag size={10} /> {tg}</Badge></button>)}</div>}
                    {r.hosted && <div className="text-xs text-[var(--faint)] mt-2">{gb(r.storageUsedBytes)} / {gb(r.storageQuotaBytes)} GB</div>}
                    {r.fingerprint && (
                      <button onClick={() => { navigator.clipboard?.writeText(r.fingerprint); toast.success(t('repos.idcopied', 'Repo ID copied.')); }}
                        title={t('repos.id.hint', 'Unique Repo ID — quote it when contacting support.')}
                        className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary-2)] transition">
                        <Fingerprint size={11} /> {r.fingerprint} <Copy size={10} className="opacity-60" />
                      </button>
                    )}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <a href={`bmm://repo/connect?url=${encodeURIComponent(repoJsonUrl(r))}`}><Button size="sm" variant="primary"><GitBranch size={13} /> {t('repos.openbmm', 'Open in BMM')}</Button></a>
                      {repoJsonUrl(r) && <Button size="sm" onClick={() => copyJson(r)}><Copy size={13} /> {t('repos.copyjson', 'Copy repo.json')}</Button>}
                      {r.links?.discord && <a href={r.links.discord} target="_blank" rel="noreferrer"><Button size="sm">Discord</Button></a>}
                      {r.links?.website && <a href={r.links.website} target="_blank" rel="noreferrer"><Button size="sm">{t('repos.website', 'Website')}</Button></a>}
                      {r.links?.changelog && <a href={r.links.changelog} target="_blank" rel="noreferrer"><Button size="sm">{t('repos.changelog', 'Changelog')}</Button></a>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
    </div>
  );
}

function StatusBadges({ r }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.hosted && <Badge tone="primary">{t('repos.hosted', 'Hosted')}</Badge>}
      {r.listed ? <Badge tone="green"><Eye size={10} /> {t('repos.listed', 'Listed')}</Badge> : <Badge><EyeOff size={10} /> {t('repos.unlisted', 'Unlisted')}</Badge>}
      {r.pendingReview ? <Badge tone="amber"><Clock size={10} /> {t('repos.pending', 'Pending review')}</Badge>
        : r.verified ? <Badge tone="green"><CheckCircle2 size={10} /> {t('repos.verified', 'Verified')}</Badge> : <Badge><XCircle size={10} /> {t('repos.unverified', 'Unverified')}</Badge>}
    </div>
  );
}

/* ── User: my repos (dashboard section) ── */
function MyChipList({ label, items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x) { onAdd(x); setV(''); } };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" onClick={add}><Plus size={13} /></Button></div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">{x}<button onClick={() => onRemove(x)} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button></span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Account entries ({type:"bcweb"|"discord", id, label}) — search is the SAME
// non-admin /accounts/search endpoint repo owners already use in the per-repo
// dashboard's SettingsTab (minimal fields, no email/role exposed).
function MyAccountChips({ label, items, onAdd, onRemove }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 2) return setResults(null);
    setBusy(true);
    try { const { accounts } = await api.get(`/accounts/search?q=${encodeURIComponent(q.trim())}`); setResults(accounts); } catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creator id / Discord / username…" onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={13} />}</Button>
      </div>
      {results && (
        <div className="mt-1.5 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-[11px] text-[var(--faint)] px-1">No accounts found.</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
            <Users size={9} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button>
          </span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Owner-scoped whitelist/blacklist applied identically to all of THIS user's OWN
// hosted repos (on top of each repo's own settings AND the site-wide admin policy —
// see hosting-content.mjs's sandboxGate). Collapsed by default to keep "My repos"
// from getting cluttered for owners who never need this.
function MyAccessPolicyCard() {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch(() => api.get('/me/access-policy'), []);
  const [policy, setPolicy] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.policy && !policy) setPolicy(data.policy); /* eslint-disable-next-line */ }, [data]);

  const addTo = (field, val) => setPolicy((s) => ({ ...s, [field]: [...new Set([...(s[field] || []), val])] }));
  const rm = (field, val) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((x) => x !== val) }));
  const addAccount = (field, entry) => setPolicy((s) => {
    const list = s[field] || [];
    if (list.some((a) => a.type === entry.type && a.id === entry.id)) return s;
    return { ...s, [field]: [...list, entry] };
  });
  const rmAccount = (field, entry) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((a) => !(a.type === entry.type && a.id === entry.id)) }));

  const save = async () => {
    setBusy(true);
    try { await api.put('/me/access-policy', policy); toast.success(t('repos.mypolicy.saved', 'Saved — applies to all your hosted repos.')); reload(); }
    catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };

  return (
    <div className="mt-6">
      <button onClick={() => setOpen((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Globe size={16} className="text-[var(--primary-2)]" />
        <h3 className="font-semibold text-sm flex-1">{t('repos.mypolicy.title', 'My repos — access policy')}</h3>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      <p className="text-sm text-[var(--muted)] mb-3">{t('repos.mypolicy.sub', "A whitelist/blacklist applied to ALL of your own hosted repos at once — on top of each repo's own settings and any site-wide staff rules.")}</p>
      {open && !policy && <div className="flex items-center gap-2 text-[var(--muted)] text-sm py-4"><Spinner /> {t('common.loading', 'Loading…')}</div>}
      {open && policy && (
        <Card className="p-4 space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.whitelistOnly} onChange={(e) => setPolicy({ ...policy, whitelistOnly: e.target.checked })} /> {t('repos.mypolicy.wlonly', 'Whitelist-only for ALL my repos')}</label>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Shield size={12} className="text-emerald-400" /> {t('repos.mypolicy.wl', 'Whitelist')}</div>
              <MyChipList label="IPs" items={policy.whitelistIps || []} onAdd={(v) => addTo('whitelistIps', v)} onRemove={(v) => rm('whitelistIps', v)} placeholder="203.0.113.4" />
              <MyChipList label="Creator ID" items={policy.whitelistKeys || []} onAdd={(v) => addTo('whitelistKeys', v)} onRemove={(v) => rm('whitelistKeys', v)} placeholder="BMM creator id…" />
              <MyAccountChips label="Accounts" items={policy.whitelistAccounts || []} onAdd={(e) => addAccount('whitelistAccounts', e)} onRemove={(e) => rmAccount('whitelistAccounts', e)} />
            </div>
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Ban size={12} className="text-red-400" /> {t('repos.mypolicy.bl', 'Blacklist')}</div>
              <MyChipList label="IPs" items={policy.bannedIps || []} onAdd={(v) => addTo('bannedIps', v)} onRemove={(v) => rm('bannedIps', v)} placeholder="198.51.100.7" />
              <MyChipList label="Creator ID" items={policy.bannedKeys || []} onAdd={(v) => addTo('bannedKeys', v)} onRemove={(v) => rm('bannedKeys', v)} placeholder="BMM creator id…" />
              <MyAccountChips label="Accounts" items={policy.bannedAccounts || []} onAdd={(e) => addAccount('bannedAccounts', e)} onRemove={(e) => rmAccount('bannedAccounts', e)} />
            </div>
          </div>
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('repos.mypolicy.save', 'Save policy')}</Button></div>
        </Card>
      )}
    </div>
  );
}

export function MyRepos() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useFetch(() => api.get('/me/repos'), []);
  const [editing, setEditing] = useState(null);
  const [featuring, setFeaturing] = useState(null);
  const [managing, setManaging] = useState(null);
  const [sandbox, setSandbox] = useState(null);
  const [poolAdd, setPoolAdd] = useState(null);
  const repos = data?.repos || [];
  const shared = data?.shared || [];
  const isFeatured = (r) => r.featuredUntil && new Date(r.featuredUntil) > new Date();

  // Push re-runs the auto check: the SHA is recomputed from the live repo.json and
  // the repo is re-verified automatically (valid → verified, else unverified).
  const push = async (r) => {
    try { const res = await api.post(`/repos/${r.id}/push`, {}); toast[res.verified ? 'success' : 'info'](res.verified ? t('repos.push.ok', 'Pushed — re-checked & verified.') : t('repos.push.bad', 'Pushed — content is not a valid repo.json (unverified).')); reload(); }
    catch (x) { toast.error(x.data?.error || t('repos.failed', 'Failed.')); }
  };
  const toggleList = async (r) => {
    try { await api.post(`/repos/${r.id}/list`, { listed: !r.listed }); toast.success(!r.listed ? t('repos.listed.ok', 'Listed & verified — now public.') : t('repos.unlisted.ok', 'Unlisted.')); reload(); }
    catch (x) {
      if (x.data?.error === 'sha_invalid') toast.error(t('repos.sha.invalid', 'Invalid repo.json / SHA — kept private. Upload or fix a valid repo.json, then try again.'));
      else toast.error(x.data?.error || t('repos.failed', 'Failed.'));
    }
  };
  const del = async (r) => { if (!(await dialog.confirm({ title: t('repos.del.title', 'Delete repo'), message: t('repos.del.msg', 'Delete "{name}"?').replace('{name}', r.name), okLabel: t('repos.del.ok', 'Delete'), danger: true }))) return; try { await api.del(`/repos/${r.id}`); toast.success(t('repos.deleted', 'Deleted.')); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const check = async (r) => { try { const res = await api.post(`/repos/${r.id}/check`); toast[res.status === 'ONLINE' ? 'success' : 'error'](res.status === 'ONLINE' ? (res.verified ? t('repos.check.onver', 'Online & verified.') : t('repos.check.onunver', 'Online but unverified.')) : t('repos.check.off', 'Offline ({reason}).').replace('{reason}', res.reason || t('repos.unreachable', 'unreachable'))); reload(); } catch { toast.error(t('repos.check.failed', 'Check failed.')); } };
  // Free switch between single repo and a multi (pool) layout.
  const switchMode = async (r) => {
    const toMulti = !r.groupId;
    try { await api.post(`/me/repos/${r.id}/${toMulti ? 'to-multi' : 'to-single'}`); toast.success(toMulti ? t('repos.tomulti.ok', 'Switched to multi — a storage pool was created (free).') : t('repos.tosingle.ok', 'Switched back to single.')); reload(); }
    catch (x) { toast.error(x.data?.error === 'pool_has_multiple_repos' ? t('repos.pool.hasmulti', 'Remove the other repos from the pool first.') : t('repos.switch.failed', 'Switch failed.')); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Server size={16} /> {t('repos.mine', 'My Server Repos')}</h2>
        <Button size="sm" variant="primary" onClick={() => setEditing({})}><Plus size={15} /> {t('repos.add', 'Add repo')}</Button>
      </div>
      {loading ? <div className="text-[var(--muted)] text-sm py-4">{t('common.loading', 'Loading…')}</div>
        : repos.length ? <div className="space-y-2">
          {repos.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <GitBranch size={18} className="text-[var(--primary-2)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.description && <div className="text-sm text-[var(--muted)] line-clamp-1">{r.description}</div>}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Badge tone={r.status === 'ONLINE' ? 'green' : 'red'}>{r.status === 'ONLINE' ? `● ${t('repos.online', 'Online')}` : `● ${t('repos.offline', 'Offline')}`}</Badge>
                    <StatusBadges r={r} />{isFeatured(r) && <Badge tone="amber"><Star size={10} /> {t('repos.featureduntil', 'Featured until')} {new Date(r.featuredUntil).toLocaleDateString()}</Badge>}</div>
                  <div className="text-xs text-[var(--faint)] mt-1.5 flex items-center gap-3 flex-wrap font-mono">
                    {r.sha && <span>sha {r.sha.slice(0, 12)}…</span>}
                    {r.fingerprint && (
                      <button onClick={() => { navigator.clipboard?.writeText(r.fingerprint); toast.success(t('repos.idcopied', 'Repo ID copied.')); }}
                        title={t('repos.id.hint', 'Unique Repo ID — quote it when contacting support.')}
                        className="inline-flex items-center gap-1 hover:text-[var(--primary-2)] transition"><Fingerprint size={11} /> {r.fingerprint} <Copy size={9} className="opacity-60" /></button>
                    )}
                  </div>
                  {r.hosted && (
                    <div className="text-xs text-[var(--faint)] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1"><HardDrive size={11} /> {gb(r.storageUsedBytes)} / {gb(r.storageQuotaBytes)} GB</span>
                      <span className="flex items-center gap-1"><Zap size={11} /> {(r.effectiveUploadKbps / 1024).toFixed(1)} Mbps {t('repos.cap', 'cap')}</span>
                      {r.group && <Badge tone="primary"><HardDrive size={9} /> {t('repos.pool', 'Pool')}: {r.group.name}</Badge>}
                    </div>
                  )}
                </div>
              </div>
              {/* Clean primary row — everything else lives in the ⋯ menu. The dashboard is
                  the full management surface (files, publishing, sandbox, access). */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Link to={`/repo/${r.id}`}><Button size="sm" variant="primary"><LayoutDashboard size={14} /> {t('repos.opendash', 'Dashboard')}</Button></Link>
                <Button size="sm" onClick={() => toggleList(r)}>{r.listed ? <><EyeOff size={14} /> {t('repos.unlist', 'Unlist')}</> : <><Eye size={14} /> {t('repos.listpublicly', 'List publicly')}</>}</Button>
                <Button size="sm" onClick={() => setFeaturing(r)}><Rocket size={14} /> {isFeatured(r) ? t('repos.extendboost', 'Extend boost') : t('repos.boost', 'Boost')}</Button>
                <RepoMenu>
                  {repoJsonUrl(r) && <MenuItem icon={Copy} onClick={() => { navigator.clipboard?.writeText(repoJsonUrl(r)); toast.success(t('repos.copy.ok', 'repo.json link copied.')); }}>{t('repos.copylink', 'Copy repo.json link')}</MenuItem>}
                  {r.hosted && <MenuItem icon={Files} onClick={() => setManaging(r)}>{t('repos.quickfiles', 'Quick files')}</MenuItem>}
                  {r.hosted && <MenuItem icon={ShieldCheck} onClick={() => setSandbox(r)}>{t('repos.sandbox', 'Sandbox settings')}</MenuItem>}
                  {!r.hosted && <MenuItem icon={UploadCloud} onClick={() => push(r)}>{t('repos.push', 'Push')}</MenuItem>}
                  {!r.hosted && <MenuItem icon={CheckCircle2} onClick={() => check(r)}>{t('repos.check', 'Check')}</MenuItem>}
                  {r.hosted && <MenuItem icon={HardDrive} onClick={() => switchMode(r)}>{r.groupId ? t('repos.tosingle', 'Switch to single') : t('repos.tomulti', 'Switch to multi')}</MenuItem>}
                  {r.hosted && r.group && <MenuItem icon={Plus} onClick={() => setPoolAdd(r.group)}>{t('repos.addtopool', 'Add repo to pool')}</MenuItem>}
                  <MenuItem icon={Pencil} onClick={() => setEditing(r)}>{t('repos.editdetails', 'Edit details')}</MenuItem>
                  <MenuItem icon={Trash2} danger onClick={() => del(r)}>{t('repos.delete', 'Delete repo')}</MenuItem>
                </RepoMenu>
              </div>
            </Card>
          ))}
        </div> : <EmptyState icon={Server} title={t('repos.mine.empty.t', 'No repos yet')} sub={t('repos.mine.empty.s', 'Add a repo to list it publicly, or host one from the Hosting page.')} />}

      <MyAccessPolicyCard />

      {/* Repos shared with me by another owner (authorized-email collaborator access). */}
      {shared.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold flex items-center gap-2 mb-2 text-sm"><Users size={15} className="text-[var(--primary-2)]" /> {t('repos.sharedwithme', 'Shared with me')}</h3>
          <div className="space-y-2">
            {shared.map((r) => (
              <Card key={r.id} className="p-4 flex items-center gap-3">
                <GitBranch size={18} className="text-[var(--primary-2)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.name} <span className="text-xs text-[var(--faint)] font-normal">· {r.ownerName}</span></div>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <Badge tone={r.status === 'ONLINE' ? 'green' : 'red'}>{r.status === 'ONLINE' ? `● ${t('repos.online', 'Online')}` : `● ${t('repos.offline', 'Offline')}`}</Badge>
                    <Badge tone="primary">{t('rd.lvl.collab', 'Collaborator')}</Badge>
                  </div>
                </div>
                <Link to={`/repo/${r.id}`}><Button size="sm" variant="primary"><LayoutDashboard size={14} /> {t('repos.opendash', 'Dashboard')}</Button></Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {editing !== null && <RepoEditor repo={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {featuring && <FeatureModal repo={featuring} onClose={() => setFeaturing(null)} />}
      {managing && <HostFilesModal repo={managing} onClose={() => setManaging(null)} onChanged={reload} />}
      {sandbox && <RepoManageModal repo={sandbox} onClose={() => setSandbox(null)} onChanged={reload} />}
      {poolAdd && <PoolAddModal group={poolAdd} onClose={() => setPoolAdd(null)} onDone={() => { setPoolAdd(null); reload(); }} />}
    </div>
  );
}

// Sandboxed repo dashboard: access mode, whitelist, bans, upload limit — all
// hard-capped by the sandbox. Grouped (multi) repos can also resize their quota.
function RepoManageModal({ repo, onClose, onChanged }) {
  const toast = useToast(); const { t } = useI18n();
  const s0 = repo.settings || { access: { whitelistEnabled: false, ips: [], keys: [] }, bans: { ips: [], keys: [] }, requestedUploadKbps: null };
  const [access, setAccess] = useState(s0.access);
  const [bans, setBans] = useState(s0.bans);
  const capKbps = repo.uploadLimitKbps || 0;
  const [reqMbps, setReqMbps] = useState(s0.requestedUploadKbps ? (s0.requestedUploadKbps / 1024) : (capKbps / 1024));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('access');
  const [ipIn, setIpIn] = useState(''); const [keyIn, setKeyIn] = useState('');
  const [banIpIn, setBanIpIn] = useState('');

  // The effective upload is clamped to the sandbox cap — asking for more is bounded.
  const requestedKbps = Math.round(reqMbps * 1024);
  const effectiveKbps = Math.min(requestedKbps <= 0 ? capKbps : requestedKbps, capKbps);
  const capped = requestedKbps > capKbps;

  const addTo = (setter, field, val) => { const v = val.trim(); if (!v) return; setter((s) => ({ ...s, [field]: [...new Set([...(s[field] || []), v])] })); };
  const rm = (setter, field, val) => setter((s) => ({ ...s, [field]: (s[field] || []).filter((x) => x !== val) }));

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put(`/me/repos/${repo.id}/settings`, { access, bans, requestedUploadKbps: requestedKbps <= 0 ? null : requestedKbps });
      toast.success(res.effectiveUploadKbps < requestedKbps ? t('repos.mng.capped', 'Saved — upload capped to {n} Mbps by the sandbox.').replace('{n}', (res.effectiveUploadKbps / 1024).toFixed(1)) : t('repos.mng.saved', 'Settings saved.'));
      onChanged?.(); onClose();
    } catch { toast.error(t('repos.mng.savefail', 'Failed to save.')); } finally { setBusy(false); }
  };

  const chip = (val, onRemove) => (
    <span key={val} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
      {val}<button onClick={onRemove} className="text-[var(--faint)] hover:text-red-400"><X size={12} /></button>
    </span>
  );
  const tabs = [['access', t('repos.tab.access', 'Access'), ShieldCheck], ['bans', t('repos.tab.bans', 'Bans'), XCircle], ['limits', t('repos.tab.limits', 'Limits'), Zap]];

  return (
    <Modal open onClose={onClose} title={t('repos.mng.title', 'Manage "{name}"').replace('{name}', repo.name)} icon={ShieldCheck} width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('repos.savesettings', 'Save settings')}</Button></>}>
      <div className="flex items-center gap-2 mb-4 text-xs text-[var(--muted)]"><ShieldCheck size={13} className="text-[var(--primary-2)]" /> {t('repos.sandboxed', "Sandboxed — your settings can never exceed this repo's hard limits.")}</div>
      <div className="flex gap-1 mb-4 border-b border-[var(--line)]">
        {tabs.map(([id, label, I]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={14} /> {label}</button>
        ))}
      </div>

      {tab === 'access' && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={access.whitelistEnabled} onChange={(e) => setAccess({ ...access, whitelistEnabled: e.target.checked })} /> {t('repos.wl', 'Whitelist-only access (only allow-listed IPs/keys can sync)')}</label>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('repos.allowedips', 'Allowed IPs')}</div>
            <div className="flex gap-2"><Input value={ipIn} onChange={(e) => setIpIn(e.target.value)} placeholder="203.0.113.4" onKeyDown={(e) => { if (e.key === 'Enter') { addTo(setAccess, 'ips', ipIn); setIpIn(''); } }} /><Button size="sm" onClick={() => { addTo(setAccess, 'ips', ipIn); setIpIn(''); }}><Plus size={14} /></Button></div>
            <div className="flex flex-wrap gap-1.5 mt-2">{(access.ips || []).map((v) => chip(v, () => rm(setAccess, 'ips', v)))}{!(access.ips || []).length && <span className="text-xs text-[var(--faint)]">{t('repos.none', 'None')}</span>}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('repos.allowedkeys', 'Allowed keys')}</div>
            <div className="flex gap-2"><Input value={keyIn} onChange={(e) => setKeyIn(e.target.value)} placeholder="access-key…" onKeyDown={(e) => { if (e.key === 'Enter') { addTo(setAccess, 'keys', keyIn); setKeyIn(''); } }} /><Button size="sm" onClick={() => { addTo(setAccess, 'keys', keyIn); setKeyIn(''); }}><Plus size={14} /></Button></div>
            <div className="flex flex-wrap gap-1.5 mt-2">{(access.keys || []).map((v) => chip(v, () => rm(setAccess, 'keys', v)))}{!(access.keys || []).length && <span className="text-xs text-[var(--faint)]">{t('repos.none', 'None')}</span>}</div>
          </div>
        </div>
      )}

      {tab === 'bans' && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('repos.bannedips', 'Banned IPs')}</div>
            <div className="flex gap-2"><Input value={banIpIn} onChange={(e) => setBanIpIn(e.target.value)} placeholder="198.51.100.7" onKeyDown={(e) => { if (e.key === 'Enter') { addTo(setBans, 'ips', banIpIn); setBanIpIn(''); } }} /><Button size="sm" onClick={() => { addTo(setBans, 'ips', banIpIn); setBanIpIn(''); }}><Plus size={14} /></Button></div>
            <div className="flex flex-wrap gap-1.5 mt-2">{(bans.ips || []).map((v) => chip(v, () => rm(setBans, 'ips', v)))}{!(bans.ips || []).length && <span className="text-xs text-[var(--faint)]">{t('repos.nonebanned', 'None banned')}</span>}</div>
          </div>
          <div className="text-xs text-[var(--muted)]">{t('repos.bansnote', 'Banned IPs and keys are blocked from syncing this repo, regardless of the whitelist.')}</div>
        </div>
      )}

      {tab === 'limits' && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><Zap size={14} /> {t('repos.uploadlimit', 'Upload limit')}</span><span className="font-semibold">{reqMbps >= (capKbps / 1024) ? t('repos.max', 'Max') : `${reqMbps.toFixed(1)} Mbps`}</span></div>
            <input type="range" min={0.5} max={Math.max(1, capKbps / 1024)} step={0.5} value={Math.min(reqMbps, capKbps / 1024)} className="bcw-range w-full" onChange={(e) => setReqMbps(Number(e.target.value))} />
            <div className="text-xs mt-2 flex items-center gap-1.5">
              <Lock size={12} className="text-[var(--faint)]" />
              <span className="text-[var(--muted)]">{t('repos.sandboxcap', 'Sandbox cap:')} <b>{(capKbps / 1024).toFixed(1)} Mbps</b>. {t('repos.effective', 'Effective:')} <b className="text-[var(--primary-2)]">{(effectiveKbps / 1024).toFixed(1)} Mbps</b>{capped && ` ${t('repos.wascapped', '(your request was capped)')}`}.</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--line)]">
            <div><div className="text-xs text-[var(--faint)]">{t('repos.storage', 'Storage')}</div><div className="font-semibold">{gb(repo.storageUsedBytes)} / {gb(repo.storageQuotaBytes)} GB</div></div>
            <div><div className="text-xs text-[var(--faint)]">{t('repos.cpushare', 'CPU share')}</div><div className="font-semibold">{repo.cpuShare} vCPU</div></div>
          </div>
          {repo.group ? <QuotaResizer repo={repo} onChanged={onChanged} /> : (repo.hosted && <RepoUpgrade repo={repo} />)}
        </div>
      )}
    </Modal>
  );
}

// Solo hosted repos have a fixed quota (unlike pooled repos, which resize for
// free within their own pool) — this is the self-service path for "I need more
// space than I have": mint a bigger custom plan (storage only ever goes UP;
// upload/CPU floor at whatever the repo already has, never lowered), pay for
// the difference if it's not covered by the free tier, done.
function RepoUpgrade({ repo }) {
  const { t } = useI18n(); const toast = useToast();
  const currentGB = Number(repo.storageQuotaBytes) / 1024 ** 3;
  const [gbVal, setGbVal] = useState(Math.ceil(currentGB * 2));
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (gbVal <= currentGB) { setQuote(null); return; }
    api.get(`/hosting/price?storageGB=${gbVal}&uploadMbps=${(repo.uploadLimitKbps || 0) / 1024}&cpuShare=${repo.cpuShare || 0}`).then(setQuote).catch(() => setQuote(null));
  }, [gbVal, currentGB, repo.uploadLimitKbps, repo.cpuShare]);
  const upgrade = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/me/repos/${repo.id}/upgrade`, { storageGB: gbVal });
      if (res.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      if (res.free) toast.success(t('repos.upgraded.free', 'Upgraded to {n} GB — free tier, no charge.').replace('{n}', gbVal));
    } catch (x) {
      toast.error(x.data?.error === 'capacity_full' ? t('repos.poolfull', 'Pool full — max {n} GB.').replace('{n}', x.data.freeGB?.toFixed(1))
        : x.data?.error === 'not_an_upgrade' ? t('repos.notupgrade', 'Pick a size larger than your current quota.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="pt-3 border-t border-[var(--line)]">
      <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><HardDrive size={14} /> {t('repos.upgradestorage', 'Need more storage?')}</span><span className="font-semibold">{gbVal} GB</span></div>
      <input type="range" min={Math.ceil(currentGB)} max={Math.max(Math.ceil(currentGB) + 1, 500)} step={1} value={gbVal} className="bcw-range w-full" onChange={(e) => setGbVal(Number(e.target.value))} />
      <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
        <span className="text-xs text-[var(--faint)]">
          {gbVal <= currentGB ? t('repos.currentplan', 'Your current plan.')
            : quote?.priceMonthlyCents > 0 ? t('repos.upgradeprice', '{price}/mo · same upload/CPU, more storage').replace('{price}', `$${(quote.priceMonthlyCents / 100).toFixed(2)}`)
            : t('repos.upgradefree', 'Still within the free tier — no charge.')}
        </span>
        <Button size="sm" variant="primary" disabled={busy || gbVal <= currentGB} onClick={upgrade}>{busy ? <Spinner /> : t('repos.upgrade', 'Upgrade')}</Button>
      </div>
    </div>
  );
}

// Grouped (multi) repos can resize their storage within the shared pool.
function QuotaResizer({ repo, onChanged }) {
  const toast = useToast(); const { t } = useI18n();
  const { data } = useFetch(() => api.get('/me/hosting/groups'), []);
  const group = (data?.groups || []).find((g) => g.id === repo.group?.id);
  const [gbVal, setGbVal] = useState(Number(repo.storageQuotaBytes) / 1024 ** 3);
  const [busy, setBusy] = useState(false);
  if (!group) return null;
  const poolGB = group.poolBytes / 1024 ** 3;
  const usedByOthersGB = (group.usedBytes - Number(repo.storageQuotaBytes)) / 1024 ** 3;
  const maxGB = Math.max(0.5, poolGB - usedByOthersGB);
  // The slider can never be dragged below what THIS repo already uses — before
  // this, you could drag down, click Apply, and only then get a "below_used"
  // rejection from the server. Same rule the server already enforces, just
  // surfaced live instead of after a failed round-trip.
  const usedHereGB = Number(repo.storageUsedBytes || 0) / 1024 ** 3;
  const minGB = Math.min(maxGB, Math.max(0.5, Math.ceil(usedHereGB * 2) / 2));
  const save = async () => {
    setBusy(true);
    try { await api.put(`/me/repos/${repo.id}/quota`, { storageGB: Number(gbVal) }); toast.success(t('repos.storupd', 'Storage updated.')); onChanged?.(); }
    catch (x) { toast.error(x.data?.error === 'pool_exceeded' ? t('repos.poolfull', 'Pool full — max {n} GB.').replace('{n}', x.data.freeGB?.toFixed(1)) : x.data?.error === 'below_used' ? t('repos.belowused', 'Below current usage.') : t('repos.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="pt-3 border-t border-[var(--line)]">
      <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><HardDrive size={14} /> {t('repos.storinpool', 'Storage in pool')} "{group.name}"</span><span className="font-semibold">{Number(gbVal).toFixed(1)} GB</span></div>
      <input type="range" min={minGB} max={Math.max(minGB, maxGB)} step={0.5} value={Math.min(Math.max(gbVal, minGB), maxGB)} className="bcw-range w-full" onChange={(e) => setGbVal(Number(e.target.value))} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-[var(--faint)]">{t('repos.pool', 'Pool')} {poolGB.toFixed(0)} GB · {t('repos.usedhere', 'used here')} {usedHereGB.toFixed(1)} GB · {t('repos.usedothers', 'used by others')} {usedByOthersGB.toFixed(1)} GB · {t('repos.maxhere', 'max here')} {maxGB.toFixed(1)} GB</span>
        <Button size="sm" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('repos.apply', 'Apply')}</Button>
      </div>
    </div>
  );
}

// Add a new repo drawing from a multi pool's remaining storage.
function PoolAddModal({ group, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const { data } = useFetch(() => api.get('/me/hosting/groups'), []);
  const g = (data?.groups || []).find((x) => x.id === group.id) || group;
  const freeGB = (Number(g.poolBytes ?? group.poolBytes) - Number(g.usedBytes || 0)) / 1024 ** 3;
  const [name, setName] = useState(''); const [gbVal, setGbVal] = useState(Math.min(5, Math.max(0.5, freeGB)));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (name.length < 2) return toast.error(t('repos.namereq', 'Name is required.'));
    setBusy(true);
    try { await api.post(`/me/hosting/groups/${group.id}/repos`, { name, storageGB: Number(gbVal) }); toast.success(t('repos.pooladded', 'Repo "{name}" added to the pool.').replace('{name}', name)); onDone(); }
    catch (x) { toast.error(x.data?.error === 'pool_exceeded' ? t('repos.poolfull', 'Pool full — max {n} GB.').replace('{n}', x.data.freeGB?.toFixed(1)) : t('repos.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('repos.addtopooltitle', 'Add repo to "{name}"').replace('{name}', group.name)} icon={Plus} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={add}>{busy ? <Spinner /> : t('repos.add', 'Add repo')}</Button></>}>
      <Field label={t('repos.reponame', 'Repo name')}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="second-repo" /></Field>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5 text-sm"><span className="text-[var(--muted)]">{t('repos.storage', 'Storage')}</span><span className="font-semibold">{Number(gbVal).toFixed(1)} GB</span></div>
        <input type="range" min={0.5} max={Math.max(0.5, freeGB)} step={0.5} value={Math.min(gbVal, Math.max(0.5, freeGB))} className="bcw-range w-full" onChange={(e) => setGbVal(Number(e.target.value))} />
        <div className="text-xs text-[var(--faint)] mt-1">{t('repos.freeinpool', '{n} GB free in the pool.').replace('{n}', freeGB.toFixed(1))}</div>
      </div>
    </Modal>
  );
}

function FeatureModal({ repo, onClose }) {
  const toast = useToast(); const { t } = useI18n();
  const [days, setDays] = useState(7);
  const [price, setPrice] = useState(null);
  useEffect(() => { api.get(`/hosting/feature-price?days=${days}`).then((r) => setPrice(r.priceCents)).catch(() => setPrice(null)); }, [days]);
  const buy = async () => {
    try { const { url } = await api.post(`/repos/${repo.id}/feature/checkout`, { days }); window.location = url; }
    catch (x) { toast.error(x.data?.error === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : t('hosting.err.checkout', 'Checkout failed.')); }
  };
  return (
    <Modal open onClose={onClose} title={t('repos.boosttitle', 'Boost "{name}"').replace('{name}', repo.name)} icon={Rocket} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={buy}>{t('hosting.continue', 'Continue to payment')}</Button></>}>
      <p className="text-sm text-[var(--muted)] mb-3">{t('repos.boost.desc', 'Featured repos float to the top of the public list. Pick a duration — at the end, your repo returns to its normal position.')}</p>
      <div className="mb-4 rounded-lg border border-[var(--line)] bg-orange-500/[0.06] p-2.5 text-xs text-[var(--muted)] flex items-start gap-2">
        <Zap size={13} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
        <span>{t('repos.boost.fair', 'Boosted repos share the top spots and rotate fairly on every visit — so the more repos are boosted at once, the more the top positions cycle between them. Boosting always helps, but its edge is strongest when few others are boosting.')}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`p-3 rounded-xl border text-center ${days === d ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
            <div className="text-lg font-bold">{d}</div><div className="text-xs text-[var(--muted)]">{t('repos.days', 'days')}</div>
          </button>
        ))}
      </div>
      <div className="flex items-end justify-between pt-3 border-t border-[var(--line)]">
        <span className="text-sm text-[var(--muted)]">{t('repos.total', 'Total')}</span>
        <span className="text-2xl font-bold gradient-text">{price == null ? '—' : `$${(price / 100).toFixed(2)}`}</span>
      </div>
    </Modal>
  );
}

// Redeem a promo code (free hosting / free boost). Discount codes are entered at checkout.
function PromoRedeem() {
  const toast = useToast(); const { t } = useI18n();
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const [pickRepo, setPickRepo] = useState(false);
  const { data: reposData } = useFetch(() => api.get('/me/repos'), []);
  const repos = reposData?.repos || [];
  const redeem = async (repoId) => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/me/promo/redeem', { code: code.trim(), repoId });
      toast.success(r.kind === 'free_hosting' ? t('promo.gotHosting', 'Redeemed! A free hosted repo was created — see "My repos".')
        : r.kind === 'free_boost' ? t('promo.gotBoost', 'Redeemed! Your repo is now boosted.') : t('promo.ok', 'Redeemed!'));
      setCode(''); setPickRepo(false);
    } catch (x) {
      const e = x.data?.error;
      if (e === 'needs_repo') { setPickRepo(true); }
      else toast.error(e === 'invalid' ? t('promo.invalid', 'Invalid or inactive code.') : e === 'expired' ? t('promo.expired', 'This code has expired.') : e === 'depleted' ? t('promo.depleted', 'This code is fully used.') : e === 'already_used' ? t('promo.used', 'You already used this code.') : e === 'use_at_checkout' ? t('promo.atcheckout', 'This is a discount code — enter it when hosting or boosting.') : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mb-6">
      <div className="flex items-center gap-2 mb-1"><Ticket size={16} className="text-[var(--primary-2)]" /> <span className="font-semibold text-sm">{t('promo.title', 'Redeem a promo code')}</span></div>
      <p className="text-xs text-[var(--muted)] mb-2.5">{t('promo.desc', 'Have a code? Redeem it for free hosting or a boost. (Discount codes are entered at checkout.)')}</p>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => { setCode(e.target.value); setPickRepo(false); }} placeholder="XXXXX-XXXXX" onKeyDown={(e) => e.key === 'Enter' && redeem()} />
        <Button variant="primary" disabled={busy} onClick={() => redeem()}>{busy ? <Spinner /> : t('promo.redeem', 'Redeem')}</Button>
      </div>
      {pickRepo && (
        <div className="mt-3 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1.5">{t('promo.pickrepo', 'Which repo should get the boost?')}</div>
          <div className="flex flex-wrap gap-1.5">
            {repos.length ? repos.map((r) => <Button key={r.id} size="sm" onClick={() => redeem(r.id)}>{r.name}</Button>)
              : <span className="text-xs text-[var(--faint)]">{t('promo.norepos', 'You have no repos to boost yet.')}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Billing / invoices (dashboard) ── */
// One row per hosted repo — its prepaid term, and a renew action. Prepaid hosting
// never auto-renews (no recurring Stripe subscription behind it, see the sweeper),
// so this is the only way to extend it short of buying a whole new repo.
function SubscriptionRow({ repo, onChanged }) {
  const toast = useToast(); const { t } = useI18n();
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const sub = repo.subscription;
  const expired = sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd) <= new Date();
  const soon = sub?.currentPeriodEnd && !expired && (new Date(sub.currentPeriodEnd) - Date.now()) < 7 * 864e5;
  const renew = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/me/repos/${repo.id}/renew`, { months });
      if (res?.free) { toast.success(t('bill.renewed.free', 'Renewed — free tier, no charge.')); onChanged?.(); return; }
      window.location = res.url;
    } catch (x) { toast.error(x.data?.error === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : x.data?.error || t('repos.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm border-t border-[var(--line)] first:border-t-0">
      <Server size={15} className="text-[var(--primary-2)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate flex items-center gap-2">{repo.name} <Badge tone={repo.status === 'SUSPENDED' ? 'red' : repo.status === 'ONLINE' ? 'green' : ''}>{repo.status}</Badge></div>
        <div className="text-xs text-[var(--faint)]">{gb(repo.storageQuotaBytes)} GB · {(repo.uploadLimitKbps / 1024).toFixed(1)} Mbps · {repo.cpuShare} CPU</div>
      </div>
      {sub?.currentPeriodEnd && (
        <div className={`text-xs text-right shrink-0 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-[var(--muted)]'}`}>
          <div className="flex items-center gap-1 justify-end"><Clock size={11} /> {expired ? t('bill.expired', 'Expired') : t('bill.renewson', 'Renews/expires')}</div>
          <div className="font-medium">{new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>
        </div>
      )}
      <Select className="!w-auto !py-1.5 !text-xs" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
        {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} mo</option>)}
      </Select>
      <Button size="sm" variant={expired || repo.deleteAt ? 'primary' : 'default'} disabled={busy} onClick={renew}>{busy ? <Spinner /> : <><RefreshCw size={13} /> {t('bill.renew', 'Renew')}</>}</Button>
    </div>
  );
}

export function Billing() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading } = useFetch(() => api.get('/me/payments'), []);
  const { data: repoData, reload: reloadRepos } = useFetch(() => api.get('/me/repos'), []);
  const [invoice, setInvoice] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const payments = data?.payments || [];
  const hostedRepos = (repoData?.repos || []).filter((r) => r.hosted);
  const openPortal = async () => {
    setPortalBusy(true);
    try { const { url } = await api.post('/me/billing/portal'); window.location = url; }
    catch (x) { toast.error(x.data?.error === 'no_customer' ? t('bill.nocustomer', 'Nothing to manage yet — subscribe or boost a repo first.') : t('bill.portalfail', 'Billing portal unavailable.')); setPortalBusy(false); }
  };
  return (
    <div className="mt-10">
      <PromoRedeem />

      {hostedRepos.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('bill.subs', 'Active hosting')}</h2>
          <Card className="overflow-hidden p-0">
            {hostedRepos.map((r) => <SubscriptionRow key={r.id} repo={r} onChanged={reloadRepos} />)}
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> {t('bill.title', 'Billing & invoices')}</h2>
        <Button size="sm" variant="ghost" disabled={portalBusy} onClick={openPortal}><CreditCard size={13} /> {t('bill.manage', 'Manage billing')}</Button>
      </div>
      {loading ? <div className="text-[var(--muted)] text-sm py-3">{t('common.loading', 'Loading…')}</div>
        : payments.length ? <Card className="overflow-hidden p-0">
          {payments.map((pay, i) => (
            <div key={pay.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${i ? 'border-t border-[var(--line)]' : ''}`}>
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{pay.description}</div><div className="text-xs text-[var(--faint)]">{new Date(pay.createdAt).toLocaleString()}</div></div>
              <Badge tone={pay.status === 'paid' ? 'green' : ''}>{pay.status}</Badge>
              <span className="font-semibold w-16 text-right">${(pay.amountCents / 100).toFixed(2)}</span>
              <Button size="sm" onClick={() => setInvoice(pay.id)}><Receipt size={13} /> {t('bill.invoice', 'Invoice')}</Button>
            </div>
          ))}
        </Card> : <EmptyState icon={Receipt} title={t('bill.empty.t', 'No payments yet')} sub={t('bill.empty.s', 'Boost a repo or host one — invoices appear here.')} />}
      {invoice && <InvoiceModal id={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}

function InvoiceModal({ id, onClose }) {
  const { t } = useI18n();
  const { data, loading } = useFetch(() => api.get(`/me/payments/${id}`), [id]);
  const inv = data?.invoice;
  return (
    <Modal open onClose={onClose} title={t('bill.invoice', 'Invoice')} icon={Receipt} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button><Button variant="primary" onClick={() => window.print()}><Printer size={15} /> {t('bill.print', 'Print / Save PDF')}</Button></>}>
      {loading || !inv ? <div className="text-[var(--muted)] text-sm">{t('common.loading', 'Loading…')}</div> : (
        <div className="text-sm" id="invoice-print">
          <div className="flex items-center justify-between mb-4"><div className="font-extrabold text-lg gradient-text">BetterCommunity</div><div className="text-right"><div className="font-mono text-xs text-[var(--faint)]">{inv.number}</div><div className="text-xs text-[var(--muted)]">{new Date(inv.createdAt).toLocaleDateString()}</div></div></div>
          <div className="text-[var(--muted)] mb-4">{t('bill.billedto', 'Billed to')} <b className="text-[var(--text)]">{inv.user?.displayName}</b> ({inv.user?.email})</div>
          <div className="flex justify-between py-2 border-y border-[var(--line)]"><span>{inv.description}</span><span className="font-semibold">${(inv.amountCents / 100).toFixed(2)}</span></div>
          <div className="flex justify-between py-3 font-bold"><span>{t('repos.total', 'Total')} ({inv.currency.toUpperCase()})</span><span>${(inv.amountCents / 100).toFixed(2)}</span></div>
          <div className="text-xs text-[var(--faint)] mt-2">{t('bill.status', 'Status:')} {inv.status} · {t('bill.thanks', 'Thank you!')}</div>
        </div>
      )}
    </Modal>
  );
}

function RepoEditor({ repo, onClose, onSaved }) {
  const toast = useToast(); const { t } = useI18n();
  const [f, setF] = useState({ name: '', description: '', repoUrl: '', tags: '', discord: '', website: '', changelog: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (repo) setF({ name: repo.name, description: repo.description || '', repoUrl: repo.repoUrl || '', tags: (repo.tags || []).join(', '), discord: repo.links?.discord || '', website: repo.links?.website || '', changelog: repo.links?.changelog || '' }); }, [repo]);
  const save = async () => {
    if (f.name.length < 2) return toast.error(t('repos.nameshort', 'Name too short.'));
    setBusy(true);
    const links = {}; if (f.discord) links.discord = f.discord; if (f.website) links.website = f.website; if (f.changelog) links.changelog = f.changelog;
    const body = { name: f.name, description: f.description, repoUrl: f.repoUrl || undefined, tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean), links };
    try { if (repo) await api.patch(`/repos/${repo.id}`, body); else await api.post('/repos', body); toast.success(repo ? t('repos.saved', 'Saved.') : t('repos.added', 'Repo added.')); onSaved(); }
    catch (x) { toast.error(x.data?.error || t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={repo ? t('repos.edit.title', 'Edit repo') : t('repos.add.title', 'Add a repo')} icon={GitBranch} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (repo ? t('repos.save', 'Save') : t('repos.addshort', 'Add'))}</Button></>}>
      <div className="space-y-3">
        <Field label={t('repos.f.name', 'Name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('repos.f.name.ph', 'My mods repo')} /></Field>
        <Field label={t('repos.f.desc', 'Description')}><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t('repos.f.desc.ph', "What's in it?")} /></Field>
        {/* Hosted repos serve at an auto-managed URL (owner/repo); only self-host repos set their own URL. */}
        {repo?.hosted
          ? <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)] flex items-center gap-2"><Lock size={13} className="text-[var(--primary-2)] shrink-0" /> {t('repos.f.urlauto', 'Public URL is managed automatically for hosted repos — publish from the Files panel.')}</div>
          : <Field label={t('repos.f.url', 'Repo URL')} hint={t('repos.f.url.hint', 'Direct URL to the repo.json manifest — checked & hashed automatically.')}><Input value={f.repoUrl} onChange={(e) => setF({ ...f, repoUrl: e.target.value })} placeholder="https://…/repo.json" /></Field>}
        <Field label={t('repos.f.tags', 'Tags')} hint={t('repos.f.tags.hint', 'Comma-separated.')}><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="aircraft, sound" /></Field>
        <div className="grid sm:grid-cols-3 gap-2">
          <Field label="Discord"><Input value={f.discord} onChange={(e) => setF({ ...f, discord: e.target.value })} placeholder="https://discord.gg/…" /></Field>
          <Field label={t('repos.website', 'Website')}><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
          <Field label={t('repos.changelog', 'Changelog')}><Input value={f.changelog} onChange={(e) => setF({ ...f, changelog: e.target.value })} placeholder="https://…" /></Field>
        </div>
        <p className="text-xs text-[var(--faint)]">{t('repos.shanote', 'The content SHA is computed automatically from the repo.json. A valid manifest is verified and appears in the public list; an invalid one stays unverified. You can ask an admin to re-validate.')}</p>
      </div>
    </Modal>
  );
}

// Hosted-repo content manager (user uploads / admin review). Files are never executed.
function HostFilesModal({ repo, admin, onClose, onChanged }) {
  const toast = useToast(); const { t } = useI18n();
  const { enqueue } = useUploads();
  const { data, loading, reload } = useFetch(() => api.get(`/repos/${repo.id}/files`), [repo.id]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = data || {}; const files = d.files || [];
  const mb = (n) => (Number(n) / 1024 / 1024).toFixed(1);
  const pct = d.quota ? Math.min(100, (d.used / d.quota) * 100) : 0;
  const hasRepoJson = files.some((f) => f.path === 'repo.json') && !!d.repoJson;
  const publicUrl = d.hostPath ? `${location.origin}/hosting/${d.hostPath}/repo.json` : '';
  // Uploads run in the global background manager, so they keep going after this
  // modal is closed (a floating dock shows progress + a completion toast).
  const upload = (list) => {
    if (!list.length) return;
    enqueue(repo.id, repo.name, list, { onDone: () => { reload(); onChanged?.(); } });
  };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) upload(fs); };
  const del = async (f) => { try { await api.del(`/repos/${repo.id}/files/${f.id}`); reload(); onChanged?.(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  // Admin: download any file (presigned) to review the actual bytes before publishing.
  const dl = async (f) => { try { const { url } = await api.get(`/admin/repos/${repo.id}/files/${f.id}/download`); await forceDownload(url, f.path?.split('/').pop() || 'file'); } catch { toast.error(t('repos.dlfail', 'Download failed.')); } };
  // Admin: download the whole repo as one zip (server-built) for review.
  const downloadAll = async () => {
    try {
      const res = await fetch(`/api/admin/repos/${repo.id}/files/download-all`, { credentials: 'include' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); return toast.error(e.error === 'too_large' ? t('repos.ziptoobig', 'Too large to zip — download files individually.') : t('repos.dlfail', 'Download failed.')); }
      const blob = await res.blob(); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${repo.name}.zip`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { toast.error(t('repos.dlfail', 'Download failed.')); }
  };
  // Owner: go online / take offline (public URL is auto-managed for hosted repos).
  const goOnline = async () => { setBusy(true); try { await api.post(`/repos/${repo.id}/publish`); toast.success(t('repos.nowonline', 'Online — your repo.json is now public.')); reload(); onChanged?.(); } catch (x) { toast.error(x.data?.error === 'no_repo_json' ? t('repos.needjson', 'Upload a valid repo.json first.') : t('repos.failed', 'Failed.')); } finally { setBusy(false); } };
  const takeOffline = async () => { setBusy(true); try { await api.post(`/repos/${repo.id}/unpublish`); toast.success(t('repos.nowoffline', 'Taken offline.')); reload(); onChanged?.(); } catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); } };
  // Admin: validate & publish / unpublish (moderation gate).
  const publish = async () => { try { const r = await api.post(`/admin/repos/${repo.id}/publish`); toast.success(`Published → /hosting/${r.hostPath}/repo.json`); reload(); onChanged?.(); } catch (x) { toast.error(x.data?.error === 'no_repo_json' ? t('repos.needjson', 'A repo.json must be uploaded first.') : t('repos.failed', 'Failed.')); } };
  const unpublish = async () => { try { await api.post(`/admin/repos/${repo.id}/unpublish`); reload(); onChanged?.(); } catch {} };
  const copyUrl = () => { navigator.clipboard?.writeText(publicUrl); toast.success(t('repos.copy.ok', 'repo.json link copied.')); };
  return (
    <Modal open onClose={onClose} title={`${admin ? t('repos.review', 'Review content') : t('repos.managefiles', 'Manage files')} — ${repo.name}`} icon={Files} width="max-w-2xl"
      footer={admin
        ? <><Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button>{files.length > 0 && <Button onClick={downloadAll}><Download size={15} /> {t('repos.downloadall', 'Download all')}</Button>}{d.published ? <Button onClick={unpublish}><EyeOff size={15} /> {t('repos.unpublish', 'Unpublish')}</Button> : <Button variant="primary" onClick={publish}><CheckCircle2 size={15} /> {t('repos.validate', 'Validate & publish')}</Button>}</>
        : <Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button>}>
      {/* storage meter */}
      <div className="flex items-center gap-3 text-sm mb-3">
        <HardDrive size={16} className="text-[var(--primary-2)]" />
        <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} /></div>
        <span className="text-[var(--muted)] whitespace-nowrap">{mb(d.used || 0)} / {mb(d.quota || 0)} MB</span>
      </div>

      {/* Online status panel — owner self-serve publish. The public URL is auto-managed. */}
      {!admin && d.hosted && (
        <div className={`rounded-xl border p-3 mb-3 ${d.published ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-[var(--line)] bg-[var(--surface-2)]'}`}>
          <div className="flex items-center gap-2.5">
            {d.published ? <Wifi size={16} className="text-emerald-400 shrink-0" /> : <WifiOff size={16} className="text-[var(--faint)] shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{d.published ? t('repos.online', 'Online') : t('repos.offline', 'Offline')}</div>
              <div className="text-[11px] text-[var(--faint)]">{t('repos.urlauto', 'Public URL is managed automatically')}</div>
            </div>
            {d.published
              ? <Button size="sm" disabled={busy} onClick={takeOffline}>{busy ? <Spinner /> : <><WifiOff size={13} /> {t('repos.takeoffline', 'Take offline')}</>}</Button>
              : <Button size="sm" variant="primary" disabled={busy || !hasRepoJson} onClick={goOnline}>{busy ? <Spinner /> : <><Rocket size={13} /> {t('repos.goonline', 'Go online')}</>}</Button>}
          </div>
          {d.published && publicUrl && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-[var(--bg-solid)] border border-[var(--line)] px-2.5 py-1.5">
              <FileJson size={13} className="text-[var(--primary-2)] shrink-0" />
              <code className="text-[11px] text-[var(--muted)] break-all flex-1 min-w-0">{publicUrl}</code>
              <button onClick={copyUrl} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('repos.copylink', 'Copy link')}><Copy size={13} /></button>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('repos.feed.open', 'Open')}><ExternalLink size={13} /></a>
            </div>
          )}
          {!d.published && !hasRepoJson && <div className="mt-2 text-[11px] text-amber-400/90 flex items-center gap-1.5"><AlertTriangle size={12} /> {t('repos.needjsonhint', 'Upload a valid repo.json below, then Go online.')}</div>}
          {!d.published && hasRepoJson && <div className="mt-2 text-[11px] text-emerald-400/90 flex items-center gap-1.5"><CheckCircle2 size={12} /> {t('repos.readyonline', 'Valid repo.json detected — ready to go online.')}</div>}
        </div>
      )}

      {/* upload — drag & drop zone + file / folder pickers */}
      {!admin && (
        <div className="mb-3">
          <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
               className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragOver ? 'border-[var(--primary)] bg-orange-500/[0.06]' : 'border-[var(--line)]'}`}>
            <UploadCloud size={22} className={`mx-auto mb-1.5 ${dragOver ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} />
            <div className="text-sm text-[var(--muted)]">{t('repos.drophere', 'Drop files here')} <span className="text-[var(--faint)]">— {t('repos.orpick', 'or')}</span></div>
            <div className="flex items-center justify-center gap-2 mt-2.5">
              <label className="btn btn-sm cursor-pointer"><UploadCloud size={13} /> {t('repos.pickfiles', 'Choose files')}
                <input type="file" multiple className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} /></label>
              <label className="btn btn-sm cursor-pointer"><FolderUp size={13} /> {t('repos.pickfolder', 'Choose folder')}
                <input type="file" multiple webkitdirectory="" directory="" className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} /></label>
            </div>
            <div className="text-[11px] text-[var(--faint)] mt-2">{t('repos.includejson', 'Include a')} <code>repo.json</code> {t('repos.tomanifest', 'manifest. SHA / checksum is computed automatically.')}</div>
          </div>
          <p className="text-[11px] text-[var(--faint)] flex items-center gap-1.5 mt-1.5"><Zap size={11} className="text-[var(--primary-2)]" /> {t('repos.upbg', "Uploads continue in the background if you close this window — you'll get a notification when they finish.")}</p>
        </div>
      )}

      {/* file list */}
      {loading ? <div className="text-sm text-[var(--muted)] py-3">{t('common.loading', 'Loading…')}</div> : (
        <div className="space-y-1.5 max-h-[40vh] overflow-auto">
          {files.length ? files.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
              {f.path === 'repo.json' ? <FileJson size={15} className="text-[var(--primary-2)]" /> : <FileText size={15} className="text-[var(--faint)]" />}
              <span className="flex-1 truncate font-mono text-xs">{f.path}</span>
              {f.sha256 && <span className="hidden md:inline text-[10px] text-[var(--faint)] font-mono" title={`SHA-256: ${f.sha256}`}>{f.sha256.slice(0, 10)}…</span>}
              <span className="text-xs text-[var(--faint)]">{fmtSize(f.size)}</span>
              {admin && <button className="text-[var(--faint)] hover:text-[var(--primary-2)]" title={t('repos.download', 'Download')} onClick={() => dl(f)}><Download size={14} /></button>}
              {!admin && <button className="text-[var(--faint)] hover:text-red-400" onClick={() => del(f)}><Trash2 size={14} /></button>}
            </div>
          )) : <div className="text-sm text-[var(--faint)] py-2">{t('repos.nofiles', 'No files yet.')}</div>}
        </div>
      )}

      {d.repoJson && <div className="mt-4"><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">{t('repos.jsonpreview', 'repo.json (preview — never executed)')}</div>
        <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-52 overflow-auto">{JSON.stringify(d.repoJson, null, 2)}</pre></div>}
    </Modal>
  );
}

/* ── Admin: all repos ── */
// Admin: paste a Repo ID (BCR-XXXX-XXXX) and see the full combined-identity
// picture behind it — which repo, which BCWEB account, and that owner's linked
// BMM creator ids / Discord ids / Ko-fi donor status.
function RepoIdentifyCard() {
  const toast = useToast();
  const [fp, setFp] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lookup = async () => {
    if (!fp.trim()) return;
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await api.get(`/admin/repos/identify?fp=${encodeURIComponent(fp.trim())}`)); }
    catch (x) { setErr(x.data?.error === 'not_found' ? 'No repo matches that ID.' : x.data?.error === 'invalid_fingerprint' ? 'Not a valid Repo ID (format: BCR-XXXX-XXXX).' : 'Lookup failed.'); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><Fingerprint size={16} className="text-[var(--primary-2)]" /> Identify a repo by ID</div>
      <p className="text-xs text-[var(--muted)] mb-3">Paste the <span className="font-mono">BCR-XXXX-XXXX</span> ID shown on a repo to resolve it to its owner and their linked identities (BMM creator ids, Discord, Ko-fi).</p>
      <div className="grid sm:grid-cols-[1fr_auto] gap-2">
        <Input value={fp} onChange={(e) => setFp(e.target.value)} placeholder="BCR-7K2M-9XQ4" onKeyDown={(e) => e.key === 'Enter' && lookup()} className="font-mono" />
        <Button variant="primary" disabled={busy} onClick={lookup}>{busy ? <Spinner /> : <><Search size={14} /> Identify</>}</Button>
      </div>
      {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
      {res && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2"><GitBranch size={13} className="text-[var(--primary-2)]" /> <span className="font-medium">{res.repo.name}</span> <Badge tone={res.repo.hosted ? 'primary' : ''}>{res.repo.hosted ? 'hosted' : 'listed'}</Badge></div>
          <div className="text-[var(--muted)]"><Users size={12} className="inline mr-1" /> Owner: <b>{res.owner.displayName}</b> · {res.owner.email} <Badge>{res.owner.role}</Badge></div>
          <div className="text-[var(--muted)]"><span className="text-[var(--faint)]">BCWEB id:</span> <span className="font-mono text-xs">{res.owner.id}</span></div>
          <div className="text-[var(--muted)]"><span className="text-[var(--faint)]">Creator ids:</span> {res.identity.creatorIds.length ? res.identity.creatorIds.map((c) => <span key={c} className="font-mono text-xs mr-1.5">{c}</span>) : <span className="text-[var(--faint)]">none</span>}</div>
          <div className="text-[var(--muted)]"><span className="text-[var(--faint)]">Discord ids:</span> {res.identity.discordIds.length ? res.identity.discordIds.map((d) => <span key={d} className="font-mono text-xs mr-1.5">{d}</span>) : <span className="text-[var(--faint)]">none</span>}</div>
          <div className="text-[var(--muted)]"><span className="text-[var(--faint)]">Ko-fi donor:</span> {res.identity.kofiDonor ? <Badge tone="green">yes</Badge> : <span className="text-[var(--faint)]">no</span>}</div>
        </div>
      )}
    </Card>
  );
}

export function AdminRepos() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useFetch(() => api.get('/admin/repos'), []);
  const [review, setReview] = useState(null);
  const repos = data?.repos || [];
  const pending = repos.filter((r) => r.pendingReview).length;
  const verify = async (r) => { try { await api.post(`/admin/repos/${r.id}/verify`); toast.success(`Verified "${r.name}".`); reload(); } catch { toast.error('Failed.'); } };
  const reject = async (r) => { const reason = await dialog.prompt({ title: 'Reject / unlist', label: 'Reason (sent to owner)', okLabel: 'Reject', danger: true }); if (!reason) return; try { await api.post(`/admin/repos/${r.id}/reject`, { reason }); toast.success('Rejected.'); reload(); } catch { toast.error('Failed.'); } };
  const setStatus = async (r, status) => { try { await api.patch(`/admin/repos/${r.id}`, { status }); reload(); } catch { toast.error('Failed.'); } };
  // Manually re-run validation: recompute the content SHA and re-verify.
  const revalidate = async (r) => { try { const res = await api.post(`/admin/repos/${r.id}/revalidate`); toast[res.verified ? 'success' : 'error'](res.verified ? `Revalidated — verified (sha ${String(res.sha).slice(0, 10)}…).` : `Revalidated — invalid (${res.reason || 'no valid repo.json'}).`); reload(); } catch { toast.error('Failed.'); } };
  const [checkingAll, setCheckingAll] = useState(false);
  const checkAll = async () => { setCheckingAll(true); try { const r = await api.post('/admin/repos/check-all'); toast.success(`Checked ${r.checked} repos — ${r.online} online, ${r.verified} verified.`); reload(); } catch { toast.error('Check failed.'); } finally { setCheckingAll(false); } };
  const limits = async (r) => {
    const storageGB = await dialog.prompt({ title: 'Storage quota', label: 'GB', defaultValue: String(gb(r.storageQuotaBytes)) }); if (storageGB === false) return;
    const uploadLimitKbps = await dialog.prompt({ title: 'Upload limit', label: 'kbps', defaultValue: String(r.uploadLimitKbps) }); if (uploadLimitKbps === false) return;
    try { await api.patch(`/admin/repos/${r.id}`, { storageGB: Number(storageGB), uploadLimitKbps: Number(uploadLimitKbps) }); toast.success('Limits set.'); reload(); } catch { toast.error('Failed.'); }
  };
  return (
    <div className="mt-10">
      <RepoIdentifyCard />
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Server size={16} className="text-[var(--primary-2)]" /> Server Repos</h2>
        <div className="flex items-center gap-2">
          {pending > 0 && <Badge tone="amber"><Clock size={11} /> {pending} pending review</Badge>}
          <Button size="sm" disabled={checkingAll} onClick={checkAll}>{checkingAll ? <Spinner /> : <><RefreshCw size={14} /> Check all</>}</Button>
        </div>
      </div>
      {loading ? <div className="text-[var(--muted)] text-sm py-4">Loading…</div>
        : repos.length ? <div className="space-y-2">
          {repos.map((r) => (
            <Card key={r.id} className={`p-4 ${r.pendingReview ? 'border-[var(--ring)]' : ''}`}>
              <div className="flex items-start gap-3">
                <GitBranch size={18} className="text-[var(--primary-2)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.name} <span className="text-xs text-[var(--faint)] font-normal">· {r.owner?.displayName}</span></div>
                  <div className="mt-2"><StatusBadges r={r} /></div>
                  {r.hosted && (
                    <div className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-2 flex-wrap">
                      {r.subscription?.currentPeriodEnd ? (
                        <span className={`flex items-center gap-1 ${new Date(r.subscription.currentPeriodEnd) <= new Date() ? 'text-red-400' : ''}`}>
                          <Clock size={11} /> {new Date(r.subscription.currentPeriodEnd) <= new Date() ? 'Expired' : 'Expires'} {new Date(r.subscription.currentPeriodEnd).toLocaleDateString()}
                        </span>
                      ) : <span className="text-[var(--faint)]">No term on file</span>}
                      {r.subscription?.status === 'canceled' && <Badge tone="red">subscription cancelled</Badge>}
                      {r.subscription?.status === 'expired' && <Badge tone="red">term expired</Badge>}
                      <span className="flex items-center gap-1 text-[var(--faint)]"><CreditCard size={11} /> {r.owner?.stripeCustomerId ? 'Stripe customer on file' : 'No Stripe customer'}</span>
                    </div>
                  )}
                </div>
                <Select className="!w-auto !py-1.5 text-xs" value={r.status} onChange={(e) => setStatus(r, e.target.value)}>
                  {['ONLINE', 'OFFLINE', 'SUSPENDED', 'PROVISIONING'].map((s) => <option key={s}>{s}</option>)}
                </Select>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {r.pendingReview && <Button size="sm" variant="primary" onClick={() => verify(r)}><ShieldCheck size={14} /> Verify</Button>}
                <Button size="sm" onClick={() => revalidate(r)}><ShieldCheck size={14} /> Revalidate SHA</Button>
                {r.hosted && <Button size="sm" onClick={() => setReview(r)}><Files size={14} /> Review &amp; download</Button>}
                <Button size="sm" onClick={() => reject(r)}><XCircle size={14} /> Reject / unlist</Button>
                <Button size="sm" onClick={() => limits(r)}><HardDrive size={14} /> Limits</Button>
              </div>
            </Card>
          ))}
        </div> : <EmptyState icon={Server} title="No repos" />}
      {review && <HostFilesModal repo={review} admin onClose={() => setReview(null)} onChanged={reload} />}
    </div>
  );
}
