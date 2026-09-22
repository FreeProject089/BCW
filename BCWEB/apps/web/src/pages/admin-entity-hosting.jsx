// Admin: hosting settings per blog and per contact inbox, instead of one global number.
//
// Each row is one thing (a blog, a project's inbox, a team's inbox) and its MODE:
//   inherit    the site-wide setting, as before (the default, and what "no row" means)
//   custom     its own caps
//   unlimited  none
//   pool       no allowance of its own; storage is reserved from a pool, which counts it
//              like a repo's quota (the API refuses a reservation that does not fit)
// For inboxes, the attachment rule too: never, always, or only with a pool.
import { useState } from 'react';
import { HardDrive, Newspaper, Inbox, Users, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Field, Select, Explain, EmptyState, Spinner, Modal, useToast } from '../ui/ui.jsx';

const KINDS = [
  ['blog', Newspaper, (t) => t('aeh.k.blog', 'Blogs')],
  ['project-contact', Inbox, (t) => t('aeh.k.project', 'Project inboxes')],
  ['team-contact', Users, (t) => t('aeh.k.team', 'Team inboxes')],
];
const fmtBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function modeLabel(t, m) {
  return { inherit: t('aeh.m.inherit', 'Site setting'), custom: t('aeh.m.custom', 'Own limits'), unlimited: t('aeh.m.unlimited', 'No limit'), pool: t('aeh.m.pool', 'From a pool') }[m] || m;
}
function attachLabel(t, a) {
  return { inherit: t('aeh.a.inherit', 'Site setting'), off: t('aeh.a.off', 'Never'), always: t('aeh.a.always', 'Always'), pool_only: t('aeh.a.pool', 'Only with a pool') }[a] || a;
}

