// Teams: create one, invite members, put repos / catalogues / pools under it, and the
// public card at /t/:slug. A team's members manage what is attached alongside its owner;
// billing stays with the owner.
import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users, Plus, UserPlus, Trash2, LogOut, Crown, Mail, Phone, Globe, Link2, Package, HardDrive, Layers, ArrowRightLeft, Check, X, Copy, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Textarea, Field, Select, EmptyState, Spinner, Modal, useToast, useDialog } from '../ui/ui.jsx';
import { ContactButton } from '../ui/contact.jsx';

const ROLE_KEY = { owner: 'tm.role.owner', admin: 'tm.role.admin', member: 'tm.role.member' };

function TeamForm({ initial, onSave, onCancel, busy }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: '', contactEmail: '', contactPhone: '', website: '', discord: '', description: '', ...(initial || {}) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label={t('tm.f.name', 'Team name')}><Input value={f.name} maxLength={60} onChange={set('name')} /></Field>
        <Field label={t('tm.f.email', 'Contact e-mail')} hint={t('tm.f.email.h', 'Required. Shown on the team page and on what the team publishes.')}><Input type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field label={t('tm.f.phone', 'Phone (optional)')}><Input value={f.contactPhone} maxLength={40} onChange={set('contactPhone')} /></Field>
        <Field label={t('tm.f.website', 'Website (optional)')}><Input value={f.website} onChange={set('website')} placeholder="https://…" /></Field>
        <Field label="Discord (optional)"><Input value={f.discord} onChange={set('discord')} placeholder="https://discord.gg/…" /></Field>
      </div>
      <Field label={t('tm.f.desc', 'Description')}><Textarea rows={3} value={f.description} maxLength={2000} onChange={set('description')} /></Field>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>}
        <Button variant="primary" loading={busy} disabled={f.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail)} onClick={() => onSave(f)}>{t('common.save', 'Save')}</Button>
      </div>
    </div>
  );
}

