import { useEffect, useState, useRef } from 'react';
import BoringAvatar from 'boring-avatars';
import QRCode from 'qrcode';
import { User, Shield, ShieldCheck, Mail, CalendarDays, Shuffle, KeyRound, Check, Palette, Sparkles, ImagePlus, Trash2, FileArchive, Link2, BadgeCheck, Lock, Download, Eye, EyeOff, Settings as SettingsIcon, ArrowRight, Plus } from 'lucide-react';
import { api, uploadImage } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, Spinner, copyText } from '../ui/ui.jsx';
import { DiscordIcon, KofiIcon } from '../ui/brand.jsx';
import Avatar, { VARIANTS, PALETTES, avatarOf } from '../ui/Avatar.jsx';
import { Badges } from '../ui/Badges.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Copy, RefreshCw, Terminal, Smartphone, Fingerprint, Youtube, Twitch, Gamepad2, Github, X, Monitor, Tablet, MapPin, LogOut, Globe } from 'lucide-react';
import { stagePending, addLocalAccount, attachBackupCodesBySecret } from '../lib/twofa-lib.js';
import { TotpQuickFill } from './twofa-fill.jsx';

// A small section heading used to group the profile cards into clear zones
// (Public profile / Security / Connections / Account) instead of one flat stack.
// The four things people come here to do. Kept out of the component so the strip is one
// readable line and the labels stay next to each other rather than scattered through JSX.
const PROFILE_TABS = [
  ['account', User, (t) => t('prof.tab.account', 'Account')],
  ['security', ShieldCheck, (t) => t('prof.tab.security', 'Security')],
  ['links', Link2, (t) => t('prof.tab.links', 'Connections')],
  ['more', Terminal, (t) => t('prof.tab.more', 'Developer & more')],
];

