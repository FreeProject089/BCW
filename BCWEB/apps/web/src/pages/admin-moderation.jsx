// Admin -> Moderation -> Moderation engine (agent-moderation).
//
// The rules-first engine of apps/api/src/lib/moderation, in five tabs:
//
//   Queue      the cases a person has to look at: held content first, then by score. A case
//              opens in a panel with the reasons that fired, what the AI said (when it was
//              asked), where the content lives, and the actions that make sense for it.
//   Policies   per surface: what the engine may do (auto / flag / review / analyze), the four
//              thresholds, AI toggles, staff notices, flood limits. Report and legal are fixed
//              to review: the server refuses anything else.
//   Rules      the admin's own lists (keywords, patterns, domains, protected brands, weights)
//              and a "test this text" box that runs every rule without storing or counting.
//   Stats      counts per surface and decision, how cases were closed, the false-positive rate.
//   AI         the AI layer's status, the GLOBAL kill switch, per-surface use, and the provider
//              panel (agent-laya-bcweb's ui/ai-provider-panel.jsx) when it is there.
//
// The queue is open to MODs; changing policies, rules or the kill switch needs
// manage_moderation (the server says so again on every write).
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, RefreshCw, Save, FlaskConical, Power, BarChart3, Sliders, ListChecks, Cpu, ExternalLink, Inbox, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { lazyNamed } from '../lib/lazy-chunk.js';
import { ErrorBoundary } from '../ui/ErrorBoundary.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, EmptyState, Spinner, Modal, useToast, useDialog, Explain } from '../ui/ui.jsx';

// The provider configuration belongs to the AI layer's own panel, loaded on demand (only an
// admin ever opens it). lazyNamed survives a redeploy that renamed the chunk, and the
// ErrorBoundary below keeps a crash in the panel inside the panel's card.
const AiProviderPanel = lazyNamed(() => import('../ui/ai-provider-panel.jsx'), 'AiProviderPanel');

const SURFACE_IDS = ['contact', 'report', 'legal', 'crash', 'bug', 'suggestion', 'member_message', 'team_message', 'community', 'discord_automod', 'phishing'];
const DECISIONS = ['ALLOW', 'FLAG', 'REVIEW', 'QUARANTINE', 'BLOCK'];
const TONE = { ALLOW: 'success', FLAG: 'blue', REVIEW: 'warning', QUARANTINE: 'amber', BLOCK: 'red' };
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const when = (d) => (d ? new Date(d).toLocaleString() : '');

function useLabels() {
  const { t } = useI18n();
  return useMemo(() => ({
    surface: {
      contact: t('modq.s.contact', 'Contact form'), report: t('modq.s.report', 'Reports'), legal: t('modq.s.legal', 'Legal requests'),
      crash: t('modq.s.crash', 'Crash reports'), bug: t('modq.s.bug', 'Bug reports'), suggestion: t('modq.s.suggestion', 'Suggestions'),
      member_message: t('modq.s.member', 'Messages between members'), team_message: t('modq.s.team', 'Team messages'),
      community: t('modq.s.community', 'Community content'), discord_automod: t('modq.s.discord', 'Discord automod'), phishing: t('modq.s.phishing', 'Phishing check (bot)'),
    },
    decision: {
      ALLOW: t('modq.d.allow', 'Allow'), FLAG: t('modq.d.flag', 'Flag'), REVIEW: t('modq.d.review', 'Review'), QUARANTINE: t('modq.d.quarantine', 'Quarantine'), BLOCK: t('modq.d.block', 'Block'),
    },
    mode: {
      auto: t('modq.m.auto', 'Act automatically'), flag: t('modq.m.flag', 'Flag only'), review: t('modq.m.review', 'Manual review'), analyze: t('modq.m.analyze', 'Analysis only'),
    },
    action: {
      approve: t('modq.a.approve', 'Approve'), release: t('modq.a.release', 'Release'), remove: t('modq.a.remove', 'Remove'),
      sanction: t('modq.a.sanction', 'Warn the author'), false_positive: t('modq.a.fp', 'False positive'), dismiss: t('modq.a.dismiss', 'Dismiss'),
    },
    status: { open: t('modq.st.open', 'Open'), resolved: t('modq.st.resolved', 'Resolved'), dismissed: t('modq.st.dismissed', 'Dismissed'), logged: t('modq.st.logged', 'Analysis only'), all: t('modq.st.all', 'All') },
  }), [t]);
}

