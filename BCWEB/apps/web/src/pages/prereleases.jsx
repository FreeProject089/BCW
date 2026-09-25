// prerelease (agent-prerelease): early access, the reader's and the member's side.
//
//   /prereleases          PrereleasesPage: every current pre-release, filtered by phase / project
//   /prereleases/:slug    PrereleasePage: one, with sign-up, the member's status, withdraw, and
//                         the download for a selected member
//   MyPrereleasesCard     the dashboard's "Your early access"
//   ProjectEarlyTab       a project page's "Early access" tab
//
// The download is a plain link to /api/prereleases/:slug/download. The page never holds the
// file's address: the API checks the selection on that request and answers with a redirect to
// a link that lives two minutes. What the page shows about the selection is only the reader's
// own status.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  FlaskConical, Download, LogIn, Search, ShieldCheck, Trash2, CheckCircle2, Hourglass, XCircle, Clock, Users, Hash, ArrowRight, Settings2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { useAsync } from './pages.jsx';
import Markdown from '../ui/md.jsx';
import { Button, Card, Badge, EmptyState, PageHeader, Spinner, Textarea, Field, Explain, useToast, useDialog, formatBytes } from '../ui/ui.jsx';
import { PhaseBadge, MyStatusBadge, PrereleaseCard, prText, fmtDay } from '../ui/prerelease-bits.jsx';

const FILTERS = ['all', 'open', 'upcoming', 'selecting', 'available'];

export function PrereleasesPage() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const status = FILTERS.includes(sp.get('status')) ? sp.get('status') : 'all';
  const project = sp.get('project') || '';
  const [q, setQ] = useState('');
  const { data, loading, err } = useAsync(() => api.get(`/prereleases?status=${status}${project ? `&project=${encodeURIComponent(project)}` : ''}`), [status, project]);
  const list = data?.prereleases || [];
  // The project filter offers the projects that HAVE a current pre-release: a list of every
  // project with an empty result behind most of them is a list of dead ends.
  const { data: allData } = useAsync(() => api.get('/prereleases?status=all').catch(() => null), []);
  const projects = useMemo(() => {
    const m = new Map();
    for (const pr of allData?.prereleases || []) if (pr.project) m.set(pr.project.ref, pr.project.name);
    return [...m.entries()];
  }, [allData]);
  const nq = q.trim().toLowerCase();
  const shown = nq ? list.filter((pr) => [pr.title, pr.titleFr, pr.pitch, pr.pitchFr, pr.project?.name, pr.version].join(' ').toLowerCase().includes(nq)) : list;
  const setParam = (k, v) => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== 'all') n.set(k, v); else n.delete(k); return n; });
  const label = { all: t('prl.f.all', 'All'), open: t('prl.phase.open', 'Sign-ups open'), upcoming: t('prl.phase.upcoming', 'Opens soon'), selecting: t('prl.phase.selecting', 'Selection in progress'), available: t('prl.phase.available', 'Available to the selected') };
  return (
    <div>
      <PageHeader icon={FlaskConical} title={t('prl.list.title', 'Early access')} subtitle={t('prl.list.sub', 'The next versions of the projects, before everyone else. Sign up, and the team chooses who gets them.')} />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <input className="input !ps-9 !py-2 !text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('prl.search', 'Search the pre-releases…')} aria-label={t('prl.search', 'Search the pre-releases…')} />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('prl.f.phase', 'Phase')}>
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setParam('status', f)} aria-pressed={status === f} data-filter={f}
              className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${status === f ? 'border-[var(--primary)] text-[var(--text)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {label[f]}
            </button>
          ))}
        </div>
        {projects.length > 1 && (
          <select className="input !w-auto !py-1.5 !text-sm" value={project} onChange={(e) => setParam('project', e.target.value)} aria-label={t('prl.f.project', 'Project')}>
            <option value="">{t('prl.f.allProjects', 'Every project')}</option>
            {projects.map(([ref, name]) => <option key={ref} value={ref}>{name}</option>)}
          </select>
        )}
      </div>
      {loading && !data ? <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : err ? <EmptyState icon={FlaskConical} title={t('prl.err', 'The pre-releases could not be loaded')} sub={t('prl.err.s', 'Reload the page to try again.')} />
        : !shown.length ? (
          <EmptyState icon={FlaskConical} title={status === 'all' && !project && !nq ? t('prl.none', 'No pre-release right now') : t('prl.nomatch', 'No pre-release matches')}
            sub={status === 'all' && !project && !nq ? t('prl.none.s', 'When a project opens early access, it appears here and on the home page.') : t('prl.nomatch.s', 'Change the filters to see more.')}
            action={status !== 'all' || project || nq ? { label: t('prl.reset', 'Reset the filters'), onClick: () => { setQ(''); setSp(new URLSearchParams()); } } : null} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="prerelease-list">
            {shown.map((pr) => <PrereleaseCard key={pr.slug} pr={pr} />)}
          </div>
        )}
    </div>
  );
}

