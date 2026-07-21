import { useState, useEffect } from 'react';
import { Wand2, Search, Inbox, Package, Plus, Trash2, PenSquare, Clock, ArrowLeft, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Select, Dropdown, Badge, Modal, Field, EmptyState, Spinner, useToast } from '../ui/ui.jsx';
import { useAsync, Loading, useUndoableDelete } from './pages.jsx';
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

function AdminMyoRequests() {
  const { t } = useI18n();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const { data, loading, reload } = useAsync(() => api.get(`/admin/myo/requests?status=${encodeURIComponent(applied.status)}&q=${encodeURIComponent(applied.q)}`), [applied]);
  const [openId, setOpenId] = useState(null);
  if (openId) return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); reload(); }}><ArrowLeft size={14} /> {t('amyo.back', 'All requests')}</Button>
      <div className="mt-3"><MyoConversation id={openId} admin /></div>
    </div>
  );
  const rows = data?.requests || [];
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-9" placeholder={t('amyo.search', 'Search name / user / email…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied({ q, status })} /></div>
        <Dropdown value={status} onChange={setStatus} options={[{ value: '', label: t('amyo.allstatus', 'All statuses') }, ...MYO_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <Button variant="primary" onClick={() => setApplied({ q, status })}><Search size={15} /> {t('common.search', 'Search')}</Button>
      </div>
      {loading ? <Loading /> : rows.length ? <div className="space-y-2">
        {rows.map((r) => (
          <button key={r.id} onClick={() => setOpenId(r.id)} className="w-full text-left card p-3 flex items-center gap-3 hover:border-[var(--primary)]">
            <div className="flex-1 min-w-0"><div className="font-medium truncate flex items-center gap-2">{r.name} {r.urgent && <Badge tone="amber"><Clock size={10} /> {t('myo.urgent', 'urgent')}</Badge>}</div><div className="text-xs text-[var(--faint)] truncate">{r.user?.displayName} · {r.user?.email} · {r.productKind}</div></div>
            {r.staffUnread && <span className="w-2 h-2 rounded-full bg-[var(--primary)]" title={t('amyo.new', 'New activity')} />}
            <Badge tone={MYO_TONE[r.status]}>{r.status}</Badge>
          </button>
        ))}
      </div> : <EmptyState icon={Inbox} title={t('amyo.none.t', 'No requests yet')} sub={t('amyo.none.s', 'Paid consultations will show up here.')} />}
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
            <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => del(p)}><Trash2 size={13} /></Button>
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
                <button onClick={() => setOptions((s) => s.filter((_, j) => j !== i))} className="text-[var(--faint)] hover:text-red-400 px-1"><X size={15} /></button>
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
  useEffect(() => { if (data) setF({ enabled: data.enabled, consultation: (data.consultationCents / 100).toString(), urgent: (data.urgentConsultationCents / 100).toString(), currency: data.currency }); }, [data]);
  if (loading || !f) return <Loading />;
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/myo/settings', { enabled: f.enabled, consultationCents: Math.round((parseFloat(f.consultation) || 0) * 100), urgentConsultationCents: Math.round((parseFloat(f.urgent) || 0) * 100), currency: f.currency.trim().toLowerCase() || 'usd' }); toast.success(t('common.saved', 'Saved.')); reload(); }
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
      <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button>
    </Card>
  );
}