function SectionLabel({ icon: Ico, children }) {
  return <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--faint)]"><Ico size={13} className="text-[var(--primary-2)]" /> {children}</div>;
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const { t } = useI18n(); const toast = useToast();
  // The tab lives in the URL, so "your security settings" can be a link and Back does what
  // the tabs make you expect. An unknown value falls back to Account rather than to a blank
  // pane — a stale link should land somewhere real.
  const [sp, setSp] = useSearchParams();
  const wanted = sp.get('tab');
  const tab = PROFILE_TABS.some(([id]) => id === wanted) ? wanted : 'account';
  const setTab = (id) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });
  const [form, setForm] = useState({ displayName: '', bio: '', profilePublic: true, showConnections: [], website: '' });
  const [avatar, setAvatar] = useState({ variant: 'beam', seed: '', colors: PALETTES.orange, image: null });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // The one-time notifications key minted by the link, if the server sent one.

  useEffect(() => {
    if (!user) return;
    setForm({ displayName: user.displayName || '', bio: user.bio || '', profilePublic: user.profilePublic !== false, showConnections: user.showConnections || [], website: user.website || '' });
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
    <div className="max-w-4xl">
      <PageHeader icon={User} title={t('prof.title', 'Profile')} subtitle={t('prof.sub', 'Manage your account, avatar and password.')}
        actions={<Link to="/dashboard"><Button variant="ghost"><LayoutDashboard size={15} /> {t('prof.godash', 'Go to dashboard')}</Button></Link>} />
      <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-6">
        {/* avatar — sticky on desktop so it stays in view while scrolling the sections */}
        <Card className="p-6 text-center self-start min-w-0 md:sticky md:top-20">
          <Avatar variant={avatar.variant} seed={avatar.seed || user.id} colors={avatar.colors} image={avatar.image} size={120} className="mx-auto" />
          <div className="font-semibold mt-3">{form.displayName || user.displayName}</div>
          {user.bcId && <button onClick={() => { navigator.clipboard?.writeText(user.bcId); toast.success(t('prof.bcidcopied', 'BC id copied.')); }}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary)] transition" title={t('prof.bcidcopy', 'Your unique BetterCommunity id — click to copy')}>
            <Fingerprint size={11} /> {user.bcId} <Copy size={10} /></button>}
          <div><Badge tone={user.role === 'SUPERADMIN' ? 'red' : user.role === 'ADMIN' ? 'amber' : 'primary'} className="mt-1">{user.role}</Badge></div>

          {/* custom photo */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            <Button size="sm" disabled={uploading} onClick={pickPhoto}>{uploading ? <Spinner /> : <><ImagePlus size={14} /> {avatar.image ? t('prof.change', 'Change') : t('prof.uploadphoto', 'Upload photo')}</>}</Button>
            <Button size="sm" variant="ghost" disabled={!avatar.image} onClick={removePhoto}><Trash2 size={14} /> {t('prof.remove', 'Remove')}</Button>
          </div>
          {avatar.image && <div className="text-[11px] text-[var(--faint)] mt-2">{t('prof.customphoto', "Using a custom photo — the generated avatar below is hidden while it's set.")}</div>}

          <div className={avatar.image ? 'opacity-40 pointer-events-none' : ''}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-5 mb-1.5 text-left">{t('prof.style', 'Style')}</div>
          <div className="grid grid-cols-3 gap-2">
            {VARIANTS.map((v) => (
              <button key={v} onClick={() => setAvatar((a) => ({ ...a, variant: v }))}
                className={`press rounded-xl p-1 border ${avatar.variant === v ? 'border-[var(--primary)] ring-2 ring-[var(--ring)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} title={v}>
                <Avatar variant={v} seed={avatar.seed || user.id} colors={avatar.colors} size={48} />
              </button>
            ))}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-4 mb-1.5 text-left">{t('prof.presets', 'Presets')}</div>
          {/* Give the presets room to breathe: a 3-col grid of taller chips instead of a
              cramped wrap row — reads cleanly on a phone where the card is full-width. */}
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PALETTES).map(([name, cols]) => (
              <button key={name} onClick={() => setAvatar((a) => ({ ...a, colors: cols }))} title={name}
                className={`press flex h-9 rounded-lg overflow-hidden border ${JSON.stringify(avatar.colors) === JSON.stringify(cols) ? 'border-[var(--primary)] ring-2 ring-[var(--ring)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                {cols.slice(0, 4).map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
              </button>
            ))}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mt-4 mb-1.5 text-left flex items-center gap-1"><Palette size={11} /> {t('prof.custompalette', 'Custom palette')}</div>
          {/* Fluid swatches: they share the row evenly at ANY width, with room to breathe. */}
          <div className="flex gap-2">
            {colors.map((col, i) => (
              <label key={i} className="press relative flex-1 aspect-square max-w-[48px] rounded-lg overflow-hidden border border-[var(--line)] hover:border-[var(--line-strong)] cursor-pointer" title={`${t('prof.color', 'Color')} ${i + 1}`} style={{ background: col }}>
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(col) ? col : '#f97316'} onChange={(e) => setColorAt(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            ))}
          </div>
          <Button size="sm" className="w-full mt-3" onClick={randomPalette}><Sparkles size={14} /> {t('prof.randpalette', 'Random palette')}</Button>
          <Button size="sm" variant="ghost" className="w-full mt-1.5" onClick={randomize}><Shuffle size={14} /> {t('prof.randseed', 'Random seed')}</Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full mt-3" onClick={exportZip}><FileArchive size={14} /> {t('prof.exportavatars', 'Export avatars (.zip)')}</Button>
        </Card>

        {/* Four tabs, not eleven stacked cards.
            Everything here is something you came to do exactly one of — change your name,
            turn on 2FA, link Discord, close the account. Stacking all of it meant scrolling
            past ten things you were not there for, every time. The tab lives in the URL so a
            link to "your security settings" is a link, and so the browser Back button works
            the way the tabs make you expect. */}
        <div className="min-w-0">
          <div className="inline-flex flex-wrap rounded-[12px] bg-[var(--surface-2)] p-0.5 mb-5">
            {PROFILE_TABS.map(([id, icon, label]) => {
              const Ico = icon;
              return (
                <button key={id} onClick={() => setTab(id)}
                  className={`px-3 py-1.5 rounded-[10px] text-sm flex items-center gap-1.5 ${tab === id ? 'bg-[var(--bg-solid)] font-medium shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                  <Ico size={13} /> {label(t)}
                </button>
              );
            })}
          </div>
          <div className="space-y-7">
          {/* Account facts lead the page (name / email / role / member since) — the
              most-referenced info, so it sits at the top instead of buried in a
              collapsible at the bottom. */}
          {tab === 'account' && <div>
          <SectionLabel icon={User}>{t('prof.sec.account2', 'Account')}</SectionLabel>
          <AccountInfoCard user={user} />
          </div>}

          {tab === 'account' && <div>
          <SectionLabel icon={Sparkles}>{t('prof.sec.public', 'Public profile')}</SectionLabel>
          <Card className="p-5 space-y-3">
            <Field label={t('prof.dispname', 'Display name')}><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label={t('prof.bio', 'Bio')}><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder={t('prof.bio.ph', 'A little about you…')} /></Field>
            <Field label={t('prof.website', 'Website (optional)')}><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" /></Field>
            <div className="flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('prof.saveprofile', 'Save profile')}</Button>
              {msg === 'saved' && <span className="text-sm text-success flex items-center gap-1"><Check size={14} /> {t('prof.saved', 'Saved')}</span>}
              {msg === 'error' && <span className="text-sm text-error">{t('prof.failed', 'Failed')}</span>}</div>
          </Card>

          {/* Privacy + visibility of the shareable /u/<id> profile. */}
          <Card className="p-5 space-y-3 mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold flex items-center gap-2"><Eye size={15} className="text-[var(--primary-2)]" /> {t('prof.visibility', 'Profile visibility')}</div>
                <p className="text-xs text-[var(--muted)] mt-0.5">{t('prof.visibility.d', 'Public shows your name, badges, join date and public repos — never your email. Private: only you and staff.')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link to={`/u/${user.id}`}><Button size="sm" variant="ghost"><ArrowRight size={14} /> {t('prof.viewpublic', 'View')}</Button></Link>
                <Link to="/users"><Button size="sm" variant="ghost">{t('prof.findpeople', 'Find people')}</Button></Link>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.profilePublic} onChange={(e) => setForm({ ...form, profilePublic: e.target.checked })} /> {t('prof.makepublic', 'Make my profile public')}</label>
            <div>
              <div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-1.5">{t('prof.showconn', 'Connections to show')}</div>
              <div className="flex flex-wrap gap-3">
                {[['github', 'GitHub'], ['discord', 'Discord'], ['bmm', 'BMM (creator id)'], ['website', t('prof.website2', 'Website')]]
                  .filter(([k]) => k === 'website' ? !!user.website
                    : k === 'github' ? (user.oauthAccounts?.some((a) => a.provider === 'github') || user.socialConnections?.some((c) => c.provider === 'github'))
                    : k === 'discord' ? (user._count?.discordLinks > 0)
                    : k === 'bmm' ? (user._count?.creatorLinks > 0) : true)
                  .map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.showConnections.includes(k)} onChange={(e) => setForm({ ...form, showConnections: e.target.checked ? [...form.showConnections, k] : form.showConnections.filter((x) => x !== k) })} /> {label}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('prof.showconn.d', 'Only the ones you actually linked will appear. Nothing is shown by default.')}</p>
            </div>
            <div className="flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('prof.saveprivacy', 'Save privacy')}</Button></div>
          </Card>

          {/* Badges earned — shown next to your name across the site. */}
          {user.badges?.length > 0 && <Card className="p-5 mt-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><BadgeCheck size={15} className="text-[var(--primary-2)]" /> {t('prof.badges', 'Your badges')}</div>
            <div className="flex flex-wrap gap-2">
              {user.badges.map((ub) => (
                <span key={ub.badge.id} className="inline-flex items-center gap-1.5 text-sm rounded-lg px-2.5 py-1.5 border border-[var(--line)]" style={{ background: `color-mix(in srgb, ${ub.badge.color} 10%, transparent)` }} title={ub.badge.description}>
                  <Badges badges={[{ id: ub.badge.id, iconType: ub.badge.iconType, icon: ub.badge.icon, color: ub.badge.color, name: ub.badge.name }]} size={15} /> {ub.badge.name}
                </span>
              ))}
            </div>
          </Card>}
          </div>}

          {tab === 'security' && <div className="space-y-4">
          <SectionLabel icon={ShieldCheck}>{t('prof.sec.security', 'Security')}</SectionLabel>
          {/* 2FA leads Security — it now gates repo creation and server-control access, so
              it's the most important thing to set up. Password change sits below it. */}
          <TwoFactorCard />
          <Card className="p-5">
            <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--primary-2)]" /> {t('prof.changepw', 'Change password')}</div>
            <p className="text-xs text-[var(--muted)] mb-3">{t('prof.changepw.d', 'Use a strong password you don’t reuse anywhere else.')}</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label={t('prof.currentpw', 'Current password')}><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} aria-invalid={msg === 'pwwrong' || undefined} /></Field>
              <Field label={t('prof.newpw', 'New password')}><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder={t('prof.pw8', '8+ characters')} aria-invalid={msg === 'pwshort' || undefined} /></Field>
              <Field label={t('prof.confirmnew', 'Confirm new')}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder={t('prof.repeat', 'repeat')} aria-invalid={msg === 'pwmismatch' || undefined} /></Field>
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap"><Button disabled={pwBusy} onClick={changePw}>{pwBusy ? <Spinner /> : t('prof.updatepw', 'Update password')}</Button>
              {msg === 'pwok' && <span className="text-sm text-[var(--success)] flex items-center gap-1"><Check size={14} /> {t('prof.updated', 'Updated')}</span>}
              {msg === 'pwwrong' && <span className="text-sm text-[var(--error)]">{t('prof.pwwrong', 'Wrong current password')}</span>}
              {msg === 'pwshort' && <span className="text-sm text-[var(--error)]">{t('prof.pwshort', 'Min 8 characters')}</span>}
              {msg === 'pwmismatch' && <span className="text-sm text-[var(--error)]">{t('prof.pwmismatch', "Passwords don't match")}</span>}</div>
          </Card>
          <SessionsCard />
          <TransfersCard />
          </div>}

          {tab === 'links' && <div className="space-y-4">
          <SectionLabel icon={Link2}>{t('prof.sec.connections', 'Connections')}</SectionLabel>
          <CreatorLinks />
          <DiscordLinks />
          <SocialConnections />
          </div>}

          {tab === 'more' && <div className="space-y-4">
          <SectionLabel icon={Terminal}>{t('prof.sec.developer', 'Developer & preferences')}</SectionLabel>
          {/* The credentials moved to /dev/config. A page you open to change your display
              name is not where you go to rotate a key a deployment runs on, and keeping a
              second copy here would mean two places to fix whenever either changes. */}
          <DevPointerCard />
          <CloseAccountCard />

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
          </div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Read-only account facts, shown at the TOP of the profile (name / email / role /
// member since). Email is masked by default with a one-tap reveal so it's safe to have
// on screen while sharing.
// Ownership transfers, both directions in one card.
//
// Incoming first and unmissable: an offer sitting unanswered is somebody else waiting, and
// it expires. Outgoing is below, mostly so you can take one back.
//
// Nothing here is optimistic. Accepting moves real ownership on the server, and showing it
// as done before the server agrees would mean a refresh could take it away again — the one
// place a hopeful UI turns into "did that work or not?".
function TransfersCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api.get('/me/transfers').then(setData).catch(() => setData({ incoming: [], outgoing: [] }));
  useEffect(() => { load(); }, []);

  const ERRORS = (e) => ({
    expired: t('tr.err.expired', 'That offer has expired.'),
    not_pending: t('tr.err.gone', 'That offer is no longer open.'),
    no_longer_owned: t('tr.err.notowned', 'The sender no longer owns it — the offer has been withdrawn.'),
    active_subscription: t('tr.err.sub', 'It has an active hosting subscription. That has to be cancelled or moved first.'),
    free_plan: t('tr.err.free', 'It is on the free plan, and the free tier is one per account — the person receiving it could not hold it without spending a free claim they never made. Delete it and let them create their own.'),
  }[e] || t('prof.failed', 'Failed.'));

  const act = async (tr, kind) => {
    if (kind === 'accept') {
      const what = tr.kind === 'repo' ? t('tr.repo', 'repository') : t('tr.item', 'catalog item');
      if (!await dialog.confirm({
        title: t('tr.accept.t', 'Take ownership?'),
        message: t('tr.accept.m', 'The {what} “{n}” becomes yours: its content, its storage, and anything reported about it. {who} loses access to it.')
          .replace('{what}', what).replace('{n}', tr.targetName).replace('{who}', tr.counterparty.displayName),
        okLabel: t('tr.accept', 'Accept'),
      })) return;
    }
    setBusy(tr.id);
    try {
      await api.post(`/me/transfers/${tr.id}/${kind === 'accept' ? 'accept' : 'decline'}`);
      toast.success(kind === 'accept' ? t('tr.accepted', 'It is yours.') : t('tr.declined', 'Declined.'));
      await load();
    } catch (x) { toast.error(ERRORS(x.data?.error)); await load(); }
    finally { setBusy(''); }
  };

  const incoming = (data?.incoming || []).filter((x) => x.status === 'pending');
  const outgoing = (data?.outgoing || []).filter((x) => x.status === 'pending');
  const past = [...(data?.incoming || []), ...(data?.outgoing || [])]
    .filter((x) => x.status !== 'pending').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);

  // Hidden entirely when there is nothing to show: an empty card on a profile is furniture.
  if (!data || (!incoming.length && !outgoing.length && !past.length)) return null;

  const days = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 864e5));

  return (
    <Card className="p-5" id="transfers">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <ArrowRight size={15} className="text-[var(--primary-2)]" /> {t('tr.title', 'Ownership transfers')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('tr.sub', 'Nothing moves until it is accepted. Taking something on means taking on its storage and whatever is reported about it.')}
      </p>

      {incoming.map((tr) => (
        <div key={tr.id} className="rounded-lg border border-[var(--primary-2)] bg-[var(--surface-2)]/40 p-3 mb-2">
          <div className="text-[13px]">
            {t('tr.offered', '{who} offers you the {what} “{n}”.')
              .replace('{who}', tr.counterparty.displayName)
              .replace('{what}', tr.kind === 'repo' ? t('tr.repo', 'repository') : t('tr.item', 'catalog item'))
              .replace('{n}', tr.targetName)}
          </div>
          {tr.message && <p className="text-[12px] text-[var(--muted)] mt-1 pl-2 border-l-2 border-[var(--line)]">{tr.message}</p>}
          <div className="text-[11px] text-[var(--faint)] mt-1">{t('tr.expires', 'Expires in {n} day(s)').replace('{n}', String(days(tr.expiresAt)))}</div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="primary" disabled={busy === tr.id} onClick={() => act(tr, 'accept')}>{t('tr.accept', 'Accept')}</Button>
            <Button size="sm" disabled={busy === tr.id} onClick={() => act(tr, 'decline')}>{t('tr.decline', 'Decline')}</Button>
          </div>
        </div>
      ))}

      {outgoing.map((tr) => (
        <div key={tr.id} className="flex items-center gap-3 py-2 border-t border-[var(--line)] text-[13px]">
          <div className="min-w-0 flex-1">
            <div className="truncate">{t('tr.sent', 'You offered “{n}” to {who}').replace('{n}', tr.targetName).replace('{who}', tr.counterparty.displayName)}</div>
            <div className="text-[11px] text-[var(--faint)]">{t('tr.await', 'Waiting — expires in {n} day(s)').replace('{n}', String(days(tr.expiresAt)))}</div>
          </div>
          <Button size="sm" variant="ghost" disabled={busy === tr.id} onClick={() => act(tr, 'decline')}>{t('tr.cancel', 'Take back')}</Button>
        </div>
      ))}

      {past.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] text-[var(--faint)] cursor-pointer select-none">{t('tr.past', 'Earlier transfers')}</summary>
          <div className="mt-1">
            {past.map((tr) => (
              <div key={tr.id} className="flex items-center gap-2 py-1 text-[12px] text-[var(--muted)]">
                <span className="truncate flex-1">{tr.targetName}</span>
                <span className="text-[11px] text-[var(--faint)]">{t(`tr.st.${tr.status}`, tr.status)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

// Closing the account.
//
// Last card on the page and quiet about it — this is not a thing to stumble into. But it
// is genuinely reachable: an account you cannot leave is a worse thing to have than a
// delete button placed slightly too prominently.
//
// The blockers are the substance. "You still own three things" is useless; what is needed
// is what they are and where to deal with them, which is why the API returns a page per
// blocker and this only has to link there.
const CLOSURE_REASONS = ['not_using', 'too_expensive', 'missing_feature', 'privacy', 'moved_elsewhere', 'other'];

function CloseAccountCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [survey, setSurvey] = useState(null); // { reason, comment } once closure is requested

  const load = () => api.get('/me/closure').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const label = (b) => ({
    subscription: t('acl.b.sub', '{n} active subscription(s)'),
    pool: t('acl.b.pool', '{n} storage pool(s)'),
    repo: t('acl.b.repo', '{n} repository(ies) you own'),
    item: t('acl.b.item', '{n} catalog item(s) you own'),
  }[b.kind] || b.kind).replace('{n}', String(b.count));

  const request = async () => {
    if (!await dialog.confirm({
      title: t('acl.req.t', 'Close this account?'),
      message: t('acl.req.m', 'It closes in {n} days, not today. Until then nothing is deleted and one click puts it back — we email you the link, along with every invoice you have, because afterwards there is no account to fetch them from.').replace('{n}', String(data.graceDays)),
      okLabel: t('acl.req.ok', 'Schedule the closure'),
      danger: true,
    })) return;
    setBusy(true);
    try {
      const r = await api.post('/me/closure');
      toast.success(t('acl.req.done', 'Scheduled. Check your email — the cancel link is in it.'));
      await load();
      // Asked only now, once it is already scheduled: a form standing between somebody
      // and leaving stops being a question and becomes an obstacle.
      setSurvey({ reason: '', comment: '' });
      return r;
    } catch (x) {
      if (x.data?.error === 'has_blockers') { toast.error(t('acl.req.blocked', 'Some things still belong to this account.')); await load(); }
      else toast.error(t('prof.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try { await api.post('/me/closure/cancel'); toast.success(t('acl.kept', 'Closure cancelled — your account stays.')); setSurvey(null); await load(); }
    catch { toast.error(t('prof.failed', 'Failed.')); } finally { setBusy(false); }
  };

  const sendSurvey = async () => {
    try { await api.post('/me/closure/survey', { outcome: 'closed', reason: survey.reason, comment: survey.comment }); }
    catch { /* an unanswered survey must never look like a failed closure */ }
    setSurvey(null);
    toast.success(t('acl.survey.thanks', 'Thank you — that is genuinely useful.'));
  };

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Trash2 size={15} className="text-[var(--error)]" /> {t('acl.title', 'Close my account')}
      </div>

      {data.pending ? (
        <>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            {t('acl.pending', 'Scheduled to close on {d}. Your repositories, catalogs and items are suspended in the meantime — nothing is deleted, and cancelling puts every one of them back exactly as it was. Cancel any time before then, here or with the link in your email.')
              .replace('{d}', new Date(data.scheduledFor).toLocaleDateString())}
          </p>
          <Button className="mt-3" variant="primary" disabled={busy} onClick={cancel}>{busy ? <Spinner /> : t('acl.keep', 'Keep my account')}</Button>

          {survey && (
            <div className="mt-4 pt-3 border-t border-[var(--line)] space-y-3">
              <p className="text-[13px] text-[var(--muted)]">{t('acl.survey.s2', 'Before you go — what pushed you to this? Optional, and it changes nothing about the closure.')}</p>
              <Field label={t('acl.survey.reason', 'Main reason')}>
                <Select value={survey.reason} onChange={(e) => setSurvey((v) => ({ ...v, reason: e.target.value }))}>
                  <option value="">{t('acl.survey.pick', 'Prefer not to say')}</option>
                  {CLOSURE_REASONS.map((r) => <option key={r} value={r}>{t(`acl.reason.${r}`, r)}</option>)}
                </Select>
              </Field>
              <Field label={t('acl.survey.more', 'Anything else (optional)')}>
                <Textarea rows={3} value={survey.comment} onChange={(e) => setSurvey((v) => ({ ...v, comment: e.target.value }))} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" onClick={sendSurvey}>{t('acl.survey.send', 'Send')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSurvey(null)}>{t('acl.survey.skip', 'Skip')}</Button>
              </div>
            </div>
          )}
        </>
      ) : data.blockers.length ? (
        <>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            {t('acl.blocked', 'These still belong to this account. Transfer them to someone else or delete them, then closing becomes available.')}
          </p>
          <div className="mt-2 space-y-1">
            {data.blockers.map((b) => (
              <div key={b.kind} className="flex items-center gap-2 text-[13px]">
                <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                <span className="flex-1">{label(b)}</span>
                <Link to={b.where} className="text-[var(--primary-2)] hover:underline text-xs">{t('acl.goto', 'Go there')}</Link>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            {t('acl.ready', 'Nothing is in the way. Closing takes {n} days, during which one click brings it all back. Your invoices and moderation records are kept either way — they are records about transactions, not about your profile.')
              .replace('{n}', String(data.graceDays))}
          </p>
          {/* Said before the button, not in the confirmation: the two facts people get
              wrong are that the grace period ends for good, and that coming back with the
              same address is not a fresh start. Both are easier to accept than to discover. */}
          <p className="text-[13px] text-[var(--muted)] mt-2">
            {t('acl.final', 'After those {n} days it cannot be undone — there is no restore, and support cannot bring the account back. If you later sign up again with this same email address, we recognise it and reattach your history, including any moderation record; a different address starts genuinely fresh.')
              .replace('{n}', String(data.graceDays))}
          </p>
          <Button className="mt-3" disabled={busy} onClick={request}>{busy ? <Spinner /> : t('acl.start', 'Close my account…')}</Button>
        </>
      )}
    </Card>
  );
}

function AccountInfoCard({ user }) {
  const { t } = useI18n();
  const [showEmail, setShowEmail] = useState(false);
  const maskEmail = (e) => {
    if (!e) return '';
    const [u, d] = e.split('@');
    if (!d) return '•'.repeat(e.length);
    const um = u.length <= 2 ? u[0] + '•' : u.slice(0, 2) + '•'.repeat(Math.max(1, u.length - 2));
    return `${um}@${d}`;
  };
  const rows = [
    { icon: User, label: t('prof.info.name', 'Display name'), value: user.displayName },
    { icon: Mail, label: t('prof.info.email', 'Email'), value: showEmail ? user.email : maskEmail(user.email),
      action: <button onClick={() => setShowEmail((v) => !v)} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={showEmail ? t('prof.hide', 'Hide') : t('prof.show', 'Show')} aria-label={showEmail ? t('prof.hide', 'Hide') : t('prof.show', 'Show')}>{showEmail ? <EyeOff size={13} /> : <Eye size={13} />}</button> },
    { icon: Shield, label: t('prof.info.role', 'Role'), value: <Badge tone={user.role === 'SUPERADMIN' ? 'red' : user.role === 'ADMIN' ? 'amber' : 'primary'}>{user.role}</Badge> },
    { icon: CalendarDays, label: t('prof.info.since', 'Member since'), value: new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
  ];
  return (
    <Card className="p-5">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><r.icon size={16} className="text-[var(--primary-2)]" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{r.label}</div>
              <div className="text-sm font-medium truncate flex items-center gap-2">{r.value}{r.action}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// API keys: several per account, each named and scoped. The secret is shown ONCE, at
// creation, and never again — the server only keeps its hash, so there is nothing to
// re-reveal. That is the whole difference from the legacy single token above, which sat
// in the database in clear and was re-readable from this page forever.
// Where this account is signed in. A session is one account on one device: the row is
// created at sign-in and ends when it is revoked, the cookie expires, or that device
// signs out.
//
// The question this card answers is "is any of these not me?", so what makes a session
// recognisable leads: where it is, what it runs on, when it was last used. The current
// device is pinned first and outlined -- a list where you cannot tell which one you are
// reading it from invites people to revoke themselves.
function SessionsCard() {
  const { t } = useI18n(); const toast = useToast();
  const [data, setData] = useState(undefined);      // undefined = loading
  const [busy, setBusy] = useState(false);
  // What the user asked to revoke, held until they have re-authenticated. `'others'` is
  // the sign-out-everywhere-else action; anything else is a session id.
  const [pending, setPending] = useState(null);
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.get('/me/sessions')
    // `reauth` says which proofs the server will actually check for this account.
    // Defaulted to BOTH on a failed/old response: asking for something unnecessary is a
    // nuisance, while hiding a field the server requires makes the button silently fail.
    .then((r) => setData({ sessions: r.sessions || [], currentTracked: r.currentTracked, reauth: r.reauth || { password: true, totp: true } }))
    .catch(() => setData({ sessions: [], currentTracked: true, reauth: { password: true, totp: true } }));
  useEffect(() => { load(); }, []);

  // Revoking a device you do not recognise is a security action: it takes effect at once,
  // with no undo window. That is deliberately the opposite of the API-key card below --
  // an undo here would keep a possibly hostile session alive for another six seconds.
  // Signing a device out is re-authenticated server-side: a stolen session cookie must not
  // be able to evict the real owner. The client's job is only to collect the password (and
  // the TOTP code when 2FA is on) and to say precisely which one the server refused —
  // "Failed." would leave you retyping a password that was already right.
  const confirmRevoke = async () => {
    setBusy(true); setErr('');
    const body = { password: pw, code };
    try {
      if (pending === 'others') {
        const r = await api.del('/me/sessions', body);
        toast.success(t('prof.sess.revokedOthers', 'Signed out everywhere else.') + (r.revoked ? ' (' + r.revoked + ')' : ''));
      } else {
        await api.del('/me/sessions/' + pending, body);
        toast.success(t('prof.sess.revoked', 'Signed out on that device.'));
      }
      setPending(null); setPw(''); setCode('');
      await load();
    } catch (x) {
      const e = x.data?.error;
      setErr(e === 'wrong_password' ? t('prof.sess.badpw', 'Wrong password.')
        : e === 'bad_code' ? t('prof.sess.badcode', 'Wrong 2FA code.')
        : t('prof.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const cancelRevoke = () => { setPending(null); setPw(''); setCode(''); setErr(''); };

  // Same shape as the other timeAgo helpers here (App.jsx, repo-dashboard.jsx), which
  // this codebase deliberately keeps per-page.
  const ago = (ts) => {
    const sec = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (sec < 60) return t('prof.sess.now', 'just now');
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h';
    return Math.floor(sec / 86400) + 'd';
  };
  // ISO-3166 alpha-2 -> regional-indicator pair. Empty for anything that is not two
  // letters, so a missing or odd country never renders as stray glyphs.
  const flag = (cc) => (/^[A-Za-z]{2}$/.test(cc || '')
    ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)))
    : '');
  const place = (sess) => [sess.city, sess.region, sess.country].filter(Boolean).join(', ');
  const DeviceIcon = ({ kind }) => kind === 'mobile'
    ? <Smartphone size={16} />
    : kind === 'tablet' ? <Tablet size={16} /> : <Monitor size={16} />;

  const sessions = data?.sessions || [];
  const needPw = data?.reauth?.password !== false;
  const needCode = data?.reauth?.totp === true;
  // Current first; the API already sorts the rest by last activity, and a stable sort
  // keeps that order underneath.
  const ordered = [...sessions].sort((x, y) => (y.current ? 1 : 0) - (x.current ? 1 : 0));
  const others = sessions.filter((x) => !x.current).length;

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Monitor size={15} className="text-[var(--primary-2)]" /> {t('prof.sess.title', 'Signed-in devices')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('prof.sess.sub', 'Do not recognise one? Sign it out — it stops working immediately.')}
      </p>

      {pending && (
        <div className="mb-3 p-3 rounded-lg border border-[var(--primary-2)] bg-[var(--surface-2)]">
          <div className="text-[12px] font-semibold mb-1">
            {pending === 'others'
              ? t('prof.sess.confirmOthers', 'Sign out every other device?')
              : t('prof.sess.confirmOne', 'Sign this device out?')}
          </div>
          <p className="text-[11px] text-[var(--muted)] mb-2">
            {t('prof.sess.confirmWhy', 'Confirm it is you: this is the screen someone would use to lock you out of your own account.')}
          </p>
          <div className="flex flex-col gap-2">
            {/* Both fields are conditional on what this account HAS. The password box used
                to be unconditional, so an OAuth-only account (Discord / GitHub — no
                password hash at all) met a required-looking field it could never fill on
                the one screen that exists to evict an intruder. The 2FA box was shown to
                everyone as "(if enabled)", which reads like a demand rather than a note. */}
            {needPw && (
              <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder={t('prof.currentpw', 'Current password')} />
            )}
            {needCode && (
              <>
                <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6}
                  placeholder={t('prof.sess.code2', '6-digit code from your authenticator')} />
                {/* This site has its own authenticator (/2fa). If the code for this very
                    account is stored in it, take it from there rather than making the
                    user open a second tab to copy six digits. */}
                <TotpQuickFill onFill={(c) => setCode(c)} />
              </>
            )}
            {!needPw && !needCode && (
              <p className="text-[11px] text-[var(--muted)]">
                {t('prof.sess.noproof', 'This account signs in through a provider and has no second factor, so there is nothing extra to type — just confirm.')}
              </p>
            )}
            {err && <span className="text-[11px] text-[var(--error)]">{err}</span>}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={confirmRevoke}>
                {t('prof.sess.confirmBtn', 'Sign out')}
              </Button>
              <Button size="sm" disabled={busy} onClick={cancelRevoke}>{t('common.cancel', 'Cancel')}</Button>
            </div>
          </div>
        </div>
      )}

      {data === undefined ? <Spinner /> : sessions.length === 0 ? (
        <div className="text-[12px] text-[var(--faint)]">{t('prof.sess.none', 'No active sessions recorded.')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {ordered.map((sess) => (
            <div
              key={sess.id}
              className={'flex items-center gap-3 min-w-0 p-2.5 rounded-lg border ' + (sess.current
                ? 'border-[var(--primary-2)] bg-[var(--surface-2)]'
                : 'border-[var(--line)]')}
            >
              <div className={'shrink-0 ' + (sess.current ? 'text-[var(--primary-2)]' : 'text-[var(--muted)]')}>
                <DeviceIcon kind={sess.device} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate flex items-center gap-2">
                  <span className="truncate">{[sess.browser, sess.os].filter(Boolean).join(' - ') || t('prof.sess.unknownDevice', 'Unknown device')}</span>
                  {sess.current && <Badge tone="success" className="shrink-0">{t('prof.sess.thisDevice', 'This device')}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--faint)] truncate flex items-center gap-1.5">
                  {place(sess)
                    ? <><span aria-hidden="true">{flag(sess.country)}</span><MapPin size={11} /><span className="truncate">{place(sess)}</span></>
                    : <><Globe size={11} /><span>{t('prof.sess.unknownPlace', 'Location unknown')}</span></>}
                </div>
                <div className="text-[11px] font-mono text-[var(--faint)] truncate">{sess.ip || '-'}</div>
              </div>
              <div className="text-[11px] text-[var(--faint)] text-right shrink-0">
                <div>{t('prof.sess.active', 'Active')} {ago(sess.lastSeenAt)}</div>
                <div>{t('prof.sess.since', 'Since')} {new Date(sess.createdAt).toLocaleDateString()}</div>
              </div>
              {!sess.current && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPending(sess.id); setErr(''); }} title={t('prof.sess.revoke', 'Sign out this device')}>
                  <LogOut size={13} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Only worth offering when there is somewhere else to sign out of. */}
      {others > 0 && (
        <div className="pt-3 mt-3 border-t border-[var(--line)]">
          <Button size="sm" disabled={busy} onClick={() => { setPending('others'); setErr(''); }}>
            <LogOut size={13} /> {t('prof.sess.revokeOthers', 'Sign out everywhere else')}
          </Button>
        </div>
      )}

      {/* Said rather than hidden: a session opened before device tracking existed has no
          row, so the list would otherwise look complete while missing the device reading it. */}
      {data && data.currentTracked === false && (
        <p className="text-[11px] text-[var(--faint)] mt-3">
          {t('prof.sess.legacy', 'This device signed in before device tracking existed, so it is not listed. Sign out and back in to see it here.')}
        </p>
      )}
    </Card>
  );
}

// Your own OAuth apps — "Sign in with BetterCommunity" for anybody who wants it.
//
// The secret is shown exactly once, at creation and after a rotation. Everything else here
// is editable, and editing the NAME or the redirect URIs drops the staff review, which the
// card says before you do it rather than after: a review that survived a change of name and
// callback would be a review of nothing.
const OAUTH_SCOPE_HINTS = {
  openid: 'Confirm who they are (always required)',
  profile: 'Display name and avatar',
  email: 'Email address',
  items: 'Read their catalog items',
  repos: 'Read the Server-Repos they own',
};

function DevPointerCard() {
  const { t } = useI18n();
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <KeyRound size={15} className="text-[var(--primary-2)]" /> {t('prof.dev.title', 'API keys & apps')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('prof.dev.s', 'Your API keys and registered apps live in the developer area, beside the console that tests them.')}
      </p>
      <Link to="/dev/config"><Button size="sm" variant="primary">{t('prof.dev.go', 'Open /dev/config')} <ArrowRight size={13} /></Button></Link>
    </Card>
  );
}

// Self-service TOTP 2FA: enroll (secret + confirm code -> one-time recovery codes),
// or disable (password + a current code/recovery code). An admin can never do
// either FOR another account — it's a personal auth factor. Also required (with a
// fresh step-up code) to reach the server-control tools once canControlServer is granted.
function TwoFactorCard() {
  const { user, refresh } = useAuth();
  const { t } = useI18n(); const toast = useToast(); const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [enrolled, setEnrolled] = useState(null); // { secret, otpauth } captured at enable, for the local-authenticator hand-off
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
    try { const r = await api.post('/me/2fa/enable', { secret: setup.secret, code: code.trim() }); setEnrolled({ secret: setup.secret, otpauth: setup.otpauth }); attachBackupCodesBySecret(setup.secret, r.recoveryCodes); setRecoveryCodes(r.recoveryCodes); setSetup(null); setCode(''); load(); refresh(); toast.success(t('prof.2fa.enabled', 'Two-factor authentication enabled.')); }
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
          <div className="text-xs font-semibold text-warning mb-1.5">{t('prof.2fa.recovery', 'Save these recovery codes — each works once if you lose your device. Shown only now.')}</div>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3">
            {recoveryCodes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button size="sm" variant="primary" onClick={() => downloadRecoveryCodes(recoveryCodes)}><Download size={13} /> {t('prof.2fa.downloadcodes', 'Download codes')}</Button>
            {enrolled && (
              <Button size="sm" onClick={() => {
                // Add the freshly-enrolled account + its backup codes to the local /2fa
                // authenticator in place (merges if already added at setup).
                const r = addLocalAccount({ otpauth: enrolled.otpauth, secret: enrolled.secret, issuer: 'BetterCommunity', label: user?.email || 'BetterCommunity', backupCodes: recoveryCodes });
                if (r.staged) toast.success(t('prof.2fa.local.staged', 'Saved — unlock the Authenticator (/2fa) to finish adding it.'));
                else if (r.added) toast.success(t('prof.2fa.local.addedcodes', 'Added to your BCWEB Authenticator, with backup codes.'));
                else toast.error(t('common.failed', 'Failed.'));
              }}><Smartphone size={13} /> {t('prof.2fa.addlocal', 'Add to BCWEB Authenticator')}</Button>
            )}
            <Button size="sm" onClick={() => setRecoveryCodes(null)}>{t('prof.2fa.done', "I've saved them")}</Button>
          </div>
          <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('prof.2fa.addlocal.h', '“Add to BCWEB Authenticator” saves this account and its backup codes into the fully-local /2fa authenticator on this device.')}</p>
        </div>
      ) : status.enabled ? (
        <div className="space-y-2">
          <div className="text-xs text-[var(--faint)]">{t('prof.2fa.recoveryleft', '{n} recovery codes left.').replace('{n}', status.recoveryCodesLeft)}</div>
          {/* items-start so the password field keeps its natural height — otherwise the
              grid stretches it to match the right column when the "From your
              Authenticator" list is expanded (that was the layout blow-out). */}
          <div className="grid sm:grid-cols-2 gap-2 items-start">
            <Input type="password" value={disablePw} onChange={(e) => { setDisablePw(e.target.value); setDisableErr(null); }} placeholder={t('prof.2fa.pwph', 'Your password')} className={disableErr?.field === 'pw' ? '!border-error-border' : ''} />
            <div className="min-w-0">
              <Input value={disableCode} onChange={(e) => { setDisableCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9)); setDisableErr(null); }} placeholder={t('prof.2fa.codeph', 'Current code or recovery code')} className={disableErr?.field === 'code' ? '!border-error-border' : ''} />
              <div className="mt-1"><TotpQuickFill onFill={(c) => { setDisableCode(c); setDisableErr(null); }} /></div>
            </div>
          </div>
          {disableErr && <div className="text-xs text-error">{disableErr.msg}</div>}
          <Button className="!text-error" disabled={busy} onClick={disable}>{busy ? <Spinner /> : t('prof.2fa.disable', 'Disable 2FA')}</Button>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">{t('prof.2fa.scan', 'Scan it in your authenticator app, or type the key, then confirm with the code it shows:')}</p>
          {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" width={160} height={160} className="rounded-lg border border-[var(--line)] bg-white p-1.5" />}
          <div className="text-xs font-mono bg-[var(--surface-2)] rounded-lg p-3 break-all">{setup.secret}</div>
          {/* One-click: drop this account into the local BCWEB Authenticator (/2fa) so
              the code below (and every future prompt) can be filled without an app. */}
          <Button size="sm" onClick={() => {
            const r = addLocalAccount({ secret: setup.secret, otpauth: setup.otpauth, issuer: 'BetterCommunity', label: user?.email || 'BetterCommunity' });
            if (r.staged) toast.success(t('prof.2fa.local.staged', 'Saved — unlock the Authenticator (/2fa) to finish adding it.'));
            else if (r.added) toast.success(t('prof.2fa.local.added', 'Added to your BCWEB Authenticator — use the code below to confirm.'));
            else toast.error(t('common.failed', 'Failed.'));
          }}><Smartphone size={13} /> {t('prof.2fa.addlocalnow', 'Add to BCWEB Authenticator')}</Button>
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
          <TotpQuickFill onFill={(c) => setCode(c)} />
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
  const { t } = useI18n(); const toast = useToast();
  // The one-time notifications key minted when a link is created. This state lived in
  // Profile() while every use of it is here, so CreatorLinks referenced a binding it could
  // not see and the whole page died with "notifKey is not defined" on render.
  const [notifKey, setNotifKey] = useState('');
  // Ids hidden while their undo window is open. Kept apart from `links` so a reload landing
  // mid-window cannot resurrect a row the user has already dismissed.
  const [pending, setPending] = useState(() => new Set());
  const [links, setLinks] = useState([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/me/creator-links').then((d) => setLinks(d.links || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const link = async () => {
    if (!code.trim()) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.post('/me/creator-links', { code: code.trim() });
      setCode(''); setMsg('linked'); load(); setTimeout(() => setMsg(''), 2500);
      // Shown ONCE. The server keeps only the hash, so this response cannot be
      // reproduced — if it is not copied now the key is gone and a new one has to be
      // made by hand. That is why it gets its own panel instead of a toast.
      if (r?.notifKey) setNotifKey(r.notifKey);
    }
    catch (x) { setMsg(x.data?.error === 'already_linked' ? 'taken' : x.data?.error === 'invalid_or_expired' ? 'bad' : 'error'); }
    finally { setBusy(false); }
  };
  const unhide = (id) => setPending((s) => { const n = new Set(s); n.delete(id); return n; });
  const unlink = (l) => {
    setPending((s) => new Set(s).add(l.id));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('cl.unlinked', 'Creator ID unlinked.'),
      onCommit: async () => {
        try { await api.del(`/me/creator-links/${l.id}`); load(); }
        // A 423 is the 2-week lock: the row must come back, or the list would claim an
        // unlink the server refused.
        catch (x) { setMsg(x.status === 423 ? 'locked' : 'error'); setTimeout(() => setMsg(''), 3000); }
        finally { unhide(l.id); }
      },
      onCancel: () => unhide(l.id),
    });
  };
  const fdate = (d) => new Date(d).toLocaleDateString();
  // A row whose undo window is open is gone from the list already — that IS the undo
  // affordance. Showing it until the DELETE lands would make Undo look like it did nothing.
  const visible = links.filter((l) => !pending.has(l.id));
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Link2 size={15} className="text-[var(--primary-2)]" /> {t('cid.title', 'Creator IDs')}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('cl.desc', "Link your BMM creator id(s). In BMM, generate a pairing code, then paste it here. One creator id links to one account; linked ids can't be unlinked for 2 weeks.")}</p>
      {visible.length > 0 && <div className="space-y-2 mb-3">
        {visible.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
            <BadgeCheck size={15} className="text-success shrink-0" />
            <div className="flex-1 min-w-0"><div className="font-mono text-xs truncate">{l.creatorId}{l.displayName ? ` · ${l.displayName}` : ''}</div><div className="text-[11px] text-[var(--faint)]">{t('cl.linked', 'linked')} {fdate(l.linkedAt)}{l.locked ? ` · ${t('cl.unlockable', 'unlockable')} ${fdate(l.unlinkableAt)}` : ''}</div></div>
            {l.locked ? <Lock size={14} className="text-[var(--faint)]" title={t('cl.locked2w', 'Locked for 2 weeks')} /> : <button onClick={() => unlink(l)} className="text-[var(--faint)] hover:text-error" title={t('cl.unlink', 'Unlink')}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input value={code} maxLength={9} onChange={(e) => { const s = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); setCode(s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s); }} placeholder={t('cl.ph', 'Code from BMM (e.g. K7P39QMX)')} onKeyDown={(e) => e.key === 'Enter' && link()} />
        <Button variant="primary" disabled={busy} onClick={link}>{busy ? <Spinner /> : t('cl.link', 'Link')}</Button>
      </div>
      {msg === 'linked' && <div className="text-sm text-success mt-2 flex items-center gap-1"><Check size={14} /> {t('cl.ok', 'Creator id linked.')}</div>}
      {/* Already linked? Then the key minted at link time never happened for you, and
          unlinking to trigger it is blocked for two weeks. One button, same panel. */}
      {links.length > 0 && !notifKey && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post('/me/notifications-key');
              if (r?.secret) setNotifKey(r.secret);
            } catch (x) {
              toast.error(x?.data?.error === 'too_many_keys'
                ? t('cl.keyTooMany', 'You already have 20 active keys — revoke one first.')
                : t('common.failed', 'Failed.'));
            } finally { setBusy(false); }
          }}><KeyRound size={13} /> {t('cl.keyMake', 'Get a BMM notifications key')}</Button>
          <span className="text-xs text-[var(--faint)]">{t('cl.keyMakeHint', 'For BMM to show your notifications. Creates a new read-only key.')}</span>
        </div>
      )}

      {/* The one-time notifications key. Deliberately loud and deliberately sticky —
          it has no dismiss timer, because a secret that scrolls away on its own is a
          secret the user loses. It disappears when they say they have it. */}
      {notifKey && (
        <div className="mt-3 p-3 rounded-xl border border-[var(--primary-2)] bg-[var(--surface-2)] space-y-2">
          <div className="text-sm font-semibold flex items-center gap-1.5"><KeyRound size={14} /> {t('cl.keyTitle', 'Your BMM notifications key')}</div>
          <div className="text-xs text-[var(--faint)] leading-relaxed">{t('cl.keyDesc', 'Paste this into BMM under Settings → Identity & API to see your BetterCommunity notifications there. It is shown once and cannot be recovered — only revoked and replaced.')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono px-2 py-1.5 rounded-lg bg-[var(--surface)]">{notifKey}</code>
            <Button size="sm" onClick={() => { copyText(notifKey); toast.success(t('cl.keyCopied', 'Key copied.')); }}><Copy size={13} /> {t('common.copy', 'Copy')}</Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNotifKey('')}>{t('cl.keyDone', 'I have saved it')}</Button>
        </div>
      )}
      {msg === 'taken' && <div className="text-sm text-error mt-2">{t('cl.taken', 'That creator id is already linked to another account.')}</div>}
      {msg === 'bad' && <div className="text-sm text-error mt-2">{t('cl.bad', 'Invalid or expired code.')}</div>}
      {msg === 'locked' && <div className="text-sm text-error mt-2">{t('cl.lockederr', "Locked — can't unlink within 2 weeks of linking.")}</div>}
      {msg === 'error' && <div className="text-sm text-error mt-2">{t('cl.error', 'Something went wrong.')}</div>}
    </Card>
  );
}

// Link Discord account(s) to this BCWEB account via a code the bot's /link issues.
function DiscordLinks() {
  const { t } = useI18n(); const toast = useToast();
  // See CreatorLinks: rows hidden while their undo window is open.
  const [pending, setPending] = useState(() => new Set());
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
  const unhide = (id) => setPending((s) => { const n = new Set(s); n.delete(id); return n; });
  const unlink = (l) => {
    setPending((s) => new Set(s).add(l.id));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('dl.unlinked', 'Discord account unlinked.'),
      onCommit: async () => {
        try { await api.del(`/me/discord/links/${l.id}`); load(); }
        catch { setMsg('error'); setTimeout(() => setMsg(''), 2500); }
        finally { unhide(l.id); }
      },
      onCancel: () => unhide(l.id),
    });
  };
  const fdate = (d) => new Date(d).toLocaleDateString();
  // A row whose undo window is open is gone from the list already — that IS the undo
  // affordance. Showing it until the DELETE lands would make Undo look like it did nothing.
  const visible = links.filter((l) => !pending.has(l.id));
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><DiscordIcon size={15} className="text-[var(--primary-2)]" /> Discord</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('disl.desc1', 'Link your Discord account. In the server, run')} <code>/link</code> {t('disl.desc2', 'to get a code, then paste it here — it unlocks gated channels and shows your account in the community.')}</p>
      {visible.length > 0 && <div className="space-y-2 mb-3">
        {visible.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
            <BadgeCheck size={15} className="text-success shrink-0" />
            <div className="flex-1 min-w-0"><div className="text-xs truncate">{l.username || l.discordId}</div><div className="text-[11px] text-[var(--faint)]">{t('cl.linked', 'linked')} {fdate(l.linkedAt)}</div></div>
            <button onClick={() => unlink(l)} className="text-[var(--faint)] hover:text-error" title={t('cl.unlink', 'Unlink')}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input value={code} maxLength={9} onChange={(e) => { const s = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); setCode(s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s); }} placeholder={t('disl.ph', 'Code from /link (e.g. K7P39QMX)')} onKeyDown={(e) => e.key === 'Enter' && link()} />
        <Button variant="primary" disabled={busy} onClick={link}>{busy ? <Spinner /> : t('cl.link', 'Link')}</Button>
      </div>
      {msg === 'linked' && <div className="text-sm text-success mt-2 flex items-center gap-1"><Check size={14} /> {t('disl.ok', 'Discord linked.')}</div>}
      {msg === 'taken' && <div className="text-sm text-error mt-2">{t('disl.taken', 'That Discord account is already linked.')}</div>}
      {msg === 'bad' && <div className="text-sm text-error mt-2">{t('cl.bad', 'Invalid or expired code.')}</div>}
      {msg === 'error' && <div className="text-sm text-error mt-2">{t('cl.error', 'Something went wrong.')}</div>}
    </Card>
  );
}

// Link YouTube / Twitch / Steam / Ko-fi accounts to show on the public profile — Discord-
// style cards with an inline "show on my profile" toggle. Only providers configured
// server-side (.env) are offered; the whole card hides if none are. GitHub/Discord come
// from sign-in and are toggled in the Public-profile privacy card above.
const CONN_META = [
  ['youtube', Youtube, 'YouTube', '#ff0000', 'oauth'],
  ['twitch', Twitch, 'Twitch', '#9146ff', 'oauth'],
  ['steam', Gamepad2, 'Steam', '#66c0f4', 'oauth'],
  ['kofi', KofiIcon, 'Ko-fi', '#ff5e5b', 'manual'],
];
function SocialConnections() {
  const { t } = useI18n(); const toast = useToast(); const { user, refresh } = useAuth();
  const [providers, setProviders] = useState(null);
  const [conns, setConns] = useState([]);
  const [kofi, setKofi] = useState('');
  const load = () => Promise.all([api.get('/auth/connect/providers'), api.get('/me/connections')])
    .then(([p, c]) => { setProviders(p); setConns(c.connections || []); }).catch(() => setProviders({}));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('connected')) { toast.success(t('sc.linked', 'Account linked.')); history.replaceState({}, '', location.pathname); load(); }
    else if (q.get('connect_error')) { toast.error(t('sc.failed', 'Could not link that account.')); history.replaceState({}, '', location.pathname); }
  }, []); // eslint-disable-line
  if (!providers) return null;
  const configured = CONN_META.filter(([k]) => providers[k]);
  if (configured.length === 0) return null;
  const linked = Object.fromEntries(conns.map((c) => [c.provider, c]));
  const show = new Set(user?.showConnections || []);
  // Disconnecting is one click and reconnecting is a whole OAuth round trip through another
  // site — the asymmetry is the reason this one earns a window rather than a confirm dialog.
  const disconnect = (k) => {
    toast.action({
      tone: 'success', cancelLabel: t('common.undo', 'Undo'),
      msg: t('sc.disconnected', 'Disconnected.'),
      onCommit: async () => { try { await api.del(`/me/connections/${k}`); load(); } catch { toast.error(t('acc.failed', 'Failed.')); load(); } },
      onCancel: () => load(),
    });
  };
  // Accept a bare handle, "@handle", or a full ko-fi.com/<handle> URL → the handle.
  const kofiHandle = kofi.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?ko-fi\.com\//i, '').replace(/\/.*$/, '');
  const saveKofi = async () => {
    if (!kofiHandle) return;
    try { await api.put('/me/connections/kofi', { handle: kofiHandle }); setKofi(''); load(); }
    catch { toast.error(t('sc.kofibad', 'Invalid Ko-fi handle.')); }
  };
  const toggleShow = async (k, on) => {
    const next = on ? [...show, k] : [...show].filter((x) => x !== k);
    try { await api.patch('/me', { showConnections: next }); await refresh(); } catch { toast.error(t('acc.failed', 'Failed.')); }
  };
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Link2 size={15} className="text-[var(--primary-2)]" /> {t('sc.title', 'Social accounts')}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('sc.desc2', 'Link accounts and toggle which appear on your public profile.')}</p>
      <div className="space-y-2">
        {configured.map(([k, Ico, label, color, kind]) => { const c = linked[k]; return (
          <div key={k} className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--bg-solid)] shrink-0"><Ico size={17} style={{ color }} /></span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{label}</div>
                {c ? <a href={c.url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--faint)] hover:text-[var(--primary)] truncate block">{c.handle}</a>
                  : <div className="text-[11px] text-[var(--faint)]">{t('sc.notlinked', 'Not linked')}</div>}
              </div>
              {c ? <button onClick={() => disconnect(k)} className="text-[var(--faint)] hover:text-error p-1" title={t('sc.disconnect', 'Disconnect')}><X size={16} /></button>
                : kind === 'oauth' ? <Button size="sm" variant="default" onClick={() => { window.location.href = `/api/auth/connect/${k}/start`; }}>{t('sc.connect', 'Connect')}</Button> : null}
            </div>
            {/* Manual Ko-fi entry when not yet linked — a prefixed input (paste a handle or a
                full ko-fi.com link) with a live preview of the resulting URL. */}
            {!c && kind === 'manual' && <div className="mt-2">
              <div className="flex items-stretch gap-2">
                <div className="flex items-center flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg-solid)] overflow-hidden focus-within:border-[var(--primary)]">
                  <span className="px-2.5 py-2 text-xs text-[var(--faint)] bg-[var(--surface-2)] border-r border-[var(--line)] shrink-0 select-none">ko-fi.com/</span>
                  <input value={kofi} onChange={(e) => setKofi(e.target.value)} placeholder={t('sc.kofiph2', 'yourname')} onKeyDown={(e) => e.key === 'Enter' && saveKofi()} className="flex-1 min-w-0 bg-transparent border-0 outline-none px-2.5 py-2 text-sm" />
                </div>
                <Button size="sm" variant="primary" disabled={!kofiHandle} onClick={saveKofi}>{t('sc.save', 'Save')}</Button>
              </div>
              {kofiHandle && <div className="text-[11px] text-[var(--faint)] mt-1">→ <span className="font-mono text-[var(--muted)]">ko-fi.com/{kofiHandle}</span></div>}
            </div>}
            {/* Inline "show on my profile" toggle, Discord-style. */}
            {c && <label className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--line)] text-sm cursor-pointer">
              <span className="text-[var(--muted)]">{t('sc.showprofile', 'Show on my profile')}</span>
              <button type="button" onClick={() => toggleShow(k, !show.has(k))} aria-pressed={show.has(k)} className={`w-10 h-5.5 rounded-full relative shrink-0 transition ${show.has(k) ? 'bg-[var(--primary)]' : 'bg-[var(--line-strong)]'}`} style={{ height: 22, width: 40 }}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${show.has(k) ? 'left-[20px]' : 'left-0.5'}`} /></button>
            </label>}
          </div>
        ); })}
      </div>
    </Card>
  );
}