export function PrereleasePage() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, err, reload } = useAsync(() => api.get(`/prereleases/${encodeURIComponent(slug)}`), [slug]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (err || !data?.prerelease) {
    return <EmptyState as="h1" icon={FlaskConical} title={t('prl.notFound', 'Pre-release not found')} sub={t('prl.notFound.s', 'It may have ended, or it is not public.')}
      action={{ label: t('prl.list.back', 'Every pre-release'), to: '/prereleases', icon: FlaskConical }} />;
  }
  const pr = data.prerelease; const me = data.me;
  const title = prText(pr, lang, 'title'); const pitch = prText(pr, lang, 'pitch'); const body = prText(pr, lang, 'body');
  const errText = (code) => ({
    closed: t('prl.err.closed', 'Sign-ups are closed.'), full: t('prl.err.full', 'Every place is taken.'),
    already_signed_up: t('prl.err.already', 'You are already signed up.'), account_too_new: t('prl.err.new', 'Your account needs to be at least a day old to sign up.'),
    email_unverified: t('prl.err.email', 'Confirm your e-mail address first: the team writes to you there.'), no_links: t('prl.err.links', 'Links are not accepted in the message.'),
  })[code] || t('common.failed', 'Failed.');

  const signUp = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/prereleases/${encodeURIComponent(pr.slug)}/signup`, { message: message.trim() || undefined });
      toast.success(r.me?.status === 'selected' ? t('prl.done.selected', 'You are in: the download is below.') : t('prl.done', 'You are signed up. You will get a mail if you are selected.'));
      setMessage('');
      reload();
    } catch (x) { toast.error(errText(x.data?.error)); }
    finally { setBusy(false); }
  };
  const withdraw = async () => {
    if (!(await dialog.confirm({ title: t('prl.withdraw.t', 'Withdraw your sign-up?'), message: me?.status === 'selected' ? t('prl.withdraw.sel', 'You lose your access to the download. Signing up again puts you back in the queue, if sign-ups are still open.') : t('prl.withdraw.m', 'Your sign-up is deleted.'), okLabel: t('prl.withdraw', 'Withdraw'), danger: true }))) return;
    // The Gmail-style undo: nothing leaves the server until the toast expires.
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg: t('prl.withdrawn', 'Sign-up withdrawn.'),
      onCommit: async () => {
        try { await api.del(`/prereleases/${encodeURIComponent(pr.slug)}/signup`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); }
      },
      onCancel: () => {},
    });
  };

  const canDownload = me?.status === 'selected' && pr.hasFile && ['open', 'selecting', 'available'].includes(pr.phase);
  const draw = (pr.rounds || []).find((r) => r.mode === 'draw');
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link to="/prereleases" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">{t('prl.list.back', 'Every pre-release')}</Link>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <PhaseBadge phase={pr.phase} />
          {pr.version && <Badge>v{pr.version}</Badge>}
          <MyStatusBadge me={me} />
        </div>
        <h1 className="text-3xl font-extrabold mt-2 break-words">{title}</h1>
        {pr.project && <Link to={pr.project.url} className="text-sm text-[var(--accent-ink)] hover:underline">{pr.project.name}</Link>}
        {pitch && <p className="text-[var(--muted)] mt-2">{pitch}</p>}
        <div className="text-xs text-[var(--faint)] mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {pr.opensAt && <span className="inline-flex items-center gap-1"><Clock size={12} /> {t('prl.opensOn', 'Opens {d}').replace('{d}', fmtDay(pr.opensAt, lang))}</span>}
          {pr.closesAt && <span className="inline-flex items-center gap-1"><Clock size={12} /> {t('prl.closesOn', 'Sign-ups close {d}').replace('{d}', fmtDay(pr.closesAt, lang))}</span>}
          {pr.capacity != null && <span className="inline-flex items-center gap-1"><Users size={12} /> {t('prl.capacity', '{left} of {cap} places left').replace('{left}', String(pr.spotsLeft ?? 0)).replace('{cap}', String(pr.capacity))}</span>}
          <span>{({ manual: t('prl.mode.manual', 'The team picks who gets it'), draw: t('prl.mode.draw', 'Chosen by a public draw'), first: t('prl.mode.first', 'First come, first served'), all: t('prl.mode.all', 'Open to everyone who signs up') })[pr.mode]}</span>
        </div>
        {data.canManage && <Link to="/admin?s=prereleases" className="inline-block mt-3"><Button size="sm"><Settings2 size={14} /> {t('prl.manage', 'Manage this pre-release')}</Button></Link>}
      </div>

      {/* The member's box: the one thing they can do now. */}
      <Card className="p-5 mb-6" data-testid="prerelease-member-box">
        {!user ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 text-sm">{pr.phase === 'open' ? t('prl.signin', 'Sign in to sign up. An account is needed: it is how the team reaches you and how the download knows it is you.') : t('prl.signin.other', 'Sign in to see your status.')}</p>
            <Link to={`/auth?next=${encodeURIComponent(`/prereleases/${pr.slug}`)}`}><Button variant="primary"><LogIn size={15} /> {t('nav.signin', 'Sign in')}</Button></Link>
          </div>
        ) : me ? (
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {me.status === 'selected' ? <CheckCircle2 size={18} className="text-success" /> : me.status === 'not_selected' ? <XCircle size={18} className="text-[var(--muted)]" /> : <Hourglass size={18} className="text-[var(--accent-ink)]" />}
              <span className="font-semibold" data-testid="prerelease-my-status">{me.status === 'selected' ? t('prl.st.selected', 'You are selected') : me.status === 'not_selected' ? t('prl.st.not', 'You were not selected this time') : t('prl.st.pending', 'You are signed up')}</span>
              <span className="text-xs text-[var(--faint)]">{t('prl.st.since', 'since {d}').replace('{d}', fmtDay(me.createdAt, lang))}</span>
            </div>
            <p className="text-sm text-[var(--muted)] mt-2">
              {me.status === 'selected' ? (pr.hasFile ? t('prl.st.selected.s', 'The download is yours. It works for your account only.') : t('prl.st.selected.nofile', 'The file is not up yet. You will find it here.'))
                : me.status === 'not_selected' ? t('prl.st.not.s', 'Places were limited. Thank you for signing up.')
                : t('prl.st.pending.s', 'The team chooses once sign-ups close. You get a mail if you are selected.')}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {canDownload && (
                <a href={`/api/prereleases/${encodeURIComponent(pr.slug)}/download`} rel="nofollow noreferrer" data-testid="prerelease-download">
                  <Button variant="primary"><Download size={15} /> {t('prl.download', 'Download')}{pr.downloadName ? ` ${pr.downloadName}` : ''}{pr.downloadSize ? ` (${formatBytes(pr.downloadSize)})` : ''}</Button>
                </a>
              )}
              <Button variant="ghost" onClick={withdraw}><Trash2 size={14} /> {t('prl.withdraw', 'Withdraw')}</Button>
            </div>
          </div>
        ) : pr.phase === 'open' ? (
          <div>
            <Field label={t('prl.msg', 'A word to the team (optional)')}>
              <Textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('prl.msg.ph', 'What you would test, on what setup…')} />
            </Field>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <Button variant="primary" disabled={busy || pr.spotsLeft === 0} onClick={signUp} data-testid="prerelease-signup">{busy ? <Spinner /> : <FlaskConical size={15} />} {t('prl.signup', 'Sign up')}</Button>
              <span className="text-xs text-[var(--faint)]">{t('prl.signup.note', 'Your display name and your message are visible to the project team.')}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">{pr.phase === 'upcoming' ? t('prl.notyet', 'Sign-ups have not opened yet.') : t('prl.over', 'Sign-ups are closed.')}</p>
        )}
      </Card>

      {body && <Card className="p-5 sm:p-6 mb-6"><Markdown>{body}</Markdown></Card>}

      {/* How the selection is kept honest, for the curious. */}
      {pr.mode === 'draw' && (
        <Explain summary={<span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} /> {t('prl.fair', 'How the draw is kept fair')}</span>}>
          <p className="text-sm">{t('prl.fair.1', 'Before anyone signed up, the draw was locked to a secret number whose fingerprint is published here. After the draw the number itself is published, so anyone can recompute who won.')}</p>
          <div className="text-xs font-mono break-all mt-2"><Hash size={11} className="inline" /> {t('prl.fair.commit', 'Fingerprint')}: {pr.seedHash}</div>
          {pr.seed && <div className="text-xs font-mono break-all mt-1">{t('prl.fair.seed', 'Revealed number')}: {pr.seed}</div>}
          {draw && <div className="text-xs mt-1">{t('prl.fair.round', 'Round {r}: {w} chosen out of {e}, {algo}').replace('{r}', String(draw.round)).replace('{w}', String(draw.selected)).replace('{e}', String(draw.entrants)).replace('{algo}', draw.algo || '')}</div>}
        </Explain>
      )}
    </div>
  );
}

/** "Your early access" on the dashboard: renders nothing for a member who never signed up. */
export function MyPrereleasesCard() {
  const { t, lang } = useI18n();
  const { data } = useAsync(() => api.get('/me/prereleases').catch(() => null), []);
  const list = data?.signups || [];
  if (!list.length) return null;
  return (
    <Card className="p-5" data-testid="my-prereleases">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical size={16} className="text-[var(--accent-ink)]" />
        <h3 className="font-semibold">{t('prl.mine', 'Your early access')}</h3>
        <Link to="/prereleases" className="ms-auto text-xs text-[var(--accent-ink)] inline-flex items-center gap-1">{t('prl.strip.all', 'Every pre-release')} <ArrowRight size={12} /></Link>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {list.map(({ me, prerelease: pr }) => (
          <li key={pr.slug} className="py-2.5 flex items-center gap-3 flex-wrap">
            <Link to={`/prereleases/${pr.slug}`} className="font-medium hover:underline min-w-0 break-words">{prText(pr, lang, 'title')}</Link>
            {pr.project && <span className="text-xs text-[var(--muted)]">{pr.project.name}</span>}
            <span className="ms-auto flex items-center gap-2"><PhaseBadge phase={pr.phase} /><MyStatusBadge me={me} /></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A project page's "Early access" tab. `data` is GET /projects-prereleases/:ref. */
export function ProjectEarlyTab({ data }) {
  const { t } = useI18n();
  const list = data?.prereleases || [];
  if (!list.length) {
    return <EmptyState icon={FlaskConical} title={t('prl.proj.none', 'No early access for this project yet')}
      sub={data?.canManage ? t('prl.proj.none.edit', 'Open one from the admin: Projects, Early access.') : t('prl.proj.none.s', 'When the team opens one, it appears here.')}
      action={data?.canManage ? { label: t('prl.manage.open', 'Open early access'), to: '/admin?s=prereleases', icon: FlaskConical } : null} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="project-prereleases">
      {list.map((pr) => <PrereleaseCard key={pr.slug} pr={pr} />)}
    </div>
  );
}

/**
 * What a project page needs for its "Early access" and "Reviews" tabs, in one hook. `ref` is the
 * project's ref (its key, or `sc:<slug>`); null asks nothing (the studio's preview of a draft).
 * A failure leaves both null, and the tabs are simply not offered.
 */
export function useProjectExtras(ref) {
  const early = useAsync(() => (ref ? api.get(`/projects-prereleases/${encodeURIComponent(ref)}`).catch(() => null) : Promise.resolve(null)), [ref]);
  const reviews = useAsync(() => (ref ? api.get(`/projects-reviews/${encodeURIComponent(ref)}`).catch(() => null) : Promise.resolve(null)), [ref]);
  return {
    early: early.data, reviews: reviews.data,
    showEarly: !!(early.data && (early.data.prereleases?.length > 0 || early.data.canManage)),
    showReviews: !!(reviews.data && (reviews.data.enabled || reviews.data.canConfigure)),
    reloadReviews: () => reviews.reload(true),
  };
}
