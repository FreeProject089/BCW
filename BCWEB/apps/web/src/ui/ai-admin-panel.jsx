// Admin > Moderation > AI (aios, agent-bcw-ai-os): the AI usage dashboard, the features'
// settings (who may use what, how often, with which key) and the staff tools (triage,
// duplicates, crash causes, summaries).
//
// The dashboard reads AGGREGATES: counts, latency buckets, tokens and an estimated cost, per
// day, feature and provider, plus per-person call counts for the top consumers. No text that
// was sent to a model is stored anywhere, so none can be shown here (lib/ai-usage.mjs).
// The provider itself (Laya / external, kill switch, knobs) stays on the Moderation engine
// screen (ui/ai-provider-panel.jsx); this screen is about what is built on top of it.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, SlidersHorizontal, Wrench, RefreshCw, Save, KeyRound, Trash2, ListOrdered, Copy, Cpu, FileText } from 'lucide-react';
import { Button, Card, Input, Select, Spinner, Badge, Explain, EmptyState, useToast, useDialog } from './ui.jsx';
import MetricChart from './metric-chart.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 1000) / 10}%`);
const ms = (v) => (v == null ? '–' : `${v >= 30000 ? '>' : ''}${Math.round(v)} ms`);
const usd = (v) => (v ? `$${Number(v).toFixed(v < 1 ? 4 : 2)}` : '$0');
const num = (v) => (v == null ? '–' : Number(v).toLocaleString());

