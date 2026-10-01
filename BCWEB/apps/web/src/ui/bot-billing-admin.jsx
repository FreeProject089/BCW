// Admin → Discord bot → Plans & credits (agent-bcw-bot).
//
// Two cards over routes that already existed (apps/api/src/routes/bot-billing.mjs, manage_bot):
//   Packs and costs   the credit packs on sale (credits, price, validity), the per-call costs
//                     and the default validity of a pack (12 months, 0 = never)
//   A server's wallet pick a server, see its balance and movements, give or take credits with a
//                     reason (audited). A gift has no expiry; a take is spent oldest first.
import { useEffect, useState } from 'react';
import { Coins, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Card, Input, Field, Spinner, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

function Packs() {
  const { t } = useI18n(); const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/admin/bot/billing').then((r) => setD({ packs: r.packs.map((x) => ({ ...x, price: (x.priceCents / 100).toFixed(2), months: x.months ?? '' })), cost: r.cost, expiryMonths: r.expiryMonths, health: r.health })).catch(() => setD(false)); }, []);
  if (d === null) return <div className="py-6 flex justify-center"><Spinner /></div>;
  if (d === false) return <p className="text-sm text-[var(--muted)]">{t('common.failed', 'Failed.')}</p>;
  const setPack = (i, patch) => setD({ ...d, packs: d.packs.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/bot/billing', {
        packs: d.packs.map((x) => ({ id: String(x.id).trim(), credits: Math.round(Number(x.credits) || 0), priceCents: Math.round((Number(x.price) || 0) * 100), ...(x.months === '' ? {} : { months: Math.round(Number(x.months) || 0) }) })),
        cost: { platform: Math.round(Number(d.cost.platform) || 1), byokFee: Math.round(Number(d.cost.byokFee) || 0) },
        expiryMonths: Math.round(Number(d.expiryMonths) || 0),
      });
      setD({ packs: r.packs.map((x) => ({ ...x, price: (x.priceCents / 100).toFixed(2), months: x.months ?? '' })), cost: r.cost, expiryMonths: r.expiryMonths });
      toast.success(t('ds.saved', 'Saved.'));
    } catch { toast.error(t('abb.bad', 'Check the packs: an id, at least 1 credit, at least $0.50.')); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Coins size={16} className="text-[var(--accent-ink)]" /> {t('abb.packs', 'Credit packs')}</div>
      <div className="space-y-2">
        {d.packs.map((x, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
            <Field label={t('abb.id', 'Id')}><Input value={x.id} maxLength={20} onChange={(e) => setPack(i, { id: e.target.value })} /></Field>
            <Field label={t('bd.credits', 'Credits')}><Input type="number" min="1" value={x.credits} onChange={(e) => setPack(i, { credits: e.target.value })} /></Field>
            <Field label={t('abb.price', 'Price ($)')}><Input type="number" min="0.5" step="0.01" value={x.price} onChange={(e) => setPack(i, { price: e.target.value })} /></Field>
            <Field label={t('abb.months', 'Valid (months)')}><Input type="number" min="0" max="120" value={x.months} placeholder={String(d.expiryMonths)} onChange={(e) => setPack(i, { months: e.target.value })} /></Field>
            <button type="button" className="p-2 text-[var(--faint)] hover:text-error disabled:opacity-40" disabled={d.packs.length <= 1} onClick={() => setD({ ...d, packs: d.packs.filter((_, k) => k !== i) })} title={t('common.remove', 'Remove')} aria-label={t('common.remove', 'Remove')}><Trash2 size={14} /></button>
          </div>
        ))}
        {d.packs.length < 6 && <Button size="sm" variant="ghost" onClick={() => setD({ ...d, packs: [...d.packs, { id: '', credits: 1000, price: '4.99', months: '' }] })}><Plus size={13} /> {t('abb.add', 'Add a pack')}</Button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label={t('abb.expiry', 'Default validity (months)')} hint={t('abb.expiry.h', '0 = never expires.')}><Input type="number" min="0" max="120" value={d.expiryMonths} onChange={(e) => setD({ ...d, expiryMonths: e.target.value })} /></Field>
        <Field label={t('abb.cost', 'Credits per AI call')}><Input type="number" min="1" value={d.cost.platform} onChange={(e) => setD({ ...d, cost: { ...d.cost, platform: e.target.value } })} /></Field>
        <Field label={t('abb.byok', 'BYOK fee per call')}><Input type="number" min="0" value={d.cost.byokFee} onChange={(e) => setD({ ...d, cost: { ...d.cost, byokFee: e.target.value } })} /></Field>
      </div>
      {/* Metering gaps since the API started (lib/bot-billing.mjs billingHealth): shown only when there are some. */}
      {(d.health?.automodBudgetUnknown > 0 || d.health?.automodCommitFailed > 0) && (
        <p className="text-[12px] text-warning">{t('abb.health', 'AI moderation metering since the last restart: {u} calls with an unreadable budget (counted, not charged), {f} not recorded.').replace('{u}', d.health.automodBudgetUnknown || 0).replace('{f}', d.health.automodCommitFailed || 0)}</p>
      )}
      <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={14} /> {t('common.save', 'Save')}</>}</Button>
    </Card>
  );
}

