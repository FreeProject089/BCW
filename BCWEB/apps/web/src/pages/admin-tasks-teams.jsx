// Staff teams: who is on one, and who runs it.
//
// A team here is a working unit inside the staff, not the customer-facing `Team` that owns
// repos and catalogues. Exactly one chief, named by an admin, and the chief is the only
// person besides an admin who can hand the team's work out.
//
// "New staff team" used to be unusable, and for a reason worth writing down: the form asked
// you to PASTE an account id. There is no screen that hands you one — you had to open the
// accounts list, find the person, copy their id, come back and paste it — so in practice the
// field stayed empty, the server answered 400 `unknown_chief`, and the only thing the screen
// said was "check the account id of the chief", because one bare `catch` covered
// `unknown_chief`, `invalid_input` AND `forbidden` with the same sentence. An admin without
// the right to run teams got told their id was wrong.
//
// Both halves are fixed here: every place that wanted an id is a search (AccountPicker, over
// the member search the site already had), and the server's real answer is shown against the
// field it is about.
import { useState } from 'react';
import { Users, Plus, Crown, UserPlus, UserMinus, PenSquare, Trash2, Archive, ArchiveRestore, AlertTriangle, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Field, Badge, Modal, EmptyState, Spinner, Explain, useToast, useDialog } from '../ui/ui.jsx';
import { AccountPicker, AccountSearch } from './admin-people-picker.jsx';
import { useAsync } from './pages.jsx';

/**
 * What the server actually said, as a sentence.
 *
 * `field` is which box to put it against: the same code means different things to the person
 * reading it depending on where it lands, and a 403 belongs to neither box — it is about the
 * account, not the form.
 */
function teamError(e, t) {
  const code = e?.data?.error;
  if (e?.status === 403 || code === 'forbidden') {
    return { field: 'form', message: t('atask.team.e.forbidden', 'Your account is not allowed to change teams. Creating, dissolving and naming a chief are admin-only; ask an admin.') };
  }
  if (code === 'unknown_chief') return { field: 'chief', message: t('atask.team.e.chief', 'No account with that id any more. Search for the person and pick them from the list.') };
  if (code === 'unknown_user') return { field: 'member', message: t('atask.team.e.user', 'No account with that id any more. Search for the person and pick them from the list.') };
  if (code === 'invalid_input') return { field: 'name', message: t('atask.team.e.input', 'The server refused the form. A name of 2 to 60 characters and a chief are both required.') };
  if (code === 'not_found') return { field: 'form', message: t('atask.team.e.gone', 'That team no longer exists. Reload the list.') };
  if (e?.status === 401) return { field: 'form', message: t('atask.team.e.auth', 'Your session expired. Sign in again.') };
  return { field: 'form', message: t('atask.team.e.other', 'The server refused that and gave no reason. Try again, and check the API is reachable.') };
}

/** One red line under a field, or nothing. */
function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1 text-[11px] text-error flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{children}</p>;
}

/** Create or rename a team. Only an admin ever sees this, so it names the chief outright. */
function TeamEditor({ open, initial, people, onClose, onSaved }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  // The chief as an ACCOUNT, not an id: for an existing team the id comes back from the list
  // and the name comes from the `people` map the same list carries, so the picker opens
  // showing who it is rather than a string to recognise.
  const [chief, setChief] = useState(initial?.chiefId
    ? { id: initial.chiefId, displayName: people?.[initial.chiefId]?.displayName || initial.chiefId }
    : null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;

  const save = async () => {
    const e = {};
    if (name.trim().length < 2) e.name = t('atask.team.needname', 'Give the team a name first (2 characters or more).');
    if (!chief) e.chief = t('atask.team.needchief', 'A team needs a chief. Search for the person who will run it.');
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), chiefId: chief.id };
      if (editing) await api.patch(`/admin/tasks/teams/${initial.id}`, payload);
      else await api.post('/admin/tasks/teams', payload);
      onSaved();
      onClose();
    } catch (x) {
      const { field, message } = teamError(x, t);
      setErr({ [field === 'member' ? 'chief' : field]: message });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Users} title={editing ? t('atask.team.edit', 'Edit the team') : t('atask.team.new', 'New staff team')}
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{t('atask.save', 'Save')}</Button></div>}>
      <div className="space-y-3">
        {err.form && (
          <div className="rounded-xl border b-error tint-error-soft p-3 text-[12px] text-error flex items-start gap-2">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" /> <span>{err.form}</span>
          </div>
        )}
        <Field label={t('atask.team.f.name', 'Name')}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setErr((s) => ({ ...s, name: null })); }} maxLength={60} placeholder={t('atask.team.f.name.ph', 'Moderation, Catalogues, Hosting…')} />
          <FieldError>{err.name}</FieldError>
        </Field>
        <Field label={t('atask.team.f.desc', 'What this team does')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t('atask.team.f.chief', 'Chief')} hint={t('atask.team.f.chief.h2', 'The person who dispatches this team’s work. They are added as a member automatically. Search by name, e-mail or id.')}>
          <AccountPicker value={chief} invalid={!!err.chief}
            onChange={(u) => { setChief(u); setErr((s) => ({ ...s, chief: null })); }}
            placeholder={t('atask.team.f.chief.ph2', 'Search for the chief…')} />
          <FieldError>{err.chief}</FieldError>
        </Field>
      </div>
    </Modal>
  );
}

