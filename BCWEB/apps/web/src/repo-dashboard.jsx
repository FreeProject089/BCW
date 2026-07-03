import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Server, GitBranch, ArrowLeft, Wifi, WifiOff, ShieldCheck, HardDrive, Zap, Lock, Copy, ExternalLink,
  FileJson, FileText, Trash2, UploadCloud, FolderUp, Rocket, CheckCircle2, AlertTriangle, KeyRound,
  Users, Mail, Plus, X, Eye, EyeOff, Files, Settings2, Loader2, Globe, History, Hash, Search, ChevronDown,
  UploadCloud as UploadIcon, Trash, Wifi as WifiOn, WifiOff as WifiGone, Download, Ban, Radio, Star,
} from 'lucide-react';
import { api } from './api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Spinner } from './ui.jsx';
import { useUploads } from './uploads.jsx';
import { useI18n } from './i18n.jsx';

const gb = (n) => (Number(n) / 1024 ** 3).toFixed(1);
const mb = (n) => (Number(n) / 1024 / 1024).toFixed(1);
// Adaptive size so small files don't all read "0.0 MB".
const fmtSize = (n) => { n = Number(n) || 0; if (n < 1024) return `${n} B`; if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`; if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`; return `${(n / 1024 ** 3).toFixed(2)} GB`; };

