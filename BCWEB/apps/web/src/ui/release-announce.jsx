// prerelease (agent-prerelease): "Announce" on a version of a project's history.
//
// Drawn for the project's MANAGERS only (manage_projects for an official project, manage_showcase
// for the others), the server's rule in routes/release-announce.mjs, restated here only to
// decide whether a button is drawn: the server answers again on the request.
//
// Three ways out, each a reuse: a post in the project's blog (which is what the home page's
// news, the project's Blog tab and the Discord bot's blog announcements already carry), a bell
// notification to every account that did not mute releases, and the newsletter.
import { useState } from 'react';
import { Megaphone, Newspaper, Bell, Mail, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { effectiveCaps } from '../lib/roles.js';
import { Badge, Button, Modal, Spinner, useToast } from './ui.jsx';

/** `/projects/<key>` or `/project/<slug>` (project-content.jsx's `base`) as a ref. */
export function refOfBase(base) {
  const m = /^\/projects\/([^/]+)$/.exec(base || '');
  if (m) return m[1];
  const s = /^\/project\/([^/]+)$/.exec(base || '');
  return s ? `sc:${s[1]}` : null;
}

export function mayAnnounce(user, ref) {
  if (!user || !ref) return false;
  if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') return true;
  return effectiveCaps(user).includes(ref.startsWith('sc:') ? 'manage_showcase' : 'manage_projects');
}

export default function AnnounceButton({ base, entry, onDone }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({ blog: true, notify: true, newsletter: false });
  const [busy, setBusy] = useState(false);
  const ref = refOfBase(base);
  if (entry?.announcedAt) return <Badge tone="green" title={t('rann.done.h', 'This version was announced')}><CheckCircle2 size={11} /> {t('rann.done', 'Announced')}</Badge>;
  if (!entry?.published || entry?.snapshotOnly || !mayAnnounce(user, ref)) return null;
  const go = async () => {
    setBusy(true);
    try {
      await api.post(`/projects-releases/${encodeURIComponent(ref)}/${encodeURIComponent(entry.version)}/announce`, opts);
      toast.success(t('rann.sent', 'Announced.'));
      setOpen(false);
      onDone?.();
    } catch (x) {
      toast.error(({ project_not_public: t('rann.err.private', 'Only a public project can be announced.'), already_announced: t('rann.err.again', 'This version was already announced.'), forbidden: t('rann.err.forbidden', 'Only the project managers can announce a version.') })[x.data?.error] || t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const row = (k, Icon, label, hint) => (
    <label className="flex items-start gap-2.5 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
      <span><span className="inline-flex items-center gap-1.5 text-sm font-medium"><Icon size={14} /> {label}</span><span className="block text-xs text-[var(--muted)]">{hint}</span></span>
    </label>
  );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="announce-release"><Megaphone size={13} /> {t('rann.btn', 'Announce')}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('rann.title', 'Announce v{v}').replace('{v}', entry.version)} icon={Megaphone}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy || (!opts.blog && !opts.notify && !opts.newsletter)} onClick={go}>{busy ? <Spinner /> : <Megaphone size={14} />} {t('rann.go', 'Announce')}</Button></>}>
        {row('blog', Newspaper, t('rann.blog', 'A post in the project blog'), t('rann.blog.h', 'Built from the notes. It shows in the home page news when the project is set to, and in the Discord announcements.'))}
        {row('notify', Bell, t('rann.notify', 'A notification to every member'), t('rann.notify.h', 'Except those who switched off "Releases & early access".'))}
        {row('newsletter', Mail, t('rann.newsletter', 'The newsletter'), t('rann.newsletter.h', 'To the confirmed subscribers, with the unsubscribe link.'))}
        <p className="text-xs text-[var(--faint)] mt-2">{t('rann.once', 'A version is announced once.')}</p>
      </Modal>
    </>
  );
}
