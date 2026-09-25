// prerelease (agent-prerelease): the admin side of early access and of project reviews.
//
//   AdminPrereleases      Projects > Early access. Every pre-release the viewer may manage (the
//                         server scopes the list: a manager sees their kind of project, a page
//                         grantee their projects), a form to open and edit one, its sign-ups,
//                         the selection (with a preview that IS the run for a draw), the CSV
//                         export and the close.
//   AdminProjectReviews   Writing & notices > Project reviews. The moderation queue for every
//                         project's reviews, the landing review's rules (approve what you read).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FlaskConical, Plus, Save, Eye, Play, Download, Lock, Trash2, Upload, Users, CheckCircle2, XCircle, Star, MessageSquare, ExternalLink, Shuffle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, EmptyState, Spinner, Modal, useToast, useDialog, formatBytes } from '../ui/ui.jsx';
import { PhaseBadge, prText } from '../ui/prerelease-bits.jsx';

const MODES = ['manual', 'draw', 'first', 'all'];
const toLocal = (d) => { if (!d) return ''; const x = new Date(d); const z = new Date(x.getTime() - x.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function useModeLabel() {
  const { t } = useI18n();
  return (m) => ({ manual: t('apr.mode.manual', 'Hand-picked'), draw: t('apr.mode.draw', 'Random draw'), first: t('apr.mode.first', 'First come'), all: t('apr.mode.all', 'Everyone who signs up') })[m] || m;
}

/** The fields of a pre-release, as a form. `value` is the editable copy. */
function PrereleaseForm({ value, onChange }) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('apr.f.title', 'Title')}><Input value={value.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label={t('apr.f.titleFr', 'Title (French)')}><Input value={value.titleFr} maxLength={120} onChange={(e) => set('titleFr', e.target.value)} /></Field>
      <Field label={t('apr.f.pitch', 'Short pitch')}><Input value={value.pitch} maxLength={300} onChange={(e) => set('pitch', e.target.value)} /></Field>
      <Field label={t('apr.f.pitchFr', 'Short pitch (French)')}><Input value={value.pitchFr} maxLength={300} onChange={(e) => set('pitchFr', e.target.value)} /></Field>
      <Field label={t('apr.f.body', 'Details (B.MD)')}><Textarea rows={4} value={value.body} onChange={(e) => set('body', e.target.value)} /></Field>
      <Field label={t('apr.f.bodyFr', 'Details (French)')}><Textarea rows={4} value={value.bodyFr} onChange={(e) => set('bodyFr', e.target.value)} /></Field>
      <Field label={t('apr.f.version', 'Version')}><Input value={value.version} maxLength={40} onChange={(e) => set('version', e.target.value)} placeholder="2.0.0-beta.1" /></Field>
      <Field label={t('apr.f.mode', 'How members are chosen')}>
        <Select value={value.mode} onChange={(e) => set('mode', e.target.value)} disabled={value._modeLocked}>
          {MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
        </Select>
      </Field>
      <Field label={t('apr.f.opens', 'Sign-ups open')}><Input type="datetime-local" value={value.opensAt} onChange={(e) => set('opensAt', e.target.value)} /></Field>
      <Field label={t('apr.f.closes', 'Sign-ups close')}><Input type="datetime-local" value={value.closesAt} onChange={(e) => set('closesAt', e.target.value)} /></Field>
      <Field label={t('apr.f.capacity', 'Most sign-ups accepted (empty: no cap)')}><Input type="number" min={1} value={value.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
      <Field label={t('apr.f.count', 'How many a draw or first-come round selects')}><Input type="number" min={1} value={value.selectCount} onChange={(e) => set('selectCount', e.target.value)} /></Field>
      <Field label={t('apr.f.url', 'External download (https, optional)')}><Input value={value.downloadUrl} onChange={(e) => set('downloadUrl', e.target.value)} placeholder="https://" /></Field>
      <div className="flex flex-col gap-2 justify-end text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={value.published} onChange={(e) => set('published', e.target.checked)} /> {t('apr.f.published', 'Published (visible on the site)')}</label>
        <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={value.notifyNotSelected} onChange={(e) => set('notifyNotSelected', e.target.checked)} /> {t('apr.f.notify', 'Tell the members who are not selected')}</label>
      </div>
    </div>
  );
}

const draftOf = (pr) => ({
  title: pr?.title || '', titleFr: pr?.titleFr || '', pitch: pr?.pitch || '', pitchFr: pr?.pitchFr || '', body: pr?.body || '', bodyFr: pr?.bodyFr || '',
  version: pr?.version || '', mode: pr?.mode || 'manual', opensAt: toLocal(pr?.opensAt), closesAt: toLocal(pr?.closesAt),
  capacity: pr?.capacity ?? '', selectCount: pr?.selectCount ?? '', downloadUrl: pr?.downloadUrl || '', published: !!pr?.published,
  notifyNotSelected: !!pr?.notifyNotSelected, _modeLocked: (pr?.rounds || []).length > 0,
});
const bodyOf = (d) => ({
  title: d.title.trim(), titleFr: d.titleFr.trim(), pitch: d.pitch.trim(), pitchFr: d.pitchFr.trim(), body: d.body, bodyFr: d.bodyFr,
  version: d.version.trim(), mode: d.mode, opensAt: fromLocal(d.opensAt), closesAt: fromLocal(d.closesAt),
  capacity: d.capacity === '' ? null : Number(d.capacity), selectCount: d.selectCount === '' ? null : Number(d.selectCount),
  downloadUrl: d.downloadUrl.trim() || null, published: d.published, notifyNotSelected: d.notifyNotSelected,
});

export function AdminPrereleases() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const list = useAsync(() => api.get('/prerelease-manage'), []);
  const projects = useAsync(() => api.get('/contact/projects').catch(() => ({ projects: [] })), []);
  const [creating, setCreating] = useState(null); // { ref, draft }
  const [openId, setOpenId] = useState(null);
  const errText = (code) => ({
    closes_before_opens: t('apr.err.window', 'The sign-ups must close after they open.'), forbidden: t('apr.err.forbidden', 'You cannot manage this project.'),
    limit: t('apr.err.limit', 'This project has too many pre-releases.'), invalid_input: t('apr.err.input', 'Check the fields: a title of at least two characters, an https download.'),
  })[code] || t('common.failed', 'Failed.');
  const create = async () => {
    try {
      const r = await api.post(`/projects-prereleases/${encodeURIComponent(creating.ref)}`, bodyOf(creating.draft));
      toast.success(t('apr.created', 'Pre-release created.'));
      setCreating(null); list.reload(); setOpenId(r.prerelease.id);
    } catch (x) { toast.error(errText(x.data?.error)); }
  };
  const rows = list.data?.prereleases || [];
  return (
    <div data-testid="admin-prereleases">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><FlaskConical size={16} /> {t('apr.title', 'Early access')}</h2>
        <Button size="sm" variant="primary" className="ms-auto" onClick={() => setCreating({ ref: projects.data?.projects?.[0]?.ref || '', draft: draftOf(null) })}><Plus size={14} /> {t('apr.new', 'New pre-release')}</Button>
      </div>
      {list.loading && !list.data ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : !rows.length ? <EmptyState icon={FlaskConical} title={t('apr.none', 'No pre-release yet')} sub={t('apr.none.s', 'Open one to let members sign up for a version before it is out.')} />
        : (
          <div className="space-y-2">
            {rows.map((pr) => (
              <Card key={pr.id} className="p-3" data-admin-prerelease={pr.slug}>
                <div className="flex items-center gap-2 flex-wrap">
                  <PhaseBadge phase={pr.phase} />
                  <button type="button" className="font-medium hover:underline text-start break-words" onClick={() => setOpenId(openId === pr.id ? null : pr.id)}>{prText(pr, lang, 'title')}</button>
                  <span className="text-xs text-[var(--muted)]">{pr.project?.name}</span>
                  <span className="ms-auto text-xs text-[var(--muted)] inline-flex items-center gap-1"><Users size={12} /> {(pr.counts?.pending || 0) + (pr.counts?.selected || 0) + (pr.counts?.not_selected || 0)} · {t('apr.selected', '{n} selected').replace('{n}', String(pr.counts?.selected || 0))}</span>
                  <Link to={`/prereleases/${pr.slug}`} title={t('apr.view', 'See the public page')} aria-label={t('apr.view', 'See the public page')}><ExternalLink size={14} /></Link>
                </div>
                {openId === pr.id && <PrereleaseDetail id={pr.id} onChanged={() => list.reload()} onGone={() => { setOpenId(null); list.reload(); }} />}
              </Card>
            ))}
          </div>
        )}
      <Modal open={!!creating} onClose={() => setCreating(null)} title={t('apr.new', 'New pre-release')} icon={FlaskConical} width="max-w-3xl"
        footer={<><Button variant="ghost" onClick={() => setCreating(null)}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={!creating?.ref || (creating?.draft.title.trim().length || 0) < 2} onClick={create}><Plus size={14} /> {t('apr.create', 'Create')}</Button></>}>
        {creating && (
          <div className="space-y-3">
            <Field label={t('apr.f.project', 'Project')}>
              <Select value={creating.ref} onChange={(e) => setCreating({ ...creating, ref: e.target.value })}>
                {(projects.data?.projects || []).map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
              </Select>
            </Field>
            <PrereleaseForm value={creating.draft} onChange={(d) => setCreating({ ...creating, draft: d })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrereleaseDetail({ id, onChanged, onGone }) {
  const { t, lang } = useI18n();
  const toast = useToast(); const dialog = useDialog();
  const modeLabel = useModeLabel();
  const d = useAsync(() => api.get(`/prerelease-manage/${id}`), [id]);
  const pr = d.data?.prerelease;
  const [draft, setDraft] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [sel, setSel] = useState({ mode: 'manual', count: '', notifyOthers: false });
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { if (pr) { setDraft(draftOf(pr)); setSel({ mode: pr.mode, count: pr.selectCount ?? '', notifyOthers: !!pr.notifyNotSelected }); setPreview(null); } }, [pr?.updatedAt, pr?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const signups = d.data?.signups || [];
  const pending = useMemo(() => signups.filter((s) => s.status === 'pending'), [signups]);
  if (d.loading && !d.data) return <div className="flex items-center gap-2 text-[var(--muted)] py-4"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (!pr || !draft) return null;
  const reload = () => { d.reload(); onChanged?.(); };

  const save = async () => {
    try { await api.patch(`/prerelease-manage/${id}`, bodyOf(draft)); toast.success(t('apr.saved', 'Saved.')); reload(); }
    catch (x) { toast.error(x.data?.error === 'mode_locked' ? t('apr.err.mode', 'The mode cannot change after a selection.') : x.data?.error === 'closes_before_opens' ? t('apr.err.window', 'The sign-ups must close after they open.') : t('common.failed', 'Failed.')); }
  };
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const contentType = file.type || 'application/octet-stream';
      const p = await api.post(`/prerelease-manage/${id}/file`, { filename: file.name, contentType, size: file.size });
      const put = await fetch(p.url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      if (!put.ok) throw new Error('upload_failed');
      await api.patch(`/prerelease-manage/${id}`, { downloadKey: p.key, downloadName: file.name, downloadSize: file.size });
      toast.success(t('apr.uploaded', 'File uploaded. Only selected members can download it.'));
      reload();
    } catch { toast.error(t('apr.err.upload', 'The upload failed.')); }
    finally { setUploading(false); }
  };
  const selBody = () => ({ mode: sel.mode, ...(sel.count !== '' ? { count: Number(sel.count) } : {}), ...(sel.mode === 'manual' ? { signupIds: [...picked] } : {}), notifyOthers: sel.notifyOthers });
  const doPreview = async () => {
    try { setPreview(await api.post(`/prerelease-manage/${id}/selection/preview`, selBody())); }
    catch (x) { toast.error(({ invalid_count: t('apr.err.count', 'Say how many to select.'), nobody_picked: t('apr.err.pick', 'Tick at least one sign-up.') })[x.data?.error] || t('common.failed', 'Failed.')); }
  };
  const run = async () => {
    if (!(await dialog.confirm({ title: t('apr.run.t', 'Run the selection?'), message: t('apr.run.m', 'The selected members are told by mail at once, and sign-ups close. This cannot be undone.'), okLabel: t('apr.run', 'Select') }))) return;
    try {
      const r = await api.post(`/prerelease-manage/${id}/selection`, { ...selBody(), ...(preview?.entrantsHash && sel.mode === 'draw' ? { entrantsHash: preview.entrantsHash } : {}) });
      toast.success(t('apr.run.done', '{n} selected.').replace('{n}', String(r.selected)));
      setPicked(new Set()); reload();
    } catch (x) { toast.error(x.data?.error === 'entrants_changed' ? t('apr.err.changed', 'Somebody signed up since the preview. Preview again.') : t('common.failed', 'Failed.')); }
  };
  const close = async () => {
    if (!(await dialog.confirm({ title: t('apr.close.t', 'End this pre-release?'), message: t('apr.close.m', 'No more sign-ups and no more downloads, for anybody.'), okLabel: t('apr.close', 'End'), danger: true }))) return;
    try { await api.post(`/prerelease-manage/${id}/close`); toast.success(t('apr.closed', 'Ended.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const remove = async () => {
    if (!(await dialog.confirm({ title: t('apr.del.t', 'Delete this pre-release?'), message: t('apr.del.m', 'Its sign-ups and its file go with it.'), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    // undo: a deletion that takes a file out of storage is confirmed in a dialog instead
    try { await api.del(`/prerelease-manage/${id}`); onGone?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const togglePick = (sid) => setPicked((s) => { const n = new Set(s); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const stTone = { selected: 'green', not_selected: '', pending: 'blue' };
  const stLabel = { selected: t('apr.st.selected', 'Selected'), not_selected: t('apr.st.not', 'Not selected'), pending: t('apr.st.pending', 'Waiting') };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--line)] space-y-4" data-testid="admin-prerelease-detail">
      <PrereleaseForm value={draft} onChange={setDraft} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={save}><Save size={14} /> {t('common.save', 'Save')}</Button>
        <label className={`btn btn-sm ${uploading ? 'opacity-60 pointer-events-none' : ''} cursor-pointer inline-flex items-center gap-1.5`}>
          {uploading ? <Spinner /> : <Upload size={14} />} {pr.downloadKey ? t('apr.file.replace', 'Replace the file') : t('apr.file.upload', 'Upload the file')}
          <input type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {pr.downloadName && <span className="text-xs text-[var(--muted)]">{pr.downloadName}{pr.downloadSize ? ` (${formatBytes(pr.downloadSize)})` : ''}</span>}
        <a href={`/api/prerelease-manage/${id}/export.csv`} className="ms-auto"><Button size="sm" variant="ghost"><Download size={14} /> {t('apr.export', 'Export the list')}</Button></a>
        {!pr.closedAt && <Button size="sm" variant="ghost" onClick={close}><Lock size={14} /> {t('apr.close', 'End')}</Button>}
        <Button size="sm" variant="ghost" className="!text-error" onClick={remove}><Trash2 size={14} /> {t('common.delete', 'Delete')}</Button>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Users size={14} /> {t('apr.signups', 'Sign-ups')} <span className="text-[var(--muted)] font-normal">{signups.length}</span></h3>
        {!signups.length ? <p className="text-sm text-[var(--muted)]">{t('apr.signups.none', 'Nobody has signed up yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-prerelease-signups">
              <thead><tr className="text-start text-xs text-[var(--muted)]"><th className="p-1.5 w-8" /><th className="p-1.5 text-start">{t('apr.col.member', 'Member')}</th><th className="p-1.5 text-start">{t('apr.col.status', 'Status')}</th><th className="p-1.5 text-start">{t('apr.col.when', 'Signed up')}</th><th className="p-1.5 text-start">{t('apr.col.msg', 'Message')}</th></tr></thead>
              <tbody>
                {signups.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)]" data-signup={s.id}>
                    <td className="p-1.5">{s.status === 'pending' && sel.mode === 'manual' && <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePick(s.id)} aria-label={t('apr.pick', 'Pick {name}').replace('{name}', s.name)} />}</td>
                    <td className="p-1.5"><Link to={`/u/${s.userId}`} className="hover:underline">{s.name || s.userId}</Link></td>
                    <td className="p-1.5"><Badge tone={stTone[s.status]}>{stLabel[s.status] || s.status}</Badge></td>
                    <td className="p-1.5 text-xs text-[var(--muted)] whitespace-nowrap">{new Date(s.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</td>
                    <td className="p-1.5 text-xs break-words">{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!pr.closedAt && pr.published && (
        <Card className="p-4" data-testid="admin-prerelease-selection">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Shuffle size={14} /> {t('apr.selection', 'Selection')} <span className="text-[var(--muted)] font-normal">{t('apr.pending', '{n} waiting').replace('{n}', String(pending.length))}</span></h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('apr.f.mode', 'How members are chosen')}>
              <Select value={sel.mode} onChange={(e) => { setSel({ ...sel, mode: e.target.value }); setPreview(null); }}>
                {MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
              </Select>
            </Field>
            {(sel.mode === 'draw' || sel.mode === 'first') && (
              <Field label={t('apr.count', 'How many')}><Input type="number" min={1} value={sel.count} onChange={(e) => { setSel({ ...sel, count: e.target.value }); setPreview(null); }} /></Field>
            )}
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer pb-2"><input type="checkbox" checked={sel.notifyOthers} onChange={(e) => setSel({ ...sel, notifyOthers: e.target.checked })} /> {t('apr.notifyOthers', 'Tell the others they were not selected')}</label>
            <Button size="sm" onClick={doPreview} data-testid="admin-prerelease-preview"><Eye size={14} /> {t('apr.preview', 'Preview')}</Button>
            <Button size="sm" variant="primary" disabled={sel.mode === 'draw' && !preview} onClick={run} data-testid="admin-prerelease-run"><Play size={14} /> {t('apr.run', 'Select')}</Button>
          </div>
          {sel.mode === 'draw' && <p className="text-xs text-[var(--faint)] mt-2">{t('apr.draw.note', 'The draw uses the number committed when this pre-release was created: the preview is exactly what the draw will pick, and anybody can check it afterwards.')}</p>}
          {preview && (
            <div className="mt-3 text-sm" data-testid="admin-prerelease-preview-result">
              <div className="text-xs text-[var(--muted)]">{t('apr.preview.r', 'Round {r}: {w} of {e}').replace('{r}', String(preview.round)).replace('{w}', String(preview.winners.length)).replace('{e}', String(preview.entrants))}</div>
              <ul className="mt-1 flex flex-wrap gap-1.5">{preview.winners.map((w) => <li key={w.id}><Badge tone="green"><CheckCircle2 size={11} /> {w.name || w.id}</Badge></li>)}</ul>
            </div>
          )}
          {(pr.rounds || []).length > 0 && (
            <ul className="mt-3 text-xs text-[var(--muted)] space-y-0.5">
              {pr.rounds.map((r) => <li key={r.round}>{t('apr.round', 'Round {r} ({mode}): {w} of {e}').replace('{r}', String(r.round)).replace('{mode}', modeLabel(r.mode)).replace('{w}', String(r.selected)).replace('{e}', String(r.entrants))}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export function AdminProjectReviews() {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const q = useAsync(() => api.get(`/admin/project-reviews${status ? `?status=${status}` : ''}`), [status]);
  const [gone, setGone] = useState(() => new Set());
  const rows = (q.data?.reviews || []).filter((r) => !gone.has(r.id));
  const decide = async (r, st) => {
    try { await api.patch(`/admin/project-reviews/${r.id}`, { status: st, seenUpdatedAt: r.updatedAt }); toast.success(st === 'approved' ? t('aprv.approved', 'Approved: shown on the project.') : t('aprv.rejected', 'Rejected.')); q.reload(); }
    catch (x) { toast.error(x.data?.error === 'changed_since_viewed' ? t('aprv.changed', 'The member edited it since you opened the list. Read it again.') : t('common.failed', 'Failed.')); q.reload(); }
  };
  const remove = (r) => {
    setGone((s) => new Set(s).add(r.id));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg: t('aprv.deleted', 'Review deleted.'),
      onCommit: async () => { try { await api.del(`/admin/project-reviews/${r.id}`); q.reload(); } catch { toast.error(t('common.failed', 'Failed.')); } },
      onCancel: () => setGone((s) => { const n = new Set(s); n.delete(r.id); return n; }),
    });
  };
  return (
    <div data-testid="admin-project-reviews">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><MessageSquare size={16} /> {t('aprv.title', 'Project reviews')}</h2>
        {q.data?.pending > 0 && <Badge tone="amber">{t('aprv.pending', '{n} waiting').replace('{n}', String(q.data.pending))}</Badge>}
        <Select className="!w-auto ms-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('aprv.filter', 'Status')}>
          <option value="pending">{t('prv.st.pending', 'Waiting for a moderator')}</option>
          <option value="approved">{t('prv.st.approved', 'Approved')}</option>
          <option value="rejected">{t('prv.st.rejected', 'Rejected')}</option>
          <option value="">{t('aprv.all', 'All')}</option>
        </Select>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">
        {t('aprv.on', 'Projects taking reviews: {list}').replace('{list}', (q.data?.enabledProjects || []).map((p) => p.name).join(', ') || t('aprv.on.none', 'none (a project manager switches them on from the project page, Reviews tab)'))}
      </p>
      {q.loading && !q.data ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : !rows.length ? <EmptyState icon={CheckCircle2} title={t('aprv.empty', 'Nothing to moderate')} sub={t('aprv.empty.s', 'Reviews of the projects land here before they are shown.')} />
        : (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.id} className="p-4" data-project-review={r.id}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-medium">{r.author}</span>
                  {r.anonymous && <Badge>{t('aprv.anon', 'Asked to be anonymous')}</Badge>}
                  {r.visibility === 'private' && <Badge tone="blue"><Lock size={10} /> {t('prv.private', 'Private')}</Badge>}
                  {r.rating ? <span className="inline-flex items-center gap-0.5 text-warning"><Star size={12} fill="currentColor" /> {r.rating}</span> : null}
                  {r.project && <Link to={r.project.url} className="text-xs text-[var(--accent-ink)] hover:underline">{r.project.name}</Link>}
                  <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'} className="ms-auto">{r.status}</Badge>
                </div>
                <p className="text-sm mt-2 whitespace-pre-line break-words">{r.body}</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {r.status !== 'approved' && r.visibility !== 'private' && <Button size="sm" variant="primary" onClick={() => decide(r, 'approved')}><CheckCircle2 size={13} /> {t('mod.approve', 'Approve')}</Button>}
                  {r.status !== 'rejected' && <Button size="sm" onClick={() => decide(r, 'rejected')}><XCircle size={13} /> {t('mod.reject', 'Reject')}</Button>}
                  <Button size="sm" variant="ghost" className="!text-error" onClick={() => remove(r)}><Trash2 size={13} /> {t('common.delete', 'Delete')}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
