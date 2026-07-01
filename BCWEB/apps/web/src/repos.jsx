import { useEffect, useState } from 'react';
import {
  Server, GitBranch, Star, Plus, Pencil, Trash2, UploadCloud, Eye, EyeOff, CheckCircle2,
  XCircle, Clock, ShieldCheck, ExternalLink, Tag, Users, HardDrive, Settings2, Receipt, Printer, Rocket,
  Files, FileText, FileJson, FolderUp,
} from 'lucide-react';
import { api, uploadRepoFile } from './api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal } from './ui.jsx';

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, loading, reload };
}
const gb = (n) => (Number(n) / 1024 ** 3).toFixed(1);

/* ── Public list ── */
export function ReposPage() {
  const { data, loading } = useFetch(() => api.get('/repos'), []);
  const repos = data?.repos || [];
  return (
    <div>
      <PageHeader icon={Server} title="Server Repos" subtitle="Community repositories — featured ones first." />
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>
        : repos.length ? (
          <div className="grid md:grid-cols-2 gap-4">
            {repos.map((r) => (
              <Card key={r.id} className={`p-5 ${r.featured ? 'border-[var(--ring)]' : ''}`} style={r.featured ? { boxShadow: '0 0 0 1px var(--primary), 0 16px 40px -18px var(--primary-glow)' } : undefined}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2"><GitBranch size={16} className="text-[var(--primary-2)]" /> {r.name}</div>
                  <div className="flex items-center gap-1.5">
                    {r.featured && <Badge tone="amber"><Star size={11} /> Featured</Badge>}
                    {r.hosted && <Badge tone="green">{r.status}</Badge>}
                  </div>
                </div>
                <div className="text-xs text-[var(--faint)] mt-1 flex items-center gap-1"><Users size={12} /> {r.owner?.displayName}</div>
                {r.description && <p className="text-sm text-[var(--muted)] mt-2 line-clamp-2">{r.description}</p>}
                {r.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{r.tags.map((t) => <Badge key={t}><Tag size={10} /> {t}</Badge>)}</div>}
                {r.hosted && <div className="text-xs text-[var(--faint)] mt-2">{gb(r.storageUsedBytes)} / {gb(r.storageQuotaBytes)} GB</div>}
                <div className="flex gap-2 mt-3">
                  <a href={`bmm://server-repo/add?url=${encodeURIComponent(r.repoUrl || r.publicUrl || '')}`}><Button size="sm" variant="primary"><GitBranch size={13} /> Open in BMM</Button></a>
                  {(r.repoUrl || r.publicUrl) && <a href={r.repoUrl || r.publicUrl} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={13} /> Source</Button></a>}
                </div>
              </Card>
            ))}
          </div>
        ) : <EmptyState icon={Server} title="No repos listed yet" />}
    </div>
  );
}

function StatusBadges({ r }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.hosted && <Badge tone="primary">Hosted</Badge>}
      {r.listed ? <Badge tone="green"><Eye size={10} /> Listed</Badge> : <Badge><EyeOff size={10} /> Unlisted</Badge>}
      {r.pendingReview ? <Badge tone="amber"><Clock size={10} /> Pending review</Badge>
        : r.verified ? <Badge tone="green"><CheckCircle2 size={10} /> Verified</Badge> : <Badge><XCircle size={10} /> Unverified</Badge>}
    </div>
  );
}

