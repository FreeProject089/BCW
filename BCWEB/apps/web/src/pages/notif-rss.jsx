// notify (agent-notify): the notification centre's RSS card and "Projects you follow".
//
// The personal feed URL is a secret: whoever holds it reads this account's notifications. So it
// is shown ONCE, when minted (the server stores only a hash and could not show it again), and
// the card offers the two things you do with a secret: replace it (rotate) and kill it (revoke).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rss, Copy, RefreshCw, Trash2, BellRing, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Explain, useToast, useDialog, copyText } from '../ui/ui.jsx';

const when = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

export function NotifRssCard() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [st, setSt] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/me/feed-token').then(setSt).catch(() => setSt({ active: false }));
  useEffect(() => { load(); }, []);

  const mint = async () => {
    if (st?.active && !(await dialog.confirm({
      title: t('nrss.rotate.t', 'Replace your feed address?'),
      message: t('nrss.rotate.m', 'The current address stops working at once. Any reader using it will need the new one.'),
      okLabel: t('nrss.rotate', 'Replace'),
    }))) return;
    setBusy(true);
    try { const r = await api.post('/me/feed-token'); setFresh({ rss: r.rss, atom: r.atom }); load(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!(await dialog.confirm({
      title: t('nrss.revoke.t', 'Turn your feed off?'),
      message: t('nrss.revoke.m', 'The address stops working for good. You can create a new one later.'),
      okLabel: t('nrss.revoke', 'Turn off'), danger: true,
    }))) return;
    setBusy(true);
    // undo: revoking a credential is meant to take effect now; an undo window would leave a
    // leaked address working for those seconds, and a new address is one click away.
    try { await api.del('/me/feed-token'); setFresh(null); load(); toast.success(t('nrss.revoked', 'Feed turned off.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const copy = (v) => { copyText(v); toast.success(t('common.copied', 'Copied.')); };

  if (!st) return null;
  return (
    <Card className="p-5" id="notif-rss">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Rss size={15} className="text-[var(--accent-ink)]" /> {t('nrss.title', 'RSS feed')}
        {st.active && <Badge tone="green">{t('nrss.on', 'on')}</Badge>}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-2">{t('nrss.sub', 'Read your notifications in any feed reader. The address is private: anyone who has it can read them.')}</p>
      <Explain className="text-[12px] mb-3">
        {t('nrss.more', 'We keep only a fingerprint of the address, so it is shown once, when you create it. Lost it? Replace it. The feed lists your last 50 notifications, in the language of your account, and is never cached by a shared proxy.')}
      </Explain>

      {fresh && (
        <div className="rounded-lg border border-[var(--primary)] tint-primary p-3 mb-3 space-y-2">
          <div className="text-[12px] font-semibold text-[var(--accent-ink)]">{t('devc.once', 'Copy it now, it is shown once and never again.')}</div>
          {[['RSS', fresh.rss], ['Atom', fresh.atom]].map(([label, v]) => (
            <div key={label} className="flex items-center gap-2">
              <Badge>{label}</Badge>
              <code className="font-mono text-[11px] break-all flex-1 min-w-0">{v}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(v)} title={t('common.copy', 'Copy')} aria-label={t('common.copy', 'Copy')}><Copy size={13} /></Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setFresh(null)}>{t('devc.saved', 'I have saved it')}</Button>
        </div>
      )}

      {st.active && !fresh && (
        <div className="text-[12px] text-[var(--muted)] mb-3">
          {t('nrss.since', 'Created {d}.').replace('{d}', when(st.createdAt, lang) || '')}{' '}
          {st.lastUsedAt ? t('nrss.used', 'Last read by a reader {d}.').replace('{d}', when(st.lastUsedAt, lang)) : t('nrss.unused', 'Not read by any reader yet.')}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={st.active ? 'default' : 'primary'} onClick={mint} disabled={busy}>
          {st.active ? <><RefreshCw size={13} /> {t('nrss.rotate', 'Replace')}</> : <><Rss size={13} /> {t('nrss.create', 'Create my feed address')}</>}
        </Button>
        {st.active && <Button size="sm" variant="ghost" className="!text-error" onClick={revoke} disabled={busy}><Trash2 size={13} /> {t('nrss.revoke', 'Turn off')}</Button>}
        <a href="/feeds/news.xml" target="_blank" rel="noreferrer" className="ms-auto">
          <Button size="sm" variant="ghost" title={t('nrss.public.h', 'Site news and public announcements, no account needed')}><ExternalLink size={13} /> {t('nrss.public', 'Public news feed')}</Button>
        </a>
      </div>
    </Card>
  );
}

export function FollowedProjectsCard() {
  const { t } = useI18n(); const toast = useToast();
  const [rows, setRows] = useState(null);
  const load = () => api.get('/me/follows').then((r) => setRows(r.follows || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows) return null;
  const unfollow = async (f) => {
    setRows((x) => x.filter((y) => y.ref !== f.ref));
    try { await api.put(`/project-follow/${encodeURIComponent(f.ref)}`, { follow: false }); }
    catch { toast.error(t('common.failed', 'Failed.')); load(); }
  };
  return (
    <Card className="p-5" id="notif-follows">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><BellRing size={15} className="text-[var(--accent-ink)]" /> {t('nfol.title', 'Projects you follow')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('nfol.sub', 'A new post in their blog reaches you here. Follow a project from its page.')}</p>
      {!rows.length ? <div className="text-[12px] text-[var(--faint)]">{t('nfol.none', 'You do not follow any project yet.')}</div> : (
        <div className="divide-y divide-[var(--line)]">
          {rows.map((f) => (
            <div key={f.ref} className="py-2 flex items-center gap-3">
              <Link to={f.url} className="flex-1 min-w-0 text-[13px] truncate hover:text-[var(--accent-ink)]" title={f.name}>{f.name}</Link>
              <Button size="sm" variant="ghost" onClick={() => unfollow(f)}>{t('nfol.unfollow', 'Unfollow')}</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
// fin notify (agent-notify)
