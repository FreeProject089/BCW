// Staff teams: who is on one, who runs it, and what they are holding.
//
// A team here is a working unit inside the staff, not the customer-facing `Team` that owns
// repos and catalogues. Exactly one chief, and the chief is the only person besides a
// dispatcher who can hand the team's work out.
//
// Two things the owner asked for, Sept 23 2026, and how this file answers them:
//
//   · "which members make up the team, at a glance". The card was a row of name chips with
//     the chief in a different colour. It is now a roster: one line per person, avatar, name,
//     a crown on the chief, a "you" on yourself, and how many OPEN tasks of this team each one
//     holds, under a header that says how many people, how many open tasks, how many of those
//     nobody has. A team whose four members hold nothing and whose pool has nine tasks reads
//     as exactly that, without opening anything.
//   · "add the members and the configuration when you CREATE the team, not afterwards". The
//     create form now takes the name, what it is for, the chief AND the members in one go, and
//     the server writes them in one statement.
//
// Every button is drawn from what the server said this account may do (`canRunTeams`,
// `canNameChiefs`, per-team `canManage` / `canAddOutsiders`), never re-derived here.
import { useState } from 'react';
import { Users, Plus, Crown, UserPlus, UserMinus, PenSquare, Trash2, Archive, ArchiveRestore, AlertTriangle, ShieldAlert, ClipboardList, Inbox, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Field, Badge, Modal, EmptyState, Spinner, Explain, useToast, useDialog } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';
import { AccountPicker, AccountSearch, PeoplePicker } from './admin-people-picker.jsx';
import { useAsync } from './pages.jsx';

/**
 * What the server actually said, as a sentence, and which box it belongs to. A 403 belongs to
 * neither box: it is about the account, not the form.
 */
function teamError(e, t) {
  const code = e?.data?.error;
  if (code === 'cannot_name_chief') return { field: 'chief', message: t('atask.team.e.namechief', 'Naming a chief hands out the right to dispatch, so it takes both "Shape the staff teams" and "Dispatch tasks". Nobody below admin can name themselves.') };
  if (code === 'cannot_add_member') return { field: 'member', message: t('atask.team.e.addmember', 'You cannot add that person. A chief adds people who are already staff; bringing somebody new onto the board, or adding yourself, takes more than that.') };
  if (e?.status === 403 || code === 'forbidden' || code === 'missing_permission') {
    return { field: 'form', message: t('atask.team.e.forbidden2', 'Your account is not allowed to change this team. Ask whoever gave you access to the board.') };
  }
  if (code === 'unknown_chief') return { field: 'chief', message: t('atask.team.e.chief', 'No account with that id any more. Search for the person and pick them from the list.') };
  if (code === 'unknown_user') return { field: 'member', message: t('atask.team.e.user', 'No account with that id any more. Search for the person and pick them from the list.') };
  if (code === 'invalid_input') return { field: 'name', message: t('atask.team.e.input', 'The server refused the form. A name of 2 to 60 characters and a chief are both required.') };
  if (code === 'not_found') return { field: 'form', message: t('atask.team.e.gone', 'That team no longer exists. Reload the list.') };
  if (code === 'chief_must_be_replaced') return { field: 'form', message: t('atask.team.e.chiefstays', 'The chief cannot leave the team. Name another chief first, or dissolve it.') };
  if (e?.status === 401) return { field: 'form', message: t('atask.team.e.auth', 'Your session expired. Sign in again.') };
  return { field: 'form', message: t('atask.team.e.other', 'The server refused that and gave no reason. Try again, and check the API is reachable.') };
}

/** One red line under a field, or nothing. */
function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1 text-[11px] text-error flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{children}</p>;
}

/**
 * Create a team, whole: name, purpose, chief and members in one form. Editing an existing
 * team reuses it for the name and the purpose; its members are managed on the card, where
 * each change is its own action with its own consequence (a removal releases tasks).
 */
