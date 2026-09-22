// A team's contact inbox, inside the team: the conversations addressed to the team or to
// one of its repos and catalogues, answered by the roles the team chose.
//
// The conversation itself is the ordinary thread view (threads.jsx), so the reply box,
// receipts and files are the ones every conversation has. What this adds is the team's
// side of it: the list with its states, putting several away at once, deleting (owner and
// admins, behind an undo window), and the settings: who answers, how many stay open, and
// where files are stored.
import { useState } from 'react';
import { Inbox, Archive, RotateCcw, Trash2, Settings2, Paperclip, Mail } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Field, Select, Explain, EmptyState, Spinner, Modal, useToast } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';
import { ThreadView } from './threads.jsx';

const STATES = ['open', 'archived', 'closed', 'all'];
const when = (d) => new Date(d).toLocaleString();

function roleLabel(t, r) {
  return { owner: t('tm.role.owner', 'Owner'), admin: t('tm.role.admin', 'Admin'), member: t('tm.role.member', 'Member') }[r] || r;
}

function InboxSettings({ team, onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const { data } = useAsync(() => api.get(`/me/teams/${team.id}/contact`), [team.id]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const cur = f || (data && { answerRoles: data.answerRoles, maxOpenMembers: data.maxOpenMembers, maxOpenAnon: data.maxOpenAnon, mode: data.storage.mode === 'pool' ? 'pool' : 'inherit', poolId: data.storage.poolId || '', quotaMB: data.storage.quotaMB || 0, attachments: ['off', 'pool_only'].includes(data.storage.attachments) ? data.storage.attachments : 'inherit' });
  if (!data || !cur) return <Modal open onClose={onClose} title={t('ti.settings', 'Inbox settings')} icon={Settings2}><div className="py-6 text-center"><Spinner /></div></Modal>;
  const set = (patch) => setF({ ...cur, ...patch });
  // An admin may have given this inbox something a team cannot choose itself (its own caps,
  // no limit, files always on): the team screen then leaves storage alone rather than
  // overwriting a decision it cannot see the reason for.
  const adminSet = !['inherit', 'pool'].includes(data.storage.mode);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/me/teams/${team.id}/contact`, {
        answerRoles: cur.answerRoles, maxOpenMembers: Number(cur.maxOpenMembers) || 0, maxOpenAnon: Number(cur.maxOpenAnon) || 0,
        ...(adminSet ? {} : { storage: { mode: cur.mode, poolId: cur.mode === 'pool' ? cur.poolId || null : null, quotaMB: Number(cur.quotaMB) || 0 }, attachments: cur.attachments }),
      });
      toast.success(t('common.saved', 'Saved.')); onClose();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'pool_exceeded' ? t('aeh.err.pool', 'The pool has only {n} MB free.').replace('{n}', Math.floor(x.data?.freeMB || 0))
        : e === 'pool_required' ? t('aeh.err.poolreq', 'Pick the pool the storage comes from.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('ti.settings', 'Inbox settings')} icon={Settings2} width="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save', 'Save')}</Button></div>}>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('ti.answer', 'Who reads and answers')}</div>
          <div className="flex flex-wrap gap-2">
            {data.roles.map((r) => (
              <label key={r} className={`inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg border border-[var(--line)] ${r === 'owner' ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="checkbox" disabled={r === 'owner'} checked={r === 'owner' || cur.answerRoles.includes(r)}
                  onChange={(e) => set({ answerRoles: e.target.checked ? [...new Set([...cur.answerRoles, r])] : cur.answerRoles.filter((x) => x !== r) })} />
                {roleLabel(t, r)}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('ti.capm', 'Open conversations from members')} hint={t('ami.mp.zero', '0 = no limit')}><Input type="number" min={0} value={cur.maxOpenMembers} onChange={(e) => set({ maxOpenMembers: e.target.value })} /></Field>
          <Field label={t('ti.capa', 'Open conversations from anonymous senders')} hint={t('ami.mp.zero', '0 = no limit')}><Input type="number" min={0} value={cur.maxOpenAnon} onChange={(e) => set({ maxOpenAnon: e.target.value })} /></Field>
        </div>
        <div className="space-y-2 pt-3 border-t border-[var(--line)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('ti.storage', 'Files and storage')}</div>
          {adminSet ? (
            <p className="text-[12px] text-[var(--muted)]">{t('ti.adminset', 'The site team set this inbox’s storage. Ask them to change it.')}</p>
          ) : (<>
            <Explain summary={t('ti.storage.lead', 'Files can be refused, or accepted on space from one of the team’s pools.')} className="text-[12px]">
              {t('ti.storage.body', 'The space is reserved from the pool like a repo’s quota, so the pool shows it as used. Leaving pool mode gives it back.')}
            </Explain>
            <Field label={t('aeh.attach', 'Files in messages')}>
              <Select value={cur.attachments} onChange={(e) => set({ attachments: e.target.value })}>
                <option value="inherit">{t('aeh.a.inherit', 'Site setting')}</option>
                <option value="pool_only">{t('aeh.a.pool', 'Only with a pool')}</option>
                <option value="off">{t('aeh.a.off', 'Never')}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label={t('aeh.pool', 'Pool')}>
                <Select value={cur.mode === 'pool' ? cur.poolId : ''} onChange={(e) => set(e.target.value ? { mode: 'pool', poolId: e.target.value } : { mode: 'inherit', poolId: '' })}>
                  <option value="">{t('ti.nopool', 'No pool (site setting)')}</option>
                  {data.pools.map((g) => <option key={g.id} value={g.id}>{g.name} · {Math.floor(g.freeMB)} MB {t('aeh.free', 'free')}</option>)}
                </Select>
              </Field>
              {cur.mode === 'pool' && <Field label={t('aeh.quota', 'Reserved (MB)')}><Input type="number" min={0} className="!w-28" value={cur.quotaMB} onChange={(e) => set({ quotaMB: e.target.value })} /></Field>}
            </div>
          </>)}
        </div>
      </div>
    </Modal>
  );
}

export function TeamInbox({ team }) {
  const { t } = useI18n(); const toast = useToast();
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [pending, setPending] = useState(() => new Set());
  const [settings, setSettings] = useState(false);
  const canAdmin = ['owner', 'admin'].includes(team.myRole);
  const { data, loading, err, reload } = useAsync(() => api.get(`/me/teams/${team.id}/threads?status=${status}`), [team.id, status]);
  if (err?.status === 403) return null; // not one of the roles that answer: no inbox to show
  const rows = (data?.threads || []).filter((r) => !pending.has(r.id));
  const counts = data?.counts || {};
  const move = async (ids, to) => {
    try { await api.post(`/me/teams/${team.id}/threads/archive`, { ids, status: to }); setSel(new Set()); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const del = (th) => {
    const unhide = () => setPending((s) => { const n = new Set(s); n.delete(th.id); return n; });
    setPending((s) => new Set(s).add(th.id)); setOpen(null);
    toast.action({
      tone: 'info', cancelLabel: t('common.undo', 'Undo'),
      msg: t('ti.deleted', 'Conversation deleted, with its files.'),
      onCommit: async () => { try { await api.del(`/me/teams/${team.id}/threads/${th.id}`); } catch (x) { if (x?.status !== 404) toast.error(t('common.failed', 'Failed.')); } unhide(); reload(); },
      onCancel: () => { unhide(); },
    });
  };
  if (open) {
    return (
      <ThreadView back={() => { setOpen(null); reload(); }}
        load={() => api.get(`/me/threads/${open.id}`)}
        post={(body, files) => api.post(`/me/threads/${open.id}/messages`, { body, files })}
        fileBase={`/me/threads/${open.id}`}
        actions={(th, r) => (<>
          {th.status === 'open'
            ? <Button size="sm" variant="ghost" onClick={async () => { await move([th.id], 'archived'); r(); }}><Archive size={13} /> {t('th.archive', 'Archive')}</Button>
            : th.status === 'archived' && <Button size="sm" variant="ghost" onClick={async () => { await move([th.id], 'open'); r(); }}><RotateCcw size={13} /> {t('th.reopen', 'Reopen')}</Button>}
          {canAdmin && <Button size="sm" variant="ghost" className="!text-error ms-auto" onClick={() => del(open)}><Trash2 size={13} /> {t('common.delete', 'Delete')}</Button>}
        </>)} />
    );
  }
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Inbox size={15} className="text-[var(--accent-ink)]" />
        <div className="font-semibold">{t('ti.title', 'Team inbox')}</div>
        {counts.open > 0 && <Badge tone="amber">{counts.open}</Badge>}
        {canAdmin && <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setSettings(true)} aria-label={t('ti.settings', 'Inbox settings')} title={t('ti.settings', 'Inbox settings')}><Settings2 size={14} /></Button>}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {STATES.map((s) => (
          <button key={s} type="button" onClick={() => { setStatus(s); setSel(new Set()); }} aria-current={status === s ? 'true' : undefined}
            className={`text-xs px-3 py-1.5 rounded-lg border ${status === s ? 'border-[var(--ring)] tint-primary' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {{ open: t('th.st.open', 'open'), archived: t('th.st.archived', 'archived'), closed: t('th.st.closed', 'closed'), all: t('adm.th.f.all', 'All') }[s]}
            {s !== 'all' && counts[s] > 0 && <span className="ms-1 opacity-70">{counts[s]}</span>}
          </button>
        ))}
        {sel.size > 0 && (
          <span className="ms-auto flex gap-1.5">
            {status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => move([...sel], 'archived')}><Archive size={13} /> {t('ti.archivesel', 'Archive {n}').replace('{n}', sel.size)}</Button>}
            {status === 'archived' && <Button size="sm" variant="ghost" onClick={() => move([...sel], 'open')}><RotateCcw size={13} /> {t('ti.reopensel', 'Reopen {n}').replace('{n}', sel.size)}</Button>}
          </span>
        )}
      </div>
      {loading && !data ? <div className="py-6 text-center"><Spinner /></div> : !rows.length ? (
        <EmptyState icon={Inbox} title={t('ti.empty', 'Nothing here')}
          sub={status === 'open' ? t('ti.empty.open', 'People write to the team from its page and from its repos and catalogues.') : t('ti.empty.s', 'No conversation has this state.')} />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          <li className="py-1.5 flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label={t('ti.selall', 'Select all')} />
            {t('ti.selall', 'Select all')}
          </li>
          {rows.map((th) => (
            <li key={th.id} className="py-2 flex items-center gap-2.5">
              <input type="checkbox" checked={sel.has(th.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(th.id); else n.delete(th.id); return n; })} aria-label={th.subject} />
              <button type="button" onClick={() => setOpen(th)} className="flex-1 min-w-0 text-start flex items-center gap-2.5 hover:panel rounded-lg px-1.5 -mx-1.5 py-0.5">
                {th.sender ? <Avatar user={th.sender} size={26} className="shrink-0" /> : <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-[var(--surface-2)] shrink-0"><Mail size={12} aria-hidden /></span>}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${th.ownerUnread ? 'font-semibold' : ''}`} title={th.subject}>{th.subject}</span>
                  <span className="block truncate text-[12px] text-[var(--muted)]">{th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')} · {th.targetLabel}</span>
                </span>
                {th.files > 0 && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-0.5 shrink-0"><Paperclip size={11} aria-hidden />{th.files}</span>}
                <span className="text-[11px] text-[var(--faint)] tabular-nums shrink-0 hidden sm:inline">{when(th.lastActivityAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {settings && <InboxSettings team={team} onClose={() => { setSettings(false); reload(); }} />}
    </Card>
  );
}

export default TeamInbox;
