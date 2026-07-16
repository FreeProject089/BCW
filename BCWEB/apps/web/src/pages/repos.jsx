import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Server, GitBranch, Star, Plus, Pencil, Trash2, UploadCloud, Eye, EyeOff, CheckCircle2,
  XCircle, Clock, ShieldCheck, ExternalLink, Tag, Users, HardDrive, Settings2, Receipt, Printer, Rocket,
  Files, FileText, FileJson, FolderUp, CreditCard, Search, X, Wifi, WifiOff, Zap, Lock, Download, Copy, RefreshCw, AlertTriangle, LayoutDashboard, MoreHorizontal, Ticket,
  Ban, Globe, Shield, ChevronDown, Fingerprint, Info, Sliders, Cpu, Check, BadgeCheck, Handshake, Boxes, GitMerge, Link2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ReportButton } from '../ui/report.jsx';
import { api, uploadRepoFile } from '../lib/api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Dropdown, Field, PageHeader, EmptyState, Spinner, Modal, ActionBar } from '../ui/ui.jsx';
import { useUploads } from './uploads.jsx';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';

export function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, loading, reload };
}
export const gb = (n) => (Number(n) / 1024 ** 3).toFixed(1);
// Adaptive size so small files don't all read "0.0 MB".
const fmtSize = (n) => { n = Number(n) || 0; if (n < 1024) return `${n} B`; if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`; if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`; return `${(n / 1024 ** 3).toFixed(2)} GB`; };

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
  const [cat, setCat] = useState('all'); // trust tier filter: all | official | partner | community
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
    if (cat !== 'all' && (r.category || 'community') !== cat) return false;
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (q) { const s = q.toLowerCase(); if (!`${r.name} ${r.description || ''} ${(r.tags || []).join(' ')} ${r.owner?.displayName || ''}`.toLowerCase().includes(s)) return false; }
    return true;
  });

  return (
    <div>
      <PageHeader icon={Server} title={t('repos.title', 'Server Repos')} subtitle={t('repos.sub', 'Verified community repositories — featured ones first.')} />

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
      {/* Trust-tier filter — official / partner / community (same tiers as the badges). */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[['all', t('repos.tier.all', 'All tiers'), null],
          ['official', t('repos.cat.official', 'Official'), BadgeCheck],
          ['partner', t('repos.cat.partner', 'Partner'), Handshake],
          ['community', t('repos.cat.community', 'Community'), Users]].map(([key, label, Ico]) => (
          <button key={key} onClick={() => setCat(key)} className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 transition ${cat === key ? 'border-[var(--primary)] text-[var(--text)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {Ico && <Ico size={11} />} {label}
          </button>
        ))}
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
                        {(() => { const cat = repoCategoryMeta(r.category, t); return cat && <Badge tone={cat.tone}><cat.Icon size={11} /> {cat.label}</Badge>; })()}
                        {r.featured && <Badge tone="amber"><Star size={11} /> {t('repos.featured', 'Featured')}</Badge>}
                        <Badge tone="green"><ShieldCheck size={11} /> {t('repos.verified', 'Verified')}</Badge>
                        <button onClick={() => toggleFavorite(r)} title={r.favorited ? t('repos.unfavorite', 'Unfavorite') : t('repos.favorite', 'Favorite')}
                          className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border ${r.favorited ? 'border-amber-400/50 text-amber-400 bg-amber-400/10' : 'border-[var(--line)] text-[var(--faint)] hover:text-amber-400'}`}>
                          <Star size={12} fill={r.favorited ? 'currentColor' : 'none'} /> {r.favoriteCount || 0}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-[var(--faint)] mt-1 flex items-center gap-3 flex-wrap">
                      {r.ownerId ? <Link to={`/u/${r.ownerId}`} className="flex items-center gap-1 hover:text-[var(--primary)]"><Users size={12} /> {r.owner?.displayName}</Link> : <span className="flex items-center gap-1"><Users size={12} /> {r.owner?.displayName}</span>}
                      {r.ownerBcId && <button onClick={() => { navigator.clipboard?.writeText(r.ownerBcId); toast.success(t('repos.bcidcopied', 'Host BC id copied.')); }} title={t('repos.copybcid', 'Copy the host’s BC id')} className="inline-flex items-center gap-1 font-mono hover:text-[var(--primary)]"><Fingerprint size={11} /> {r.ownerBcId} <Copy size={9} className="opacity-60" /></button>}
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
                      <ReportButton targetType="repo" targetId={r.id} targetLabel={r.name} />
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

// Effective repo status → { label, tone } for a badge. Priority order matters:
// SUSPENDED (locked) wins over everything; PROVISIONING is the transient setup state;
// a listed repo still awaiting admin verification reads "In review"; then online/offline.
export function repoStatusMeta(r, t) {
  if (r.status === 'SUSPENDED') return { key: 'suspended', label: t('repos.st.suspended', 'Suspended'), tone: 'red' };
  if (r.status === 'PROVISIONING') return { key: 'provisioning', label: t('repos.st.provisioning', 'Provisioning'), tone: 'amber' };
  if (r.pendingReview) return { key: 'inreview', label: t('repos.st.inreview', 'In review'), tone: 'amber' };
  if (r.status === 'ONLINE') return { key: 'online', label: t('repos.online', 'Online'), tone: 'green' };
  return { key: 'offline', label: t('repos.offline', 'Offline'), tone: '' };
}
// i18n label for a RAW enum value (admin status dropdown sets the raw status).
export const rawStatusLabel = (s, t) => ({
  ONLINE: t('repos.online', 'Online'), OFFLINE: t('repos.offline', 'Offline'),
  SUSPENDED: t('repos.st.suspended', 'Suspended'), PROVISIONING: t('repos.st.provisioning', 'Provisioning'),
}[s] || s);

// Whether the owner is locked out of managing this repo (suspended = read-only, no
// online/list/edit/delete — matches the server-side guard).
export const repoLocked = (r) => r.status === 'SUSPENDED';

// Trust tier → badge. Official (BMM team, green) / Partner (trusted, blue) get a badge;
// community repos get none. Mirrors the Better_ModManager_ServerBrowse classification.
export function repoCategoryMeta(cat, t, includeCommunity = false) {
  if (cat === 'official') return { key: 'official', label: t('repos.cat.official', 'Official'), tone: 'green', Icon: BadgeCheck };
  if (cat === 'partner') return { key: 'partner', label: t('repos.cat.partner', 'Partner'), tone: 'blue', Icon: Handshake };
  // In owner/admin surfaces we badge community too (so all three tiers are easy to tell
  // apart); the public list stays clean and only badges official/partner.
  if (includeCommunity) return { key: 'community', label: t('repos.cat.community', 'Community'), tone: '', Icon: Users };
  return null;
}

// A themed dropdown (portal-based so it's never clipped by a card): a trigger button +
// a floating menu of colour-dotted options. Replaces the OS-native <select> popup that
// ignored the app theme. Used for the admin repo status + category pickers.
export function DotDropdown({ value, options, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  const cur = options.find((o) => o.value === value) || options[0];
  const openMenu = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right, minWidth: Math.max(r.width, 168) }); setOpen(true); };
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? setOpen(false) : openMenu())} aria-expanded={open}
        className={`press-sm inline-flex items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--ring)] transition-colors ${className}`}>
        {cur.Icon ? <cur.Icon size={13} style={{ color: cur.color }} /> : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cur.color || 'var(--faint)' }} />}
        <span className="whitespace-nowrap">{cur.label}</span>
        <ChevronDown size={13} className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="fixed z-[71] rounded-xl border border-[var(--line-strong)] p-1 shadow-lg anim-pop" style={{ top: pos.top, right: pos.right, minWidth: pos.minWidth, background: 'var(--bg-solid)' }}>
            {options.map((o) => (
              <button key={o.value} type="button" onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}
                className={`press-sm w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-left transition-colors ${o.value === value ? 'bg-[var(--surface-2)] font-medium' : 'hover:bg-[var(--surface-2)] text-[var(--muted)]'}`}>
                {o.Icon ? <o.Icon size={14} style={{ color: o.color }} /> : <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: o.color }} />}
                <span className="flex-1 whitespace-nowrap">{o.label}</span>
                {o.value === value && <Check size={13} className="text-[var(--primary-2)]" />}
              </button>
            ))}
          </div>
        </>, document.body)}
    </>
  );
}

const STATUS_COLOR = { ONLINE: 'var(--success)', OFFLINE: 'var(--faint)', SUSPENDED: 'var(--error)', PROVISIONING: 'var(--warning)' };
export function RepoStatusSelect({ value, onChange }) {
  const { t } = useI18n();
  const options = ['ONLINE', 'OFFLINE', 'SUSPENDED', 'PROVISIONING'].map((s) => ({ value: s, label: rawStatusLabel(s, t), color: STATUS_COLOR[s] }));
  return <DotDropdown value={value} options={options} onChange={onChange} />;
}
export function RepoCategorySelect({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    { value: 'community', label: t('repos.cat.community', 'Community'), color: 'var(--faint)', Icon: Users },
    { value: 'official', label: t('repos.cat.official', 'Official'), color: 'var(--success)', Icon: BadgeCheck },
    { value: 'partner', label: t('repos.cat.partner', 'Partner'), color: 'var(--info)', Icon: Handshake },
  ];
  return <DotDropdown value={value || 'community'} options={options} onChange={onChange} />;
}

export function StatusBadges({ r }) {
  const { t } = useI18n();
  const cat = repoCategoryMeta(r.category, t, true);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {cat && <Badge tone={cat.tone}><cat.Icon size={10} /> {cat.label}</Badge>}
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

// Storage pools overview — each pool with a used/free bar (repos vs catalogs), what's on
// it, and one-click add of a repo or catalog. Carving a 1 GB pool into e.g. 4×250 MB repos
// is just adding repos with a quota — the free-space readout makes that obvious.
const POOL_COLORS = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#f87171'];
function PoolsPanel({ groups, onAddRepo, t, reload, toast, dialog }) {
  const pct = (n, tot) => tot > 0 ? Math.min(100, Math.round((n / tot) * 100)) : 0;
  // Each pool gets a distinct accent: the owner's chosen colour, or a palette default by index.
  const colorOf = (g, i) => g.color || POOL_COLORS[i % POOL_COLORS.length];
  const setColor = async (g, color) => { try { await api.patch(`/me/hosting/groups/${g.id}`, { color }); reload?.(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  // Multi-select merge: tick several pools, pick which one they all fold into. The
  // subscriptions move with their pool, and the target becomes one bigger pool.
  const [sel, setSel] = useState(() => new Set());
  const [mergeInto, setMergeInto] = useState('');
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Deferred with an undo window — only actually merges when the toast timer elapses;
  // Undo cancels it and nothing changes. Accepts one or many source pools.
  const merge = (sourceIds, targetId) => {
    const ids = sourceIds.filter((id) => id !== targetId);
    const tgt = groups.find((g) => g.id === targetId);
    if (!tgt || ids.length === 0) return;
    const names = ids.map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean).map((n) => `"${n}"`).join(', ');
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('pools.merging', 'Merging {s} into "{t}"…').replace('{s}', names).replace('{t}', tgt.name),
      onCommit: async () => { try { await api.post('/me/hosting/groups/merge', { sourceIds: ids, targetId }); setSel(new Set()); setMergeInto(''); reload?.(); } catch (x) { toast.error(x.data?.error || t('repos.failed', 'Failed.')); } },
      onCancel: () => {},
    });
  };
  // Valid merge targets = a selected pool (fold the rest into it) or, if the target is
  // unselected, any pool; sources = everything selected that isn't the target.
  const doMultiMerge = () => { if (!mergeInto) return; merge([...sel], mergeInto); };
  // Lazy consolidation-savings quote for a merged pool (several separate paid subs). Purely
  // informational — shows what one plan sized to the whole pool would cost vs. the sum of
  // the current subs. No billing change happens here.
  const [quotes, setQuotes] = useState({}); // { [poolId]: 'loading' | quoteObj | 'err' }
  const loadQuote = async (g) => {
    setQuotes((q) => ({ ...q, [g.id]: 'loading' }));
    try { const r = await api.get(`/me/hosting/groups/${g.id}/consolidation`); setQuotes((q) => ({ ...q, [g.id]: r })); }
    catch { setQuotes((q) => ({ ...q, [g.id]: 'err' })); }
  };
  const money = (c) => `${(c / 100).toFixed(2)}€`;
  // Execute consolidation → Stripe Checkout for the single bigger plan (webhook cancels the
  // old subs on payment). Redirects to the hosted checkout page.
  const consolidate = async (g) => {
    try { const r = await api.post(`/me/hosting/groups/${g.id}/consolidate`, {}); if (r.url) location.href = r.url; }
    catch (x) { toast.error(x.data?.error === 'no_saving' ? t('pools.consol.nosave', 'No saving available right now.') : t('repos.failed', 'Failed.')); }
  };
  // Collapsible (persisted) so the pools list can be hidden when the dashboard is busy.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('bcw.pools.collapsed') === '1'; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((v) => { const n = !v; try { localStorage.setItem('bcw.pools.collapsed', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  return (
    <div className="mb-5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={toggleCollapsed} className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] hover:text-[var(--text)] flex items-center gap-1.5 transition-colors" title={collapsed ? t('pools.expand', 'Show pools') : t('pools.collapse', 'Hide pools')}>
          <ChevronDown size={13} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} /> <HardDrive size={13} className="text-[var(--primary-2)]" /> {t('pools.title', 'Storage pools')} <span className="text-[var(--faint)] normal-case font-normal">({groups.length})</span>
        </button>
        {!collapsed && groups.length > 1 && sel.size >= 1 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[var(--faint)]">{t('pools.selcount', '{n} selected').replace('{n}', String(sel.size))}</span>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="input !w-auto !py-1 !text-xs" title={t('pools.mergeinto', 'Merge into another pool')}>
              <option value="">{t('pools.mergeinto', 'Merge into…')}</option>
              {groups.filter((o) => !sel.has(o.id) || sel.size >= 2).map((o) => <option key={o.id} value={o.id}>{o.name}{sel.has(o.id) ? ` (${t('pools.keep', 'keep this one')})` : ''}</option>)}
            </select>
            <Button size="sm" variant="primary" disabled={!mergeInto || [...sel].filter((id) => id !== mergeInto).length === 0} onClick={doMultiMerge}><GitMerge size={13} /> {t('pools.mergebtn', 'Merge')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSel(new Set()); setMergeInto(''); }}>{t('common.clear', 'Clear')}</Button>
          </div>
        )}
      </div>
      {!collapsed && groups.map((g, i) => {
        const free = Math.max(0, g.poolBytes - g.usedBytes);
        const repoPct = pct(g.repoBytes, g.poolBytes), catPct = pct(g.catalogBytes, g.poolBytes);
        const accent = colorOf(g, i);
        return (
          <div key={g.id} className="card p-3.5" style={{ borderLeft: `3px solid ${accent}` }}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <label className="grid place-items-center w-8 h-8 rounded-lg shrink-0 cursor-pointer relative" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }} title={t('pools.color', 'Pool colour')}>
                <HardDrive size={15} style={{ color: accent }} />
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f97316'} onChange={(e) => setColor(g, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{g.name}</span> {g.freePlan && <Badge tone="">{t('pools.free', 'free')}</Badge>}</div>
                <div className="text-[11px] text-[var(--faint)]">{gb(g.usedBytes)} / {gb(g.poolBytes)} GB {t('pools.used', 'used')} · {gb(free)} GB {t('pools.freespace', 'free')}</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => onAddRepo(g)}><Plus size={13} /> {t('repos.addrepo', 'Add repo')}</Button>
              <a href={`/submit?pool=${g.id}`}><Button size="sm" variant="default"><Boxes size={13} /> {t('repos.addcatalog', 'Add catalog')}</Button></a>
              {groups.length > 1 && <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer select-none px-2 py-1 rounded-lg border border-[var(--line)] hover:border-[var(--primary-2)]" title={t('pools.selectmerge', 'Select to merge')}>
                <input type="checkbox" checked={sel.has(g.id)} onChange={() => toggleSel(g.id)} /> <GitMerge size={12} /> {t('pools.select', 'Merge')}
              </label>}
            </div>
            {/* Used bar: repos (orange) + catalogs (blue) + free (track). */}
            <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden flex">
              <div className="h-full" style={{ width: `${repoPct}%`, background: accent }} title={`${t('pools.repos', 'Repos')}: ${gb(g.repoBytes)} GB`} />
              <div className="h-full bg-sky-500" style={{ width: `${catPct}%` }} title={`${t('pools.catalogs', 'Catalogs')}: ${gb(g.catalogBytes)} GB`} />
            </div>
            {(g.repos?.length > 0 || g.catalogs?.length > 0) ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {g.repos?.map((r) => (
                  <Link key={r.id} to={`/repo/${r.id}`} className="inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--primary-2)]">
                    <Server size={11} className="text-[var(--primary-2)]" /> <span className="truncate max-w-[140px]">{r.name}</span> <span className="text-[var(--faint)]">{gb(r.quotaBytes)}G</span>
                  </Link>
                ))}
                {g.catalogs?.map((c) => (
                  <a key={c.id} href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 border border-[var(--line)] bg-[var(--surface-2)] hover:border-sky-500">
                    <Boxes size={11} className="text-sky-500" /> <span className="truncate max-w-[140px]">{c.name}</span> <span className="text-[var(--faint)]">{gb(c.quotaBytes)}G</span>
                  </a>
                ))}
              </div>
            ) : <div className="mt-2 text-[11px] text-[var(--faint)]">{t('pools.empty', 'Empty — add a repo or catalog to start using this space.')}</div>}
            {/* Merged pool carrying several separate paid subs → offer a consolidation quote. */}
            {g.subCount >= 2 && (() => {
              const q = quotes[g.id];
              return <div className="mt-2.5 pt-2.5 border-t border-[var(--line)] text-[11px]">
                {!q && <button onClick={() => loadQuote(g)} className="inline-flex items-center gap-1 text-[var(--primary-2)] hover:underline"><GitMerge size={12} /> {t('pools.consol.cta', '{n} separate subscriptions — see consolidation savings').replace('{n}', String(g.subCount))}</button>}
                {q === 'loading' && <span className="text-[var(--faint)]">{t('common.loading', 'Loading…')}</span>}
                {q === 'err' && <span className="text-[var(--faint)]">{t('pools.consol.err', 'Could not load the quote.')}</span>}
                {q && typeof q === 'object' && (q.eligible
                  ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--muted)]">
                      <span>{t('pools.consol.now', 'Now')}: <b className="text-[var(--text)]">{money(q.currentMonthlyCents)}/mo</b> ({q.subCount} {t('pools.consol.subs', 'subs')})</span>
                      <span>→ {t('pools.consol.one', 'One {gb}GB plan').replace('{gb}', String(q.sumGB))}: <b className="text-[var(--text)]">{money(q.consolidatedMonthlyCents)}/mo</b>{q.discountPct > 0 && <span className="text-emerald-500"> (−{q.discountPct}%)</span>}</span>
                      {q.savingCents > 0 && <span className="text-emerald-500 font-medium">{t('pools.consol.save', 'save {v}/mo').replace('{v}', money(q.savingCents))}</span>}
                      {q.canExecute
                        ? <div className="w-full mt-1"><Button size="sm" variant="primary" onClick={() => consolidate(g)}><GitMerge size={13} /> {t('pools.consol.do', 'Consolidate to one plan')}</Button></div>
                        : <span className="text-[var(--faint)] w-full">{t('pools.consol.how', 'To consolidate: buy one plan for the whole pool from Hosting, then cancel the smaller subscriptions.')}</span>}
                    </div>
                  : <span className="text-[var(--faint)]">{t('pools.consol.noteligible', 'This pool’s subscriptions can’t be consolidated for a saving right now.')}</span>)}
              </div>;
            })()}
          </div>
        );
      })}
    </div>
  );
}

export function MyRepos() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n(); const navigate = useNavigate();
  const { data, loading, reload } = useFetch(() => api.get('/me/repos'), []);
  // Storage pools — so a freshly-bought EMPTY pool (no repos yet) is still visible and
  // fillable. A pool with repos shows through its repos; an empty one shows here.
  const poolsF = useFetch(() => api.get('/me/hosting/groups'), []);
  const [editing, setEditing] = useState(null);
  const [featuring, setFeaturing] = useState(null);
  const [managing, setManaging] = useState(null);
  const [sandbox, setSandbox] = useState(null);
  const [sandboxTab, setSandboxTab] = useState('access'); // which tab RepoManageModal opens on
  const [poolAdd, setPoolAdd] = useState(null);
  const repos = data?.repos || [];
  const shared = data?.shared || [];
  // Search + status + type filters and a sort for the repo list.
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all'); // all | online | offline | deleting
  const [typeF, setTypeF] = useState('all');     // all | hosted | external | listed | unlisted
  const [sortF, setSortF] = useState('created_desc'); // created_desc | created_asc | name | storage
  const nq = q.trim().toLowerCase();
  const typeOk = (r) => typeF === 'all'
    || (typeF === 'hosted' ? !!r.hosted
      : typeF === 'external' ? !r.hosted
      : typeF === 'listed' ? !!r.listed
      : /* unlisted */ !r.listed);
  const filteredRepos = repos.filter((r) =>
    (!nq || r.name?.toLowerCase().includes(nq) || r.description?.toLowerCase().includes(nq) || r.fingerprint?.toLowerCase().includes(nq))
    && typeOk(r)
    && (statusF === 'all'
      || (statusF === 'deleting' ? !!r.deleteAt
        : statusF === 'online' ? (r.status === 'ONLINE' && !r.deleteAt)
        : /* offline */ (r.status !== 'ONLINE' && !r.deleteAt))))
    .sort((a, b) => {
      if (sortF === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortF === 'storage') return Number(b.storageUsedBytes || 0) - Number(a.storageUsedBytes || 0);
      const ta = new Date(a.createdAt || 0).getTime(), tb = new Date(b.createdAt || 0).getTime();
      return sortF === 'created_asc' ? ta - tb : tb - ta;
    });
  const isFeatured = (r) => r.featuredUntil && new Date(r.featuredUntil) > new Date();

  // Push re-runs the auto check: the SHA is recomputed from the live repo.json and
  // the repo is re-verified automatically (valid → verified, else unverified).
  const push = async (r) => {
    try {
      const res = await api.post(`/repos/${r.id}/push`, {});
      if (res.reReview) toast.info(t('repos.push.review', 'Pushed — your change is back in review before it re-appears in the public list.'));
      else toast[res.verified ? 'success' : 'info'](res.verified ? t('repos.push.ok', 'Pushed — re-checked & verified.') : t('repos.push.bad', 'Pushed — content is not a valid repo.json (unverified).'));
      reload();
    } catch (x) { toast.error(x.data?.error === 'repo_suspended' ? t('repos.suspended.short', 'This repo is suspended — contact support.') : x.data?.error || t('repos.failed', 'Failed.')); }
  };
  const toggleList = async (r) => {
    try {
      const res = await api.post(`/repos/${r.id}/list`, { listed: !r.listed });
      toast.success(!r.listed
        ? (res?.pending ? t('repos.listed.pending', 'Submitted — a moderator will review it before it appears publicly.') : t('repos.listed.ok', 'Listed & verified — now public.'))
        : t('repos.unlisted.ok', 'Unlisted.'));
      reload();
    }
    catch (x) {
      if (x.data?.error === 'sha_invalid') toast.error(t('repos.sha.invalid', 'Invalid repo.json / SHA — kept private. Upload or fix a valid repo.json, then try again.'));
      else toast.error(x.data?.error || t('repos.failed', 'Failed.'));
    }
  };
  // ONE combined delete dialog → 72h soft-delete grace (server keeps the content;
  // reversible until the sweeper hard-deletes it). The warning + the type-to-confirm
  // field live in the same modal (was two separate dialogs), and the repo name is
  // shown right there so the user can copy-paste it.
  const del = async (r) => {
    const typed = await dialog.prompt({
      title: t('repos.del.title', 'Delete repo'),
      message: t('repos.del.msg', '"{name}" goes offline now and is permanently deleted — with all its content — in 72 hours. You can undo until then.').replace('{name}', r.name),
      label: t('repos.del.confirm.l2', 'To confirm, type the repo name: {name}').replace('{name}', r.name),
      placeholder: r.name, okLabel: t('repos.del.ok', 'Delete'), danger: true,
    });
    if (typed === false) return;
    if (String(typed).trim() !== r.name) return toast.error(t('repos.del.mismatch', "Name didn't match — deletion cancelled."));
    try { await api.del(`/repos/${r.id}`); toast.success(t('repos.deleted72', 'Scheduled for deletion in 72h — undo from the repo card anytime before then.')); reload(); }
    catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const undoDelete = async (r) => {
    try { await api.post(`/me/repos/${r.id}/delete/cancel`); toast.success(t('repos.del.undone', 'Deletion cancelled — your repo is restored.')); reload(); }
    catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const check = async (r) => { try { const res = await api.post(`/repos/${r.id}/check`); toast[res.status === 'ONLINE' ? 'success' : 'error'](res.status === 'ONLINE' ? (res.verified ? t('repos.check.onver', 'Online & verified.') : t('repos.check.onunver', 'Online but unverified.')) : t('repos.check.off', 'Offline ({reason}).').replace('{reason}', res.reason || t('repos.unreachable', 'unreachable'))); reload(); } catch { toast.error(t('repos.check.failed', 'Check failed.')); } };
  // Mint (or reuse) an unlisted-share link and copy it. Lets an owner share a repo that
  // isn't in the public browse list — the recipient opens /r/<id>?k=<key> (the API gates it).
  const shareRepo = async (r) => {
    try {
      const res = await api.post(`/me/repos/${r.id}/share`, { action: 'enable' });
      const link = `${location.origin}/r/${r.id}${res.shareKey ? `?k=${res.shareKey}` : ''}`;
      await navigator.clipboard?.writeText(link);
      toast.success(t('repos.share.ok', 'Share link copied.'));
      reload();
    } catch { toast.error(t('repos.failed', 'Failed.')); }
  };
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
      {(poolsF.data?.groups || []).length > 0 && (
        <PoolsPanel groups={poolsF.data.groups} onAddRepo={setPoolAdd} t={t} reload={() => { poolsF.reload?.(); reload(); }} toast={toast} dialog={dialog} />
      )}
      {repos.length > 3 && (
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('repos.search', 'Search by name, description or ID…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Dropdown size="sm" value={typeF} onChange={setTypeF} options={[
            { value: 'all', label: t('repos.f.type.all', 'All types') }, { value: 'hosted', label: t('repos.hosted', 'Hosted') },
            { value: 'external', label: t('repos.f.external', 'External') }, { value: 'listed', label: t('repos.listed', 'Listed') }, { value: 'unlisted', label: t('repos.unlisted', 'Unlisted') },
          ]} />
          <Dropdown size="sm" value={statusF} onChange={setStatusF} options={[
            { value: 'all', label: t('repos.f.all', 'All') }, { value: 'online', label: t('repos.online', 'Online') },
            { value: 'offline', label: t('repos.offline', 'Offline') }, { value: 'deleting', label: t('repos.f.deleting', 'Deleting') },
          ]} />
          <Dropdown size="sm" value={sortF} onChange={setSortF} options={[
            { value: 'created_desc', label: t('repos.sort.newest', 'Newest first') }, { value: 'created_asc', label: t('repos.sort.oldest', 'Oldest first') },
            { value: 'name', label: t('repos.sort.name', 'Name (A–Z)') }, { value: 'storage', label: t('repos.sort.storage', 'Storage used') },
          ]} />
        </div>
      )}
      {loading ? <div className="text-[var(--muted)] text-sm py-4">{t('common.loading', 'Loading…')}</div>
        : repos.length ? (filteredRepos.length ? <div className="space-y-2">
          {filteredRepos.map((r) => (
            <Card key={r.id} className="p-4">
              {r.deleteAt && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <span className="flex-1 text-red-300">{t('repos.del.pending', 'Scheduled for deletion — permanently removed with its content on {when}.').replace('{when}', new Date(r.deleteAt).toLocaleString())}</span>
                  <Button size="sm" variant="primary" onClick={() => undoDelete(r)}><RefreshCw size={12} /> {t('repos.del.undo', 'Undo')}</Button>
                </div>
              )}
              {!repoLocked(r) && r.listed && r.pendingReview && !r.deleteAt && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs">
                  <Clock size={14} className="text-[var(--warning)] shrink-0 mt-0.5" />
                  <span className="flex-1 text-[var(--warning)]">{t('repos.inreview.notice', 'In review — a moderator is verifying it before it appears in the public list. It keeps serving normally; any new change restarts the review.')}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <GitBranch size={18} className="text-[var(--primary-2)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.description && <div className="text-sm text-[var(--muted)] line-clamp-1">{r.description}</div>}
                  {/* Suspended notice sits directly UNDER the repo name (per design). */}
                  {repoLocked(r) && !r.deleteAt && (
                    <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-[var(--error-border)] bg-[var(--error-bg)] px-2.5 py-1.5 text-xs">
                      <Ban size={13} className="text-[var(--error)] shrink-0 mt-0.5" />
                      <span className="flex-1 text-[var(--error)]">{t('repos.suspended.notice', 'This repo is suspended — it stays offline, can’t be listed, edited or deleted. Contact support to resolve it.')}</span>
                    </div>
                  )}
                  {/* Provisioning notice — under the title too, like suspended. */}
                  {r.status === 'PROVISIONING' && !repoLocked(r) && !r.deleteAt && (
                    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] px-2.5 py-1.5 text-xs">
                      <RefreshCw size={13} className="text-[var(--info)] shrink-0 animate-spin" />
                      <span className="flex-1 text-[var(--info)]">{t('repos.provisioning.notice', 'Provisioning — open the dashboard, upload your files (including repo.json) and publish to bring it online.')}</span>
                      <Link to={`/repo/${r.id}`}><Button size="sm" variant="primary"><LayoutDashboard size={12} /> {t('repos.opendash', 'Dashboard')}</Button></Link>
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {(() => { const st = repoStatusMeta(r, t); return <Badge tone={st.tone}>● {st.label}</Badge>; })()}
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
              {/* A suspended repo is read-only for its owner: only the dashboard (to view
                  state) stays open — every mutating action is disabled here AND on the
                  server. The three primaries fold into the same menu as the long tail when
                  the card is too narrow (phones), so there's never a second row or a second
                  kebab. */}
              {(() => { const locked = repoLocked(r); return (
              <div className="mt-3">
                <ActionBar
                  actions={[
                    { key: 'dash', label: t('repos.opendash', 'Dashboard'), icon: LayoutDashboard, variant: 'primary', href: `/repo/${r.id}`, onClick: () => navigate(`/repo/${r.id}`) },
                    { key: 'list', label: r.listed ? t('repos.unlist', 'Unlist') : t('repos.listpublicly', 'List publicly'), icon: r.listed ? EyeOff : Eye, disabled: locked, onClick: () => toggleList(r) },
                    { key: 'boost', label: isFeatured(r) ? t('repos.extendboost', 'Extend boost') : t('repos.boost', 'Boost'), icon: Rocket, disabled: locked, onClick: () => setFeaturing(r) },
                  ]}
                  extra={[
                    repoJsonUrl(r) && { key: 'copy', label: t('repos.copylink', 'Copy repo.json link'), icon: Copy, onClick: () => { navigator.clipboard?.writeText(repoJsonUrl(r)); toast.success(t('repos.copy.ok', 'repo.json link copied.')); } },
                    { key: 'share', label: t('repos.sharelink', 'Copy public share link'), icon: Link2, onClick: () => shareRepo(r) },
                    r.hosted && !locked && { key: 'files', label: t('repos.quickfiles', 'Quick files'), icon: Files, onClick: () => setManaging(r) },
                    r.hosted && !locked && { key: 'plan', label: t('repos.upgradeplan', 'Upgrade storage / plan'), icon: HardDrive, onClick: () => { setSandboxTab('limits'); setSandbox(r); } },
                    r.hosted && !locked && { key: 'sandbox', label: t('repos.sandbox', 'Sandbox settings'), icon: ShieldCheck, onClick: () => { setSandboxTab('access'); setSandbox(r); } },
                    !r.hosted && !locked && { key: 'push', label: t('repos.push', 'Push'), icon: UploadCloud, onClick: () => push(r) },
                    !r.hosted && !locked && { key: 'check', label: t('repos.check', 'Check'), icon: CheckCircle2, onClick: () => check(r) },
                    r.hosted && !locked && { key: 'mode', label: r.groupId ? t('repos.tosingle', 'Switch to single') : t('repos.tomulti', 'Switch to multi'), icon: HardDrive, onClick: () => switchMode(r) },
                    r.hosted && r.group && !locked && { key: 'addpool', label: t('repos.addtopool', 'Add repo to pool'), icon: Plus, onClick: () => setPoolAdd(r.group) },
                    !locked && { key: 'edit', label: t('repos.editdetails', 'Edit details'), icon: Pencil, onClick: () => setEditing(r) },
                    !locked && { key: 'del', label: t('repos.delete', 'Delete repo'), icon: Trash2, danger: true, onClick: () => del(r) },
                  ].filter(Boolean)}
                />
              </div>
              ); })()}
            </Card>
          ))}
        </div> : <EmptyState icon={Search} title={t('repos.nomatch.t', 'No matches')} sub={t('repos.nomatch.s', 'Try a different search or clear the filters.')} />)
        : <EmptyState icon={Server} title={t('repos.mine.empty.t', 'No repos yet')} sub={t('repos.mine.empty.s', 'Add a repo to list it publicly, or host one from the Hosting page.')} />}

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
      {sandbox && <RepoManageModal repo={sandbox} initialTab={sandboxTab} onClose={() => setSandbox(null)} onChanged={reload} />}
      {poolAdd && <PoolAddModal group={poolAdd} onClose={() => setPoolAdd(null)} onDone={() => { setPoolAdd(null); reload(); }} />}
    </div>
  );
}

// Sandboxed repo dashboard: access mode, whitelist, bans, upload limit — all
// hard-capped by the sandbox. Grouped (multi) repos can also resize their quota.
function RepoManageModal({ repo, onClose, onChanged, initialTab }) {
  const toast = useToast(); const { t } = useI18n();
  const s0 = repo.settings || { access: { whitelistEnabled: false, ips: [], keys: [] }, bans: { ips: [], keys: [] }, requestedUploadKbps: null };
  const [access, setAccess] = useState(s0.access);
  const [bans, setBans] = useState(s0.bans);
  const capKbps = repo.uploadLimitKbps || 0;
  const [reqMbps, setReqMbps] = useState(s0.requestedUploadKbps ? (s0.requestedUploadKbps / 1024) : (capKbps / 1024));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(initialTab || 'access');
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
          <div className="pt-2 border-t border-[var(--line)]">
            <div><div className="text-xs text-[var(--faint)]">{t('repos.storage', 'Storage')}</div><div className="font-semibold">{gb(repo.storageUsedBytes)} / {gb(repo.storageQuotaBytes)} GB</div></div>
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
  const curUp = +(((repo.uploadLimitKbps || 0) / 1024).toFixed(1));
  const curCpu = repo.cpuShare || 0; // kept fixed at the repo's current share — no longer user-adjustable
  const [gbVal, setGbVal] = useState(Math.ceil(currentGB * 2));
  const [upVal, setUpVal] = useState(curUp);
  const [custom, setCustom] = useState(false);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const sGB = Math.max(gbVal, currentGB); const sUp = Math.max(upVal, curUp);
  const changed = sGB > currentGB || sUp > curUp;
  useEffect(() => {
    if (!changed) { setQuote(null); return; }
    // CPU is priced at the repo's existing share (curCpu) but never changed here.
    api.get(`/hosting/price?storageGB=${sGB}&uploadMbps=${sUp}&cpuShare=${curCpu}`).then(setQuote).catch(() => setQuote(null));
  }, [sGB, sUp, changed]);
  const upgrade = async () => {
    setBusy(true);
    try {
      const body = { storageGB: sGB, ...(sUp > curUp ? { uploadMbps: sUp } : {}) };
      const res = await api.post(`/me/repos/${repo.id}/upgrade`, body);
      if (res.url || res.checkoutUrl) { window.location.href = res.url || res.checkoutUrl; return; }
      if (res.free) toast.success(t('repos.upgraded.free', 'Upgraded to {n} GB — free tier, no charge.').replace('{n}', sGB));
    } catch (x) {
      toast.error(x.data?.error === 'capacity_full' ? t('repos.poolfull', 'Pool full — max {n} GB.').replace('{n}', x.data.freeGB?.toFixed(1))
        : x.data?.error === 'not_an_upgrade' ? t('repos.notupgrade3', 'Raise storage or upload speed above their current values.')
        : x.data?.error === 'over_limit' ? t('repos.upover2', 'Exceeds the per-repo upload limit (max {u} Mbps).').replace('{u}', x.data.maxUploadMbps)
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="pt-3 border-t border-[var(--line)] space-y-2">
      <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><HardDrive size={14} /> {t('repos.upgradestorage', 'Need more storage?')}</span><span className="font-semibold">{gbVal} GB</span></div>
      <input type="range" min={Math.ceil(currentGB)} max={Math.max(Math.ceil(currentGB) + 1, 500)} step={1} value={gbVal} className="bcw-range w-full" onChange={(e) => setGbVal(Number(e.target.value))} />
      <button type="button" onClick={() => setCustom((c) => !c)} className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Settings2 size={12} /> {t('repos.upcustom2', 'Also raise upload speed')} <ChevronDown size={11} className={`transition-transform ${custom ? 'rotate-180' : ''}`} /></button>
      {custom && (
        <div className="pt-1">
          <div><div className="flex justify-between text-xs mb-1"><span className="text-[var(--muted)] flex items-center gap-1"><Zap size={12} /> {t('repos.s.upload', 'Upload speed')}</span><b className="tabular-nums">{upVal} Mbps</b></div><input type="range" min={Math.max(1, Math.ceil(curUp))} max={1000} step={1} value={upVal} className="bcw-range w-full" onChange={(e) => setUpVal(Number(e.target.value))} /></div>
        </div>
      )}
      <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
        <span className="text-xs text-[var(--faint)]">
          {!changed ? t('repos.currentplan', 'Your current plan.')
            : quote?.priceMonthlyCents > 0 ? t('repos.upprice', '{price}/mo').replace('{price}', `$${(quote.priceMonthlyCents / 100).toFixed(2)}`)
            : t('repos.upgradefree', 'Still within the free tier — no charge.')}
        </span>
        <Button size="sm" variant="primary" disabled={busy || !changed} onClick={upgrade}>{busy ? <Spinner /> : t('repos.upgrade', 'Upgrade')}</Button>
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
  const [autoRenew, setAutoRenew] = useState(true);
  const [price, setPrice] = useState(null);
  useEffect(() => { api.get(`/hosting/feature-price?days=${days}`).then((r) => setPrice(r.priceCents)).catch(() => setPrice(null)); }, [days]);
  const buy = async () => {
    try { const { url } = await api.post(`/repos/${repo.id}/feature/checkout`, { days, autoRenew }); window.location = url; }
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
      <label className="flex items-start gap-2.5 text-sm mb-3 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
        <span>
          <span className="font-medium flex items-center gap-1.5"><RefreshCw size={13} className="text-[var(--primary-2)]" /> {t('repos.boost.autorenew', 'Auto-renew this boost')}</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">{autoRenew ? t('repos.boost.autorenew.on', 'Re-boosts automatically every {n} days. Cancel anytime from “Manage billing”.').replace('{n}', days) : t('repos.boost.autorenew.off', 'One-time boost — ends after {n} days.').replace('{n}', days)}</span>
        </span>
      </label>
      <div className="flex items-end justify-between pt-3 border-t border-[var(--line)]">
        <span className="text-sm text-[var(--muted)]">{t('repos.total', 'Total')} {autoRenew && <span className="text-xs font-normal text-[var(--faint)]">· {t('repos.boost.perterm', 'per {n}d', ).replace('{n}', days)}</span>}</span>
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
      else if (e === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); }
      else toast.error(e === 'invalid' ? t('promo.invalid', 'Invalid or inactive code.') : e === 'expired' ? t('promo.expired', 'This code has expired.') : e === 'depleted' ? t('promo.depleted', 'This code is fully used.') : e === 'already_used' ? t('promo.used', 'You already used this code.') : e === 'not_yours' ? t('promo.notyours', 'This code is reserved for another account.') : e === 'use_at_checkout' ? t('promo.atcheckout', 'This is a discount code — enter it when hosting or boosting.') : t('repos.failed', 'Failed.'));
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
function SubscriptionRow({ repo, stripeSub, onChanged }) {
  const toast = useToast(); const { t } = useI18n(); const dialog = useDialog();
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const localSub = repo.subscription;
  // The live Stripe subscription (from /me/billing/overview) is the source of truth —
  // it reflects a just-enabled auto-renew and Stripe's real period end. Fall back to
  // the local mirror only when Stripe hasn't loaded / isn't configured.
  const hasSub = !!stripeSub || !!localSub?.stripeSubId;
  const canceling = stripeSub ? stripeSub.cancelAtPeriodEnd : (localSub?.status === 'canceling' || localSub?.status === 'canceled');
  const periodEnd = stripeSub?.currentPeriodEnd || localSub?.currentPeriodEnd || null;
  const subId = stripeSub?.id || localSub?.stripeSubId;
  const expired = periodEnd && new Date(periodEnd) <= new Date();
  const soon = periodEnd && !expired && (new Date(periodEnd) - Date.now()) < 7 * 864e5;
  // Legacy prepaid / free repo with no subscription → start auto-renew (subscription checkout).
  const enableAutoRenew = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/me/repos/${repo.id}/renew`, { months, autoRenew: true });
      if (res?.free) { toast.success(t('bill.renewed.free', 'Renewed — free tier, no charge.')); onChanged?.(); return; }
      window.location = res.url;
    } catch (x) { toast.error(x.data?.error === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : x.data?.error || t('repos.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  // Hosting auto-renews by default → this button cancels it (stays online until the
  // period ends), and flips to "Reactivate" once cancelled.
  const toggleCancel = async () => {
    const resume = canceling;
    if (!subId) return;
    if (!resume && !(await dialog.confirm({ title: t('bill.sub.cancel.t', 'Stop auto-renew?'), message: t('bill.sub.cancel.m', 'This subscription stays active until {d}, then won’t renew. You keep everything you’ve paid for.').replace('{d}', periodEnd ? new Date(periodEnd).toLocaleDateString() : '—'), okLabel: t('bill.sub.cancel.ok', 'Stop auto-renew'), danger: true }))) return;
    setBusy(true);
    try { await api.post(`/me/subscriptions/${subId}/cancel`, { resume }); toast.success(resume ? t('bill.sub.resumed', 'Auto-renew re-enabled.') : t('bill.sub.canceled', 'Auto-renew stopped — active until the period ends.')); onChanged?.(); }
    catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm border-t border-[var(--line)] first:border-t-0">
      <Server size={15} className="text-[var(--primary-2)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{repo.name}</span> <Badge tone={repo.status === 'SUSPENDED' ? 'red' : repo.status === 'ONLINE' ? 'green' : ''}>{repo.status}</Badge>{hasSub && (canceling ? <Badge tone="amber">{t('bill.sub.canceling', 'canceling')}</Badge> : <Badge tone="green"><RefreshCw size={9} /> {t('bill.ah.auto', 'auto-renew')}</Badge>)}</div>
        <div className="text-xs text-[var(--faint)]">{gb(repo.storageQuotaBytes)} GB · {(repo.uploadLimitKbps / 1024).toFixed(1)} Mbps</div>
      </div>
      {periodEnd && (
        <div className={`text-xs text-right shrink-0 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-[var(--muted)]'}`}>
          <div className="flex items-center gap-1 justify-end"><Clock size={11} /> {expired ? t('bill.expired', 'Expired') : canceling ? t('bill.ah.ends', 'Ends') : hasSub ? t('bill.ah.renews', 'Renews') : t('bill.renewson', 'Renews/expires')}</div>
          <div className="font-medium">{new Date(periodEnd).toLocaleDateString()}</div>
        </div>
      )}
      {hasSub ? (
        <Button size="sm" variant={canceling ? 'primary' : 'ghost'} disabled={busy} onClick={toggleCancel}
          title={canceling ? t('bill.sub.resume.h', 'Turn auto-renew back on') : t('bill.sub.cancel.h', 'Stop auto-renew (stays active until the period ends)')}>
          {busy ? <Spinner /> : canceling ? <><RefreshCw size={13} /> {t('bill.ah.reactivate', 'Reactivate')}</> : <><X size={13} /> {t('bill.ah.cancel', 'Cancel auto-renew')}</>}
        </Button>
      ) : (
        <>
          <Select className="!w-auto !py-1.5 !text-xs" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} mo</option>)}
          </Select>
          <Button size="sm" variant="primary" disabled={busy} onClick={enableAutoRenew} title={t('bill.autorenew.h', 'Start a recurring subscription — charges automatically each term.')}>{busy ? <Spinner /> : <><RefreshCw size={13} /> {t('bill.ah.enable', 'Enable auto-renew')}</>}</Button>
        </>
      )}
    </div>
  );
}