function TeamEditor({ open, initial, people, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [chief, setChief] = useState(initial?.chiefId
    ? { id: initial.chiefId, displayName: people?.[initial.chiefId]?.displayName || initial.chiefId }
    : null);
  const [members, setMembers] = useState([]);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const e = {};
    if (name.trim().length < 2) e.name = t('atask.team.needname', 'Give the team a name first (2 characters or more).');
    if (!editing && !chief) e.chief = t('atask.team.needchief', 'A team needs a chief. Search for the person who will run it.');
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (editing) {
        // The chief has its own dialog on the card: changing it tells people and adds a member.
        await api.patch(`/admin/tasks/teams/${initial.id}`, { name: name.trim(), description: description.trim() });
      } else {
        await api.post('/admin/tasks/teams', {
          name: name.trim(), description: description.trim(), chiefId: chief.id,
          memberIds: members.map((m) => m.id).filter((id) => id !== chief.id),
        });
        toast.success(t('atask.team.created', 'Team created, and everybody on it was told.'));
      }
      onSaved();
      onClose();
    } catch (x) {
      const { field, message } = teamError(x, t);
      setErr({ [field]: message });
    } finally { setBusy(false); }
  };

  const withChief = chief ? [chief, ...members.filter((m) => m.id !== chief.id)] : members;

  return (
    <Modal open={open} onClose={onClose} icon={Users} width="max-w-xl" title={editing ? t('atask.team.edit', 'Edit the team') : t('atask.team.new', 'New staff team')}
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{editing ? t('atask.save', 'Save') : t('atask.team.create', 'Create the team')}</Button></div>}>
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
        {!editing && (
          <Field label={t('atask.team.f.chief', 'Chief')} hint={t('atask.team.f.chief.h2', 'The person who dispatches this team’s work. They are added as a member automatically. Search by name, e-mail or id.')}>
            <AccountPicker value={chief} invalid={!!err.chief} source="staff"
              onChange={(u) => { setChief(u); setErr((s) => ({ ...s, chief: null })); }}
              placeholder={t('atask.team.f.chief.ph2', 'Search for the chief…')} />
            <FieldError>{err.chief}</FieldError>
          </Field>
        )}
        {!editing && (
          <Field label={t('atask.team.f.members', 'Members')} hint={t('atask.team.f.members.h', 'Everybody who will work this team’s tasks. You can add and remove people later from the team card too.')}>
            <PeoplePicker value={withChief} fixed={chief ? [chief.id] : []} source="staff"
              onChange={(list) => { setMembers(list.filter((m) => m.id !== chief?.id)); setErr((s) => ({ ...s, member: null })); }}
              placeholder={t('atask.team.f.members.ph', 'Add a member…')} />
            <FieldError>{err.member}</FieldError>
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Hand the team to somebody else. */
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
        <AccountPicker value={who} onChange={(u) => { setWho(u); setErr(null); }} invalid={!!err} source="staff"
          placeholder={t('atask.team.f.chief.ph2', 'Search for the chief…')} autoFocus />
        <FieldError>{err}</FieldError>
      </Field>
    </Modal>
  );
}

/** One person on the roster: who, their role on the team, what they hold. */
function RosterRow({ m, person, canRemove, busy, onRemove, t }) {
  const name = person?.displayName || t('atask.unknown', 'Unknown account');
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <Avatar user={person || { id: m.userId }} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate" title={name}>{name}</span>
          {m.chief && <Badge tone="primary" title={t('atask.team.chief', 'Chief')}><Crown size={11} className="me-1" />{t('atask.team.chief', 'Chief')}</Badge>}
          {m.you && <Badge>{t('atask.team.you', 'You')}</Badge>}
        </div>
      </div>
      <span className={`shrink-0 text-[11px] ${m.open ? 'text-[var(--text)]' : 'text-[var(--faint)]'}`}
        title={t('atask.team.load.t', 'Open tasks of this team on this person')}>
        <ClipboardList size={11} className="inline me-1 align-[-1px]" aria-hidden="true" />
        {t('atask.team.load', '{n} open').replace('{n}', String(m.open || 0))}
      </span>
      {canRemove && !m.chief && (
        <button type="button" disabled={busy} onClick={onRemove} className="shrink-0 p-1 text-[var(--faint)] hover:text-error"
          title={t('atask.team.rm', 'Remove from the team')} aria-label={t('atask.team.rm', 'Remove from the team')}>
          <UserMinus size={13} />
        </button>
      )}
    </li>
  );
}

// M14: a long roster folds. Up to this many people the list is simply shown; above it the card
// opens folded (an avatar row and the count) so one big team no longer stretches the whole
// grid. The choice is remembered per team, in this browser only.
const ROSTER_OPEN_UP_TO = 5;
const rosterKey = (id) => `bcw.admin.tasks.roster.${id}`;
const readRosterOpen = (id) => { try { const v = localStorage.getItem(rosterKey(id)); return v === null ? null : v === '1'; } catch { return null; } };
const writeRosterOpen = (id, on) => { try { localStorage.setItem(rosterKey(id), on ? '1' : '0'); } catch { /* private mode: not remembered */ } };