/** Hand the team to somebody else. Admin-only on the server, so admin-only here. */
function ChiefModal({ team, people, onClose, onSaved }) {
  const { t } = useI18n();
  const [who, setWho] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!who) return setErr(t('atask.team.needchief', 'A team needs a chief. Search for the person who will run it.'));
    setBusy(true);
    try { await api.patch(`/admin/tasks/teams/${team.id}`, { chiefId: who.id }); onSaved(); onClose(); }
    catch (x) { setErr(teamError(x, t).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} icon={Crown} title={t('atask.team.chief.t', 'Change the chief')}
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{t('atask.save', 'Save')}</Button></div>}>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('atask.team.chief.m', 'The new chief is added to the team if they are not on it yet, and is told. The previous chief stays a member, remove them separately if that is what you want.')}
      </p>
      <Field label={t('atask.team.chief.now', 'Chief today')}>
        <div className="text-sm">{people?.[team.chiefId]?.displayName || team.chiefId}</div>
      </Field>
      <Field label={t('atask.team.chief.next', 'New chief')}>
        <AccountPicker value={who} onChange={(u) => { setWho(u); setErr(null); }} invalid={!!err}
          placeholder={t('atask.team.f.chief.ph2', 'Search for the chief…')} autoFocus />
        <FieldError>{err}</FieldError>
      </Field>
    </Modal>
  );
}

