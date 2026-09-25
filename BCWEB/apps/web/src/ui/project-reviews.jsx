// prerelease (agent-prerelease): a project page's "Reviews" tab. The landing review's rules on
// one project (routes/project-reviews.mjs): off until the project's manager switches it on, one
// review per member per project, pending until a moderator approves it, public or private,
// signed or anonymous. The project's own team reads every review of its project, and does not
// moderate: that is the moderators' queue (Admin, Writing & notices, Project reviews).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Star, Trash2, Clock, CheckCircle2, XCircle, LogIn, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import Avatar from './Avatar.jsx';
import { Button, Card, Badge, Input, Textarea, Field, Select, EmptyState, Spinner, useToast, useDialog } from './ui.jsx';

const MIN = 20, MAX = 600;

function Stars({ n }) {
  return <span className="inline-flex text-warning" aria-label={`${n}/5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={13} fill={i <= n ? 'currentColor' : 'none'} />)}</span>;
}

function ReviewRow({ r, showStatus = false }) {
  const { t } = useI18n();
  return (
    <li className="py-3 flex gap-3" data-review={r.id}>
      <Avatar variant={r.avatar?.variant} seed={r.avatar?.seed} colors={r.avatar?.colors} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{r.anonymous || !r.author ? t('prv.anon', 'A member') : r.author}</span>
          {r.role && <span className="text-xs text-[var(--muted)]">{r.role}</span>}
          {r.rating ? <Stars n={r.rating} /> : null}
          {showStatus && <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{({ approved: t('prv.st.approved', 'Approved'), rejected: t('prv.st.rejected', 'Rejected'), pending: t('prv.st.pending', 'Waiting for a moderator') })[r.status]}</Badge>}
          {showStatus && r.visibility === 'private' && <Badge tone="blue"><Lock size={10} /> {t('prv.private', 'Private')}</Badge>}
        </div>
        <p className="text-sm mt-1 whitespace-pre-line break-words">{r.body}</p>
      </div>
    </li>
  );
}

/** `projectRef` is the project's ref (key, or sc:<slug>); `data` is GET /projects-reviews/:ref. */
export default function ProjectReviewsTab({ projectRef, data, onChanged }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast(); const dialog = useDialog();
  const mine = data?.mine || null;
  const blank = { body: '', rating: 0, role: '', lang: lang === 'fr' ? 'fr' : 'en', visibility: 'public', anonymous: false };
  const [f, setF] = useState(mine ? { body: mine.body, rating: mine.rating || 0, role: mine.role || '', lang: mine.lang || 'en', visibility: mine.visibility, anonymous: !!mine.anonymous } : blank);
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  const base = `/projects-reviews/${encodeURIComponent(projectRef)}`;

  const toggle = async () => {
    try { await api.put(`${base}/settings`, { enabled: !data.enabled }); toast.success(data.enabled ? t('prv.off.done', 'Reviews are off for this project.') : t('prv.on.done', 'Reviews are on for this project.')); onChanged?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const len = f.body.trim().length;
  const send = async () => {
    if (len < MIN || len > MAX) return;
    setBusy(true);
    try {
      await api.put(`${base}/mine`, { body: f.body.trim(), rating: f.rating || null, role: f.role.trim(), lang: f.lang, visibility: f.visibility, anonymous: f.anonymous });
      toast.success(f.visibility === 'private' ? t('prv.sentPrivate', 'Thank you. It goes to the project team and the moderators only.') : t('prv.sent', 'Thank you. A moderator reads it before it appears.'));
      onChanged?.();
    } catch (x) {
      toast.error(({ no_links: t('rvf.err.links', 'Links are not accepted in a review.'), account_too_new: t('rvf.err.new', 'Your account needs to be at least a day old to post a review.'), invalid_input: t('rvf.err.input', 'Check the text: between 20 and 600 characters.'), reviews_off: t('prv.off', 'This project does not take reviews.') })[x.data?.error] || t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await dialog.confirm({ title: t('rvf.del', 'Delete your review?'), message: t('prv.del.m', 'It leaves this project page and the moderation queue.'), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg: t('rvf.deleted', 'Review deleted.'),
      onCommit: async () => {
        try { await api.del(`${base}/mine`); setF(blank); onChanged?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
      },
      onCancel: () => {},
    });
  };

  return (
    <div className="max-w-3xl space-y-5" data-testid="project-reviews">
      {data.canConfigure && (
        <Card className="p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{t('prv.switch', 'Reviews on this project')}</div>
            <div className="text-xs text-[var(--muted)]">{t('prv.switch.s', 'Members review the project here; a moderator approves each one before it shows.')}</div>
          </div>
          <Button size="sm" variant={data.enabled ? undefined : 'primary'} onClick={toggle} data-testid="project-reviews-toggle">
            {data.enabled ? t('prv.turnOff', 'Turn off') : t('prv.turnOn', 'Turn on')}
          </Button>
        </Card>
      )}
      {!data.enabled ? (
        <EmptyState icon={MessageSquare} title={t('prv.off', 'This project does not take reviews.')} />
      ) : (
        <>
          <Card className="p-5">
            <div className="flex items-center gap-2 flex-wrap">
              <MessageSquare size={16} className="text-[var(--accent-ink)]" />
              <h3 className="font-semibold">{t('prv.title', 'What members say')}</h3>
              {data.count > 0 && <span className="text-sm text-[var(--muted)]">{t('prv.count', '{n} reviews').replace('{n}', String(data.count))}{data.average != null ? ` · ${data.average}/5` : ''}</span>}
            </div>
            {data.reviews.length ? <ul className="divide-y divide-[var(--line)] mt-2">{data.reviews.map((r) => <ReviewRow key={r.id} r={r} />)}</ul>
              : <p className="text-sm text-[var(--muted)] mt-2">{t('prv.none', 'No review yet. Be the first.')}</p>}
          </Card>

          <Card className="p-5" data-testid="project-review-form">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="font-semibold">{mine ? t('prv.yours', 'Your review') : t('prv.write', 'Write a review')}</h3>
              {mine && (mine.visibility === 'private' ? <Badge tone="blue">{t('rvf.st.private', 'Private: for the team only')}</Badge>
                : mine.status === 'approved' ? <Badge tone="green"><CheckCircle2 size={11} /> {t('prv.st.shown', 'Shown on the project')}</Badge>
                : mine.status === 'rejected' ? <Badge tone="red"><XCircle size={11} /> {t('rvf.st.rejected', 'Not published')}</Badge>
                : <Badge tone="amber"><Clock size={11} /> {t('rvf.st.pending', 'Waiting for a moderator')}</Badge>)}
            </div>
            {!user ? (
              <Link to={`/auth?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + '?tab=reviews' : '/')}`}><Button variant="primary"><LogIn size={15} /> {t('prv.signin', 'Sign in to write a review')}</Button></Link>
            ) : (
              <>
                <Field label={t('rvf.body', 'Your review')}>
                  <Textarea rows={4} maxLength={MAX + 50} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={t('prv.body.ph', 'What do you use it for, and how does it work for you?')} />
                </Field>
                <div className={`text-[11px] mt-1 ${len > MAX ? 'text-error' : 'text-[var(--faint)]'}`}>{len}/{MAX}</div>
                <div className="flex items-end gap-3 mt-3 flex-wrap">
                  <Field label={t('rvf.rating', 'Rating (optional)')}>
                    <div className="flex items-center gap-0.5 h-10" role="radiogroup" aria-label={t('rvf.rating', 'Rating (optional)')}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={f.rating === n} aria-label={t('rvf.stars', '{n} out of 5').replace('{n}', n)}
                          onClick={() => setF({ ...f, rating: f.rating === n ? 0 : n })} className={`p-1 ${n <= f.rating ? 'text-warning' : 'text-[var(--faint)] hover:text-warning'}`}>
                          <Star size={18} fill={n <= f.rating ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label={t('rvf.role', 'About you (optional)')}>
                    <Input value={f.role} maxLength={60} onChange={(e) => setF({ ...f, role: e.target.value })} />
                  </Field>
                  <Field label={t('rvf.lang', 'Written in')}>
                    <Select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}><option value="en">English</option><option value="fr">Français</option></Select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-4 mt-3 text-sm">
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.visibility === 'private'} onChange={(e) => setF({ ...f, visibility: e.target.checked ? 'private' : 'public' })} /> {t('prv.privateOpt', 'Private: only the project team and the moderators')}</label>
                  <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> {t('prv.anonOpt', 'Anonymous: shown as "a member"')}</label>
                </div>
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  <Button variant="primary" disabled={busy || len < MIN || len > MAX} onClick={send} data-testid="project-review-send">{busy ? <Spinner /> : mine ? t('rvf.resend', 'Send the new version') : t('rvf.send', 'Send for review')}</Button>
                  {mine && <Button variant="ghost" onClick={remove}><Trash2 size={14} /> {t('common.delete', 'Delete')}</Button>}
                </div>
              </>
            )}
          </Card>

          {Array.isArray(data.team) && data.team.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold">{t('prv.team', 'Every review of this project')}</h3>
              <p className="text-xs text-[var(--muted)] mt-1">{t('prv.team.s', 'For the project team: pending and private ones included. Moderators decide what is shown.')}</p>
              <ul className="divide-y divide-[var(--line)] mt-2">{data.team.map((r) => <ReviewRow key={r.id} r={r} showStatus />)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
