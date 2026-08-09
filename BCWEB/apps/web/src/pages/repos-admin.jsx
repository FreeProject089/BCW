import { useEffect, useState } from 'react';
import {
  Server, GitBranch, Pencil, XCircle, Clock, ShieldCheck, Users, HardDrive, Rocket, Files, Search, X, Wifi, Zap, Copy, RefreshCw, LayoutDashboard, ChevronDown, Fingerprint, Sliders, Check,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast, useDialog, Button, Card, Badge, Input, Select, Field, EmptyState, Spinner, Modal, ActionBar } from '../ui/ui.jsx';
import { Loading } from './pages.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useFetch, gb, DotDropdown, RepoStatusSelect, RepoCategorySelect, StatusBadges, HostFilesModal } from './repos.jsx';

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
      {err && <div className="text-xs text-error mt-2">{err}</div>}
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

/* Admin: live traffic across every repo — recent access events (15 min window,
   auto-refreshing) + a 24h per-repo download rollup. */
function AdminRepoTraffic() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let on = true;
    const load = () => api.get('/admin/repos/traffic').then((d) => on && setData(d)).catch(() => {});
    load();
    const id = setInterval(load, 10000); // live-ish: refresh every 10s
    return () => { on = false; clearInterval(id); };
  }, []);
  const recent = data?.recent || [];
  const rollup = data?.rollup || [];
  return (
    <Card className="p-4 mb-4">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <Wifi size={16} className="text-[var(--primary-2)]" />
        <span className="font-semibold flex-1">Live repo traffic</span>
        {recent.length > 0 && <Badge tone="primary">{recent.length} in the last 15 min</Badge>}
        <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 grid lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">Now (15 min)</div>
            {!recent.length ? <div className="text-sm text-[var(--faint)] py-3">No traffic right now.</div> : (
              <div className="divide-y divide-[var(--line)] max-h-64 overflow-auto rounded-lg border border-[var(--line)]">
                {recent.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className={`shrink-0 font-bold ${e.kind === 'download' ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`}>{e.kind === 'download' ? '↓' : '•'}</span>
                    <span className="font-medium truncate max-w-[9rem]" title={e.repo}>{e.repo}</span>
                    <span className="font-mono text-[var(--muted)] truncate flex-1" title={e.path}>{e.path}</span>
                    <span className="text-[var(--faint)] font-mono shrink-0">{e.ip}</span>
                    <span className="text-[var(--faint)] shrink-0 tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">Last 24h — downloads per repo</div>
            {!rollup.length ? <div className="text-sm text-[var(--faint)] py-3">No downloads in the last 24h.</div> : (
              <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                {rollup.map((r) => {
                  const max = rollup[0]?.count || 1;
                  return (
                    <div key={r.repoId} className="flex items-center gap-2 text-xs">
                      <span className="w-36 truncate font-medium" title={`${r.name} · ${r.owner}`}>{r.name}</span>
                      <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} /></div>
                      <span className="tabular-nums text-[var(--muted)] w-10 text-right">{r.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// Admin storage-pool manager: every user's pools, grouped by owner, with merge (per owner,
// reusing the owner endpoint which accepts staff), rename/recolour, and split (unmerge).
export function AdminPools() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useFetch(() => api.get('/admin/hosting/groups'), []);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({}); // { [ownerId]: Set(poolId) } — merge selection is per-owner
  const groups = data?.groups || [];
  const filtered = groups.filter((g) => !q || `${g.name} ${g.ownerName} ${g.ownerBcId}`.toLowerCase().includes(q.toLowerCase()));
  // Group by owner so merges (which require one owner) are scoped correctly.
  const byOwner = {};
  for (const g of filtered) { (byOwner[g.ownerId] ||= { ownerId: g.ownerId, ownerName: g.ownerName, ownerBcId: g.ownerBcId, pools: [] }).pools.push(g); }
  const owners = Object.values(byOwner);

  const toggle = (ownerId, poolId) => setSel((s) => { const n = { ...s }; const set = new Set(n[ownerId] || []); set.has(poolId) ? set.delete(poolId) : set.add(poolId); n[ownerId] = set; return n; });
  const setColor = async (g, color) => { try { await api.patch(`/me/hosting/groups/${g.id}`, { color }); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const rename = async (g) => {
    const name = await dialog.prompt({ title: t('apools.rename', 'Rename pool'), defaultValue: g.name, label: t('pools.name', 'Pool name') });
    if (!name) return;
    try { await api.patch(`/me/hosting/groups/${g.id}`, { name }); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const mergeOwner = async (o, into) => {
    const ids = [...(sel[o.ownerId] || [])].filter((id) => id !== into);
    if (!into || !ids.length) return;
    if (!await dialog.confirm({ title: t('apools.merge.t', 'Merge pools?'), message: t('apools.merge.b', 'Merge {n} pool(s) into the target. Subscriptions move with them.').replace('{n}', String(ids.length)), okLabel: t('pools.mergebtn', 'Merge') })) return;
    try { await api.post('/me/hosting/groups/merge', { sourceIds: ids, targetId: into }); setSel((s) => ({ ...s, [o.ownerId]: new Set() })); reload(); }
    catch (x) { toast.error(x.data?.error || t('repos.failed', 'Failed.')); }
  };
  // Resize a pool. This does NOT write poolBytes: that value is derived from the pool's active
  // subscriptions and is recomputed whenever one changes, so a direct write would be undone at
  // the next renewal or lapse. The endpoint adjusts an admin-grant subscription instead, and
  // refuses a size below what the owner paid for or below what their content already reserves.
  const resize = async (g) => {
    const cur = gb(g.poolBytes);
    const v = await dialog.prompt({
      title: t('apools.resize.t', 'Change pool size'),
      label: t('apools.resize.l', 'Size in GB'),
      message: t('apools.resize.b', 'Storage above what the owner paid for is recorded as an administrator grant.'),
      defaultValue: String(cur),
    });
    if (v == null || v === '') return;
    const n = Number(v);
    if (!isFinite(n) || n < 0) return toast.error(t('apools.resize.bad', 'Enter a number of GB.'));
    try { await api.patch(`/admin/hosting/pools/${g.id}`, { storageGB: n }); reload(); toast.success(t('common.saved', 'Saved.')); }
    catch (x) {
      const e = x.data?.error;
      toast.error(
        e === 'below_paid' ? t('apools.belowpaid', 'Below what the owner paid for ({n} GB) — change their subscription instead.').replace('{n}', (x.data.paidGB ?? 0).toFixed(1))
        : e === 'below_allocated' ? t('apools.belowalloc', 'Their repos and catalogs already reserve {n} GB — free some first.').replace('{n}', (x.data.allocatedGB ?? 0).toFixed(1))
        : t('repos.failed', 'Failed.'));
    }
  };
  // Grant a user a pool outright (no purchase, no Stripe).
  const grant = async () => {
    const email = await dialog.prompt({ title: t('apools.grant.t', 'Grant a storage pool'), label: t('apools.grant.email', 'Account email') });
    if (!email) return;
    const size = await dialog.prompt({ title: t('apools.grant.t', 'Grant a storage pool'), label: t('apools.resize.l', 'Size in GB'), defaultValue: '5' });
    if (size == null || size === '') return;
    const n = Number(size);
    if (!isFinite(n) || n <= 0) return toast.error(t('apools.resize.bad', 'Enter a number of GB.'));
    try { await api.post('/admin/hosting/pools', { email: email.trim(), name: 'Pool', storageGB: n }); reload(); toast.success(t('apools.granted', 'Pool granted.')); }
    catch (x) { toast.error(x.data?.error === 'unknown_user' ? t('apools.nouser', 'No account with that email.') : t('repos.failed', 'Failed.')); }
  };
  const split = async (g) => {
    if (!await dialog.confirm({ title: t('apools.split.t', 'Split this pool?'), message: t('apools.split.b', 'Each extra subscription becomes its own pool. Repos/catalogs stay on the original pool — reassign them afterward if needed.'), okLabel: t('apools.split.ok', 'Split') })) return;
    try { const r = await api.post(`/admin/hosting/groups/${g.id}/split`, {}); toast.success(t('apools.split.done', 'Split into {n} new pool(s).').replace('{n}', String(r.created))); reload(); }
    catch (x) { toast.error(x.data?.error === 'nothing_to_split' ? t('apools.split.none', 'This pool has only one subscription — nothing to split.') : t('repos.failed', 'Failed.')); }
  };

  if (loading) return <Loading />;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><HardDrive size={16} className="text-[var(--primary-2)]" /> {t('apools.title', 'Storage pools (all users)')} <span className="text-xs text-[var(--faint)] font-normal">{groups.length}</span></h2>
        <div className="flex items-center gap-2">
          <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-8 !py-1 !text-sm" placeholder={t('apools.search', 'Search owner / pool…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button size="sm" variant="primary" onClick={grant}><HardDrive size={13} /> {t('apools.grantbtn', 'Grant a pool')}</Button>
        </div>
      </div>
      {owners.length === 0 ? <EmptyState icon={HardDrive} title={t('apools.none', 'No pools')} sub={t('apools.none.s', 'No storage pools match.')} /> : <div className="space-y-4">
        {owners.map((o) => { const selected = sel[o.ownerId] || new Set(); return (
          <Card key={o.ownerId} className="p-4">
            <div className="flex items-center gap-2 mb-2.5 text-sm flex-wrap">
              <Users size={14} className="text-[var(--primary-2)]" />
              <Link to={`/u/${o.ownerId}`} className="font-medium hover:text-[var(--primary)]">{o.ownerName}</Link>
              <button onClick={() => { navigator.clipboard?.writeText(o.ownerBcId); toast.success(t('common.copied', 'Copied.')); }} className="text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary)] inline-flex items-center gap-1"><Fingerprint size={11} /> {o.ownerBcId}</button>
              <span className="text-[var(--faint)]">· {o.pools.length} {t('apools.pools', 'pools')}</span>
              {selected.size >= 1 && o.pools.length > 1 && <span className="ml-auto flex items-center gap-1.5">
                <select className="input !w-auto !py-1 !text-xs" defaultValue="" onChange={(e) => e.target.value && mergeOwner(o, e.target.value)}>
                  <option value="">{t('pools.mergeinto', 'Merge into…')}</option>
                  {o.pools.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                </select>
              </span>}
            </div>
            <div className="space-y-1.5">
              {o.pools.map((g) => { const accent = g.color || '#f97316'; return (
                <div key={g.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-[var(--line)] p-2.5" style={{ borderLeft: `3px solid ${accent}` }}>
                  {o.pools.length > 1 && <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(o.ownerId, g.id)} title={t('pools.selectmerge', 'Select to merge')} />}
                  <label className="grid place-items-center w-7 h-7 rounded-lg shrink-0 cursor-pointer relative" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>
                    <HardDrive size={13} style={{ color: accent }} />
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f97316'} onChange={(e) => setColor(g, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap min-w-0"><span className="truncate min-w-0">{g.name}</span> {g.freePlan && <Badge tone="">{t('pools.free', 'free')}</Badge>} {g.subCount >= 2 && <Badge tone="primary">{g.subCount} {t('apools.subs', 'subs')}</Badge>}</div>
                    <div className="text-[11px] text-[var(--faint)]">{gb(g.poolBytes)} GB · {g.repos.length} {t('pools.repos', 'repos')} · {g.catalogs.length} {t('pools.catalogs', 'catalogs')}</div>
                  </div>
                  <button onClick={() => rename(g)} className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]" title={t('apools.rename', 'Rename')}><Pencil size={13} /></button>
                  <button onClick={() => resize(g)} className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]" title={t('apools.resize', 'Change size')}><Sliders size={13} /></button>
                  {g.subCount >= 2 && <Button size="sm" variant="ghost" onClick={() => split(g)}><GitBranch size={13} /> {t('apools.split', 'Split')}</Button>}
                </div>
              ); })}
            </div>
          </Card>
        ); })}
      </div>}
    </div>
  );
}

export function AdminRepos() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n(); const navigate = useNavigate();
  const { data, loading, reload } = useFetch(() => api.get('/admin/repos'), []);
  const [review, setReview] = useState(null);
  const [q, setQ] = useState(''); const [catF, setCatF] = useState('all'); const [statF, setStatF] = useState('all');
  const allRepos = data?.repos || [];
  const pending = allRepos.filter((r) => r.pendingReview).length;
  const repos = allRepos.filter((r) => {
    if (catF !== 'all' && (r.category || 'community') !== catF) return false;
    if (statF !== 'all' && r.status !== statF) return false;
    if (q) { const s = q.toLowerCase(); if (!`${r.name} ${r.description || ''} ${r.owner?.displayName || ''} ${r.fingerprint || ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(s)) return false; }
    return true;
  });
  const verify = async (r) => { try { await api.post(`/admin/repos/${r.id}/verify`); toast.success(t('arp.verified', 'Verified "{n}".').replace('{n}', r.name)); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const reject = async (r) => { const reason = await dialog.prompt({ title: t('arp.reject', 'Reject / unlist'), label: t('arp.reason', 'Reason (sent to owner)'), okLabel: t('arp.rejectbtn', 'Reject'), danger: true }); if (!reason) return; try { await api.post(`/admin/repos/${r.id}/reject`, { reason }); toast.success(t('arp.rejected', 'Rejected.')); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const setStatus = async (r, status) => { try { await api.patch(`/admin/repos/${r.id}`, { status }); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const setCategory = async (r, category) => { try { await api.patch(`/admin/repos/${r.id}`, { category }); toast.success(category === 'community' ? t('arp.cat.community', 'Set to community.') : category === 'official' ? t('arp.cat.official', 'Marked as OFFICIAL.') : t('arp.cat.partner', 'Marked as PARTNER.')); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const boost = async (r, days) => { try { await api.post(`/admin/repos/${r.id}/feature`, { days }); toast.success(days === 0 ? t('arp.boost.cleared', 'Boost cleared.') : t('arp.boost.ok', 'Boosted for {d} days (free).').replace('{d}', days)); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const boostPick = async (r) => {
    const featured = r.featuredUntil && new Date(r.featuredUntil) > new Date();
    const v = await dialog.prompt({ title: t('arp.boost.title', 'Boost repo (free)'), label: t('arp.boost.days', 'Feature for how many days? (0 to clear)'), defaultValue: featured ? '0' : '30', placeholder: '30', okLabel: t('arp.boost.apply', 'Apply') });
    if (v === false) return;
    const days = Math.max(0, Math.min(3650, parseInt(v, 10) || 0));
    boost(r, days);
  };
  // Manually re-run validation: recompute the content SHA and re-verify.
  const revalidate = async (r) => {
    try {
      const res = await api.post(`/admin/repos/${r.id}/revalidate`);
      if (res.verified) toast.success(t('arp.revalok', 'Verified “{n}” — its content matches a valid repo.json (sha {s}…).').replace('{n}', r.name).replace('{s}', String(res.sha).slice(0, 10)));
      else toast.error(t('arp.revalbad', 'Couldn’t verify “{n}” — {r}. It stays unverified until a valid repo.json is uploaded.').replace('{n}', r.name).replace('{r}', res.reason || t('arp.norepojson', 'no valid repo.json found')));
      reload();
    } catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const [checkingAll, setCheckingAll] = useState(false);
  const checkAll = async () => { setCheckingAll(true); try { const r = await api.post('/admin/repos/check-all'); toast.success(t('arp.checked', 'Checked {c} repos — {o} online, {v} verified.').replace('{c}', r.checked).replace('{o}', r.online).replace('{v}', r.verified)); reload(); } catch { toast.error(t('arp.checkfail', 'Check failed.')); } finally { setCheckingAll(false); } };
  const [limitsRepo, setLimitsRepo] = useState(null); // repo whose CPU/upload/storage limits are being edited
  return (
    <div className="mt-10">
      <RepoIdentifyCard />
      <AdminRepoTraffic />
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Server size={16} className="text-[var(--primary-2)]" /> Server Repos</h2>
        <div className="flex items-center gap-2">
          {pending > 0 && <Badge tone="amber"><Clock size={11} /> {pending} pending review</Badge>}
          <Button size="sm" disabled={checkingAll} onClick={checkAll}>{checkingAll ? <Spinner /> : <><RefreshCw size={14} /> Check all</>}</Button>
        </div>
      </div>
      {/* Search + tier/status filters — the admin list can get long. */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input className="input !pl-9" placeholder={t('arp.search', 'Search by name, owner, repo ID or tag…')} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]"><X size={15} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <DotDropdown value={catF} onChange={setCatF} options={[
            { value: 'all', label: t('repos.tier.all', 'All tiers'), color: 'var(--faint)' }, { value: 'official', label: t('repos.cat.official', 'Official'), color: 'var(--success)' },
            { value: 'partner', label: t('repos.cat.partner', 'Partner'), color: 'var(--info)' }, { value: 'community', label: t('repos.cat.community', 'Community'), color: 'var(--muted)' },
          ]} />
          <DotDropdown value={statF} onChange={setStatF} options={[
            { value: 'all', label: t('arp.allstatus', 'All statuses'), color: 'var(--faint)' }, { value: 'ONLINE', label: t('repos.online', 'Online'), color: 'var(--success)' },
            { value: 'OFFLINE', label: t('repos.offline', 'Offline'), color: 'var(--faint)' }, { value: 'PROVISIONING', label: t('repos.st.provisioning', 'Provisioning'), color: 'var(--warning)' },
            { value: 'SUSPENDED', label: t('repos.st.suspended', 'Suspended'), color: 'var(--error)' },
          ]} />
        </div>
      </div>
      {loading ? <div className="text-[var(--muted)] text-sm py-4">Loading…</div>
        : !allRepos.length ? <div className="text-[var(--muted)] text-sm py-4">No repos.</div>
        : !repos.length ? <EmptyState icon={Search} title={t('arp.nomatch', 'No repos match your filters')} />
        : <div className="space-y-2">
          {repos.map((r) => (
            <Card key={r.id} className={`p-4 ${r.pendingReview ? 'border-[var(--ring)]' : ''}`}>
              {/* Stack on phones: the two selects are ~230px of shrink-0, so side-by-side they
                  squeezed the name column down to a sliver and every status badge wrapped onto
                  its own line — a 4-badge repo became a 4-line column. */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                <GitBranch size={18} className="text-[var(--primary-2)] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">{r.name}
                    {/* WHO: owner → profile + copyable BC id (the thing an admin actually needs). */}
                    {r.ownerId ? <a href={`/u/${r.ownerId}`} className="text-xs text-[var(--faint)] font-normal hover:text-[var(--primary)]">· {r.owner?.displayName}</a> : <span className="text-xs text-[var(--faint)] font-normal">· {r.owner?.displayName}</span>}
                    {r.ownerBcId && <button onClick={() => { navigator.clipboard?.writeText(r.ownerBcId); toast.success(t('repos.bcidcopied', 'Host BC id copied.')); }} className="text-[10px] font-mono text-[var(--faint)] hover:text-[var(--primary)] inline-flex items-center gap-0.5"><Fingerprint size={10} /> {r.ownerBcId} <Copy size={8} /></button>}
                  </div>
                  <div className="mt-2"><StatusBadges r={r} /></div>
                  {r.hosted && (r.subscription?.currentPeriodEnd || r.subscription?.status === 'canceled' || r.subscription?.status === 'expired') && (
                    <div className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-2 flex-wrap">
                      {r.subscription?.currentPeriodEnd && (
                        <span className={`flex items-center gap-1 ${new Date(r.subscription.currentPeriodEnd) <= new Date() ? 'text-error' : ''}`}>
                          <Clock size={11} /> {new Date(r.subscription.currentPeriodEnd) <= new Date() ? 'Expired' : 'Expires'} {new Date(r.subscription.currentPeriodEnd).toLocaleDateString()}
                        </span>
                      )}
                      {r.subscription?.status === 'canceled' && <Badge tone="red">subscription cancelled</Badge>}
                      {r.subscription?.status === 'expired' && <Badge tone="red">term expired</Badge>}
                    </div>
                  )}
                </div>
                </div>
                {/* Full-width on phones (they're the card's primary actions), inline from sm up. */}
                <div className="flex items-center gap-1.5 shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
                  <RepoCategorySelect value={r.category} onChange={(c) => setCategory(r, c)} />
                  <RepoStatusSelect value={r.status} onChange={(s) => setStatus(r, s)} />
                </div>
              </div>
              {/* One line, always: ActionBar renders what fits and folds the rest behind a
                  "More" menu. Six actions free-wrapped into a 3-4 row block that dwarfed the
                  repo it belonged to; a fixed grid only moved the problem (a phone still got
                  three rows). It measures, so a narrow card folds more and a wide one folds
                  nothing. Manage stays first, so the primary action is never the one hidden. */}
              <div className="mt-3">
                <ActionBar actions={[
                  // Admin repo dashboard: the SAME dashboard as the owner's, but staff aren't
                  // frozen by suspension and every action is logged with "(admin)".
                  { key: 'manage', label: t('arp.dashboard', 'Manage (admin)'), icon: LayoutDashboard, variant: 'primary', href: `/repo/${r.id}`, onClick: () => navigate(`/repo/${r.id}`) },
                  { key: 'verify', label: 'Verify', icon: ShieldCheck, variant: 'primary', hidden: !r.pendingReview, onClick: () => verify(r) },
                  { key: 'boost', label: r.featuredUntil && new Date(r.featuredUntil) > new Date() ? t('arp.boosted', 'Boosted') : t('arp.boost', 'Boost'), icon: Rocket, onClick: () => boostPick(r) },
                  { key: 'sha', label: t('arp.revalidate', 'Revalidate SHA'), icon: ShieldCheck, onClick: () => revalidate(r) },
                  { key: 'review', label: t('arp.review', 'Review & download'), icon: Files, hidden: !r.hosted, onClick: () => setReview(r) },
                  { key: 'reject', label: t('arp.reject', 'Reject / unlist'), icon: XCircle, danger: true, onClick: () => reject(r) },
                  { key: 'limits', label: t('arp.limits', 'Limits'), icon: Sliders, onClick: () => setLimitsRepo(r) },
                ]} />
              </div>
            </Card>
          ))}
        </div>}
      {review && <HostFilesModal repo={review} admin onClose={() => setReview(null)} onChanged={reload} />}
      {limitsRepo && <RepoLimitsModal repo={limitsRepo} onClose={() => setLimitsRepo(null)} onSaved={() => { setLimitsRepo(null); reload(); }} />}
    </div>
  );
}

// Admin: edit a hosted repo's upload / storage limits in one form (no more
// one-prompt-at-a-time). PATCH /admin/repos/:id — storage can't drop below what's used.
// CPU is no longer a product dimension, so it isn't editable here.
function RepoLimitsModal({ repo, onClose, onSaved }) {
  const toast = useToast(); const { t } = useI18n();
  const usedGB = Number(repo.storageUsedBytes || 0) / 1024 ** 3;
  const [f, setF] = useState({
    uploadMbps: +(((repo.uploadLimitKbps || 0) / 1024).toFixed(1)),
    storageGB: +((Number(repo.storageQuotaBytes || 0) / 1024 ** 3).toFixed(2)),
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.storageGB < usedGB) return toast.error(t('arp.storagebelow', "Storage can't be below what's already used ({n} GB).").replace('{n}', usedGB.toFixed(2)));
    setBusy(true);
    try {
      await api.patch(`/admin/repos/${repo.id}`, { uploadMbps: Number(f.uploadMbps), storageGB: Number(f.storageGB) });
      toast.success(t('repos.limits.saved', 'Limits updated.')); onSaved();
    } catch (x) { toast.error(x.data?.error === 'exceeds_disk' ? 'Exceeds the real disk capacity.' : t('repos.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const rows = [
    { k: 'uploadMbps', label: t('repos.s.upload', 'Upload speed'), suffix: 'Mbps', step: 1, min: 0, icon: Zap },
    { k: 'storageGB', label: t('repos.storage', 'Storage'), suffix: 'GB', step: 1, min: 0, icon: HardDrive },
  ];
  return (
    <Modal open onClose={onClose} title={`Limits — ${repo.name}`} icon={Sliders} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button></>}>
      <div className="space-y-3">
        {rows.map((r) => (
          <Field key={r.k} label={<span className="flex items-center gap-1.5"><r.icon size={13} className="text-[var(--primary-2)]" /> {r.label}</span>}>
            <div className="flex items-center gap-2">
              <Input type="number" step={r.step} min={r.min} value={f[r.k]} onChange={(e) => setF({ ...f, [r.k]: e.target.value })} />
              <span className="text-sm text-[var(--muted)] w-12">{r.suffix}</span>
            </div>
          </Field>
        ))}
        <p className="text-[11px] text-[var(--faint)]">Currently using {usedGB.toFixed(2)} GB — storage can't be set below that. These are the repo's allotted limits (see Server performance for the per-repo allocation table).</p>
      </div>
    </Modal>
  );
}