function TeamCard({ team, people, me, canRun, canNameChiefs, onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(() => readRosterOpen(team.id));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chiefing, setChiefing] = useState(false);
  const [err, setErr] = useState(null);

  // Every mutation on this card goes through here, so the server's reason is shown once.
  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); }
    catch (x) { const m = teamError(x, t).message; setErr(m); toast.error(m); }
    finally { setBusy(false); }
  };

  const roster = (team.members || [])
    .map((m) => ({ ...m, you: m.userId === me }))
    // The chief first, then whoever holds the most, then by name: the order a chief reads in.
    .sort((a, b) => (b.chief - a.chief) || ((b.open || 0) - (a.open || 0))
      || String(people[a.userId]?.displayName || '').localeCompare(String(people[b.userId]?.displayName || '')));
  const memberIds = roster.map((m) => m.userId);

  const addMember = (u) => run(async () => { await api.post(`/admin/tasks/teams/${team.id}/members`, { userId: u.id }); setAdding(false); });

  const removeMember = async (uid) => {
    const ok = await dialog.confirm({
      title: t('atask.team.rm.t', 'Remove from the team'),
      message: t('atask.team.rm.m', 'Their unfinished tasks go back to this team’s pool and the chief is told. Tasks they already finished keep their name on them.'),
    });
    if (!ok) return;
    // undo: nothing is destroyed. The membership row goes, the person is taken off the team's
    // open tasks (which stay with the team) and can be added again in two clicks from the
    // search on this card — so an undo window would only delay a reversible action.
    run(() => api.del(`/admin/tasks/teams/${team.id}/members/${uid}`));
  };

  const dissolve = async () => {
    const ok = await dialog.confirm({
      title: t('atask.team.del.t', 'Dissolve the team'),
      message: t('atask.team.del.m', 'The team goes away. Its tasks are kept: the unfinished ones land unassigned in the unfiled pool, where an admin re-files them.'),
      danger: true,
    });
    if (!ok) return;
    // undo: the tasks are kept and listed in the unfiled pool; the team itself is a name and a
    // list of people, re-created in one form. Archiving is the reversible option and sits
    // right beside this button.
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
      </div>

      {/* The team in three numbers, before the names. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Badge title={t('atask.team.members.t', 'People on this team, the chief included')}><Users size={11} className="me-1" />{t('atask.team.members.n', '{n} people').replace('{n}', String(roster.length))}</Badge>
        <Badge tone={team.openCount ? 'blue' : ''}><ClipboardList size={11} className="me-1" />{t('atask.team.open.n', '{n} open tasks').replace('{n}', String(team.openCount ?? 0))}</Badge>
        {team.unassigned > 0 && <Badge tone="amber"><Inbox size={11} className="me-1" />{t('atask.team.pool.n', '{n} in the pool').replace('{n}', String(team.unassigned))}</Badge>}
      </div>

      {(() => {
        // Folded by default only when the list is long; whatever the person chose wins.
        const open = rosterOpen ?? roster.length <= ROSTER_OPEN_UP_TO;
        const toggle = () => { setRosterOpen(!open); writeRosterOpen(team.id, !open); };
        const listId = `team-roster-${team.id}`;
        return (<>
          {roster.length > 1 && (
            <button type="button" onClick={toggle} aria-expanded={open} aria-controls={listId}
              className="mt-2 w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-[var(--surface-2)] transition-colors min-w-0">
              <ChevronDown size={14} className={`shrink-0 text-[var(--faint)] transition-transform ${open ? '' : '-rotate-90'}`} />
              <span className="text-[12px] font-medium text-[var(--text)] shrink-0">
                {open ? t('mA.tt.hide', 'Hide the members') : t('mA.tt.show', 'Show the {n} members').replace('{n}', String(roster.length))}
              </span>
              {!open && (
                <span className="flex -space-x-1.5 min-w-0 overflow-hidden ms-auto" aria-hidden="true">
                  {roster.slice(0, 6).map((m) => (
                    <span key={m.userId} className="rounded-full ring-2 ring-[var(--bg-solid)] shrink-0"><Avatar user={people[m.userId] || { id: m.userId }} size={20} /></span>
                  ))}
                  {roster.length > 6 && <span className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-semibold bg-[var(--surface-2)] text-[var(--muted)] ring-2 ring-[var(--bg-solid)] shrink-0">+{roster.length - 6}</span>}
                </span>
              )}
            </button>
          )}
          {(open || roster.length <= 1) && (
            <ul id={listId} className="mt-1 divide-y divide-[var(--line)]" aria-label={t('atask.team.roster', 'Who is on this team')}>
              {roster.map((m) => (
                <RosterRow key={m.userId} m={m} person={people[m.userId]} t={t} busy={busy}
                  canRemove={team.canManage || m.you} onRemove={() => removeMember(m.userId)} />
              ))}
            </ul>
          )}
        </>);
      })()}
      {roster.length <= 1 && <p className="text-xs text-[var(--faint)] mt-1">{t('atask.team.solo', 'Only the chief so far.')}</p>}

      {team.canManage && (
        <div className="mt-3">
          {adding ? (
            <div className="rounded-xl border border-[var(--line)] p-2.5" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('atask.team.add.t', 'Add somebody')}</span>
                <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setAdding(false)}>{t('atask.cancel', 'Cancel')}</Button>
              </div>
              <AccountSearch onPick={addMember} exclude={memberIds} autoFocus source="staff"
                placeholder={t('atask.team.add.ph2', 'Search a name, an e-mail or an id…')} />
              {!team.canAddOutsiders && (
                <p className="mt-1.5 text-[11px] text-[var(--faint)]">{t('atask.team.add.staffonly', 'You can add people who are already staff. Bringing somebody new onto the board takes both "Shape the staff teams" and "Dispatch tasks".')}</p>
              )}
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
          {canNameChiefs && <Button size="sm" onClick={() => setChiefing(true)} disabled={busy}><Crown size={14} />{t('atask.team.chief.t', 'Change the chief')}</Button>}
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

export function AdminTaskTeams({ onChanged, me }) {
  const { t } = useI18n();
  const { data, err, loading, reload } = useAsync(() => api.get('/admin/tasks/teams'), []);
  const [creating, setCreating] = useState(false);
  const refresh = () => { reload(true); onChanged?.(); };

  if (loading) return <div className="py-8 grid place-items-center"><Spinner /></div>;
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
  const canNameChiefs = !!data?.canNameChiefs;
  // Creating a team names its chief, so the button needs both.
  const canCreate = canRun && canNameChiefs;

  return (
    <div className="space-y-4">
      <Explain summary={t('atask.team.x.s', 'A team has members and exactly one chief.')}>
        <p>{t('atask.team.x.1b', 'The chief hands the team’s work out: they can put any member of the team on any of its tasks, take them off, change the priority and close a task. They add staff to the team and remove members. They cannot create or dissolve a team, or name a chief.')}</p>
        <p>{t('atask.team.x.2b', 'Three permissions sit above that. "See every task" reads the whole board. "Dispatch tasks" does what a chief does, in every team. "Shape the staff teams" creates, renames, archives and dissolves teams. Naming a chief or adding members hands out a power, so it needs "Dispatch tasks" as well: nobody can give what they do not have.')}</p>
        <p>{t('atask.team.x.3', 'When somebody leaves a team, their unfinished tasks go back to the team pool unassigned and the chief is told. Tasks they had already finished keep their name: the history says who did the work and is never rewritten.')}</p>
      </Explain>

      {canCreate
        ? <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} />{t('atask.team.new', 'New staff team')}</Button>
        : (
          <p className="text-[11px] text-[var(--faint)] flex items-center gap-1.5">
            <ShieldAlert size={12} /> {t('atask.team.readonly2', 'You can see the teams and, where you are the chief, manage your own members. Creating a team takes "Shape the staff teams" and "Dispatch tasks".')}
          </p>
        )}

      {teams.length ? (
        // items-start: a card as tall as its own content, never stretched to its neighbour's.
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} people={data?.people || {}} me={me} canRun={canRun}
              canNameChiefs={canNameChiefs} onChanged={refresh} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} title={t('atask.team.none.t', 'No staff teams yet')}
          sub={t('atask.team.none.s', 'A team groups the people who work the same kind of thing, and gives them one chief who hands the work out.')}
          hint={canCreate ? null : t('atask.team.none.h', 'An admin creates these.')}
          action={canCreate ? { label: t('atask.team.new', 'New staff team'), icon: Plus, onClick: () => setCreating(true) } : null} />
      )}

      {creating && <TeamEditor open people={data?.people || {}} onClose={() => setCreating(false)} onSaved={refresh} />}
    </div>
  );
}

export default AdminTaskTeams;