export function Billing() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading } = useFetch(() => api.get('/me/payments'), []);
  const { data: repoData, reload: reloadRepos } = useFetch(() => api.get('/me/repos'), []);
  const { data: overview, reload: reloadOverview } = useFetch(() => api.get('/me/billing/overview').catch(() => null), []);
  const dialog = useDialog();
  const [subBusy, setSubBusy] = useState(null);
  const cancelSub = async (s) => {
    const resume = s.cancelAtPeriodEnd;
    if (!resume && !(await dialog.confirm({ title: t('bill.sub.cancel.t', 'Stop auto-renew?'), message: t('bill.sub.cancel.m', 'This subscription stays active until {d}, then won’t renew. You keep everything you’ve paid for.').replace('{d}', s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'), okLabel: t('bill.sub.cancel.ok', 'Stop auto-renew'), danger: true }))) return;
    setSubBusy(s.id);
    try { await api.post(`/me/subscriptions/${s.id}/cancel`, { resume }); toast.success(resume ? t('bill.sub.resumed', 'Auto-renew re-enabled.') : t('bill.sub.canceled', 'Auto-renew stopped — active until the period ends.')); reloadOverview(); }
    catch { toast.error(t('repos.failed', 'Failed.')); } finally { setSubBusy(null); }
  };
  const { data: invData } = useFetch(() => api.get('/me/invoices').catch(() => null), []);
  const [invoice, setInvoice] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(null); // invoice id currently downloading
  const [expandedInv, setExpandedInv] = useState(null); // invoice id expanded for details
  const [expandedSub, setExpandedSub] = useState(null); // subscription id expanded for details
  // A short, human summary instead of Stripe's long line-item description.
  const invSummary = (inv) => inv.recurring ? t('bill.h.subscription', 'Subscription') : /boost/i.test(inv.description || '') ? t('bill.h.boost', 'Boost') : /host|repo|gb/i.test(inv.description || '') ? t('bill.h.hosting', 'Hosting') : t('bill.h.payment', 'Payment');
  const payments = data?.payments || [];
  const subs = overview?.subscriptions || [];
  const invoices = invData?.invoices || [];
  const money = (c, cur) => { const C = (cur || 'usd').toUpperCase(); const s = C === 'USD' ? '$' : C === 'EUR' ? '€' : C === 'GBP' ? '£' : ''; return s ? `${s}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${C}`; };
  const downloadInvoicePdf = async (inv) => {
    setDlBusy(inv.id);
    try { await forceDownload(`/api/me/invoices/${inv.id}/pdf`, `invoice-${inv.number}.pdf`); }
    finally { setDlBusy(null); }
  };
  const hostedRepos = (repoData?.repos || []).filter((r) => r.hosted);
  const [hq, setHq] = useState(''); const [hStatus, setHStatus] = useState('all');
  const hnq = hq.trim().toLowerCase();
  const filteredHosted = hostedRepos.filter((r) =>
    (!hnq || r.name?.toLowerCase().includes(hnq))
    && (hStatus === 'all' || (hStatus === 'suspended' ? r.status === 'SUSPENDED' : hStatus === 'online' ? r.status === 'ONLINE' : r.status !== 'ONLINE' && r.status !== 'SUSPENDED')));
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
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="font-semibold flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('bill.subs', 'Active hosting')}</h2>
            {hostedRepos.length > 3 && (
              <div className="flex gap-2">
                <div className="relative w-40 sm:w-52"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
                  <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('bill.search', 'Search hosting…')} value={hq} onChange={(e) => setHq(e.target.value)} /></div>
                <Select className="!w-auto !py-1.5 !text-sm" value={hStatus} onChange={(e) => setHStatus(e.target.value)}>
                  <option value="all">{t('repos.f.all', 'All')}</option><option value="online">{t('repos.online', 'Online')}</option><option value="suspended">Suspended</option></Select>
              </div>
            )}
          </div>
          <p className="text-[11px] text-[var(--faint)] mb-2 flex items-center gap-1"><Info size={11} /> {t('bill.prepaid.note2', 'Auto-renew keeps a repo online automatically; cancel it here anytime (it stays online until the period ends). One-time terms just lapse — no charge to cancel.')}</p>
          <Card className="overflow-hidden p-0">
            {filteredHosted.length ? filteredHosted.map((r) => <SubscriptionRow key={r.id} repo={r} stripeSub={subs.find((s) => s.repoId === r.id && s.target !== 'boost')} onChanged={() => { reloadRepos(); reloadOverview(); }} />)
              : <div className="px-4 py-6 text-sm text-[var(--muted)] text-center">{t('bill.nomatch', 'No hosting matches your search.')}</div>}
          </Card>
        </div>
      )}

      {/* Recurring subscriptions NOT already shown in Active hosting (boosts + any
          non-repo subscription) — hosting subs are managed on their repo row above. */}
      {(() => { const otherSubs = subs.filter((s) => !(s.target !== 'boost' && hostedRepos.some((r) => r.id === s.repoId))); return otherSubs.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><RefreshCw size={16} className="text-[var(--primary-2)]" /> {t('bill.recurring', 'Recurring subscriptions')}</h2>
          <Card className="overflow-hidden p-0">
            {otherSubs.map((s, i) => {
              const cur = (s.currency || 'usd').toUpperCase();
              const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '';
              const amt = sym ? `${sym}${(s.amountCents / 100).toFixed(2)}` : `${(s.amountCents / 100).toFixed(2)} ${cur}`;
              const per = s.interval ? (s.intervalCount > 1 ? `/ ${s.intervalCount} ${s.interval}` : `/ ${s.interval}`) : '';
              const isBoost = s.target === 'boost';
              const label = isBoost ? t('bill.sub.boost2', 'Boost') : t('bill.sub.hosting2', 'Hosting');
              const startsSoon = s.status === 'trialing' && s.trialEnd;
              const isOpen = expandedSub === s.id;
              const when = startsSoon ? t('bill.sub.starts', 'First renewal {d}').replace('{d}', new Date(s.trialEnd).toLocaleDateString())
                : s.currentPeriodEnd ? (s.cancelAtPeriodEnd ? t('bill.sub.endson', 'Ends {d}') : t('bill.sub.renews', 'Renews {d}')).replace('{d}', new Date(s.currentPeriodEnd).toLocaleDateString()) : '';
              return (
                <div key={s.id} className={`${i ? 'border-t border-[var(--line)]' : ''}`}>
                  <div className="flex items-center gap-3 px-4 py-3 text-sm">
                    <button onClick={() => setExpandedSub(isOpen ? null : s.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                      <ChevronDown size={15} className={`shrink-0 text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      {isBoost ? <Rocket size={15} className="text-amber-400 shrink-0" /> : <Server size={15} className="text-[var(--primary-2)] shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{label}{s.repoName ? <> · <span className="text-[var(--primary-2)]">{s.repoName}</span></> : ''}</div>
                        <div className="text-xs text-[var(--faint)]">{when}</div>
                      </div>
                    </button>
                    <Badge tone={s.cancelAtPeriodEnd ? 'amber' : (s.status === 'active' || s.status === 'trialing' ? 'green' : 'amber')}>{s.cancelAtPeriodEnd ? t('bill.sub.canceling', 'canceling') : s.status}</Badge>
                    <span className="font-semibold text-right whitespace-nowrap">{amt} <span className="text-[var(--faint)] font-normal text-xs">{per}</span></span>
                    <Button size="sm" variant="ghost" disabled={subBusy === s.id} onClick={() => cancelSub(s)} title={s.cancelAtPeriodEnd ? t('bill.sub.resume.h', 'Turn auto-renew back on') : t('bill.sub.cancel.h', 'Stop auto-renew (stays active until the period ends)')}>
                      {subBusy === s.id ? <Spinner /> : s.cancelAtPeriodEnd ? <><RefreshCw size={13} /> {t('bill.sub.resume', 'Resume')}</> : <><X size={13} /> {t('bill.sub.cancel', 'Cancel')}</>}
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 pl-11">
                      <div className="rounded-lg bg-[var(--surface-2)]/60 p-3 text-sm space-y-1.5">
                        <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.desc', 'Description')}</span><span className="text-right">{label}{s.repoName ? ` · ${s.repoName}` : ''}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.amount', 'Amount')}</span><span className="font-semibold text-right">{amt} <span className="text-[var(--faint)] font-normal text-xs">{per}</span></span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.status', 'Status')}</span><span className="text-right">{s.cancelAtPeriodEnd ? t('bill.sub.canceling', 'canceling') : s.status}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{s.cancelAtPeriodEnd ? t('bill.sub.endson2', 'Ends') : t('bill.sub.renews2', 'Next renewal')}</span><span className="text-right">{(s.currentPeriodEnd || s.trialEnd) ? new Date(s.currentPeriodEnd || s.trialEnd).toLocaleString() : '—'}</span></div>
                      </div>
                      <p className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Info size={11} /> {t('bill.sub.pdfnote', 'Each billing cycle appears as its own invoice with a downloadable PDF in Payment history below.')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
          <p className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Info size={11} /> {t('bill.sub.manage', 'Cancel or change a subscription via “Manage billing”.')}</p>
        </div>
      ); })()}

      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> {invoices.length ? t('bill.history', 'Payment history') : t('bill.title', 'Billing & invoices')}</h2>
        <Button size="sm" variant="ghost" disabled={portalBusy} onClick={openPortal}><CreditCard size={13} /> {t('bill.manage', 'Manage billing')}</Button>
      </div>
      {/* Prefer Stripe's own invoice history (covers one-time AND every subscription
          cycle, each with a real downloadable PDF). Fall back to the local ledger. */}
      {invoices.length ? <Card className="overflow-hidden p-0">
          {invoices.map((inv, i) => {
            const isOpen = expandedInv === inv.id;
            return (
            <div key={inv.id} className={`${i ? 'border-t border-[var(--line)]' : ''}`}>
              {/* Compact summary row — click to expand the full detail. */}
              <button onClick={() => setExpandedInv(isOpen ? null : inv.id)} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-[var(--surface-2)] transition">
                <ChevronDown size={15} className={`shrink-0 text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">{invSummary(inv)}{inv.recurring && <Badge tone="primary"><RefreshCw size={9} /> {t('bill.recurringtag', 'subscription')}</Badge>}</div>
                  <div className="text-xs text-[var(--faint)]">{inv.created ? new Date(inv.created).toLocaleDateString() : ''}</div>
                </div>
                <Badge tone={inv.status === 'paid' ? 'green' : 'amber'}>{inv.status === 'paid' ? t('bill.paid', 'PAID') : inv.status}</Badge>
                <span className="font-semibold text-right whitespace-nowrap">{money(inv.amountCents, inv.currency)}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 pt-0 pl-11 space-y-2">
                  <div className="rounded-lg bg-[var(--surface-2)]/60 p-3 text-sm space-y-1.5">
                    <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.desc', 'Description')}</span><span className="text-right">{inv.description}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.invoiceno', 'Invoice №')}</span><span className="font-mono text-right">{inv.number}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.date', 'Date')}</span><span className="text-right">{inv.created ? new Date(inv.created).toLocaleString() : ''}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--faint)]">{t('bill.amount', 'Amount')}</span><span className="font-semibold text-right">{money(inv.amountCents, inv.currency)}</span></div>
                  </div>
                  <div className="flex justify-end">
                    {inv.hasPdf
                      ? <Button size="sm" disabled={dlBusy === inv.id} onClick={() => downloadInvoicePdf(inv)}>{dlBusy === inv.id ? <Spinner /> : <><Download size={13} /> {t('bill.download', 'Download PDF')}</>}</Button>
                      : inv.hosted ? <a href={inv.hosted} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={13} /> {t('bill.view', 'View')}</Button></a> : null}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </Card>
        : loading ? <div className="text-[var(--muted)] text-sm py-3">{t('common.loading', 'Loading…')}</div>
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
  // Resolve the REAL Stripe invoice/receipt link (best-effort — absent for older
  // payments or when Stripe isn't configured; the styled receipt below is the fallback).
  const { data: link } = useFetch(() => api.get(`/me/payments/${id}/stripe-link`).catch(() => null), [id]);
  const stripeUrl = link?.pdf || link?.hosted || link?.receipt || null;
  const inv = data?.invoice;
  const cur = (inv?.currency || 'usd').toUpperCase();
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '';
  const money = (c) => sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`;
  const qty = inv?.days ? t('bill.days', '{n} days').replace('{n}', inv.days) : (inv?.description?.match(/(\d+)\s*month/i)?.[1] ? `${inv.description.match(/(\d+)\s*month/i)[1]} mo` : '1');
  const paid = inv?.status === 'paid';
  return (
    <Modal open onClose={onClose} title={t('bill.invoice', 'Invoice')} icon={Receipt} width="max-w-lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button>
        {stripeUrl
          ? <a href={stripeUrl} target="_blank" rel="noreferrer"><Button variant="primary"><Download size={15} /> {t('bill.stripeInvoice', 'Official invoice (Stripe)')}</Button></a>
          : <Button variant="primary" onClick={() => window.print()}><Printer size={15} /> {t('bill.print', 'Print / Save PDF')}</Button>}
      </>}>
      {loading || !inv ? <div className="text-[var(--muted)] text-sm">{t('common.loading', 'Loading…')}</div> : (
        <div className="text-sm invoice-sheet" id="invoice-print">
          {/* Header band */}
          <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b border-[var(--line)]">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white font-black text-lg shrink-0">B</span>
              <div><div className="font-extrabold text-base leading-tight">BetterCommunity</div><div className="text-[11px] text-[var(--faint)]">bettercommunity.ch</div></div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--faint)]">{t('bill.receipt', 'Receipt')}</div>
              <div className="font-mono text-xs mt-0.5">{inv.number}</div>
              <div className="text-[11px] text-[var(--muted)]">{new Date(inv.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
            </div>
          </div>

          {/* From / Billed to */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('bill.from', 'From')}</div>
              <div className="font-medium">BetterCommunity</div>
              <div className="text-xs text-[var(--muted)]">bettercommunity.ch</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('bill.billedto', 'Billed to')}</div>
              <div className="font-medium">{inv.user?.displayName}</div>
              <div className="text-xs text-[var(--muted)] break-all">{inv.user?.email}</div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-lg border border-[var(--line)] overflow-hidden mb-4">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-[var(--surface-2)]/60 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">
              <span>{t('bill.desc', 'Description')}</span><span className="text-right">{t('bill.qty', 'Qty')}</span><span className="text-right">{t('bill.amount', 'Amount')}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2.5 border-t border-[var(--line)]">
              <span className="min-w-0">{inv.description}</span><span className="text-right tabular-nums text-[var(--muted)]">{qty}</span><span className="text-right tabular-nums font-medium">{money(inv.amountCents)}</span>
            </div>
          </div>

          {/* Totals */}
          <div className="ml-auto w-full sm:w-1/2 space-y-1.5 mb-4">
            <div className="flex justify-between text-[var(--muted)]"><span>{t('bill.subtotal', 'Subtotal')}</span><span className="tabular-nums">{money(inv.amountCents)}</span></div>
            <div className="flex justify-between font-bold text-base pt-1.5 border-t border-[var(--line)]"><span>{t('repos.total', 'Total')} <span className="text-xs font-normal text-[var(--faint)]">({cur})</span></span><span className="tabular-nums">{money(inv.amountCents)}</span></div>
          </div>

          {/* Status + legal footer */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${paid ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--line)]'}`}>
              {paid && <CheckCircle2 size={12} />} {paid ? t('bill.paid', 'PAID') : inv.status}
            </span>
            <span className="text-xs text-[var(--faint)]">{t('bill.paidon', 'Paid on {d}').replace('{d}', new Date(inv.createdAt).toLocaleDateString())}</span>
          </div>
          <p className="text-[11px] text-[var(--faint)] leading-relaxed">{t('bill.thanks', 'Thank you!')} {t('bill.legal', 'Keep this receipt for your records. Any applicable taxes are included. Questions? Reach us via the Contact page.')}</p>
        </div>
      )}
    </Modal>
  );
}

function RepoEditor({ repo, onClose, onSaved }) {
  const toast = useToast(); const { t } = useI18n(); const { user } = useAuth();
  const [f, setF] = useState({ name: '', description: '', repoUrl: '', tags: '', discord: '', website: '', changelog: '' });
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // Creating a public repo now requires a real, secured, BMM-linked identity — verified
  // email + 2FA + a linked creator id (enforced server-side too). Show it upfront when
  // creating so the user isn't surprised at submit. Staff bypass. (Editing is unaffected.)
  const cl = useFetch(() => (repo ? Promise.resolve({ links: [] }) : api.get('/me/creator-links').catch(() => ({ links: [] }))), [repo]);
  const isStaff = ['MOD', 'ADMIN', 'SUPERADMIN'].includes(user?.role);
  const reqs = [
    { key: 'email', ok: !!user?.emailVerified, label: t('repos.req.email', 'A verified email address'), action: 'resend' },
    { key: '2fa', ok: !!user?.totpEnabled, label: t('repos.req.2fa', 'Two-factor authentication (2FA)'), to: '/profile?setup2fa=1' },
    { key: 'creator', ok: (cl.data?.links || []).length > 0, label: t('repos.req.creator', 'A linked BMM creator id'), to: '/profile' },
  ];
  const missing = (!repo && !isStaff && !cl.loading) ? reqs.filter((r) => !r.ok) : [];
  const blocked = missing.length > 0;
  const resendVerify = async () => { setResending(true); try { await api.post('/auth/verify-email/resend', {}); toast.success(t('repos.req.emailsent', 'Verification email sent — check your inbox.')); } catch { toast.error(t('repos.req.emailfail', 'Could not send the email.')); } finally { setResending(false); } };
  useEffect(() => { if (repo) setF({ name: repo.name, description: repo.description || '', repoUrl: repo.repoUrl || '', tags: (repo.tags || []).join(', '), discord: repo.links?.discord || '', website: repo.links?.website || '', changelog: repo.links?.changelog || '' }); }, [repo]);
  const save = async () => {
    if (f.name.length < 2) return toast.error(t('repos.nameshort', 'Name too short.'));
    setBusy(true);
    const links = {}; if (f.discord) links.discord = f.discord; if (f.website) links.website = f.website; if (f.changelog) links.changelog = f.changelog;
    const body = { name: f.name, description: f.description, repoUrl: f.repoUrl || undefined, tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean), links };
    try { if (repo) await api.patch(`/repos/${repo.id}`, body); else await api.post('/repos', body); toast.success(repo ? t('repos.saved', 'Saved.') : t('repos.added', 'Repo added.')); onSaved(); }
    catch (x) {
      const e = x.data?.error;
      toast.error(e === 'email_unverified' ? t('repos.gate.email', 'Verify your email address before creating a repo.')
        : e === 'twofa_required' ? t('repos.gate.2fa', 'Enable 2FA on your account before creating a repo.')
        : e === 'creator_link_required' ? t('repos.gate.creator', 'Link a BMM creator id before creating a repo.')
        : e || t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={repo ? t('repos.edit.title', 'Edit repo') : t('repos.add.title', 'Add a repo')} icon={GitBranch} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy || blocked} onClick={save}>{busy ? <Spinner /> : (repo ? t('repos.save', 'Save') : t('repos.addshort', 'Add'))}</Button></>}>
      {blocked && (
        <div className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3">
          <div className="text-sm font-medium text-[var(--warning)] flex items-center gap-2 mb-2"><ShieldCheck size={15} /> {t('repos.gate.title', 'A few steps before you can publish a repo')}</div>
          <div className="space-y-1.5">
            {reqs.map((r) => (
              <div key={r.key} className="flex items-center gap-2 text-sm">
                {r.ok ? <CheckCircle2 size={16} className="text-[var(--success)] shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-[var(--warning)] shrink-0" />}
                <span className={`flex-1 ${r.ok ? 'text-[var(--faint)] line-through' : ''}`}>{r.label}</span>
                {!r.ok && (r.action === 'resend'
                  ? <button onClick={resendVerify} disabled={resending} className="press-sm text-xs text-[var(--primary-2)] underline underline-offset-2 shrink-0">{resending ? t('repos.req.sending', 'Sending…') : t('repos.req.resend', 'Resend email')}</button>
                  : <Link to={r.to} onClick={onClose} className="press-sm text-xs text-[var(--primary-2)] underline underline-offset-2 shrink-0">{t('repos.req.fix', 'Set up')}</Link>)}
              </div>
            ))}
          </div>
        </div>
      )}
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
export function HostFilesModal({ repo, admin, onClose, onChanged }) {
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
  const publish = async () => { try { const r = await api.post(`/admin/repos/${repo.id}/publish`); toast.success(t('repos.publishedto', 'Published → /hosting/{p}/repo.json').replace('{p}', r.hostPath)); reload(); onChanged?.(); } catch (x) { toast.error(x.data?.error === 'no_repo_json' ? t('repos.needjson', 'A repo.json must be uploaded first.') : t('repos.failed', 'Failed.')); } };
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
