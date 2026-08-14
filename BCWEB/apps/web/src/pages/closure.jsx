// The page the "keep my account" button in the closure email points at.
//
// It must work SIGNED OUT. Somebody stopping their own deletion is often reading the email
// on a phone they have never signed in on, and a login wall in front of that is the worst
// possible place for one — so this page takes the token straight from the URL and calls an
// endpoint that needs no session.
//
// It also acts on load rather than presenting a button. The user already pressed a button:
// the one in the email. Making them press a second one adds a step whose only effect is
// that a distracted person closes the tab believing they are safe.
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Spinner, Select, Textarea, Field } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

const REASONS = ['not_using', 'too_expensive', 'missing_feature', 'privacy', 'moved_elsewhere', 'other'];

export default function ClosureCancel() {
  const { t } = useI18n();
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const token = sp.get('token') || '';
  const [state, setState] = useState('working'); // working | cancelled | active | error
  // The survey is a separate, later step. Offered only once the account is safe, and
  // skippable by simply leaving — it is a question, not a toll gate.
  const [survey, setSurvey] = useState({ open: false, reason: '', comment: '', sent: false, busy: false });

  useEffect(() => {
    if (!token) { setState('error'); return; }
    api.post('/account/closure/cancel', { token })
      .then((r) => setState(r.alreadyActive ? 'active' : 'cancelled'))
      .catch(() => setState('error'));
  }, [token]);

  const sendSurvey = async () => {
    setSurvey((s) => ({ ...s, busy: true }));
    try {
      await api.post('/me/closure/survey', { outcome: 'cancelled', reason: survey.reason, comment: survey.comment });
      setSurvey((s) => ({ ...s, sent: true, busy: false }));
    } catch { setSurvey((s) => ({ ...s, sent: true, busy: false })); }
  };

  return (
    <div className="max-w-lg mx-auto py-10">
      <Card className="p-6">
        {state === 'working' && <div className="flex items-center gap-3 text-sm text-[var(--muted)]"><Spinner /> {t('acl.working', 'Stopping the closure…')}</div>}

        {(state === 'cancelled' || state === 'active') && (
          <>
            <div className="flex items-center gap-2 text-[var(--success)] font-semibold">
              <ShieldCheck size={18} /> {t('acl.safe', 'Your account is staying open.')}
            </div>
            <p className="text-sm text-[var(--muted)] mt-2">
              {state === 'cancelled'
                ? t('acl.cancelled', 'The scheduled closure has been called off. Nothing was deleted, and everything is exactly where you left it.')
                // Not framed as an error: the reader only cares that the account is not
                // closing, and that is true whether this is the first click or the third.
                : t('acl.already', 'There was no closure scheduled — your account was already active. Nothing to do.')}
            </p>
            <div className="flex gap-2 mt-4">
              <Link to="/"><Button variant="primary">{t('acl.home', 'Back to the site')}</Button></Link>
              {!survey.open && !survey.sent && user && (
                <Button variant="ghost" onClick={() => setSurvey((s) => ({ ...s, open: true }))}>
                  {t('acl.tellus', 'Tell us why (optional)')}
                </Button>
              )}
            </div>

            {survey.open && !survey.sent && (
              <div className="mt-5 pt-4 border-t border-[var(--line)] space-y-3">
                <p className="text-sm text-[var(--muted)]">{t('acl.survey.s', 'What made you want to leave? It helps, and it changes nothing about your account.')}</p>
                <Field label={t('acl.survey.reason', 'Main reason')}>
                  <Select value={survey.reason} onChange={(e) => setSurvey((s) => ({ ...s, reason: e.target.value }))}>
                    <option value="">{t('acl.survey.pick', 'Prefer not to say')}</option>
                    {REASONS.map((r) => <option key={r} value={r}>{t(`acl.reason.${r}`, r)}</option>)}
                  </Select>
                </Field>
                <Field label={t('acl.survey.more', 'Anything else (optional)')}>
                  <Textarea rows={3} value={survey.comment} onChange={(e) => setSurvey((s) => ({ ...s, comment: e.target.value }))} />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={survey.busy} onClick={sendSurvey}>{survey.busy ? <Spinner /> : t('acl.survey.send', 'Send')}</Button>
                  <Button size="sm" onClick={() => setSurvey((s) => ({ ...s, open: false }))}>{t('common.cancel', 'Cancel')}</Button>
                </div>
              </div>
            )}
            {survey.sent && <p className="text-sm text-[var(--success)] mt-4 flex items-center gap-1.5"><Check size={14} /> {t('acl.survey.thanks', 'Thank you — that is genuinely useful.')}</p>}
          </>
        )}

        {state === 'error' && (
          <>
            <div className="flex items-center gap-2 text-warning font-semibold"><AlertTriangle size={18} /> {t('acl.err.t', 'That link did not work')}</div>
            <p className="text-sm text-[var(--muted)] mt-2">
              {t('acl.err.s', 'It may have been mistyped or cut in half by your email client. Sign in and cancel the closure from your profile instead — the option is there for as long as the closure is pending.')}
            </p>
            <Link to="/profile" className="inline-block mt-4"><Button variant="primary">{t('acl.err.go', 'Go to my profile')}</Button></Link>
          </>
        )}
      </Card>
    </div>
  );
}