function Wallet() {
  const { t } = useI18n(); const toast = useToast();
  const [guilds, setGuilds] = useState([]);
  const [gid, setGid] = useState('');
  const [w, setW] = useState(null);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/admin/bot/guilds').then((r) => setGuilds(r.guilds || [])).catch(() => {}); }, []);
  const load = (id) => { setW(null); if (/^\d{5,32}$/.test(id)) api.get(`/admin/bot/credits/${id}`).then(setW).catch(() => setW(false)); };
  useEffect(() => { load(gid); }, [gid]);
  const give = async () => {
    const n = Math.round(Number(delta) || 0);
    if (!n || note.trim().length < 3) { toast.error(t('abb.need', 'A number and a reason (3 characters at least).')); return; }
    setBusy(true);
    try { const r = await api.post(`/admin/bot/credits/${gid}`, { delta: n, note: note.trim() }); toast.success(t('abb.done', 'Balance: {n}').replace('{n}', r.balance)); setDelta(''); setNote(''); load(gid); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Coins size={16} className="text-[var(--accent-ink)]" /> {t('abb.wallet', 'A server’s credits')}</div>
      <Field label={t('abb.server', 'Server')}>
        <select className="input" value={gid} onChange={(e) => setGid(e.target.value)}>
          <option value="">{t('abb.pick', 'Pick a server')}</option>
          {guilds.map((g) => <option key={g.guildId} value={g.guildId}>{g.name || g.guildId}</option>)}
        </select>
      </Field>
      {gid && (w === null ? <Spinner /> : w === false ? <p className="text-sm text-[var(--muted)]">{t('common.failed', 'Failed.')}</p> : (
        <>
          <div className="text-sm">{t('abb.balance', 'Balance')}: <b className="tabular-nums">{w.balance.toLocaleString()}</b></div>
          <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-2 items-end">
            <Field label={t('abb.delta', 'Credits (+ or -)')}><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
            <Field label={t('abb.note', 'Reason')}><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
            <Button variant="primary" disabled={busy} onClick={give}>{busy ? <Spinner /> : t('abb.apply', 'Apply')}</Button>
          </div>
          {w.history?.length > 0 && (
            <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] max-h-64 overflow-y-auto">
              {w.history.map((h) => (
                <div key={h.id} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                  <span className={`tabular-nums font-semibold w-16 ${h.delta > 0 ? 'text-success' : 'text-[var(--muted)]'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                  <span className="w-16 text-[var(--faint)]">{h.reason}</span>
                  <span className="flex-1 truncate text-[var(--muted)]" title={h.note}>{h.note}</span>
                  {h.expiresAt && <span className="text-[10.5px] text-[var(--faint)]">{t('abb.until', 'until {d}').replace('{d}', new Date(h.expiresAt).toLocaleDateString())}</span>}
                  <span className="text-[10.5px] text-[var(--faint)]">{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ))}
    </Card>
  );
}

export default function BotBillingAdmin() {
  return (
    <div className="space-y-4">
      <Packs />
      <Wallet />
    </div>
  );
}