export function AdminModeration({ canConfig = false, isAdmin = false }) {
  const { t } = useI18n();
  const L = useLabels();
  const initialCase = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('case') : null;
  const [tab, setTab] = useState('queue');
  const [openId, setOpenId] = useState(initialCase);
  const tabs = [
    { id: 'queue', icon: Inbox, label: t('modq.tab.queue', 'Queue') },
    { id: 'policies', icon: Sliders, label: t('modq.tab.policies', 'Policies') },
    { id: 'rules', icon: ListChecks, label: t('modq.tab.rules', 'Rules & test') },
    { id: 'stats', icon: BarChart3, label: t('modq.tab.stats', 'Stats') },
    { id: 'ai', icon: Cpu, label: t('modq.tab.ai', 'AI') },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert size={18} className="text-[var(--accent-ink)]" />
        <h2 className="text-lg font-semibold">{t('modq.title', 'Moderation engine')}</h2>
      </div>
      <Explain summary={t('modq.intro.s', 'Rules first, a person for anything that matters, AI only as an optional signal.')}>
        {t('modq.intro.b', 'Every surface where content enters the site runs the same rules: links, keyword and pattern lists, shape heuristics, flood and duplicate counters, author trust. Each rule adds a weighted reason; the policy of the surface turns the score into a decision. Reports and legal requests always go to a person. The AI layer is asked only when the rules are unsure, never takes a final decision, and the site works the same with it off.')}
      </Explain>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((x) => (
          <Button key={x.id} size="sm" variant={tab === x.id ? 'primary' : 'ghost'} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            <x.icon size={14} /> {x.label}
          </Button>
        ))}
      </div>
      {tab === 'queue' && <Queue L={L} onOpen={setOpenId} />}
      {tab === 'policies' && <Policies L={L} canConfig={canConfig} />}
      {tab === 'rules' && <Rules L={L} canConfig={canConfig} />}
      {tab === 'stats' && <Stats L={L} />}
      {tab === 'ai' && <AiPanel L={L} canConfig={canConfig} isAdmin={isAdmin} />}
      {openId && <CaseDetail id={openId} L={L} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Queue ───────────────────────────────────────────────────────────────────────────────────
function Queue({ L, onOpen }) {
  const { t } = useI18n();
  const [f, setF] = useState({ status: 'open', surface: '', decision: '', held: false, q: '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const qs = new URLSearchParams({ status: f.status, page: String(page), ...(f.surface ? { surface: f.surface } : {}), ...(f.decision ? { decision: f.decision } : {}), ...(f.held ? { held: 'true' } : {}), ...(f.q ? { q: f.q } : {}) }).toString();
  const data = useAsync(() => api.get(`/admin/moderation/cases?${qs}`), [qs]);
  useEffect(() => { const h = () => data.reload(true); window.addEventListener('bcw:moderation-changed', h); return () => window.removeEventListener('bcw:moderation-changed', h); });
  const set = (k, v) => { setPage(0); setF((x) => ({ ...x, [k]: v })); };
  const rows = data.data?.cases || [];
  const total = data.data?.total || 0;
  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-end gap-2">
        <Field label={t('modq.f.status', 'Status')}>
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['open', 'resolved', 'dismissed', 'logged', 'all'].map((s) => <option key={s} value={s}>{L.status[s]}</option>)}
          </Select>
        </Field>
        <Field label={t('modq.f.surface', 'Surface')}>
          <Select value={f.surface} onChange={(e) => set('surface', e.target.value)}>
            <option value="">{t('modq.f.any', 'Any')}</option>
            {SURFACE_IDS.map((s) => <option key={s} value={s}>{L.surface[s]}</option>)}
          </Select>
        </Field>
        <Field label={t('modq.f.decision', 'Decision')}>
          <Select value={f.decision} onChange={(e) => set('decision', e.target.value)}>
            <option value="">{t('modq.f.any', 'Any')}</option>
            {DECISIONS.map((d) => <option key={d} value={d}>{L.decision[d]}</option>)}
          </Select>
        </Field>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}>
          <Field label={t('modq.f.q', 'Search')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('modq.f.q.ph', 'Text, case id, account id')} />
          </Field>
          <Button type="submit" size="sm">{t('modq.f.go', 'Search')}</Button>
        </form>
        <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
          <input type="checkbox" checked={f.held} onChange={(e) => set('held', e.target.checked)} /> {t('modq.f.held', 'Held content only')}
        </label>
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => data.reload()} aria-label={t('modq.reload', 'Reload')} title={t('modq.reload', 'Reload')}><RefreshCw size={14} /></Button>
      </Card>
      {data.loading && !data.data ? <Spinner /> : data.err ? <p className="text-sm text-[var(--error)]">{t('modq.err', 'Could not load the queue.')}</p> : !rows.length ? (
        <EmptyState icon={ShieldAlert} title={t('modq.empty.t', 'Nothing waiting')} sub={t('modq.empty.s', 'Cases appear here when a rule fires on a surface whose policy flags, reviews or acts.')} />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="card w-full text-start p-3 hover:bg-[var(--surface-2)] transition flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={TONE[c.decision]}>{L.decision[c.decision] || c.decision}</Badge>
                {c.held && <Badge tone="amber"><Lock size={11} /> {t('modq.held', 'Held')}</Badge>}
                <Badge>{L.surface[c.surface] || c.surface}</Badge>
                <span className="text-[12px] text-[var(--muted)]">{fmt(t('modq.score', 'score {n}'), { n: c.score })}</span>
                <span className="text-[12px] text-[var(--faint)] ms-auto">{when(c.createdAt)}</span>
              </div>
              <div className="text-[13px] line-clamp-2 break-words">{c.excerpt || <span className="text-[var(--faint)]">{t('modq.noexcerpt', 'No text kept here: read it where it lives.')}</span>}</div>
              <div className="text-[12px] text-[var(--muted)] flex flex-wrap gap-x-3">
                <span>{c.author ? c.author.displayName : c.authorKey || t('modq.anon', 'anonymous')}</span>
                <span>{(c.reasons || []).filter((r) => r.weight > 0).slice(0, 3).map((r) => r.rule).join(' · ')}</span>
              </div>
            </button>
          ))}
          {total > rows.length && (
            <div className="flex items-center gap-2 text-sm">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>{t('modq.prev', 'Previous')}</Button>
              <span className="text-[var(--muted)]">{fmt(t('modq.page', 'Page {p} of {n}'), { p: page + 1, n: Math.ceil(total / (data.data.pageSize || 50)) })}</span>
              <Button size="sm" variant="ghost" disabled={(page + 1) * (data.data.pageSize || 50) >= total} onClick={() => setPage((n) => n + 1)}>{t('modq.next', 'Next')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CaseDetail({ id, L, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const data = useAsync(() => api.get(`/admin/moderation/cases/${encodeURIComponent(id)}`), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const c = data.data?.case;
  const act = async (action) => {
    const body = { action, ...(note.trim() ? { note: note.trim() } : {}) };
    if (action === 'sanction') {
      const reason = await dialog.prompt({ title: t('modq.sanc.t', 'Warn the author'), label: t('modq.sanc.l', 'Reason (sent to the author with a sanction code)'), okLabel: t('modq.sanc.ok', 'Issue the warning'), danger: true, multiline: true });
      if (!reason) return;
      body.reason = reason;
      body.remove = await dialog.confirm({ title: t('modq.sanc.rm.t', 'Remove the content too?'), message: t('modq.sanc.rm.m', 'Remove the content as well as warning its author.'), okLabel: t('modq.sanc.rm.ok', 'Remove it too'), cancelLabel: t('modq.sanc.rm.no', 'Keep it') });
    }
    if (action === 'remove') {
      const ok = await dialog.confirm({ title: t('modq.rm.t', 'Remove this content?'), message: t('modq.rm.m', 'It is taken out of its audience (hidden, filed as ignored or rejected). Nothing is deleted.'), okLabel: t('modq.a.remove', 'Remove'), danger: true });
      if (!ok) return;
    }
    if (action === 'false_positive') {
      const hosts = [...new Set((c.reasons || []).filter((r) => r.rule.startsWith('link.')).map((r) => String(r.detail || '').split(/[\s·(]/)[0]).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)))];
      if (hosts.length) {
        const allow = await dialog.prompt({ title: t('modq.fp.t', 'Allow these domains from now on?'), label: t('modq.fp.l', 'Domains to add to the allowlist, comma separated (leave empty for none)'), defaultValue: '', placeholder: hosts.join(', ') });
        if (allow === false || allow === null) return;
        body.allowDomains = String(allow || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
      }
    }
    setBusy(action);
    try {
      const r = await api.post(`/admin/moderation/cases/${encodeURIComponent(id)}/action`, body);
      toast.success(r.sanctionCode ? fmt(t('modq.done.sanc', 'Done. Sanction {code} issued.'), { code: r.sanctionCode }) : t('modq.done', 'Done.'));
      window.dispatchEvent(new Event('bcw:moderation-changed'));
      window.dispatchEvent(new Event('bcw:pending-changed'));
      onClose();
    } catch (e) {
      toast.error(e?.data?.error === 'missing_permission' ? t('modq.err.perm', 'You need the "Manage users" permission to sanction.') : t('modq.err.act', 'The action failed.'));
    } finally { setBusy(''); }
  };
  return (
    <Modal open onClose={onClose} title={t('modq.case', 'Moderation case')} icon={ShieldAlert} width="max-w-2xl">
      {!c ? (data.err ? <p className="text-sm text-[var(--error)]">{t('modq.err.case', 'This case could not be loaded.')}</p> : <Spinner />) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={TONE[c.decision]}>{L.decision[c.decision] || c.decision}</Badge>
            {c.rawDecision !== c.decision && <Badge>{fmt(t('modq.raw', 'rules said {d}'), { d: L.decision[c.rawDecision] || c.rawDecision })}</Badge>}
            {c.held && <Badge tone="amber"><Lock size={11} /> {t('modq.held', 'Held')}</Badge>}
            <Badge>{L.surface[c.surface] || c.surface}</Badge>
            <Badge>{L.mode[c.mode] || c.mode}</Badge>
            <span className="text-[12px] text-[var(--muted)]">{fmt(t('modq.score', 'score {n}'), { n: c.score })} · {when(c.createdAt)}</span>
          </div>
          <div>
            <div className="text-[12px] font-medium text-[var(--muted)] mb-1">{t('modq.content', 'Content')}</div>
            {c.excerpt ? <pre className="text-[13px] whitespace-pre-wrap break-words panel-quiet rounded-lg p-3 max-h-72 overflow-auto">{c.excerpt}</pre>
              : <p className="text-[13px] text-[var(--muted)]">{c.purged ? t('modq.purged', 'The text was purged by the retention setting. The decision and its reasons stay.') : t('modq.noexcerpt', 'No text kept here: read it where it lives.')}</p>}
            {c.source?.href && <a className="inline-flex items-center gap-1 text-[13px] underline mt-1.5" href={c.source.href}><ExternalLink size={12} /> {fmt(t('modq.source', 'Open in {where}'), { where: c.source.label })}</a>}
          </div>
          <div>
            <div className="text-[12px] font-medium text-[var(--muted)] mb-1">{t('modq.reasons', 'Why')}</div>
            <ul className="text-[13px] space-y-1">
              {(c.reasons || []).map((r, i) => (
                <li key={`${r.rule}-${i}`} className="flex gap-2 min-w-0">
                  <span className={`tabular-nums w-10 text-end shrink-0 ${r.weight > 0 ? '' : 'text-[var(--muted)]'}`}>{r.weight > 0 ? `+${r.weight}` : r.weight}</span>
                  <code className="shrink-0">{r.rule}</code>
                  <span className="text-[var(--muted)] break-words min-w-0">{r.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          {c.ai && (
            <div className="text-[13px]">
              <div className="text-[12px] font-medium text-[var(--muted)] mb-1">{t('modq.ai', 'AI signal (never a decision)')}</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{c.ai.provider}{c.ai.model ? ` · ${c.ai.model}` : ''}</Badge>
                {Object.entries(c.ai.labels || {}).map(([k, v]) => <Badge key={k} tone={v >= 0.75 ? 'warning' : ''}>{k} {Number(v).toFixed(2)}</Badge>)}
              </div>
            </div>
          )}
          <div className="text-[13px] text-[var(--muted)] flex flex-wrap gap-x-4 gap-y-1">
            <span>{t('modq.author', 'Author')}: {c.author ? <a className="underline" href={`/admin?s=users&q=${encodeURIComponent(c.author.id)}`}>{c.author.displayName}</a> : (c.authorKey || t('modq.anon', 'anonymous'))}</span>
            {c.priorCases > 0 && <span>{fmt(t('modq.prior', '{n} other case(s) from the same author'), { n: c.priorCases })}</span>}
            {c.resolution && <span>{fmt(t('modq.closed', 'Closed as {r} by {who}'), { r: c.resolution, who: c.resolver?.displayName || '?' })}</span>}
          </div>
          {c.actions?.length > 0 && (
            <div className="space-y-2">
              <Field label={t('modq.note', 'Note for the audit trail (optional)')}>
                <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {c.actions.map((a) => (
                  <Button key={a} size="sm" variant={a === 'remove' || a === 'sanction' ? 'danger' : a === 'approve' || a === 'release' ? 'primary' : 'default'} loading={busy === a} disabled={!!busy} onClick={() => act(a)}>{L.action[a] || a}</Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Policies ────────────────────────────────────────────────────────────────────────────────
function Policies({ L, canConfig }) {
  const { t } = useI18n();
  const toast = useToast();
  const data = useAsync(() => Promise.all([api.get('/admin/moderation/policies'), api.get('/admin/moderation/settings')]), []);
  const [draft, setDraft] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data.data) { setDraft(data.data[0].policies); setSettings(data.data[1].settings); } }, [data.data]);
  if (!draft || !settings) return data.err ? <p className="text-sm text-[var(--error)]">{t('modq.err', 'Could not load the queue.')}</p> : <Spinner />;
  const sensitive = data.data[0].sensitive || [];
  const upd = (s, patch) => setDraft((d) => ({ ...d, [s]: { ...d[s], ...patch } }));
  const num = (v) => (v === '' ? '' : Number(v));
  const save = async () => {
    setSaving(true);
    try {
      const [a, b] = await Promise.all([api.put('/admin/moderation/policies', { policies: draft }), api.put('/admin/moderation/settings', settings)]);
      setDraft(a.policies); setSettings(b.settings);
      toast.success(t('modq.saved', 'Saved. The engine uses it within 15 seconds.'));
    } catch { toast.error(t('modq.err.save', 'Could not save.')); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" disabled={!canConfig} checked={settings.enabled} onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))} />
          {t('modq.set.enabled', 'The moderation engine is on')}
        </label>
        <Field label={t('modq.set.retention', 'Keep the text of closed cases (days)')} hint={t('modq.set.retention.h', 'After this, the text and any held copy are purged; the decision, reasons and who closed it stay.')}>
          <Input type="number" min={1} max={3650} disabled={!canConfig} value={settings.retentionDays} onChange={(e) => setSettings((s) => ({ ...s, retentionDays: num(e.target.value) }))} className="w-28" />
        </Field>
      </Card>
      <Explain summary={t('modq.pol.s', 'What each mode does.')}>
        {t('modq.pol.b', 'Act automatically: over the quarantine threshold the content is held until a moderator releases it, over the block threshold it is refused (or held, where the form cannot say no). Flag only: the content goes through and a case is opened. Manual review: the same, as a review case. Analysis only: nothing happens, the case is only logged for the stats.')}
      </Explain>
      <div className="space-y-2">
        {SURFACE_IDS.map((s) => {
          const p = draft[s];
          const fixed = sensitive.includes(s);
          return (
            <Card key={s} className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{L.surface[s]}</span>
                {fixed && <Badge tone="warning"><Lock size={11} /> {t('modq.pol.fixed', 'Always reviewed by a person')}</Badge>}
                <Select className="ms-auto w-auto" disabled={!canConfig || fixed} value={p.mode} onChange={(e) => upd(s, { mode: e.target.value })} aria-label={t('modq.pol.mode', 'Mode')}>
                  {['auto', 'flag', 'review', 'analyze'].filter((m) => !fixed || m !== 'auto').map((m) => <option key={m} value={m}>{L.mode[m]}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['flag', 'review', 'quarantine', 'block'].map((k) => (
                  <Field key={k} label={L.decision[k.toUpperCase()]}>
                    <Input type="number" min={1} max={1000} disabled={!canConfig} value={p.thresholds[k]} onChange={(e) => upd(s, { thresholds: { ...p.thresholds, [k]: num(e.target.value) } })} />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" disabled={!canConfig} checked={p.ai} onChange={(e) => upd(s, { ai: e.target.checked })} /> {t('modq.pol.ai', 'Ask the AI when unsure')}</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" disabled={!canConfig || !p.ai} checked={p.aiBlocking} onChange={(e) => upd(s, { aiBlocking: e.target.checked })} /> {t('modq.pol.aiwait', 'Wait for its answer (hard timeout)')}</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" disabled={!canConfig} checked={p.notify} onChange={(e) => upd(s, { notify: e.target.checked })} /> {t('modq.pol.notify', 'Notify staff of cases to review')}</label>
                <span className="flex items-center gap-1.5">{t('modq.pol.flood', 'Flood limit')}
                  <Input type="number" min={0} max={1000} disabled={!canConfig} value={p.flood.max} onChange={(e) => upd(s, { flood: { ...p.flood, max: num(e.target.value) } })} className="w-20" aria-label={t('modq.pol.flood.max', 'Messages allowed')} />
                  {t('modq.pol.flood.per', 'per')}
                  <Input type="number" min={1} max={86400} disabled={!canConfig} value={p.flood.windowSec} onChange={(e) => upd(s, { flood: { ...p.flood, windowSec: num(e.target.value) } })} className="w-24" aria-label={t('modq.pol.flood.win', 'Window in seconds')} />
                  {t('modq.pol.flood.sec', 'seconds')}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      {canConfig && <Button variant="primary" loading={saving} onClick={save}><Save size={14} /> {t('modq.save', 'Save')}</Button>}
    </div>
  );
}

// ── Rules & test ────────────────────────────────────────────────────────────────────────────
const linesOf = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const toText = {
  keywords: (list) => list.map((k) => [k.term, k.weight, k.loose ? 'loose' : ''].filter((x) => x !== '').join(' | ')).join('\n'),
  patterns: (list) => list.map((p) => [p.pattern, p.weight, p.label].join(' | ')).join('\n'),
  brands: (list) => list.map((b) => `${b.brand}: ${b.domains.join(', ')}`).join('\n'),
  weights: (obj) => Object.entries(obj || {}).map(([k, v]) => `${k} = ${v}`).join('\n'),
};
const fromText = {
  keywords: (s) => linesOf(s).map((l) => { const [term, w, loose] = l.split('|').map((x) => x.trim()); return { term, weight: Number(w) || 25, loose: loose === 'loose' }; }),
  // The pattern itself may contain "|": only the LAST two "|" separate weight and label.
  patterns: (s) => linesOf(s).map((l) => { const parts = l.split(' | '); const label = parts.length >= 3 ? parts.pop() : ''; const w = parts.length >= 2 ? Number(parts.pop()) : 30; return { pattern: parts.join(' | '), weight: w || 30, label }; }),
  brands: (s) => linesOf(s).map((l) => { const [brand, doms] = l.split(':'); return { brand: (brand || '').trim(), domains: String(doms || '').split(',').map((d) => d.trim()).filter(Boolean) }; }),
  weights: (s) => Object.fromEntries(linesOf(s).map((l) => l.split('=').map((x) => x.trim())).filter(([k, v]) => k && v !== undefined && v !== '').map(([k, v]) => [k, Number(v)])),
};

function Rules({ L, canConfig }) {
  const { t } = useI18n();
  const toast = useToast();
  const data = useAsync(() => api.get('/admin/moderation/rules'), []);
  const [d, setD] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const r = data.data?.rules;
    if (r) setD({ keywords: toText.keywords(r.keywords), patterns: toText.patterns(r.patterns), block: r.blockDomains.join('\n'), allow: r.allowDomains.join('\n'), brands: toText.brands(r.protectedBrands), weights: toText.weights(r.weights), fp: r.falsePositives.length });
  }, [data.data]);
  if (!d) return data.err ? <p className="text-sm text-[var(--error)]">{t('modq.err', 'Could not load the queue.')}</p> : <Spinner />;
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const save = async (clearFp = false) => {
    setSaving(true); setErrors([]);
    try {
      await api.put('/admin/moderation/rules', { rules: {
        keywords: fromText.keywords(d.keywords), patterns: fromText.patterns(d.patterns),
        blockDomains: linesOf(d.block), allowDomains: linesOf(d.allow), protectedBrands: fromText.brands(d.brands), weights: fromText.weights(d.weights),
        ...(clearFp ? { falsePositives: [] } : {}),
      } });
      toast.success(t('modq.saved', 'Saved. The engine uses it within 15 seconds.'));
      data.reload(true);
    } catch (e) {
      if (e?.data?.errors) setErrors(e.data.errors);
      toast.error(t('modq.err.rules', 'Some entries were refused: see the list below.'));
    } finally { setSaving(false); }
  };
  const ERR = {
    nested_quantifier: t('modq.re.nested', 'a repeated group that can itself repeat (the shape of catastrophic backtracking)'),
    too_many_unbounded: t('modq.re.unbounded', 'more than one unbounded repeat (*, +, {n,}); use a bounded one like {0,20}'),
    backreference: t('modq.re.backref', 'backreferences are not allowed'),
    too_slow: t('modq.re.slow', 'too slow on a hostile input'),
    matches_empty: t('modq.re.empty', 'matches an empty text, so it would match everything'),
    invalid: t('modq.re.invalid', 'not a valid regular expression'),
    too_long: t('modq.re.long', 'longer than 200 characters'),
    too_short: t('modq.re.short', 'shorter than 2 characters'),
    not_a_domain: t('modq.re.domain', 'not a domain name'),
    brand_needs_name_and_domain: t('modq.re.brand', 'a brand needs a name (4+ letters) and at least one domain'),
  };
  const area = (k, label, hint, rows = 5) => (
    <Field label={label} hint={hint}>
      <Textarea rows={rows} value={d[k]} onChange={set(k)} disabled={!canConfig} spellCheck={false} className="font-mono text-[12px]" />
    </Field>
  );
  return (
    <div className="space-y-3">
      <TestBox L={L} />
      <Card className="p-4 space-y-3">
        {area('keywords', t('modq.r.kw', 'Keywords and phrases'), t('modq.r.kw.h', 'One per line: term | weight | loose. Matched as whole words after normalisation (case, accents, lookalike letters). "loose" also matches through leetspeak and spacing.'))}
        {area('patterns', t('modq.r.pat', 'Patterns (regular expressions)'), t('modq.r.pat.h', 'One per line: pattern | weight | label. Checked when saved: no nested repeats, at most one unbounded repeat, no backreferences, a timed test on hostile input.'))}
        <div className="grid sm:grid-cols-2 gap-3">
          {area('block', t('modq.r.block', 'Blocked domains'), t('modq.r.block.h', 'One per line. The domain and everything under it. The Terms blocklist (links refused from listings) is read too.'))}
          {area('allow', t('modq.r.allow', 'Allowed domains'), t('modq.r.allow.h', 'One per line. Links here skip every link check except script schemes. False positives can add to it.'))}
        </div>
        {area('brands', t('modq.r.brands', 'Extra protected brands'), fmt(t('modq.r.brands.h', 'One per line: brand: official.domain, other.domain. Built in: {list}.'), { list: (data.data.brands || []).map((b) => b.brand).join(', ') }), 3)}
        {area('weights', t('modq.r.weights', 'Weight overrides'), fmt(t('modq.r.weights.h', 'One per line: rule = weight (from -100 to 100). Rules: {list}.'), { list: Object.entries(data.data.builtin || {}).map(([k, v]) => `${k} ${v}`).join(', ') }), 4)}
        {errors.length > 0 && (
          <ul className="text-[13px] text-[var(--error)] space-y-0.5">
            {errors.map((e, i) => <li key={i}>{fmt(t('modq.r.errline', '{list}, line {n}: {why}'), { list: e.list, n: e.index + 1, why: ERR[e.error] || e.error })}{e.pattern ? ` (${e.pattern})` : ''}</li>)}
          </ul>
        )}
        {canConfig && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={saving} onClick={() => save(false)}><Save size={14} /> {t('modq.save', 'Save')}</Button>
            <span className="text-[12px] text-[var(--muted)]">{fmt(t('modq.r.fp', '{n} text(s) marked as false positives'), { n: d.fp })}</span>
            {d.fp > 0 && <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(true)}>{t('modq.r.fp.clear', 'Forget them')}</Button>}
          </div>
        )}
      </Card>
    </div>
  );
}

function TestBox({ L }) {
  const { t } = useI18n();
  const [surface, setSurface] = useState('contact');
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes((await api.post('/admin/moderation/test', { surface, text })).result); } catch { setRes(null); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2 font-medium text-sm"><FlaskConical size={15} /> {t('modq.test.t', 'Test this text')}</div>
      <p className="text-[12px] text-[var(--muted)]">{t('modq.test.s', 'Runs every rule exactly as a real message would, with the saved rules and policy. Nothing is stored or counted.')}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('modq.f.surface', 'Surface')}>
          <Select value={surface} onChange={(e) => setSurface(e.target.value)}>
            {SURFACE_IDS.map((s) => <option key={s} value={s}>{L.surface[s]}</option>)}
          </Select>
        </Field>
      </div>
      <Textarea rows={4} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder={t('modq.test.ph', 'Paste a message, a link, a report...')} />
      <Button size="sm" loading={busy} disabled={!text.trim()} onClick={run}>{t('modq.test.run', 'Run the rules')}</Button>
      {res && (
        <div className="space-y-1.5 text-[13px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={TONE[res.decision]}>{L.decision[res.decision] || res.decision}</Badge>
            {res.raw && res.raw !== res.decision && <Badge>{fmt(t('modq.raw', 'rules said {d}'), { d: L.decision[res.raw] || res.raw })}</Badge>}
            <span className="text-[var(--muted)]">{fmt(t('modq.score', 'score {n}'), { n: res.score })} · {fmt(t('modq.test.act', 'the form would: {a}'), { a: res.action })} · {res.ms} ms</span>
          </div>
          {res.reasons?.length ? (
            <ul className="space-y-0.5">
              {res.reasons.map((r, i) => <li key={`${r.rule}-${i}`} className="flex gap-2 min-w-0"><span className="tabular-nums w-10 text-end shrink-0">{r.weight > 0 ? `+${r.weight}` : r.weight}</span><code className="shrink-0">{r.rule}</code><span className="text-[var(--muted)] break-words min-w-0">{r.detail}</span></li>)}
            </ul>
          ) : <p className="text-[var(--muted)]">{t('modq.test.none', 'No rule fired.')}</p>}
        </div>
      )}
    </Card>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────────────────────
function Stats({ L }) {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const data = useAsync(() => api.get(`/admin/moderation/stats?days=${days}`), [days]);
  const s = data.data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto" aria-label={t('modq.stats.period', 'Period')}>
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>{fmt(t('modq.stats.days', 'Last {n} days'), { n })}</option>)}
        </Select>
      </div>
      {!s ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card className="p-3"><div className="text-[12px] text-[var(--muted)]">{t('modq.stats.open', 'Open cases')}</div><div className="text-xl font-semibold tabular-nums">{s.open}</div></Card>
            <Card className="p-3"><div className="text-[12px] text-[var(--muted)]">{t('modq.stats.held', 'Content held')}</div><div className="text-xl font-semibold tabular-nums">{s.held}</div></Card>
            <Card className="p-3"><div className="text-[12px] text-[var(--muted)]">{t('modq.stats.closed', 'Closed in the period')}</div><div className="text-xl font-semibold tabular-nums">{Object.values(s.resolutions || {}).reduce((a, n) => a + n, 0)}</div></Card>
            <Card className="p-3"><div className="text-[12px] text-[var(--muted)]">{t('modq.stats.fp', 'False-positive rate')}</div><div className="text-xl font-semibold tabular-nums">{s.falsePositiveRate == null ? '-' : `${Math.round(s.falsePositiveRate * 100)}%`}</div></Card>
          </div>
          <Card className="p-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-start text-[var(--muted)]"><th className="text-start font-medium py-1">{t('modq.f.surface', 'Surface')}</th>{DECISIONS.map((d) => <th key={d} className="text-end font-medium">{L.decision[d]}</th>)}<th className="text-end font-medium">{t('modq.stats.logged', 'Analysis only')}</th></tr></thead>
              <tbody>
                {SURFACE_IDS.filter((x) => s.surfaces[x]).map((x) => (
                  <tr key={x} className="border-t border-[var(--line)]">
                    <td className="py-1">{L.surface[x]}</td>
                    {DECISIONS.map((d) => <td key={d} className="text-end tabular-nums">{s.surfaces[x].decisions[d] || 0}</td>)}
                    <td className="text-end tabular-nums">{s.surfaces[x].logged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!Object.keys(s.surfaces).length && <p className="text-[var(--muted)] text-[13px] py-2">{t('modq.stats.none', 'No case in this period.')}</p>}
          </Card>
          {Object.keys(s.resolutions || {}).length > 0 && (
            <Card className="p-3 flex flex-wrap gap-1.5 text-[13px]">
              {Object.entries(s.resolutions).map(([k, n]) => <Badge key={k}>{k.replace(/_/g, ' ')} · {n}</Badge>)}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── AI ──────────────────────────────────────────────────────────────────────────────────────
function AiPanel({ L, canConfig, isAdmin }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const data = useAsync(() => api.get('/admin/moderation/ai'), []);
  const [busy, setBusy] = useState(false);
  const v = data.data;
  const kill = async (killed) => {
    if (killed) {
      const ok = await dialog.confirm({ title: t('modq.ai.kill.t', 'Stop the AI everywhere?'), message: t('modq.ai.kill.m', 'No surface asks the AI any more, at once. The rules keep working exactly as before.'), okLabel: t('modq.ai.kill.ok', 'Stop the AI'), danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try { await api.put('/admin/moderation/ai/kill', { killed }); data.reload(true); toast.success(killed ? t('modq.ai.killed', 'The AI is stopped.') : t('modq.ai.unkilled', 'The kill switch is off.')); }
    catch { toast.error(killed ? t('modq.err.save', 'Could not save.') : t('modq.ai.unkill.perm', 'Only an admin can switch the AI back on.')); } finally { setBusy(false); }
  };
  if (!v) return data.err ? <p className="text-sm text-[var(--error)]">{t('modq.err', 'Could not load the queue.')}</p> : <Spinner />;
  const st = v.status || {};
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu size={16} />
          <span className="font-medium">{t('modq.ai.status', 'AI layer')}</span>
          {!v.available ? <Badge>{t('modq.ai.absent', 'not installed')}</Badge> : <Badge tone={st.healthy ? 'success' : ''}>{st.provider || 'off'}{st.healthy ? ` · ${t('modq.ai.healthy', 'healthy')}` : ''}</Badge>}
          {v.killSwitch.killed && <Badge tone="red"><Power size={11} /> {t('modq.ai.killedb', 'killed')}{v.killSwitch.by === 'env' ? ' (AI_KILL_SWITCH)' : ''}</Badge>}
          {canConfig && (v.killSwitch.killed
            ? <Button size="sm" className="ms-auto" loading={busy} disabled={!isAdmin || v.killSwitch.by === 'env'} title={!isAdmin ? t('modq.ai.unkill.perm', 'Only an admin can switch the AI back on.') : undefined} onClick={() => kill(false)}>{t('modq.ai.unkill', 'Switch the AI back on')}</Button>
            : <Button size="sm" variant="danger" className="ms-auto" loading={busy} onClick={() => kill(true)}><Power size={14} /> {t('modq.ai.kill', 'Kill switch: stop the AI')}</Button>)}
        </div>
        {v.available && st && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
            <div><span className="text-[var(--muted)]">{t('modq.ai.p50', 'p50')}</span> {st.p50 != null ? `${st.p50} ms` : '-'}</div>
            <div><span className="text-[var(--muted)]">{t('modq.ai.p95', 'p95')}</span> {st.p95 != null ? `${st.p95} ms` : '-'}</div>
            <div><span className="text-[var(--muted)]">{t('modq.ai.queue', 'In queue')}</span> {st.queueDepth ?? 0} / {st.inFlight ?? 0}</div>
            <div className="min-w-0 truncate" title={st.lastError || ''}><span className="text-[var(--muted)]">{t('modq.ai.lasterr', 'Last error')}</span> {st.lastError || '-'}</div>
          </div>
        )}
        <p className="text-[12px] text-[var(--muted)]">{t('modq.ai.note', 'The AI is a signal: it is asked only when the rules are unsure, it can raise a case to review at most, and it never closes a report or a legal request. With it off, killed or down, every surface works on rules alone.')}</p>
      </Card>
      <Card className="p-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[var(--muted)]"><th className="text-start font-medium py-1">{t('modq.f.surface', 'Surface')}</th><th className="text-center font-medium">{t('modq.ai.col.layer', 'AI layer allows')}</th><th className="text-center font-medium">{t('modq.ai.col.engine', 'Engine asks')}</th><th className="text-center font-medium">{t('modq.ai.col.wait', 'Waits for it')}</th></tr></thead>
          <tbody>
            {SURFACE_IDS.map((s) => {
              const x = v.surfaces[s] || {};
              const yes = (b) => (b ? t('modq.yes', 'yes') : t('modq.no', 'no'));
              return (
                <tr key={s} className="border-t border-[var(--line)]">
                  <td className="py-1">{L.surface[s]}</td>
                  <td className="text-center">{yes(x.enabledByLayer)}</td>
                  <td className="text-center">{yes(x.ai)}</td>
                  <td className="text-center">{yes(x.aiBlocking)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[12px] text-[var(--muted)] mt-2">{t('modq.ai.cols', 'The engine asks only where both say yes. "Engine asks" and "Waits for it" are set in Policies; "AI layer allows" in the provider settings below.')}</p>
      </Card>
      {/* The AI layer's provider configuration (ui/ai-provider-panel.jsx). */}
      {canConfig && (
        <ErrorBoundary fallback={<Card className="p-4 text-[13px] text-[var(--muted)]">{t('modq.ai.panelErr', 'The provider settings could not be loaded. Reload the page to try again.')}</Card>}>
          <Suspense fallback={<Spinner />}><AiProviderPanel canUnkill={isAdmin} /></Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
