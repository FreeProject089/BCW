// What the site proposes: tasks drafted from the status page, the "Needs attention" queues,
// the server alerts and the error groups (apps/api/src/lib/task-suggest.mjs).
//
// A proposal is a DRAFT. Accept turns it into a task (with a team and people if you want);
// dismiss hides it for a week, or until the condition clears and comes back. Nothing here is
// the source itself: the text was scrubbed on the server before it was stored (no URL, no
// path, no token), and the "Open the source" link goes to the admin screen that holds the
// real thing, behind its own permission. That is why a proposal can safely become a task the
// whole team reads.
//
// The list only ever contains proposals from sources this account can already read; `hidden`
// says how many others exist, so an empty list is never mistaken for "all clear".
import { useState } from 'react';
import { Lightbulb, Check, X, RefreshCw, ExternalLink, Activity, Inbox, ServerCrash, Bug, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Field, Badge, Modal, Dropdown, EmptyState, Spinner, Explain, useToast } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';
import { PRIORITY_META, priorityLabel, shortDateTime } from './admin-tasks-vocab.jsx';

const SOURCE_ICON = { status: Activity, pending: Inbox, alert: ServerCrash, error: Bug };

const sourceLabel = (t, s) => ({
  status: t('atask.sg.src.status', 'Status page'),
  pending: t('atask.sg.src.pending', 'Needs attention'),
  alert: t('atask.sg.src.alert', 'Server alert'),
  error: t('atask.sg.src.error', 'Error group'),
}[s] || s);

