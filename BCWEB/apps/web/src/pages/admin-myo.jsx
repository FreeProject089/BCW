import { useState, useEffect } from 'react';
import { Wand2, Search, Inbox, Package, Plus, Trash2, PenSquare, Clock, ArrowLeft, X, Archive, ArchiveRestore, UserCheck, Users, Gauge } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Select, Dropdown, Badge, Modal, Field, EmptyState, Spinner, useToast } from '../ui/ui.jsx';
import { useAsync, Loading, useUndoableDelete } from './pages.jsx';
import { useAuth } from './auth.jsx';
import { MyoConversation, fmtMoney } from './myo.jsx';

// Admin dashboard tab for the "Make Your Own" commission service: the request queue
// (each opens the shared MyoConversation with admin controls), a catalog product builder,
// and the fee settings. Gated by the `manage_myo` capability in admin.jsx.
const MYO_STATUSES = ['pending_payment', 'open', 'quoted', 'in_production', 'delivered', 'closed', 'cancelled'];
const MYO_TONE = { pending_payment: 'amber', open: 'primary', quoted: 'amber', in_production: 'blue', delivered: 'green', closed: '', cancelled: 'red' };
const MYO_KINDS = ['discord_bot', 'app', 'website', 'custom', 'audit'];

export function AdminMyo() {
  const { t } = useI18n();
  const [view, setView] = useState('requests');
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 mr-2"><Wand2 size={16} className="text-[var(--primary-2)]" /> {t('amyo.title', 'Make Your Own — commissions')}</h2>
        <div className="inline-flex rounded-[12px] bg-[var(--surface-2)] p-0.5">
          {[['requests', t('amyo.tab.requests', 'Requests')], ['products', t('amyo.tab.products', 'Catalog')], ['settings', t('amyo.tab.settings', 'Settings')]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-[10px] text-sm transition ${view === k ? 'bg-[var(--bg-solid)] text-[var(--primary)] font-medium shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {view === 'requests' && <AdminMyoRequests />}
      {view === 'products' && <AdminMyoProducts />}
      {view === 'settings' && <AdminMyoSettings />}
    </div>
  );
}

// Only a finished request can be archived, and the button says so rather than failing on
// click. The API enforces the same rule — this is the half that explains it.
const ARCHIVABLE = ['delivered', 'closed', 'cancelled'];

function AdminMyoRequests() {
  const { t } = useI18n(); const toast = useToast(); const { user: me } = useAuth();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  // Which slice of the queue. Archived is a TAB, not a checkbox buried in the filters:
  // the whole point of archiving is that the default view gets shorter.
  const [scope, setScope] = useState('active'); // active | mine | unassigned | archived
  const query = () => {
    const p = new URLSearchParams({ status: applied.status, q: applied.q });
    if (scope === 'mine') p.set('assigned', 'me');
    else if (scope === 'unassigned') p.set('assigned', 'unassigned');
    else if (scope === 'archived') p.set('archived', '1');
    return p.toString();
  };
  const { data, loading, reload } = useAsync(() => api.get(`/admin/myo/requests?${query()}`), [applied, scope]);
  const staff = useAsync(() => api.get('/admin/myo/staff'), []);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const assign = async (r, userId) => {
    setBusyId(r.id);
    try { await api.put(`/admin/myo/requests/${r.id}/assign`, { userId }); reload(); }
    catch (x) { toast.error(x.data?.error === 'not_staff' ? t('amyo.notstaff', 'That account cannot open commissions.') : t('common.failed', 'Failed.')); }
    finally { setBusyId(null); }
  };
  const setArchived = async (r, archived) => {
    setBusyId(r.id);
    try { await api.put(`/admin/myo/requests/${r.id}/archive`, { archived }); reload(); toast.success(archived ? t('amyo.archived', 'Archived.') : t('amyo.restored', 'Back in the queue.')); }
    catch (x) {
      toast.error(x.data?.error === 'still_active'
        ? t('amyo.stillactive', 'Still in progress — deliver, close or cancel it first.')
        : t('common.failed', 'Failed.'));
    } finally { setBusyId(null); }
  };

  if (openId) return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); reload(); }}><ArrowLeft size={14} /> {t('amyo.back', 'All requests')}</Button>
      <div className="mt-3"><MyoConversation id={openId} admin /></div>
    </div>
  );
  const rows = data?.requests || [];
  const counts = data?.counts || {};
  const load = data?.load; const limits = data?.limits;
  const TABS = [
    ['active', t('amyo.tab.active', 'Active'), counts.active],
    ['mine', t('amyo.tab.mine', 'Mine'), counts.mine],
    ['unassigned', t('amyo.tab.unassigned', 'Unclaimed'), counts.unassigned],
    ['archived', t('amyo.tab.archived', 'Archived'), counts.archived],
  ];
  return (
    <div>
      {/* Today's load against the caps. It lives above the queue because the number that
          decides whether to raise a limit is the one you are looking at right now. */}
      {load && (limits?.maxOpen || limits?.maxOpenUrgent) ? (
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium"><Gauge size={13} className="text-[var(--primary-2)]" /> {t('amyo.load', 'Live load')}</span>
          {!!limits.maxOpen && <span className={load.openTotal >= limits.maxOpen ? 'text-warning font-semibold' : 'text-[var(--muted)]'}>{t('amyo.load.open', 'Open')}: {load.openTotal} / {limits.maxOpen}</span>}
          {!!limits.maxOpenUrgent && <span className={load.openUrgent >= limits.maxOpenUrgent ? 'text-warning font-semibold' : 'text-[var(--muted)]'}>{t('amyo.load.urgent', 'Urgent')}: {load.openUrgent} / {limits.maxOpenUrgent}</span>}
        </Card>
      ) : null}

      <div className="inline-flex rounded-[12px] bg-[var(--surface-2)] p-0.5 mb-3">
        {TABS.map(([k, l, n]) => (
          <button key={k} onClick={() => setScope(k)} className={`px-3 py-1.5 rounded-[10px] text-sm transition ${scope === k ? 'bg-[var(--bg-solid)] text-[var(--primary)] font-medium shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {l}{typeof n === 'number' ? ` · ${n}` : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-9" placeholder={t('amyo.search', 'Search name / user / email…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied({ q, status })} /></div>
        <Dropdown value={status} onChange={setStatus} options={[{ value: '', label: t('amyo.allstatus', 'All statuses') }, ...MYO_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <Button variant="primary" onClick={() => setApplied({ q, status })}><Search size={15} /> {t('common.search', 'Search')}</Button>
      </div>

      {loading ? <Loading /> : rows.length ? <div className="space-y-2">
        {rows.map((r) => {
          const mine = r.assignedToId && r.assignedToId === me?.id;
          return (
            /* A <div>, not a <button>. The row used to BE the button, so every control
               added to it would have been a button inside a button — invalid markup, and
               in practice a claim click that also opened the conversation. */
            <div key={r.id} className="card p-3 flex items-center gap-3 hover:border-[var(--primary)]">
              <button onClick={() => setOpenId(r.id)} className="flex-1 min-w-0 text-left">
                <div className="font-medium truncate flex items-center gap-2">
                  {r.name}
                  {r.urgent && <Badge tone="amber"><Clock size={10} /> {t('myo.urgent', 'urgent')}</Badge>}
                  {r.archivedAt && <Badge><Archive size={10} /> {t('amyo.archivedbadge', 'archived')}</Badge>}
                </div>
                <div className="text-xs text-[var(--faint)] truncate">
                  {r.user?.displayName} · {r.user?.email} · {r.productKind}
                  {r.assignedTo ? ` · ${t('amyo.assignedto', 'on')} ${r.assignedTo.displayName}` : ''}
                </div>
              </button>
              {r.staffUnread && <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" title={t('amyo.new', 'New activity')} />}
              <Badge tone={MYO_TONE[r.status]}>{r.status}</Badge>

              {/* Claim in one click — the common case is taking it yourself. Handing it to
                  someone else is the dropdown beside it. */}
              {!r.archivedAt && (mine ? (
                <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => assign(r, null)} title={t('amyo.drop', 'Give it up')}>
                  <UserCheck size={13} className="text-[var(--primary)]" /> {t('amyo.mine', 'Mine')}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => assign(r, me?.id)}>
                  <UserCheck size={13} /> {t('amyo.claim', 'Claim')}
                </Button>
              ))}
              {!r.archivedAt && (staff.data?.staff || []).length > 1 && (
                <Dropdown
                  className="!w-auto"
                  value={r.assignedToId || ''}
                  onChange={(v) => assign(r, v || null)}
                  options={[{ value: '', label: t('amyo.unassigned', 'Unclaimed') }, ...(staff.data?.staff || []).map((u) => ({ value: u.id, label: u.displayName }))]}
                />
              )}

              {r.archivedAt ? (
                <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => setArchived(r, false)}>
                  <ArchiveRestore size={13} /> {t('amyo.restore', 'Restore')}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busyId === r.id || !ARCHIVABLE.includes(r.status)}
                  title={ARCHIVABLE.includes(r.status) ? t('amyo.archive', 'Archive') : t('amyo.stillactive', 'Still in progress — deliver, close or cancel it first.')}
                  onClick={() => setArchived(r, true)}>
                  <Archive size={13} />
                </Button>
              )}
            </div>
          );
        })}
      </div> : <EmptyState icon={scope === 'archived' ? Archive : Inbox}
        title={scope === 'archived' ? t('amyo.noarch.t', 'Nothing archived') : t('amyo.none.t', 'No requests yet')}
        sub={scope === 'archived' ? t('amyo.noarch.s', 'Finished requests you archive end up here.') : t('amyo.none.s', 'Paid consultations will show up here.')} />}
    </div>
  );
}

function AdminMyoProducts() {
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/myo/products'), []);
  const undo = useUndoableDelete(reload);
  const [editing, setEditing] = useState(null);
  const rows = (data?.products || []).filter((p) => !undo.pending.has(p.id));
  // Undoable — no confirm dialog; the 6s Undo window is the safety net.
  const del = (p) => undo.del(p.id, () => api.del(`/admin/myo/products/${p.id}`), t('amyo.p.deleted', 'Product removed.'));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-sm text-[var(--muted)] flex-1 min-w-[220px]">{t('amyo.p.sub', 'The cards shown on /myo. Prices here are display-only "from" signals — the binding price is your per-request quote.')}</p>
        <Button size="sm" variant="primary" onClick={() => setEditing({})}><Plus size={14} /> {t('amyo.p.new', 'New product')}</Button>
      </div>
      {loading ? <Loading /> : rows.length ? <div className="space-y-2">
        {rows.map((p) => (
          <Card key={p.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="font-medium truncate flex items-center gap-2">{p.name} <Badge>{p.kind}</Badge>{!p.active && <Badge tone="amber">{t('amyo.p.hidden', 'hidden')}</Badge>}{p.featured && <Badge tone="primary">{t('amyo.p.featured', 'featured')}</Badge>}</div><div className="text-xs text-[var(--faint)] truncate">{p.basePriceCents > 0 ? `from ${fmtMoney(p.basePriceCents)} · ` : ''}{p.includesSource ? t('myo.src.with', 'source included') : t('myo.src.without', 'no source')}</div></div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><PenSquare size={13} /></Button>
            <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(p)}><Trash2 size={13} /></Button>
          </Card>
        ))}
      </div> : <EmptyState icon={Package} title={t('amyo.p.none', 'No catalog products')} sub={t('amyo.p.nonesub', 'The 3 base options (bot / app / website) always show; add products to customise them or offer more.')} />}
      {editing && <MyoProductModal product={editing.id ? editing : null} onClose={() => setEditing(null)} onDone={reload} />}
    </div>
  );
}

function MyoProductModal({ product, onClose, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState({ kind: product?.kind || 'discord_bot', name: product?.name || '', tagline: product?.tagline || '', description: product?.description || '', icon: product?.icon || '', basePrice: product ? (product.basePriceCents / 100).toString() : '', includesSource: product?.includesSource ?? true, active: product?.active ?? true, featured: product?.featured ?? false, order: product?.order ?? 0 });
  const [options, setOptions] = useState(product?.options?.length ? product.options.map((o) => ({ label: o.label, price: (o.priceCents / 100).toString(), note: o.note || '' })) : []);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error(t('amyo.p.namereq', 'Name is required.'));
    setBusy(true);
    const body = { kind: f.kind, name: f.name.trim(), tagline: f.tagline.trim(), description: f.description.trim(), icon: f.icon.trim() || null, basePriceCents: Math.round((parseFloat(f.basePrice) || 0) * 100), includesSource: f.includesSource, active: f.active, featured: f.featured, order: parseInt(f.order) || 0, options: options.map((o) => ({ label: o.label.trim(), priceCents: Math.round((parseFloat(o.price) || 0) * 100), note: o.note.trim() || undefined })).filter((o) => o.label) };
    try { if (product) await api.put(`/admin/myo/products/${product.id}`, body); else await api.post('/admin/myo/products', body); toast.success(t('common.saved', 'Saved.')); onClose(); onDone(); }
    catch { toast.error(t('common.savefail', 'Save failed.')); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={product ? t('amyo.p.edit', 'Edit product') : t('amyo.p.new', 'New product')} icon={Wand2} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[150px_1fr] gap-3">
          <Field label={t('amyo.p.kind', 'Kind')}><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{MYO_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
          <Field label={t('amyo.p.name', 'Name')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        </div>
        <Field label={t('amyo.p.tagline', 'Tagline')}><Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={200} /></Field>
        <Field label={t('amyo.p.desc', 'Description')}><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('amyo.p.from', 'From price ($)')}><Input type="number" step="0.01" value={f.basePrice} onChange={(e) => set('basePrice', e.target.value)} placeholder="0" /></Field>
          <Field label={t('amyo.p.icon', 'Icon')}><Input value={f.icon} onChange={(e) => set('icon', e.target.value)} placeholder="lucide/url" /></Field>
          <Field label={t('amyo.p.order', 'Order')}><Input type="number" value={f.order} onChange={(e) => set('order', e.target.value)} /></Field>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('amyo.p.options', 'Card options (display)')}</div>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input className="flex-1" value={o.label} onChange={(e) => setOptions((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={t('amyo.p.optlabel', 'Option')} />
                <Input className="!w-24" type="number" step="0.01" value={o.price} onChange={(e) => setOptions((s) => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="+$" />
                <button onClick={() => setOptions((s) => s.filter((_, j) => j !== i))} className="text-[var(--faint)] hover:text-error px-1"><X size={15} /></button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOptions((s) => [...s, { label: '', price: '', note: '' }])}><Plus size={13} /> {t('amyo.p.addopt', 'Add option')}</Button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.includesSource} onChange={(e) => set('includesSource', e.target.checked)} /> {t('amyo.p.src', 'Usually includes source')}</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> {t('amyo.p.active', 'Active')}</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.featured} onChange={(e) => set('featured', e.target.checked)} /> {t('amyo.p.feat', 'Featured')}</label>
        </div>
      </div>
    </Modal>
  );
}

function AdminMyoSettings() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/myo/settings'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ enabled: data.enabled, consultation: (data.consultationCents / 100).toString(), urgent: (data.urgentConsultationCents / 100).toString(), currency: data.currency, maxOpen: String(data.maxOpen ?? 0), maxOpenUrgent: String(data.maxOpenUrgent ?? 0), maxOpenPerUser: String(data.maxOpenPerUser ?? 0) }); }, [data]);
  if (loading || !f) return <Loading />;
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/myo/settings', {
        enabled: f.enabled,
        consultationCents: Math.round((parseFloat(f.consultation) || 0) * 100),
        urgentConsultationCents: Math.round((parseFloat(f.urgent) || 0) * 100),
        currency: f.currency.trim().toLowerCase() || 'usd',
        maxOpen: Math.max(0, parseInt(f.maxOpen, 10) || 0),
        maxOpenUrgent: Math.max(0, parseInt(f.maxOpenUrgent, 10) || 0),
        maxOpenPerUser: Math.max(0, parseInt(f.maxOpenPerUser, 10) || 0),
      });
      toast.success(t('common.saved', 'Saved.')); reload();
    }
    catch { toast.error(t('common.savefail', 'Save failed.')); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 space-y-4 max-w-lg">
      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={f.enabled} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} /><span><span className="font-medium">{t('amyo.s.enabled', 'Accept new requests')}</span><span className="block text-xs text-[var(--faint)]">{t('amyo.s.enabledsub', 'When off, /myo shows a "closed" message and no new requests can be started.')}</span></span></label>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('amyo.s.fee', 'Consultation fee ($)')}><Input type="number" step="0.01" value={f.consultation} onChange={(e) => setF((s) => ({ ...s, consultation: e.target.value }))} /></Field>
        <Field label={t('amyo.s.urgent', 'Urgent fee ($)')}><Input type="number" step="0.01" value={f.urgent} onChange={(e) => setF((s) => ({ ...s, urgent: e.target.value }))} /></Field>
      </div>
      <Field label={t('amyo.s.currency', 'Currency')}><Input className="!w-28" value={f.currency} onChange={(e) => setF((s) => ({ ...s, currency: e.target.value }))} maxLength={8} /></Field>

      {/* Capacity, not pricing. Commissions are work done by people, and a form that keeps
          accepting urgent jobs after the team is full sells a promise nobody can keep.
          Each limit shows what it is currently holding, because a cap set without seeing
          today's number is a guess you find out about through a complaint. */}
      <div className="pt-3 border-t border-[var(--line)]">
        <div className="flex items-center gap-2 text-sm font-medium"><Users size={14} className="text-[var(--primary-2)]" /> {t('amyo.s.caps', 'How much you take on at once')}</div>
        <p className="text-xs text-[var(--faint)] mt-1 mb-3">{t('amyo.s.capssub', 'When a limit is reached the form refuses new requests — before the payment, never after. 0 means no limit.')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('amyo.s.maxurgent', 'Urgent at once')} hint={data?.load ? t('amyo.s.now', 'now: {n}').replace('{n}', data.load.openUrgent) : undefined}>
            <Input type="number" min="0" value={f.maxOpenUrgent} onChange={(e) => setF((s) => ({ ...s, maxOpenUrgent: e.target.value }))} />
          </Field>
          <Field label={t('amyo.s.maxopen', 'Open requests at once')} hint={data?.load ? t('amyo.s.now', 'now: {n}').replace('{n}', data.load.openTotal) : undefined}>
            <Input type="number" min="0" value={f.maxOpen} onChange={(e) => setF((s) => ({ ...s, maxOpen: e.target.value }))} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label={t('amyo.s.maxuser', 'Open requests per customer')} hint={t('amyo.s.maxuser.h', 'Counts their unpaid ones too — otherwise one person can hold the last slot for free.')}>
            <Input type="number" min="0" className="!w-32" value={f.maxOpenPerUser} onChange={(e) => setF((s) => ({ ...s, maxOpenPerUser: e.target.value }))} />
          </Field>
        </div>
      </div>

      <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button>
    </Card>
  );
}
