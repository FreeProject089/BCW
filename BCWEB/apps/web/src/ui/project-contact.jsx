// A project's contact: the button on its page, the inbox link for whoever answers, and the
// settings (topics, who reads) for whoever runs it.
//
// The conversations are ordinary contact threads (kind 'project'), so there is no second
// inbox to build: "Inbox" opens the dashboard's conversations filtered to this project, and
// the reply box, the receipts and the anonymous link are the ones every thread already has.
// Who may read is decided on the server (lib/project-contact.mjs); this only draws what the
// API says this viewer may do.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Inbox, Settings2, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, Modal, Input, Field, Badge, Explain, Spinner, useToast } from './ui.jsx';
import { ContactModal } from './contact.jsx';
import { topicLabel } from './topic-label.js';

export function ProjectContactBar({ projectRef }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [writing, setWriting] = useState(false);
  const [settings, setSettings] = useState(false);
  const load = () => api.get(`/projects-contact/${encodeURIComponent(projectRef)}`).then(setInfo).catch(() => setInfo(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (projectRef) load(); }, [projectRef]);
  if (!info) return null;
  return (
    <>
      {info.enabled && info.topics.length > 0 && (
        <Button variant="ghost" onClick={() => setWriting(true)}><MessageSquare size={15} /> {t('cm.contact', 'Contact')}</Button>
      )}
      {info.canReadInbox && (
        <Link to={`/dashboard?s=reports&project=${encodeURIComponent(info.ref)}`}>
          <Button variant="ghost" title={t('pct.inbox.h', 'The conversations people started with this project')}>
            <Inbox size={15} /> {t('pct.inbox', 'Inbox')}{info.unread > 0 && <Badge tone="amber" className="ms-1">{info.unread}</Badge>}
          </Button>
        </Link>
      )}
      {info.canConfigure && (
        <Button variant="ghost" onClick={() => setSettings(true)} title={t('pct.settings', 'Contact settings')} aria-label={t('pct.settings', 'Contact settings')}><Settings2 size={15} /></Button>
      )}
      {writing && <ContactModal kind="project" targetId={info.ref} targetLabel={info.name} topics={info.topics} onClose={() => setWriting(false)} />}
      {settings && <ProjectContactSettings projectRef={info.ref} onClose={() => { setSettings(false); load(); }} />}
    </>
  );
}

/** Topics, the on/off switch, and (for managers) who reads the inbox. */
export function ProjectContactSettings({ projectRef, onClose }) {
  const { t, lang } = useI18n(); const toast = useToast();
  const [s, setS] = useState(null);
  const [users, setUsers] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/projects-contact/${encodeURIComponent(projectRef)}/settings`).then((r) => {
      setS(r);
      setUsers((r.inboxUsers || []).map((u) => u.displayName || u.id).join('\n'));
    }).catch(() => { toast.error(t('common.failed', 'Failed.')); onClose(); });
  }, [projectRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Modal open onClose={onClose} title={t('pct.settings', 'Contact settings')} icon={Settings2}><div className="py-6 text-center"><Spinner /></div></Modal>;
  const toggleBasic = (id) => setS({ ...s, basicTopics: s.basicTopics.includes(id) ? s.basicTopics.filter((x) => x !== id) : [...s.basicTopics, id] });
  const setCustom = (i, patch) => setS({ ...s, customTopics: s.customTopics.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const save = async () => {
    setBusy(true);
    try {
      const body = { enabled: s.enabled, basicTopics: s.basicTopics, customTopics: s.customTopics.filter((c) => c.label.trim()) };
      if (s.canManageAccess) { body.editorsSeeInbox = s.editorsSeeInbox; body.inboxUsers = users.split('\n').map((x) => x.trim()).filter(Boolean); }
      await api.put(`/projects-contact/${encodeURIComponent(projectRef)}/settings`, body);
      toast.success(t('common.saved', 'Saved.'));
      onClose();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'no_topics' ? t('pct.err.notopics', 'Keep at least one topic, or close the inbox.')
        : e === 'user_not_found' ? t('pct.err.user', 'No account matches “{w}”.').replace('{w}', x.data?.who || '')
          : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('pct.settings.t', 'Contact: {n}').replace('{n}', s.name)} icon={Settings2} width="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save', 'Save')}</Button></div>}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          {t('pct.enabled', 'People can write to this project')}
        </label>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pct.topics', 'Topics')}</div>
          <div className="flex flex-wrap gap-2">
            {s.allBasicTopics.map((id) => (
              <label key={id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg border border-[var(--line)] cursor-pointer">
                <input type="checkbox" checked={s.basicTopics.includes(id)} onChange={() => toggleBasic(id)} /> {topicLabel({ id, basic: true }, t, lang)}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('pct.custom', 'Topics of your own')}</div>
          {s.customTopics.map((c, i) => (
            <div key={c.id || i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <Input value={c.label} maxLength={60} onChange={(e) => setCustom(i, { label: e.target.value })} placeholder={t('pct.custom.en', 'Label (English)')} aria-label={t('pct.custom.en', 'Label (English)')} />
              <Input value={c.labelFr || ''} maxLength={60} onChange={(e) => setCustom(i, { labelFr: e.target.value })} placeholder={t('pct.custom.fr', 'Label (French)')} aria-label={t('pct.custom.fr', 'Label (French)')} />
              {/* undo: removing a row is an unsaved edit; Cancel above discards it. */}
              <Button size="sm" variant="ghost" onClick={() => setS({ ...s, customTopics: s.customTopics.filter((_, j) => j !== i) })} aria-label={t('common.delete', 'Delete')}><Trash2 size={13} /></Button>
            </div>
          ))}
          {s.customTopics.length < s.maxCustomTopics && (
            <Button size="sm" variant="ghost" onClick={() => setS({ ...s, customTopics: [...s.customTopics, { label: '', labelFr: '' }] })}><Plus size={13} /> {t('pct.custom.add', 'Add a topic')}</Button>
          )}
        </div>
        {s.canManageAccess && (
          <div className="space-y-2 pt-3 border-t border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('pct.access', 'Who reads the inbox')}</div>
            <Explain summary={t('pct.access.lead', 'Its managers always do. Editors and listed accounts can too.')} className="text-[12px]">
              {t('pct.access.body', 'A role with the Inbox right on this project also opens it, which is the way to give it to several people at once. Listing an account here is for one person, without giving them any edit right.')}
            </Explain>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={s.editorsSeeInbox} onChange={(e) => setS({ ...s, editorsSeeInbox: e.target.checked })} />
              {t('pct.editors', 'People who may edit this project read its inbox')}
            </label>
            <Field label={t('pct.users', 'Also readable by (one account per line)')} hint={t('pct.users.h', 'E-mail, BC id or display name.')}>
              <textarea className="input" rows={3} value={users} onChange={(e) => setUsers(e.target.value)} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
