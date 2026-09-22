// Admin → Hosting settings → Maintenance: the custom seed v2 (routes/config-transfer.mjs).
//
// Export: pick domains (bot, economy, hosting, telemetry, goals…), download one JSON bundle or
// the same bundle as a runnable seed script. Secrets never travel; what was left out is listed
// by the server, by key and by path, and shown here before the download.
//
// Import: drop a bundle, see every value checked against THIS install's own admin schemas,
// then apply the domains that passed. Every route behind it is SUPERADMIN (the server
// enforces it; an ADMIN who opens the card gets the load error, and the apply button says so).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Download, FileCode2, Upload, ShieldCheck, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { Card, Button, Badge, Spinner, Explain, useDialog, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';

const STATUS_TONE = { create: 'green', update: 'amber', invalid: 'red', refused: 'red', skipped: '' };

function saveBlob(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function countOf(d) {
  const rows = Object.values(d.rows || {}).reduce((n, x) => n + x, 0);
  return (d.settings || 0) + rows + (d.service ? 1 : 0);
}

export function ConfigTransferCard() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState('');
  const [bundle, setBundle] = useState(null);
  const [report, setReport] = useState(null);
  const fileRef = useRef(null);
  const isSuper = user?.role === 'SUPERADMIN';

  useEffect(() => {
    if (!isSuper) return;
    api.get('/admin/config-transfer').then((r) => { setInfo(r); setSel(r.domains.filter((d) => countOf(d) > 0).map((d) => d.id)); }).catch(() => setInfo({ error: true }));
  }, [isSuper]);
  const label = (d) => (lang === 'fr' ? d.labelFr || d.label : d.label);
  const byId = useMemo(() => Object.fromEntries((info?.domains || []).map((d) => [d.id, d])), [info]);

  if (!isSuper) return <Card className="p-4 mb-3 text-sm text-[var(--muted)] flex items-center gap-2"><Database size={14} className="shrink-0" /> {t('ct.superonly', 'Exporting and importing every setting at once is for super-admins.')}</Card>;
  if (!info) return <Card className="p-4"><Spinner /></Card>;
  if (info.error) return <Card className="p-4 text-sm text-error">{t('ct.loadfail', 'Could not read the settings to export.')}</Card>;

  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const doExport = async (as) => {
    setBusy(as);
    try {
      const res = await fetch('/api/admin/config-transfer/export', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domains: sel, as }) });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(text, as === 'script' ? `custom-seed-${stamp}.mjs` : `custom-seed-${stamp}.json`, as === 'script' ? 'text/javascript' : 'application/json');
    } catch { toast.error(t('ct.exportfail', 'The export failed.')); } finally { setBusy(''); }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setReport(null);
    try {
      const parsed = JSON.parse(await f.text());
      setBundle(parsed);
      setBusy('check');
      setReport(await api.post('/admin/config-transfer/import', { bundle: parsed, apply: false }));
    } catch (err) {
      setBundle(null);
      toast.error(err?.data?.error === 'unsupported_version' ? t('ct.version', 'This seed was made by another version of the format.') : t('ct.notseed', 'This file is not a custom seed.'));
    } finally { setBusy(''); }
  };
  const okDomains = (report?.domains || []).filter((d) => d.ok).map((d) => d.id);
  const apply = async () => {
    if (!(await dialog.confirm({
      title: t('ct.apply.t', 'Apply this seed?'),
      message: t('ct.apply.m', 'The checked domains overwrite the settings of the same name on this site. Refused domains are not touched.'),
      okLabel: t('ct.apply.ok', 'Apply'), danger: true,
    }))) return;
    setBusy('apply');
    try {
      const r = await api.post('/admin/config-transfer/import', { bundle, apply: true, domains: okDomains });
      setReport(r);
      toast.success(t('ct.applied', 'Seed applied.'));
    } catch { toast.error(t('ct.applyfail', 'The seed could not be applied.')); } finally { setBusy(''); }
  };

  return (
    <Card className="p-4 mb-3" data-config-transfer>
      <div className="text-sm font-medium flex items-center gap-2 mb-1"><Database size={14} className="text-[var(--accent-ink)]" /> {t('ct.title', 'Custom seed: export and import settings')}</div>
      <Explain className="text-[11px] mb-3" summary={t('ct.sub.s', 'Every kind of setting, by domain, to move to another install.')}>
        {t('ct.sub.d', 'Choose the domains, download the bundle (JSON, or a script to run from apps/api), and import it on the other side, where every value is checked with that site\'s own admin rules before anything is written. Tokens, keys, passwords and webhook secrets are never exported.')}
      </Explain>

      <div className="grid sm:grid-cols-2 gap-1.5 mb-3">
        {info.domains.map((d) => {
          const n = countOf(d);
          return (
            <label key={d.id} className={`flex items-start gap-2 rounded-lg border border-[var(--line)] px-2.5 py-2 text-sm cursor-pointer ${n ? '' : 'opacity-60'}`} style={{ background: 'var(--bg-solid)' }} title={d.desc}>
              <input type="checkbox" className="mt-0.5" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{label(d)}</span> <span className="text-[var(--faint)] tabular-nums text-xs">{n}</span>
                {d.id === 'telemetry' && !info.telemetryService && <span className="block text-[11px] text-[var(--muted)]">{t('ct.telenote', 'Telemetry service not connected: only this site\'s telemetry settings.')}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="primary" onClick={() => doExport('json')} loading={busy === 'json'} disabled={!sel.length || !!busy}><Download size={14} /> {t('ct.export.json', 'Download the seed (JSON)')}</Button>
        <Button onClick={() => doExport('script')} loading={busy === 'script'} disabled={!sel.length || !!busy}><FileCode2 size={14} /> {t('ct.export.script', 'As a seed script')}</Button>
      </div>

      <details className="text-xs mb-4">
        <summary className="cursor-pointer text-[var(--muted)] flex items-center gap-1.5"><ShieldCheck size={13} /> {t('ct.never', 'Never exported')} ({info.excluded.length + info.redacted.length})</summary>
        <ul className="mt-2 space-y-0.5 font-mono break-all">
          {info.excluded.map((x) => <li key={x.key}>{x.key} <span className="text-[var(--faint)] font-sans">{x.reason}</span></li>)}
          {info.redacted.map((x) => <li key={`${x.key}|${x.path}`}>{x.key} → {x.path} <span className="text-[var(--faint)] font-sans">{x.reason}</span></li>)}
        </ul>
      </details>

      <div className="border-t border-[var(--line)] pt-3">
        <div className="text-sm font-medium mb-2">{t('ct.import', 'Import a seed')}</div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
        <Button onClick={() => fileRef.current?.click()} loading={busy === 'check'} disabled={!!busy}><Upload size={14} /> {t('ct.pick', 'Choose a .json seed and check it')}</Button>
        {report && (
          <div className="mt-3 space-y-2">
            {report.domains.map((d) => {
              const bad = d.items.filter((i) => i.status === 'invalid' || i.status === 'refused');
              const meta = byId[d.id];
              return (
                <div key={d.id} className="rounded-lg border border-[var(--line)] px-3 py-2" style={{ background: 'var(--bg-solid)' }}>
                  <div className="flex items-center gap-2 text-sm">
                    {d.ok ? <CheckCircle2 size={14} className="text-[var(--success)] shrink-0" /> : <AlertTriangle size={14} className="text-error shrink-0" />}
                    <span className="font-medium flex-1 min-w-0">{meta ? label(meta) : d.id}</span>
                    {d.applied && <Badge tone="green">{t('ct.done', 'applied')}</Badge>}
                    <span className="text-xs text-[var(--muted)] tabular-nums">{d.items.length}</span>
                  </div>
                  {bad.length > 0 && (
                    <ul className="mt-1 text-xs space-y-0.5">
                      {bad.map((i) => <li key={`${i.kind}:${i.id}`} className="break-all"><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge> <span className="font-mono">{i.id}</span> <span className="text-[var(--muted)]">{i.error}</span></li>)}
                    </ul>
                  )}
                </div>
              );
            })}
            {!report.applied && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" onClick={apply} loading={busy === 'apply'} disabled={!okDomains.length || !isSuper || !!busy}><Play size={14} /> {t('ct.apply', 'Apply the domains that passed')}</Button>
                {!isSuper && <span className="text-xs text-[var(--muted)]">{t('ct.super', 'Applying needs a super-admin.')}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default ConfigTransferCard;
