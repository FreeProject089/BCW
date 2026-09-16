// Reaching the user or team behind a repo, a catalogue or a profile.
//
// A REPORT goes to staff (ui/report.jsx). THIS opens a conversation with whoever manages
// the thing, on the site: signed in, it lands in both dashboards; signed out, the sender
// leaves an e-mail and follows the thread by a link. Beside the button, the public pages
// show what the owner declared — the team's card, and for a repo served from the owner's
// own server, the contact e-mail they were required to give.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Mail, Phone, Users, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { Button, Modal, Input, Textarea, Field, useToast, copyText } from './ui.jsx';

export function ContactButton({ kind, targetId, targetLabel, size = 'sm', variant = 'ghost', className = '', label }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}><MessageSquare size={13} /> {label || t('cm.contact', 'Contact')}</Button>
      {open && <ContactModal kind={kind} targetId={targetId} targetLabel={targetLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ContactModal({ kind, targetId, targetLabel, onClose }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const send = async () => {
    if (subject.trim().length < 2) return toast.error(t('cm.needsubject', 'Give the message a subject.'));
    if (body.trim().length < 10) return toast.error(t('cm.needbody', 'Write a few more words.'));
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error(t('cm.needemail', 'Leave an e-mail so they can answer you.'));
    setBusy(true);
    try {
      const payload = { kind, targetId, subject: subject.trim(), body: body.trim() };
      if (!user) {
        const { solvePow } = await import('../lib/pow.js');
        payload.pow = await solvePow(() => api.get('/auth/pow'));
        payload.email = email.trim(); if (name.trim()) payload.name = name.trim();
      }
      const r = await api.post('/threads', payload);
      setSent(r);
      if (user) { toast.success(t('cm.sent', 'Sent, follow the conversation in your dashboard → Messages.')); onClose(); }
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'rate_limited' ? t('cm.rate', 'Too many messages for now, try again later.')
        : e === 'yourself' ? t('cm.self', 'That is you.')
        : e === 'blocked' ? t('cm.blocked', 'Messaging is not available for this sender.')
        : e === 'not_found' ? t('cm.gone', 'This cannot be contacted any more.')
        : e === 'disabled' ? t('cm.disabled', 'Messaging is switched off for now.')
        // The three refusals that are member-to-member specific. Each one says WHOSE
        // decision it was, because "not available" sends people to support to ask why.
        : e === 'messaging_off_site' ? t('cm.dm.site', 'Conversations between members are switched off on this site.')
        : e === 'messaging_off_member' ? t('cm.dm.member', 'This member does not accept conversations.')
        : e === 'too_many_open' ? t('cm.dm.cap', 'You already have as many open conversations as the site allows. Close or archive one first.')
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
          <Field label={t('cm.subject', 'Subject')}><Input value={subject} maxLength={140} onChange={(e) => setSubject(e.target.value)} placeholder={t('cm.subject.ph', 'A broken download, a question, a request…')} /></Field>
          <Field label={t('cm.body', 'Message')}><Textarea rows={6} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} /></Field>
          {!user && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label={t('cm.email', 'Your e-mail')} hint={t('cm.email.h', 'Only they and staff can see it. Answers arrive there.')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label={t('cm.name', 'Your name (optional)')}><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
            </div>
          )}
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
