// "Serve this on my own domain."
//
// One component for repos and catalogues, because it is one feature and the only difference
// is a word in the URL. The panel's real job is not the form — it is being honest about the
// two waits either side of it: DNS propagation before we can verify, and certificate issuance
// after. A panel that says "saved" and leaves somebody refreshing their own hostname for ten
// minutes wondering what they did wrong is worse than one that says nothing.
//
// Every record printed here comes from the API as a whole (type, name, value): the TXT proof
// in `domain.record`, the CNAME in `domain.pointer`, and for the /hosting guide the same two
// from GET /domains/guide. The page never glues a prefix to a host itself, because the rule
// for that lives in apps/api/src/lib/domain.mjs (dnsRecordsFor) and a second copy here is the
// one that would drift.
import { useEffect, useState } from 'react';
import { Globe, Copy, CheckCircle2, AlertTriangle, RefreshCw, Trash2, Lock, Clock, CircleDashed } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast, useDialog, Button, Card, Badge, Input, Spinner, copyText, Explain } from './ui.jsx';
import { useI18n } from '../i18n.jsx';

/** A copy button that says what it copies, for a screen reader and for the tooltip. */
function CopyBtn({ value, what }) {
  const { t } = useI18n(); const toast = useToast();
  const label = t('dom.copy.what', 'Copy the {x}').replace('{x}', what);
  return (
    <button type="button" title={label} aria-label={label}
      className="shrink-0 inline-grid place-items-center w-8 h-8 max-lg:w-11 max-lg:h-11 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
      onClick={() => { copyText(value); toast.success(t('common.copied', 'Copied.')); }}>
      <Copy size={14} />
    </button>
  );
}

/**
 * The records to create, one card each: what it is for, then type / name / value.
 *
 * Laid out as label-over-value rather than a three-column table: a TXT name is long, a token is
 * longer, and a table on a phone either scrolls sideways or cuts them, and a record copied with
 * its last characters missing is a verification that never passes. Values wrap (`break-all`),
 * never truncate.
 *
 * `records`: [{ key, purpose, type, name, value }]. `sample` marks the /hosting guide, where the
 * token is a placeholder and there is nothing to copy for real.
 */
