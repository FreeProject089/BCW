// The notification centre's "API key" button.
//
// There is no separate notifications credential and this does not invent one. The public API
// already has exactly the scopes a notification client needs (lib.mjs API_SCOPES):
//   notifications:read   GET  /v1/notifications            (what BMM's notification centre reads)
//   notifications:write  POST /v1/notifications/:id/read, /v1/notifications/read-all
// so this card is a shortcut onto the ONE credential system (/me/api-keys): it mints an
// ordinary ApiKey carrying only those scopes, with the same 2FA prompt, the same 20-key cap and
// the same "shown once" rule as the full key manager at /dev/config, which stays the place to
// delete one (it asks for the 2FA code there, too).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Copy, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Spinner, useToast, useDialog, copyText } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';

const READ = 'notifications:read';
const WRITE = 'notifications:write';

export default function NotifApiKeyCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { user } = useAuth();
  const [keys, setKeys] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [canMark, setCanMark] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/me/api-keys').then((r) => setKeys(r.keys || [])).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const live = (k) => !k.revokedAt && !(k.expiresAt && new Date(k.expiresAt) < new Date());
  const mine = (keys || []).filter((k) => (k.scopes || []).includes(READ) && live(k));

  const create = async () => {
    let totp;
    if (user?.totpEnabled) {
      totp = await dialog.prompt({
        title: t('nk.totp.t', 'Confirm with your 2FA code'),
        label: t('devc.totp', 'Your 2FA code'), placeholder: '123456',
        below: (setValue) => <TotpQuickFill onFill={(code) => setValue(code)} className="mt-2" />,
        okLabel: t('nk.create', 'Create a notifications key'),
      });
      if (!totp) return;
    }
    setBusy(true);
    try {
      const r = await api.post('/me/api-keys', {
        label: t('nk.label', 'Notifications'),
        scopes: canMark ? [READ, WRITE] : [READ],
        ...(totp ? { totp: String(totp).trim() } : {}),
      });
      setFresh(r.secret); load();
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'totp_invalid' ? t('devc.badtotp', 'That code is not right.')
        : e === 'totp_required' ? t('devc.needtotp', 'Enter your 6-digit code.')
        : e === 'too_many_keys' ? t('nk.toomany', 'You already have 20 keys. Delete one first.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5" id="notif-api-key" data-notif-key>
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--accent-ink)]" /> {t('nk.title', 'Notifications API key')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('nk.sub', 'Lets BMM, or a script of yours, read these notifications. The key can do nothing else.')}</p>

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

      {keys === null ? <Spinner /> : mine.length > 0 && (
        <div className="divide-y divide-[var(--line)] mb-3">
          {mine.map((k) => (
            <div key={k.id} className="py-2 flex items-center gap-2 text-[13px] flex-wrap">
              <span className="min-w-0 truncate" title={k.label || t('devc.untitled', 'Untitled key')}>{k.label || t('devc.untitled', 'Untitled key')}</span>
              <code className="text-[10px] font-mono text-[var(--faint)]">{k.prefix}…</code>
              {!(k.scopes || []).includes(WRITE) && <Badge tone="">{t('nk.readonly', 'read only')}</Badge>}
              <span className="ms-auto text-[11px] text-[var(--faint)]">{k.lastUsedAt ? t('devc.used', 'last used {d}').replace('{d}', new Date(k.lastUsedAt).toLocaleString()) : t('devc.never', 'never used')}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Plus size={13} /> {t('nk.create', 'Create a notifications key')}</>}</Button>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={canMark} onChange={(e) => setCanMark(e.target.checked)} /> {t('nk.canmark', 'Can mark them as read')}
        </label>
        <Link to="/dev/config" className="ms-auto text-[12px] text-[var(--accent-ink)] hover:underline">{t('nk.manage', 'Manage all my keys')}</Link>
      </div>
    </Card>
  );
}
