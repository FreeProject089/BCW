// Admin → Moderation → Lookalike pictures: uploads whose perceptual hash sits within a few
// bits of a picture ANOTHER account holds (or is byte-identical to it). Staff look at the two
// side by side and clear the flag (a false positive, the same person twice) or mark it acted
// on; the account and the content stay reachable from the row.
import { useState } from 'react';
import { Images, RefreshCw, Check, Gavel, Sliders, ExternalLink, ScanSearch } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Field, Select, EmptyState, Spinner, useToast } from '../ui/ui.jsx';

const when = (d) => new Date(d).toLocaleString();
// t() takes no variables; the few counted strings fill their {x} here.
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const KIND_LABEL = { upload: 'Upload', archive: 'Archive', 'archive-entry': 'Inside an archive', avatar: 'Avatar', 'team-avatar': 'Team avatar' };

function Picture({ h, t }) {
  const [broken, setBroken] = useState(false);
  const name = h.key.includes('#') ? h.key.split('#').slice(1).join('#') : h.key.split('/').pop();
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-[var(--line)] p-2 space-y-1">
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-[var(--surface-2)] flex items-center justify-center">
        {h.kind === 'archive' || broken
          ? <Images size={28} className="text-[var(--faint)]" />
          : <img src={`/api${h.preview}`} alt="" loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setBroken(true)} />}
      </div>
      <div className="text-[12px] font-medium truncate" title={h.key}>{name}</div>
      <div className="text-[11px] text-[var(--faint)] flex flex-wrap gap-x-2">
        <span>{t(`adm.mf.kind.${h.kind}`, KIND_LABEL[h.kind] || h.kind)}</span>
        {h.width ? <span>{h.width}×{h.height}</span> : null}
        {h.refType ? <span>{h.refType}</span> : null}
        <span>{when(h.createdAt)}</span>
      </div>
      <div className="text-[12px] truncate">
        {h.owner
          ? <a className="underline hover:text-[var(--text)]" href={`/admin?s=users&q=${encodeURIComponent(h.owner.id)}`}>{h.owner.displayName}{h.owner.status !== 'active' ? ` · ${h.owner.status}` : ''}</a>
          : <span className="text-[var(--faint)]">{t('adm.mf.noowner', 'owner unknown')}</span>}
      </div>
    </div>
  );
}

