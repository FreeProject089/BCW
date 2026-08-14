import { useState } from 'react';
import { KeyRound, Search, Activity, AlertTriangle, Ban, Sliders, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Badge, Field, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

// Admin tab for the public API: what it is being used for, by whom, and the two knobs that
// decide how much of it is recorded. Gated by the `manage_api` capability in admin.jsx.
//
// The one rule this screen follows everywhere: never blur the line between the COUNT and the
// SAMPLE. Totals and per-key figures come from ApiUsageDay and are exact; the call list is a
// sample with a retention of days, and says so on its face. A number that is quietly a
// sample is worse than no number, because it gets quoted.

const fmtMs = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const statusTone = (s) => (s >= 500 ? 'red' : s >= 400 ? 'amber' : s === 0 ? '' : 'green');

/** Calls per day. Deliberately a bar per day and nothing else — no smoothing, no second
 *  axis. The question it answers is "is something hammering us", which a shape answers. */
function UsageBars({ series }) {
  const { t } = useI18n();
  const max = Math.max(1, ...series.map((d) => d.count));
  return (
    <div className="flex items-end gap-[2px] h-24 mt-2">
      {series.map((d) => {
        const h = (d.count / max) * 100;
        const errH = d.count ? (d.errors / d.count) * h : 0;
        return (
          <div key={d.day} className="flex-1 min-w-0 flex flex-col justify-end h-full group relative"
            title={`${d.day} · ${d.count} ${t('aapi.calls', 'calls')}${d.errors ? ` · ${d.errors} ${t('aapi.errs', 'errors')}` : ''}`}>
            {/* Errors stacked at the top of the same bar rather than a separate series:
                the useful reading is "how much of today went wrong", not two lines to
                mentally divide. */}
            <div className="w-full rounded-t-[3px] bg-warning" style={{ height: `${errH}%` }} />
            <div className="w-full rounded-b-[3px] bg-[var(--primary-2)]" style={{ height: `${Math.max(h - errH, d.count ? 2 : 0)}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--faint)] mb-0.5">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--faint)]">{sub}</div>}
    </div>
  );
}

export function AdminApi() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [view, setView] = useState('overview');
  const [days, setDays] = useState(30);
  const { data, loading, reload } = useAsync(() => api.get(`/admin/api/overview?days=${days}`), [days]);

  if (loading && !data) return <Loading />;
  const d = data || {};

  const saveConfig = async (patch) => {
    try {
      await api.put('/admin/api/config', { sampleRate: d.config.sampleRate, retentionDays: d.config.retentionDays, ...patch });
      toast.success(t('common.saved', 'Saved.')); reload();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const revoke = async (keyId, label) => {
    if (!await dialog.confirm({
      title: t('aapi.revoke.t', 'Revoke this key?'),
      // Naming the consequence rather than asking "are you sure": whoever is using it stops
      // working within seconds, and the owner is told it was staff who did it.
      message: t('aapi.revoke.m', '“{n}” stops working immediately and cannot be un-revoked. Its owner is notified that staff revoked it.').replace('{n}', label || t('aapi.untitled', 'Untitled key')),
      okLabel: t('aapi.revoke.ok', 'Revoke'), danger: true,
    })) return;
    try { await api.post(`/admin/api/keys/${keyId}/revoke`); toast.success(t('aapi.revoked', 'Revoked.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 mr-2"><KeyRound size={16} className="text-[var(--primary-2)]" /> {t('aapi.title', 'Public API')}</h2>
        <div className="inline-flex rounded-[12px] bg-[var(--surface-2)] p-0.5">
          {[['overview', t('aapi.tab.overview', 'Usage')], ['keys', t('aapi.tab.keys', 'Keys')], ['requests', t('aapi.tab.requests', 'Calls')], ['settings', t('aapi.tab.settings', 'Recording')]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-[10px] text-sm ${view === k ? 'bg-[var(--bg-solid)] font-medium shadow-sm' : 'text-[var(--muted)]'}`}>{l}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={reload}><RefreshCw size={13} /> {t('common.refresh', 'Refresh')}</Button>
      </div>

      {view === 'overview' && (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold flex items-center gap-2"><Activity size={14} className="text-[var(--primary-2)]" /> {t('aapi.traffic', 'Calls per day')}</div>
              <Select className="w-auto" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 30, 90].map((n) => <option key={n} value={n}>{t('aapi.lastn', 'Last {n} days').replace('{n}', String(n))}</option>)}
              </Select>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              {t('aapi.exact', 'These are exact counts, not the sample — every authenticated call is counted, including the ones refused for a missing scope.')}
            </p>
            <UsageBars series={d.series || []} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-[var(--line)]">
              <Stat label={t('aapi.total', 'Calls')} value={(d.total || 0).toLocaleString()} />
              <Stat label={t('aapi.errors', 'Refused or failed')} value={(d.errors || 0).toLocaleString()}
                sub={`${Math.round((d.errorRate || 0) * 100)}%`} tone={d.errorRate > 0.25 ? 'warn' : undefined} />
              <Stat label={t('aapi.keys', 'Keys')} value={`${d.activeKeyCount || 0}`} sub={t('aapi.ofn', 'of {n} ever created').replace('{n}', String(d.keyCount || 0))} />
              <Stat label={t('aapi.samples', 'Calls in the sample')} value={(d.sampleCount || 0).toLocaleString()}
                sub={t('aapi.keptdays', 'kept {n} days').replace('{n}', String(d.config?.retentionDays ?? 7))} />
            </div>
          </Card>

          <Card className="p-4 mt-4">
            <div className="text-sm font-semibold mb-2">{t('aapi.topkeys', 'Busiest keys')}</div>
            {!(d.top || []).length ? <EmptyState icon={Activity} title={t('aapi.nousage', 'No API calls in this period.')} sub={t('aapi.nousage.s', 'Nothing has used a key yet — or the period is too short.')} /> : (
              <div className="divide-y divide-[var(--line)]">
                {d.top.map((k) => (
                  <div key={k.keyId || 'deleted'} className="py-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{k.label || t('aapi.untitled', 'Untitled key')} {k.prefix && <code className="text-[10px] font-mono text-[var(--faint)]">{k.prefix}…</code>}</div>
                      <div className="text-[11px] text-[var(--faint)] truncate">{k.owner ? `${k.owner.displayName} · ${k.owner.email}` : t('aapi.ownergone', 'owner unknown')}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">{k.count.toLocaleString()}</div>
                      {k.errors > 0 && <div className="text-[11px] text-warning tabular-nums">{k.errors} {t('aapi.errs', 'errors')}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {view === 'keys' && <KeysTable onRevoke={revoke} />}
      {view === 'requests' && <RequestsTable />}

      {view === 'settings' && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Sliders size={14} className="text-[var(--primary-2)]" /> {t('aapi.rec.title', 'What gets recorded')}</div>
          <p className="text-[12px] text-[var(--muted)] mb-3">
            {t('aapi.rec.sub', 'Counts are always kept in full and are not affected by anything here. These two settings only govern the sample of individual calls — the detailed list, which exists to explain an incident and is worth very little a month later.')}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('aapi.rec.rate', 'Share of successful calls sampled')}>
              <Select value={String(d.config?.sampleRate ?? 1)} onChange={(e) => saveConfig({ sampleRate: Number(e.target.value) })}>
                {[['1', '100%'], ['0.5', '50%'], ['0.25', '25%'], ['0.1', '10%'], ['0', t('aapi.rec.none', 'None')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label={t('aapi.rec.keep', 'Keep the sample for')}>
              <Select value={String(d.config?.retentionDays ?? 7)} onChange={(e) => saveConfig({ retentionDays: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30, 90].map((n) => <option key={n} value={n}>{t('aapi.days', '{n} days').replace('{n}', String(n))}</option>)}
              </Select>
            </Field>
          </div>
          <p className="text-[11px] text-[var(--faint)] mt-2">
            {t('aapi.rec.errnote', 'Failed and refused calls are always sampled, whatever the rate: a 500 dropped by a dice roll is the one line somebody will go looking for.')}
          </p>
        </Card>
      )}
    </div>
  );
}

function KeysTable({ onRevoke }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, loading } = useAsync(() => api.get(`/admin/api/keys?q=${encodeURIComponent(term)}`), [term]);
  const keys = data?.keys || [];
  const dead = (k) => k.revokedAt || (k.expiresAt && new Date(k.expiresAt) < new Date());

  return (
    <Card className="p-4">
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('aapi.search', 'Label, prefix, owner name or email')} />
        <Button type="submit"><Search size={14} /></Button>
      </form>
      {loading ? <Spinner /> : !keys.length ? <EmptyState icon={KeyRound} title={t('aapi.nokeys', 'No keys.')} /> : (
        <div className="divide-y divide-[var(--line)]">
          {keys.map((k) => (
            <div key={k.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate flex items-center gap-2">
                  <span className={dead(k) ? 'line-through text-[var(--faint)]' : ''}>{k.label || t('aapi.untitled', 'Untitled key')}</span>
                  <code className="text-[10px] font-mono text-[var(--faint)]">{k.prefix}…</code>
                  {k.revokedAt && <Badge tone="red">{t('aapi.revokedb', 'revoked')}</Badge>}
                  {!k.revokedAt && k.expiresAt && new Date(k.expiresAt) < new Date() && <Badge tone="amber">{t('aapi.expired', 'expired')}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--faint)] truncate">
                  {k.user?.displayName} · {k.user?.email} · {(k.scopes || []).join(', ') || t('aapi.noscope', 'no scope')}
                </div>
                <div className="text-[11px] text-[var(--faint)]">
                  {k.lastUsedAt ? t('aapi.lastused', 'last used {d}').replace('{d}', new Date(k.lastUsedAt).toLocaleString()) : t('aapi.never', 'never used')}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums">{(k.calls || 0).toLocaleString()}</div>
                <div className="text-[10px] text-[var(--faint)]">{t('aapi.calls', 'calls')}</div>
              </div>
              {!k.revokedAt && (
                <Button size="sm" variant="ghost" onClick={() => onRevoke(k.id, k.label)} title={t('aapi.revoke.ok', 'Revoke')}>
                  <Ban size={13} className="text-[var(--error)]" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RequestsTable() {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [path, setPath] = useState('');
  const [applied, setApplied] = useState({ status: '', path: '' });
  const { data, loading } = useAsync(
    () => api.get(`/admin/api/requests?limit=200&status=${encodeURIComponent(applied.status)}&path=${encodeURIComponent(applied.path)}`),
    [applied],
  );
  const rows = data?.requests || [];

  return (
    <Card className="p-4">
      <p className="text-[11px] text-[var(--muted)] mb-2 flex items-start gap-1.5">
        <AlertTriangle size={12} className="text-warning mt-[2px] shrink-0" />
        {/* Stated once, at the top, in the place someone would otherwise count rows. */}
        {t('aapi.req.warn', 'This is a sample kept for a few days, not a complete log — count nothing from it. The Usage tab has the real figures.')}
      </p>
      <form className="flex flex-wrap gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setApplied({ status, path: path.trim() }); }}>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('aapi.req.all', 'Every status')}</option>
          <option value="errors">{t('aapi.req.errsonly', 'Failed or refused only')}</option>
          <option value="403">403</option><option value="404">404</option><option value="500">500</option>
        </Select>
        <Input className="flex-1 min-w-[12rem]" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('aapi.req.path', 'Path contains…')} />
        <Button type="submit"><Search size={14} /></Button>
      </form>
      {loading ? <Spinner /> : !rows.length ? <EmptyState icon={Activity} title={t('aapi.req.none', 'Nothing in the sample.')} sub={t('aapi.req.none.s', 'Either nothing matched, or the sample rate is set low.')} /> : (
        <div className="max-h-[32rem] overflow-y-auto divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <div key={r.id} className="py-1.5 flex items-center gap-2 text-[12px]">
              <Badge tone={statusTone(r.status)}>{r.status || '—'}</Badge>
              <code className="font-mono text-[11px] text-[var(--muted)] shrink-0">{r.method}</code>
              <span className="truncate flex-1 font-mono text-[11px]">{r.path}</span>
              <span className="text-[10px] text-[var(--faint)] shrink-0 tabular-nums">{fmtMs(r.ms)}</span>
              <span className="text-[10px] text-[var(--faint)] shrink-0 truncate max-w-[10rem]">
                {r.key ? `${r.key.label || t('aapi.untitled', 'Untitled key')}` : t('aapi.keygone', 'key gone')}
              </span>
              <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(r.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
