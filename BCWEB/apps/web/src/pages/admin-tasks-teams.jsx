// Staff teams: who is on one, and who runs it.
//
// A team here is a working unit inside the staff, not the customer-facing `Team` that owns
// repos and catalogues. Exactly one chief, named by an admin, and the chief is the only
// person besides an admin who can hand the team's work out.
import { useState } from 'react';
import { Users, Plus, Crown, UserPlus, UserMinus, PenSquare, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Field, Badge, Modal, EmptyState, Spinner, Explain, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';

/** Create or rename a team. Only an admin ever sees this, so it asks for the chief outright. */
function TeamEditor({ open, initial, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [d, setD] = useState(initial || { name: '', description: '', chiefId: '' });
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;

  const save = async () => {
    if (d.name.trim().length < 2) return toast.error(t('atask.team.needname', 'Give the team a name first.'));
    if (!editing && !d.chiefId.trim()) return toast.error(t('atask.team.needchief', 'A team needs a chief. Paste the account id of the person who will run it.'));
    setBusy(true);
    try {
      const payload = { name: d.name.trim(), description: d.description.trim(), chiefId: d.chiefId.trim() || undefined };
      if (editing) await api.patch(`/admin/tasks/teams/${initial.id}`, payload);
      else await api.post('/admin/tasks/teams', payload);
      onSaved();
      onClose();
    } catch {
      toast.error(t('atask.team.failed', 'The team could not be saved. Check the account id of the chief.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Users} title={editing ? t('atask.team.edit', 'Edit the team') : t('atask.team.new', 'New staff team')}
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{t('atask.save', 'Save')}</Button></div>}>
      <div className="space-y-3">
        <Field label={t('atask.team.f.name', 'Name')}>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={60} placeholder={t('atask.team.f.name.ph', 'Moderation, Catalogues, Hosting…')} />
        </Field>
        <Field label={t('atask.team.f.desc', 'What this team does')}>
          <Textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={500} />
        </Field>
        <Field label={t('atask.team.f.chief', 'Chief')} hint={t('atask.team.f.chief.h', 'The account id of the person who dispatches this team’s work. They are added as a member automatically.')}>
          <Input value={d.chiefId} onChange={(e) => setD({ ...d, chiefId: e.target.value })} maxLength={60} placeholder={t('atask.team.f.chief.ph', 'Account id')} />
        </Field>
      </div>
    </Modal>
  );
}

function TeamCard({ team, people, canRun, onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = (uid) => people[uid]?.displayName || t('atask.unknown', 'Unknown account');

  const run = async (fn, err) => {
    setBusy(true);
    try { await fn(); onChanged(); } catch { toast.error(err); } finally { setBusy(false); }
  };

  const addMember = () => {
    if (!adding.trim()) return;
    run(async () => { await api.post(`/admin/tasks/teams/${team.id}/members`, { userId: adding.trim() }); setAdding(''); },
      t('atask.team.addfail', 'That account could not be added. Check the id.'));
  };

  const removeMember = async (uid) => {
    const ok = await dialog.confirm({
      title: t('atask.team.rm.t', 'Remove from the team'),
      message: t('atask.team.rm.m', 'Their unfinished tasks go back to this team’s pool and the chief is told. Tasks they already finished keep their name on them.'),
    });
    if (!ok) return;
    run(() => api.del(`/admin/tasks/teams/${team.id}/members/${uid}`), t('atask.team.rmfail', 'That did not go through. The chief cannot be removed, name a new one first.'));
  };

  const dissolve = async () => {
    const ok = await dialog.confirm({
      title: t('atask.team.del.t', 'Dissolve the team'),
      message: t('atask.team.del.m', 'The team goes away. Its tasks are kept: the unfinished ones land unassigned in the unfiled pool, where an admin re-files them.'),
      danger: true,
    });
    if (!ok) return;
    run(() => api.del(`/admin/tasks/teams/${team.id}`), t('atask.team.delfail', 'The team could not be dissolved.'));
  };

  const [editing, setEditing] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate" title={team.name}>{team.name}</div>
          {team.description && <p className="text-xs text-[var(--muted)] mt-0.5 break-words">{team.description}</p>}
        </div>
        {team.archivedAt && <Badge tone="amber">{t('atask.team.archived', 'Archived')}</Badge>}
        <Badge>{t('atask.team.count', '{n} tasks').replace('{n}', String(team.taskCount ?? 0))}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="primary" title={t('atask.team.chief', 'Chief')}><Crown size={11} className="me-1" />{nameOf(team.chiefId)}</Badge>
        {(team.members || []).filter((m) => !m.chief).map((m) => (
          <Badge key={m.userId} className="group">
            {nameOf(m.userId)}
            {team.canManage && (
              <button type="button" disabled={busy} onClick={() => removeMember(m.userId)} className="ms-1.5 align-middle text-[var(--faint)] hover:text-[var(--text)]"
                title={t('atask.team.rm', 'Remove from the team')} aria-label={t('atask.team.rm', 'Remove from the team')}>
                <UserMinus size={11} />
              </button>
            )}
          </Badge>
        ))}
        {(team.members || []).length <= 1 && <span className="text-xs text-[var(--faint)]">{t('atask.team.solo', 'Only the chief so far.')}</span>}
      </div>

      {team.canManage && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} maxLength={60} className="flex-1"
            placeholder={t('atask.team.add.ph', 'Account id to add')} aria-label={t('atask.team.add.aria', 'Account id of the person to add')} />
          <Button size="sm" onClick={addMember} disabled={!adding.trim() || busy}><UserPlus size={14} />{t('atask.team.add', 'Add')}</Button>
        </div>
      )}

      {canRun && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}><PenSquare size={14} />{t('atask.team.edit2', 'Edit')}</Button>
          <Button size="sm" disabled={busy} onClick={() => run(() => api.patch(`/admin/tasks/teams/${team.id}`, { archived: !team.archivedAt }), t('atask.team.failed', 'The team could not be saved. Check the account id of the chief.'))}>
            {team.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {team.archivedAt ? t('atask.team.unarchive', 'Reactivate') : t('atask.team.archive', 'Archive')}
          </Button>
          <Button variant="danger" size="sm" onClick={dissolve} disabled={busy}><Trash2 size={14} />{t('atask.team.dissolve', 'Dissolve')}</Button>
        </div>
      )}

      {editing && <TeamEditor open initial={{ id: team.id, name: team.name, description: team.description, chiefId: team.chiefId }} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </Card>
  );
}

export function AdminTaskTeams({ onChanged }) {
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/tasks/teams'), []);
  const [creating, setCreating] = useState(false);
  const refresh = () => { reload(true); onChanged?.(); };

  if (loading) return <div className="py-8 grid place-items-center"><Spinner /></div>;
  const teams = data?.teams || [];
  const canRun = !!data?.canRunTeams;

  return (
    <div className="space-y-4">
      <Explain summary={t('atask.team.x.s', 'A team has members and exactly one chief.')}>
        <p>{t('atask.team.x.1', 'The chief hands the team’s work out: they can assign any task of the team to any of its members, take it back, change its priority and close it. They can add and remove members. They cannot create a team, dissolve one, or name a chief.')}</p>
        <p>{t('atask.team.x.2', 'An admin does all of that, across every team, and is the only one who can move a task from one team to another.')}</p>
        <p>{t('atask.team.x.3', 'When somebody leaves a team, their unfinished tasks go back to the team pool unassigned and the chief is told. Tasks they had already finished keep their name: the history says who did the work and is never rewritten.')}</p>
      </Explain>

      {canRun && <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} />{t('atask.team.new', 'New staff team')}</Button>}

      {teams.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {teams.map((team) => <TeamCard key={team.id} team={team} people={data?.people || {}} canRun={canRun} onChanged={refresh} />)}
        </div>
      ) : (
        <EmptyState icon={Users} title={t('atask.team.none.t', 'No staff teams yet')}
          sub={t('atask.team.none.s', 'A team groups the people who work the same kind of thing, and gives them one chief who hands the work out.')}
          hint={canRun ? null : t('atask.team.none.h', 'An admin creates these.')}
          action={canRun ? { label: t('atask.team.new', 'New staff team'), icon: Plus, onClick: () => setCreating(true) } : null} />
      )}

      {creating && <TeamEditor open onClose={() => setCreating(false)} onSaved={refresh} />}
    </div>
  );
}

export default AdminTaskTeams;