function useNames() {
  const { t } = useI18n();
  return {
    feature: (k) => {
      if (k.startsWith('mod:')) return `${t('aiad.f.mod', 'Moderation')} · ${k.slice(4).replace(/_/g, ' ')}`;
      return ({
        suggest_tags: t('aic.f.suggest_tags', 'Tag and category suggestions'), detect_language: t('aic.f.detect_language', 'Language detection'),
        content_check: t('aic.f.content_check', 'Check before posting'), describe: t('aic.f.describe', 'Description drafts'),
        triage: t('aiad.f.triage', 'Queue triage'), summarize: t('aiad.f.summarize', 'Thread summaries'), duplicates: t('aiad.f.duplicates', 'Duplicate detection'),
        crash_clusters: t('aiad.f.crash', 'Crash causes'), telemetry_issues: t('aiad.f.telemetry', 'Live BMM errors (telemetry)'), bmm_suggest: t('aiad.f.bmm', 'BMM suggestions'), admin_test: t('aiad.f.test', 'Admin test box'), key_test: t('aiad.f.keytest', 'Key tests'),
      })[k] || k;
    },
    provider: (k) => ({ laya: 'Laya', external: t('aiad.p.external', 'External API'), byok: t('aiad.p.byok', 'Members\' own keys'), site: t('aiad.p.site', 'Site key'), rules: t('aiad.p.rules', 'Rules only'), off: t('aiad.p.off', 'Not sent') })[k] || k,
  };
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] truncate" title={label}>{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-[var(--faint)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Usage() {
  const { t } = useI18n();
  const N = useNames();
  const [range, setRange] = useState('7d');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const load = () => { setErr(false); api.get(`/admin/ai/usage?range=${range}`).then(setData).catch(() => setErr(true)); };
  useEffect(load, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Card className="p-4 text-sm text-[var(--muted)]">{t('aiad.loadfail', 'The AI usage could not be loaded.')}</Card>;
  if (!data) return <Card className="p-6 grid place-items-center"><Spinner /></Card>;
  const T = data.total;
  const points = (k) => data.series.map((d) => ({ label: d.day.slice(5), value: d[k] }));
  const labels = { avg: t('st.m.avg', 'avg'), min: t('st.m.min', 'min'), peak: t('st.m.peak', 'peak'), warn: t('st.m.warnat', 'warn at'), gaps: t('st.m.gaps', '{n} day(s) with no reading') };
  const table = (rows, name) => (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-xs">
        <thead className="text-[var(--muted)] text-left">
          <tr>
            <th className="py-1.5 pe-3 font-medium">{name}</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.calls', 'Calls')}</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.errors', 'Errors')}</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.timeouts', 'Timeouts')}</th>
            <th className="py-1.5 pe-3 font-medium text-right">p50</th>
            <th className="py-1.5 pe-3 font-medium text-right">p95</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.cache', 'Cache hits')}</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.limited', 'Rate-limited')}</th>
            <th className="py-1.5 pe-3 font-medium text-right">{t('aiad.c.dropped', 'Dropped')}</th>
            <th className="py-1.5 font-medium text-right">{t('aiad.c.cost', 'Est. cost')}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--line)]">
              <td className="py-1.5 pe-3">{r.label}</td>
              <td className="py-1.5 pe-3 text-right">{num(r.calls)}</td>
              <td className="py-1.5 pe-3 text-right">{num(r.failed + r.badAnswer)}</td>
              <td className="py-1.5 pe-3 text-right">{num(r.timeout)}</td>
              <td className="py-1.5 pe-3 text-right">{ms(r.p50)}</td>
              <td className="py-1.5 pe-3 text-right">{ms(r.p95)}</td>
              <td className="py-1.5 pe-3 text-right">{pct(r.cacheHitRate)}</td>
              <td className="py-1.5 pe-3 text-right">{num(r.rateLimited)}</td>
              <td className="py-1.5 pe-3 text-right">{num(r.dropped + r.breakerRefused)}</td>
              <td className="py-1.5 text-right">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="!w-auto" value={range} onChange={(e) => setRange(e.target.value)} aria-label={t('aiad.range', 'Time range')}>
          <option value="24h">{t('aiad.r.24h', 'Today')}</option>
          <option value="7d">{t('aiad.r.7d', 'Last 7 days')}</option>
          <option value="30d">{t('aiad.r.30d', 'Last 30 days')}</option>
          <option value="90d">{t('aiad.r.90d', 'Last 90 days')}</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={load} aria-label={t('aip.refresh', 'Refresh')} title={t('aip.refresh', 'Refresh')}><RefreshCw size={14} /></Button>
        <span className="text-xs text-[var(--faint)]">{t('aiad.privacy', 'Counts only: no text sent to a model is stored.')}</span>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
        <Tile label={t('aiad.c.calls', 'Calls')} value={num(T.calls)} sub={t('aiad.t.calls.s', 'sent to a provider')} />
        <Tile label={t('aiad.t.err', 'Error rate')} value={pct(T.errorRate)} sub={`${num(T.errors)} · ${num(T.timeout)} ${t('aiad.t.to', 'timeouts')}`} />
        <Tile label="p50 / p95" value={`${ms(T.p50)}`} sub={ms(T.p95)} />
        <Tile label={t('aiad.c.cache', 'Cache hits')} value={pct(T.cacheHitRate)} sub={num(T.cacheHit)} />
        <Tile label={t('aiad.t.breaker', 'Breaker opened')} value={num(T.breakerOpen)} sub={`${num(T.breakerRefused)} ${t('aiad.t.refused', 'refused')} · ${num(T.dropped)} ${t('aiad.t.dropped', 'queue drops')}`} />
        <Tile label={t('aiad.c.cost', 'Est. cost')} value={usd(T.costUsd)} sub={`${num(T.tokensIn + T.tokensOut)} ${t('aiad.t.tokens', 'tokens')}`} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-3"><MetricChart title={t('aiad.ch.calls', 'Calls per day')} points={points('calls')} labels={labels} /></Card>
        <Card className="p-3"><MetricChart title={t('aiad.ch.errors', 'Errors per day')} points={points('errors')} labels={labels} /></Card>
        <Card className="p-3"><MetricChart title={t('aiad.ch.p95', 'p95 latency per day')} unit=" ms" points={points('p95')} labels={labels} /></Card>
        <Card className="p-3"><MetricChart title={t('aiad.ch.cost', 'Estimated cost per day')} unit=" $" points={points('costUsd')} labels={labels} /></Card>
      </div>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.decisions', 'AI and the moderation decisions')}</h3>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
          <Tile label={t('aiad.changed', 'Raised by the AI')} value={num(T.changed)} sub={t('aiad.changed.s', 'decisions the AI moved above the rules')} />
          <Tile label={t('aiad.fp', 'Judged wrong')} value={num(T.falsePositive)} sub={t('aiad.fp.s', 'a human dismissed what the AI flagged, or a member said the warning was wrong')} />
          <Tile label={t('aiad.confirmed', 'Judged right')} value={num(T.confirmed)} sub={t('aiad.confirmed.s', 'content the AI flagged that a human removed or sanctioned')} />
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.byfeature', 'By surface and feature')}</h3>
        {data.byFeature.length ? table(data.byFeature.map((r) => ({ ...r, label: N.feature(r.key) })), t('aiad.feature', 'Feature')) : <p className="text-xs text-[var(--muted)]">{t('aiad.none', 'No AI traffic in this range.')}</p>}
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.byprovider', 'By provider')}</h3>
        {data.byProvider.length ? table(data.byProvider.map((r) => ({ ...r, label: N.provider(r.key) })), t('aiad.provider', 'Provider')) : <p className="text-xs text-[var(--muted)]">{t('aiad.none', 'No AI traffic in this range.')}</p>}
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.top', 'Top consumers')}</h3>
        {data.topUsers.length ? (
          <ol className="text-xs divide-y divide-[var(--line)]">
            {data.topUsers.map((u) => (
              <li key={u.userId} className="py-1.5 flex flex-wrap items-center gap-2">
                <Link className="font-medium hover:underline truncate max-w-[16rem]" title={u.name || u.userId} to={`/admin?s=users&q=${encodeURIComponent(u.userId)}`}>{u.name || u.userId}</Link>
                <span className="tabular-nums text-[var(--muted)]">{num(u.calls)} {t('aiad.calls', 'calls')} · {usd(u.costUsd)}</span>
                <span className="text-[var(--faint)] truncate" title={Object.entries(u.features).map(([k, v]) => `${N.feature(k)} ${v}`).join(', ')}>{Object.entries(u.features).map(([k, v]) => `${N.feature(k)} ${v}`).join(', ')}</span>
              </li>
            ))}
          </ol>
        ) : <p className="text-xs text-[var(--muted)]">{t('aiad.none', 'No AI traffic in this range.')}</p>}
      </Card>
    </div>
  );
}

