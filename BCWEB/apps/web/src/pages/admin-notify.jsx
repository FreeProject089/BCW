// notify (agent-notify): two admin screens under "Writing & notices".
//
//   AdminNotify      Send a notification: to named accounts, a role, everyone, or the followers
//                    of a project. Preview (who it reaches after mutes, the exact text each
//                    language gets), a same-content guard, the recent sends, and the setting
//                    that makes a new blog post reach its project's followers.
//   AdminBmmLaunch   What BMM shows in its start-up modal (GET /api/bmm/launch): nothing, a
//                    chosen blog post, the newest BMM post, or a custom card; how often; for
//                    which versions; from when to when. The preview is the server's own answer
//                    for the card, drawn the way the app draws it.
import { useMemo, useState } from 'react';
import { Send, Eye, Rss, Rocket, Plus, Trash2, Pencil, Save, AlertTriangle, History, Bell, ExternalLink, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync, Loading, useUndoableDelete } from './pages.jsx';
import { Card, Button, Badge, Input, Textarea, Select, Field, EmptyState, Explain, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { PeoplePicker } from './admin-people-picker.jsx';

const toLocal = (d) => { if (!d) return ''; const x = new Date(d); const z = new Date(x.getTime() - x.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
const fmt = (d, lang) => (d ? new Date(d).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const EMPTY = { target: 'all', users: [], role: 'USER', project: '', kind: 'announce', title: '', titleFr: '', body: '', bodyFr: '', href: '', priority: 0, expiresAt: '', public: false };

function useErrText() {
  const { t } = useI18n();
  return (e) => ({
    bad_link: t('ntf.err.link', 'The link must be a path on this site, like /blog/my-post.'),
    no_recipients: t('ntf.err.users', 'Pick at least one account.'),
    notice_needs_users: t('ntf.err.notice', 'An account notice can only go to named accounts.'),
    public_needs_all: t('ntf.err.public', 'Only a message to everyone can be listed in the public feed.'),
    unknown_project: t('ntf.err.project', 'That project does not exist.'),
    project_required: t('ntf.err.project', 'That project does not exist.'),
    invalid_input: t('ntf.err.input', 'Check the fields: a title of at least 2 characters is required.'),
  })[e] || t('common.failed', 'Failed.');
}

export function AdminNotify() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const errText = useErrText();
  const meta = useAsync(() => api.get('/admin/notify/meta'), []);
  const hist = useAsync(() => api.get('/admin/notify/history'), []);
  const [f, setF] = useState(EMPTY);
  const [reqId, setReqId] = useState(newRequestId);
  const [pv, setPv] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPv(null); };

  const payload = () => ({
    target: f.target, kind: f.target === 'users' ? f.kind : 'announce',
    ...(f.target === 'users' ? { userIds: f.users.map((u) => u.id) } : {}),
    ...(f.target === 'role' ? { role: f.role } : {}),
    ...(f.target === 'project' ? { project: f.project } : {}),
    title: f.title, titleFr: f.titleFr || null, body: f.body, bodyFr: f.bodyFr || null,
    href: f.href.trim() || null, priority: Number(f.priority) || 0,
    expiresAt: fromLocal(f.expiresAt), public: f.target === 'all' && f.public,
  });

  const preview = async () => {
    setBusy(true);
    try { setPv(await api.post('/admin/notify/preview', payload())); }
    catch (x) { toast.error(errText(x?.data?.error)); }
    finally { setBusy(false); }
  };

  const send = async (force = false) => {
    let p = pv;
    if (!p) { try { p = await api.post('/admin/notify/preview', payload()); setPv(p); } catch (x) { toast.error(errText(x?.data?.error)); return; } }
    if (!force && !(await dialog.confirm({
      title: t('ntf.confirm.t', 'Send this notification?'),
      message: t('ntf.confirm.m', 'It reaches {n} account(s) now ({m} muted this kind). A notification cannot be recalled.').replace('{n}', String(p.recipients)).replace('{m}', String(p.muted)),
      okLabel: t('ntf.send', 'Send'),
    }))) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/notify/send', { ...payload(), requestId: reqId, force });
      toast.success(t('ntf.sent', 'Sent to {n} account(s).').replace('{n}', String(r.delivered)));
      setF(EMPTY); setPv(null); setReqId(newRequestId()); hist.reload();
    } catch (x) {
      if (x?.data?.error === 'duplicate_content') {
        setBusy(false);
        if (await dialog.confirm({
          title: t('ntf.dup.t', 'This exact message already went out'),
          message: t('ntf.dup.m', 'The same text was sent to the same audience on {d}. Send it again anyway?').replace('{d}', fmt(x.data.at, lang)),
          okLabel: t('ntf.dup.ok', 'Send again'), danger: true,
        })) await send(true);
        return;
      }
      toast.error(errText(x?.data?.error));
    } finally { setBusy(false); }
  };

  const setBlogFollowers = async (v) => {
    try { await api.put('/admin/notify/config', { blogFollowers: v }); meta.reload(); toast.success(v ? t('ntf.cfg.on', 'New posts now reach their project’s followers.') : t('ntf.cfg.off', 'New posts no longer notify followers.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const m = meta.data;
  const projects = m?.projects || [];
  const targetLabel = { users: t('ntf.t.users', 'Named accounts'), all: t('ntf.t.all', 'Everyone'), role: t('ntf.t.role', 'A role'), project: t('ntf.t.project', 'A project’s followers') };
  const roleLabel = { USER: t('ntf.r.user', 'Members'), MOD: t('ntf.r.mod', 'Moderators'), ADMIN: t('ntf.r.admin', 'Admins'), SUPERADMIN: t('ntf.r.super', 'Super-admins'), STAFF: t('ntf.r.staff', 'All staff') };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Send size={16} className="text-[var(--accent-ink)]" /> {t('ntf.h', 'Send a notification')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('ntf.sub', 'Lands in the bell, the notification centre, the BMM app and the personal RSS feeds. Muted categories are respected.')}</p>
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('ntf.to', 'To')}>
            {['all', 'role', 'project', 'users'].map((k) => (
              <Button key={k} size="sm" variant={f.target === k ? 'primary' : 'ghost'} role="tab" aria-selected={f.target === k} onClick={() => set('target', k)}>{targetLabel[k]}</Button>
            ))}
          </div>
          {f.target === 'users' && (
            <div className="grid sm:grid-cols-[1fr_auto] gap-3">
              <Field label={t('ntf.users', 'Accounts')}><PeoplePicker value={f.users} onChange={(v) => set('users', v)} source="accounts" max={200} placeholder={t('ntf.users.ph', 'Search a name, an e-mail, an id')} /></Field>
              <Field label={t('ntf.kind', 'Kind')}>
                <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
                  <option value="announce">{t('ntf.kind.news', 'News (can be muted)')}</option>
                  <option value="admin_notice">{t('ntf.kind.notice', 'Account notice (always delivered)')}</option>
                </Select>
              </Field>
            </div>
          )}
          {f.target === 'role' && (
            <Field label={t('ntf.role', 'Role')}>
              <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
                {(m?.roles || ['USER', 'MOD', 'ADMIN', 'SUPERADMIN', 'STAFF']).map((r) => <option key={r} value={r}>{roleLabel[r] || r}</option>)}
              </Select>
            </Field>
          )}
          {f.target === 'project' && (
            <Field label={t('ntf.project', 'Project')}>
              <Select value={f.project} onChange={(e) => set('project', e.target.value)}>
                <option value="">{t('ntf.project.pick', 'Choose a project')}</option>
                {projects.map((p) => <option key={p.ref} value={p.ref}>{p.name} ({t('ntf.followers', '{n} follower(s)').replace('{n}', String(p.followers))})</option>)}
              </Select>
            </Field>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('ntf.title', 'Title')}><Input value={f.title} maxLength={160} onChange={(e) => set('title', e.target.value)} placeholder={t('ntf.title.ph', 'Maintenance tonight at 22:00')} /></Field>
            <Field label={t('ntf.title.fr', 'Title in French (optional)')}><Input value={f.titleFr} maxLength={160} onChange={(e) => set('titleFr', e.target.value)} /></Field>
            <Field label={t('ntf.body', 'Text (optional)')}><Textarea value={f.body} maxLength={1000} rows={3} onChange={(e) => set('body', e.target.value)} /></Field>
            <Field label={t('ntf.body.fr', 'Text in French (optional)')}><Textarea value={f.bodyFr} maxLength={1000} rows={3} onChange={(e) => set('bodyFr', e.target.value)} /></Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t('ntf.href', 'Link on this site (optional)')}><Input value={f.href} onChange={(e) => set('href', e.target.value)} placeholder="/blog/my-post" /></Field>
            <Field label={t('ntf.priority', 'Priority')}>
              <Select value={String(f.priority)} onChange={(e) => set('priority', Number(e.target.value))}>
                <option value="0">{t('ntf.p0', 'Normal')}</option><option value="1">{t('ntf.p1', 'High')}</option><option value="2">{t('ntf.p2', 'Urgent')}</option>
              </Select>
            </Field>
            <Field label={t('ntf.expires', 'Disappears on (optional)')}><Input type="datetime-local" value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} /></Field>
          </div>
          {f.target === 'all' && (
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.public} onChange={(e) => set('public', e.target.checked)} /> <Rss size={13} /> {t('ntf.public', 'Also list it in the public news feed (/feeds/news.xml)')}</label>
          )}

          {pv && (
            <div className="rounded-lg border border-[var(--line)] p-3 space-y-2" style={{ background: 'var(--surface-2)' }}>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <Badge tone="primary">{t('ntf.pv.reach', '{n} will receive it').replace('{n}', String(pv.recipients))}</Badge>
                {pv.muted > 0 && <Badge>{t('ntf.pv.muted', '{n} muted this kind').replace('{n}', String(pv.muted))}</Badge>}
                <Badge tone={pv.locked ? 'amber' : ''}>{pv.locked ? t('ntf.pv.locked', 'cannot be muted') : t(`notif.cat.${pv.category}`, (m?.categories || []).find((c) => c.key === pv.category)?.label || pv.category)}</Badge>
              </div>
              {pv.duplicate && <div className="text-[12px] text-warning flex items-center gap-1.5"><AlertTriangle size={13} /> {t('ntf.pv.dup', 'The same message went to the same audience on {d}.').replace('{d}', fmt(pv.duplicate.at, lang))}</div>}
              <div className="rounded-md border border-[var(--line)] p-2.5 flex gap-2.5" style={{ background: 'var(--bg-solid)' }}>
                <Bell size={15} className="text-[var(--accent-ink)] shrink-0 mt-0.5" />
                <div className="min-w-0 text-[13px] space-y-1">
                  <div className="break-words">{pv.text.en}</div>
                  {pv.text.fr && <div className="break-words text-[var(--muted)]"><Badge className="me-1">FR</Badge>{pv.text.fr}</div>}
                  {pv.href && <div className="text-[11px] text-[var(--accent-ink)] font-mono">{pv.href}</div>}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={preview}><Eye size={15} /> {t('ntf.preview', 'Preview')}</Button>
            <Button variant="primary" disabled={busy || f.title.trim().length < 2} onClick={() => send(false)}>{busy ? <Spinner /> : <><Send size={15} /> {t('ntf.send', 'Send')}</>}</Button>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={m?.config?.blogFollowers !== false} disabled={!m} onChange={(e) => setBlogFollowers(e.target.checked)} />
          <span className="flex-1">{t('ntf.cfg.blog', 'A new blog post notifies the followers of its project')}</span>
        </label>
        <Explain className="text-[12px] mt-1">{t('ntf.cfg.blog.s', 'Once per post, when it is first published, and only for a public project. Members follow a project from its page and can mute "Projects you follow" in their notification settings.')}</Explain>
      </Card>

      <div>
        <h2 className="font-semibold mb-2 flex items-center gap-2"><History size={16} className="text-[var(--accent-ink)]" /> {t('ntf.hist', 'Recent sends')}</h2>
        {hist.loading ? <Loading /> : (hist.data?.sends || []).length ? (
          <div className="space-y-2">
            {hist.data.sends.map((s) => (
              <Card key={s.id} className="p-3 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="flex-1 min-w-0 truncate font-medium" title={s.title}>{s.title}</span>
                <Badge>{s.audience}</Badge>
                <Badge tone="primary">{t('ntf.h.deliv', '{n} delivered').replace('{n}', String(s.delivered))}</Badge>
                {s.muted > 0 && <Badge>{t('ntf.pv.muted', '{n} muted this kind').replace('{n}', String(s.muted))}</Badge>}
                {s.public && <Badge tone="green"><Rss size={10} /> RSS</Badge>}
                {s.status !== 'done' && <Badge tone="amber">{s.status}</Badge>}
                <span className="text-[11px] text-[var(--faint)]">{s.createdBy || s.kind} · {fmt(s.createdAt, lang)}</span>
              </Card>
            ))}
          </div>
        ) : <EmptyState icon={Send} title={t('ntf.hist.none', 'Nothing sent yet')} sub={t('ntf.hist.none.s', 'Every notification sent through the engine is listed here, including the automatic ones.')} />}
      </div>
    </div>
  );
}

// ── BMM launch card ─────────────────────────────────────────────────────────────────────

const ITEM_EMPTY = { source: 'latest', postId: '', projectKey: 'bmm', title: '', titleFr: '', summary: '', summaryFr: '', url: '', imageUrl: '', displayMode: 'once', times: 3, startsAt: '', endsAt: '', minVersion: '', maxVersion: '', priority: 0, enabled: true };

const itemPayload = (d) => ({
  source: d.source, postId: d.source === 'post' ? d.postId || null : null, projectKey: d.projectKey || 'bmm',
  title: d.title, titleFr: d.titleFr, summary: d.summary, summaryFr: d.summaryFr, url: d.url.trim(), imageUrl: d.imageUrl.trim(),
  displayMode: d.displayMode, times: Math.max(1, Number(d.times) || 1),
  startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt),
  minVersion: d.minVersion.trim() || null, maxVersion: d.maxVersion.trim() || null,
  priority: Number(d.priority) || 0, enabled: !!d.enabled,
});

/** The card as BMM draws it: picture, title, summary, the link's host, one button. */
export function LaunchCardPreview({ card }) {
  const { t } = useI18n();
  if (!card) return null;
  let host = '';
  try { host = new URL(card.url).host; } catch { /* shown without */ }
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden max-w-sm" style={{ background: 'var(--bg-solid)' }}>
      {card.imageUrl && <img src={card.imageUrl} alt="" className="w-full h-36 object-cover" loading="lazy" />}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--faint)]">
          <Rocket size={11} /> {card.kind === 'blog' ? t('bml.kind.blog', 'Blog post') : t('bml.kind.custom', 'Announcement')}
        </div>
        <div className="font-semibold text-[14px] break-words">{card.title}</div>
        {card.summary && <div className="text-[12px] text-[var(--muted)] break-words">{card.summary}</div>}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-[var(--faint)] truncate flex-1" title={host}>{host}</span>
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-ink)]">{t('bml.open', 'Read')} <ExternalLink size={11} /></span>
        </div>
      </div>
    </div>
  );
}