function EditRow({ kind, item, pools, onClose, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState({ ...item.settings });
  const [busy, setBusy] = useState(false);
  const contact = kind !== 'blog';
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/hosting/entities/${kind}/${encodeURIComponent(item.ref)}`, {
        mode: f.mode, maxItems: Number(f.maxItems) || 0, maxKB: Number(f.maxKB) || 0,
        poolId: f.mode === 'pool' ? (f.poolId || null) : null, quotaMB: Number(f.quotaMB) || 0,
        ...(contact ? { attachments: f.attachments, maxAttachmentMB: Number(f.maxAttachmentMB) || 0 } : {}),
      });
      toast.success(t('common.saved', 'Saved.')); onSaved();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'pool_exceeded' ? t('aeh.err.pool', 'The pool has only {n} MB free.').replace('{n}', Math.floor(x.data?.freeMB || 0))
        : e === 'pool_required' ? t('aeh.err.poolreq', 'Pick the pool the storage comes from.')
          : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={item.name} icon={HardDrive} width="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}><Save size={14} /> {t('common.save', 'Save')}</Button></div>}>
      <div className="space-y-3">
        <Field label={t('aeh.mode', 'Storage')}>
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            {['inherit', 'custom', 'unlimited', 'pool'].map((m) => <option key={m} value={m}>{modeLabel(t, m)}</option>)}
          </Select>
        </Field>
        {f.mode === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={kind === 'blog' ? t('aeh.maxposts', 'Max articles') : t('aeh.maxconv', 'Max conversations')} hint={t('ami.mp.zero', '0 = no limit')}><Input type="number" min={0} value={f.maxItems} onChange={(e) => setF({ ...f, maxItems: e.target.value })} /></Field>
            <Field label={t('aeh.maxkb', 'Max size (KB)')} hint={t('ami.mp.zero', '0 = no limit')}><Input type="number" min={0} value={f.maxKB} onChange={(e) => setF({ ...f, maxKB: e.target.value })} /></Field>
          </div>
        )}
        {f.mode === 'pool' && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={t('aeh.pool', 'Pool')}>
              <Select value={f.poolId || ''} onChange={(e) => setF({ ...f, poolId: e.target.value })}>
                <option value="">{t('aeh.pool.pick', 'Pick a pool')}</option>
                {pools.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.owner} · {Math.floor(g.freeMB)} MB {t('aeh.free', 'free')}</option>)}
              </Select>
            </Field>
            <Field label={t('aeh.quota', 'Reserved (MB)')}><Input type="number" min={0} className="!w-28" value={f.quotaMB} onChange={(e) => setF({ ...f, quotaMB: e.target.value })} /></Field>
          </div>
        )}
        {contact && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={t('aeh.attach', 'Files in messages')}>
              <Select value={f.attachments} onChange={(e) => setF({ ...f, attachments: e.target.value })}>
                {['inherit', 'off', 'always', 'pool_only'].map((a) => <option key={a} value={a}>{attachLabel(t, a)}</option>)}
              </Select>
            </Field>
            <Field label={t('aeh.attachmb', 'Max per file (MB)')} hint={t('aeh.attachmb.h', '0 = site setting')}><Input type="number" min={0} max={100} className="!w-28" value={f.maxAttachmentMB} onChange={(e) => setF({ ...f, maxAttachmentMB: e.target.value })} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SiteDefaults({ site, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState(site);
  const dirty = f.attachments !== site.attachments || Number(f.maxAttachmentMB) !== site.maxAttachmentMB;
  const save = async () => {
    try { await api.put('/admin/hosting/entities/defaults', { attachments: f.attachments, maxAttachmentMB: Number(f.maxAttachmentMB) || 10 }); toast.success(t('common.saved', 'Saved.')); onSaved(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <Field label={t('aeh.site.attach', 'Files in messages, site-wide')}>
        <Select value={f.attachments} onChange={(e) => setF({ ...f, attachments: e.target.value })} className="!w-auto">
          {['off', 'always', 'pool_only'].map((a) => <option key={a} value={a}>{attachLabel(t, a)}</option>)}
        </Select>
      </Field>
      <Field label={t('aeh.attachmb', 'Max per file (MB)')}><Input type="number" min={1} max={100} className="!w-24" value={f.maxAttachmentMB} onChange={(e) => setF({ ...f, maxAttachmentMB: e.target.value })} /></Field>
      <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>{t('common.save', 'Save')}</Button>
    </div>
  );
}

export function AdminEntityHosting() {
  const { t } = useI18n();
  const [kind, setKind] = useState('blog');
  const [edit, setEdit] = useState(null);
  const { data, loading, reload } = useAsync(() => api.get(`/admin/hosting/entities?kind=${kind}`), [kind]);
  const items = data?.items || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <HardDrive size={16} className="text-[var(--accent-ink)]" />
        <h2 className="font-semibold">{t('aeh.title', 'Storage per blog and inbox')}</h2>
      </div>
      <Explain summary={t('aeh.lead', 'Each blog and each inbox can keep the site setting, have its own limits, have none, or take its storage from a pool.')} className="text-[12px]">
        {t('aeh.body', 'A pool reservation is counted by the pool exactly like a repo quota, so the same space cannot be handed out twice, and a reservation that does not fit is refused. Leaving pool mode gives the space back.')}
      </Explain>
      <div className="flex gap-1.5 flex-wrap">
        {KINDS.map(([id, I, label]) => (
          <button key={id} type="button" onClick={() => setKind(id)} aria-current={kind === id ? 'true' : undefined}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${kind === id ? 'border-[var(--ring)] tint-primary' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <I size={12} /> {label(t)}
          </button>
        ))}
      </div>
      {kind !== 'blog' && data?.site && <Card className="p-4"><SiteDefaults key={`${data.site.attachments}-${data.site.maxAttachmentMB}`} site={data.site} onSaved={reload} /></Card>}
      <Card className="overflow-hidden">
        {loading && !data ? <div className="py-10 text-center"><Spinner /></div> : !items.length ? (
          <div className="p-2"><EmptyState icon={HardDrive} title={t('aeh.empty', 'Nothing to configure')} sub={t('aeh.empty.s', 'Blogs and inboxes appear here as soon as they exist.')} /></div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((x) => (
              <li key={x.ref}>
                <button type="button" onClick={() => setEdit(x)} className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:panel text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={x.name}>{x.name}</span>
                    <span className="block text-[12px] text-[var(--muted)] truncate">{x.usage.count} {kind === 'blog' ? t('aeh.posts', 'articles') : t('aeh.convs', 'conversations')} · {fmtBytes(x.usage.bytes)}</span>
                  </span>
                  <Badge tone={x.settings.mode === 'inherit' ? '' : x.settings.mode === 'pool' ? 'primary' : 'amber'}>{modeLabel(t, x.settings.mode)}</Badge>
                  {kind !== 'blog' && <Badge>{attachLabel(t, x.settings.attachments)}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <EditRow kind={kind} item={edit} pools={data?.pools || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

export default AdminEntityHosting;
