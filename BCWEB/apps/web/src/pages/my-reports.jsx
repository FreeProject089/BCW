// A member's own reports and the report thread they share with staff. Moved out of
// pages/admin.jsx unchanged (full audit Sept 24 2026, web): the dashboard's Reports tab loaded
// it with lazyNamed(() => import('./admin.jsx')), i.e. the whole admin screen (2 MB, 566 KB
// gzip) for one list. The admin's report queue imports ReportThreadModal from here.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Server, CheckCircle2, Package, Inbox, Eye, Sparkles, Users, Trash2, CheckCheck, Plus, Link2, Copy, MessageSquare, RefreshCw, X, AlertTriangle, Archive, Fingerprint, RotateCcw, Calendar } from 'lucide-react';
import { Bug as BugIcon } from 'lucide-react';
import { Button, Card, Badge, Input, Select, EmptyState, Modal, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { markReportsSeen, notifsReadElsewhere } from '../lib/notifs.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { ReportThread, ReportComposer, ReportModal } from '../ui/report.jsx';
import { useAsync, Loading, useThreadStream } from './pages.jsx';
import { fmtAgo } from '../lib/format.js';

export const REPORT_STATUS_TONE = { open: 'green', archived: 'amber', closed: '' };

export const REPORT_TARGET_ICON = { user: Users, repo: Server, catalog: Boxes, item: Package, general: MessageSquare, showcase_request: Sparkles, feedback: BugIcon };

// User dashboard: the reports / support threads this user opened, GitHub-PR style.
// Rendered by the MEMBER dashboard (pages/dashboard.jsx), never by this page — it lives
// here only because the old pages monolith was split this way. Exported so the dashboard
// imports it instead of referencing a bare identifier, which crashed the tab at render.
export function MyReports() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/me/reports'), []);
  // `?r=<id>` opens that thread: it is where every report notification and mail points.
  const [sp] = useSearchParams();
  const [openId, setOpenId] = useState(() => sp.get('r') || null);
  const [newOpen, setNewOpen] = useState(false);
  const reports = data?.reports || [];
  const unseen = reports.filter((r) => r.userUnread && !r.participant).length;
  // "Mark as seen" without opening: the thread's unread flag and the notifications about it,
  // in one write, and the bell and the topbar badge hear about it (lib/notifs.js).
  const seen = async (path) => { try { await markReportsSeen(path); reload(true); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-[var(--accent-ink)]" /> {t('mr.title', 'Messages & reports')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('mr.sub', 'Reports you filed and support conversations. Replies from the team show up here.')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {unseen > 0 && <Button size="sm" variant="ghost" onClick={() => seen('/me/reports/seen-all')}><CheckCheck size={14} /> {t('mr.seenall', 'Mark all as seen')}</Button>}
          <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}><Plus size={14} /> {t('mr.new2', 'New report / contact')}</Button>
        </div>
      </div>
      {loading ? <Loading /> : reports.length ? <div className="space-y-1.5">
        {reports.map((r) => { const Ico = REPORT_TARGET_ICON[r.targetType] || MessageSquare; return (
          <Card key={r.id} className={`p-3 flex items-center gap-3 card-hover ${r.userUnread && !r.participant ? 'border-[var(--primary)]' : ''}`}>
            <button onClick={() => setOpenId(r.id)} className="flex-1 min-w-0 flex items-center gap-3 text-start">
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><Ico size={15} className="text-[var(--accent-ink)]" /></span>
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0" title={r.targetLabel || undefined}>{r.targetLabel || t('mr.general', 'Support request')}</span> <Badge tone={REPORT_STATUS_TONE[r.status]}>{r.status}</Badge>{r.userUnread && !r.participant && <Badge tone="red">{t('mr.new', 'new reply')}</Badge>}</div>
                <div className="text-xs text-[var(--faint)]">{t('mr.on', 'on {t}').replace('{t}', r.targetType)} · {r.messageCount} {t('mr.msgs', 'messages')} · {fmtAgo(r.lastActivityAt)}</div>
              </div>
            </button>
            {r.userUnread && !r.participant && <Button size="sm" variant="ghost" onClick={() => seen(`/me/reports/${r.id}/seen`)} title={t('mr.seen', 'Mark as seen')} aria-label={t('mr.seen', 'Mark as seen')}><Eye size={14} /></Button>}
          </Card>
        ); })}
      </div> : <EmptyState icon={MessageSquare} title={t('mr.none.t', 'No reports yet')} sub={t('mr.none.s', 'Use the Report button on a profile, repo or catalog, or start one here.')}
        action={{ label: t('mr.new2', 'New report / contact'), icon: Plus, onClick: () => setNewOpen(true) }} />}
      {openId && <ReportThreadModal id={openId} admin={false} onClose={() => { setOpenId(null); reload(); }} />}
      {newOpen && <ReportModal targetType="general" targetId="" targetLabel="" onClose={() => { setNewOpen(false); reload(); }} />}
    </div>
  );
}

