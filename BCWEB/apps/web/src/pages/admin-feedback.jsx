// Admin → Feedback & crashes.
//
// EXTRACTED from admin.jsx, unchanged in what it already did — the project rail, the queue,
// the filters, the settings drawer, the reply box are the same screen — and given the two
// things it could not do:
//
//   1. GROUP crashes. The inbox was a list, so "is this one bug or forty" was a question you
//      answered by reading forty rows. `fingerprint` never answered it: it is a dedupe key,
//      hashed from the title plus the head of the body and only compared inside one sender's
//      dedupe window, so two people meeting the identical panic produce two of them. The new
//      /admin/feedback/crashes groups on a normalised STACK SIGNATURE instead and reports how
//      many distinct senders, over what period, on which versions.
//
//   2. READ a crash without leaving. A BMM crash arrives as a zip attachment, so understanding
//      one meant downloading somebody's machine, unzipping it and opening eight files
//      elsewhere. The bundle is opened HERE, in the browser, with the same reader /dev/tools
//      uses — and the signature it yields is posted back, so every crash anybody opens makes
//      the grouping of every future crash better.
//
// The bundle is read in the browser rather than on the server even though the server is
// holding it: unzipping arbitrary archives in the API is a decompression bomb waiting for a
// slow afternoon, and the limits are already written and tested on this side.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bug as BugIcon, Sliders, AlertTriangle, Clock, Trash2, Download, Users, Layers,
  Inbox, ShieldAlert, XCircle, Info, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, Spinner, Explain, useDialog, useToast } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';
import { analyseBundle, LIMITS } from '../lib/crash-bundle.js';

