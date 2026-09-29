// Settings > AI (aios, agent-bcw-ai-os): which AI helpers this account may use, how much is
// left today, where each one sends text, and the member's own key (BYOK).
//
// The key is typed here once and never shown again: the API answers with the provider's host
// and the key's last four characters, nothing more (routes/ai-features.mjs). Removing it asks
// first, because it cannot be read back to re-enter.
import { useState } from 'react';
import { Sparkles, KeyRound, Trash2, FlaskConical, Save } from 'lucide-react';
import { Card, Button, Input, Badge, Explain, useToast, useDialog } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAiMe, reloadAiMe, useAiWhere } from './ai-assist.jsx';

export default function AiAccountCard({ className = '' }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const me = useAiMe();
  const where = useAiWhere();
  const [form, setForm] = useState({ baseUrl: 'https://', key: '', model: '' });
  const [busy, setBusy] = useState(false);
  if (!me?.features) return null;
  const names = {
    suggest_tags: t('aic.f.suggest_tags', 'Tag and category suggestions'),
    detect_language: t('aic.f.detect_language', 'Language detection'),
    content_check: t('aic.f.content_check', 'Check before posting'),
    describe: t('aic.f.describe', 'Description drafts'),
  };
  const why = {
    feature_off: t('aia.r.off', 'This helper is switched off on this site.'),
    plan_required: t('aia.r.plan', 'This helper comes with a paid plan, or with your own AI key.'),
    no_key: t('aia.r.nokey', 'Add your own AI key in Settings to use this.'),
    key_unreadable: t('aia.r.unreadable', 'Your saved key can no longer be read. Enter it again in Settings.'),
  };
  const rows = Object.entries(me.features).filter(([id]) => names[id]);
  const anyOn = rows.some(([, f]) => f.available || f.reason !== 'feature_off') || me.byok?.enabled;
  if (!anyOn) return null;
  const key = me.byok?.key;
  const errText = (e) => ({
    https_required: t('aic.e.https', 'The address must start with https://.'),
    private_address: t('aic.e.private', 'That address is on a private network; use the provider\'s public address.'),
    private_host: t('aic.e.private', 'That address is on a private network; use the provider\'s public address.'),
    credentials_in_url: t('aic.e.creds', 'Put the key in the key field, not in the address.'),
    query_not_allowed: t('aic.e.query', 'The address must not carry a query (?…).'),
    bad_url: t('aic.e.url', 'That is not a valid address.'),
    bad_key: t('aic.e.key', 'That does not look like an API key.'),
    byok_off: t('aic.e.off', 'Your own keys are switched off on this site.'),
  }[e] || t('common.failed', 'Failed.'));
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/ai/key', { baseUrl: form.baseUrl.trim(), key: form.key.trim(), model: form.model.trim() });
      setForm({ baseUrl: 'https://', key: '', model: '' });
      await reloadAiMe();
      toast.success(t('aic.saved', 'Key saved. It is encrypted, and it will never be shown again.'));
    } catch (e) { toast.error(errText(e?.data?.error)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post('/ai/key/test', {});
      if (r?.ok) toast.success(t('aic.test.ok', 'It works: {h} answered.').replace('{h}', r.host || '?'));
      else toast.error(t('aic.test.fail', 'The provider did not accept the call ({r}).').replace('{r}', r?.reason || '?'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); reloadAiMe(); }
  };
  const remove = async () => {
    const ok = await dialog.confirm({ title: t('aic.rm.t', 'Remove your AI key?'), message: t('aic.rm.m', 'It is deleted from our database. To use it again you will have to paste it again.'), okLabel: t('aic.rm', 'Remove'), danger: true });
    if (!ok) return;
    setBusy(true);
    // undo: a key cannot be read back, so there is nothing an undo could restore; the confirm above is the safeguard.
    try { await api.del('/ai/key'); await reloadAiMe(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Card className={`p-4 sm:p-5 ${className}`} id="ai">
      <div className="flex items-center gap-2.5 mb-2 pb-2.5 border-b border-[var(--line)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><Sparkles size={14} className="text-[var(--accent-ink)]" /></span>
        <span className="text-sm font-semibold">{t('aic.t', 'AI helpers')}</span>
      </div>
      <p className="text-xs text-[var(--muted)] mb-2">{t('aic.s', 'Optional helpers while you write: none of them decides anything for you, and every one says where your text goes before you use it.')}</p>
      <ul className="divide-y divide-[var(--line)] text-sm">
        {rows.map(([id, f]) => (
          <li key={id} className="py-2 flex flex-wrap items-center gap-2">
            <span className="font-medium">{names[id]}</span>
            {f.available
              ? <Badge tone="primary">{t('aic.on', 'available')}</Badge>
              : <Badge>{t('aic.off', 'not available')}</Badge>}
            {f.available && f.allowance != null && <span className="text-xs text-[var(--muted)] tabular-nums">{t('aia.used', '{u} of {a} today').replace('{u}', f.used ?? 0).replace('{a}', f.allowance)}</span>}
            <span className="basis-full text-xs text-[var(--faint)]">{f.available ? where(f.source, f.host) : (why[f.reason] || '')}</span>
          </li>
        ))}
      </ul>
      {me.byok?.enabled && (
        <div className="mt-3 pt-3 border-t border-[var(--line)]">
          <div className="flex items-center gap-2 mb-1.5 text-sm font-medium"><KeyRound size={14} className="text-[var(--accent-ink)]" aria-hidden />{t('aic.byok', 'Your own AI key')}</div>
          <Explain summary={t('aic.byok.s', 'Use your own account at an OpenAI-compatible provider for the writing helpers.')}>
            <p className="text-xs text-[var(--muted)]">{t('aic.byok.d', 'The key is encrypted before it is stored and is never sent back to any browser, including yours. When you use a helper, the text you asked about is sent to that provider with your key, under your own agreement with them; we keep only the number of calls. {n} calls a day at most. Remove the key at any time; closing your account removes it too.').replace('{n}', String(me.byok.perUserPerDay))}</p>
          </Explain>
          {key?.set ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)]" title={key.host}>{key.host} · ••••{key.last4}{key.model ? ` · ${key.model}` : ''}</span>
              <Button size="sm" onClick={test} disabled={busy}><FlaskConical size={14} aria-hidden /> {t('aic.test', 'Test')}</Button>
              <Button size="sm" variant="danger" onClick={remove} disabled={busy}><Trash2 size={14} aria-hidden /> {t('aic.rm', 'Remove')}</Button>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr] min-w-0">
              <Input aria-label={t('aic.url', 'Provider address')} placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              <Input aria-label={t('aic.model', 'Model (optional)')} placeholder={t('aic.model', 'Model (optional)')} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              <Input className="sm:col-span-2" type="password" autoComplete="off" aria-label={t('aic.key', 'API key')} placeholder={t('aic.key', 'API key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
              <div className="sm:col-span-2"><Button size="sm" variant="primary" onClick={save} disabled={busy || form.key.trim().length < 8 || form.baseUrl.trim().length < 12}><Save size={14} aria-hidden /> {t('aic.save', 'Save the key')}</Button></div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
