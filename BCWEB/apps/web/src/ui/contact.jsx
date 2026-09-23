// Reaching the user or team behind a repo, a catalogue or a profile.
//
// A REPORT goes to staff (ui/report.jsx). THIS opens a conversation with whoever manages
// the thing, on the site: signed in, it lands in both dashboards; signed out, the sender
// leaves an e-mail and follows the thread by a link. Beside the button, the public pages
// show what the owner declared — the team's card, and for a repo served from the owner's
// own server, the contact e-mail they were required to give.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Mail, Phone, Users, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { Button, Modal, Input, Textarea, Field, Select, useToast, copyText } from './ui.jsx';
import { useDraft, DraftBanner, DraftKeptNote } from './drafts.jsx';
import { topicLabel } from './topic-label.js';

export function ContactButton({ kind, targetId, targetLabel, size = 'sm', variant = 'default', className = '', label }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}><MessageSquare size={13} /> {label || t('cm.contact', 'Contact')}</Button>
      {open && <ContactModal kind={kind} targetId={targetId} targetLabel={targetLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

// `topics`: when the target offers them (a project), the sender picks one. The API refuses a
// topic the target does not offer, so this list is a convenience, not the rule.
export function ContactModal({ kind, targetId, targetLabel, onClose, topics = null, initialTopic = '' }) {
  const { t, lang } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [topic, setTopic] = useState(initialTopic || (topics?.length === 1 ? topics[0].id : ''));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  // A kept draft (ui/drafts.jsx). Worth it here and not on every two-field box: this is six
  // hundred words of "here is what is wrong with your download" typed into a modal that any
  // click outside closes, and there is no copy of it anywhere until it is sent. Scoped to the
  // thing being written to, so a half-written message to one repo is not offered on another.
  const value = useMemo(() => ({ topic, subject, body, email, name }), [topic, subject, body, email, name]);
  const draft = useDraft({
    scope: 'contact', id: `${kind}.${targetId}`, value,
    onRestore: (v) => { setTopic(v.topic || ''); setSubject(v.subject || ''); setBody(v.body || ''); setEmail(v.email || ''); setName(v.name || ''); },
  });

  const send = async () => {
    if (topics?.length && !topic) return toast.error(t('cm.needtopic', 'Pick what it is about.'));
    if (subject.trim().length < 2) return toast.error(t('cm.needsubject', 'Give the message a subject.'));
    if (body.trim().length < 10) return toast.error(t('cm.needbody', 'Write a few more words.'));
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error(t('cm.needemail', 'Leave an e-mail so they can answer you.'));
    setBusy(true);
    try {
      const payload = { kind, targetId, subject: subject.trim(), body: body.trim(), ...(topic ? { topic } : {}) };
      if (!user) {
        const { solvePow } = await import('../lib/pow.js');
        payload.pow = await solvePow(() => api.get('/auth/pow'));
        payload.email = email.trim(); if (name.trim()) payload.name = name.trim();
      }
      const r = await api.post('/threads', payload);
      draft.clear();   // it is a message now, not a draft
      setSent(r);
      if (user) { toast.success(t('cm.sent', 'Sent, follow the conversation in your dashboard → Messages.')); onClose(); }
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'rate_limited' && x.data?.scope === 'member' ? t('cm.dm.rate', 'You started several conversations with members in a short time. Try again later.')
        : e === 'rate_limited' ? t('cm.rate', 'Too many messages for now, try again later.')
        : e === 'yourself' ? t('cm.self', 'That is you.')
        : e === 'blocked' ? t('cm.blocked', 'Messaging is not available for this sender.')
        : e === 'not_found' ? t('cm.gone', 'This cannot be contacted any more.')
        : e === 'disabled' ? t('cm.disabled', 'Messaging is switched off for now.')
        : e === 'project_contact_off' ? t('cm.projoff', 'This project does not take messages at the moment.')
        : e === 'invalid_topic' ? t('cm.badtopic', 'This project no longer offers that topic. Pick another one.')
        // The three refusals that are member-to-member specific. Each one says WHOSE
        // decision it was, because "not available" sends people to support to ask why.
        : e === 'messaging_off_site' ? t('cm.dm.site', 'Conversations between members are switched off on this site.')
        : e === 'messaging_off_member' ? t('cm.dm.member', 'This member does not accept conversations.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const link = sent?.accessToken ? `${window.location.origin}/messages/t/${sent.accessToken}` : '';
  return (
    <Modal open onClose={onClose} title={t('cm.title', 'Message about “{n}”').replace('{n}', targetLabel || '')} icon={MessageSquare} width="max-w-lg">
      {sent && !user ? (
        <div className="space-y-3 text-sm">
          <p>{t('cm.sentanon', 'Sent. You will be e-mailed when they answer. Keep this link, it is the only way back to the conversation without an account:')}</p>
          <div className="flex items-center gap-2">
            <Input value={link} readOnly className="text-xs" />
            <Button size="sm" onClick={async () => { await copyText(link); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
          </div>
          <div className="flex justify-end"><Button variant="primary" onClick={onClose}>{t('common.close', 'Close')}</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <DraftBanner draft={draft} what={t('draft.w.message', 'message')} />
          {topics?.length > 0 && (
            <Field label={t('cm.topic', 'About')}>
              <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">{t('cm.topic.pick', 'Pick a topic')}</option>
                {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp, t, lang)}</option>)}
              </Select>
            </Field>
          )}
          <Field label={t('cm.subject', 'Subject')}><Input value={subject} maxLength={140} onChange={(e) => setSubject(e.target.value)} placeholder={t('cm.subject.ph', 'A broken download, a question, a request…')} /></Field>
          <Field label={t('cm.body', 'Message')}><Textarea rows={6} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} /></Field>
          {!user && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label={t('cm.email', 'Your e-mail')} hint={t('cm.email.h', 'Only they and staff can see it. Answers arrive there.')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label={t('cm.name', 'Your name (optional)')}><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
            </div>
          )}
          <DraftKeptNote draft={draft} />
          <p className="text-[11px] text-[var(--faint)]">{t('cm.note', 'This goes to whoever manages it, not to the site staff. For rule-breaking content use Report; for rights claims use /report.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
            <Button variant="primary" loading={busy} onClick={send}>{t('cm.send', 'Send')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** What a public page shows about who is behind something: the team, and declared contacts. */
export function ContactStrip({ team, contactEmail, contactPhone, className = '' }) {
  const { t } = useI18n(); const toast = useToast();
  if (!team && !contactEmail && !contactPhone) return null;
  return (
    <div className={`flex items-center gap-3 flex-wrap text-[12.5px] text-[var(--muted)] ${className}`}>
      {team && <Link to={`/t/${team.slug}`} className="inline-flex items-center gap-1 hover:text-[var(--accent-ink)]"><Users size={13} /> {t('cm.team', 'Team')} <b className="text-[var(--text)]">{team.name}</b></Link>}
      {contactEmail && <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--accent-ink)]" onClick={async () => { await copyText(contactEmail); toast.success(t('common.copied', 'Copied.')); }} title={t('cm.copyemail', 'Copy the contact e-mail')}><Mail size={13} /> {contactEmail}</button>}
      {contactPhone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {contactPhone}</span>}
    </div>
  );
}