function Settings({ stats, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  const s = f || stats?.settings; if (!s) return null;
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/media-hashes/settings', { threshold: Number(s.threshold), enabled: !!s.enabled }); toast.success(t('common.saved', 'Saved.')); setF(null); onSaved?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const scan = async (backfill) => {
    setBusy(true);
    try { const r = await api.post('/admin/media-hashes/scan', { backfill }); toast.success(fmt(t('adm.mf.scanned', 'Hashed {h}, flagged {f}, backfilled {b}.'), { h: r.hashed, f: r.flagged, b: r.backfilled })); onSaved?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Sliders size={15} /> {t('adm.mf.settings', 'Detection')}</div>
      <p className="text-[12px] text-[var(--muted)]">{t('adm.mf.settings.d', 'Every uploaded picture (and the pictures inside uploaded archives, and linked avatars) gets a perceptual hash. Two hashes within the distance below are flagged when they belong to different accounts. 0–4 is the same picture re-saved, 6–10 a crop or a watermark, 20+ a different picture.')}</p>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <Field label={t('adm.mf.threshold', 'Max distance (bits)')}><Input type="number" min={0} max={20} value={s.threshold} onChange={(e) => setF({ ...s, threshold: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></Field>
        <Field label={t('adm.mf.enabled', 'Hashing')}>
          <Select value={s.enabled ? 'on' : 'off'} onChange={(e) => setF({ ...s, enabled: e.target.value === 'on' })}>
            <option value="on">{t('common.on', 'On')}</option><option value="off">{t('common.off', 'Off')}</option>
          </Select>
        </Field>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={save} disabled={busy || !f}>{t('common.save', 'Save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => scan(false)} disabled={busy}><ScanSearch size={13} /> {t('adm.mf.scan', 'Hash now')}</Button>
          <Button size="sm" variant="ghost" onClick={() => scan(true)} disabled={busy} title={t('adm.mf.backfill.t', 'Also register pictures uploaded before hashing existed (owner unknown).')}>{t('adm.mf.backfill', 'Backfill')}</Button>
        </div>
      </div>
      {stats && <div className="text-[11px] text-[var(--faint)]">{fmt(t('adm.mf.stats', '{p} waiting · {h} hashed · flags: {a} pending, {c} cleared, {d} acted on'), { p: stats.pending, h: stats.hashed, a: stats.flags.pending, c: stats.flags.cleared, d: stats.flags.actioned })}</div>}
    </Card>
  );
}

export function AdminMediaFlags() {
  const { t } = useI18n(); const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(0);
  const [showCfg, setShowCfg] = useState(false);
  const list = useAsync(() => api.get(`/admin/media-flags?status=${status}&page=${page}`), [status, page]);
  const stats = useAsync(() => api.get('/admin/media-hashes/stats'), []);
  const resolve = async (id, st) => {
    try { await api.post(`/admin/media-flags/${id}`, { status: st }); await list.reload(); stats.reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const flags = list.data?.flags || [];
  const pages = Math.max(1, Math.ceil((list.data?.total || 0) / (list.data?.pageSize || 40)));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><Images size={16} className="text-[var(--accent-ink)]" /> {t('adm.mf.title', 'Lookalike pictures')}</h2>
        {stats.data?.flags?.pending ? <Badge tone="warning">{stats.data.flags.pending}</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="!w-auto">
            <option value="pending">{t('adm.mf.st.pending', 'Pending')}</option>
            <option value="cleared">{t('adm.mf.st.cleared', 'Cleared')}</option>
            <option value="actioned">{t('adm.mf.st.actioned', 'Acted on')}</option>
            <option value="all">{t('adm.mf.st.all', 'All')}</option>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => { list.reload(); stats.reload(); }}><RefreshCw size={13} /></Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCfg((v) => !v)}><Sliders size={13} /> {t('adm.mf.settings', 'Detection')}</Button>
        </div>
      </div>
      <p className="text-[12px] text-[var(--muted)]">{t('adm.mf.desc', 'A picture that looks like — or is byte-for-byte — one another account uploaded earlier. Clear it when it is a false positive or the same person on two accounts; mark it acted on once you have handled the account or the content.')}</p>
      {showCfg && <Settings stats={stats.data} onSaved={() => { stats.reload(); list.reload(); }} />}
      {list.loading && !list.data ? <div className="py-6 text-center"><Spinner /></div>
        : !flags.length ? <EmptyState icon={Check} title={t('adm.mf.empty.t', 'Nothing flagged')}
          sub={status === 'pending' ? t('adm.mf.empty.s2', 'No picture is waiting on you. Detection keeps running, a new lookalike lands here on its own.') : t('adm.mf.empty.s', 'No picture in this state looks like another account’s.')}
          action={status === 'pending' ? null : { label: t('adm.mf.gopending', 'Back to what is pending'), icon: Check, onClick: () => { setStatus('pending'); setPage(0); } }} />
        : <div className="space-y-3">
          {flags.map((f) => (
            <Card key={f.id} className="p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <Badge tone={f.reason === 'exact' ? 'error' : 'warning'}>{f.reason === 'exact' ? t('adm.mf.exact', 'identical bytes') : fmt(t('adm.mf.near', 'distance {d}'), { d: f.distance })}</Badge>
                <Badge tone={f.status === 'pending' ? 'warning' : f.status === 'actioned' ? 'error' : 'success'}>{t(`adm.mf.st.${f.status}`, f.status)}</Badge>
                <span className="text-[var(--faint)]">{when(f.createdAt)}</span>
                {f.note ? <span className="text-[var(--muted)]">· {f.note}</span> : null}
                <span className="ml-auto flex gap-1">
                  {f.status !== 'cleared' && <Button size="sm" variant="ghost" onClick={() => resolve(f.id, 'cleared')}><Check size={13} /> {t('adm.mf.clear', 'Clear')}</Button>}
                  {f.status !== 'actioned' && <Button size="sm" variant="ghost" className="!text-error" onClick={() => resolve(f.id, 'actioned')}><Gavel size={13} /> {t('adm.mf.action', 'Acted on')}</Button>}
                  {f.status !== 'pending' && <Button size="sm" variant="ghost" onClick={() => resolve(f.id, 'pending')}>{t('adm.mf.reopen', 'Reopen')}</Button>}
                </span>
              </div>
              <div className="flex gap-3 flex-col sm:flex-row">
                <Picture h={f.hash} t={t} />
                <div className="hidden sm:flex items-center text-[var(--faint)]"><ExternalLink size={14} className="rotate-90 sm:rotate-0" /></div>
                <Picture h={f.match} t={t} />
              </div>
            </Card>
          ))}
          {pages > 1 && <div className="flex items-center justify-center gap-2 text-[12px]">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.prev', 'Previous')}</Button>
            <span>{page + 1} / {pages}</span>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('common.next', 'Next')}</Button>
          </div>}
        </div>}
    </div>
  );
}