const MEMBER_FEATURES = ['suggest_tags', 'detect_language', 'content_check', 'describe'];
const STAFF_FEATURES = ['triage', 'summarize', 'duplicates', 'crash_clusters', 'telemetry_issues'];

function Settings({ isAdmin }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const N = useNames();
  const [st, setSt] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sk, setSk] = useState({ baseUrl: 'https://', key: '', model: '' });
  const load = () => api.get('/admin/ai/features').then((r) => { setSt(r); setCfg(r.config); }).catch(() => setSt(false));
  useEffect(() => { load(); }, []);
  if (st === null) return <Card className="p-6 grid place-items-center"><Spinner /></Card>;
  if (st === false || !cfg) return <Card className="p-4 text-sm text-[var(--muted)]">{t('aiad.loadfail2', 'The AI feature settings could not be loaded.')}</Card>;
  const setF = (id, patch) => setCfg({ ...cfg, features: { ...cfg.features, [id]: { ...cfg.features[id], ...patch } } });
  const setG = (group, patch) => setCfg({ ...cfg, [group]: { ...cfg[group], ...patch } });
  const n = (v) => Math.round(Number(v) || 0);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/ai/features', {
        features: Object.fromEntries(Object.entries(cfg.features).map(([id, f]) => [id, STAFF_FEATURES.includes(id) ? { enabled: f.enabled } : { enabled: f.enabled, audience: f.audience, perUserPerDay: n(f.perUserPerDay), paidPerUserPerDay: n(f.paidPerUserPerDay) }])),
        limits: { perUserPerMin: n(cfg.limits.perUserPerMin), perIpPerMin: n(cfg.limits.perIpPerMin), globalPerDay: n(cfg.limits.globalPerDay) },
        byok: { enabled: cfg.byok.enabled, perUserPerDay: n(cfg.byok.perUserPerDay) },
        site: { forStaff: cfg.site.forStaff, forPaid: cfg.site.forPaid, perUserPerDay: n(cfg.site.perUserPerDay), globalPerDay: n(cfg.site.globalPerDay) },
        gen: { maxTokens: n(cfg.gen.maxTokens), timeoutMs: n(cfg.gen.timeoutMs), concurrency: n(cfg.gen.concurrency) },
        pricing: { external: { inPerMTok: Number(cfg.pricing.external.inPerMTok) || 0, outPerMTok: Number(cfg.pricing.external.outPerMTok) || 0 }, site: { inPerMTok: Number(cfg.pricing.site.inPerMTok) || 0, outPerMTok: Number(cfg.pricing.site.outPerMTok) || 0 } },
        retentionDays: n(cfg.retentionDays),
      });
      setCfg(r.config);
      toast.success(t('aiad.saved', 'AI feature settings saved.'));
    } catch (e) { toast.error(e?.data?.detail || t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const saveKey = async () => {
    setBusy(true);
    try { await api.put('/admin/ai/site-key', { baseUrl: sk.baseUrl.trim(), key: sk.key.trim(), model: sk.model.trim() }); setSk({ baseUrl: 'https://', key: '', model: '' }); await load(); toast.success(t('aiad.sk.saved', 'Site key saved and sealed. It is never shown again.')); }
    catch (e) { toast.error(e?.data?.error === 'forbidden' ? t('aiad.sk.admin', 'Only an admin can set the site key.') : t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const dropKey = async () => {
    if (!(await dialog.confirm({ title: t('aiad.sk.rm.t', 'Remove the site key?'), message: t('aiad.sk.rm.m', 'Staff summaries and plan-included drafts stop until a key is set again.'), okLabel: t('aic.rm', 'Remove'), danger: true }))) return;
    setBusy(true);
    // undo: a sealed key cannot be read back, so an undo would have nothing to restore; the confirm is the safeguard.
    try { await api.del('/admin/ai/site-key'); await load(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const numIn = (value, onChange, label, step = 1) => <Input type="number" step={step} min={0} className="!w-24" value={value} aria-label={label} title={label} onChange={(e) => onChange(e.target.value)} />;
  const key = st.siteKey;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">{t('aiad.members', 'Member helpers')}</h3>
        <p className="text-xs text-[var(--muted)] mb-2">{t('aiad.members.s', 'Off by default. "Paid" means an active subscription on a plan that costs something. Daily limits count calls per person and reset at midnight UTC.')}</p>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs">
            <thead className="text-[var(--muted)] text-left"><tr>
              <th className="py-1.5 pe-3 font-medium">{t('aiad.feature', 'Feature')}</th><th className="py-1.5 pe-3 font-medium">{t('aiad.on', 'On')}</th>
              <th className="py-1.5 pe-3 font-medium">{t('aiad.who', 'Who')}</th><th className="py-1.5 pe-3 font-medium">{t('aiad.free', 'Per day (free)')}</th><th className="py-1.5 font-medium">{t('aiad.paid', 'Per day (paid, staff)')}</th>
            </tr></thead>
            <tbody>
              {MEMBER_FEATURES.map((id) => (
                <tr key={id} className="border-t border-[var(--line)]">
                  <td className="py-1.5 pe-3">{N.feature(id)}{id === 'describe' && <Badge className="ms-1.5">{t('aiad.gen', 'writes text')}</Badge>}</td>
                  <td className="py-1.5 pe-3"><input type="checkbox" checked={cfg.features[id].enabled} onChange={(e) => setF(id, { enabled: e.target.checked })} aria-label={N.feature(id)} /></td>
                  <td className="py-1.5 pe-3">
                    <Select className="!w-auto" value={cfg.features[id].audience} onChange={(e) => setF(id, { audience: e.target.value })} aria-label={t('aiad.who', 'Who')}>
                      <option value="all">{t('aiad.a.all', 'Every member')}</option>
                      <option value="paid">{t('aiad.a.paid', 'Paying members')}</option>
                      <option value="staff">{t('aiad.a.staff', 'Staff only')}</option>
                    </Select>
                  </td>
                  <td className="py-1.5 pe-3">{numIn(cfg.features[id].perUserPerDay, (v) => setF(id, { perUserPerDay: v }), t('aiad.free', 'Per day (free)'))}</td>
                  <td className="py-1.5">{numIn(cfg.features[id].paidPerUserPerDay, (v) => setF(id, { paidPerUserPerDay: v }), t('aiad.paid', 'Per day (paid, staff)'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="text-sm font-semibold mt-4 mb-1">{t('aiad.staff', 'Staff tools')}</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {STAFF_FEATURES.map((id) => (
            <label key={id} className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={cfg.features[id].enabled} onChange={(e) => setF(id, { enabled: e.target.checked })} />{N.feature(id)}</label>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.limits', 'Limits')}</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] items-center">
          <label className="inline-flex items-center gap-2">{t('aiad.l.user', 'Per person per minute')} {numIn(cfg.limits.perUserPerMin, (v) => setG('limits', { perUserPerMin: v }), t('aiad.l.user', 'Per person per minute'))}</label>
          <label className="inline-flex items-center gap-2">{t('aiad.l.ip', 'Per IP address per minute')} {numIn(cfg.limits.perIpPerMin, (v) => setG('limits', { perIpPerMin: v }), t('aiad.l.ip', 'Per IP address per minute'))}</label>
          <label className="inline-flex items-center gap-2">{t('aiad.l.global', 'Whole site per day')} {numIn(cfg.limits.globalPerDay, (v) => setG('limits', { globalPerDay: v }), t('aiad.l.global', 'Whole site per day'))}</label>
          <label className="inline-flex items-center gap-2">{t('aiad.l.ret', 'Keep per-person counts (days)')} {numIn(cfg.retentionDays, (v) => setCfg({ ...cfg, retentionDays: v }), t('aiad.l.ret', 'Keep per-person counts (days)'))}</label>
        </div>
        <p className="text-xs text-[var(--faint)] mt-2">{t('aiad.l.note', 'The moderation surfaces keep their own per-minute limits on the Moderation engine screen.')} <Link className="underline" to="/admin?s=modqueue">{t('adm.tab.modqueue', 'Moderation engine')}</Link></p>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><KeyRound size={14} className="text-[var(--accent-ink)]" aria-hidden />{t('aiad.keys', 'Keys for the writing helpers')}</h3>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={cfg.byok.enabled} onChange={(e) => setG('byok', { enabled: e.target.checked })} />{t('aiad.byok', 'Members may bring their own key (BYOK)')}</label>
        <label className="flex items-center gap-2 text-[13px] mt-1.5">{t('aiad.byok.day', 'Calls per member per day with their key')} {numIn(cfg.byok.perUserPerDay, (v) => setG('byok', { perUserPerDay: v }), t('aiad.byok.day', 'Calls per member per day with their key'))}</label>
        <div className="mt-3 pt-3 border-t border-[var(--line)]">
          <div className="text-[13px] font-medium mb-1">{t('aiad.sk', 'Site key')}</div>
          {key?.set
            ? <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-mono px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)]" title={key.host}>{key.host} · ••••{key.last4}{key.model ? ` · ${key.model}` : ''}</span>
                {isAdmin && <Button size="sm" variant="danger" onClick={dropKey} disabled={busy}><Trash2 size={14} aria-hidden /> {t('aic.rm', 'Remove')}</Button>}</div>
            : isAdmin
              ? <div className="grid gap-2 sm:grid-cols-2 min-w-0">
                  <Input aria-label={t('aic.url', 'Provider address')} placeholder="https://api.example.com/v1" value={sk.baseUrl} onChange={(e) => setSk({ ...sk, baseUrl: e.target.value })} />
                  <Input aria-label={t('aic.model', 'Model (optional)')} placeholder={t('aic.model', 'Model (optional)')} value={sk.model} onChange={(e) => setSk({ ...sk, model: e.target.value })} />
                  <Input className="sm:col-span-2" type="password" autoComplete="off" aria-label={t('aic.key', 'API key')} placeholder={t('aic.key', 'API key')} value={sk.key} onChange={(e) => setSk({ ...sk, key: e.target.value })} />
                  <div className="sm:col-span-2"><Button size="sm" onClick={saveKey} disabled={busy || sk.key.trim().length < 8}><Save size={14} aria-hidden /> {t('aiad.sk.save', 'Seal and save')}</Button></div>
                </div>
              : <p className="text-xs text-[var(--muted)]">{t('aiad.sk.admin', 'Only an admin can set the site key.')}</p>}
          <label className="flex items-center gap-2 text-[13px] mt-2"><input type="checkbox" checked={cfg.site.forStaff} onChange={(e) => setG('site', { forStaff: e.target.checked })} />{t('aiad.sk.staff', 'Use it for the staff tools (summaries)')}</label>
          <label className="flex items-center gap-2 text-[13px] mt-1"><input type="checkbox" checked={cfg.site.forPaid} onChange={(e) => setG('site', { forPaid: e.target.checked })} />{t('aiad.sk.paid', 'Include it in paid plans (paying members use it without a key of their own)')}</label>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] items-center mt-2">
            <label className="inline-flex items-center gap-2">{t('aiad.sk.user', 'Per person per day')} {numIn(cfg.site.perUserPerDay, (v) => setG('site', { perUserPerDay: v }), t('aiad.sk.user', 'Per person per day'))}</label>
            <label className="inline-flex items-center gap-2">{t('aiad.sk.global', 'Whole site per day')} {numIn(cfg.site.globalPerDay, (v) => setG('site', { globalPerDay: v }), t('aiad.sk.global', 'Whole site per day'))}</label>
          </div>
          <Explain summary={t('aiad.sk.priv.s', 'What the site key sends, and to whom.')}>
            <p className="text-xs text-[var(--muted)]">{t('aiad.sk.priv', 'A staff summary sends the thread\'s messages (roles, never names) to the provider above; a plan-included draft sends the member\'s name for the item and their notes. That provider becomes a processor of that text: name it in the privacy policy\'s processor list before you switch either on.')}</p>
          </Explain>
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">{t('aiad.cost', 'Cost estimate (US dollars per million tokens)')}</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] items-center">
          <span className="text-[var(--muted)]">{t('aiad.p.site', 'Site key')}</span>
          <label className="inline-flex items-center gap-2">{t('aiad.in', 'in')} {numIn(cfg.pricing.site.inPerMTok, (v) => setCfg({ ...cfg, pricing: { ...cfg.pricing, site: { ...cfg.pricing.site, inPerMTok: v } } }), t('aiad.in', 'in'), 0.01)}</label>
          <label className="inline-flex items-center gap-2">{t('aiad.out', 'out')} {numIn(cfg.pricing.site.outPerMTok, (v) => setCfg({ ...cfg, pricing: { ...cfg.pricing, site: { ...cfg.pricing.site, outPerMTok: v } } }), t('aiad.out', 'out'), 0.01)}</label>
          <span className="text-[var(--muted)] ms-3">{t('aiad.p.external', 'External API')}</span>
          <label className="inline-flex items-center gap-2">{t('aiad.in', 'in')} {numIn(cfg.pricing.external.inPerMTok, (v) => setCfg({ ...cfg, pricing: { ...cfg.pricing, external: { ...cfg.pricing.external, inPerMTok: v } } }), t('aiad.in', 'in'), 0.01)}</label>
          <label className="inline-flex items-center gap-2">{t('aiad.out', 'out')} {numIn(cfg.pricing.external.outPerMTok, (v) => setCfg({ ...cfg, pricing: { ...cfg.pricing, external: { ...cfg.pricing.external, outPerMTok: v } } }), t('aiad.out', 'out'), 0.01)}</label>
        </div>
      </Card>
      <div><Button variant="primary" onClick={save} disabled={busy}><Save size={14} aria-hidden /> {t('aiad.save', 'Save the AI feature settings')}</Button></div>
    </div>
  );
}

function StaffTools() {
  const { t } = useI18n();
  const toast = useToast();
  const [tri, setTri] = useState(null);
  const [dup, setDup] = useState(null);
  const [dupKind, setDupKind] = useState('feedback');
  const [crash, setCrash] = useState(null);
  const [sum, setSum] = useState({ kind: 'report', id: '', text: null, busy: false });
  const why = { held: t('aiad.why.held', 'held'), rules: t('aiad.why.rules', 'high rule score'), sensitive: t('aiad.why.sensitive', 'report or legal'), old: t('aiad.why.old', 'waiting over a day') };
  const fail = (e) => toast.error(e?.data?.error === 'feature_off' ? t('aiad.off', 'This tool is switched off in the settings.') : e?.data?.error === 'missing_permission' ? t('aiad.perm', 'This needs the Reports permission too.') : t('common.failed', 'Failed.'));
  const runTri = () => api.get('/admin/ai/triage').then(setTri).catch(fail);
  const runDup = () => api.get(`/admin/ai/duplicates?kind=${dupKind}`).then(setDup).catch(fail);
  const runCrash = () => api.get('/admin/ai/crash-clusters').then(setCrash).catch(fail);
  const runSum = async () => {
    setSum((s) => ({ ...s, busy: true, text: null }));
    try {
      const r = await api.post('/admin/ai/summarize', { kind: sum.kind, id: sum.id.trim() });
      if (r.ok) setSum((s) => ({ ...s, text: r.text, host: r.host, busy: false }));
      else { toast.error(r.reason === 'no_key' ? t('aiad.sum.nokey', 'No key: set the site key (and tick "staff tools"), or your own key in Settings.') : t('common.failed', 'Failed.')); setSum((s) => ({ ...s, busy: false })); }
    } catch (e) { fail(e); setSum((s) => ({ ...s, busy: false })); }
  };
  const CAUSE = {
    gpu_driver: t('aiad.c.gpu', 'Graphics driver'), out_of_memory: t('aiad.c.oom', 'Out of memory'), missing_dependency: t('aiad.c.dep', 'Missing file or dependency'),
    mod_conflict: t('aiad.c.conflict', 'Mod conflict'), corrupted_file: t('aiad.c.corrupt', 'Corrupted file'), permission: t('aiad.c.perm', 'Permissions or antivirus'),
    game_update: t('aiad.c.update', 'Game or launcher update'), other: t('aiad.c.other', 'Other'),
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2"><ListOrdered size={15} className="text-[var(--accent-ink)]" aria-hidden /><h3 className="text-sm font-semibold">{t('aiad.f.triage', 'Queue triage')}</h3>
          <Button size="sm" className="ms-auto" onClick={runTri}>{t('aiad.run', 'Rank the queue')}</Button></div>
        <p className="text-xs text-[var(--muted)]">{t('aiad.tri.s', 'The open moderation cases in the order to read them: held content first, then the rules\' score, then the AI\'s signal, then age. Uses no AI call.')}</p>
        {tri && (tri.cases.length ? (
          <ol className="mt-2 text-xs divide-y divide-[var(--line)]">
            {tri.cases.slice(0, 30).map((c) => (
              <li key={c.id} className="py-1.5 flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold w-10">{c.triage.score}</span>
                <Badge>{c.surface.replace(/_/g, ' ')}</Badge>
                <span className="text-[var(--muted)]">{c.decision}</span>
                {c.triage.why.map((w) => <Badge key={w} tone="primary">{why[w] || w.replace('ai:', 'AI: ')}</Badge>)}
                <Link to={`/admin?s=modqueue&case=${c.id}`} className="underline ms-auto">{t('aiad.open', 'Open')}</Link>
                {c.excerpt && <span className="basis-full text-[var(--faint)] truncate" title={c.excerpt}>{c.excerpt}</span>}
              </li>
            ))}
          </ol>
        ) : <EmptyState title={t('aiad.tri.none', 'The queue is empty.')} />)}
      </Card>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2"><Copy size={15} className="text-[var(--accent-ink)]" aria-hidden /><h3 className="text-sm font-semibold">{t('aiad.f.duplicates', 'Duplicate detection')}</h3>
          <Select className="!w-auto ms-auto" value={dupKind} onChange={(e) => setDupKind(e.target.value)} aria-label={t('aiad.dup.kind', 'What to compare')}>
            <option value="feedback">{t('aiad.dup.fb', 'Feedback and bug reports')}</option>
            <option value="reports">{t('aiad.dup.rep', 'Open reports')}</option>
          </Select>
          <Button size="sm" onClick={runDup}>{t('aiad.dup.run', 'Find duplicates')}</Button></div>
        <p className="text-xs text-[var(--muted)]">{t('aiad.dup.s', 'Groups items whose wording overlaps strongly (shared word sequences). Runs on our server, no AI call.')}</p>
        {dup && (dup.clusters.length ? (
          <ul className="mt-2 space-y-2 text-xs">
            {dup.clusters.slice(0, 20).map((c, i) => (
              <li key={i} className="rounded-lg border border-[var(--line)] p-2">
                <div className="text-[var(--muted)] mb-1">{t('aiad.dup.n', '{n} items, {p}% alike').replace('{n}', c.items.length).replace('{p}', Math.round(c.similarity * 100))}</div>
                {c.items.map((it) => <div key={it.id} className="truncate" title={it.label}><Link className="underline" to={dup.kind === 'reports' ? `/admin?s=reports&r=${encodeURIComponent(it.id)}` : `/admin?s=feedback&fb=${encodeURIComponent(it.id)}`}>{it.label || it.id}</Link></div>)}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-[var(--muted)]">{t('aiad.dup.none', 'No duplicates among the {n} items scanned.').replace('{n}', dup.scanned)}</p>)}
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2"><Cpu size={15} className="text-[var(--accent-ink)]" aria-hidden /><h3 className="text-sm font-semibold">{t('aiad.f.crash', 'Crash causes')}</h3>
          <Button size="sm" className="ms-auto" onClick={runCrash}>{t('aiad.crash.run', 'Group the crashes')}</Button></div>
        <p className="text-xs text-[var(--muted)]">{t('aiad.crash.s', 'Crashes grouped by their stack, largest first, each with a likely cause: from the classifier when the AI is on (8 groups at most per view), from keywords otherwise.')}</p>
        {crash && (crash.groups.length ? (
          <ul className="mt-2 text-xs divide-y divide-[var(--line)]">
            {crash.groups.map((g) => (
              <li key={g.sig} className="py-1.5 flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold w-10">{g.count}</span>
                <Badge tone={g.causeSource === 'ai' ? 'primary' : ''}>{CAUSE[g.cause] || g.cause}{g.causeSource === 'ai' ? ' · AI' : ''}</Badge>
                <span className="truncate max-w-[22rem]" title={g.title}>{g.title}</span>
                {g.versions.length > 0 && <span className="text-[var(--faint)]">{g.versions.join(', ')}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-[var(--muted)]">{t('aiad.crash.none', 'No crash reports yet.')}</p>)}
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2"><FileText size={15} className="text-[var(--accent-ink)]" aria-hidden /><h3 className="text-sm font-semibold">{t('aiad.f.summarize', 'Thread summaries')}</h3></div>
        <p className="text-xs text-[var(--muted)] mb-2">{t('aiad.sum.s', 'Summarises a report thread or a feedback item in a few points. It is sent to the site key\'s provider (or your own key); roles are sent, names are not.')}</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Select className="!w-auto" value={sum.kind} onChange={(e) => setSum({ ...sum, kind: e.target.value })} aria-label={t('aiad.sum.kind', 'What to summarise')}>
            <option value="report">{t('aiad.sum.report', 'Report')}</option>
            <option value="feedback">{t('aiad.sum.feedback', 'Feedback item')}</option>
          </Select>
          <Input className="!w-64" value={sum.id} placeholder={t('aiad.sum.id', 'Its id')} aria-label={t('aiad.sum.id', 'Its id')} onChange={(e) => setSum({ ...sum, id: e.target.value })} />
          <Button size="sm" onClick={runSum} disabled={sum.busy || !sum.id.trim()} loading={sum.busy}>{t('aiad.sum.run', 'Summarise')}</Button>
        </div>
        {sum.text && <div className="mt-2 rounded-lg border border-[var(--line)] p-2 text-xs whitespace-pre-wrap">{sum.text}<div className="mt-1 text-[11px] text-[var(--faint)]">{t('aiad.sum.via', 'Written by the AI at {h}. Check it against the thread.').replace('{h}', sum.host || '?')}</div></div>}
      </Card>
    </div>
  );
}

export default function AiAdminPanel({ isAdmin = false }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('usage');
  const tabs = useMemo(() => [
    { id: 'usage', icon: BarChart3, label: t('aiad.tab.usage', 'Usage') },
    { id: 'settings', icon: SlidersHorizontal, label: t('aiad.tab.settings', 'Features and limits') },
    { id: 'tools', icon: Wrench, label: t('aiad.tab.tools', 'Staff tools') },
  ], [t]);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label={t('aiad.title', 'AI')}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${tab === x.id ? 'tint-primary b-primary' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}>
            <x.icon size={14} aria-hidden className="text-[var(--accent-ink)]" />{x.label}
          </button>
        ))}
      </div>
      {tab === 'usage' && <Usage />}
      {tab === 'settings' && <Settings isAdmin={isAdmin} />}
      {tab === 'tools' && <StaffTools />}
    </div>
  );
}
export { AiAdminPanel };
