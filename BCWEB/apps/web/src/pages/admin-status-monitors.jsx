// D7: the services the status page watches, configured from the admin.
//
// Two kinds, one list on screen:
//   - the built-ins (database, storage, bot, telemetry, website, Stripe): code decides how each
//     is probed, the admin only switches them on or off (PUT /admin/server/deps-config, applied
//     at once, as it always was);
//   - the ones added here: a public URL, what counts as "up" (a status range, optionally a word
//     the page must contain), a timeout, a name in both languages. Saved as one list through the
//     shared SaveBar.
//
// Every URL is refused by the server if it points inside our network (pentest R11, see
// apps/api/src/lib/status-monitors.mjs). This screen does not re-implement that rule: it sends
// the URL and prints the reason the server gives. "Test" runs the real prober on the draft row
// and shows the verdict, the status code and the time, never what the target answered.
import { useEffect, useMemo, useState } from 'react';
import { HeartPulse, Plus, Trash2, Play, CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Field, Badge, Spinner, useToast } from '../ui/ui.jsx';
import { SaveBar } from '../ui/save-bar.jsx';
import { useAsync } from './pages.jsx';

const newId = (label) => {
  const slug = String(label || 'service').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'service';
  return `c_${slug}-${Math.random().toString(36).slice(2, 6)}`;
};
const blank = () => ({ id: newId(''), label: '', labelFr: '', url: 'https://', method: 'GET', okMin: 200, okMax: 399, keyword: '', timeoutMs: 5000, enabled: true });