function TeamCard({ team, people, canRun, onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chiefing, setChiefing] = useState(false);
  const [err, setErr] = useState(null);
  const nameOf = (uid) => people[uid]?.displayName || t('atask.unknown', 'Unknown account');

  // Every mutation on this card goes through here, so the server's reason is shown once, in
  // one place, instead of each button inventing a sentence for a code it never read.
  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); }
    catch (x) { const m = teamError(x, t).message; setErr(m); toast.error(m); }
    finally { setBusy(false); }
  };

  const memberIds = (team.members || []).map((m) => m.userId);

  const addMember = (u) => run(async () => { await api.post(`/admin/tasks/teams/${team.id}/members`, { userId: u.id }); setAdding(false); });

  const removeMember = async (uid) => {
    const ok = await dialog.confirm({
      title: t('atask.team.rm.t', 'Remove from the team'),
      message: t('atask.team.rm.m', 'Their unfinished tasks go back to this team’s pool and the chief is told. Tasks they already finished keep their name on them.'),
    });
    if (!ok) return;
    // undo: nothing is destroyed. The membership row goes, the tasks are released back to the
    // team pool and the person can be added again in two clicks with the search above — so an
    // undo window here would only delay a reversible action.
    run(() => api.del(`/admin/tasks/teams/${team.id}/members/${uid}`));
  };

  const dissolve = async () => {
    const ok = await dialog.confirm({
      title: t('atask.team.del.t', 'Dissolve the team'),
      message: t('atask.team.del.m', 'The team goes away. Its tasks are kept: the unfinished ones land unassigned in the unfiled pool, where an admin re-files them.'),
      danger: true,
    });
    if (!ok) return;
    run(() => api.del(`/admin/tasks/teams/${team.id}`));
  };

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

      <div className="mt-3 flex flex-wrap gap-1.5 items-center">
        <Badge tone="primary" title={t('atask.team.chief', 'Chief')}><Crown size={11} className="me-1" />{nameOf(team.chiefId)}</Badge>
        {canRun && (
          <button type="button" disabled={busy} onClick={() => setChiefing(true)} className="text-[11px] text-[var(--accent-ink)] hover:underline">
            {t('atask.team.chief.btn', 'Change')}
          </button>
        )}
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
        <div className="mt-3">
          {adding ? (
            <div className="rounded-xl border border-[var(--line)] p-2.5" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('atask.team.add.t', 'Add somebody')}</span>
                <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setAdding(false)}>{t('atask.cancel', 'Cancel')}</Button>
              </div>
              <AccountSearch onPick={addMember} exclude={memberIds} autoFocus
                placeholder={t('atask.team.add.ph2', 'Search a name, an e-mail or an id…')} />
            </div>
          ) : (
            <Button size="sm" onClick={() => setAdding(true)} disabled={busy}><UserPlus size={14} />{t('atask.team.add', 'Add')}</Button>
          )}
        </div>
      )}

      <FieldError>{err}</FieldError>

      {canRun && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}><PenSquare size={14} />{t('atask.team.edit2', 'Edit')}</Button>
          <Button size="sm" disabled={busy} onClick={() => run(() => api.patch(`/admin/tasks/teams/${team.id}`, { archived: !team.archivedAt }))}>
            {team.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {team.archivedAt ? t('atask.team.unarchive', 'Reactivate') : t('atask.team.archive', 'Archive')}
          </Button>
          <Button variant="danger" size="sm" onClick={dissolve} disabled={busy}><Trash2 size={14} />{t('atask.team.dissolve', 'Dissolve')}</Button>
        </div>
      )}

      {editing && <TeamEditor open people={people} initial={{ id: team.id, name: team.name, description: team.description, chiefId: team.chiefId }} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {chiefing && <ChiefModal team={team} people={people} onClose={() => setChiefing(false)} onSaved={onChanged} />}
    </Card>
  );
}

export function AdminTaskTeams({ onChanged }) {
  const { t } = useI18n();
  const { data, err, loading, reload } = useAsync(() => api.get('/admin/tasks/teams'), []);
  const [creating, setCreating] = useState(false);
  const refresh = () => { reload(true); onChanged?.(); };

  if (loading) return <div className="py-8 grid place-items-center"><Spinner /></div>;
  // The list itself can be refused. Saying so beats an empty board that reads as "no teams".
  if (err) {
    return (
      <EmptyState icon={ShieldAlert} title={err.status === 403 ? t('atask.team.403.t', 'Not allowed to see the teams') : t('atask.team.err.t', 'The teams did not load')}
        sub={err.status === 403
          ? t('atask.team.403.s', 'This board is staff-only. Ask an admin for access.')
          : t('atask.team.err.s', 'Nothing has been changed. Try again, and check the API is reachable.')} />
    );
  }
  const teams = data?.teams || [];
  const canRun = !!data?.canRunTeams;

  return (
    <div className="space-y-4">
      <Explain summary={t('atask.team.x.s', 'A team has members and exactly one chief.')}>
        <p>{t('atask.team.x.1', 'The chief hands the team’s work out: they can assign any task of the team to any of its members, take it back, change its priority and close it. They can add and remove members. They cannot create a team, dissolve one, or name a chief.')}</p>
        <p>{t('atask.team.x.2', 'An admin does all of that, across every team, and is the only one who can move a task from one team to another.')}</p>
        <p>{t('atask.team.x.3', 'When somebody leaves a team, their unfinished tasks go back to the team pool unassigned and the chief is told. Tasks they had already finished keep their name: the history says who did the work and is never rewritten.')}</p>
      </Explain>

      {canRun
        ? <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} />{t('atask.team.new', 'New staff team')}</Button>
        : (
          // Said once, here, rather than discovered as a 403 after filling a form in.
          <p className="text-[11px] text-[var(--faint)] flex items-center gap-1.5">
            <ShieldAlert size={12} /> {t('atask.team.readonly', 'You can see the teams and, where you are the chief, manage your own members. Creating a team, dissolving one and naming a chief are admin-only.')}
          </p>
        )}

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

      {creating && <TeamEditor open people={data?.people || {}} onClose={() => setCreating(false)} onSaved={refresh} />}
    </div>
  );
}

export default AdminTaskTeams;
