// "Serve this on my own domain."
//
// One component for repos and catalogues, because it is one feature and the only difference
// is a word in the URL. The panel's real job is not the form — it is being honest about the
// two waits either side of it: DNS propagation before we can verify, and certificate issuance
// after. A panel that says "saved" and leaves somebody refreshing their own hostname for ten
// minutes wondering what they did wrong is worse than one that says nothing.
import { useEffect, useState } from 'react';
import { Globe, Copy, CheckCircle2, AlertTriangle, RefreshCw, Trash2, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Spinner, copyText } from './ui.jsx';
import { useI18n } from '../i18n.jsx';

export default function DomainPanel({ kind, id }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [state, setState] = useState(undefined);  // undefined = loading
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/me/${kind}/${id}/domain`)
    .then((d) => { setState(d); setHost(d.domain?.host || ''); })
    .catch(() => setState({ domain: null, eligible: { ok: false, reason: 'failed' } }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind, id]);

  const save = async () => {
    setBusy(true);
    try { const d = await api.put(`/me/${kind}/${id}/domain`, { host }); setState((s) => ({ ...s, domain: d.domain })); }
    catch (x) {
      // Each refusal is a different thing to do next, so each gets its own sentence. "Failed."
      // over a hostname field tells somebody nothing about which of the four it was.
      const e = x.data?.error;
      toast.error(
        e === 'bad_host' ? t('dom.err.host', 'That is not a hostname we can serve. Use a subdomain like mods.example.com — no wildcards, no IP addresses.')
        : e === 'our_host' ? t('dom.err.ours', 'That name is ours. Point one of your own at us instead.')
        : e === 'host_taken' ? t('dom.err.taken', 'That hostname is already in use here.')
        : e === 'free_plan' ? t('dom.err.free', 'Custom domains are part of the paid pools.')
        : e === 'no_pool' ? t('dom.err.nopool', 'This one is not in a pool yet.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/me/${kind}/${id}/domain/verify`, {});
      setState((s) => ({ ...s, domain: d.domain }));
      if (d.ok) toast.success(t('dom.ok', 'Verified. The certificate is issued on the first visit — give it a minute.'));
      else toast.error(t('dom.notyet', 'Not there yet. DNS changes can take a while to travel; the record has to be readable from the public internet before this can pass.'));
    } catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('dom.del', 'Remove this domain'),
      message: t('dom.del.m', 'It stops being served on that name straight away. The bettercommunity address keeps working, as it has all along.'),
      okLabel: t('dom.del.ok', 'Remove'), danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try { await api.del(`/me/${kind}/${id}/domain`); setState((s) => ({ ...s, domain: null })); setHost(''); }
    catch { toast.error(t('repos.failed', 'Failed.')); } finally { setBusy(false); }
  };

  if (state === undefined) return <Card className="p-5 flex justify-center"><Spinner /></Card>;

  const d = state.domain;
  const gate = state.eligible || { ok: false };
  if (!gate.ok) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><Globe size={16} className="text-[var(--muted)]" /> {t('dom.t', 'Your own domain')}</div>
        <p className="text-[13px] text-[var(--muted)] leading-relaxed mt-2">
          {gate.reason === 'free_plan' ? t('dom.gate.free', 'Serving your own hostname means obtaining and renewing a certificate for it, so it comes with the paid pools. The free plan keeps its bettercommunity address.')
            : gate.reason === 'no_pool' ? t('dom.gate.nopool', 'This is not in a storage pool yet, so there is nothing here for a domain to point at.')
            : gate.reason === 'not_hosted' ? t('dom.gate.ext', 'This repo lives on your own server, so it already answers at your own address — that is the thing a domain here would point to.')
            : t('dom.gate.other', 'Not available for this one.')}
        </p>
        {gate.reason === 'free_plan' && <a href="/hosting#plans" className="inline-block mt-3"><Button size="sm" variant="secondary">{t('dom.gate.see', 'See the plans')}</Button></a>}
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><Globe size={16} className="text-[var(--primary-2)]" /> {t('dom.t', 'Your own domain')}</div>
        {d && (d.verified
          ? <Badge tone="success"><CheckCircle2 size={11} /> {t('dom.verified', 'Verified')}</Badge>
          : <Badge tone="warning"><AlertTriangle size={11} /> {t('dom.pending', 'Waiting on DNS')}</Badge>)}
      </div>

      <div className="flex gap-2 mt-3">
        <Input className="flex-1" placeholder="mods.example.com" value={host} onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && host.trim()) save(); }} />
        <Button variant="secondary" disabled={busy || !host.trim() || host.trim() === d?.host} onClick={save}>
          {busy ? <Spinner /> : t('common.save', 'Save')}
        </Button>
        {d && <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 size={15} /></Button>}
      </div>

      {!d && (
        <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-3">
          {t('dom.intro', 'Point a subdomain at us with a CNAME, then add it here. We check that you hold the name before serving anything on it.')}
        </p>
      )}

      {d && (
        <div className="mt-4 space-y-3">
          {/* The two records, laid out to be copied rather than transcribed. A hostname typed
              from a screenshot into a DNS panel is a support ticket waiting to happen. */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('dom.dns', 'Add these to your DNS')}</div>
          {[
            ['CNAME', d.host, t('dom.cname.v', 'your BetterCommunity hostname')],
            [d.record.type, d.record.name, d.record.value],
          ].map(([type, name, value]) => (
            <div key={type + name} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--faint)] mb-1"><span className="font-bold">{type}</span><span className="truncate">{name}</span></div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-[12px]">{value}</code>
                <button type="button" className="text-[var(--muted)] hover:text-[var(--text)] shrink-0"
                  onClick={() => { copyText(value); toast.success(t('common.copied', 'Copied.')); }} aria-label={t('common.copy', 'Copy')}><Copy size={13} /></button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant={d.verified ? 'ghost' : 'primary'} disabled={busy} onClick={verify}>
              <RefreshCw size={14} /> {d.verified ? t('dom.recheck', 'Check again') : t('dom.check', 'Check now')}
            </Button>
            {d.lastCheckedAt && (
              <span className="text-[11.5px] text-[var(--faint)]">
                {t('dom.last', 'Last checked {t}').replace('{t}', new Date(d.lastCheckedAt).toLocaleTimeString())}
                {d.lastError ? ` — ${d.lastError}` : ''}
              </span>
            )}
          </div>

          {d.verified
            ? <div className="text-[12px] text-[var(--muted)] flex items-start gap-1.5"><Lock size={13} className="shrink-0 mt-0.5 text-success" /><span>{t('dom.cert', 'The certificate is obtained on the first visit to that name, so the very first request can take a few seconds.')}</span></div>
            : <div className="text-[12px] text-[var(--muted)] flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" /><span>{t('dom.wait', 'Nothing is served on that name until the check passes. DNS changes can take anywhere from a minute to a few hours to travel.')}</span></div>}
        </div>
      )}
    </Card>
  );
}
