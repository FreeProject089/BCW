import { useEffect, useState, useRef } from 'react';
import BoringAvatar from 'boring-avatars';
import QRCode from 'qrcode';
import { User, Shield, ShieldCheck, Mail, CalendarDays, Shuffle, KeyRound, Check, Palette, Sparkles, ImagePlus, Trash2, FileArchive, Link2, BadgeCheck, Lock, Download, Eye, EyeOff, Settings as SettingsIcon, ArrowRight } from 'lucide-react';
import { api, uploadImage } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import { useToast, Button, Card, Badge, Input, Textarea, Field, PageHeader, Spinner } from './ui.jsx';
import { DiscordIcon } from './brand.jsx';
import Avatar, { VARIANTS, PALETTES, avatarOf } from './Avatar.jsx';
import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';

export default function Profile() {
  const { user, refresh } = useAuth();
  const { t } = useI18n(); const toast = useToast();
  const [form, setForm] = useState({ displayName: '', bio: '' });
  const [avatar, setAvatar] = useState({ variant: 'beam', seed: '', colors: PALETTES.orange, image: null });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({ displayName: user.displayName || '', bio: user.bio || '' });
    setAvatar(avatarOf(user));
  }, [user]);
  if (!user) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;

  const save = async () => {
    setBusy(true); setMsg('');
    try { await api.patch('/me', { ...form, avatar }); await refresh(); setMsg('saved'); setTimeout(() => setMsg(''), 2500); }
    catch { setMsg('error'); } finally { setBusy(false); }
  };
  const changePw = async () => {
    if (pw.next.length < 8) return setMsg('pwshort');
    if (pw.next !== pw.confirm) return setMsg('pwmismatch');
    setPwBusy(true); setMsg('');
    try { await api.post('/me/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', confirm: '' }); setMsg('pwok'); setTimeout(() => setMsg(''), 2500); }
    catch (x) { setMsg(x.data?.error === 'wrong_password' ? 'pwwrong' : 'error'); } finally { setPwBusy(false); }
  };
  const randomize = () => setAvatar((a) => ({ ...a, seed: Math.random().toString(36).slice(2, 10) }));
  // Custom palette: edit any of the five colors, or roll a fresh harmonious set.
  const setColorAt = (i, val) => setAvatar((a) => { const cols = [...(a.colors || [])]; cols[i] = val; return { ...a, colors: cols }; });
  const randomPalette = () => {
    const base = Math.floor(Math.random() * 360);
    const hsl = (h, s, l) => { // → hex
      h /= 360; const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h * 12) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    const cols = [0, 40, 80, 200, 320].map((off, i) => hsl((base + off) % 360, 0.6 + (i % 2) * 0.15, 0.45 + (i % 3) * 0.12));
    setAvatar((a) => ({ ...a, colors: cols }));
  };
  const colors = (avatar.colors && avatar.colors.length ? avatar.colors : PALETTES.orange).slice(0, 5);
  // Upload a custom profile photo (overrides the generated avatar).
  const pickPhoto = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => { const file = i.files?.[0]; if (!file) return; setUploading(true);
      try { const url = await uploadImage(file); setAvatar((a) => ({ ...a, image: url })); toast.success(t('prof.photook', 'Photo uploaded — save your profile.')); }
      catch { toast.error(t('prof.uploadfail', 'Upload failed.')); } finally { setUploading(false); } };
    i.click();
  };
  const removePhoto = () => setAvatar((a) => ({ ...a, image: null }));
  // Export every generated avatar variant (current seed + palette) as an SVG zip.
  const exportZip = async () => {
    try {
      const [{ default: JSZip }, { renderToStaticMarkup }] = await Promise.all([import('jszip'), import('react-dom/server')]);
      const zip = new JSZip();
      for (const v of VARIANTS) zip.file(`${v}.svg`, renderToStaticMarkup(<BoringAvatar size={256} name={avatar.seed || user.id} variant={v} colors={avatar.colors} />));
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `avatars-${(avatar.seed || user.id).slice(0, 8)}.zip`; a.click(); URL.revokeObjectURL(a.href);
      toast.success(t('prof.exported', 'Exported avatars.zip'));
    } catch { toast.error(t('prof.exportfail', 'Export failed.')); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader icon={User} title={t('prof.title', 'Profile')} subtitle={t('prof.sub', 'Manage your account, avatar and password.')}
        actions={<Link to="/dashboard"><Button variant="ghost"><LayoutDashboard size={15} /> {t('prof.godash', 'Go to dashboard')}</Button></Link>} />
      <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-6">
        {/* avatar */}
        <Card className="p-6 text-center self-start min-w-0">
          <Avatar variant={avatar.variant} seed={avatar.seed || user.id} colors={avatar.colors} image={avatar.image} size={120} className="mx-auto" />
          <div className="font-semibold mt-3">{form.displayName || user.displayName}</div>
          <Badge tone={user.role === 'SUPERADMIN' ? 'red' : user.role === 'ADMIN' ? 'amber' : 'primary'} className="mt-1">{user.role}</Badge>

          {/* custom photo */}
          <div className="grid grid-cols-2 gap-1.5 mt-4">
            <Button size="sm" disabled={uploading} onClick={pickPhoto}>{uploading ? <Spinner /> : <><ImagePlus size={14} /> {avatar.image ? t('prof.change', 'Change') : t('prof.uploadphoto', 'Upload photo')}</>}</Button>
            <Button size="sm" variant="ghost" disabled={!avatar.image} onClick={removePhoto}><Trash2 size={14} /> {t('prof.remove', 'Remove')}</Button>
          </div>
          {avatar.image && <div className="text-[11px] text-[var(--faint)] mt-2">{t('prof.customphoto', "Using a custom photo — the generated avatar below is hidden while it's set.")}</div>}

          <div className={avatar.image ? 'opacity-40 pointer-events-none' : ''}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-5 mb-1.5 text-left">{t('prof.style', 'Style')}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {VARIANTS.map((v) => (
              <button key={v} onClick={() => setAvatar((a) => ({ ...a, variant: v }))}
                className={`rounded-lg p-1 border ${avatar.variant === v ? 'border-[var(--primary)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} title={v}>
                <Avatar variant={v} seed={avatar.seed || user.id} colors={avatar.colors} size={48} />
              </button>
            ))}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-4 mb-1.5 text-left">{t('prof.presets', 'Presets')}</div>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(PALETTES).map(([name, cols]) => (
              <button key={name} onClick={() => setAvatar((a) => ({ ...a, colors: cols }))} title={name}
                className={`flex rounded-md overflow-hidden border ${JSON.stringify(avatar.colors) === JSON.stringify(cols) ? 'border-[var(--primary)]' : 'border-[var(--line)]'}`}>
                {cols.slice(0, 4).map((c, i) => <span key={i} style={{ background: c, width: 14, height: 22 }} />)}
              </button>
            ))}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-4 mb-1.5 text-left flex items-center gap-1"><Palette size={11} /> {t('prof.custompalette', 'Custom palette')}</div>
          {/* Fluid swatches: they share the row evenly at ANY width (no fixed gaps
              that used to jam the layout on phone screens). */}
          <div className="flex gap-1.5">
            {colors.map((col, i) => (
              <label key={i} className="relative flex-1 aspect-square max-w-[44px] rounded-md overflow-hidden border border-[var(--line)] cursor-pointer" title={`${t('prof.color', 'Color')} ${i + 1}`} style={{ background: col }}>
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(col) ? col : '#f97316'} onChange={(e) => setColorAt(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            ))}
          </div>
          <Button size="sm" className="w-full mt-3" onClick={randomPalette}><Sparkles size={14} /> {t('prof.randpalette', 'Random palette')}</Button>
          <Button size="sm" variant="ghost" className="w-full mt-1.5" onClick={randomize}><Shuffle size={14} /> {t('prof.randseed', 'Random seed')}</Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full mt-3" onClick={exportZip}><FileArchive size={14} /> {t('prof.exportavatars', 'Export avatars (.zip)')}</Button>
        </Card>

        {/* details + password */}
        <div className="min-w-0 space-y-6">
          <Card className="p-5 space-y-3">
            <Field label={t('prof.dispname', 'Display name')}><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label={t('prof.bio', 'Bio')}><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder={t('prof.bio.ph', 'A little about you…')} /></Field>
            <div className="flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('prof.saveprofile', 'Save profile')}</Button>
              {msg === 'saved' && <span className="text-sm text-emerald-400 flex items-center gap-1"><Check size={14} /> {t('prof.saved', 'Saved')}</span>}
              {msg === 'error' && <span className="text-sm text-red-400">{t('prof.failed', 'Failed')}</span>}</div>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--primary-2)]" /> {t('prof.changepw', 'Change password')}</div>
            <div className="grid sm:grid-cols-3 gap-3 mt-2">
              <Field label={t('prof.currentpw', 'Current password')}><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
              <Field label={t('prof.newpw', 'New password')}><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder={t('prof.pw8', '8+ characters')} /></Field>
              <Field label={t('prof.confirmnew', 'Confirm new')}><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder={t('prof.repeat', 'repeat')} /></Field>
            </div>
            <div className="flex items-center gap-3 mt-3"><Button disabled={pwBusy} onClick={changePw}>{pwBusy ? <Spinner /> : t('prof.updatepw', 'Update password')}</Button>
              {msg === 'pwok' && <span className="text-sm text-emerald-400 flex items-center gap-1"><Check size={14} /> {t('prof.updated', 'Updated')}</span>}
              {msg === 'pwwrong' && <span className="text-sm text-red-400">{t('prof.pwwrong', 'Wrong current password')}</span>}
              {msg === 'pwshort' && <span className="text-sm text-red-400">{t('prof.pwshort', 'Min 8 characters')}</span>}
              {msg === 'pwmismatch' && <span className="text-sm text-red-400">{t('prof.pwmismatch', "Passwords don't match")}</span>}</div>
          </Card>

          <TwoFactorCard />
          <CreatorLinks />
          <DiscordLinks />

          {/* Device preferences (intro animation, theme, language, translucency,
              cookies) all live on the Settings page now — link there instead of
              duplicating a single toggle here. */}
          <Link to="/settings" className="block">
            <Card className="p-5 flex items-center gap-3 hover:border-[var(--ring)] transition group">
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><SettingsIcon size={17} className="text-[var(--primary-2)]" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{t('prof.settings', 'Settings')}</div>
                <div className="text-xs text-[var(--muted)]">{t('prof.settings.d', 'Theme, language, intro animation, translucency & cookies.')}</div>
              </div>
              <ArrowRight size={16} className="text-[var(--faint)] group-hover:text-[var(--primary-2)] group-hover:translate-x-0.5 transition shrink-0" />
            </Card>
          </Link>

          <Card className="p-5">
            <button onClick={() => setShowInfo((s) => !s)} className="w-full flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">{showInfo ? <EyeOff size={14} className="text-[var(--primary-2)]" /> : <Eye size={14} className="text-[var(--primary-2)]" />} {t('prof.personalinfo', 'Personal info')}</span>
              <span className="text-xs text-[var(--faint)] font-normal">{showInfo ? t('prof.hide', 'Hide') : t('prof.show', 'Show')}</span>
            </button>
            {showInfo && (
              <div className="mt-3 text-sm text-[var(--muted)] space-y-2">
                <div className="flex items-center gap-2"><User size={14} /> {user.displayName}</div>
                <div className="flex items-center gap-2"><Mail size={14} /> {user.email}</div>
                <div className="flex items-center gap-2"><Shield size={14} /> {t('prof.role', 'Role:')} {user.role}</div>
                <div className="flex items-center gap-2"><CalendarDays size={14} /> {t('prof.membersince', 'Member since')} {new Date(user.createdAt).toLocaleDateString()}</div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Self-service TOTP 2FA: enroll (secret + confirm code -> one-time recovery codes),
// or disable (password + a current code/recovery code). An admin can never do
// either FOR another account — it's a personal auth factor. Also required (with a
// fresh step-up code) to reach the server-control tools once canControlServer is granted.
function TwoFactorCard() {
  const { user, refresh } = useAuth();
  const { t } = useI18n(); const toast = useToast();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [disablePw, setDisablePw] = useState(''); const [disableCode, setDisableCode] = useState('');
  const [disableErr, setDisableErr] = useState(null); // { field: 'pw'|'code', msg }
  const [busy, setBusy] = useState(false);

  const cardRef = useRef(null);
  const load = () => api.get('/me/2fa').then(setStatus).catch(() => setStatus({ enabled: false }));
  useEffect(() => { load(); }, []);

  // Onboarding deep-link (?setup2fa=1, set after signup / from the dashboard
  // nudge): scroll the card into view + auto-start enrollment when 2FA is off.
  useEffect(() => {
    if (!status || status.enabled) return;
    if (new URLSearchParams(window.location.search).get('setup2fa') !== '1') return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!setup) startSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const downloadRecoveryCodes = (codes) => {
    const date = new Date().toISOString().slice(0, 10);
    const uname = (user?.displayName || 'user').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const text = `BetterCommunity — two-factor recovery codes\nAccount: ${user?.email || ''}\nGenerated: ${date}\nEach code works once.\n\n${codes.join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${uname}_2FA_${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api.post('/me/2fa/setup'); setSetup(r);
      setQrDataUrl(await QRCode.toDataURL(r.otpauth, { width: 200, margin: 1 }).catch(() => null));
    } catch { toast.error(t('prof.2fa.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const confirmSetup = async () => {
    if (code.trim().length !== 6) return toast.error(t('prof.2fa.badcode', 'Enter the 6-digit code.'));
    setBusy(true);
    // refresh() re-fetches /me so user.totpEnabled flips in the auth context —
    // without it the admin dashboard's 2FA gate stays closed until a hard reload.
    try { const r = await api.post('/me/2fa/enable', { secret: setup.secret, code: code.trim() }); setRecoveryCodes(r.recoveryCodes); setSetup(null); setCode(''); load(); refresh(); toast.success(t('prof.2fa.enabled', 'Two-factor authentication enabled.')); }
    catch (x) { toast.error(x.data?.error === 'invalid_code' ? t('prof.2fa.badcode', 'Invalid code.') : t('prof.2fa.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const disable = async () => {
    setDisableErr(null);
    if (!disablePw.trim()) return setDisableErr({ field: 'pw', msg: t('prof.2fa.needpw', 'Enter your password.') });
    if (!disableCode.trim()) return setDisableErr({ field: 'code', msg: t('prof.2fa.needcode', 'Enter your current code or a recovery code.') });
    setBusy(true);
    try { await api.post('/me/2fa/disable', { password: disablePw, code: disableCode.trim() }); setDisablePw(''); setDisableCode(''); load(); refresh(); toast.success(t('prof.2fa.disabled', 'Two-factor authentication disabled.')); }
    catch (x) {
      const err = x.data?.error;
      setDisableErr(err === 'wrong_password' ? { field: 'pw', msg: t('prof.2fa.wrongpw', 'Wrong password.') }
        : err === 'invalid_code' ? { field: 'code', msg: t('prof.2fa.badcode2', 'Invalid code or recovery code.') }
        : { field: null, msg: t('prof.2fa.failed', 'Failed.') });
    } finally { setBusy(false); }
  };

  if (!status) return null;
  return (
    <div ref={cardRef} className="scroll-mt-24"><Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--primary-2)]" /> {t('prof.2fa.title', 'Two-factor authentication')} {status.enabled && <Badge tone="green">{t('prof.2fa.on', 'On')}</Badge>}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('prof.2fa.sub', 'Adds a 6-digit code from an authenticator app on top of your password.')}{status.canControlServer ? ` ${t('prof.2fa.required', 'Required to use the server-control tools.')}` : ''}</p>

      {recoveryCodes ? (
        <div className="mb-1">
          <div className="text-xs font-semibold text-amber-400 mb-1.5">{t('prof.2fa.recovery', 'Save these recovery codes — each works once if you lose your device. Shown only now.')}</div>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3">
            {recoveryCodes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="primary" onClick={() => downloadRecoveryCodes(recoveryCodes)}><Download size={13} /> {t('prof.2fa.downloadcodes', 'Download codes')}</Button>
            <Button size="sm" onClick={() => setRecoveryCodes(null)}>{t('prof.2fa.done', "I've saved them")}</Button>
          </div>
        </div>
      ) : status.enabled ? (
        <div className="space-y-2">
          <div className="text-xs text-[var(--faint)]">{t('prof.2fa.recoveryleft', '{n} recovery codes left.').replace('{n}', status.recoveryCodesLeft)}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input type="password" value={disablePw} onChange={(e) => { setDisablePw(e.target.value); setDisableErr(null); }} placeholder={t('prof.2fa.pwph', 'Your password')} className={disableErr?.field === 'pw' ? '!border-red-500/50' : ''} />
            <Input value={disableCode} onChange={(e) => { setDisableCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9)); setDisableErr(null); }} placeholder={t('prof.2fa.codeph', 'Current code or recovery code')} className={disableErr?.field === 'code' ? '!border-red-500/50' : ''} />
          </div>
          {disableErr && <div className="text-xs text-red-400">{disableErr.msg}</div>}
          <Button className="!text-red-400" disabled={busy} onClick={disable}>{busy ? <Spinner /> : t('prof.2fa.disable', 'Disable 2FA')}</Button>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">{t('prof.2fa.scan', 'Scan this in your authenticator app (Google Authenticator, Authy, …) — or enter the key manually — then confirm with the code it shows:')}</p>
          {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" width={160} height={160} className="rounded-lg border border-[var(--line)] bg-white p-1.5" />}
          <div className="text-xs font-mono bg-[var(--surface-2)] rounded-lg p-3 break-all">{setup.secret}</div>
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy} onClick={confirmSetup}>{busy ? <Spinner /> : t('prof.2fa.confirm', 'Confirm & enable')}</Button>
            <Button onClick={() => { setSetup(null); setQrDataUrl(null); }}>{t('prof.2fa.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" disabled={busy} onClick={startSetup}>{busy ? <Spinner /> : t('prof.2fa.enable', 'Enable 2FA')}</Button>
      )}
    </Card></div>
  );
}

// Link BMM creator id(s) to this account via a code BMM generates. 2-week unlink lock.
function CreatorLinks() {
  const { t } = useI18n();
  const [links, setLinks] = useState([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/me/creator-links').then((d) => setLinks(d.links || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const link = async () => {
    if (!code.trim()) return;
    setBusy(true); setMsg('');
    try { await api.post('/me/creator-links', { code: code.trim() }); setCode(''); setMsg('linked'); load(); setTimeout(() => setMsg(''), 2500); }
    catch (x) { setMsg(x.data?.error === 'already_linked' ? 'taken' : x.data?.error === 'invalid_or_expired' ? 'bad' : 'error'); }
    finally { setBusy(false); }
  };
  const unlink = async (l) => {
    try { await api.del(`/me/creator-links/${l.id}`); load(); }
    catch (x) { setMsg(x.status === 423 ? 'locked' : 'error'); setTimeout(() => setMsg(''), 3000); }
  };
  const fdate = (d) => new Date(d).toLocaleDateString();
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Link2 size={15} className="text-[var(--primary-2)]" /> {t('cl.title', 'Creator IDs')}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('cl.desc', "Link your BMM creator id(s). In BMM, generate a pairing code, then paste it here. One creator id links to one account; linked ids can't be unlinked for 2 weeks.")}</p>
      {links.length > 0 && <div className="space-y-2 mb-3">
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
            <BadgeCheck size={15} className="text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0"><div className="font-mono text-xs truncate">{l.creatorId}{l.displayName ? ` · ${l.displayName}` : ''}</div><div className="text-[11px] text-[var(--faint)]">{t('cl.linked', 'linked')} {fdate(l.linkedAt)}{l.locked ? ` · ${t('cl.unlockable', 'unlockable')} ${fdate(l.unlinkableAt)}` : ''}</div></div>
            {l.locked ? <Lock size={14} className="text-[var(--faint)]" title={t('cl.locked2w', 'Locked for 2 weeks')} /> : <button onClick={() => unlink(l)} className="text-[var(--faint)] hover:text-red-400" title={t('cl.unlink', 'Unlink')}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input value={code} maxLength={9} onChange={(e) => { const s = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); setCode(s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s); }} placeholder={t('cl.ph', 'Code from BMM (e.g. K7P39QMX)')} onKeyDown={(e) => e.key === 'Enter' && link()} />
        <Button variant="primary" disabled={busy} onClick={link}>{busy ? <Spinner /> : t('cl.link', 'Link')}</Button>
      </div>
      {msg === 'linked' && <div className="text-sm text-emerald-400 mt-2 flex items-center gap-1"><Check size={14} /> {t('cl.ok', 'Creator id linked.')}</div>}
      {msg === 'taken' && <div className="text-sm text-red-400 mt-2">{t('cl.taken', 'That creator id is already linked to another account.')}</div>}
      {msg === 'bad' && <div className="text-sm text-red-400 mt-2">{t('cl.bad', 'Invalid or expired code.')}</div>}
      {msg === 'locked' && <div className="text-sm text-red-400 mt-2">{t('cl.lockederr', "Locked — can't unlink within 2 weeks of linking.")}</div>}
      {msg === 'error' && <div className="text-sm text-red-400 mt-2">{t('cl.error', 'Something went wrong.')}</div>}
    </Card>
  );
}

// Link Discord account(s) to this BCWEB account via a code the bot's /link issues.
function DiscordLinks() {
  const { t } = useI18n();
  const [links, setLinks] = useState([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/me/discord/links').then((d) => setLinks(d.links || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const link = async () => {
    if (!code.trim()) return;
    setBusy(true); setMsg('');
    try { await api.post('/me/discord/redeem', { code: code.trim() }); setCode(''); setMsg('linked'); load(); setTimeout(() => setMsg(''), 2500); }
    catch (x) { setMsg(x.data?.error === 'already_linked' ? 'taken' : x.data?.error === 'invalid_or_expired' ? 'bad' : 'error'); }
    finally { setBusy(false); }
  };
  const unlink = async (l) => { try { await api.del(`/me/discord/links/${l.id}`); load(); } catch { setMsg('error'); setTimeout(() => setMsg(''), 2500); } };
  const fdate = (d) => new Date(d).toLocaleDateString();
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><DiscordIcon size={15} className="text-[var(--primary-2)]" /> Discord</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('disl.desc1', 'Link your Discord account. In the server, run')} <code>/link</code> {t('disl.desc2', 'to get a code, then paste it here — it unlocks gated channels and shows your account in the community.')}</p>
      {links.length > 0 && <div className="space-y-2 mb-3">
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
            <BadgeCheck size={15} className="text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0"><div className="text-xs truncate">{l.username || l.discordId}</div><div className="text-[11px] text-[var(--faint)]">{t('cl.linked', 'linked')} {fdate(l.linkedAt)}</div></div>
            <button onClick={() => unlink(l)} className="text-[var(--faint)] hover:text-red-400" title={t('cl.unlink', 'Unlink')}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input value={code} maxLength={9} onChange={(e) => { const s = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); setCode(s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s); }} placeholder={t('disl.ph', 'Code from /link (e.g. K7P39QMX)')} onKeyDown={(e) => e.key === 'Enter' && link()} />
        <Button variant="primary" disabled={busy} onClick={link}>{busy ? <Spinner /> : t('cl.link', 'Link')}</Button>
      </div>
      {msg === 'linked' && <div className="text-sm text-emerald-400 mt-2 flex items-center gap-1"><Check size={14} /> {t('disl.ok', 'Discord linked.')}</div>}
      {msg === 'taken' && <div className="text-sm text-red-400 mt-2">{t('disl.taken', 'That Discord account is already linked.')}</div>}
      {msg === 'bad' && <div className="text-sm text-red-400 mt-2">{t('cl.bad', 'Invalid or expired code.')}</div>}
      {msg === 'error' && <div className="text-sm text-red-400 mt-2">{t('cl.error', 'Something went wrong.')}</div>}
    </Card>
  );
}