/* ── User: my repos (dashboard section) ── */
export function MyRepos() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useFetch(() => api.get('/me/repos'), []);
  const [editing, setEditing] = useState(null);
  const [featuring, setFeaturing] = useState(null);
  const [managing, setManaging] = useState(null);
  const repos = data?.repos || [];
  const isFeatured = (r) => r.featuredUntil && new Date(r.featuredUntil) > new Date();

  const push = async (r) => {
    const sha = await dialog.prompt({ title: 'Push update', label: 'Content SHA (40 or 64 hex)', placeholder: 'a1b2c3…' });
    if (!sha) return;
    try { const res = await api.post(`/repos/${r.id}/push`, { sha }); toast.success(res.pendingReview ? 'Pushed — awaiting verification.' : 'Pushed.'); reload(); }
    catch (x) { toast.error(x.data?.error === 'invalid_sha' ? 'Invalid SHA.' : 'Failed.'); }
  };
  const toggleList = async (r) => {
    try { await api.post(`/repos/${r.id}/list`, { listed: !r.listed }); toast.success(!r.listed ? 'Listed — pending verification.' : 'Unlisted.'); reload(); }
    catch (x) { toast.error(x.data?.error === 'sha_required' ? 'Push a valid SHA before listing.' : 'Failed.'); }
  };
  const del = async (r) => { if (!(await dialog.confirm({ title: 'Delete repo', message: `Delete "${r.name}"?`, okLabel: 'Delete', danger: true }))) return; try { await api.del(`/repos/${r.id}`); toast.success('Deleted.'); reload(); } catch { toast.error('Failed.'); } };
  const check = async (r) => { try { const res = await api.post(`/repos/${r.id}/check`); toast[res.status === 'ONLINE' ? 'success' : 'error'](res.status === 'ONLINE' ? 'Online & reachable.' : `Offline (${res.reason || 'unreachable'}).`); reload(); } catch { toast.error('Check failed.'); } };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Server size={16} /> My Server Repos</h2>
        <Button size="sm" variant="primary" onClick={() => setEditing({})}><Plus size={15} /> Add repo</Button>
      </div>
      {loading ? <div className="text-[var(--muted)] text-sm py-4">Loading…</div>
        : repos.length ? <div className="space-y-2">
          {repos.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <GitBranch size={18} className="text-[var(--primary-2)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.description && <div className="text-sm text-[var(--muted)] line-clamp-1">{r.description}</div>}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Badge tone={r.status === 'ONLINE' ? 'green' : 'red'}>{r.status === 'ONLINE' ? '● Online' : '● Offline'}</Badge>
                    <StatusBadges r={r} />{isFeatured(r) && <Badge tone="amber"><Star size={10} /> Featured until {new Date(r.featuredUntil).toLocaleDateString()}</Badge>}</div>
                  {r.sha && <div className="text-xs text-[var(--faint)] mt-1.5 font-mono">sha {r.sha.slice(0, 12)}…</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={() => push(r)}><UploadCloud size={14} /> Push</Button>
                <Button size="sm" onClick={() => check(r)}><CheckCircle2 size={14} /> Check</Button>
                <Button size="sm" onClick={() => toggleList(r)}>{r.listed ? <><EyeOff size={14} /> Unlist</> : <><Eye size={14} /> List publicly</>}</Button>
                {r.hosted && <Button size="sm" onClick={() => setManaging(r)}><Files size={14} /> Files</Button>}
                <Button size="sm" variant="primary" onClick={() => setFeaturing(r)}><Rocket size={14} /> {isFeatured(r) ? 'Extend boost' : 'Boost'}</Button>
                <Button size="sm" onClick={() => setEditing(r)}><Pencil size={14} /> Edit</Button>
                <Button size="sm" className="!text-red-400" onClick={() => del(r)}><Trash2 size={14} /></Button>
              </div>
            </Card>
          ))}
        </div> : <EmptyState icon={Server} title="No repos yet" sub="Add a repo to list it publicly, or host one from the Hosting page." />}
      {editing !== null && <RepoEditor repo={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {featuring && <FeatureModal repo={featuring} onClose={() => setFeaturing(null)} />}
      {managing && <HostFilesModal repo={managing} onClose={() => setManaging(null)} onChanged={reload} />}
    </div>
  );
}

