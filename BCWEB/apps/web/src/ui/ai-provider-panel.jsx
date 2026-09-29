// The AI provider layer, for the admin (agent-laya-bcweb). The moderation page
// (agent-moderation) places it; nothing here decides anything the API does not decide again.
//
// What it shows, top to bottom: the kill switch (the one control that has to be findable in a
// hurry), the provider and the global switch, health and load (queue, in flight, p50/p95, the
// last error, the counters), the per-surface toggles plus the BMM helper, the performance
// knobs, and a test box. The rules themselves live in apps/api/src/lib/moderation/ai.mjs and
// routes/ai.mjs; this edits AdminSetting `ai.config` and `ai.killed` through /admin/ai/*.
//
// It never sees a URL or a key: the external provider's address and key are environment
// variables only, and the API reports "configured / valid" and nothing else about them.
import { useEffect, useState } from 'react';
import { Cpu, Power, RefreshCw, Save, FlaskConical, AlertTriangle, ShieldOff } from 'lucide-react';
import { Button, Card, Input, Select, Spinner, Textarea, Explain, Badge, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const SURFACES = ['contact', 'report', 'legal', 'crash', 'bug', 'suggestion', 'member_message', 'team_message', 'community', 'discord_automod', 'phishing'];
// The knobs, with the API's own bounds (AI_BOUNDS in lib/moderation/ai.mjs). The API clamps
// again; these only keep the fields honest while typing.
const KNOBS = [
  { k: 'timeoutMs', min: 200, max: 10000 },
  { k: 'concurrency', min: 1, max: 8 },
  { k: 'maxQueue', min: 0, max: 200 },
  { k: 'queueWaitMs', min: 0, max: 10000 },
  { k: 'maxChars', min: 200, max: 8000 },
  { k: 'breakerFailures', min: 1, max: 100 },
  { k: 'breakerOpenSec', min: 5, max: 3600 },
  { k: 'perUserPerMin', min: 1, max: 600 },
  { k: 'globalPerMin', min: 1, max: 20000 },
  { k: 'cacheTtlSec', min: 0, max: 3600 },
];

function useLabels() {
  const { t } = useI18n();
  return {
    surface: {
      contact: t('aip.s.contact', 'Contact form'),
      report: t('aip.s.report', 'Reports (always ends in human review)'),
      legal: t('aip.s.legal', 'Legal and rights notices (always human review)'),
      crash: t('aip.s.crash', 'Crash reports'),
      bug: t('aip.s.bug', 'Bug reports'),
      suggestion: t('aip.s.suggestion', 'Suggestions'),
      member_message: t('aip.s.member_message', 'Messages between members'),
      team_message: t('aip.s.team_message', 'Team messages'),
      community: t('aip.s.community', 'Comments, reviews and showcase'),
      discord_automod: t('aip.s.discord_automod', 'Discord automod (paid servers only)'),
      phishing: t('aip.s.phishing', 'Phishing links anywhere'),
    },
    knob: {
      timeoutMs: t('aip.k.timeoutMs', 'Timeout per call (ms)'),
      concurrency: t('aip.k.concurrency', 'Calls at the same time'),
      maxQueue: t('aip.k.maxQueue', 'Waiting calls, at most'),
      queueWaitMs: t('aip.k.queueWaitMs', 'Longest wait in the queue (ms)'),
      maxChars: t('aip.k.maxChars', 'Characters sent, at most'),
      breakerFailures: t('aip.k.breakerFailures', 'Failures before pausing'),
      breakerOpenSec: t('aip.k.breakerOpenSec', 'Pause after failures (s)'),
      perUserPerMin: t('aip.k.perUserPerMin', 'Calls per person per minute'),
      globalPerMin: t('aip.k.globalPerMin', 'Calls per minute, whole site'),
      cacheTtlSec: t('aip.k.cacheTtlSec', 'Remember an answer for (s)'),
    },
    provider: {
      off: t('aip.p.off', 'Rules only (no AI)'),
      laya: t('aip.p.laya', 'Laya, on this server (sidecar)'),
      external: t('aip.p.external', 'External AI API'),
    },
    reason: {
      disabled: t('aip.r.disabled', 'AI is off, killed, or no provider is set.'),
      rate_limited: t('aip.r.rate_limited', 'Rate limit reached. Try again in a minute.'),
      busy: t('aip.r.busy', 'Busy: the queue is full or the provider is paused after failures.'),
      unavailable: t('aip.r.unavailable', 'The provider did not answer in time, or answered something unreadable.'),
      empty: t('aip.r.empty', 'Nothing left to send once the text was cleaned.'),
      invalid: t('aip.r.invalid', 'Invalid request.'),
    },
    label: {
      spam: t('aip.l.spam', 'Spam'), phishing: t('aip.l.phishing', 'Phishing'), toxic: t('aip.l.toxic', 'Toxic'),
      troll: t('aip.l.troll', 'Troll'), off_topic: t('aip.l.off_topic', 'Off topic'), legal_threat: t('aip.l.legal_threat', 'Legal threat'),
      self_harm: t('aip.l.self_harm', 'Self-harm'),
    },
  };
}

const Row = ({ on, onChange, disabled, children }) => (
  <label className={`flex items-start gap-2 text-[13px] min-w-0 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <input type="checkbox" className="mt-0.5" checked={!!on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="min-w-0">{children}</span>
  </label>
);
const ms = (n) => (n == null ? '–' : `${Math.round(n)} ms`);

// canUnkill: releasing the kill switch is an ADMIN's call (the server refuses anybody else);
// the panel itself is open to manage_moderation, which is what the other /admin/ai doors ask.
export default function AiProviderPanel({ canUnkill = true } = {}) {
  const { t } = useI18n();
  const toast = useToast();
  const L = useLabels();
  const [st, setSt] = useState(null);      // GET /admin/ai → { status }
  const [cfg, setCfg] = useState(null);    // the draft config
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState({ surface: 'community', text: '', result: null, busy: false });

  const load = async () => {
    try {
      const r = await api.get('/admin/ai');
      setSt(r.status);
      setCfg((c) => c || r.status?.config || null);
    } catch { setSt(false); }
  };
  useEffect(() => { load(); }, []);
  // Health and load move on their own: refresh them (not the draft) every 10 s while open.
  useEffect(() => {
    const id = setInterval(() => { api.get('/admin/ai').then((r) => setSt(r.status)).catch(() => {}); }, 10_000);
    return () => clearInterval(id);
  }, []);

  if (st === null) return <Card className="p-4 grid place-items-center"><Spinner /></Card>;
  if (st === false || !cfg) return <Card className="p-4 text-sm text-[var(--muted)]">{t('aip.loadfail', 'The AI settings could not be loaded.')}</Card>;

  const set = (patch) => setCfg({ ...cfg, ...patch });
  const setSurface = (s, on) => setCfg({ ...cfg, surfaces: { ...cfg.surfaces, [s]: on } });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...cfg };
      for (const { k, min, max } of KNOBS) body[k] = Math.max(min, Math.min(max, Math.round(Number(body[k]) || min)));
      body.thresholds = { flag: Number(cfg.thresholds?.flag) || 0.8, review: Number(cfg.thresholds?.review) || 0.92 };
      const r = await api.put('/admin/ai/config', body);
      setCfg(r.config);
      await load();
      toast.success(t('aip.saved', 'AI settings saved. Every server picks them up within a few seconds.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const kill = async (killed) => {
    setBusy(true);
    try {
      await api.post('/admin/ai/kill', { killed });
      await load();
      toast.success(killed ? t('aip.killed.ok', 'AI cut. The rules keep running.') : t('aip.unkilled.ok', 'Kill switch released.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setTest({ ...test, busy: true, result: null });
    try {
      const r = await api.post('/admin/ai/test', { surface: test.surface, text: test.text });
      setTest((x) => ({ ...x, busy: false, result: r }));
    } catch { setTest((x) => ({ ...x, busy: false, result: { ok: false, reason: 'invalid' } })); }
  };

  const envKilled = st.killedBy === 'env';
  const off = cfg.provider === 'off';
  const c = st.counts || {};
  const testDisabled = off || st.killed || test.busy || !test.text.trim();

  return (
    <div className="space-y-3">
      {/* The kill switch first: the one thing that has to be found in a hurry. */}
      <Card className={`p-4 flex flex-wrap items-center gap-3 ${st.killed ? 'border-[var(--error-border)]' : ''}`}>
        <ShieldOff size={18} className={st.killed ? 'text-[var(--error)]' : 'text-[var(--muted)]'} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{st.killed ? t('aip.kill.on', 'AI is cut (kill switch on)') : t('aip.kill.off', 'Kill switch')}</div>
          <div className="text-xs text-[var(--muted)]">
            {envKilled ? t('aip.kill.env', 'Cut by the server environment (AI_KILL_SWITCH=1). Only the operator can release it.')
              : t('aip.kill.s', 'Cuts every AI call at once. The rules engine keeps running.')}
          </div>
        </div>
        {st.killed
          ? <Button size="sm" disabled={busy || envKilled || !canUnkill} title={!canUnkill ? t('modq.ai.unkill.perm', 'Only an admin can switch the AI back on.') : undefined} onClick={() => kill(false)}><Power size={14} /> {t('aip.kill.release', 'Release')}</Button>
          : <Button size="sm" variant="danger" disabled={busy} onClick={() => kill(true)}><Power size={14} /> {t('aip.kill.cut', 'Cut AI now')}</Button>}
      </Card>

      {/* Provider + global switch + status */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu size={15} className="text-[var(--accent-ink)]" aria-hidden="true" />
          <div className="font-semibold text-sm">{t('aip.title', 'AI provider')}</div>
          <Badge tone={st.healthy ? 'success' : off ? '' : 'warning'}>
            {off ? t('aip.h.off', 'Off') : st.killed ? t('aip.h.killed', 'Killed') : st.healthy ? t('aip.h.ok', 'Healthy') : t('aip.h.down', 'Not reachable')}
          </Badge>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={load} aria-label={t('aip.refresh', 'Refresh')} title={t('aip.refresh', 'Refresh')}><RefreshCw size={14} /></Button>
        </div>
        <Explain summary={t('aip.what.s', 'AI here is a signal that can send an item to review, never the judge.')}>
          <p>{t('aip.what.1', 'Laya is a classifier: it scores a text (spam, phishing, toxic, troll, off topic, legal threat) and never writes anything. Its accuracy is modest, so a high score raises a case for a person to look at; the rules decide, and reports and legal notices always end with a human.')}</p>
          <p>{t('aip.what.2', 'Laya runs in its own container (compose profile "ai"), never inside the API. The external provider is a third party: turning it on sends the checked texts to them, which the privacy policy must say.')}</p>
        </Explain>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
            {t('aip.provider', 'Provider')}
            <Select value={cfg.provider} onChange={(e) => set({ provider: e.target.value })} disabled={(st.envOverrides || []).includes('provider')}>
              {['off', 'laya', 'external'].map((p) => <option key={p} value={p}>{L.provider[p]}</option>)}
            </Select>
            {(st.envOverrides || []).includes('provider') && <span className="text-warning">{t('aip.provider.env', 'Set by AI_PROVIDER in the server environment.')}</span>}
          </label>
          <div className="flex flex-col gap-1.5 justify-end">
            <Row on={cfg.enabled} onChange={(on) => set({ enabled: on })} disabled={off}>{t('aip.enabled', 'AI on (global switch)')}</Row>
            <Row on={cfg.bmmSuggest} onChange={(on) => set({ bmmSuggest: on })} disabled={off}>{t('aip.bmm', 'BMM helper: tags, category, language, crash cause (POST /api/ai/bmm/suggest)')}</Row>
          </div>
        </div>
        {cfg.provider === 'external' && (
          <div className="text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0">
              {!st.external?.configured ? t('aip.ext.none', 'No external API is configured: set AI_EXTERNAL_URL and AI_EXTERNAL_KEY in the server environment. They are never stored or shown here.')
                : !st.external?.valid ? t('aip.ext.bad', 'The configured AI_EXTERNAL_URL is refused (it must be https and public). Reason: {r}').replace('{r}', st.external?.error || '?')
                  : t('aip.ext.ok', 'An external API is configured. Checked texts are sent to that third party.')}
            </span>
          </div>
        )}
        {cfg.provider === 'external' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
              {t('aip.ext.mode', 'Endpoint')}
              <Select value={cfg.externalMode} onChange={(e) => set({ externalMode: e.target.value })}>
                <option value="moderations">{t('aip.ext.mode.mod', 'Moderation (/moderations): toxic and self-harm only')}</option>
                <option value="chat">{t('aip.ext.mode.chat', 'Chat classification (/chat/completions): every label')}</option>
              </Select>
            </label>
            <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
              {t('aip.ext.model', 'Model name (optional)')}
              <Input value={cfg.externalModel || ''} maxLength={80} onChange={(e) => set({ externalModel: e.target.value.replace(/[^\w.:/-]/g, '') })} />
            </label>
          </div>
        )}
        {cfg.provider === 'laya' && !st.layaKeySet && (
          <p className="text-xs text-warning">{t('aip.laya.nokey', 'LAYA_API_KEY is not set: the sidecar accepts any caller on its network. Set the same key on both sides.')}</p>
        )}
        {/* Load, as numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><div className="text-[var(--muted)]">{t('aip.m.queue', 'Queue')}</div><div className="font-mono">{st.queueDepth ?? 0} · {t('aip.m.inflight', 'running')} {st.inFlight ?? 0}</div></div>
          <div><div className="text-[var(--muted)]">{t('aip.m.lat', 'Latency p50 / p95')}</div><div className="font-mono">{ms(st.p50)} / {ms(st.p95)}</div></div>
          <div><div className="text-[var(--muted)]">{t('aip.m.calls', 'Calls ok / failed / timed out')}</div><div className="font-mono">{c.ok || 0} / {c.failed || 0} / {c.timeout || 0}</div></div>
          <div><div className="text-[var(--muted)]">{t('aip.m.shed', 'Dropped / limited / cached')}</div><div className="font-mono">{c.dropped || 0} / {c.rateLimited || 0} / {c.cacheHit || 0}</div></div>
        </div>
        {st.breaker?.open && <p className="text-xs text-warning">{t('aip.breaker', 'Paused after repeated failures until {at}.').replace('{at}', new Date(st.breaker.openUntil).toLocaleTimeString())}</p>}
        {st.lastError && <p className="text-xs text-[var(--muted)] break-words">{t('aip.lasterr', 'Last error ({at}): {m}').replace('{at}', new Date(st.lastError.at).toLocaleString()).replace('{m}', st.lastError.message)}</p>}
      </Card>

      {/* Where it runs */}
      <Card className="p-4 space-y-2">
        <div className="font-semibold text-sm">{t('aip.surfaces', 'Where AI is asked')}</div>
        <div className="text-xs text-[var(--muted)]">{t('aip.surfaces.s', 'Each place is off until ticked here, and only counts while the global switch is on.')}</div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {SURFACES.map((s) => <Row key={s} on={cfg.surfaces?.[s]} disabled={off} onChange={(on) => setSurface(s, on)}>{L.surface[s]}</Row>)}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
            {t('aip.th.flag', 'Score that flags (0.5 to 0.99)')}
            <Input type="number" step="0.01" min="0.5" max="0.99" value={cfg.thresholds?.flag ?? 0.8} onChange={(e) => set({ thresholds: { ...cfg.thresholds, flag: e.target.value } })} />
          </label>
          <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
            {t('aip.th.review', 'Score that asks for review (0.5 to 0.999)')}
            <Input type="number" step="0.01" min="0.5" max="0.999" value={cfg.thresholds?.review ?? 0.92} onChange={(e) => set({ thresholds: { ...cfg.thresholds, review: e.target.value } })} />
          </label>
        </div>
      </Card>

      {/* Performance knobs */}
      <Card className="p-4 space-y-2">
        <div className="font-semibold text-sm">{t('aip.perf', 'Limits (so AI never slows the site)')}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {KNOBS.map(({ k, min, max }) => (
            <label key={k} className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
              <span className="truncate" title={L.knob[k]}>{L.knob[k]}</span>
              <Input type="number" min={min} max={max} value={cfg[k] ?? ''} disabled={(st.envOverrides || []).includes(k)} onChange={(e) => set({ [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {(st.envOverrides || []).length > 0 && <p className="text-[11px] text-[var(--muted)]">{t('aip.envset', 'Greyed fields are set in the server environment, which wins over this screen.')}</p>}
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Save size={14} />} {t('common.save', 'Save')}</Button>
      </Card>

      {/* Test box */}
      <Card className="p-4 space-y-2">
        <div className="font-semibold text-sm flex items-center gap-2"><FlaskConical size={14} className="text-[var(--accent-ink)]" aria-hidden="true" /> {t('aip.test', 'Try it')}</div>
        <div className="text-xs text-[var(--muted)]">{off ? t('aip.test.off', 'Pick a provider first.') : t('aip.test.s', 'One real call with the saved settings, even while the global switch or the place is off. Never while killed.')}</div>
        <div className="grid sm:grid-cols-[14rem_minmax(0,1fr)] gap-2">
          <Select value={test.surface} onChange={(e) => setTest({ ...test, surface: e.target.value })} disabled={off} aria-label={t('aip.test.surface', 'Place')}>
            {SURFACES.map((s) => <option key={s} value={s}>{L.surface[s]}</option>)}
          </Select>
          <Textarea rows={3} maxLength={4000} value={test.text} disabled={off} onChange={(e) => setTest({ ...test, text: e.target.value })} placeholder={t('aip.test.ph', 'Paste a message to score')} aria-label={t('aip.test.text', 'Text to score')} />
        </div>
        <Button size="sm" disabled={testDisabled} onClick={runTest}>{test.busy ? <Spinner /> : <FlaskConical size={14} />} {t('aip.test.run', 'Score it')}</Button>
        {test.result && (test.result.ok ? (
          <div className="text-xs space-y-1">
            <div className="text-[var(--muted)]">{t('aip.test.took', '{p} answered in {ms}.').replace('{p}', test.result.result.provider).replace('{ms}', ms(test.result.result.latencyMs))}</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(test.result.result.labels || {}).map(([k, v]) => (
                <Badge key={k} tone={v >= (cfg.thresholds?.review ?? 0.92) ? 'error' : v >= (cfg.thresholds?.flag ?? 0.8) ? 'warning' : ''}>{L.label[k] || k} {Math.round(v * 100)}%</Badge>
              ))}
              {test.result.result.category && <Badge>{t('aip.test.cat', 'Category')}: {test.result.result.category}</Badge>}
            </div>
          </div>
        ) : <p className="text-xs text-warning">{L.reason[test.result.reason] || L.reason.unavailable}</p>)}
      </Card>
    </div>
  );
}

export { AiProviderPanel };
