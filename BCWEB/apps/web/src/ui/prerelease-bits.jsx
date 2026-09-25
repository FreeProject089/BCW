// prerelease (agent-prerelease): the small pieces of early access that the HOME page draws.
//
// Kept apart from pages/prereleases.jsx on purpose: the home page is in the entry chunk, and
// a card strip must not pull the whole pre-release page (and its markdown renderer) into every
// first visit. The pages import these too; they are tiny.
import { Link } from 'react-router-dom';
import { FlaskConical, ArrowRight, Users, Clock, CheckCircle2, XCircle, Hourglass } from 'lucide-react';
import { Badge, Card, Button } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from '../pages/pages.jsx';

/** The title / pitch in the reader's language, English as the fallback. */
export function prText(pr, lang, key) {
  return (lang === 'fr' && pr?.[`${key}Fr`]) || pr?.[key] || '';
}

export function usePhaseLabel() {
  const { t } = useI18n();
  return (phase) => ({
    draft: t('prl.phase.draft', 'Draft'),
    upcoming: t('prl.phase.upcoming', 'Opens soon'),
    open: t('prl.phase.open', 'Sign-ups open'),
    selecting: t('prl.phase.selecting', 'Selection in progress'),
    available: t('prl.phase.available', 'Available to the selected'),
    closed: t('prl.phase.closed', 'Ended'),
  })[phase] || phase;
}

const PHASE_TONE = { open: 'green', upcoming: 'blue', selecting: 'amber', available: 'primary', closed: '', draft: 'amber' };
export function PhaseBadge({ phase }) {
  const label = usePhaseLabel();
  return <Badge tone={PHASE_TONE[phase] || ''} data-phase={phase}>{label(phase)}</Badge>;
}

/** A member's own status on one pre-release. */
export function MyStatusBadge({ me }) {
  const { t } = useI18n();
  if (!me) return null;
  if (me.status === 'selected') return <Badge tone="green" data-status="selected"><CheckCircle2 size={11} /> {t('prl.me.selected', 'You are selected')}</Badge>;
  if (me.status === 'not_selected') return <Badge data-status="not_selected"><XCircle size={11} /> {t('prl.me.notSelected', 'Not selected this time')}</Badge>;
  return <Badge tone="blue" data-status="pending"><Hourglass size={11} /> {t('prl.me.pending', 'Signed up')}</Badge>;
}

export function fmtDay(d, lang) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}

/** One pre-release as a card: title, project, phase, window, and the one action that fits. */
export function PrereleaseCard({ pr, compact = false }) {
  const { t, lang } = useI18n();
  const title = prText(pr, lang, 'title');
  const pitch = prText(pr, lang, 'pitch');
  const to = `/prereleases/${pr.slug}`;
  return (
    <Card hover className="p-4 h-full flex flex-col" data-prerelease={pr.slug}>
      <div className="flex items-center gap-2 flex-wrap">
        <FlaskConical size={16} className="text-[var(--accent-ink)] shrink-0" />
        <PhaseBadge phase={pr.phase} />
        {pr.version && <span className="text-xs text-[var(--faint)]">v{pr.version}</span>}
        <MyStatusBadge me={pr.me} />
      </div>
      <Link to={to} className="font-semibold mt-2 hover:underline break-words">{title}</Link>
      {pr.project && <div className="text-xs text-[var(--muted)] mt-0.5">{pr.project.name}</div>}
      {!compact && pitch && <p className="text-sm text-[var(--muted)] mt-2 break-words">{pitch}</p>}
      <div className="text-[11px] text-[var(--faint)] mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {pr.closesAt && pr.phase === 'open' && <span className="inline-flex items-center gap-1"><Clock size={11} /> {t('prl.until', 'Until {d}').replace('{d}', fmtDay(pr.closesAt, lang))}</span>}
        {pr.opensAt && pr.phase === 'upcoming' && <span className="inline-flex items-center gap-1"><Clock size={11} /> {t('prl.opens', 'Opens {d}').replace('{d}', fmtDay(pr.opensAt, lang))}</span>}
        {pr.spotsLeft != null && pr.phase === 'open' && <span className="inline-flex items-center gap-1"><Users size={11} /> {t('prl.spots', '{n} places left').replace('{n}', String(pr.spotsLeft))}</span>}
      </div>
      <div className="mt-auto pt-3">
        <Link to={to}>
          <Button size="sm" variant={pr.phase === 'open' && !pr.me ? 'primary' : undefined}>
            {pr.phase === 'open' && !pr.me ? t('prl.signup', 'Sign up') : t('prl.see', 'See details')} <ArrowRight size={13} />
          </Button>
        </Link>
      </div>
    </Card>
  );
}

/**
 * The open pre-releases, under the suite on the landing page. Draws NOTHING while there are
 * none: an empty "early access" block is an advert for nothing.
 */
export function PrereleaseStrip({ className = '' }) {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/prereleases?status=open&limit=6').catch(() => null), []);
  const list = data?.prereleases || [];
  if (!list.length) return null;
  return (
    <div className={`mt-8 ${className}`} data-testid="prerelease-strip">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FlaskConical size={16} className="text-[var(--accent-ink)]" />
        <h3 className="font-semibold">{t('prl.strip.title', 'Early access')}</h3>
        <span className="text-sm text-[var(--muted)]">{t('prl.strip.sub', 'Try the next versions before everyone else.')}</span>
        <Link to="/prereleases" className="ms-auto text-sm text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1">{t('prl.strip.all', 'Every pre-release')} <ArrowRight size={13} /></Link>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {list.map((pr) => <PrereleaseCard key={pr.slug} pr={pr} compact />)}
      </div>
    </div>
  );
}