function FeatureModal({ repo, onClose }) {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [price, setPrice] = useState(null);
  useEffect(() => { api.get(`/hosting/feature-price?days=${days}`).then((r) => setPrice(r.priceCents)).catch(() => setPrice(null)); }, [days]);
  const buy = async () => {
    try { const { url } = await api.post(`/repos/${repo.id}/feature/checkout`, { days }); window.location = url; }
    catch (x) { toast.error(x.data?.error === 'stripe_not_configured' ? 'Payments not configured yet.' : 'Checkout failed.'); }
  };
  return (
    <Modal open onClose={onClose} title={`Boost "${repo.name}"`} icon={Rocket} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={buy}>Continue to payment</Button></>}>
      <p className="text-sm text-[var(--muted)] mb-4">Featured repos float to the top of the public list. Pick a duration — at the end, your repo returns to its normal position.</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`p-3 rounded-xl border text-center ${days === d ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
            <div className="text-lg font-bold">{d}</div><div className="text-xs text-[var(--muted)]">days</div>
          </button>
        ))}
      </div>
      <div className="flex items-end justify-between pt-3 border-t border-[var(--line)]">
        <span className="text-sm text-[var(--muted)]">Total</span>
        <span className="text-2xl font-bold gradient-text">{price == null ? '—' : `$${(price / 100).toFixed(2)}`}</span>
      </div>
    </Modal>
  );
}

/* ── Billing / invoices (dashboard) ── */
export function Billing() {
  const { data, loading } = useFetch(() => api.get('/me/payments'), []);
  const [invoice, setInvoice] = useState(null);
  const payments = data?.payments || [];
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> Billing &amp; invoices</h2>
      {loading ? <div className="text-[var(--muted)] text-sm py-3">Loading…</div>
        : payments.length ? <Card className="overflow-hidden p-0">
          {payments.map((pay, i) => (
            <div key={pay.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${i ? 'border-t border-[var(--line)]' : ''}`}>
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{pay.description}</div><div className="text-xs text-[var(--faint)]">{new Date(pay.createdAt).toLocaleString()}</div></div>
              <Badge tone={pay.status === 'paid' ? 'green' : ''}>{pay.status}</Badge>
              <span className="font-semibold w-16 text-right">${(pay.amountCents / 100).toFixed(2)}</span>
              <Button size="sm" onClick={() => setInvoice(pay.id)}><Receipt size={13} /> Invoice</Button>
            </div>
          ))}
        </Card> : <EmptyState icon={Receipt} title="No payments yet" sub="Boost a repo or host one — invoices appear here." />}
      {invoice && <InvoiceModal id={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}

function InvoiceModal({ id, onClose }) {
  const { data, loading } = useFetch(() => api.get(`/me/payments/${id}`), [id]);
  const inv = data?.invoice;
  return (
    <Modal open onClose={onClose} title="Invoice" icon={Receipt} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</Button></>}>
      {loading || !inv ? <div className="text-[var(--muted)] text-sm">Loading…</div> : (
        <div className="text-sm" id="invoice-print">
          <div className="flex items-center justify-between mb-4"><div className="font-extrabold text-lg gradient-text">BetterCommunity</div><div className="text-right"><div className="font-mono text-xs text-[var(--faint)]">{inv.number}</div><div className="text-xs text-[var(--muted)]">{new Date(inv.createdAt).toLocaleDateString()}</div></div></div>
          <div className="text-[var(--muted)] mb-4">Billed to <b className="text-[var(--text)]">{inv.user?.displayName}</b> ({inv.user?.email})</div>
          <div className="flex justify-between py-2 border-y border-[var(--line)]"><span>{inv.description}</span><span className="font-semibold">${(inv.amountCents / 100).toFixed(2)}</span></div>
          <div className="flex justify-between py-3 font-bold"><span>Total ({inv.currency.toUpperCase()})</span><span>${(inv.amountCents / 100).toFixed(2)}</span></div>
          <div className="text-xs text-[var(--faint)] mt-2">Status: {inv.status} · Thank you!</div>
        </div>
      )}
    </Modal>
  );
}