export default function AdminStatusMonitors() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/status/monitors'), []);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});   // id -> refusal code from the last save
  const [tests, setTests] = useState({});     // id -> { busy } | result
  const [openId, setOpenId] = useState(null); // which row shows its advanced fields
  const [builtin, setBuiltin] = useState(null);
  useEffect(() => { if (data) { setRows(data.monitors || []); setBuiltin(data.builtin?.enabled || {}); } }, [data]);

  // The reasons, in the admin's language. The server sends a code, never an address.
  const REASON = useMemo(() => ({
    ssrf_bad_url: t('stm.e.url', 'Not a valid address.'),
    ssrf_bad_scheme: t('stm.e.scheme', 'Only http:// and https:// addresses can be watched.'),
    ssrf_credentials: t('stm.e.cred', 'Remove the user name and password from the address.'),
    ssrf_blocked_ip: t('stm.e.internal', 'This address points inside our own network (private, loopback or cloud metadata). The status page only watches public services.'),
    ssrf_blocked_host: t('stm.e.internal', 'This address points inside our own network (private, loopback or cloud metadata). The status page only watches public services.'),
    ssrf_blocked_resolved: t('stm.e.internal', 'This address points inside our own network (private, loopback or cloud metadata). The status page only watches public services.'),
    ssrf_dns_fail: t('stm.e.dns', 'This name does not resolve.'),
    ssrf_dns_empty: t('stm.e.dns', 'This name does not resolve.'),
    ssrf_too_many_redirects: t('stm.e.redir', 'Too many redirects (3 at most).'),
    timeout: t('stm.e.timeout', 'No answer within the time limit.'),
    unreachable: t('stm.e.unreach', 'Could not connect.'),
    bad_status: t('stm.e.status', 'Answered with a status outside the expected range.'),
    keyword_missing: t('stm.e.kw', 'The expected text was not in the first 64 KB of the page.'),
  }), [t]);
  const reason = (code) => REASON[code] || code;

  if (loading || !rows || !builtin) return <Card className="p-4 mb-4"><Spinner /></Card>;

  const saved = data?.monitors || [];
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const max = data?.max || 20;
  const patch = (i, p) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const num = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };

  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.put('/admin/status/monitors', { monitors: rows });
      toast.success(t('stm.saved', 'Saved. The next check runs within a minute.'));
      reload();
    } catch (x) {
      const d = x?.data || {};
      if (d.error === 'target_refused' && d.id) {
        setErrors({ [d.id]: d.code });
        toast.error(t('stm.refused', 'Not saved: one address was refused, see the row.'));
      } else if (d.error === 'duplicate_id') toast.error(t('stm.dup', 'Two rows share an id. Remove one and add it again.'));
      else if (d.error === 'invalid_range') toast.error(t('stm.range', 'The lowest "up" status is above the highest.'));
      else toast.error(t('stm.invalid', 'Not saved: a row is incomplete (a name and an address are needed).'));
    } finally { setBusy(false); }
  };

  const test = async (r) => {
    setTests((s) => ({ ...s, [r.id]: { busy: true } }));
    try {
      const res = await api.post('/admin/status/monitors/test', { monitor: r });
      setTests((s) => ({ ...s, [r.id]: res }));
    } catch { setTests((s) => ({ ...s, [r.id]: { ok: null, error: 'ssrf_bad_url' } })); }
  };

  const toggleBuiltin = async (key, on) => {
    const prev = builtin;
    setBuiltin({ ...builtin, [key]: on });
    try { await api.put('/admin/server/deps-config', { [key]: on }); }
    catch { setBuiltin(prev); toast.error(t('common.failed', 'Failed.')); }
  };

  const remove = (i) => {
    const gone = rows[i];
    setRows((rs) => rs.filter((_, k) => k !== i));
    // Nothing is written until Save; the toast's Undo puts the row back where it was.
    toast.action({
      tone: 'info', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('stm.removed', 'Service removed from the list. Save to apply.'),
      onCommit: () => {},
      onCancel: () => setRows((rs) => { const n = [...rs]; n.splice(Math.min(i, n.length), 0, gone); return n; }),
    });
  };

  const verdict = (res) => {
    if (!res) return null;
    if (res.busy) return <Spinner />;
    const Icon = res.ok === true ? CheckCircle2 : res.ok === false ? XCircle : MinusCircle;
    const tone = res.ok === true ? 'var(--success)' : res.ok === false ? 'var(--error)' : 'var(--warning)';
    return (
      <span className="inline-flex items-start gap-1.5 text-[12px] min-w-0" style={{ color: tone }}>
        <Icon size={14} className="shrink-0 mt-px" />
        <span className="break-words">
          {res.ok === true ? t('stm.t.up', 'Up') : res.ok === false ? t('stm.t.down', 'Down') : t('stm.t.refused', 'Refused')}
          {res.status ? ` · ${res.status}` : ''}{res.ms != null ? ` · ${res.ms} ms` : ''}
          {res.error ? ` · ${reason(res.error)}` : ''}
        </span>
      </span>
    );
  };

  const BUILTIN_NAME = (k) => t(`st.svc.${k}`, data?.builtin?.labels?.[k] || k);

  return (
    <Card className="p-4 mb-5">
      <h3 className="font-semibold flex items-center gap-2 mb-1"><HeartPulse size={16} className="text-[var(--accent-ink)]" /> {t('stm.title', 'Services the page watches')}</h3>
      <p className="text-xs text-[var(--muted)] mb-3 max-w-3xl">
        {t('stm.sub', 'Each one is checked about every ten minutes, and when it stops answering an incident opens on the public page. Add any public service (a docs host, a download mirror, an update feed). Addresses inside our own network are refused: the page watches what visitors can reach.')}
      </p>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('stm.builtin', 'Built in')}</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(data?.builtin?.keys || []).map((k) => {
          const on = builtin[k] !== false;
          return (
            <button key={k} type="button" onClick={() => toggleBuiltin(k, !on)} aria-pressed={on}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${on ? 'border-[var(--primary)] text-[var(--text)] tint-primary-soft' : 'border-dashed border-[var(--line)] text-[var(--muted)]'}`}>
              {on ? <CheckCircle2 size={13} /> : <MinusCircle size={13} />} {BUILTIN_NAME(k)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('stm.custom', 'Added by you')}</div>
        <span className="text-[11px] text-[var(--faint)]">{rows.length} / {max}</span>
        <Button size="sm" className="ms-auto" disabled={rows.length >= max} onClick={() => { const r = blank(); setRows((rs) => [...rs, r]); setOpenId(r.id); }}>
          <Plus size={13} /> {t('stm.add', 'Add a service')}
        </Button>
      </div>
      {!rows.length && <p className="text-[12px] text-[var(--faint)] mb-2">{t('stm.none', 'None yet. The built-in services above are all the page shows.')}</p>}
      <div className="space-y-2">
        {rows.map((r, i) => {
          const open = openId === r.id;
          const err = errors[r.id];
          return (
            <div key={r.id} className={`rounded-xl border p-3 ${err ? 'border-[var(--error)]' : 'border-[var(--line)]'}`}>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('stm.name', 'Name')} className="flex-1 min-w-[10rem]">
                  <Input value={r.label} maxLength={60} placeholder={t('stm.name.ph', 'Documentation')} onChange={(e) => patch(i, { label: e.target.value })} />
                </Field>
                <Field label={t('stm.namefr', 'Name (FR)')} className="flex-1 min-w-[10rem]">
                  <Input value={r.labelFr} maxLength={60} placeholder={t('stm.namefr.ph', 'optional')} onChange={(e) => patch(i, { labelFr: e.target.value })} />
                </Field>
                <Field label={t('stm.url', 'Address')} className="flex-[2] min-w-[14rem]">
                  <Input value={r.url} maxLength={500} className="font-mono text-xs" placeholder="https://docs.example.com/health" onChange={(e) => patch(i, { url: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <label className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                  {t('stm.enabled', 'Shown on the page')}
                </label>
                <Button size="sm" variant="ghost" onClick={() => setOpenId(open ? null : r.id)}>
                  {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {t('stm.more', 'What counts as up')}
                </Button>
                <Button size="sm" variant="ghost" disabled={tests[r.id]?.busy} onClick={() => test(r)}><Play size={13} /> {t('stm.test', 'Test now')}</Button>
                <Button size="sm" variant="ghost" className="text-error" onClick={() => remove(i)}><Trash2 size={13} /> {t('common.remove', 'Remove')}</Button>
                <span className="basis-full sm:basis-auto sm:ms-auto min-w-0">{verdict(tests[r.id])}</span>
              </div>
              {err && <p className="text-[12px] text-[var(--error)] mt-2 break-words">{reason(err)}</p>}
              {open && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-[var(--line)]">
                  <Field label={t('stm.method', 'Request')}>
                    <Select value={r.method} onChange={(e) => patch(i, { method: e.target.value })}>
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                    </Select>
                  </Field>
                  <Field label={t('stm.range.l', 'Up when the status is between')}>
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={100} max={599} value={r.okMin} onChange={(e) => patch(i, { okMin: num(e.target.value, 200) })} />
                      <span className="text-[var(--faint)]">-</span>
                      <Input type="number" min={100} max={599} value={r.okMax} onChange={(e) => patch(i, { okMax: num(e.target.value, 399) })} />
                    </div>
                  </Field>
                  <Field label={t('stm.kw', 'And the page contains')} hint={t('stm.kw.h', 'Optional. Searched in the first 64 KB; ignored for HEAD.')}>
                    <Input value={r.keyword} maxLength={100} placeholder={t('stm.kw.ph', 'ok')} onChange={(e) => patch(i, { keyword: e.target.value })} />
                  </Field>
                  <Field label={t('stm.timeout', 'Time limit (seconds)')}>
                    <Input type="number" min={1} max={10} value={Math.round(r.timeoutMs / 1000)} onChange={(e) => patch(i, { timeoutMs: Math.min(10, Math.max(1, num(e.target.value, 5))) * 1000 })} />
                  </Field>
                </div>
              )}
              {lang === 'fr' && !r.labelFr && r.label && <p className="text-[11px] text-[var(--faint)] mt-1">{t('stm.nofr', 'Without a French name, French visitors read the English one.')}</p>}
            </div>
          );
        })}
      </div>

      <SaveBar dirty={dirty} busy={busy} onSave={save} label={t('stm.title', 'Services the page watches')}
        canSave={rows.every((r) => r.label.trim() && r.url.trim())}
        onDiscard={() => { const prev = rows; setRows(saved); setErrors({}); return () => setRows(prev); }}
        detail={t('stm.count', '{n} added service(s)').replace('{n}', String(rows.length))} />
    </Card>
  );
}