function TeamDetail({ team, reload }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user } = useAuth();
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(''); const [inviteRole, setInviteRole] = useState('member');
  const { data: pub, reload: reloadPub } = useAsync(() => api.get(`/teams/${team.slug}`), [team.slug, team.updatedAt]);
  // Invitation links: one address anyone signed in can open to join with the chosen role.
  const links = useAsync(() => (['owner', 'admin'].includes(team.myRole) ? api.get(`/me/teams/${team.id}/invites`) : Promise.resolve({ invites: [] })), [team.id]);
  const [linkRole, setLinkRole] = useState('member'); const [linkDays, setLinkDays] = useState(7);
  const makeLink = async () => {
    try { const r = await api.post(`/me/teams/${team.id}/invites`, { role: linkRole, days: linkDays || null }); links.reload(); await copyLink(r.invite.url); }
    catch (x) { toast.error(x.data?.error === 'too_many_invites' ? t('tm.link.toomany', 'Ten open links already — revoke one first.') : t('common.failed', 'Failed.')); }
  };
  const copyLink = async (path) => { try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); toast.success(t('tm.link.copied', 'Link copied.')); } catch { toast.success(`${window.location.origin}${path}`); } };
  const revokeLink = async (id) => { await api.delete(`/me/teams/${team.id}/invites/${id}`).catch(() => toast.error(t('common.failed', 'Failed.'))); links.reload(); };
  const { data: mine } = useAsync(() => Promise.all([api.get('/me/repos').catch(() => ({ repos: [] })), api.get('/me/catalogs').catch(() => ({ catalogs: [] })), api.get('/me/hosting/groups').catch(() => ({ groups: [] }))]), []);
  const canAdmin = ['owner', 'admin'].includes(team.myRole);
  const isOwner = team.myRole === 'owner';
  const members = pub?.team?.members || [];
  const doInvite = async () => {
    if (!invite.trim()) return;
    setBusy(true);
    try { const r = await api.post(`/me/teams/${team.id}/members`, { to: invite.trim(), role: inviteRole }); toast.success(t('tm.invited', 'Invited {n}.').replace('{n}', r.invited.displayName)); setInvite(''); reloadPub(); }
    catch (x) { const e = x.data?.error; toast.error(e === 'user_not_found' ? t('tm.notfound', 'No account matches.') : e === 'already_member' ? t('tm.already', 'Already a member.') : e === 'team_full' ? t('tm.full', 'The team is full.') : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const remove = async (m) => {
    if (!await dialog.confirm({ title: t('tm.remove.q', 'Remove {n} from the team?').replace('{n}', m.displayName), danger: true })) return;
    await api.delete(`/me/teams/${team.id}/members/${m.id}`).catch(() => toast.error(t('common.failed', 'Failed.')));
    reloadPub();
  };
  const leave = async () => {
    if (!await dialog.confirm({ title: t('tm.leave.q', 'Leave this team?'), message: t('tm.leave.m', 'You will no longer manage what it publishes.'), danger: true })) return;
    try { await api.delete(`/me/teams/${team.id}/members/${user.id}`); reload(); } catch (x) { toast.error(x.data?.error === 'transfer_first' ? t('tm.transferfirst', 'Hand the team to somebody first.') : t('common.failed', 'Failed.')); }
  };
  const transfer = async (m) => {
    if (!await dialog.confirm({ title: t('tm.transfer.q', 'Hand the team to {n}?').replace('{n}', m.displayName), message: t('tm.transfer.m', 'They become the owner; you stay as an admin.'), danger: true })) return;
    await api.post(`/me/teams/${team.id}/transfer`, { userId: m.id }).catch(() => toast.error(t('common.failed', 'Failed.')));
    reload(); reloadPub();
  };
  const dissolve = async () => {
    if (!await dialog.confirm({ title: t('tm.delete.q', 'Dissolve the team?'), message: t('tm.delete.m', 'Members are removed; repos, catalogues and pools stay with their owners.'), danger: true })) return;
    await api.delete(`/me/teams/${team.id}`).catch(() => toast.error(t('common.failed', 'Failed.')));
    reload();
  };
  const attach = async (kind, id, on) => {
    try { await api.put(`/me/teams/${team.id}/attach`, { kind, id, attach: on }); reloadPub(); toast.success(on ? t('tm.attached', 'Attached to the team.') : t('tm.detached', 'Detached.')); }
    catch (x) { toast.error(x.data?.error === 'owner_only' ? t('tm.attach.owner', 'Only the owner of that item can attach it.') : t('common.failed', 'Failed.')); }
  };
  const [repos, catalogs, groups] = mine ? [mine[0].repos || [], mine[1].catalogs || [], mine[2].groups || []] : [[], [], []];
  const Attachable = ({ kind, icon: I, items, label }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><I size={12} /> {label}</div>
      {!items.length ? <div className="text-[12px] text-[var(--faint)]">—</div> : (
        <ul className="space-y-1">
          {items.map((it) => {
            const on = it.teamId === team.id;
            return <li key={it.id} className="flex items-center gap-2 text-[13px]"><span className="flex-1 min-w-0 truncate">{it.name}</span>{it.teamId && !on && <span className="text-[11px] text-[var(--faint)]">{t('tm.otherteam', 'another team')}</span>}<Button size="sm" variant={on ? 'primary' : 'ghost'} disabled={it.ownerId && it.ownerId !== user?.id} onClick={() => attach(kind, it.id, !on)}>{on ? <><Check size={12} /> {t('tm.inteam', 'In the team')}</> : <><Plus size={12} /> {t('tm.attach', 'Attach')}</>}</Button></li>;
          })}
        </ul>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-lg flex items-center gap-2"><Users size={18} className="text-[var(--primary-2)]" /> {team.name} <Badge>{t(ROLE_KEY[team.myRole] || 'tm.role.member', team.myRole)}</Badge></div>
            <div className="text-[12.5px] text-[var(--muted)] mt-1 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><Mail size={12} /> {team.contactEmail}</span>
              {team.contactPhone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {team.contactPhone}</span>}
              {team.website && <a href={team.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--primary-2)]"><Globe size={12} /> {team.website}</a>}
              <Link to={`/t/${team.slug}`} className="inline-flex items-center gap-1 hover:text-[var(--primary-2)]"><Link2 size={12} /> /t/{team.slug}</Link>
            </div>
            {team.description && <p className="text-sm text-[var(--muted)] mt-2">{team.description}</p>}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {canAdmin && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>{t('common.edit', 'Edit')}</Button>}
            {!isOwner && <Button size="sm" variant="ghost" onClick={leave}><LogOut size={13} /> {t('tm.leave', 'Leave')}</Button>}
            {isOwner && <Button size="sm" variant="ghost" className="!text-error" onClick={dissolve}><Trash2 size={13} /> {t('tm.delete', 'Dissolve')}</Button>}
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="font-semibold mb-2 flex items-center gap-2"><Users size={15} /> {t('tm.members', 'Members')} <span className="text-[var(--faint)] font-normal text-[12px]">{members.length}</span></div>
        <ul className="divide-y divide-[var(--line)]">
          {members.map((m) => (
            <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
              <Link to={`/u/${m.id}`} className="font-medium hover:text-[var(--primary-2)] truncate">{m.displayName}</Link>
              <Badge>{m.role === 'owner' ? <><Crown size={10} /> {t('tm.role.owner', 'owner')}</> : t(ROLE_KEY[m.role], m.role)}</Badge>
              <span className="flex-1" />
              {isOwner && m.role !== 'owner' && <>
                <Select value={m.role} className="!w-auto !py-1 text-xs" onChange={async (e) => { await api.patch(`/me/teams/${team.id}/members/${m.id}`, { role: e.target.value }).catch(() => {}); reloadPub(); }}>
                  <option value="admin">{t('tm.role.admin', 'admin')}</option><option value="member">{t('tm.role.member', 'member')}</option>
                </Select>
                <Button size="sm" variant="ghost" title={t('tm.transfer', 'Hand over the team')} onClick={() => transfer(m)}><ArrowRightLeft size={13} /></Button>
              </>}
              {canAdmin && m.role !== 'owner' && m.id !== user?.id && <Button size="sm" variant="ghost" className="!text-error" onClick={() => remove(m)}><X size={13} /></Button>}
            </li>
          ))}
        </ul>
        {canAdmin && (<>
          <div className="mt-3 flex gap-2 items-end flex-wrap">
            <Field label={t('tm.invite', 'Invite')} hint={t('tm.invite.h', 'A BC id, an e-mail or an exact display name. They must accept.')} className="flex-1 min-w-[14rem]"><Input value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doInvite()} /></Field>
            <Select value={inviteRole} className="!w-auto" onChange={(e) => setInviteRole(e.target.value)}><option value="member">{t('tm.role.member', 'member')}</option><option value="admin">{t('tm.role.admin', 'admin')}</option></Select>
            <Button variant="primary" loading={busy} onClick={doInvite}><UserPlus size={14} /> {t('tm.invite.btn', 'Invite')}</Button>
          </div>
            <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
              <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1.5"><Link2 size={13} /> {t('tm.link.h', 'Invitation links')}</div>
              <p className="text-[11px] text-[var(--faint)] mb-2">{t('tm.link.d', 'Anyone signed in who opens the link joins with the role below. A link can expire and be revoked; up to ten open at once.')}</p>
              <div className="flex flex-wrap gap-2 items-end">
                <Field label={t('tm.link.role', 'Role')} className="!mb-0"><Select value={linkRole} onChange={(e) => setLinkRole(e.target.value)}><option value="member">{t('tm.role.member', 'Member')}</option><option value="admin">{t('tm.role.admin', 'Admin')}</option></Select></Field>
                <Field label={t('tm.link.days', 'Valid for (days, 0 = no limit)')} className="!mb-0"><Input type="number" min={0} max={90} value={linkDays} onChange={(e) => setLinkDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} /></Field>
                <Button size="sm" onClick={makeLink}><Plus size={13} /> {t('tm.link.new', 'New link')}</Button>
              </div>
              {(links.data?.invites || []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {links.data.invites.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 text-[12px] flex-wrap">
                      <Badge>{t(ROLE_KEY[l.role] || 'tm.role.member', l.role)}</Badge>
                      <span className="text-[var(--muted)]">{l.expiresAt ? t('tm.link.until', 'until {d}').replace('{d}', new Date(l.expiresAt).toLocaleDateString()) : t('tm.link.nolimit', 'no expiry')} · {t('tm.link.uses', '{n} use(s)').replace('{n}', l.uses)}{!l.usable ? ` · ${t('tm.link.dead', 'expired')}` : ''}</span>
                      <span className="ms-auto flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => copyLink(l.url)}><Copy size={12} /> {t('tm.link.copy', 'Copy')}</Button>
                        <Button size="sm" variant="ghost" className="!text-error" onClick={() => revokeLink(l.id)}><X size={12} /></Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>)}
      </Card>

      {canAdmin && (
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="font-semibold flex items-center gap-2"><Layers size={15} /> {t('tm.managed', 'What the team manages')}</div>
          <p className="text-[12px] text-[var(--muted)]">{t('tm.managed.h', 'Only the owner of an item can attach it. Every active member then edits it, answers messages about it, and publishes — billing stays with the owner.')}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <Attachable kind="repo" icon={Package} items={repos} label={t('tm.repos', 'Repos')} />
            <Attachable kind="catalog" icon={Layers} items={catalogs} label={t('tm.catalogs', 'Catalogues')} />
            <Attachable kind="group" icon={HardDrive} items={groups} label={t('tm.pools', 'Storage pools')} />
          </div>
        </Card>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(false)} title={t('tm.edit', 'Edit the team')} icon={Users} width="max-w-2xl">
          <TeamForm initial={team} busy={busy} onCancel={() => setEdit(false)} onSave={async (f) => { setBusy(true); try { await api.patch(`/me/teams/${team.id}`, f); setEdit(false); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); } }} />
        </Modal>
      )}
    </div>
  );
}

export function MyTeams() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/me/teams'), []);
  const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const limits = useAsync(() => api.get('/me/teams/limits'), [data]);
  const lim = limits.data;
  const atLimit = !!lim && !lim.staff && lim.owned >= lim.limit;
  const money = (c, cur) => `${(c / 100).toFixed(2)} ${String(cur || 'eur').toUpperCase()}`;
  const buySlot = async () => {
    try { const r = await api.post('/me/teams/slot/checkout', {}); if (r.url) window.location.href = r.url; }
    catch (x) { toast.error(x.data?.error === 'payments_disabled' || x.data?.error === 'stripe_not_configured' ? t('tm.slot.off', 'Payments are not available right now.') : t('common.failed', 'Failed.')); }
  };
  const teams = data?.teams || [];
  const invited = teams.filter((x) => x.myStatus === 'invited');
  const active = teams.filter((x) => x.myStatus === 'active');
  const open = active.find((x) => x.id === openId);
  const answer = async (tm, verb) => { await api.post(`/me/teams/${tm.id}/${verb}`).catch(() => toast.error(t('common.failed', 'Failed.'))); reload(); };
  if (open) return <div><Button size="sm" variant="ghost" className="mb-2" onClick={() => setOpenId(null)}>← {t('tm.all', 'All teams')}</Button><TeamDetail team={open} reload={() => { reload(); }} /></div>;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Users size={16} className="text-[var(--primary-2)]" />
        <div className="font-semibold">{t('tm.title', 'Teams')}</div>
        {atLimit
          ? <Button size="sm" variant="primary" className="ms-auto" onClick={buySlot}><ShoppingBag size={13} /> {t('tm.slot.buy', 'One more team — {p}').replace('{p}', lim ? money(lim.slot.cents, lim.slot.currency) : '')}</Button>
          : <Button size="sm" variant="primary" className="ms-auto" onClick={() => setCreating(true)}><Plus size={13} /> {t('tm.create', 'Create a team')}</Button>}
      </div>
      {lim && !lim.staff && (
        <p className="text-[11px] text-[var(--faint)] mb-2">
          {t('tm.limit', 'You own {n} of {m} team(s).').replace('{n}', lim.owned).replace('{m}', lim.limit)}
          {lim.extra ? ` ${t('tm.limit.extra', '({e} bought)').replace('{e}', lim.extra)}` : ''}
          {atLimit ? ` ${t('tm.limit.more', 'One more is a one-off payment of {p} and is yours for good.').replace('{p}', money(lim.slot.cents, lim.slot.currency))}` : ''}
        </p>
      )}
      <p className="text-[12.5px] text-[var(--muted)] mb-3">{t('tm.desc', 'A team manages repos, catalogues and storage pools together and has one contact address. Visitors reach the team from what it publishes.')}</p>
      {invited.length > 0 && (
        <div className="mb-3 rounded-xl border border-[var(--primary)]/40 p-3 space-y-2">
          <div className="text-[12px] font-semibold">{t('tm.invites', 'Invitations')}</div>
          {invited.map((tm) => <div key={tm.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{tm.name}</span><Button size="sm" variant="primary" onClick={() => answer(tm, 'accept')}><Check size={12} /> {t('tm.accept', 'Join')}</Button><Button size="sm" variant="ghost" onClick={() => answer(tm, 'decline')}><X size={12} /></Button></div>)}
        </div>
      )}
      {loading && !data ? <div className="py-6 text-center"><Spinner /></div> : !active.length ? <EmptyState icon={Users} title={t('tm.empty', 'You are not in a team yet.')} /> : (
        <ul className="grid sm:grid-cols-2 gap-2">
          {active.map((tm) => (
            <li key={tm.id}>
              <button type="button" onClick={() => setOpenId(tm.id)} className="w-full text-start rounded-xl border border-[var(--line)] p-3 hover:border-[var(--line-strong)] transition-colors">
                <div className="font-semibold flex items-center gap-2">{tm.name} <Badge>{t(ROLE_KEY[tm.myRole] || 'tm.role.member', tm.myRole)}</Badge></div>
                <div className="text-[12px] text-[var(--muted)] mt-1">{tm.counts?.members ?? '–'} {t('tm.members', 'Members').toLowerCase()} · {tm.counts?.repos ?? 0} {t('tm.repos', 'Repos').toLowerCase()} · {tm.counts?.catalogs ?? 0} {t('tm.catalogs', 'Catalogues').toLowerCase()} · {tm.counts?.groups ?? 0} {t('tm.pools', 'Storage pools').toLowerCase()}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <Modal open onClose={() => setCreating(false)} title={t('tm.create', 'Create a team')} icon={Users} width="max-w-2xl">
          <TeamForm busy={busy} onCancel={() => setCreating(false)} onSave={async (f) => { setBusy(true); try { await api.post('/me/teams', f); setCreating(false); reload(); } catch (x) { toast.error(x.data?.error === 'too_many_teams' ? t('tm.toomany', 'You own too many teams.') : t('common.failed', 'Failed.')); } finally { setBusy(false); } }} />
        </Modal>
      )}
    </Card>
  );
}

/** /t/:slug — the public card. */
export default function TeamPage() {
  const { t } = useI18n(); const { slug } = useParams();
  const { data, loading } = useAsync(() => api.get(`/teams/${encodeURIComponent(slug)}`), [slug]);
  if (loading && !data) return <div className="py-16 text-center"><Spinner /></div>;
  const tm = data?.team;
  if (!tm) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={Users} title={t('tm.notfound.page', 'No such team.')} /></div>;
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] grid place-items-center shrink-0">{tm.avatar ? <img src={tm.avatar} alt="" className="w-14 h-14 rounded-2xl object-cover" /> : <Users size={24} className="text-[var(--primary-2)]" />}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold">{tm.name}</h1>
          {tm.description && <p className="text-sm text-[var(--muted)] mt-1">{tm.description}</p>}
          <div className="text-[12.5px] text-[var(--muted)] mt-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Mail size={12} /> {tm.contactEmail}</span>
            {tm.contactPhone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {tm.contactPhone}</span>}
            {tm.website && <a href={tm.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--primary-2)]"><Globe size={12} /> {t('tm.website', 'Website')}</a>}
            {tm.discord && <a href={tm.discord} target="_blank" rel="noreferrer" className="hover:text-[var(--primary-2)]">Discord</a>}
          </div>
        </div>
        <ContactButton kind="team" targetId={tm.slug} targetLabel={tm.name} variant="primary" />
      </div>
      <Card className="p-4">
        <div className="font-semibold mb-2">{t('tm.members', 'Members')}</div>
        <div className="flex flex-wrap gap-2">{tm.members.map((m) => <Link key={m.id} to={`/u/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-sm hover:border-[var(--line-strong)]">{m.role === 'owner' && <Crown size={12} className="text-warning" />} {m.displayName}</Link>)}</div>
      </Card>
      {(tm.repos.length > 0 || tm.catalogs.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-4"><div className="font-semibold mb-2 flex items-center gap-1.5"><Package size={14} /> {t('tm.repos', 'Repos')}</div>{tm.repos.length ? <ul className="space-y-1 text-sm">{tm.repos.map((r) => <li key={r.id}><Link to={`/r/${r.id}`} className="hover:text-[var(--primary-2)]">{r.name}</Link></li>)}</ul> : <div className="text-[12px] text-[var(--faint)]">—</div>}</Card>
          <Card className="p-4"><div className="font-semibold mb-2 flex items-center gap-1.5"><Layers size={14} /> {t('tm.catalogs', 'Catalogues')}</div>{tm.catalogs.length ? <ul className="space-y-1 text-sm">{tm.catalogs.map((c) => <li key={c.id}><Link to={`/c/${c.slug}`} className="hover:text-[var(--primary-2)]">{c.name}</Link></li>)}</ul> : <div className="text-[12px] text-[var(--faint)]">—</div>}</Card>
        </div>
      )}
    </div>
  );
}

/** /teams/join/:token — an invitation link's landing: the team, the role, Join. */
export function TeamJoin() {
  const { token } = useParams();
  const { t } = useI18n(); const toast = useToast(); const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error } = useAsync(() => api.get(`/teams/join/${encodeURIComponent(token)}`), [token, user?.id]);
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try { await api.post(`/teams/join/${encodeURIComponent(token)}`, {}); toast.success(t('tm.join.ok', 'You are in.')); navigate('/dashboard?s=teams'); }
    catch (x) { toast.error(x.data?.error === 'invite_invalid' ? t('tm.join.invalid', 'This link no longer works.') : x.data?.error === 'team_full' ? t('tm.full', 'The team is full.') : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  if (loading && !data) return <div className="py-16 text-center"><Spinner /></div>;
  if (error || !data) return <div className="max-w-md mx-auto py-16"><EmptyState icon={Users} title={t('tm.join.none', 'This invitation does not exist.')} /></div>;
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-5 space-y-3 text-center">
        <Users size={28} className="mx-auto text-[var(--primary-2)]" />
        <div className="font-semibold text-lg">{data.team?.name}</div>
        {data.team?.description && <p className="text-sm text-[var(--muted)]">{data.team.description}</p>}
        <p className="text-sm">{t('tm.join.as', 'You are invited to join as {r}.').replace('{r}', t(ROLE_KEY[data.role] || 'tm.role.member', data.role))}</p>
        {!data.usable ? <p className="text-sm text-[var(--muted)]">{t('tm.join.invalid', 'This link no longer works.')}</p>
          : data.alreadyMember ? <Link to="/dashboard?s=teams"><Button variant="primary">{t('tm.join.already', 'You are already a member — open the team')}</Button></Link>
          : !data.signedIn ? <Link to={`/auth?next=${encodeURIComponent(`/teams/join/${token}`)}`}><Button variant="primary">{t('tm.join.signin', 'Sign in to join')}</Button></Link>
          : <Button variant="primary" disabled={busy} onClick={join}>{busy ? <Spinner /> : <Check size={14} />} {t('tm.join.btn', 'Join the team')}</Button>}
      </Card>
    </div>
  );
}