// Shared thread modal — user (admin=false) or staff (admin=true) view of one report.
export function ReportThreadModal({ id, admin, onClose, onDelete }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const base = admin ? `/admin/reports/${id}` : `/me/reports/${id}`;
  const { data, err, loading, reload } = useAsync(() => api.get(base), [id]);
  // Opening the thread marked it seen on the server, notifications about it included; the
  // response names those, so the bell and the topbar badge drop now rather than on their poll.
  useEffect(() => { if (data?.seenNotifIds) notifsReadElsewhere(data.seenNotifIds); }, [data]);
  // Live thread. The stream lives under /me/ for BOTH views: canAccessReport already covers
  // staff, so there is no second authorisation path to keep in step with the first.
  useThreadStream(id ? `/me/reports/${id}/stream` : null, () => reload(true));
  const [sending, setSending] = useState(false);
  const [people, setPeople] = useState(false);
  const r = data?.report;
  // A staff member can't moderate a report they opened — they reply to it as the reporter
  // from their own dashboard instead (avoids the "answering myself as staff" confusion).
  const own = admin && r && r.reporterId === user?.id;
  const send = async ({ body, images }) => {
    setSending(true);
    try { await api.post(`${base}/messages`, { body, images }); reload(true); return true; }
    catch (x) { toast.error(x.data?.error === 'closed' ? t('mr.closed', 'This report is closed.') : t('acc.failed', 'Failed.')); return false; }
    finally { setSending(false); }
  };
  const setStatus = async (status) => { try { await api.post(`/admin/reports/${id}/status`, { status }); reload(true); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  // The reporter's own close/reopen. Separate endpoint from the staff one, and narrower:
  // open <-> closed only. Someone who solved their own problem should be able to say so
  // without waiting for staff to clear the thread.
  const mine = r && r.reporterId === user?.id;
  const setOwnStatus = async (status) => { try { await api.post(`/me/reports/${id}/status`, { status }); reload(true); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  // The delete is the LIST's (onDelete): it hides the row, holds the request for the undo
  // window, and only then sends it. The modal closes first so nothing on screen still shows a
  // thread that is on its way out.
  const del = () => { onClose(); onDelete?.(r); };
  return (
    <Modal open onClose={onClose} icon={admin ? Inbox : MessageSquare} width="max-w-2xl"
      title={loading ? t('common.loading', 'Loading…') : (r?.targetLabel || t('mr.general', 'Support request'))}>
      {err && !r ? <p className="text-sm text-[var(--muted)] text-center py-6">{t('mr.gone', 'This conversation no longer exists. It may have been deleted.')}</p>
        : loading || !r ? <Loading /> : <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted)]">
          <Badge tone={REPORT_STATUS_TONE[r.status]}>{r.status}</Badge>
          <span>{t('mr.on', 'on {t}').replace('{t}', r.targetType)}{r.reason ? ` · ${r.reason}` : ''}</span>
          {/* Full report subject: the reported entity's id (repo id / catalog slug / user id) + when. */}
          {admin && r.targetId && <button onClick={() => { navigator.clipboard?.writeText(r.targetId); toast.success(t('ccp.copied', 'Copied.')); }} className="font-mono hover:text-[var(--accent-ink)] inline-flex items-center gap-1" title={t('ar.targetid', 'Reported {t} id, click to copy').replace('{t}', r.targetType)}><Fingerprint size={11} /> {r.targetId} <Copy size={9} /></button>}
          {admin && <span className="flex items-center gap-1"><Calendar size={11} /> {new Date(r.createdAt).toLocaleString()}</span>}
          {admin && r.reporter && <span className="flex items-center gap-1"><Users size={12} /> {r.reporter} · {r.reporterEmail} {r.reporterBcId && <button onClick={() => { navigator.clipboard?.writeText(r.reporterBcId); toast.success(t('prof.bcidcopied', 'BC id copied.')); }} className="font-mono hover:text-[var(--accent-ink)] inline-flex items-center gap-1"><Fingerprint size={11} /> {r.reporterBcId} <Copy size={9} /></button>}</span>}
        </div>
        {own && <div className="text-xs rounded-lg px-3 py-2 bg-warning-bg border border-warning-border text-warning flex items-center gap-2"><AlertTriangle size={14} /> {t('ar.ownreport', 'You opened this report, reply to it from your dashboard (Reports & contact), not as staff here.')}</div>}
        {admin && !own && <div className="flex flex-wrap gap-2">
          {r.status !== 'open' && <Button size="sm" variant="ghost" onClick={() => setStatus('open')}><RotateCcw size={13} /> {t('ar.reopen', 'Reopen')}</Button>}
          {r.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => setStatus('archived')}><Archive size={13} /> {t('ar.archive', 'Archive')}</Button>}
          {r.status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => setStatus('closed')}><CheckCircle2 size={13} /> {t('ar.close', 'Close')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setPeople((v) => !v)}><Users size={13} /> {t('ar.people', 'People')}{r.participants?.length ? ` (${r.participants.length})` : ''}</Button>
          <Button size="sm" variant="ghost" className="!text-error" onClick={del}><Trash2 size={13} /> {t('common.delete', 'Delete')}</Button>
        </div>}
        {admin && !own && people && <ReportPeoplePanel report={r} onChange={reload} />}
        {/* The reporter's own controls — shown in the user view, and also to a staff member
            looking at a report they opened themselves (where the staff bar is hidden). */}
        {mine && !admin && <div className="flex flex-wrap gap-2">
          {r.status === 'closed'
            ? <Button size="sm" variant="ghost" onClick={() => setOwnStatus('open')}><RefreshCw size={13} /> {t('mr.reopen', 'Reopen my report')}</Button>
            : <Button size="sm" variant="ghost" onClick={() => setOwnStatus('closed')}><CheckCircle2 size={13} /> {t('mr.close', 'Close my report')}</Button>}
        </div>}
        <div className="max-h-[45vh] overflow-y-auto pe-1"><ReportThread messages={r.messages} /></div>
        {own ? null
          : r.status === 'closed' && !admin ? <p className="text-sm text-[var(--faint)] text-center py-2">{t('mr.closednote', 'This report is closed, reopen it above if you still need help.')}</p>
          : <ReportComposer onSend={send} sending={sending} placeholder={admin ? t('ar.reply', 'Reply as staff…') : t('rp.msgph', 'Write a message…')} />}
      </div>}
    </Modal>
  );
}

// Admin: manage who's in a report thread — add participants (by id/email/BC id, as staff or
// invited) and mint invite links (usage cap + optional lock to an account / email / creator id).
export function ReportPeoplePanel({ report, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const [who, setWho] = useState(''); const [role, setRole] = useState('invited');
  const [inv, setInv] = useState({ maxUses: 1, targetType: 'any', targetValue: '', expiresInDays: '' });
  const add = async () => {
    if (!who.trim()) return;
    try { const rr = await api.post(`/admin/reports/${report.id}/participants`, { who: who.trim(), role }); toast.success(t('rpp.added', 'Added {n}.').replace('{n}', rr.name || who)); setWho(''); onChange(); }
    catch (x) { toast.error(x.data?.error === 'no_such_user' ? t('rpp.nouser', 'No user with that id/email/BC id.') : x.data?.error === 'already_reporter' ? t('rpp.isreporter', 'That’s the reporter.') : t('acc.failed', 'Failed.')); }
  };
  const rmPart = async (p2) => { try { await api.del(`/admin/reports/${report.id}/participants/${p2.userId}`); onChange(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  const mkInvite = async () => {
    try {
      const body = { maxUses: Number(inv.maxUses) || 0, targetType: inv.targetType, targetValue: inv.targetValue.trim() };
      if (inv.expiresInDays) body.expiresInDays = Number(inv.expiresInDays);
      const rr = await api.post(`/admin/reports/${report.id}/invites`, body);
      navigator.clipboard?.writeText(rr.invite.url); toast.success(t('rpp.invcopied', 'Invite link copied.')); onChange();
    } catch (x) { toast.error(x.data?.error === 'target_value_required' ? t('rpp.needtarget', 'Fill the target (account/email/creator id).') : t('acc.failed', 'Failed.')); }
  };
  const rmInvite = async (iv) => { try { await api.del(`/admin/reports/${report.id}/invites/${iv.id}`); onChange(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-3 panel">
      {/* Participants */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1.5">{t('rpp.participants', 'Participants')}</div>
        {report.participants?.length > 0 && <div className="space-y-1 mb-2">
          {report.participants.map((p2) => (
            <div key={p2.userId} className="flex items-center gap-2 text-sm">
              <Badge tone={p2.role === 'staff' ? 'amber' : ''}>{p2.role}</Badge>
              <span className="flex-1 min-w-0 truncate">{p2.name} <span className="text-[var(--faint)] text-xs">· {p2.email}</span></span>
              <button onClick={() => rmPart(p2)} className="text-[var(--faint)] hover:text-error"><X size={13} /></button>
            </div>
          ))}
        </div>}
        <div className="flex flex-wrap items-end gap-2">
          <Input className="flex-1 min-w-[160px]" placeholder={t('rpp.who', 'User id, email or BC id')} value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Select className="!w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="invited">{t('rpp.invited', 'Invited user')}</option><option value="staff">{t('rpp.staff', 'Staff')}</option></Select>
          <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('rpp.add', 'Add')}</Button>
        </div>
      </div>
      {/* Invite links */}
      <div className="pt-2 border-t border-[var(--line)]">
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1.5">{t('rpp.invites', 'Invite links')}</div>
        {report.invites?.length > 0 && <div className="space-y-1 mb-2">
          {report.invites.map((iv) => (
            <div key={iv.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate font-mono" title={iv.url}>{iv.url}</span>
              <span className="text-[var(--faint)] shrink-0">{iv.maxUses === 0 ? '∞' : `${iv.uses}/${iv.maxUses}`}{iv.targetType !== 'any' ? ` · ${iv.targetType}` : ''}</span>
              <button onClick={() => { navigator.clipboard?.writeText(iv.url); toast.success(t('ccp.copied', 'Copied.')); }} className="text-[var(--faint)] hover:text-[var(--accent-ink)]"><Copy size={12} /></button>
              <button onClick={() => rmInvite(iv)} className="text-[var(--faint)] hover:text-error"><X size={12} /></button>
            </div>
          ))}
        </div>}
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[var(--muted)]">{t('rpp.maxuses', 'Max uses (0 = unlimited)')}<Input type="number" min="0" value={inv.maxUses} onChange={(e) => setInv({ ...inv, maxUses: e.target.value })} /></label>
          <label className="text-xs text-[var(--muted)]">{t('rpp.expires', 'Expires in days (blank = never)')}<Input type="number" min="1" value={inv.expiresInDays} onChange={(e) => setInv({ ...inv, expiresInDays: e.target.value })} /></label>
          <label className="text-xs text-[var(--muted)]">{t('rpp.lockto', 'Lock to')}<Select value={inv.targetType} onChange={(e) => setInv({ ...inv, targetType: e.target.value })}><option value="any">{t('rpp.anyone', 'Anyone with the link')}</option><option value="user">{t('rpp.anuser', 'A specific account (id)')}</option><option value="email">{t('rpp.anemail', 'An email')}</option><option value="creator">{t('rpp.acreator', 'A BMM creator id')}</option></Select></label>
          {inv.targetType !== 'any' && <label className="text-xs text-[var(--muted)]">{t('rpp.target', 'Target value')}<Input value={inv.targetValue} onChange={(e) => setInv({ ...inv, targetValue: e.target.value })} placeholder={inv.targetType === 'email' ? 'user@example.com' : inv.targetType === 'user' ? 'account id' : 'creator id'} /></label>}
        </div>
        <div className="mt-2"><Button size="sm" variant="default" onClick={mkInvite}><Link2 size={13} /> {t('rpp.mkinvite', 'Create invite link')}</Button></div>
      </div>
    </div>
  );
}
