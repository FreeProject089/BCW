import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Shield, Copy, Trash2, Plus, RefreshCw, Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Badge, Field, Spinner, useToast, useDialog, copyText } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

// /dev/config — the credentials, in one place.
//
// They used to live in the profile, between the avatar and the theme picker: a page you open
// to change your display name is not where you go to rotate a key an integration runs on,
// and putting them there meant the developer surface was four screens with no front door.
//
// Everything that MINTS or DESTROYS a credential asks for the second factor when the account
// has one. A stolen session should not be able to hand itself an API key, nor quietly delete
// the one a deployment depends on — an outage with no trace of who caused it.

/** The code field, shown only to accounts that actually have 2FA. */
function TotpField({ value, onChange, label }) {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user?.totpEnabled) return null;
  return (
    <Field label={label || t('devc.totp', 'Your 2FA code')} hint={t('devc.totp.h', 'Asked because this creates or destroys a credential.')}>
      <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-32"
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
    </Field>
  );
}

function ApiKeysPanel() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { user } = useAuth();
  const [keys, setKeys] = useState(null);
  const [scopes, setScopes] = useState({});
  const [form, setForm] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/me/api-keys')
    .then((r) => { setKeys(r.keys || []); setScopes(r.scopes || {}); })
    .catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.picked.length) return toast.error(t('devc.needscope', 'Pick at least one scope — a key with none can do nothing.'));
    if (user?.totpEnabled && form.totp.length !== 6) return toast.error(t('devc.needtotp', 'Enter your 6-digit code.'));
    setBusy(true);
    try {
      const r = await api.post('/me/api-keys', {
        label: form.label.trim(), scopes: form.picked,
        expiresInDays: form.days ? Number(form.days) : undefined,
        totp: form.totp || undefined,
      });
      setFresh(r.secret); setForm(null); await load();
    } catch (x) {
      toast.error(x?.data?.error === 'totp_invalid' ? t('devc.badtotp', 'That code is not right.')
        : x?.data?.error === 'totp_required' ? t('devc.needtotp', 'Enter your 6-digit code.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  // No undo window here, unlike most destructive actions on this site: the row is really
  // deleted, so there would be nothing to put back. The confirmation carries the weight
  // instead, and it names what stops working.
  const remove = async (k) => {
    const code = user?.totpEnabled
      ? await dialog.prompt({
          title: t('devc.del.t', 'Delete this key?'),
          message: t('devc.del.m', 'Anything using “{n}” stops working the moment this is gone, and it cannot be restored — a new key would have to be created and deployed. Its usage history is kept.').replace('{n}', k.label || t('devc.untitled', 'Untitled key')),
          label: t('devc.totp', 'Your 2FA code'), placeholder: '123456',
          okLabel: t('common.delete', 'Delete'), danger: true,
        })
      : (await dialog.confirm({
          title: t('devc.del.t', 'Delete this key?'),
          message: t('devc.del.m', 'Anything using “{n}” stops working the moment this is gone, and it cannot be restored — a new key would have to be created and deployed. Its usage history is kept.').replace('{n}', k.label || t('devc.untitled', 'Untitled key')),
          okLabel: t('common.delete', 'Delete'), danger: true,
        })) ? '' : null;
    if (code === null || code === undefined || code === false) return;
    try {
      await api.del(`/me/api-keys/${k.id}`, code ? { totp: code } : undefined);
      toast.success(t('devc.deleted', 'Deleted.')); load();
    } catch (x) {
      toast.error(x?.data?.error === 'totp_invalid' ? t('devc.badtotp', 'That code is not right.') : t('common.failed', 'Failed.'));
    }
  };

  const dead = (k) => k.revokedAt || (k.expiresAt && new Date(k.expiresAt) < new Date());

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <KeyRound size={15} className="text-[var(--primary-2)]" /> {t('devc.keys', 'API keys')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('devc.keys.s', 'A key acts as YOU and needs nobody else’s permission, so it can only ever reach your own data. An app that acts for other people wants Sign in with BetterCommunity instead.')}
      </p>

      {fresh && (
        <div className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/5 p-3 mb-3">
          <div className="text-[12px] font-semibold text-[var(--primary-2)] mb-1.5">{t('devc.once', 'Copy it now — it is shown once and never again.')}</div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12px] break-all flex-1">{fresh}</code>
            <Button size="sm" variant="ghost" onClick={() => { copyText(fresh); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
          </div>
          <Button size="sm" className="mt-2" onClick={() => setFresh(null)}>{t('devc.saved', 'I have saved it')}</Button>
        </div>
      )}

      {keys === null ? <Spinner /> : keys.length > 0 && (
        <div className="divide-y divide-[var(--line)] mb-3">
          {keys.map((k) => (
            <div key={k.id} className="py-2.5 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] flex items-center gap-1.5 flex-wrap">
                  <span className={dead(k) ? 'line-through text-[var(--faint)]' : ''}>{k.label || t('devc.untitled', 'Untitled key')}</span>
                  <code className="text-[10px] font-mono text-[var(--faint)]">{k.prefix}…</code>
                  {k.revokedAt && <Badge tone="red">{t('devc.revoked', 'revoked')}</Badge>}
                  {!k.revokedAt && k.expiresAt && new Date(k.expiresAt) < new Date() && <Badge tone="amber">{t('devc.expired', 'expired')}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--faint)] truncate">{(k.scopes || []).join('  ') || t('devc.noscope', 'no scope')}</div>
                <div className="text-[11px] text-[var(--faint)]">
                  {k.lastUsedAt ? t('devc.used', 'last used {d}').replace('{d}', new Date(k.lastUsedAt).toLocaleString()) : t('devc.never', 'never used')}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(k)} title={t('common.delete', 'Delete')}><Trash2 size={13} className="text-[var(--error)]" /></Button>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div className="rounded-lg border border-[var(--line)] p-3 space-y-2.5">
          <Field label={t('devc.label', 'What is it for?')}>
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder={t('devc.label.ph', 'My sync script')} />
          </Field>
          <Field label={t('devc.scopes', 'What it may do')} hint={t('devc.scopes.h', 'Tick only what you use. A key you cannot lose control of is one that could not do much anyway.')}>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {Object.entries(scopes).map(([sc, desc]) => (
                <label key={sc} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" className="mt-0.5" checked={form.picked.includes(sc)}
                    onChange={(e) => setForm((f) => ({ ...f, picked: e.target.checked ? [...f.picked, sc] : f.picked.filter((x) => x !== sc) }))} />
                  <span><code className="font-mono text-[var(--primary-2)]">{sc}</code> — <span className="text-[var(--muted)]">{desc}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('devc.expiry', 'Expires in (days, optional)')}>
            <Input className="w-28" type="number" min="1" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
          </Field>
          <TotpField value={form.totp} onChange={(v) => setForm((f) => ({ ...f, totp: v }))} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : t('devc.create', 'Create the key')}</Button>
            <Button size="sm" onClick={() => setForm(null)}>{t('common.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setForm({ label: '', picked: ['account:read'], days: '', totp: '' })}>
          <Plus size={13} /> {t('devc.new', 'New key')}
        </Button>
      )}
    </Card>
  );
}

// Registering an app is unchanged in substance — it moved here from the profile, where it
// sat between an avatar picker and a theme selector.
function OAuthAppsPanel() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/me/oauth-clients').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const clients = data.clients || [];
  const atMax = clients.length >= (data.max ?? 5);
  const blank = () => ({ name: '', description: '', homepageUrl: '', redirectUris: '', confidential: true, scopes: ['openid', 'profile', 'email'] });

  const create = async () => {
    const uris = form.redirectUris.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    if (form.name.trim().length < 2) return toast.error(t('dev.needname', 'Give the app a name — people see it on the consent screen.'));
    if (!uris.length) return toast.error(t('dev.needuri', 'Add at least one redirect URI.'));
    setBusy(true);
    try {
      const r = await api.post('/me/oauth-clients', {
        name: form.name.trim(), description: form.description.trim(), homepageUrl: form.homepageUrl.trim(),
        confidential: form.confidential, redirectUris: uris, scopes: form.scopes,
      });
      setSecret({ id: r.client.id, value: r.clientSecret }); setForm(null); load();
    } catch (x) {
      toast.error(x?.data?.error === 'bad_redirect_uri' ? `${x.data.uri} — ${x.data.detail}`
        : x?.data?.error === 'too_many' ? t('dev.toomany', 'You already have {n} apps, which is the limit.').replace('{n}', String(x.data.max))
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!await dialog.confirm({
      title: t('dev.del.t', 'Delete this app?'),
      message: t('dev.del.m', 'Everyone who connected it is disconnected and its live sessions are revoked — {n} account(s) today. The client id cannot be reused.').replace('{n}', String(c.users || 0)),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    try { await api.del(`/me/oauth-clients/${c.id}`); toast.success(t('common.deleted', 'Deleted.')); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const rotate = async (c) => {
    if (!await dialog.confirm({
      title: t('dev.rotate.t', 'Issue a new secret?'),
      message: t('dev.rotate.m', 'The current one stops working immediately, so anything using it signs people in no longer until you deploy the new one.'),
      okLabel: t('dev.rotate.ok', 'Rotate'), danger: true,
    })) return;
    try { const r = await api.post(`/me/oauth-clients/${c.id}/rotate`); setSecret({ id: c.id, value: r.clientSecret }); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Shield size={15} className="text-[var(--primary-2)]" /> {t('dev.title', 'Sign in with BetterCommunity')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('dev.sub', 'Register an app and let people sign in to it with their BetterCommunity account. Everything is discoverable at /.well-known/openid-configuration — standard OpenID Connect, no SDK of ours required.')}</p>

      {secret && (
        <div className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/5 p-3 mb-3">
          <div className="text-[12px] font-semibold text-[var(--primary-2)] mb-1.5">{t('dev.secret.t', 'Copy the secret now — it is shown once and never again.')}</div>
          {[['client_id', secret.id], ['client_secret', secret.value]].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[12px] mb-1">
              <span className="text-[var(--muted)] w-24 shrink-0">{k}</span>
              <code className="font-mono break-all flex-1">{v}</code>
              <Button size="sm" variant="ghost" onClick={() => { copyText(v); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
            </div>
          ))}
          <Button size="sm" className="mt-2" onClick={() => setSecret(null)}>{t('dev.secret.done', 'I have saved it')}</Button>
        </div>
      )}

      {clients.length > 0 && (
        <div className="divide-y divide-[var(--line)] mb-3">
          {clients.map((c) => (
            <div key={c.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium flex items-center gap-1.5 flex-wrap">
                    <span className={c.active ? '' : 'text-[var(--faint)]'}>{c.name}</span>
                    {c.verified ? <Badge tone="green">{t('dev.verified', 'reviewed')}</Badge> : <Badge tone="amber">{t('dev.unverified', 'not reviewed')}</Badge>}
                    {!c.confidential && <Badge>{t('dev.publicclient', 'public client (PKCE)')}</Badge>}
                  </div>
                  <div className="text-[11px] text-[var(--faint)] font-mono truncate">{c.id}</div>
                  <div className="text-[11px] text-[var(--faint)] truncate">{(c.scopes || []).join(' ')} · {t('dev.users', '{n} connected').replace('{n}', String(c.users || 0))}</div>
                </div>
                {c.confidential && <Button size="sm" variant="ghost" onClick={() => rotate(c)} title={t('dev.rotate.ok', 'Rotate')}><RefreshCw size={13} /></Button>}
                <Button size="sm" variant="ghost" onClick={() => remove(c)} title={t('common.delete', 'Delete')}><Trash2 size={13} className="text-[var(--error)]" /></Button>
              </div>
              <div className="text-[11px] text-[var(--faint)] mt-0.5 break-all">{(c.redirectUris || []).join('  ·  ')}</div>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div className="rounded-lg border border-[var(--line)] p-3 space-y-2.5">
          <Field label={t('dev.name', 'App name')} hint={t('dev.name.h', 'Shown on the consent screen. Changing it later drops the staff review.')}>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My Mod Launcher" />
          </Field>
          <Field label={t('dev.uris', 'Redirect URIs')} hint={t('dev.uris.h', 'One per line, matched exactly. https only — except http://localhost for development. This is where the authorization code is delivered, so it is the one field worth double-checking.')}>
            <Textarea rows={3} value={form.redirectUris} onChange={(e) => setForm((f) => ({ ...f, redirectUris: e.target.value }))} placeholder={'https://myapp.example.com/callback\nhttp://localhost:5173/callback'} />
          </Field>
          <label className="flex items-start gap-2 text-[12px]">
            <input type="checkbox" className="mt-0.5" checked={!form.confidential} onChange={(e) => setForm((f) => ({ ...f, confidential: !e.target.checked }))} />
            <span>{t('dev.public.h', 'This app runs where users can read its code (a mobile app, a desktop app, a single-page site). No secret is issued and PKCE is required.')}</span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : t('dev.create', 'Register it')}</Button>
            <Button size="sm" onClick={() => setForm(null)}>{t('common.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" disabled={atMax} onClick={() => setForm(blank())}>
          <Plus size={13} /> {atMax ? t('dev.atmax', 'Limit of {n} apps reached').replace('{n}', String(data.max ?? 5)) : t('dev.new', 'Register an app')}
        </Button>
      )}
    </Card>
  );
}

export default function DevConfig() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <Card className="p-7 text-center">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] mx-auto mb-4"><Lock size={22} className="text-[var(--primary-2)]" /></span>
          <p className="text-sm text-[var(--muted)] mb-4">{t('devc.signin', 'Credentials belong to an account — sign in to manage yours.')}</p>
          <Link to="/auth?next=/dev/config"><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto py-8">
      <Link to="/dev" className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1 mb-3"><ArrowLeft size={13} /> {t('devc.back', 'Developer hub')}</Link>
      <h1 className="text-2xl font-bold mb-1">{t('devc.title', 'Credentials')}</h1>
      <p className="text-sm text-[var(--muted)] mb-6">
        {t('devc.sub', 'Two different things, for two different jobs: a key acts as you, an app acts for other people with their permission.')}
      </p>
      <div className="space-y-4">
        <ApiKeysPanel />
        <OAuthAppsPanel />
      </div>
    </div>
  );
}
