// prerelease (agent-prerelease): "Give your opinion", on the landing page itself.
//
// The member review (ui/review-form.jsx, M11 + N10) existed and was reachable from one place:
// a card at the bottom of the dashboard. Nobody reading the reviews on the home page could tell
// they were allowed to write one. So the landing carries the entry point: signed in, it opens
// the same form in a dialog (the same component, the same rules, the same moderation); signed
// out, it signs you in and brings you back with the dialog open (`/?review=1`).
//
// Drawn only while the landing shows its reviews section at all (`enabled`), the rule the form
// itself follows.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquarePlus, LogIn } from 'lucide-react';
import { Button, Card, Modal, Spinner } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';

// The form arrives when somebody opens it: most visitors never do.
const MyReviewCard = lazy(() => import('./review-form.jsx').then((m) => ({ default: m.MyReviewCard })));

export default function LandingReviewCta() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(false);
  // Back from the sign-in with ?review=1: open the form once, then drop the parameter so a
  // reload or a shared link does not reopen it.
  useEffect(() => {
    if (user && sp.get('review') === '1') {
      setOpen(true);
      setSp((p) => { const n = new URLSearchParams(p); n.delete('review'); return n; }, { replace: true });
    }
  }, [user, sp, setSp]);
  return (
    <section>
      <Card className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="landing-review-cta">
        <MessageSquarePlus size={28} className="text-[var(--accent-ink)] shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-lg">{t('lrc.title', 'What do you think of BetterCommunity?')}</h2>
          <p className="text-sm text-[var(--muted)] mt-1">{t('lrc.sub', 'Leave a review for the home page, or a private word for the team.')}</p>
        </div>
        {user ? (
          <Button variant="primary" onClick={() => setOpen(true)}><MessageSquarePlus size={15} /> {t('lrc.cta', 'Give your opinion')}</Button>
        ) : (
          <Link to={`/auth?next=${encodeURIComponent('/?review=1')}`}><Button variant="primary"><LogIn size={15} /> {t('lrc.signin', 'Sign in to give your opinion')}</Button></Link>
        )}
      </Card>
      {user && (
        <Modal open={open} onClose={() => setOpen(false)} title={t('lrc.cta', 'Give your opinion')} icon={MessageSquarePlus} width="max-w-2xl">
          <Suspense fallback={<div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>}>
            <MyReviewCard />
          </Suspense>
        </Modal>
      )}
    </section>
  );
}