function LaunchItemEditor({ initial, posts, onSaved, onCancel }) {
  const { t } = useI18n(); const toast = useToast();
  const [d, setD] = useState(initial);
  const [pv, setPv] = useState(null);
  const [pvLang, setPvLang] = useState('en');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setD((x) => ({ ...x, [k]: v })); setPv(null); };
  const errText = (e) => ({
    url_must_be_https: t('bml.err.url', 'The link must be a full https:// address.'),
    image_must_be_https: t('bml.err.img', 'The picture must be an https:// address or a path on this site.'),
    title_required: t('bml.err.title', 'A custom card needs a title.'),
    post_required: t('bml.err.post', 'Choose a post.'),
    dates_reversed: t('bml.err.dates', 'The end is before the start.'),
    versions_reversed: t('bml.err.ver', 'The minimum version is above the maximum.'),
    nothing_to_show: t('bml.err.empty', 'Nothing to show: the post is not published, or the project has no post yet.'),
    invalid_input: t('bml.err.input', 'Check the fields: versions look like 1.4.0.'),
  })[e] || t('common.failed', 'Failed.');

  const preview = async () => {
    setBusy(true);
    try { setPv(await api.post('/admin/bmm-launch/preview', itemPayload(d))); }
    catch (x) { toast.error(errText(x?.data?.error)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (d.id) await api.put(`/admin/bmm-launch/items/${d.id}`, itemPayload(d));
      else await api.post('/admin/bmm-launch/items', itemPayload(d));
      toast.success(t('bml.saved', 'Saved. BMM picks it up within a minute.'));
      onSaved();
    } catch (x) { toast.error(errText(x?.data?.error)); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('bml.source', 'What it shows')}>
          <Select value={d.source} onChange={(e) => set('source', e.target.value)}>
            <option value="latest">{t('bml.src.latest', 'The newest post of a blog')}</option>
            <option value="post">{t('bml.src.post', 'A post I choose')}</option>
            <option value="custom">{t('bml.src.custom', 'A custom card')}</option>
          </Select>
        </Field>
        {d.source === 'latest' && <Field label={t('bml.project', 'Blog of project')}><Input value={d.projectKey} onChange={(e) => set('projectKey', e.target.value.toLowerCase())} placeholder="bmm" /></Field>}
        {d.source === 'post' && (
          <Field label={t('bml.post', 'Post')} className="sm:col-span-2">
            <Select value={d.postId} onChange={(e) => set('postId', e.target.value)}>
              <option value="">{t('bml.post.pick', 'Choose a published post')}</option>
              {posts.map((p) => <option key={p.id} value={p.id}>{p.project ? `[${p.project}] ` : ''}{p.title}</option>)}
            </Select>
          </Field>
        )}
      </div>
      {d.source === 'custom' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('bml.title', 'Title')}><Input value={d.title} maxLength={160} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label={t('bml.title.fr', 'Title in French (optional)')}><Input value={d.titleFr} maxLength={160} onChange={(e) => set('titleFr', e.target.value)} /></Field>
          <Field label={t('bml.summary', 'Summary')}><Textarea rows={3} value={d.summary} maxLength={400} onChange={(e) => set('summary', e.target.value)} /></Field>
          <Field label={t('bml.summary.fr', 'Summary in French (optional)')}><Textarea rows={3} value={d.summaryFr} maxLength={400} onChange={(e) => set('summaryFr', e.target.value)} /></Field>
          <Field label={t('bml.url', 'Link (https)')}><Input value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="https://bettercommunity.ch/…" /></Field>
          <Field label={t('bml.image', 'Picture (optional)')}><Input value={d.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://… or /uploads/…" /></Field>
        </div>
      )}
      <div className="grid sm:grid-cols-4 gap-3">
        <Field label={t('bml.mode', 'Shown')}>
          <Select value={d.displayMode} onChange={(e) => set('displayMode', e.target.value)}>
            <option value="once">{t('bml.mode.once', 'Once')}</option>
            <option value="times">{t('bml.mode.times', 'A number of times')}</option>
            <option value="always">{t('bml.mode.always', 'At every launch')}</option>
          </Select>
        </Field>
        {d.displayMode === 'times' && <Field label={t('bml.times', 'How many times')}><Input type="number" min={1} max={100} value={d.times} onChange={(e) => set('times', e.target.value)} /></Field>}
        <Field label={t('bml.from', 'From (optional)')}><Input type="datetime-local" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
        <Field label={t('bml.until', 'Until (optional)')}><Input type="datetime-local" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
        <Field label={t('bml.minv', 'From BMM version')}><Input value={d.minVersion} onChange={(e) => set('minVersion', e.target.value)} placeholder="1.0.0" /></Field>
        <Field label={t('bml.maxv', 'Up to BMM version')}><Input value={d.maxVersion} onChange={(e) => set('maxVersion', e.target.value)} placeholder="2.9.9" /></Field>
        <Field label={t('bml.priority', 'Priority')}><Input type="number" min={-100} max={100} value={d.priority} onChange={(e) => set('priority', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={d.enabled} onChange={(e) => set('enabled', e.target.checked)} /> {t('bml.enabled', 'Active')}</label>
      </div>
      {pv && (
        <div className="space-y-2">
          <div className="flex gap-1.5">{['en', 'fr'].map((l) => <Button key={l} size="sm" variant={pvLang === l ? 'primary' : 'ghost'} onClick={() => setPvLang(l)}>{l.toUpperCase()}</Button>)}</div>
          <LaunchCardPreview card={pv[pvLang]} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}><X size={15} /> {t('common.cancel', 'Cancel')}</Button>}
        <Button variant="ghost" disabled={busy} onClick={preview}><Eye size={15} /> {t('bml.preview', 'Preview')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={15} /> {t('common.save', 'Save')}</>}</Button>
      </div>
    </Card>
  );
}

export function AdminBmmLaunch() {
  const { t, lang } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bmm-launch'), []);
  const [editing, setEditing] = useState(null);
  const undo = useUndoableDelete(reload);
  const items = useMemo(() => (data?.items || []).filter((i) => !undo.pending.has(i.id)), [data, undo.pending]);

  const setEnabled = async (v) => {
    try { await api.put('/admin/bmm-launch/config', { enabled: v }); reload(); toast.success(v ? t('bml.on', 'BMM shows the active cards at launch.') : t('bml.off', 'BMM shows nothing at launch.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const edit = (i) => setEditing({
    ...ITEM_EMPTY, ...i, postId: i.postId || '', startsAt: toLocal(i.startsAt), endsAt: toLocal(i.endsAt),
    minVersion: i.minVersion || '', maxVersion: i.maxVersion || '',
  });
  const del = (i) => undo.del(i.id, () => api.del(`/admin/bmm-launch/items/${i.id}`), t('bml.deleted', 'Card deleted.'));

  if (loading) return <Loading />;
  const enabled = data?.config?.enabled !== false;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket size={16} className="text-[var(--accent-ink)]" /> {t('bml.h', 'BMM launch card')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('bml.sub', 'What BetterModsManager shows in its start-up window. The app counts how often it showed each card; editing what a card says shows it again.')}</p>
        <Card className="p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="flex-1">{t('bml.enable', 'Show a card when BMM starts')}</span>
            <Badge tone={enabled ? 'green' : ''}>{enabled ? t('bml.enabled.b', 'on') : t('bml.none', 'none')}</Badge>
          </label>
        </Card>
      </div>

      {editing ? (
        <LaunchItemEditor initial={editing} posts={data?.posts || []} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      ) : (
        <div className="flex justify-end"><Button variant="primary" onClick={() => setEditing({ ...ITEM_EMPTY })}><Plus size={15} /> {t('bml.add', 'Add a card')}</Button></div>
      )}

      {items.length ? (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((i) => (
            <Card key={i.id} className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone={i.live && enabled ? 'green' : ''}>{i.broken ? t('bml.broken', 'nothing to show') : i.live ? t('bml.live', 'live') : t('bml.idle', 'not live')}</Badge>
                <Badge>{i.source === 'latest' ? t('bml.src.latest.b', 'newest of {p}').replace('{p}', i.projectKey) : i.source === 'post' ? t('bml.src.post.b', 'chosen post') : t('bml.src.custom.b', 'custom')}</Badge>
                <Badge>{i.displayMode === 'times' ? t('bml.times.b', '{n} times').replace('{n}', String(i.times)) : i.displayMode === 'always' ? t('bml.mode.always', 'At every launch') : t('bml.mode.once', 'Once')}</Badge>
                <Badge>rev {i.rev}</Badge>
                {(i.minVersion || i.maxVersion) && <Badge>{i.minVersion || '*'} → {i.maxVersion || '*'}</Badge>}
                {(i.startsAt || i.endsAt) && <Badge>{fmt(i.startsAt, lang) || '…'} → {fmt(i.endsAt, lang) || '…'}</Badge>}
              </div>
              {i.preview ? <LaunchCardPreview card={i.preview[lang === 'fr' ? 'fr' : 'en']} /> : <div className="text-[12px] text-[var(--muted)]">{t('bml.err.empty', 'Nothing to show: the post is not published, or the project has no post yet.')}</div>}
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => edit(i)}><Pencil size={13} /> {t('common.edit', 'Edit')}</Button>
                <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(i)} aria-label={t('common.delete', 'Delete')} title={t('common.delete', 'Delete')}><Trash2 size={13} /></Button>
              </div>
            </Card>
          ))}
        </div>
      ) : <EmptyState icon={Rocket} title={t('bml.empty', 'No card yet')} sub={t('bml.empty.s', 'Add one: the newest BMM post is the usual choice, shown once per new post.')} />}
    </div>
  );
}
// fin notify (agent-notify)