/** Accept: which team, who, how urgent. Everything optional; the defaults are the proposal's. */
function AcceptModal({ sg, meta, onClose, onDone }) {
  const { t } = useI18n();
  const toast = useToast();
  const [teamId, setTeamId] = useState('');
  const [who, setWho] = useState([]);
  const [priority, setPriority] = useState(sg.priority);
  const [busy, setBusy] = useState(false);
  const teams = meta?.teams || [];
  const people = meta?.people || {};
  const pool = teamId ? (teams.find((x) => x.id === teamId)?.memberIds || []) : [];

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/tasks/suggestions/${sg.id}/accept`, { teamId: teamId || null, assigneeIds: who, priority });
      toast.success(t('atask.sg.accepted', 'Proposal accepted: it is a task now.'));
      onDone();
      onClose();
    } catch (x) {
      toast.error(x?.data?.error === 'already_decided'
        ? t('atask.sg.e.decided', 'Somebody else already decided on this one.')
        : t('atask.err', 'That did not go through. Refresh and try again.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon={Check} title={t('atask.sg.accept.t', 'Turn it into a task')} width="max-w-lg"
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{t('atask.sg.accept', 'Accept')}</Button></div>}>
      <div className="space-y-3">
        <div className="panel-quiet rounded-xl border border-[var(--line)] p-3 text-sm break-words">{sg.title}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('atask.f.team', 'Team')}>
            <Dropdown value={teamId} onChange={(v) => { setTeamId(v); setWho([]); }}
              options={[{ value: '', label: t('atask.f.team.none', 'No team') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]} />
          </Field>
          <Field label={t('atask.f.prio', 'Priority')}>
            <Dropdown value={priority} onChange={setPriority}
              options={Object.keys(PRIORITY_META).map((p) => ({ value: p, label: priorityLabel(t, p) }))} />
          </Field>
        </div>
        {teamId && (
          <Field label={t('atask.f.assign.many', 'People on it')} hint={t('atask.f.assign.many.h', 'Pick one or several members of the team, or leave it in the pool.')}>
            <div className="flex flex-wrap gap-1.5">
              {pool.map((uid) => {
                const on = who.includes(uid);
                return (
                  <button key={uid} type="button" aria-pressed={on}
                    onClick={() => setWho(on ? who.filter((x) => x !== uid) : [...who, uid])}
                    className={`badge ${on ? 'badge-primary' : ''}`}>
                    {on && <Check size={11} className="me-1" />}{people[uid]?.displayName || t('atask.unknown', 'Unknown account')}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function AdminTaskProposals({ meta, onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const [show, setShow] = useState('open');
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState(null);
  const [gone, setGone] = useState(() => new Set());
  const { data, err, loading, reload } = useAsync(() => api.get(`/admin/tasks/suggestions${show === 'dismissed' ? '?state=dismissed' : ''}`), [show]);

  const refresh = async () => {
    setRefreshing(true);
    try { await api.get('/admin/tasks/suggestions?refresh=1'); await reload(true); }
    catch { toast.error(t('atask.err', 'That did not go through. Refresh and try again.')); }
    finally { setRefreshing(false); }
  };

  const hide = (id, on) => setGone((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  // Dismiss with an undo window: the row leaves at once, the request goes when the toast runs
  // out, Undo means the server never heard about it.
  const dismiss = (sg) => {
    hide(sg.id, true);
    toast.action({
      tone: 'info', cancelLabel: t('common.undo', 'Undo'),
      msg: t('atask.sg.dismissed', 'Proposal dismissed. It comes back in a week if the problem is still there.'),
      onCommit: async () => {
        try { await api.post(`/admin/tasks/suggestions/${sg.id}/dismiss`, {}); } catch { toast.error(t('atask.err', 'That did not go through. Refresh and try again.')); }
        hide(sg.id, false); reload(true);
      },
      onCancel: () => hide(sg.id, false),
    });
  };
  const restore = async (sg) => {
    try { await api.post(`/admin/tasks/suggestions/${sg.id}/restore`, {}); reload(true); }
    catch { toast.error(t('atask.err', 'That did not go through. Refresh and try again.')); }
  };

  if (err) {
    return (
      <EmptyState icon={ShieldAlert} title={t('atask.sg.403.t', 'Proposals are for dispatchers')}
        sub={t('atask.sg.403.s', 'Reviewing what the site proposes takes the "Dispatch tasks" permission.')} />
    );
  }
  const rows = (data?.suggestions || []).filter((s) => !gone.has(s.id));

  return (
    <div className="space-y-4">
      <Explain summary={t('atask.sg.x.s', 'Tasks the site proposes from its own state. Nothing becomes a task until somebody accepts it.')}>
        <p>{t('atask.sg.x.1', 'Four places are read: a service down on the status page, a "Needs attention" queue with work waiting, an open server alert, and an error group of the last 24 hours. One incident is one proposal, however many times it is seen; its count goes up instead.')}</p>
        <p>{t('atask.sg.x.2', 'The text is cleaned before it is stored: every link, path, key and address is replaced, and a queue never lists its items. That is what makes it safe to accept into a task the whole team reads. The source itself stays one click away, behind its own permission.')}</p>
        <p>{t('atask.sg.x.3', 'You only see proposals from sources you can already read. Dismissing one hides it for a week; if the problem is still there after that, it comes back once.')}</p>
      </Explain>

      <div className="flex flex-wrap items-center gap-2">
        <Dropdown size="sm" value={show} onChange={setShow} options={[
          { value: 'open', label: t('atask.sg.show.open', 'Waiting for a decision') },
          { value: 'dismissed', label: t('atask.sg.show.dismissed', 'Dismissed') },
        ]} />
        <Button size="sm" className="ms-auto" onClick={refresh} loading={refreshing}><RefreshCw size={14} />{t('atask.sg.refresh', 'Look again now')}</Button>
      </div>

      {loading ? <div className="py-8 grid place-items-center"><Spinner /></div> : rows.length ? (
        <div className="space-y-2">
          {rows.map((sg) => {
            const Icon = SOURCE_ICON[sg.source] || Lightbulb;
            return (
              <Card key={sg.id} className="p-3">
                <div className="flex items-start gap-3">
                  <Icon size={17} className="shrink-0 mt-0.5 text-[var(--muted)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">{sg.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{sourceLabel(t, sg.source)}</Badge>
                      <Badge tone={PRIORITY_META[sg.priority]?.tone}>{priorityLabel(t, sg.priority)}</Badge>
                      {sg.count > 1 && <Badge title={t('atask.sg.count.t', 'How many times, or how many items, stand behind it')}>×{sg.count}</Badge>}
                      <span className="text-[11px] text-[var(--faint)]">{t('atask.sg.seen', 'last seen {d}').replace('{d}', shortDateTime(sg.lastSeenAt))}</span>
                      {sg.href && (
                        <a href={sg.href} className="text-[11px] text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1">
                          <ExternalLink size={11} aria-hidden="true" />{t('atask.sg.source', 'Open the source')}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col sm:flex-row gap-1.5">
                    {show === 'open' ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setAccepting(sg)}><Check size={14} />{t('atask.sg.accept', 'Accept')}</Button>
                        <Button size="sm" onClick={() => dismiss(sg)}><X size={14} />{t('atask.sg.dismiss', 'Dismiss')}</Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => restore(sg)}><RefreshCw size={14} />{t('atask.sg.restore', 'Put back')}</Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Lightbulb}
          title={show === 'open' ? t('atask.sg.none.t', 'Nothing to propose') : t('atask.sg.none.d', 'Nothing dismissed')}
          sub={show === 'open' ? t('atask.sg.none.s', 'No service is down, no queue is waiting, no alert or error group is open, among the sources you can read.') : null}
          hint={data?.hidden ? t('atask.sg.hidden', '{n} more come from sources your account cannot read.').replace('{n}', String(data.hidden)) : null} />
      )}
      {rows.length > 0 && data?.hidden > 0 && (
        <p className="text-[11px] text-[var(--faint)]">{t('atask.sg.hidden', '{n} more come from sources your account cannot read.').replace('{n}', String(data.hidden))}</p>
      )}

      {accepting && <AcceptModal sg={accepting} meta={meta} onClose={() => setAccepting(null)} onDone={() => { reload(true); onChanged?.(); }} />}
    </div>
  );
}

export default AdminTaskProposals;