function RepoEditor({ repo, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', description: '', repoUrl: '', tags: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (repo) setF({ name: repo.name, description: repo.description || '', repoUrl: repo.repoUrl || '', tags: (repo.tags || []).join(', ') }); }, [repo]);
  const save = async () => {
    if (f.name.length < 2) return toast.error('Name too short.');
    setBusy(true);
    const body = { name: f.name, description: f.description, repoUrl: f.repoUrl || undefined, tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean) };
    try { if (repo) await api.patch(`/repos/${repo.id}`, body); else await api.post('/repos', body); toast.success(repo ? 'Saved.' : 'Repo added.'); onSaved(); }
    catch (x) { toast.error(x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={repo ? 'Edit repo' : 'Add a repo'} icon={GitBranch} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (repo ? 'Save' : 'Add')}</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="My mods repo" /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What's in it?" /></Field>
        <Field label="Repo URL" hint="The public source / browse URL."><Input value={f.repoUrl} onChange={(e) => setF({ ...f, repoUrl: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Tags" hint="Comma-separated."><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="aircraft, sound" /></Field>
        <p className="text-xs text-[var(--faint)]">After adding, use <b>Push</b> to set a valid content SHA, then <b>List publicly</b> — listing requires admin verification.</p>
      </div>
    </Modal>
  );
}

// Hosted-repo content manager (user uploads / admin review). Files are never executed.
function HostFilesModal({ repo, admin, onClose, onChanged }) {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useFetch(() => api.get(`/repos/${repo.id}/files`), [repo.id]);
  const [busy, setBusy] = useState(false);
  const d = data || {}; const files = d.files || [];
  const mb = (n) => (Number(n) / 1024 / 1024).toFixed(1);
  const pct = d.quota ? Math.min(100, (d.used / d.quota) * 100) : 0;
  const upload = async (list) => {
    setBusy(true);
    for (const f of list) { try { await uploadRepoFile(repo.id, f); } catch (x) { toast.error(x.data?.error === 'quota_exceeded' ? `${f.name}: quota exceeded` : `${f.name}: upload failed`); } }
    setBusy(false); reload(); onChanged?.();
  };
  const del = async (f) => { try { await api.del(`/repos/${repo.id}/files/${f.id}`); reload(); onChanged?.(); } catch { toast.error('Failed.'); } };
  const publish = async () => { try { const r = await api.post(`/admin/repos/${repo.id}/publish`); toast.success(`Published → /hosting/${r.hostPath}/repo.json`); reload(); onChanged?.(); } catch (x) { toast.error(x.data?.error === 'no_repo_json' ? 'A repo.json must be uploaded first.' : 'Failed.'); } };
  const unpublish = async () => { try { await api.post(`/admin/repos/${repo.id}/unpublish`); reload(); onChanged?.(); } catch {} };
  return (
    <Modal open onClose={onClose} title={`${admin ? 'Review content' : 'Manage files'} — ${repo.name}`} icon={Files} width="max-w-2xl"
      footer={admin
        ? <><Button variant="ghost" onClick={onClose}>Close</Button>{d.published ? <Button onClick={unpublish}><EyeOff size={15} /> Unpublish</Button> : <Button variant="primary" onClick={publish}><CheckCircle2 size={15} /> Validate & publish</Button>}</>
        : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="flex items-center gap-3 text-sm mb-3">
        <HardDrive size={16} className="text-[var(--primary-2)]" />
        <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} /></div>
        <span className="text-[var(--muted)] whitespace-nowrap">{mb(d.used || 0)} / {mb(d.quota || 0)} MB</span>
      </div>
      {d.published && d.repoJson && <div className="text-xs text-emerald-400 mb-3 flex items-center gap-1"><CheckCircle2 size={13} /> Published — repo.json is live.</div>}

      {!admin && <label className="block mb-3"><div className="text-xs text-[var(--muted)] mb-1.5">Upload files (incl. a <code>repo.json</code>)</div>
        <input type="file" multiple className="input" disabled={busy} onChange={(e) => upload([...e.target.files])} /></label>}

      {loading ? <div className="text-sm text-[var(--muted)] py-3">Loading…</div> : (
        <div className="space-y-1.5 max-h-[40vh] overflow-auto">
          {files.length ? files.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
              {f.path === 'repo.json' ? <FileJson size={15} className="text-[var(--primary-2)]" /> : <FileText size={15} className="text-[var(--faint)]" />}
              <span className="flex-1 truncate font-mono text-xs">{f.path}</span>
              <span className="text-xs text-[var(--faint)]">{mb(f.size)} MB</span>
              {!admin && <button className="text-[var(--faint)] hover:text-red-400" onClick={() => del(f)}><Trash2 size={14} /></button>}
            </div>
          )) : <div className="text-sm text-[var(--faint)] py-2">No files yet.</div>}
        </div>
      )}

      {admin && d.repoJson && <div className="mt-4"><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">repo.json (preview — never executed)</div>
        <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-52 overflow-auto">{JSON.stringify(d.repoJson, null, 2)}</pre></div>}
    </Modal>
  );
}

/* ── Admin: all repos ── */
export function AdminRepos() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useFetch(() => api.get('/admin/repos'), []);
  const [review, setReview] = useState(null);
  const repos = data?.repos || [];
  const pending = repos.filter((r) => r.pendingReview).length;
  const verify = async (r) => { try { await api.post(`/admin/repos/${r.id}/verify`); toast.success(`Verified "${r.name}".`); reload(); } catch { toast.error('Failed.'); } };
  const reject = async (r) => { const reason = await dialog.prompt({ title: 'Reject / unlist', label: 'Reason (sent to owner)', okLabel: 'Reject', danger: true }); if (!reason) return; try { await api.post(`/admin/repos/${r.id}/reject`, { reason }); toast.success('Rejected.'); reload(); } catch { toast.error('Failed.'); } };
  const setStatus = async (r, status) => { try { await api.patch(`/admin/repos/${r.id}`, { status }); reload(); } catch { toast.error('Failed.'); } };
  const limits = async (r) => {
    const storageGB = await dialog.prompt({ title: 'Storage quota', label: 'GB', defaultValue: String(gb(r.storageQuotaBytes)) }); if (storageGB === false) return;
    const uploadLimitKbps = await dialog.prompt({ title: 'Upload limit', label: 'kbps', defaultValue: String(r.uploadLimitKbps) }); if (uploadLimitKbps === false) return;
    try { await api.patch(`/admin/repos/${r.id}`, { storageGB: Number(storageGB), uploadLimitKbps: Number(uploadLimitKbps) }); toast.success('Limits set.'); reload(); } catch { toast.error('Failed.'); }
  };
  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Server size={16} className="text-[var(--primary-2)]" /> Server Repos</h2>
        {pending > 0 && <Badge tone="amber"><Clock size={11} /> {pending} pending review</Badge>}
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
                </div>
                <Select className="!w-auto !py-1.5 text-xs" value={r.status} onChange={(e) => setStatus(r, e.target.value)}>
                  {['ONLINE', 'OFFLINE', 'SUSPENDED', 'PROVISIONING'].map((s) => <option key={s}>{s}</option>)}
                </Select>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {r.pendingReview && <Button size="sm" variant="primary" onClick={() => verify(r)}><ShieldCheck size={14} /> Verify</Button>}
                {r.hosted && <Button size="sm" onClick={() => setReview(r)}><Files size={14} /> Review content</Button>}
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
