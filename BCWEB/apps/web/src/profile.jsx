import { useEffect, useState } from 'react';
import { User, Shield, Mail, CalendarDays, Shuffle, KeyRound, Check } from 'lucide-react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import { Button, Card, Badge, Input, Textarea, Field, PageHeader, Spinner } from './ui.jsx';
import Avatar, { VARIANTS, avatarOf } from './Avatar.jsx';

export default function Profile() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const [form, setForm] = useState({ displayName: '', bio: '' });
  const [avatar, setAvatar] = useState({ variant: 'beam', seed: '' });
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [msg, setMsg] = useState('');

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
    setPwBusy(true); setMsg('');
    try { await api.post('/me/password', pw); setPw({ current: '', next: '' }); setMsg('pwok'); setTimeout(() => setMsg(''), 2500); }
    catch (x) { setMsg(x.data?.error === 'wrong_password' ? 'pwwrong' : 'error'); } finally { setPwBusy(false); }
  };
  const randomize = () => setAvatar((a) => ({ ...a, seed: Math.random().toString(36).slice(2, 10) }));

  return (
    <div className="max-w-3xl">
      <PageHeader icon={User} title="Profile" subtitle="Manage your account, avatar and password." />
      <div className="grid md:grid-cols-[260px_1fr] gap-6">
        {/* avatar */}
        <Card className="p-6 text-center self-start">
          <Avatar variant={avatar.variant} seed={avatar.seed || user.id} size={120} className="mx-auto" />
          <div className="font-semibold mt-3">{form.displayName || user.displayName}</div>
          <Badge tone={user.role === 'ADMIN' ? 'amber' : 'primary'} className="mt-1">{user.role}</Badge>
          <div className="grid grid-cols-3 gap-1.5 mt-5">
            {VARIANTS.map((v) => (
              <button key={v} onClick={() => setAvatar((a) => ({ ...a, variant: v }))}
                className={`rounded-lg p-1 border ${avatar.variant === v ? 'border-[var(--primary)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} title={v}>
                <Avatar variant={v} seed={avatar.seed || user.id} size={48} />
              </button>
            ))}
          </div>
          <Button size="sm" className="w-full mt-3" onClick={randomize}><Shuffle size={14} /> Randomize</Button>
        </Card>

        {/* details + password */}
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <Field label="Display name"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="Bio"><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="A little about you…" /></Field>
            <div className="flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save profile'}</Button>
              {msg === 'saved' && <span className="text-sm text-emerald-400 flex items-center gap-1"><Check size={14} /> Saved</span>}
              {msg === 'error' && <span className="text-sm text-red-400">Failed</span>}</div>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--primary-2)]" /> Change password</div>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <Field label="Current password"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
              <Field label="New password"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="8+ characters" /></Field>
            </div>
            <div className="flex items-center gap-3 mt-3"><Button disabled={pwBusy} onClick={changePw}>{pwBusy ? <Spinner /> : 'Update password'}</Button>
              {msg === 'pwok' && <span className="text-sm text-emerald-400 flex items-center gap-1"><Check size={14} /> Updated</span>}
              {msg === 'pwwrong' && <span className="text-sm text-red-400">Wrong current password</span>}
              {msg === 'pwshort' && <span className="text-sm text-red-400">Min 8 characters</span>}</div>
          </Card>

          <Card className="p-5 text-sm text-[var(--muted)] space-y-2">
            <div className="flex items-center gap-2"><Mail size={14} /> {user.email}</div>
            <div className="flex items-center gap-2"><Shield size={14} /> Role: {user.role}</div>
            <div className="flex items-center gap-2"><CalendarDays size={14} /> Member since {new Date(user.createdAt).toLocaleDateString()}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