const FB_KIND_TONE = { feedback: 'success', bug: 'warning', crash: 'red' };
const FB_STATUS_TONE = { new: 'red', triaged: 'warning', resolved: 'success', ignored: '' };
const fmtAgo = (d) => { const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/**
 * A stack where the crash stands out and the machinery does not.
 *
 * Same idea as the client-error dashboard's renderer, tuned for what BMM produces: it captures
 * its backtrace inside the panic hook, so the top of every BMM trace is the backtrace crate,
 * std::panicking and crash.rs. Dimmed, never hidden — a dimmed line is still selectable, still
 * copied, and still there when the answer turns out to be in it.
 */
const NOISE = /backtrace::|std::panicking|core::panicking|rust_begin_unwind|__rust_|commands::crash|panic_hook|\.cargo[\\/]registry|[\\/]rustc[\\/]|node_modules|node:internal/;
function Trace({ text }) {
  const lines = String(text || '').split('\n');
  return (
    <pre className="text-[11px] font-mono panel rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[45vh]">
      {lines.map((ln, i) => (
        <div key={i} className={NOISE.test(ln)
          ? 'opacity-45 text-[var(--muted)]'
          : /^\s*(?:\d+:|at\s)/.test(ln) || /:\d+:\d+/.test(ln) ? 'text-[var(--text)] border-s-2 b-primary ps-2 -ms-2' : 'text-[var(--muted)]'}>
          {ln || ' '}
        </div>
      ))}
    </pre>
  );
}

/** A distribution as bars. Never a bare number clipped: the label carries a `title`. */
function Spread({ rows, total, label }) {
  if (!rows?.length) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{label}</div>
      {rows.slice(0, 5).map((r) => (
        <div key={r.k} className="flex items-center gap-2 text-[11px]">
          <span className="font-mono truncate min-w-0 w-28 shrink-0" title={r.k}>{r.k}</span>
          <span className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden min-w-[30px]">
            <span className="block h-full bg-warning" style={{ width: `${Math.max(4, Math.round((r.n / Math.max(1, total)) * 100))}%` }} />
          </span>
          <span className="tabular-nums text-[var(--faint)] w-8 text-end shrink-0">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminFeedbackCentre() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [cfg, setCfg] = useState(null);
  const [project, setProject] = useState(() => { try { return new URLSearchParams(location.search).get('p') || ''; } catch { return ''; } });
  const [view, setView] = useState('inbox');       // inbox | crashes
  const [kind, setKind] = useState(''); const [status, setStatus] = useState('new'); const [version, setVersion] = useState(''); const [sort, setSort] = useState('severity');
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState(''); const [page, setPage] = useState(0);
  const [days, setDays] = useState('30');
  const [open, setOpen] = useState(null); const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false); const [draft, setDraft] = useState(null); const [savingCfg, setSavingCfg] = useState(false);
  const [bundle, setBundle] = useState(null);      // { loading } | analysed bundle | { error }
  const [openGroup, setOpenGroup] = useState(null);

  const loadCfg = () => api.get('/admin/feedback/config').then((c) => { setCfg(c); if (!project) { const first = Object.keys(c.projects)[0] || c.knownProjects[0]?.key || ''; setProject(first); } }).catch(() => toast.error(t('common.failed', 'Failed.')));
  useEffect(() => { loadCfg(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = `project=${encodeURIComponent(project)}${kind ? `&kind=${kind}` : ''}${status ? `&status=${status}` : ''}${version ? `&version=${encodeURIComponent(version)}` : ''}${qApplied ? `&q=${encodeURIComponent(qApplied)}` : ''}&sort=${sort}&page=${page}`;
  const { data, loading, reload } = useAsync(() => project && view === 'inbox' ? api.get(`/admin/feedback?${qs}`) : Promise.resolve(null), [qs, view]);
  const crashes = useAsync(() => project && view === 'crashes' ? api.get(`/admin/feedback/crashes?project=${encodeURIComponent(project)}&days=${days}`) : Promise.resolve(null), [project, view, days]);

  const openItem = async (id) => {
    setBundle(null);
    try { const r = await api.get(`/admin/feedback/${id}`); setOpen(r.item); setReply(''); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const setSt = async (id, st) => { setBusy(true); try { const r = await api.post(`/admin/feedback/${id}/status`, { status: st }); setOpen((o) => o && o.id === id ? { ...o, status: r.item.status } : o); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); } };
  const send = async () => { if (!open || !reply.trim()) return; setBusy(true); try { const r = await api.post(`/admin/feedback/${open.id}/reply`, { body: reply.trim() }); toast.success(r.via === 'mail' ? t('fb.replied.mail', 'Sent by e-mail.') : t('fb.replied.thread', 'Posted in their dashboard thread.')); setReply(''); reload(); } catch (x) { toast.error(x.data?.error === 'no_channel' ? t('fb.nochannel', 'No way to reach this sender: no account and no e-mail.') : x.data?.error === 'mail_failed' ? t('fb.mailfail', 'The mail could not be sent.') : t('common.failed', 'Failed.')); } finally { setBusy(false); } };
  const del = async (id) => {
    // The site's own dialog. A browser confirm() puts the origin across the top, ignores the
    // theme and the language, and offers to suppress every future dialog on the page.
    if (!await dialog.confirm({
      title: t('fb.del.t', 'Delete this report?'),
      message: t('fb.del.confirm', 'Delete this report and its attachments?'),
      danger: true,
    })) return;
    try { await api.del(`/admin/feedback/${id}`); setOpen(null); setBundle(null); reload(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  /**
   * Open the attached crash bundle, here.
   *
   * The attachment is fetched as a Blob and handed straight to the same reader /dev/tools
   * uses. A Blob has `.size` and `.slice()`, which is the whole interface zip-read.js needs,
   * so the archive is read from its index without being written anywhere and without a zip
   * library entering the bundle.
   *
   * Then the trace goes back to the server, which derives the grouping signature from it.
   * Deriving it here would be a second implementation of the normalising rules, and the day
   * the two drift the same crash splits into two groups with nothing to report it.
   */
  const readBundle = async (item, att) => {
    setBundle({ loading: true });
    try {
      const res = await fetch(`/api/admin/feedback/${item.id}/attachments/${att.i}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const b = await analyseBundle(blob, { name: att.name });
      setBundle(b);
      if (!b.refused && (b.stack || b.meta?.reason)) {
        const r = await api.post(`/admin/feedback/${item.id}/crashsig`, {
          stack: String(b.stack || '').slice(0, 400_000),
          reason: String(b.meta?.reason || '').slice(0, 400),
          version: String(b.meta?.version || '').slice(0, 40),
        }).catch(() => null);
        if (r?.ok) setOpen((o) => (o && o.id === item.id ? { ...o, meta: { ...(o.meta || {}), _crash: r.crash } } : o));
      }
    } catch (e) {
      setBundle({ error: String(e?.message || e) });
      toast.error(t('fbx.bundlefail', 'The attached bundle could not be read here. Downloading it still works.'));
    }
  };

  // Settings draft: the project's block + the global limits, edited together, saved together.
  const startEdit = () => { const pc = cfg.projects[project] || cfg.defaults.project; setDraft({ project: { ...cfg.defaults.project, ...pc, kinds: { ...cfg.defaults.project.kinds, ...(pc.kinds || {}) } }, limits: JSON.parse(JSON.stringify(cfg.limits)) }); setShowSettings(true); };
  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const projects = { ...cfg.projects, [project]: draft.project };
      await api.put('/admin/feedback/config', { projects, limits: draft.limits });
      toast.success(t('fb.cfg.saved', 'Saved.')); setShowSettings(false); await loadCfg();
    } catch (x) { toast.error(t('fb.cfg.bad', 'Some value is out of range.') + (x.data?.detail?.path ? ` (${x.data.detail.path.join('.')})` : '')); }
    finally { setSavingCfg(false); }
  };
  const pd = (k, v) => setDraft((d) => ({ ...d, project: { ...d.project, [k]: v } }));
  const ld = (k, v) => setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: v } }));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => String(v || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  if (!cfg) return <div className="flex justify-center py-20 text-[var(--muted)]"><Spinner /></div>;
  const pc = cfg.projects[project];
  const projects = cfg.knownProjects;
  const counts = data?.counts || {};
  const zipAtt = (open?.attachments || []).filter((a) => /\.zip$/i.test(a.name) || a.type === 'application/zip');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><BugIcon size={16} className="text-[var(--accent-ink)]" /> {t('fb.title', 'Feedback & crashes')}</h2>
        <p className="text-sm text-[var(--muted)] mt-0.5">{t('fb.sub', 'What apps send through the feedback centre: suggestions, bug reports, crash dumps, one inbox per project, answered from here.')}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {projects.map((x) => <button key={x.key} onClick={() => { setProject(x.key); setPage(0); setOpen(null); setBundle(null); setShowSettings(false); }} className={`px-3 py-1.5 rounded-lg text-sm border ${x.key === project ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}>
          {x.name} {cfg.projects[x.key]?.enabled ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] ms-1 align-middle" /> : <span className="text-[10px] text-[var(--faint)] ms-1">{t('fb.off', 'off')}</span>}
        </button>)}
        <div className="flex-1" />
        <Button size="sm" variant={showSettings ? 'primary' : 'default'} onClick={() => showSettings ? setShowSettings(false) : startEdit()}><Sliders size={14} /> {t('fb.settings', 'Project settings & limits')}</Button>
      </div>
      {!pc?.enabled && !showSettings && <Card className="p-4 text-sm text-[var(--muted)] flex items-center gap-3"><AlertTriangle size={16} className="text-[var(--warning)] shrink-0" /> {t('fb.disabled', 'This project does not accept reports yet — open the settings and switch it on. Apps get a clean “not enabled” answer meanwhile, nothing breaks on their side.')}</Card>}

      {/* The queue, and the shape of it. Crashes first: a crash is the one somebody could not
          work around. */}
      {pc?.enabled && view === 'inbox' && data && (() => {
        const items = data.items || [];
        const news = items.filter((f) => f.status === 'new');
        const oldest = news.length ? news[news.length - 1] : null;
        const by = (k) => news.filter((f) => f.kind === k).length;
        const tiles = [
          ['crash', by('crash'), 'red', 'bg-error'], ['bug', by('bug'), 'warning', 'bg-warning'], ['feedback', by('feedback'), 'success', 'bg-success'],
        ];
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tiles.map(([k, n, tone, bar]) => { const active = kind === k && status === 'new'; return (
              <button key={k} type="button" onClick={() => { setKind(k); setStatus('new'); setPage(0); }}
                className={`fb-prio relative overflow-hidden rounded-xl border pl-4 pr-3 py-2.5 text-left transition hover:bg-[var(--surface-2)] ${active ? 'border-[var(--primary)]' : n ? 'border-[var(--line-strong)]' : 'border-[var(--line)]'}`}>
                <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-1 ${n ? bar : 'bg-[var(--line)]'}`} />
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t(`fb.kind.${k}`, k)} · {t('fb.st.new', 'new')}</div>
                <div className={`text-2xl font-extrabold tabular-nums leading-tight ${n ? `text-${tone}` : 'text-[var(--faint)]'}`}>{n}</div>
              </button>
            ); })}
            <div className="relative overflow-hidden rounded-xl border border-[var(--line)] pl-4 pr-3 py-2.5">
              <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--line)]" />
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1"><Clock size={11} /> {t('fb.oldest', 'Oldest untriaged')}</div>
              <div className="text-2xl font-extrabold tabular-nums leading-tight">{oldest ? fmtAgo(oldest.createdAt) : '-'}</div>
            </div>
          </div>
        );
      })()}

      {showSettings && draft && <Card className="p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="text-sm font-semibold">{t('fb.cfg.project', 'Project')} · <span className="font-mono">{project}</span></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={draft.project.enabled} onChange={(e) => pd('enabled', e.target.checked)} /> {t('fb.cfg.enabled', 'Accept reports for this project')}</label>
            <div className="flex gap-4 text-sm">
              {['feedback', 'bug', 'crash'].map((k) => <label key={k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!draft.project.kinds[k]} onChange={(e) => pd('kinds', { ...draft.project.kinds, [k]: e.target.checked })} /> {t(`fb.kind.${k}`, k)}</label>)}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={draft.project.requireContact} onChange={(e) => pd('requireContact', e.target.checked)} /> {t('fb.cfg.contact', 'Anonymous senders must give an e-mail')}</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={draft.project.openThread} onChange={(e) => pd('openThread', e.target.checked)} /> {t('fb.cfg.thread', 'Linked senders get a thread in Messages & reports')}</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={draft.project.mailFallback} onChange={(e) => pd('mailFallback', e.target.checked)} /> {t('fb.cfg.mail', 'Anonymous senders with an e-mail get a confirmation + replies by mail')}</label>
            <details className="rounded-xl border border-[var(--line)] p-3">
              <summary className="cursor-pointer text-sm font-medium">{t('fb.cfg.advanced', 'Advanced, caps, sampling, filters')}</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label={t('fb.cfg.sampling', 'Crash sampling (% kept)')}><Input type="number" min="0" max="100" value={draft.project.crashSampling} onChange={(e) => pd('crashSampling', num(e.target.value))} /></Field>
                <Field label={t('fb.cfg.dedupe', 'Dedupe window (min)')}><Input type="number" min="0" value={draft.project.dedupeMinutes} onChange={(e) => pd('dedupeMinutes', num(e.target.value))} /></Field>
                <Field label={t('fb.cfg.bodykb', 'Max text (KB)')}><Input type="number" min="1" value={draft.project.maxBodyKB} onChange={(e) => pd('maxBodyKB', num(e.target.value))} /></Field>
                <Field label={t('fb.cfg.attachmb', 'Max attachments total (MB)')}><Input type="number" min="0" value={draft.project.maxAttachMB} onChange={(e) => pd('maxAttachMB', num(e.target.value))} /></Field>
                <Field label={t('fb.cfg.attachn', 'Max attachments (count)')}><Input type="number" min="0" value={draft.project.maxAttachments} onChange={(e) => pd('maxAttachments', num(e.target.value))} /></Field>
                <Field label={t('fb.cfg.minver', 'Minimum app version')}><Input value={draft.project.minVersion} onChange={(e) => pd('minVersion', e.target.value)} placeholder="1.4.0" /></Field>
              </div>
              <Field label={t('fb.cfg.blockedver', 'Refused versions (comma-separated)')}><Input value={draft.project.blockedVersions.join(', ')} onChange={(e) => pd('blockedVersions', list(e.target.value))} placeholder="1.3.2, 1.3.3" /></Field>
              <Field label={t('fb.cfg.blockedwords', 'Refused words (comma-separated, matched in title + text)')}><Input value={draft.project.blockedWords.join(', ')} onChange={(e) => pd('blockedWords', list(e.target.value))} /></Field>
            </details>
          </div>
          <div className="space-y-3">
            <div className="text-sm font-semibold">{t('fb.cfg.limits2', 'Feedback rate limits (all projects)')}</div>
            <p className="text-xs text-[var(--muted)]">{t('fb.cfg.limits.d2', 'How many reports the feedback endpoint accepts. The platform-wide API ceilings (every route, per IP and per account) are on the Public API screen → Limits; attachment retention is in Hosting settings → Feedback storage.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('fb.cfg.perip', 'Feedback per IP')}><Input type="number" min="0" value={draft.limits.perIp.max} onChange={(e) => ld('perIp', { ...draft.limits.perIp, max: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.window', 'per window (min)')}><Input type="number" min="1" value={draft.limits.perIp.windowMin} onChange={(e) => ld('perIp', { ...draft.limits.perIp, windowMin: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.peracct', 'Feedback per account')}><Input type="number" min="0" value={draft.limits.perAccount.max} onChange={(e) => ld('perAccount', { ...draft.limits.perAccount, max: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.window', 'per window (min)')}><Input type="number" min="1" value={draft.limits.perAccount.windowMin} onChange={(e) => ld('perAccount', { ...draft.limits.perAccount, windowMin: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.peranon', 'Feedback per IP, unrecognised sender')} hint={t('fb.cfg.peranon.d', 'On top of the per-IP limit above, for senders we cannot tie to an account. 0 = no extra limit.')}><Input type="number" min="0" value={draft.limits.perAnonIp?.max ?? 4} onChange={(e) => ld('perAnonIp', { ...(draft.limits.perAnonIp || { windowMin: 60 }), max: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.window', 'per window (min)')}><Input type="number" min="1" value={draft.limits.perAnonIp?.windowMin ?? 60} onChange={(e) => ld('perAnonIp', { ...(draft.limits.perAnonIp || { max: 4 }), windowMin: num(e.target.value) })} /></Field>
              <Field label={t('fb.cfg.perday', 'Feedback per project per day')}><Input type="number" min="0" value={draft.limits.perProjectDay} onChange={(e) => ld('perProjectDay', num(e.target.value))} /></Field>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/admin?s=api" className="text-xs text-[var(--accent-ink)] hover:underline">{t('fb.cfg.gotoapi', 'API ceilings → Public API')}</Link>
              <Link to="/admin?s=hostingsettings" className="text-xs text-[var(--accent-ink)] hover:underline">{t('fb.cfg.gotostorage', 'Attachment retention → Hosting settings')}</Link>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2"><Button variant="primary" disabled={savingCfg} onClick={saveCfg}>{savingCfg ? <Spinner /> : t('common.save', 'Save')}</Button><Button variant="ghost" onClick={() => setShowSettings(false)}>{t('common.cancel', 'Cancel')}</Button></div>
      </Card>}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 items-start">
        <Card className="p-4 space-y-3">
          {/* Two questions, two views. The inbox answers "what arrived"; the grouping answers
              "what is broken", which sorting a list has never been able to answer. */}
          <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5">
            {[['inbox', t('fbx.v.inbox', 'Inbox'), Inbox], ['crashes', t('fbx.v.crashes', 'Crashes, grouped'), Layers]].map(([k, label, I]) => (
              <button key={k} onClick={() => { setView(k); setOpenGroup(null); }}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] inline-flex items-center gap-1.5 ${view === k ? 'bg-[var(--bg-solid)] font-medium' : 'text-[var(--muted)]'}`}>
                <I size={12} /> {label}
              </button>
            ))}
          </div>

          {view === 'inbox' ? <>
            <div className="flex items-center gap-2 flex-wrap">
              {['new', 'triaged', 'resolved', 'ignored', ''].map((st) => <button key={st || 'all'} onClick={() => { setStatus(st); setPage(0); }} className={`px-2.5 py-1 rounded-lg text-xs border ${status === st ? 'bg-[var(--surface-2)] border-[var(--primary)]' : 'border-[var(--line)]'}`}>{st ? t(`fb.st.${st}`, st) : t('fb.st.all', 'all')} {st && counts[st] ? <span className="text-[var(--faint)]">· {counts[st]}</span> : null}</button>)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} className="!w-auto" aria-label={t('fb.kind.all', 'All kinds')}><option value="">{t('fb.kind.all', 'All kinds')}</option>{['feedback', 'bug', 'crash'].map((k) => <option key={k} value={k}>{t(`fb.kind.${k}`, k)}</option>)}</Select>
              <Select value={version} onChange={(e) => { setVersion(e.target.value); setPage(0); }} className="!w-auto" aria-label={t('fb.ver.all', 'All versions')}><option value="">{t('fb.ver.all', 'All versions')}</option>{(data?.versions || []).filter((v) => v.version).map((v) => <option key={v.version} value={v.version}>{v.version} ({v.n})</option>)}</Select>
              <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} className="!w-auto" title={t('fb.sort', 'Sort')}><option value="severity">{t('fb.sort.sev', 'By severity')}</option><option value="new">{t('fb.sort.new', 'Newest')}</option><option value="old">{t('fb.sort.old', 'Oldest')}</option></Select>
              <form className="flex-1 min-w-[160px] flex gap-1" onSubmit={(e) => { e.preventDefault(); setQApplied(q.trim()); setPage(0); }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('fb.search', 'Search title, text, e-mail, fingerprint')} aria-label={t('fb.search', 'Search title, text, e-mail, fingerprint')} /><Button size="sm">{t('common.search', 'Search')}</Button></form>
            </div>
            {data?.windowed && (
              <div className="mt-2 text-[11.5px] rounded-lg border border-[var(--line)] panel text-[var(--muted)] px-2.5 py-2 flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" />
                <span>{t('fb.windowed', 'Sorting by severity ranks the {n} most recent of {all} reports. Switch to Newest or Oldest to page through all of them.').replace('{n}', data.windowSize).replace('{all}', data.totalAll)}</span>
              </div>
            )}
            {loading ? <div className="py-10 flex justify-center text-[var(--muted)]"><Spinner /></div>
              : !(data?.items || []).length ? <div className="py-10 text-center text-sm text-[var(--muted)]">{t('fb.empty', 'Nothing here.')}</div>
                : <div className="space-y-1.5">
                  {data.items.map((f) => <button key={f.id} onClick={() => openItem(f.id)} className={`w-full text-start rounded-xl border pl-4 pr-3 py-2.5 hover:bg-[var(--surface-2)] relative overflow-hidden ${open?.id === f.id ? 'border-[var(--primary)]' : 'border-[var(--line)]'}`}>
                    <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-1 ${f.kind === 'crash' ? 'bg-error' : f.kind === 'bug' ? 'bg-warning' : 'bg-success'}`} />
                    <div className="flex items-center gap-2 flex-wrap"><Badge tone={FB_KIND_TONE[f.kind]}>{t(`fb.kind.${f.kind}`, f.kind)}</Badge><span className="font-medium text-sm truncate min-w-0 flex-1" title={f.title || undefined}>{f.title || <span className="text-[var(--faint)]">{t('fb.untitled', '(untitled)')}</span>}</span>{f.count > 1 && <Badge>×{f.count}</Badge>}<Badge tone={FB_STATUS_TONE[f.status]}>{t(`fb.st.${f.status}`, f.status)}</Badge></div>
                    <div className="text-xs text-[var(--faint)] mt-0.5 flex items-center gap-2 flex-wrap"><span>{fmtAgo(f.createdAt)}</span>{f.appVersion && <span>· v{f.appVersion}</span>}{f.os && <span>· {f.os}</span>}<span>· {f.userName ? f.userName : f.email ? f.email : t('fb.anon', 'anonymous')}</span>{f.attachments.length > 0 && <span>· {t('fbx.natt', '{n} attached').replace('{n}', String(f.attachments.length))}</span>}</div>
                    <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{f.body}</div>
                  </button>)}
                  {data.total > data.take && <div className="flex items-center justify-between text-xs text-[var(--muted)] pt-2"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t('common.prev', 'Previous')}>‹</Button><span>{page * data.take + 1}–{Math.min(data.total, (page + 1) * data.take)} / {data.total}</span><Button size="sm" variant="ghost" disabled={(page + 1) * data.take >= data.total} onClick={() => setPage(page + 1)} aria-label={t('common.next', 'Next')}>›</Button></div>}
                </div>}
          </> : <>
            {/* ── Crashes, grouped ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={days} onChange={(e) => setDays(e.target.value)} className="!w-auto" aria-label={t('fbx.period', 'Period')}>
                {['7', '30', '90', '365'].map((d) => <option key={d} value={d}>{t('fbx.days', 'last {n} days').replace('{n}', d)}</option>)}
              </Select>
              {crashes.data && <span className="text-[11px] text-[var(--faint)]">{t('fbx.scanned', '{g} crash(es) over {n} report(s)').replace('{g}', String(crashes.data.groups.length)).replace('{n}', String(crashes.data.scanned))}</span>}
            </div>
            <Explain summary={t('fbx.howsum', 'Grouped on the stack, not on the message.')}>
              <p>{t('fbx.how1', 'One row is one crash: reports whose stack normalises to the same thing, after the paths, line numbers, addresses and build hashes that differ between two machines have been taken out of it. The dedupe fingerprint on a report cannot do this — it is compared only inside one sender’s dedupe window, so two people meeting the same panic always produce two of them.')}</p>
              <p>{t('fbx.how2', 'The people count is a FLOOR, not a headcount. It counts accounts where there is one and a salted hash of the address otherwise, so one person on two networks counts twice and a household behind one address counts once.')}</p>
              <p>{t('fbx.how3', 'A row marked “by message” had no stack to group on. BMM sends the trace inside the attached zip, not in the report text, so a crash is grouped by message until somebody opens its bundle here — which reads the real backtrace and files it properly, for good.')}</p>
            </Explain>
            {crashes.data?.unindexed > 0 && (
              <div className="text-[11.5px] rounded-lg border border-[var(--line)] panel text-[var(--muted)] px-2.5 py-2 flex items-start gap-2">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>{t('fbx.unindexed', '{n} of these have never had their bundle opened, so they are grouped by message. Open one and its group becomes exact.').replace('{n}', String(crashes.data.unindexed))}</span>
              </div>
            )}
            {crashes.loading ? <div className="py-10 flex justify-center text-[var(--muted)]"><Spinner /></div>
              : !(crashes.data?.groups || []).length ? <div className="py-10 text-center text-sm text-[var(--muted)]">{t('fbx.nocrash', 'No crash reported in this period.')}</div>
                : <div className="space-y-1.5">
                  {crashes.data.groups.map((g) => (
                    <div key={g.sig} className={`rounded-xl border pl-4 pr-3 py-2.5 relative overflow-hidden ${openGroup === g.sig ? 'border-[var(--primary)]' : 'border-[var(--line)]'}`}>
                      <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-1 ${g.weak ? 'bg-warning' : 'bg-error'}`} />
                      <button type="button" className="w-full text-start" onClick={() => setOpenGroup(openGroup === g.sig ? null : g.sig)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate min-w-0 flex-1" title={g.title || g.sig}>{g.title || g.frames[0] || g.sig}</span>
                          {g.weak && <Badge tone="amber">{t('fbx.bymsg', 'by message')}</Badge>}
                          <ChevronRight size={14} className={`text-[var(--faint)] transition-transform ${openGroup === g.sig ? 'rotate-90' : ''}`} />
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--faint)] mt-1">
                          <span className="inline-flex items-center gap-1 text-[var(--text)]"><Users size={12} /> {t('fbx.people', 'at least {n}').replace('{n}', String(g.people))}</span>
                          <span>{t('fbx.occ', '{n} occurrence(s)').replace('{n}', String(g.occurrences))}</span>
                          <span title={`${new Date(g.first).toLocaleString()} → ${new Date(g.last).toLocaleString()}`}>{t('fbx.span', 'first {a} ago, last {b} ago').replace('{a}', fmtAgo(g.first)).replace('{b}', fmtAgo(g.last))}</span>
                          <span className="font-mono">{g.sig}</span>
                        </div>
                      </button>
                      {openGroup === g.sig && <div className="mt-2.5 space-y-2.5 border-t border-[var(--line)] pt-2.5">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Spread rows={g.versions} total={g.reports} label={t('fbx.versions', 'Versions affected')} />
                          <Spread rows={g.os} total={g.reports} label={t('fbx.systems', 'Systems')} />
                        </div>
                        {g.frames.length > 0 && <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('fbx.sigframes', 'The frames this group is keyed on')}</div>
                          <pre className="text-[11px] font-mono panel rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words">{g.frames.join('\n')}</pre>
                        </div>}
                        <div className="flex flex-wrap gap-1.5">
                          {g.ids.slice(0, 12).map((id) => (
                            <Button key={id} size="sm" variant={open?.id === id ? 'primary' : 'default'} onClick={() => openItem(id)}>
                              <span className="font-mono text-[11px]">{id.slice(0, 8)}</span>
                            </Button>
                          ))}
                          {g.ids.length > 12 && <span className="text-[11px] text-[var(--faint)] self-center">{t('fbx.andmore', 'and {n} more').replace('{n}', String(g.ids.length - 12))}</span>}
                        </div>
                      </div>}
                    </div>
                  ))}
                  {crashes.data.windowed && (
                    <div className="text-[11.5px] rounded-lg border border-[var(--line)] panel text-[var(--muted)] px-2.5 py-2 flex items-start gap-2">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" />
                      <span>{t('fbx.crashwindowed', 'Grouping ranks the {n} most recent crashes of {all} in this period. Narrow the period to see the rest.').replace('{n}', String(crashes.data.windowSize)).replace('{all}', String(crashes.data.total))}</span>
                    </div>
                  )}
                </div>}
          </>}
        </Card>

        <Card className="p-5 space-y-4 min-w-0">
          {!open ? <div className="py-16 text-center text-sm text-[var(--muted)]">{t('fb.pick', 'Pick a report on the left.')}</div> : <>
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><Badge tone={FB_KIND_TONE[open.kind]}>{t(`fb.kind.${open.kind}`, open.kind)}</Badge><Badge tone={FB_STATUS_TONE[open.status]}>{t(`fb.st.${open.status}`, open.status)}</Badge>{open.count > 1 && <Badge>×{open.count} {t('fb.dup', 'occurrences')}</Badge>}</div>
                <h2 className="text-lg font-bold mt-1 break-words">{open.title || t('fb.untitled', '(untitled)')}</h2>
                <div className="text-xs text-[var(--faint)] font-mono mt-0.5 break-all">{open.id}{open.fingerprint ? ` · ${open.fingerprint.slice(0, 16)}` : ''}</div>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {['triaged', 'resolved', 'ignored'].filter((x) => x !== open.status).map((st) => <Button key={st} size="sm" disabled={busy} onClick={() => setSt(open.id, st)}>{t(`fb.mark.${st}`, `Mark ${st}`)}</Button>)}
                <Button size="sm" variant="ghost" className="text-[var(--error)]" onClick={() => del(open.id)} aria-label={t('common.delete', 'Delete')}><Trash2 size={14} /></Button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div><span className="text-[var(--faint)]">{t('fb.f.project', 'Project')}</span> · <span className="font-mono">{open.projectKey}</span></div>
              <div><span className="text-[var(--faint)]">{t('fb.f.when', 'When')}</span> · {new Date(open.createdAt).toLocaleString()}</div>
              <div><span className="text-[var(--faint)]">{t('fb.f.version', 'Version')}</span> · {open.appVersion || '-'}</div>
              <div><span className="text-[var(--faint)]">{t('fb.f.os', 'OS')}</span> · {open.os || '-'}</div>
              <div><span className="text-[var(--faint)]">{t('fb.f.sender', 'Sender')}</span> · {open.user ? <Link to={`/admin?s=users&q=${encodeURIComponent(open.user.email)}`} className="text-[var(--accent-ink)]">{open.user.displayName}</Link> : open.email || t('fb.anon', 'anonymous')}{open.creatorId ? <span className="font-mono text-[var(--faint)] break-all"> · {open.creatorId}</span> : null}</div>
              <div><span className="text-[var(--faint)]">{t('fb.f.thread', 'Thread')}</span> · {open.reportId ? <Link to={`/admin?s=reports&r=${open.reportId}`} className="text-[var(--accent-ink)]">{t('fb.f.openthread', 'open in Reports')}</Link> : open.email ? t('fb.f.bymail', 'replies go by e-mail') : t('fb.f.none', 'none (read-only)')}</div>
            </div>

            {/* The report's own text. A crash body is a trace as often as it is prose, so it
                is drawn as one: app frames keep their contrast, the runtime dims. */}
            {open.kind === 'crash' && /^\s*(?:at\s|\d+:)/m.test(open.body || '')
              ? <Trace text={open.body} />
              : <pre className="text-sm whitespace-pre-wrap break-words panel rounded-xl p-3 max-h-[50vh] overflow-auto">{open.body || t('fb.nobody', '(no text)')}</pre>}

            {/* ── The attached crash bundle, opened here ── */}
            {zipAtt.length > 0 && <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold flex items-center gap-1.5"><BugIcon size={14} className="text-[var(--accent-ink)]" /> {t('fbx.bundle', 'The crash bundle')}</span>
                <span className="text-[11px] text-[var(--faint)] truncate min-w-0" title={zipAtt[0].name}>{zipAtt[0].name}</span>
                <Button size="sm" className="ms-auto" disabled={bundle?.loading} onClick={() => readBundle(open, zipAtt[0])}>
                  {bundle?.loading ? <Spinner /> : t('fbx.read', 'Read it here')}
                </Button>
              </div>
              <p className="text-[11px] text-[var(--faint)]">
                {t('fbx.bundlelocal', 'The archive is decompressed in your browser, not on the server. At most {e} entries and {mb} MB, a path that leaves the archive is never opened, and nothing is rendered as markup.')
                  .replace('{e}', String(LIMITS.entries)).replace('{mb}', String(LIMITS.totalBytes / 1024 / 1024))}
              </p>

              {bundle?.error && <p className="text-[12px] text-error">{bundle.error}</p>}
              {bundle?.refused && <div className="text-[12px] rounded-lg border border-[var(--error)] p-2 flex items-start gap-2">
                <ShieldAlert size={13} className="shrink-0 mt-0.5 text-error" />
                <span>{t('fbx.refused', 'Refused before anything was decompressed: the archive declares {n} against a limit of {m}. This is not a bundle BMM wrote.').replace('{n}', String(bundle.refused.got)).replace('{m}', String(bundle.refused.limit))}</span>
              </div>}

              {bundle && !bundle.refused && !bundle.error && !bundle.loading && <div className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div className="min-w-0"><span className="text-[var(--faint)]">{t('fbx.b.reason', 'Panic reason')}</span> · <span className="font-mono truncate inline-block max-w-full align-bottom" title={bundle.meta.reason || '-'}>{bundle.meta.reason || '-'}</span></div>
                  <div><span className="text-[var(--faint)]">{t('fbx.b.version', 'Built version')}</span> · <span className="font-mono">{bundle.meta.version || '-'}</span></div>
                  <div><span className="text-[var(--faint)]">{t('fbx.b.os', 'Machine')}</span> · {bundle.system.flat['OS Name'] || '-'} {bundle.system.flat['OS Version'] || ''}</div>
                  <div><span className="text-[var(--faint)]">{t('fbx.b.alive', 'Alive for')}</span> · {bundle.system.flat['Process Runtime'] || '-'}</div>
                </div>
                {bundle.findings.length > 0 && <div className="space-y-1">
                  {['bad', 'warn'].flatMap((lv) => bundle.findings.filter((x) => x.level === lv)).slice(0, 6).map((x, i) => (
                    <div key={i} className={`flex items-start gap-2 text-[11.5px] rounded-lg border p-2 ${x.level === 'bad' ? 'border-[var(--error)]' : 'border-[var(--warning)]'}`}>
                      {x.level === 'bad' ? <XCircle size={12} className="shrink-0 mt-0.5 text-error" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5 text-warning" />}
                      <span className="min-w-0 break-words">{t('fbx.finding', 'Worth a look')}: <span className="font-mono">{x.key}</span>{x.detail ? ` ${x.detail}` : ''}</span>
                    </div>
                  ))}
                  <Link to="/dev/tools#crash" className="text-[11px] text-[var(--accent-ink)] hover:underline inline-block">{t('fbx.fulltool', 'Open the full crash reader in the developer tools')}</Link>
                </div>}
                {bundle.stack && <details open>
                  <summary className="cursor-pointer text-[12px] text-[var(--muted)]">{t('fbx.b.stack', 'The backtrace')}</summary>
                  <div className="mt-1"><Trace text={bundle.stack} /></div>
                </details>}
                <details>
                  <summary className="cursor-pointer text-[12px] text-[var(--muted)]">{t('fbx.b.log', 'The last thing it logged')}</summary>
                  <pre className="mt-1 text-[11px] font-mono panel rounded-lg p-2 overflow-auto max-h-[35vh] whitespace-pre-wrap break-words">
                    {bundle.logs.slice(-60).map((l) => `${l.ts ? `${l.ts} ` : ''}${l.text}`).join('\n') || t('dcr.nolog', 'No log lines.')}
                  </pre>
                </details>
                {bundle.state?.settings && <details>
                  <summary className="cursor-pointer text-[12px] text-[var(--muted)]">{t('fbx.b.settings', 'The configuration that was in effect')}</summary>
                  <pre className="mt-1 text-[11px] font-mono panel rounded-lg p-2 overflow-auto max-h-[35vh] whitespace-pre-wrap break-words">{JSON.stringify(bundle.state.settings, null, 2)}</pre>
                </details>}
              </div>}
            </div>}

            {open.attachments?.length > 0 && <div>
              <div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-1.5">{t('fb.attachments', 'Attachments')}</div>
              <div className="flex flex-wrap gap-2">{open.attachments.map((a) => <a key={a.i} href={`/api/admin/feedback/${open.id}/attachments/${a.i}`} className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-[var(--line)] px-2.5 py-1.5 hover:bg-[var(--surface-2)] max-w-full"><Download size={12} className="shrink-0" /> <span className="truncate min-w-0" title={a.name}>{a.name}</span> <span className="text-[var(--faint)] shrink-0">{(a.size / 1024).toFixed(0)} KB</span></a>)}</div>
            </div>}
            {open.meta && <details className="text-xs"><summary className="cursor-pointer text-[var(--muted)]">{t('fb.meta', 'Context (meta)')}</summary><pre className="mt-1 panel rounded-xl p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">{JSON.stringify(open.meta, null, 2)}</pre></details>}
            {(open.reportId || open.email) && <div className="space-y-2 pt-2 border-t border-[var(--line)]">
              <div className="text-sm font-semibold">{open.reportId ? t('fb.reply.thread', 'Reply in their thread') : t('fb.reply.mail', 'Reply by e-mail')}</div>
              <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('fb.reply.ph', 'Thanks, could you tell us…')} />
              <Button variant="primary" size="sm" disabled={busy || !reply.trim()} onClick={send}>{busy ? <Spinner /> : t('fb.reply.send', 'Send')}</Button>
            </div>}
          </>}
        </Card>
      </div>
    </div>
  );
}

export default AdminFeedbackCentre;