/* ── Route: /repo/:id — dedicated per-repo dashboard (owner / collaborator / password) ── */
export function RepoDashboard() {
  const { id } = useParams();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState(null); // 'password' | 'auth' | null
  const load = () => {
    setLoading(true);
    api.get(`/repos/${id}/dashboard`)
      .then((d) => { setData(d); setGate(null); })
      .catch((x) => { setData(null); setGate(x.data?.error === 'password_required' ? 'password' : 'auth'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-16"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (gate === 'password') return <PasswordGate id={id} onUnlocked={load} />;
  if (gate === 'auth') return <AuthGate />;
  if (!data) return <AuthGate />;
  return <Dashboard data={data} reload={load} />;
}

function PasswordGate({ id, onUnlocked }) {
  const { t } = useI18n(); const toast = useToast();
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const unlock = async () => {
    if (!pw) return;
    setBusy(true);
    try { await api.post(`/repos/${id}/dashboard/unlock`, { password: pw }); toast.success(t('rd.unlocked', 'Unlocked.')); onUnlocked(); }
    catch (x) { toast.error(x.data?.error === 'invalid_password' ? t('rd.badpw', 'Wrong password.') : t('rd.unlockfail', 'Could not unlock.')); setBusy(false); }
  };
  return (
    <div className="max-w-sm mx-auto py-16">
      <Card className="p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-[var(--line)] grid place-items-center mx-auto mb-3"><KeyRound size={22} className="text-[var(--primary-2)]" /></div>
        <h1 className="text-lg font-semibold">{t('rd.locked.t', 'Private repo dashboard')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('rd.locked.s', 'Enter the dashboard password to manage this repo.')}</p>
        <Input type="password" value={pw} autoFocus placeholder={t('rd.password', 'Password')} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
        <Button variant="primary" className="w-full mt-3" disabled={busy} onClick={unlock}>{busy ? <Spinner /> : <><Lock size={15} /> {t('rd.unlock', 'Unlock')}</>}</Button>
        <Link to="/dashboard?s=repos" className="text-xs text-[var(--faint)] hover:text-[var(--text)] mt-4 inline-block">{t('rd.backdash', '← Back to dashboard')}</Link>
      </Card>
    </div>
  );
}

function AuthGate() {
  const { t } = useI18n();
  return (
    <div className="max-w-sm mx-auto py-16">
      <Card className="p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-[var(--line)] grid place-items-center mx-auto mb-3"><Lock size={22} className="text-[var(--primary-2)]" /></div>
        <h1 className="text-lg font-semibold">{t('rd.noaccess.t', 'No access')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('rd.noaccess.s', 'You need to be the owner, an authorized email, or have the dashboard password.')}</p>
        <Link to="/auth"><Button variant="primary" className="w-full">{t('rd.signin', 'Sign in')}</Button></Link>
        <Link to="/dashboard?s=repos" className="text-xs text-[var(--faint)] hover:text-[var(--text)] mt-4 inline-block">{t('rd.backdash', '← Back to dashboard')}</Link>
      </Card>
    </div>
  );
}

function Dashboard({ data, reload }) {
  const { t } = useI18n(); const toast = useToast();
  const [tab, setTab] = useState('files');
  const r = data; const online = r.published && r.status === 'ONLINE';
  const publicUrl = r.hostPath ? `${location.origin}/hosting/${r.hostPath}/repo.json` : '';
  const pct = r.storageQuotaBytes ? Math.min(100, (r.used / r.storageQuotaBytes) * 100) : 0;
  const levelBadge = { owner: ['amber', t('rd.lvl.owner', 'Owner')], collab: ['primary', t('rd.lvl.collab', 'Collaborator')], password: ['', t('rd.lvl.password', 'Password access')] }[r.level] || ['', r.level];

  const tabs = [
    ['files', t('rd.tab.files', 'Files'), Files],
    ['online', t('rd.tab.online', 'Online'), Globe],
    ...(r.hosted ? [['users', t('rd.tab.users', 'Users'), Users]] : []),
    ['activity', t('rd.tab.activity', 'Activity'), History],
    ['settings', t('rd.tab.settings', 'Settings'), Settings2],
    ...(r.level === 'owner' ? [['access', t('rd.tab.access', 'Access'), KeyRound]] : []),
  ];

  return (
    <div>
      <Link to="/dashboard?s=repos" className="text-xs text-[var(--faint)] hover:text-[var(--text)] inline-flex items-center gap-1 mb-3"><ArrowLeft size={13} /> {t('rd.backdash', 'Back to dashboard')}</Link>

      {/* header */}
      <Card className="p-5 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-[var(--line)] grid place-items-center shrink-0"><Server size={20} className="text-[var(--primary-2)]" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold truncate">{r.name}</h1>
                <Badge tone={levelBadge[0]}><ShieldCheck size={11} /> {levelBadge[1]}</Badge>
              </div>
              <div className="text-xs text-[var(--faint)] mt-1 flex items-center gap-3 flex-wrap">
                {r.ownerName && <span className="flex items-center gap-1"><Users size={12} /> {r.ownerName}</span>}
                <span className={`flex items-center gap-1 ${online ? 'text-emerald-400' : 'text-[var(--faint)]'}`}>{online ? <Wifi size={12} /> : <WifiOff size={12} />} {online ? t('repos.online', 'Online') : t('repos.offline', 'Offline')}</span>
                {r.verified && <span className="flex items-center gap-1 text-emerald-400/90"><CheckCircle2 size={12} /> {t('repos.verified', 'Verified')}</span>}
                {r.listed && <span className="flex items-center gap-1"><Eye size={12} /> {t('repos.listed', 'Listed')}</span>}
                {r.listed && <span className="flex items-center gap-1 text-amber-400"><Star size={12} /> {r.favoriteCount} {r.favoriteCount === 1 ? t('rd.favorite', 'favorite') : t('rd.favorites', 'favorites')}</span>}
              </div>
            </div>
          </div>
          {r.hosted && (
            <div className="text-right">
              <div className="text-xs text-[var(--faint)] flex items-center gap-1 justify-end"><HardDrive size={12} /> {mb(r.used)} / {gb(r.storageQuotaBytes) * 1024 >= 1024 ? `${gb(r.storageQuotaBytes)} GB` : `${mb(r.storageQuotaBytes)} MB`}</div>
              <div className="w-40 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mt-1.5 ml-auto"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${pct}%` }} /></div>
              <div className="text-[11px] text-[var(--faint)] mt-1 flex items-center gap-1 justify-end"><Zap size={11} /> {(r.effectiveUploadKbps / 1024).toFixed(1)} Mbps {t('repos.cap', 'cap')}</div>
            </div>
          )}
        </div>
        {r.description && <p className="text-sm text-[var(--muted)] mt-3">{r.description}</p>}
      </Card>

      {/* tab bar */}
      <div className="flex gap-1 mb-4 border-b border-[var(--line)] overflow-x-auto no-scrollbar">
        {tabs.map(([tid, label, I]) => (
          <button key={tid} onClick={() => setTab(tid)} className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === tid ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={15} /> {label}</button>
        ))}
      </div>

      {tab === 'files' && <FilesTab r={r} reload={reload} />}
      {tab === 'online' && <OnlineTab r={r} reload={reload} publicUrl={publicUrl} />}
      {tab === 'users' && <UsersTab r={r} />}
      {tab === 'activity' && <ActivityTab r={r} />}
      {tab === 'settings' && <SettingsTab r={r} reload={reload} />}
      {tab === 'access' && r.level === 'owner' && <AccessTab r={r} reload={reload} />}
    </div>
  );
}

// Builds a nested folder tree from flat "a/b/c.json" style paths, for the tree view.
function buildFileTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push(f);
  }
  return root;
}
function TreeNode({ node, name, depth, sel, toggle, del, downloadUrl, t }) {
  const [open, setOpen] = useState(depth < 1);
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <div>
      {name != null && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--surface-2)]" style={{ paddingLeft: `${16 + depth * 16}px` }}>
          <ChevronDown size={13} className={`shrink-0 transition-transform text-[var(--faint)] ${open ? '' : '-rotate-90'}`} />
          <Files size={14} className="text-[var(--primary-2)] shrink-0" />
          <span className="font-medium truncate">{name}</span>
          <span className="text-[11px] text-[var(--faint)] shrink-0">{node.files.length + [...node.dirs.values()].reduce((a, d) => a + d.files.length, 0)}</span>
        </button>
      )}
      {open && (
        <div>
          {dirs.map(([seg, sub]) => <TreeNode key={seg} node={sub} name={seg} depth={depth + 1} sel={sel} toggle={toggle} del={del} downloadUrl={downloadUrl} t={t} />)}
          {files.map((f) => {
            const dl = downloadUrl(f);
            const base = f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path;
            return (
              <div key={f.id} className="flex items-center gap-2.5 px-4 py-2 text-sm" style={{ paddingLeft: `${16 + (name != null ? depth + 1 : depth) * 16}px` }}>
                <input type="checkbox" className="shrink-0" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />
                {f.path === 'repo.json' ? <FileJson size={15} className="text-[var(--primary-2)] shrink-0" /> : <FileText size={15} className="text-[var(--faint)] shrink-0" />}
                <span className="flex-1 truncate font-mono text-xs" title={f.path}>{base}</span>
                <span className="text-xs text-[var(--faint)] tabular-nums w-20 text-right shrink-0">{fmtSize(f.size)}</span>
                {dl && <a href={dl} download className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('repos.download', 'Download')}><Download size={14} /></a>}
                <button className="text-[var(--faint)] hover:text-red-400 shrink-0" onClick={() => del(f)}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilesTab({ r, reload }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { enqueue } = useUploads();
  const [dragOver, setDragOver] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name'); // name | size | -size
  const [sel, setSel] = useState(new Set());
  const [view, setView] = useState('list'); // list | tree
  const files = r.files || [];
  const hasRepoJson = files.some((f) => f.path === 'repo.json') && !!r.repoJson;
  const totalBytes = files.reduce((a, f) => a + (Number(f.size) || 0), 0);
  const upload = (list) => { if (list.length) enqueue(r.id, r.name, list, { dashboard: true, onDone: reload }); };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) upload(fs); };
  const del = async (f) => {
    if (!(await dialog.confirm({ title: t('rd.delfile.t', 'Delete file'), message: t('rd.delfile.m', '{path}? This can\'t be undone.').replace('{path}', f.path), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    try { await api.del(`/repos/${r.id}/dashboard/files/${f.id}`); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const delSelected = async () => {
    if (!(await dialog.confirm({ title: t('rd.delsel.t', 'Delete selected files'), message: t('rd.delsel.m', '{n} file(s)? This can\'t be undone.').replace('{n}', sel.size), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    await Promise.all([...sel].map((id) => api.del(`/repos/${r.id}/dashboard/files/${id}`).catch(() => {})));
    setSel(new Set()); reload();
  };
  const [zipping, setZipping] = useState(false);
  // A plain fetch (not the api.* helper, which always parses JSON) since the
  // response here is the zip's raw bytes.
  const downloadSelected = async () => {
    setZipping(true);
    try {
      const res = await fetch(`/api/repos/${r.id}/dashboard/files/download-zip`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${r.name}.zip`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (x) { toast.error(x.message === 'selection_too_large' ? t('rd.zip.toolarge', 'Selection too large — zip downloads are capped at 2 GB. Select fewer files.') : t('rd.zip.failed', 'Download failed.')); }
    finally { setZipping(false); }
  };
  const downloadUrl = (f) => (r.published && r.hostPath) ? `${location.origin}/hosting/${r.hostPath}/files/${f.path}` : null;
  if (!r.hosted) return <Card className="p-5 text-sm text-[var(--muted)]"><Globe size={16} className="text-[var(--primary-2)] inline mr-2" />{t('rd.selfhost', 'This is a self-hosted (URL) repo — its content lives at its own URL, not here.')}</Card>;

  const shown = files
    .filter((f) => !q.trim() || f.path.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => sort === 'size' ? (a.size - b.size) : sort === '-size' ? (b.size - a.size) : a.path.localeCompare(b.path));
  const allSelected = shown.length > 0 && shown.every((f) => sel.has(f.id));
  const toggleAll = () => setSel((s) => {
    if (allSelected) { const n = new Set(s); shown.forEach((f) => n.delete(f.id)); return n; }
    const n = new Set(s); shown.forEach((f) => n.add(f.id)); return n;
  });
  const tree = view === 'tree' ? buildFileTree(shown) : null;

  return (
    <div className="space-y-4">
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
           className={`rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors ${dragOver ? 'border-[var(--primary)] bg-orange-500/[0.06]' : 'border-[var(--line)]'}`}>
        <UploadCloud size={26} className={`mx-auto mb-2 ${dragOver ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} />
        <div className="text-sm text-[var(--muted)]">{t('repos.drophere', 'Drop files here')} <span className="text-[var(--faint)]">— {t('repos.orpick', 'or')}</span></div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <label className="btn btn-sm cursor-pointer"><UploadCloud size={13} /> {t('repos.pickfiles', 'Choose files')}<input type="file" multiple className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} /></label>
          <label className="btn btn-sm cursor-pointer"><FolderUp size={13} /> {t('repos.pickfolder', 'Choose folder')}<input type="file" multiple webkitdirectory="" directory="" className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} /></label>
        </div>
        <div className="text-[11px] text-[var(--faint)] mt-2.5">{t('repos.includejson', 'Include a')} <code>repo.json</code> {t('repos.tomanifest', 'manifest. SHA / checksum is computed automatically.')}</div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--line)] flex items-center gap-2.5 flex-wrap">
          <label className="flex items-center gap-1.5 shrink-0 text-xs text-[var(--faint)] cursor-pointer" title={t('rd.selectall', 'Select all')}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          </label>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-2 shrink-0"><Files size={13} /> {files.length} {t('rd.files', 'file(s)')} · {fmtSize(totalBytes)}</span>
          <div className="flex-1 min-w-[140px] relative">
            <input className="input !py-1.5 !text-xs !pl-7 w-full" placeholder={t('rd.filesearch', 'Filter by name…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          </div>
          <select className="input !py-1.5 !text-xs !w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">{t('rd.sort.name', 'Name')}</option>
            <option value="-size">{t('rd.sort.sizedesc', 'Largest first')}</option>
            <option value="size">{t('rd.sort.sizeasc', 'Smallest first')}</option>
          </select>
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
            <button type="button" onClick={() => setView('list')} className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${view === 'list' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><FileText size={12} /> {t('rd.view.list', 'List')}</button>
            <button type="button" onClick={() => setView('tree')} className={`px-2.5 py-1.5 text-xs flex items-center gap-1 border-l border-[var(--line)] ${view === 'tree' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><FolderUp size={12} /> {t('rd.view.tree', 'Tree')}</button>
          </div>
          {sel.size > 0 && <Button size="sm" disabled={zipping} onClick={downloadSelected}>{zipping ? <Spinner /> : <><Download size={12} /> {t('rd.dlsel.btn', 'Download {n}').replace('{n}', sel.size)}</>}</Button>}
          {sel.size > 0 && <Button size="sm" onClick={delSelected} className="!text-red-400"><Trash2 size={12} /> {t('rd.delsel.btn', 'Delete {n}').replace('{n}', sel.size)}</Button>}
        </div>
        <div className="max-h-[46vh] overflow-auto">
          {!shown.length ? <div className="text-sm text-[var(--faint)] px-4 py-4">{q.trim() ? t('rd.nomatch', 'No files match.') : t('repos.nofiles', 'No files yet.')}</div>
          : view === 'tree' ? <TreeNode node={tree} name={null} depth={0} sel={sel} toggle={toggle} del={del} downloadUrl={downloadUrl} t={t} />
          : (
            <div className="divide-y divide-[var(--line)]">
              {shown.map((f) => {
                const dl = downloadUrl(f);
                const base = f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path;
                return (
                <div key={f.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                  <input type="checkbox" className="shrink-0" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />
                  {f.path === 'repo.json' ? <FileJson size={15} className="text-[var(--primary-2)] shrink-0" /> : <FileText size={15} className="text-[var(--faint)] shrink-0" />}
                  <span className="flex-1 truncate font-mono text-xs" title={f.path}>{base}</span>
                  {f.sha256 && <span className="hidden md:flex items-center gap-1 text-[10px] text-[var(--faint)] font-mono" title={`SHA-256: ${f.sha256}`}><Hash size={10} /> {f.sha256.slice(0, 10)}…</span>}
                  <span className="text-xs text-[var(--faint)] tabular-nums w-20 text-right shrink-0">{fmtSize(f.size)}</span>
                  {dl && <a href={dl} download className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('repos.download', 'Download')}><Download size={14} /></a>}
                  <button className="text-[var(--faint)] hover:text-red-400 shrink-0" onClick={() => del(f)}><Trash2 size={14} /></button>
                </div>
              );})}
            </div>
          )}
        </div>
      </Card>

      {r.repoJson && (
        <Card className="p-4">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-2 flex items-center gap-1.5"><FileJson size={13} className="text-[var(--primary-2)]" /> repo.json {hasRepoJson && <Badge tone="green"><CheckCircle2 size={10} /> {t('repos.verified', 'Verified')}</Badge>}</div>
          <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-56 overflow-auto">{JSON.stringify(r.repoJson, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}

function timeAgo(ts, t) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return t('rd.now', 'just now');
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Small 7-day grouped-bar chart (connects vs. downloads per day) — deliberately
// simpler than the admin analytics chart (no zoom, 7 points only) but with the
// same cursor-follow tooltip so it's still genuinely readable, not decorative.
function RepoTrafficChart({ series, t }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  if (!series?.length) return null;
  const W = 700, H = 140, padL = 28, pr = 6, padY = 8;
  const n = series.length;
  const max = Math.max(1, ...series.map((s) => Math.max(s.connects, s.downloads)));
  const groupW = (W - padL - pr) / n;
  const barW = groupW * 0.32;
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return (
    <div className="relative" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))); if (series[i]) setHover({ i, s: series[i], px: e.clientX - r.left }); }}>
        {[0, 0.5, 1].map((f) => <line key={f} x1={padL} y1={y(max * f)} x2={W - pr} y2={y(max * f)} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {series.map((s, i) => {
          const gx = padL + i * groupW + groupW / 2;
          return (
            <g key={s.day}>
              <rect x={gx - barW - 2} y={y(s.connects)} width={barW} height={H - padY - y(s.connects)} rx="2" fill="#38bdf8" opacity={hover && hover.i !== i ? 0.35 : 0.9} />
              <rect x={gx + 2} y={y(s.downloads)} width={barW} height={H - padY - y(s.downloads)} rx="2" fill="var(--primary)" opacity={hover && hover.i !== i ? 0.35 : 0.9} />
            </g>
          );
        })}
      </svg>
      <div className="flex text-[10px] text-[var(--faint)] mt-1" style={{ paddingLeft: `${(padL / W) * 100}%`, paddingRight: `${(pr / W) * 100}%` }}>
        {series.map((s) => <span key={s.day} className="flex-1 text-center">{fmtDay(s.day)}</span>)}
      </div>
      {hover && <div className="absolute top-1 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] shadow pointer-events-none whitespace-nowrap"
        style={{ left: `${Math.min(Math.max(hover.px, 70), (wrapRef.current?.clientWidth || W) - 70)}px`, transform: 'translateX(-50%)' }}>
        {fmtDay(hover.s.day)} — <b className="text-sky-400">{hover.s.connects}</b> {t('rd.conn', 'conn')} · <b style={{ color: 'var(--primary)' }}>{hover.s.downloads}</b> {t('rd.dl', 'dl')}</div>}
    </div>
  );
}

function UsersTab({ r }) {
  const { t } = useI18n(); const toast = useToast();
  const [data, setData] = useState(null);
  const load = () => api.get(`/repos/${r.id}/dashboard/traffic`).then(setData).catch(() => setData({ clients: [], events: [], totals: {} }));
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [r.id]);
  const ban = async (c) => { try { await api.post(`/repos/${r.id}/dashboard/ban`, { ip: c.ip, key: c.accessKey || undefined, account: c.account || undefined }); toast.success(t('rd.banned', 'Banned.')); load(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  const unban = async (c) => { try { await api.post(`/repos/${r.id}/dashboard/unban`, { ip: c.ip, key: c.accessKey || undefined, account: c.account || undefined }); toast.success(t('rd.unbanned', 'Unbanned.')); load(); } catch { toast.error(t('repos.failed', 'Failed.')); } };
  if (!data) return <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  const { clients = [], events = [], series = [], totals = {} } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[[t('rd.uniqueips', 'Unique clients'), totals.uniqueIps ?? 0, Users], [t('rd.connects', 'Connects'), totals.connects ?? 0, Radio], [t('rd.downloads', 'Downloads'), totals.downloads ?? 0, Download]].map(([l, v, I]) => (
          <Card key={l} className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><I size={13} /> {l}</div><div className="text-xl font-bold tabular-nums">{v}</div></Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Radio size={12} className="text-[var(--primary-2)]" /> {t('rd.traffic.title', 'Traffic — last 7 days')}</span>
          <span className="flex items-center gap-3 text-[11px] text-[var(--muted)]"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> {t('rd.connects', 'Connects')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" /> {t('rd.downloads', 'Downloads')}</span></span>
        </div>
        <RepoTrafficChart series={series} t={t} />
      </Card>

      <div className="text-[11px] text-[var(--faint)]">{t('rd.traffic.window', 'Last 7 days. Clients are identified by IP (and access key if used). Banning blocks them from syncing this repo immediately.')}</div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--faint)] border-b border-[var(--line)] flex items-center gap-2"><Users size={13} /> {t('rd.connected', 'Connected clients')} ({clients.length})</div>
        <div className="max-h-[40vh] overflow-auto divide-y divide-[var(--line)]">
          {clients.length ? clients.map((c) => (
            <div key={c.ip + (c.accessKey || '')} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className={`w-2 h-2 rounded-full shrink-0 ${c.banned ? 'bg-red-500' : (Date.now() - new Date(c.lastSeen) < 6e5 ? 'bg-emerald-400' : 'bg-[var(--line-strong)]')}`} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs truncate flex items-center gap-2">{c.ip}{c.accessKey && <Badge><Hash size={9} /> {c.accessKey.slice(0, 10)}</Badge>}{c.account && <Badge tone="primary"><Users size={9} /> {c.account.label}</Badge>}{c.banned && <Badge tone="red"><Ban size={9} /> {t('rd.bannedbadge', 'Banned')}</Badge>}</div>
                <div className="text-[11px] text-[var(--faint)]">{t('rd.lastseen', 'last seen')} {timeAgo(c.lastSeen, t)} · {c.downloads} {t('rd.dl', 'dl')} · {c.connects} {t('rd.conn', 'conn')}</div>
              </div>
              {c.banned
                ? <button onClick={() => unban(c)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]">{t('rd.unban', 'Unban')}</button>
                : <button onClick={() => ban(c)} className="text-[11px] px-2 py-1 rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-red-400 hover:border-red-400/50 flex items-center gap-1"><Ban size={11} /> {t('rd.ban', 'Ban')}</button>}
            </div>
          )) : <div className="text-sm text-[var(--faint)] px-4 py-6 text-center">{t('rd.noclients', 'No one has synced this repo yet.')}</div>}
        </div>
      </Card>

      {events.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--faint)] border-b border-[var(--line)] flex items-center gap-2"><History size={13} /> {t('rd.recentaccess', 'Recent access')}</div>
          <div className="max-h-[36vh] overflow-auto divide-y divide-[var(--line)]">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                {e.kind === 'download' ? <Download size={13} className="text-[var(--primary-2)] shrink-0" /> : <Radio size={13} className="text-emerald-400 shrink-0" />}
                <span className="font-mono text-xs text-[var(--muted)] shrink-0">{e.ip}</span>
                <span className="text-[var(--faint)]">{e.kind === 'download' ? t('rd.downloaded', 'downloaded') : t('rd.connected2', 'connected')}</span>
                {e.kind === 'download' && <span className="font-mono text-xs truncate flex-1">{e.path}</span>}
                <span className="text-[11px] text-[var(--faint)] shrink-0 ml-auto">{timeAgo(e.createdAt, t)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ActivityTab({ r }) {
  const { t } = useI18n();
  const [logs, setLogs] = useState(null);
  useEffect(() => { api.get(`/repos/${r.id}/dashboard/activity`).then((d) => setLogs(d.activity || [])).catch(() => setLogs([])); }, [r.id]);
  const meta = {
    upload: [UploadIcon, 'text-[var(--primary-2)]', t('rd.act.upload', 'uploaded')],
    delete: [Trash, 'text-red-400', t('rd.act.delete', 'deleted')],
    publish: [WifiOn, 'text-emerald-400', t('rd.act.publish', 'went online')],
    unpublish: [WifiGone, 'text-[var(--faint)]', t('rd.act.unpublish', 'took offline')],
    settings: [Settings2, 'text-[var(--muted)]', t('rd.act.settings', 'changed settings')],
    access: [KeyRound, 'text-amber-400', t('rd.act.access', 'changed access')],
    ban: [Ban, 'text-red-400', t('rd.act.ban', 'banned')],
    unban: [Ban, 'text-[var(--faint)]', t('rd.act.unban', 'unbanned')],
  };
  if (logs === null) return <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (!logs.length) return <Card className="p-6 text-center text-sm text-[var(--faint)]"><History size={22} className="mx-auto mb-2 text-[var(--faint)]" /> {t('rd.act.empty', 'No activity yet.')}</Card>;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="divide-y divide-[var(--line)] max-h-[60vh] overflow-auto">
        {logs.map((l) => {
          const [I, cls, label] = meta[l.action] || [History, 'text-[var(--faint)]', l.action];
          return (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className={`w-7 h-7 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 ${cls}`}><I size={14} /></div>
              <div className="flex-1 min-w-0">
                <div className="truncate"><span className="font-medium">{l.actor}</span> <span className="text-[var(--muted)]">{label}</span>{l.detail && <span className="text-[var(--faint)] font-mono text-xs"> · {l.detail}</span>}</div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums" title={new Date(l.createdAt).toLocaleString()}>{timeAgo(l.createdAt, t)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function OnlineTab({ r, reload, publicUrl }) {
  const { t } = useI18n(); const toast = useToast();
  const [busy, setBusy] = useState(false);
  const hasRepoJson = (r.files || []).some((f) => f.path === 'repo.json') && !!r.repoJson;
  if (!r.hosted) return <Card className="p-5 text-sm text-[var(--muted)]">{t('rd.selfhostonline', 'Self-hosted repos are reached at their own URL — nothing to publish here.')}</Card>;
  const go = async () => { setBusy(true); try { await api.post(`/repos/${r.id}/dashboard/publish`); toast.success(t('repos.nowonline', 'Online — your repo.json is now public.')); reload(); } catch (x) { toast.error(x.data?.error === 'no_repo_json' ? t('repos.needjson', 'Upload a valid repo.json first.') : t('repos.failed', 'Failed.')); } finally { setBusy(false); } };
  const off = async () => { setBusy(true); try { await api.post(`/repos/${r.id}/dashboard/unpublish`); toast.success(t('repos.nowoffline', 'Taken offline.')); reload(); } catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); } };
  const online = r.published && r.status === 'ONLINE';
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        {online ? <Wifi size={20} className="text-emerald-400" /> : <WifiOff size={20} className="text-[var(--faint)]" />}
        <div className="flex-1">
          <div className="font-semibold">{online ? t('repos.online', 'Online') : t('repos.offline', 'Offline')}</div>
          <div className="text-xs text-[var(--faint)]">{t('repos.urlauto', 'Public URL is managed automatically')}</div>
        </div>
        {online
          ? <Button disabled={busy} onClick={off}>{busy ? <Spinner /> : <><WifiOff size={14} /> {t('repos.takeoffline', 'Take offline')}</>}</Button>
          : <Button variant="primary" disabled={busy || !hasRepoJson} onClick={go}>{busy ? <Spinner /> : <><Rocket size={14} /> {t('repos.goonline', 'Go online')}</>}</Button>}
      </div>
      {online && publicUrl && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2">
          <FileJson size={14} className="text-[var(--primary-2)] shrink-0" />
          <code className="text-xs text-[var(--muted)] break-all flex-1 min-w-0">{publicUrl}</code>
          <button onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success(t('repos.copy.ok', 'repo.json link copied.')); }} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0"><Copy size={14} /></button>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0"><ExternalLink size={14} /></a>
        </div>
      )}
      {!online && !hasRepoJson && <div className="mt-3 text-xs text-amber-400/90 flex items-center gap-1.5"><AlertTriangle size={13} /> {t('repos.needjsonhint', 'Upload a valid repo.json first, then Go online.')}</div>}
      {!online && hasRepoJson && <div className="mt-3 text-xs text-emerald-400/90 flex items-center gap-1.5"><CheckCircle2 size={13} /> {t('repos.readyonline', 'Valid repo.json detected — ready to go online.')}</div>}
    </Card>
  );
}

function ChipList({ label, items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x) { onAdd(x); setV(''); } };
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
      <div className="flex gap-2"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" onClick={add}><Plus size={14} /></Button></div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.length ? items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">{x}<button onClick={() => onRemove(x)} className="text-[var(--faint)] hover:text-red-400"><X size={12} /></button></span>
        )) : <span className="text-xs text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Whitelist/ban entries that identify an account (BetterCommunity or Discord) rather
// than an IP/key. Search resolves via /accounts/search (creator id / Discord id or
// username / display name) — a repo owner can add either identity from one result.
function AccountChipList({ label, items, onAdd, onRemove, placeholder }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 2) return setResults(null);
    setBusy(true);
    try { const { accounts } = await api.get(`/accounts/search?q=${encodeURIComponent(q.trim())}`); setResults(accounts); }
    catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={14} />}</Button>
      </div>
      {results && (
        <div className="mt-2 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-xs text-[var(--faint)] px-1">{t('repos.acct.none', 'No accounts found.')}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs">
            <Users size={10} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-red-400"><X size={12} /></button>
          </span>
        )) : <span className="text-xs text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

function SettingsTab({ r, reload }) {
  const { t } = useI18n(); const toast = useToast();
  const s0 = r.settings || { access: { whitelistEnabled: false, ips: [], keys: [], accounts: [] }, bans: { ips: [], keys: [], accounts: [] }, requestedUploadKbps: null };
  const [access, setAccess] = useState(s0.access);
  const [bans, setBans] = useState(s0.bans);
  const capKbps = r.uploadLimitKbps || 0;
  const [reqMbps, setReqMbps] = useState(s0.requestedUploadKbps ? s0.requestedUploadKbps / 1024 : capKbps / 1024);
  const [busy, setBusy] = useState(false);
  const requestedKbps = Math.round(reqMbps * 1024);
  const effectiveKbps = Math.min(requestedKbps <= 0 ? capKbps : requestedKbps, capKbps);
  const addTo = (setter, field, val) => setter((s) => ({ ...s, [field]: [...new Set([...(s[field] || []), val])] }));
  const rm = (setter, field, val) => setter((s) => ({ ...s, [field]: (s[field] || []).filter((x) => x !== val) }));
  const addAccount = (setter, field, entry) => setter((s) => {
    const list = s[field] || [];
    if (list.some((a) => a.type === entry.type && a.id === entry.id)) return s;
    return { ...s, [field]: [...list, entry] };
  });
  const rmAccount = (setter, field, entry) => setter((s) => ({ ...s, [field]: (s[field] || []).filter((a) => !(a.type === entry.type && a.id === entry.id)) }));
  const save = async () => {
    setBusy(true);
    try { const res = await api.put(`/repos/${r.id}/dashboard/settings`, { access, bans, requestedUploadKbps: requestedKbps <= 0 ? null : requestedKbps }); toast.success(res.effectiveUploadKbps < requestedKbps ? t('repos.mng.capped', 'Saved — upload capped to {n} Mbps by the sandbox.').replace('{n}', (res.effectiveUploadKbps / 1024).toFixed(1)) : t('repos.mng.saved', 'Settings saved.')); reload(); }
    catch { toast.error(t('repos.mng.savefail', 'Failed to save.')); } finally { setBusy(false); }
  };
  if (!r.hosted) return <Card className="p-5 text-sm text-[var(--muted)]">{t('rd.selfhostset', 'Sandbox settings apply to hosted repos only.')}</Card>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={13} className="text-[var(--primary-2)]" /> {t('repos.sandboxed', "Sandboxed — your settings can never exceed this repo's hard limits.")}</div>
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><Globe size={13} className="text-[var(--primary-2)]" /> {t('repos.globalpolicy.note', "Staff-wide bans and (if enabled) a site-wide whitelist apply to every repo automatically, on top of what you set below.")}</div>
      <Card className="p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={access.whitelistEnabled} onChange={(e) => setAccess({ ...access, whitelistEnabled: e.target.checked })} /> {t('repos.wl', 'Whitelist-only access (only allow-listed IPs/keys/accounts can sync)')}</label>
        <ChipList label={t('repos.allowedips', 'Allowed IPs')} items={access.ips || []} onAdd={(v) => addTo(setAccess, 'ips', v)} onRemove={(v) => rm(setAccess, 'ips', v)} placeholder="203.0.113.4" />
        <ChipList label={t('repos.allowedkeys', 'Allowed keys')} items={access.keys || []} onAdd={(v) => addTo(setAccess, 'keys', v)} onRemove={(v) => rm(setAccess, 'keys', v)} placeholder="access-key…" />
        <AccountChipList label={t('repos.allowedaccounts', 'Allowed accounts')} items={access.accounts || []} onAdd={(e) => addAccount(setAccess, 'accounts', e)} onRemove={(e) => rmAccount(setAccess, 'accounts', e)} placeholder={t('repos.acct.search', 'Search creator id / Discord / username…')} />
      </Card>
      <Card className="p-4 space-y-3">
        <ChipList label={t('repos.bannedips', 'Banned IPs')} items={bans.ips || []} onAdd={(v) => addTo(setBans, 'ips', v)} onRemove={(v) => rm(setBans, 'ips', v)} placeholder="198.51.100.7" />
        <ChipList label={t('rd.bannedkeys', 'Banned keys')} items={bans.keys || []} onAdd={(v) => addTo(setBans, 'keys', v)} onRemove={(v) => rm(setBans, 'keys', v)} placeholder="key…" />
        <AccountChipList label={t('repos.bannedaccounts', 'Banned accounts')} items={bans.accounts || []} onAdd={(e) => addAccount(setBans, 'accounts', e)} onRemove={(e) => rmAccount(setBans, 'accounts', e)} placeholder={t('repos.acct.search', 'Search creator id / Discord / username…')} />
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><Zap size={14} /> {t('repos.uploadlimit', 'Upload limit')}</span><span className="font-semibold">{reqMbps >= capKbps / 1024 ? t('repos.max', 'Max') : `${reqMbps.toFixed(1)} Mbps`}</span></div>
        <input type="range" min={0.5} max={Math.max(1, capKbps / 1024)} step={0.5} value={Math.min(reqMbps, capKbps / 1024)} className="bcw-range w-full" onChange={(e) => setReqMbps(Number(e.target.value))} />
        <div className="text-xs mt-2 flex items-center gap-1.5"><Lock size={12} className="text-[var(--faint)]" /><span className="text-[var(--muted)]">{t('repos.sandboxcap', 'Sandbox cap:')} <b>{(capKbps / 1024).toFixed(1)} Mbps</b>. {t('repos.effective', 'Effective:')} <b className="text-[var(--primary-2)]">{(effectiveKbps / 1024).toFixed(1)} Mbps</b>.</span></div>
      </Card>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('repos.savesettings', 'Save settings')}</Button></div>
    </div>
  );
}

function AccessTab({ r, reload }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [emails, setEmails] = useState(r.access?.emails || []);
  const [hasPassword, setHasPassword] = useState(!!r.access?.hasPassword);
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const saveEmails = async (next) => {
    setEmails(next);
    try { await api.put(`/repos/${r.id}/dashboard/access`, { emails: next }); toast.success(t('rd.emailssaved', 'Authorized emails updated.')); }
    catch { toast.error(t('repos.failed', 'Failed.')); reload(); }
  };
  const setPassword = async () => {
    if (pw.length < 4) return toast.error(t('rd.pwshort', 'Password too short (min 4).'));
    setBusy(true);
    try { await api.put(`/repos/${r.id}/dashboard/access`, { password: pw }); setHasPassword(true); setPw(''); toast.success(t('rd.pwset', 'Dashboard password set.')); }
    catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const clearPassword = async () => {
    if (!(await dialog.confirm({ title: t('rd.pwclear.t', 'Remove password'), message: t('rd.pwclear.m', 'Anyone with the password will lose access. Continue?'), okLabel: t('rd.remove', 'Remove'), danger: true }))) return;
    try { await api.put(`/repos/${r.id}/dashboard/access`, { password: null }); setHasPassword(false); toast.success(t('rd.pwcleared', 'Password removed.')); }
    catch { toast.error(t('repos.failed', 'Failed.')); }
  };
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1"><Users size={15} className="text-[var(--primary-2)]" /> <span className="font-semibold text-sm">{t('rd.authemails', 'Authorized emails')}</span></div>
        <p className="text-xs text-[var(--muted)] mb-3">{t('rd.authemails.s', 'Logged-in users with these emails can open this dashboard and manage the repo.')}</p>
        <ChipList label={t('rd.emails', 'Emails')} items={emails} placeholder="collaborator@example.com"
          onAdd={(v) => { if (!validEmail(v)) return toast.error(t('rd.bademail', 'Enter a valid email.')); if (!emails.includes(v.toLowerCase())) saveEmails([...emails, v.toLowerCase()]); }}
          onRemove={(v) => saveEmails(emails.filter((x) => x !== v))} />
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1"><KeyRound size={15} className="text-[var(--primary-2)]" /> <span className="font-semibold text-sm">{t('rd.dashpw', 'Dashboard password')}</span> {hasPassword && <Badge tone="green"><CheckCircle2 size={10} /> {t('rd.pwon', 'Set')}</Badge>}</div>
        <p className="text-xs text-[var(--muted)] mb-3">{t('rd.dashpw.s', 'Anyone with this password can open the dashboard without an account (login-less access).')}</p>
        <div className="flex gap-2">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={hasPassword ? t('rd.changepw', 'New password…') : t('rd.setpw', 'Set a password…')} onKeyDown={(e) => e.key === 'Enter' && setPassword()} />
          <Button variant="primary" disabled={busy} onClick={setPassword}>{busy ? <Spinner /> : (hasPassword ? t('rd.change', 'Change') : t('rd.set', 'Set'))}</Button>
          {hasPassword && <Button className="!text-red-400" onClick={clearPassword}><X size={14} /> {t('rd.remove', 'Remove')}</Button>}
        </div>
      </Card>
      <div className="text-[11px] text-[var(--faint)] flex items-center gap-1.5"><ShieldCheck size={12} /> {t('rd.accessnote', 'You (the owner) and site admins always have full access. Collaborators and password holders can manage files, publishing and settings, but not access or billing.')}</div>
    </div>
  );
}
