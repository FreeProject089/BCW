// What a fresh install shows on "Needs attention" (admin.jsx AdminNeedsAttention).
//
// Moved out of admin-demo.jsx when demo mode was retired (Sept 23): every queue empty is also
// what a brand-new site looks like, and "nothing waiting" alone reads as a dead end, so this
// lists where to start. The demo-mode step went with the feature.
import { Link } from 'react-router-dom';
import { Sliders, Boxes, BookOpen, CheckCircle2 } from 'lucide-react';
import { Card, EmptyState } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';

export function AdminFirstRun({ isAdmin }) {
  const { t } = useI18n();
  const steps = [
    isAdmin && { to: '/admin?s=settings', icon: Sliders, title: t('fr.settings', 'Set up the site'), sub: t('fr.settings.s', 'Name, limits, anti-abuse and retention.') },
    isAdmin && { to: '/admin?s=catalogs', icon: Boxes, title: t('fr.catalog', 'Publish a first entry'), sub: t('fr.catalog.s', 'An official app, plugin or theme, live at once.') },
    { to: '/admin?s=guide', icon: BookOpen, title: t('fr.guide', 'Read the admin guide'), sub: t('fr.guide.s', 'What each screen is for, in a few lines.') },
  ].filter(Boolean);
  return (
    <div data-first-run>
      <EmptyState icon={CheckCircle2} title={t('nq.clear.t', 'Nothing waiting')} sub={t('fr.sub', 'Every queue you can act on is empty. On a new site, here is where to start.')} />
      <div className="grid sm:grid-cols-2 gap-2.5 mt-3">
        {steps.map((s) => (
          <Link key={s.to} to={s.to} className="block">
            <Card className="p-3.5 h-full hover:border-[var(--primary)] transition-colors flex items-start gap-3">
              <span className="grid place-items-center w-8 h-8 rounded-lg tint-primary shrink-0"><s.icon size={15} className="text-[var(--accent-ink)]" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-[var(--muted)]">{s.sub}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default AdminFirstRun;
