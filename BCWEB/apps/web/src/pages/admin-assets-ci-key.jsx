// assetskey (agent-assets-key): Admin > Downloads & assets > "CI publish key".
//
// Mints and revokes the narrow key BMM's release workflows use to replace a few mirror slots
// (routes/platform-assets.mjs, rules in lib/asset-publish.mjs): one scope, `assets:publish`,
// bound to the slots ticked here, always expiring, shown once. Minting asks for a fresh 2FA
// code; the server also refuses it to anyone below ADMIN, whatever this screen shows.
import { useEffect, useState } from 'react';
import { KeyRound, Copy, Plus, Ban } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Input, Select, Field, Spinner, useToast, useDialog, copyText, formatBytes } from '../ui/ui.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';

const DAYS = [1, 7, 30, 90];

export default function AssetsCiKeyCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [data, setData] = useState(null);
  const [slots, setSlots] = useState([]);
  const [days, setDays] = useState(30);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/admin/assets/ci-keys').then(setData).catch(() => setData({ keys: [], slots: [], maxDays: 90 }));
  useEffect(() => { load(); }, []);

  const live = (k) => !k.revokedAt && !(k.expiresAt && new Date(k.expiresAt) < new Date());
  const toggle = (id) => setSlots((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const mint = async () => {
    if (!slots.length) return toast.error(t('assetskey.noslot', 'Tick at least one slot.'));
    const totp = await dialog.prompt({
      title: t('assetskey.totp.t', 'Confirm with your 2FA code'),
      label: t('devc.totp', 'Your 2FA code'), placeholder: '123456',
      below: (setValue) => <TotpQuickFill onFill={(code) => setValue(code)} className="mt-2" />,
      okLabel: t('assetskey.mint', 'Create the key'),
    });
    if (!totp) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/assets/ci-keys', { label: label.trim() || undefined, slots, expiresInDays: days, totp: String(totp).trim() });
      setFresh(r.secret); setLabel(''); load();
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'totp_invalid' ? t('devc.badtotp', 'That code is not right.')
        : e === 'admin_only' ? t('assetskey.adminonly', 'Only an administrator can create this key.')
        : e === 'too_many_keys' ? t('assetskey.toomany', 'You already have 5 live CI keys. Revoke one first.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const revoke = async (k) => {
    if (!await dialog.confirm({
      title: t('assetskey.revoke.t', 'Revoke this CI key?'),
      message: t('assetskey.revoke.m', 'The next workflow run that uses “{n}” fails, and the mirror slots keep their current files.').replace('{n}', k.label || k.prefix),
      okLabel: t('assetskey.revoke', 'Revoke'), danger: true,
    })) return;
    try { await api.post(`/admin/assets/ci-keys/${encodeURIComponent(k.id)}/revoke`); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  if (!data) return <Card className="p-4 mb-4"><Spinner /></Card>;
  const maxDays = data.maxDays || 90;

  return (
    <Card className="p-4 mb-4" data-assets-ci-key>
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--accent-ink)]" /> {t('assetskey.title', 'CI publish key')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('assetskey.sub', 'Lets a release workflow replace the slots ticked below, and nothing else. Save it as the BCWEB_ASSETS_TOKEN secret of the repository.')}</p>

      {fresh && (
        <div className="rounded-lg border border-[var(--primary)] tint-primary p-3 mb-3">
          <div className="text-[12px] font-semibold text-[var(--accent-ink)] mb-1.5">{t('devc.once', 'Copy it now, it is shown once and never again.')}</div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12px] break-all flex-1 min-w-0">{fresh}</code>
            <Button size="sm" variant="ghost" onClick={() => { copyText(fresh); toast.success(t('common.copied', 'Copied.')); }} title={t('common.copy', 'Copy')}><Copy size={13} /></Button>
          </div>
          <Button size="sm" className="mt-2" onClick={() => setFresh(null)}>{t('devc.saved', 'I have saved it')}</Button>
        </div>
      )}

      {data.keys.length > 0 && (
        <div className="divide-y divide-[var(--line)] mb-3">
          {data.keys.map((k) => (
            <div key={k.id} className="py-2 flex items-center gap-2 text-[13px] flex-wrap">
              <span className="min-w-0 truncate" title={k.label}>{k.label}</span>
              <code className="text-[10px] font-mono text-[var(--faint)]">{k.prefix}…</code>
              {(k.assetSlots || []).map((s) => <Badge key={s} tone="">{s}</Badge>)}
              {k.revokedAt ? <Badge tone="red">{t('assetskey.revoked', 'revoked')}</Badge>
                : !live(k) ? <Badge tone="red">{t('assetskey.expired', 'expired')}</Badge>
                : <span className="text-[11px] text-[var(--faint)]">{t('assetskey.until', 'until {d}').replace('{d}', new Date(k.expiresAt).toLocaleDateString())}</span>}
              <span className="ms-auto text-[11px] text-[var(--faint)]">{k.lastUsedAt ? t('devc.used', 'last used {d}').replace('{d}', new Date(k.lastUsedAt).toLocaleString()) : t('devc.never', 'never used')}</span>
              {live(k) && <Button size="sm" variant="ghost" onClick={() => revoke(k)} title={t('assetskey.revoke', 'Revoke')}><Ban size={13} /></Button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-3">
        {data.slots.map((s) => (
          <label key={s.id} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
            <input type="checkbox" checked={slots.includes(s.id)} onChange={() => toggle(s.id)} />
            <span className="font-mono">{s.id}</span>
            <span className="text-[var(--faint)]">{t('assetskey.max', 'max {n}').replace('{n}', formatBytes(s.maxBytes))}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('assetskey.label', 'Name')}><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="BMM release" className="!w-48" maxLength={60} /></Field>
        <Field label={t('assetskey.expiry', 'Expires after')}>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="!w-auto">
            {DAYS.filter((d) => d <= maxDays).map((d) => <option key={d} value={d}>{t('assetskey.days', '{n} day(s)').replace('{n}', String(d))}</option>)}
          </Select>
        </Field>
        <Button variant="primary" disabled={busy} onClick={mint}>{busy ? <Spinner /> : <><Plus size={13} /> {t('assetskey.mint', 'Create the key')}</>}</Button>
      </div>
    </Card>
  );
}
