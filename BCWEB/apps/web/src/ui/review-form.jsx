// M11: a member's own review for the landing page.
//
// One per account, sent to a moderator before anyone reads it (the API holds it as `pending`
// and the public /reviews feed only returns approved rows). Editing an approved review sends
// it back to the queue, and the card says so before the member presses Send, not after.
import { useEffect, useState } from 'react';
import { MessageSquare, Star, Trash2, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Card, Badge, Input, Textarea, Field, Select, Spinner, useDialog, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const MIN = 20, MAX = 600;

export function MyReviewCard() {
  const { t, lang } = useI18n();
  const toast = useToast(); const dialog = useDialog();
  const [state, setState] = useState(null); // { review, sectionOn } once loaded
  const [f, setF] = useState({ body: '', rating: 0, role: '', lang: lang === 'fr' ? 'fr' : 'en' });
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false); // removed, inside the undo window

  const load = () => api.get('/me/review').then((r) => {
    setState(r);
    if (r.review) setF({ body: r.review.body || '', rating: r.review.rating || 0, role: r.review.role || '', lang: r.review.lang || 'en' });
  }).catch(() => setState({ review: null, sectionOn: false }));
  useEffect(() => { load(); }, []);

  if (!state || hidden) return null;
  const review = state.review;
  // No reviews section on the landing and nothing written yet: nothing to offer.
  if (!state.sectionOn && !review) return null;

  const len = f.body.trim().length;
  const tooShort = len < MIN, tooLong = len > MAX;
  const errText = (code) => ({
    no_links: t('rvf.err.links', 'Links are not accepted in a review.'),
    account_too_new: t('rvf.err.new', 'Your account needs to be at least a day old to post a review.'),
    invalid_input: t('rvf.err.input', 'Check the text: between 20 and 600 characters.'),
  })[code] || t('common.failed', 'Failed.');

  const send = async () => {
    if (tooShort || tooLong) return;
    setBusy(true);
    try {
      const r = await api.put('/me/review', { body: f.body.trim(), rating: f.rating || null, role: f.role.trim(), lang: f.lang });
      setState((s) => ({ ...s, review: r.review }));
      toast.success(t('rvf.sent', 'Thank you. A moderator will read it before it appears.'));
    } catch (x) { toast.error(errText(x.data?.error)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await dialog.confirm({ title: t('rvf.del', 'Delete your review?'), message: t('rvf.del.m', 'It leaves the home page and the moderation queue.'), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    setHidden(true);
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('rvf.deleted', 'Review deleted.'),
      onCommit: async () => {
        try { await api.del('/me/review'); setState((s) => ({ ...s, review: null })); setF({ body: '', rating: 0, role: '', lang: lang === 'fr' ? 'fr' : 'en' }); }
        catch { toast.error(t('common.failed', 'Failed.')); }
        finally { setHidden(false); }
      },
      onCancel: () => setHidden(false),
    });
  };

  const status = review?.status;
  const statusBadge = status === 'pending' ? <Badge tone="amber"><Clock size={11} /> {t('rvf.st.pending', 'Waiting for a moderator')}</Badge>
    : status === 'approved' ? <Badge tone="green"><CheckCircle2 size={11} /> {t('rvf.st.approved', 'Shown on the home page')}</Badge>
    : status === 'rejected' ? <Badge tone="red"><XCircle size={11} /> {t('rvf.st.rejected', 'Not published')}</Badge> : null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h3 className="font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-[var(--accent-ink)]" /> {t('rvf.title', 'Your review of BetterCommunity')}</h3>
        {statusBadge}
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">
        {review
          ? (status === 'rejected' ? t('rvf.desc.rejected', 'A moderator did not publish this one. You can change it and send it again.')
            : status === 'approved' ? t('rvf.desc.approved', 'Changing it sends it back to a moderator; until then the home page stops showing it.')
            : t('rvf.desc.pending', 'A moderator reads every review before it appears. You can still change it.'))
          : t('rvf.desc', 'A few words on what you use and what it changed for you. A moderator reads it before it appears on the home page, with your display name.')}
      </p>
      {!state.sectionOn && <p className="text-xs text-[var(--faint)] mb-3">{t('rvf.off', 'The home page is not showing reviews right now.')}</p>}

      <Field label={t('rvf.body', 'Your review')}>
        <Textarea rows={4} maxLength={MAX + 50} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={t('rvf.body.ph', 'What do you use, and what did it change for you?')} />
      </Field>
      <div className={`text-[11px] mt-1 ${tooLong ? 'text-error' : 'text-[var(--faint)]'}`}>
        {len}/{MAX}{tooShort && len > 0 ? ` · ${t('rvf.min', 'at least {n} characters').replace('{n}', MIN)}` : ''}
      </div>

      <div className="flex items-end gap-3 mt-3 flex-wrap">
        <Field label={t('rvf.rating', 'Rating (optional)')}>
          <div className="flex items-center gap-0.5 h-10" role="radiogroup" aria-label={t('rvf.rating', 'Rating (optional)')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={f.rating === n}
                aria-label={t('rvf.stars', '{n} out of 5').replace('{n}', n)}
                onClick={() => setF({ ...f, rating: f.rating === n ? 0 : n })}
                className={`p-1 ${n <= f.rating ? 'text-warning' : 'text-[var(--faint)] hover:text-warning'}`}>
                <Star size={18} fill={n <= f.rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('rvf.role', 'About you (optional)')}>
          <Input value={f.role} maxLength={60} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder={t('rvf.role.ph', 'Modder, server owner…')} />
        </Field>
        <Field label={t('rvf.lang', 'Written in')}>
          <Select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <Button variant="primary" disabled={busy || tooShort || tooLong} onClick={send}>
          {busy ? <Spinner /> : review ? t('rvf.resend', 'Send the new version') : t('rvf.send', 'Send for review')}
        </Button>
        {review && <Button variant="ghost" onClick={remove}><Trash2 size={14} /> {t('common.delete', 'Delete')}</Button>}
      </div>
    </Card>
  );
}