export function DnsRecords({ records, sample = false }) {
  const { t } = useI18n();
  return (
    <ol className="dns-records flex flex-col gap-3">
      {records.map((r, i) => (
        <li key={r.key} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5 sm:p-4 min-w-0">
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="shrink-0 grid place-items-center w-6 h-6 rounded-full border border-[var(--line-strong)] text-[12px] font-bold text-[var(--muted)] tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold leading-snug">{r.purpose}</div>
              <dl className="mt-2.5 grid gap-2 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <dt className="text-[var(--muted)] min-w-[4.5rem]">{t('dom.rec.type', 'Type')}</dt>
                  <dd><code className="font-bold px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)]">{r.type}</code></dd>
                </div>
                {[['name', t('dom.rec.name', 'Name / host'), r.name], ['value', t('dom.rec.value', 'Value / target'), r.value]].map(([k, label, v]) => (
                  <div key={k} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <dt className="text-[var(--muted)] min-w-[4.5rem] pt-1">{label}</dt>
                    <dd className="min-w-0 flex-1 flex items-start gap-1 rounded-md bg-[var(--surface)] border border-[var(--line)] ps-2">
                      <code className="flex-1 min-w-0 break-all py-1.5 leading-snug">{v}</code>
                      {!sample && <CopyBtn value={v} what={label} />}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The API's `lastError` is a resolver code; this is the sentence it stands for. */
function lastErrorText(code, t) {
  if (!code) return '';
  if (code === 'txt_mismatch') return t('dom.err.mismatch', 'A TXT record is there, but its value is not the one above. Check for a typo or an extra space, or a record left from an earlier try.');
  if (code === 'ENOTFOUND' || code === 'ENODATA') return t('dom.err.notfound', 'No TXT record found at that name yet.');
  return t('dom.err.dns', 'The DNS servers for that name did not give an answer ({c}). Try again in a few minutes.').replace('{c}', code);
}

export default function DomainPanel({ kind, id }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [state, setState] = useState(undefined);  // undefined = loading
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  // What the last "Check now" said about the traffic (ok / missing / unknown). Not stored by
  // the API, so it only exists after a check in this visit, and says nothing before one.
  const [traffic, setTraffic] = useState(null);

  const load = () => api.get(`/me/${kind}/${id}/domain`)
    .then((d) => { setState(d); setHost(d.domain?.host || ''); })
    .catch(() => setState({ domain: null, eligible: { ok: false, reason: 'failed' } }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind, id]);

  const save = async () => {
    setBusy(true);
    try { const d = await api.put(`/me/${kind}/${id}/domain`, { host }); setState((s) => ({ ...s, domain: d.domain })); setTraffic(null); }
    catch (x) {
      // Each refusal is a different thing to do next, so each gets its own sentence. "Failed."
      // over a hostname field tells somebody nothing about which of the four it was.
      const e = x.data?.error;
      toast.error(
        e === 'bad_host' ? t('dom.err.host', 'That is not a hostname we can serve. Use a subdomain like mods.example.com, no wildcards, no IP addresses.')
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
      setTraffic(d.traffic || null);
      if (d.ok) toast.success(t('dom.ok', 'Verified. The certificate is issued on the first visit, give it a minute.'));
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
    try { await api.del(`/me/${kind}/${id}/domain`); setState((s) => ({ ...s, domain: null })); setHost(''); setTraffic(null); }
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
            : gate.reason === 'not_hosted' ? t('dom.gate.ext', 'This repo lives on your own server, so it already answers at your own address, that is the thing a domain here would point to.')
            : t('dom.gate.other', 'Not available for this one.')}
        </p>
        {gate.reason === 'free_plan' && <a href="/hosting#plans" className="inline-block mt-3"><Button size="sm" variant="secondary">{t('dom.gate.see', 'See the plans')}</Button></a>}
      </Card>
    );
  }

  // The two records, in the order they are created: the proof first (it can go in while the
  // name still points somewhere else), then the traffic.
  const records = d ? [
    { key: 'proof', purpose: t('dom.rec.proof', 'Prove the name is yours'), ...d.record },
    ...(d.pointer ? [{ key: 'pointer', purpose: t('dom.rec.pointer', 'Send its traffic here'), ...d.pointer }] : []),
  ] : [];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><Globe size={16} className="text-[var(--accent-ink)]" /> {t('dom.t', 'Your own domain')}</div>
        {d && (d.verified
          ? <Badge tone="success"><CheckCircle2 size={11} /> {t('dom.verified', 'Verified')}</Badge>
          : <Badge tone="warning"><AlertTriangle size={11} /> {t('dom.pending', 'Waiting on DNS')}</Badge>)}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Input className="flex-1 min-w-[12rem]" placeholder="mods.example.com" value={host} onChange={(e) => setHost(e.target.value)}
          aria-label={t('dom.host', 'Your hostname')}
          onKeyDown={(e) => { if (e.key === 'Enter' && host.trim()) save(); }} />
        <Button variant="secondary" disabled={busy || !host.trim() || host.trim() === d?.host} onClick={save}>
          {busy ? <Spinner /> : t('common.save', 'Save')}
        </Button>
        {d && <Button variant="ghost" disabled={busy} onClick={remove} title={t('dom.del', 'Remove this domain')} aria-label={t('dom.del', 'Remove this domain')}><Trash2 size={15} /></Button>}
      </div>

      {!d && (
        <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-3">
          {t('dom.intro2', 'Type the hostname you want (a subdomain like mods.example.com works best) and save. We then show the two DNS records to create at the company that manages your domain, with the exact values to copy.')}
        </p>
      )}

      {d && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="text-[13px] font-semibold">{t('dom.dns2', 'Create these records at your DNS provider')}</div>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-1">
              {t('dom.dns2.s', 'That is the company where you bought the domain, or wherever its DNS is managed (Cloudflare, OVH, Gandi, your registrar). Copy each field as it is.')}
            </p>
          </div>

          <DnsRecords records={records} />

          {/* The two traps that make a correct record look wrong. Folded: somebody whose panel
              takes the full name never needs to read it. */}
          <Explain className="text-[12px]" label={t('dom.tips.l', 'If your provider refuses a record')}>
            <ul className="list-disc ms-4 space-y-1.5 text-[var(--muted)] leading-relaxed">
              <li>{t('dom.tip.zone', 'Some providers add your domain to the name by themselves. If yours shows it after the field, type only the part before it (for example the name without ".example.com").')}</li>
              <li>{t('dom.tip.apex', 'A CNAME cannot sit on the bare domain (example.com itself). Use a subdomain, or your provider\'s ALIAS, ANAME or "CNAME flattening" record with the same value.')}</li>
              <li>{t('dom.tip.proxy', 'If your provider offers a proxy (the orange cloud at Cloudflare), turn it off for this name so the certificate can be issued.')}</li>
            </ul>
          </Explain>
          {!d.pointer && (
            <p className="text-[12px] text-warning flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{t('dom.nopointer', 'This site has no public hostname configured, so there is nothing to point a CNAME at yet. An administrator sets it (SITE_URL).')}</span>
            </p>
          )}

          <div className="rounded-xl border border-[var(--line)] p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant={d.verified ? 'ghost' : 'primary'} disabled={busy} onClick={verify}>
                {busy ? <Spinner /> : <RefreshCw size={14} />} {d.verified ? t('dom.recheck', 'Check again') : t('dom.check', 'Check now')}
              </Button>
              {d.lastCheckedAt && (
                <span className="text-[11.5px] text-[var(--faint)]">
                  {t('dom.last', 'Last checked {t}').replace('{t}', new Date(d.lastCheckedAt).toLocaleTimeString())}
                </span>
              )}
            </div>
            {/* One line per record, each with its own state: "verified" answers the first and
                says nothing about the second, and that is the confusion this removes. */}
            <ul className="space-y-2 text-[12.5px]">
              <li className="flex items-start gap-2">
                {d.verified ? <CheckCircle2 size={15} className="shrink-0 mt-px text-success" />
                  : d.lastCheckedAt ? <AlertTriangle size={15} className="shrink-0 mt-px text-warning" />
                  : <CircleDashed size={15} className="shrink-0 mt-px text-[var(--faint)]" />}
                <span className="min-w-0">
                  <span className="font-medium">{t('dom.st.proof', 'Ownership (TXT)')}</span>{' · '}
                  <span className="text-[var(--muted)]">
                    {d.verified ? t('dom.st.proof.ok', 'found and matching')
                      : d.lastCheckedAt ? lastErrorText(d.lastError, t) || t('dom.st.proof.no', 'not found yet')
                      : t('dom.st.never', 'not checked yet')}
                  </span>
                </span>
              </li>
              {d.pointer && (
                <li className="flex items-start gap-2">
                  {traffic === 'ok' ? <CheckCircle2 size={15} className="shrink-0 mt-px text-success" />
                    : traffic === 'missing' ? <AlertTriangle size={15} className="shrink-0 mt-px text-warning" />
                    : <CircleDashed size={15} className="shrink-0 mt-px text-[var(--faint)]" />}
                  <span className="min-w-0">
                    <span className="font-medium">{t('dom.st.traffic', 'Traffic (CNAME)')}</span>{' · '}
                    <span className="text-[var(--muted)]">
                      {traffic === 'ok' ? t('dom.st.traffic.ok', 'the name already reaches us')
                        : traffic === 'missing' ? t('dom.st.traffic.no', 'the name does not reach us yet')
                        : t('dom.st.traffic.unk', 'shown after a check')}
                    </span>
                  </span>
                </li>
              )}
            </ul>
            <p className="text-[12px] text-[var(--muted)] flex items-start gap-1.5 leading-relaxed">
              {d.verified
                ? <><Lock size={13} className="shrink-0 mt-0.5 text-success" /><span>{t('dom.cert', 'The certificate is obtained on the first visit to that name, so the very first request can take a few seconds.')}</span></>
                : <><Clock size={13} className="shrink-0 mt-0.5 text-[var(--faint)]" /><span>{t('dom.wait', 'Nothing is served on that name until the check passes. DNS changes can take anywhere from a minute to a few hours to travel.')}</span></>}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The same two records, explained before anybody has bought anything: the guide on /hosting.
 *
 * The records come from GET /domains/guide, built by the helper that builds the owner's real
 * ones, for an example hostname. Only the token is a placeholder, and the text says where the
 * real one appears. If the request fails the steps still read correctly; the record cards are
 * what is left out, rather than a hand-written copy of them.
 */
export function DomainGuide() {
  const { t } = useI18n();
  const [g, setG] = useState(undefined);
  useEffect(() => { api.get('/domains/guide').then(setG).catch(() => setG(null)); }, []);
  const records = g ? [
    { key: 'proof', purpose: t('dom.rec.proof', 'Prove the name is yours'), ...g.proof },
    ...(g.pointer ? [{ key: 'pointer', purpose: t('dom.rec.pointer', 'Send its traffic here'), ...g.pointer }] : []),
  ] : [];
  const steps = [
    [t('dom.g.s1', 'Add the name in your dashboard'), t('dom.g.s1.d', 'Open the repo or catalogue (it has to be in a paid pool), find "Your own domain" and type the hostname, for example mods.example.com.')],
    [t('dom.g.s2', 'Create two records at your DNS provider'), t('dom.g.s2.d', 'A TXT record that proves the name is yours, and a CNAME that sends its traffic here. Your dashboard shows both with your own values and a copy button.')],
    [t('dom.g.s3', 'Press "Check now"'), t('dom.g.s3.d', 'As soon as the TXT record can be read from the internet, the name is verified and served over HTTPS. The certificate is obtained on the first visit.')],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start">
      <ol className="flex flex-col gap-4">
        {steps.map(([title, desc], i) => (
          <li key={title} className="flex items-start gap-3">
            <span aria-hidden className="shrink-0 grid place-items-center w-8 h-8 rounded-full text-[13px] font-bold tabular-nums text-[var(--accent-ink)] border border-[color-mix(in_srgb,var(--primary)_45%,var(--line))]"
              style={{ background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>{i + 1}</span>
            <div className="min-w-0">
              <div className="font-semibold text-[14.5px] leading-snug">{title}</div>
              <p className="text-[13px] text-[var(--muted)] leading-relaxed mt-1">{desc}</p>
            </div>
          </li>
        ))}
        <li className="flex items-start gap-3 text-[12.5px] text-[var(--muted)] leading-relaxed">
          <Clock size={16} className="shrink-0 mt-0.5 ms-2 text-[var(--faint)]" aria-hidden />
          <span>{t('dom.g.prop', 'DNS changes usually show up within minutes, and can take a few hours with some providers. Nothing is served on the name until the check passes, so there is no half-working moment.')}</span>
        </li>
      </ol>
      {g === undefined ? <div className="py-8 grid place-items-center"><Spinner /></div>
        : g ? (
          <div className="min-w-0">
            <div className="text-[12px] text-[var(--muted)] mb-2">
              {t('dom.g.example', 'For {h}, the records look like this:').replace('{h}', g.host)}
            </div>
            <DnsRecords records={records} sample />
            <p className="text-[11.5px] text-[var(--muted)] mt-2 leading-relaxed">
              {t('dom.g.token', 'The TXT value is different for every domain: yours is shown in your dashboard once you add the name.')}
            </p>
          </div>
        ) : null}
    </div>
  );
}
