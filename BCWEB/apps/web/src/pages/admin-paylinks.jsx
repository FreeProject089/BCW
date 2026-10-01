// agent-bcw-pools: Admin > Money > Payment links.
//
// A link sells ONE thing, to a limited number of accounts: a storage pool (optionally for a
// project), early access to a pre-release, or a plain payment with its receipt. The price is
// the usual hosting tariff (pools) or an amount typed here; one payment or monthly. The member
// opens /pay/<token>, pays through Stripe, and the webhook provisions (routes/paylinks.mjs,
// lib/paylinks.mjs). Revoking stops new payments; what was paid for stays delivered.
import { useEffect, useState } from 'react';
import { Link as LinkIcon, Plus, Copy, Ban, RotateCcw, Receipt, HardDrive, FlaskConical, CreditCard } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, Explain, EmptyState, Spinner, Modal, useToast } from '../ui/ui.jsx';

const money = (c, cur = 'usd') => `${(Number(c || 0) / 100).toFixed(2)} ${String(cur).toUpperCase()}`;
const KIND_ICON = { pool: HardDrive, prerelease: FlaskConical, custom: Receipt };
const blank = () => ({ kind: 'pool', title: '', description: '', storageGB: 50, uploadMbps: 8, months: 1, projectRef: '', prereleaseId: '', priceMode: 'auto', amount: '', currency: 'usd', interval: 'once', maxUses: '1', onlyEmail: '', expires: '' });

function useKindLabel() {
  const { t } = useI18n();
  return (k) => ({ pool: t('apl.k.pool', 'Storage pool'), prerelease: t('apl.k.pre', 'Early access'), custom: t('apl.k.custom', 'Payment only') })[k] || k;
}

function bodyOf(f) {
  const out = {
    title: f.title.trim(), description: f.description, kind: f.kind, priceMode: f.kind === 'pool' ? f.priceMode : 'custom',
    currency: f.currency, interval: f.kind === 'prerelease' ? 'once' : f.interval,
    maxUses: f.maxUses === '' ? null : Number(f.maxUses),
    ...(f.onlyEmail.trim() ? { onlyEmail: f.onlyEmail.trim() } : {}),
    ...(f.expires ? { expiresAt: new Date(`${f.expires}T23:59:59`).toISOString() } : {}),
  };
  if (out.priceMode === 'custom') out.amountCents = Math.round(Number(f.amount || 0) * 100);
  if (f.kind === 'pool') out.pool = { storageGB: Number(f.storageGB), uploadMbps: Number(f.uploadMbps) || 8, months: Number(f.months) || 1, projectRef: f.projectRef || null };
  if (f.kind === 'prerelease') out.prereleaseId = f.prereleaseId;
  return out;
}

function CreateLink({ onClose, onCreated }) {
  const { t } = useI18n();
  const toast = useToast();
  const kindLabel = useKindLabel();
  const [f, setF] = useState(blank);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const projects = useAsync(() => api.get('/admin/hosting/project-pools').catch(() => ({ projects: [] })), []);
  const pres = useAsync(() => api.get('/prerelease-manage').catch(() => ({ prereleases: [] })), []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // The tariff for these specs, asked of the server (the Hosting page's own formula).
  useEffect(() => {
    if (f.kind !== 'pool') { setQuote(null); return undefined; }
    let alive = true;
    api.post('/admin/hosting/paylinks/quote', { kind: 'pool', interval: f.interval, pool: { storageGB: Number(f.storageGB) || 1, uploadMbps: Number(f.uploadMbps) || 8, months: Number(f.months) || 1 } })
      .then((r) => { if (alive) setQuote(r); }).catch(() => { if (alive) setQuote(null); });
    return () => { alive = false; };
  }, [f.kind, f.storageGB, f.uploadMbps, f.months, f.interval]);
  const errText = (code) => ({
    amount_required: t('apl.err.amount', 'Set a price of at least 0.50.'), pool_specs_required: t('apl.err.pool', 'Say how big the pool is.'),
    prerelease_required: t('apl.err.pre', 'Pick the pre-release.'), unknown_project: t('apl.err.project', 'That project no longer exists.'),
    prerelease_closed: t('apl.err.closed', 'That pre-release has ended.'), invalid_email: t('apl.err.email', 'That e-mail address is not valid.'),
  })[code] || t('common.failed', 'Failed.');
  const create = async () => {
    setBusy(true);
    try { const r = await api.post('/admin/hosting/paylinks', bodyOf(f)); toast.success(t('apl.created', 'Link created. Copy it and send it.')); onCreated(r.link); }
    catch (x) { toast.error(errText(x?.data?.error)); }
    finally { setBusy(false); }
  };
  const price = f.kind === 'pool' && f.priceMode === 'auto' ? quote?.amountCents : Math.round(Number(f.amount || 0) * 100);
  const valid = f.title.trim().length >= 2 && (f.kind !== 'prerelease' || f.prereleaseId) && (price >= 50);
  return (
    <Modal open onClose={onClose} title={t('apl.new', 'New payment link')} icon={LinkIcon} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={!valid || busy} onClick={create}>{busy ? <Spinner /> : <Plus size={14} />} {t('apl.create', 'Create the link')}</Button></>}>
      <div className="space-y-4" data-testid="apl-create">
        <fieldset>
          <legend className="text-sm font-medium mb-1.5">{t('apl.what', 'What it sells')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {['pool', 'prerelease', 'custom'].map((k) => {
              const I = KIND_ICON[k];
              return (
                <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => set('kind', k)}
                  className={`text-start rounded-lg border p-2.5 text-sm transition min-w-0 flex items-center gap-2 ${f.kind === k ? 'border-[var(--primary)] tint-primary' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                  <I size={14} className="text-[var(--accent-ink)] shrink-0" aria-hidden /> <span className="truncate">{kindLabel(k)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field label={t('apl.f.title', 'Title the payer sees')}><Input value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder={t('apl.f.title.ph', '50 GB pool for the BSM team')} /></Field>

        {f.kind === 'pool' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('apl.f.gb', 'Size (GB)')}><Input type="number" min={0.1} step="any" value={f.storageGB} onChange={(e) => set('storageGB', e.target.value)} /></Field>
            {f.interval === 'once' && <Field label={t('apl.f.months', 'Months paid')}><Input type="number" min={1} max={12} value={f.months} onChange={(e) => set('months', e.target.value)} /></Field>}
            <Field label={t('apl.f.project', 'For a project (optional)')}>
              <Select value={f.projectRef} onChange={(e) => set('projectRef', e.target.value)}>
                <option value="">{t('apl.f.project0', 'No project')}</option>
                {(projects.data?.projects || []).filter((p) => !p.pool).map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {f.kind === 'prerelease' && (
          <Field label={t('apl.f.pre', 'Pre-release')}>
            <Select value={f.prereleaseId} onChange={(e) => set('prereleaseId', e.target.value)}>
              <option value="">{t('apl.f.pre0', 'Choose one')}</option>
              {(pres.data?.prereleases || []).filter((p) => !p.closedAt).map((p) => <option key={p.id} value={p.id}>{`${p.project?.name ? `${p.project.name}: ` : ''}${p.title}`}</option>)}
            </Select>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {f.kind === 'pool' && (
            <Field label={t('apl.f.price', 'Price')}>
              <Select value={f.priceMode} onChange={(e) => set('priceMode', e.target.value)}>
                <option value="auto">{t('apl.f.auto', 'Usual tariff')}</option>
                <option value="custom">{t('apl.f.custom', 'Custom amount')}</option>
              </Select>
            </Field>
          )}
          {(f.kind !== 'pool' || f.priceMode === 'custom') && (
            <Field label={t('apl.f.amount', 'Amount')}><Input type="number" min={0.5} step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="20.00" /></Field>
          )}
          {f.kind !== 'prerelease' && (
            <Field label={t('apl.f.interval', 'Billing')}>
              <Select value={f.interval} onChange={(e) => set('interval', e.target.value)}>
                <option value="once">{t('apl.f.once', 'One payment')}</option>
                <option value="month">{t('apl.f.month', 'Every month')}</option>
              </Select>
            </Field>
          )}
          <Field label={t('apl.f.max', 'How many people')} hint={t('apl.f.max.h', 'Empty: no limit.')}><Input type="number" min={1} value={f.maxUses} onChange={(e) => set('maxUses', e.target.value)} /></Field>
        </div>

        <div className="rounded-lg border border-[var(--line)] p-3 text-sm flex items-center gap-2 flex-wrap" data-testid="apl-preview">
          <CreditCard size={14} className="text-[var(--accent-ink)]" aria-hidden />
          <span className="font-semibold tabular-nums">{price >= 0 && price != null ? money(price, f.currency) : '…'}</span>
          <span className="text-[var(--muted)]">{f.interval === 'month' && f.kind !== 'prerelease' ? t('apl.pv.month', 'per month, until cancelled') : t('apl.pv.once', 'once')}</span>
          {f.kind === 'pool' && f.priceMode === 'auto' && quote?.monthlyCents != null && <span className="text-xs text-[var(--faint)]">{t('apl.pv.tariff', 'tariff {p}/month').replace('{p}', money(quote.monthlyCents, f.currency))}</span>}
          {f.kind === 'pool' && f.priceMode === 'auto' && quote && quote.amountCents < 50 && <span className="text-xs text-warning basis-full">{t('apl.pv.notariff', 'The usual tariff gives less than 0.50 here: pick a custom amount.')}</span>}
        </div>

        <Explain label={t('apl.more', 'More options')}>
          <div className="pt-2 grid gap-3 sm:grid-cols-2">
            <Field label={t('apl.f.desc', 'Description')} className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label={t('apl.f.only', 'Only this account (e-mail)')}><Input type="email" value={f.onlyEmail} onChange={(e) => set('onlyEmail', e.target.value)} /></Field>
            <Field label={t('apl.f.expires', 'Link ends on')}><Input type="date" value={f.expires} onChange={(e) => set('expires', e.target.value)} /></Field>
            <Field label={t('apl.f.currency', 'Currency')}>
              <Select value={f.currency} onChange={(e) => set('currency', e.target.value)}><option value="usd">USD</option><option value="eur">EUR</option></Select>
            </Field>
            {f.kind === 'pool' && <Field label={t('apl.f.upload', 'Upload speed (Mbps)')}><Input type="number" min={0.5} value={f.uploadMbps} onChange={(e) => set('uploadMbps', e.target.value)} /></Field>}
          </div>
        </Explain>
      </div>
    </Modal>
  );
}

function LinkDetail({ id, onClose }) {
  const { t, lang } = useI18n();
  const d = useAsync(() => api.get(`/admin/hosting/paylinks/${id}`), [id]);
  const st = { paid: 'green', pending: 'blue', expired: '', revoked: 'red' };
  return (
    <Modal open onClose={onClose} title={d.data?.link?.title || t('apl.uses', 'Payments')} icon={Receipt} width="max-w-2xl">
      {d.loading && !d.data ? <div className="py-6 grid place-items-center"><Spinner /></div> : !d.data?.uses?.length
        ? <p className="text-sm text-[var(--muted)]">{t('apl.uses.none', 'Nobody has paid yet.')}</p>
        : (
          <ul className="divide-y divide-[var(--line)] text-sm" data-testid="apl-uses">
            {d.data.uses.map((u) => (
              <li key={u.id} className="py-2 flex items-center gap-2 flex-wrap">
                <span className="font-medium min-w-0 truncate" title={u.name || u.userId}>{u.name || u.userId}</span>
                <Badge tone={st[u.status]}>{u.status}</Badge>
                <span className="ms-auto text-xs text-[var(--muted)] tabular-nums">{money(u.amountCents, u.currency)} · {new Date(u.paidAt || u.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</span>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}

export function AdminPaylinks() {
  const { t } = useI18n();
  const toast = useToast();
  const kindLabel = useKindLabel();
  const list = useAsync(() => api.get('/admin/hosting/paylinks'), []);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const links = list.data?.links || [];
  const urlOf = (l) => `${window.location.origin}/pay/${l.token}`;
  const copy = async (l) => {
    try { await navigator.clipboard.writeText(urlOf(l)); toast.success(t('apl.copied', 'Link copied.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const setRevoked = async (l, revoked) => {
    try { await api.patch(`/admin/hosting/paylinks/${l.id}`, { revoked }); toast.success(revoked ? t('apl.revoked', 'Stopped: nobody new can pay through it.') : t('apl.restored', 'Open again.')); list.reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  return (
    <div className="space-y-4" data-testid="admin-paylinks">
      <div className="flex items-center gap-2 flex-wrap">
        <LinkIcon size={16} className="text-[var(--accent-ink)]" />
        <h2 className="font-semibold">{t('apl.title', 'Payment links')}</h2>
        <Button size="sm" variant="primary" className="ms-auto" onClick={() => setCreating(true)}><Plus size={14} /> {t('apl.new', 'New payment link')}</Button>
      </div>
      <Explain summary={t('apl.lead', 'Sell a pool, early access or any amount, to the people you choose.')} className="text-[12px]">
        {t('apl.body', 'The payer opens the link, signs in and pays with Stripe. What the link sells is delivered as soon as the payment clears, once. Stopping a link blocks new payments only.')}
      </Explain>
      <Card className="overflow-hidden">
        {list.loading && !list.data ? <div className="py-10 text-center"><Spinner /></div> : !links.length ? (
          <div className="p-2"><EmptyState icon={LinkIcon} title={t('apl.empty', 'No payment link yet')} sub={t('apl.empty.s', 'Create one, copy it, send it.')} /></div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {links.map((l) => {
              const I = KIND_ICON[l.kind] || Receipt;
              return (
                <li key={l.id} className={`px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm ${l.revokedAt ? 'opacity-60' : ''}`}>
                  <I size={14} className="text-[var(--accent-ink)] shrink-0" aria-hidden />
                  <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setOpenId(l.id)}>
                    <span className="block truncate font-medium hover:underline" title={l.title}>{l.title}</span>
                    <span className="block text-[12px] text-[var(--muted)] truncate">
                      {kindLabel(l.kind)} · {money(l.amountCents, l.currency)}{l.interval === 'month' ? t('apl.permonth', '/month') : ''} · {t('apl.paidn', '{n} paid').replace('{n}', String(l.paid))}{l.maxUses != null ? ` / ${l.maxUses}` : ''}
                    </span>
                  </button>
                  {l.revokedAt && <Badge tone="red">{t('apl.stopped', 'stopped')}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => copy(l)} title={t('apl.copy', 'Copy the link')} aria-label={t('apl.copy', 'Copy the link')}><Copy size={13} /></Button>
                  {l.revokedAt
                    ? <Button size="sm" variant="ghost" onClick={() => setRevoked(l, false)} title={t('apl.reopen', 'Open again')} aria-label={t('apl.reopen', 'Open again')}><RotateCcw size={13} /></Button>
                    : <Button size="sm" variant="ghost" className="!text-error" onClick={() => setRevoked(l, true)} title={t('apl.stop', 'Stop the link')} aria-label={t('apl.stop', 'Stop the link')}><Ban size={13} /></Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {creating && <CreateLink onClose={() => setCreating(false)} onCreated={(l) => { setCreating(false); list.reload(); copy(l); }} />}
      {openId && <LinkDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export default AdminPaylinks;
