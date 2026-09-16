import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Save, RefreshCw, Percent, Clock, Database, Info } from "lucide-react";
import { apiGet, apiPost, bcHome } from "../lib/store";
import { Card, PageHeader, Button, Input, Bar, Skeleton, EmptyState, Badge, LearnMore } from "../components/ui";

// Runtime settings of the collector: retention, the erasure review delay, the storage cap
// and SAMPLING. They live in the service's `meta` table (not in .env), so a change applies
// live — the hourly loops read them on every pass and every /batch answer carries the
// sampling document to the BMM clients. BCWEB's Hosting settings panel edits the same
// document through GET/POST /api/admin/config.

type Sampling = { total: number } & Record<string, number>;
type Config = { storageLimitMb: number; retentionDays: number; deleteDelayH: number; sampling: Sampling };

// Same order + meaning as `sampling::KINDS` on the server and `sampling_kind` in BMM.
const KINDS: { key: string; label: string; desc: string }[] = [
  { key: "events", label: "Events", desc: "page views, clicks, modals, features — everything not listed below" },
  { key: "replay", label: "Session replays", desc: "rrweb DOM recordings ($replay chunks); by far the heaviest kind" },
  { key: "errors", label: "Errors & crashes", desc: "JS errors, Rust panics, crash tails" },
  { key: "perf", label: "Performance", desc: "web vitals, frame times, heap" },
  { key: "benchmarks", label: "Benchmarks", desc: "the benchmark suite's results" },
  { key: "logs", label: "Logs", desc: "$log_js / $log_rust lines attached to sessions" },
];

export default function Settings() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet("/api/admin/config");
      if (r?.error) { setErr(String(r.error)); return; }
      setErr("");
      setCfg(r.config); setDraft(r.config);
    } catch { setErr("Could not load the configuration."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(draft), [cfg, draft]);
  const set = (patch: Partial<Config>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setPct = (k: string, v: number) => setDraft((d) => (d ? { ...d, sampling: { ...d.sampling, [k]: Math.max(0, Math.min(100, Math.round(v))) } } : d));

  const save = async () => {
    if (!draft) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost("/api/admin/config", draft);
      if (r?.ok) { setCfg(r.config); setDraft(r.config); setMsg({ ok: true, text: "Saved — clients pick the sampling up on their next upload." }); }
      else setMsg({ ok: false, text: r?.error || "Save failed." });
    } catch { setMsg({ ok: false, text: "Save failed." }); }
    finally { setBusy(false); }
  };

  // What the sampling means in installs: the total cap first, then each kind inside it.
  const effective = (k: string) => draft ? Math.round((draft.sampling.total / 100) * (draft.sampling[k] ?? 100)) : 100;

  if (err) return <EmptyState icon={SlidersHorizontal} title="Locked">{err} Enter the admin key (top right) or open the dashboard from BetterCommunity.</EmptyState>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={SlidersHorizontal}
        title="Settings"
        sub="Live collector settings — stored in the database, applied without a restart. The same values BetterCommunity › Admin › Hosting settings edits."
        right={<>
          <Button variant="ghost" icon={RefreshCw} onClick={load} disabled={busy}>Reload</Button>
          <Button variant="primary" icon={Save} onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</Button>
        </>}
      />
      {msg && <div className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</div>}

      {!draft ? (
        <div className="grid md:grid-cols-2 gap-4"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={6} /></Card></div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <Card title={<span className="inline-flex items-center gap-2"><Clock size={14} className="text-brand" /> Retention & erasure</span>}>
              <div className="space-y-3">
                <Field label="Retention (days)" hint="Raw rows older than this are purged every hour. 1–3650.">
                  <Input type="number" min={1} max={3650} value={draft.retentionDays} onChange={(e) => set({ retentionDays: +e.target.value })} className="w-32" />
                </Field>
                <Field label="Erasure review delay (hours)" hint="A deletion request (packet or GDPR) waits this long before it auto-applies; an admin can process it earlier. 0–720.">
                  <Input type="number" min={0} max={720} value={draft.deleteDelayH} onChange={(e) => set({ deleteDelayH: +e.target.value })} className="w-32" />
                </Field>
              </div>
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><Database size={14} className="text-brand" /> Storage cap</span>}>
              <Field label="Storage limit (MB)" hint="Past ~120% of this the oldest packets are auto-purged at once, not at the next hourly pass. Minimum 128.">
                <Input type="number" min={128} step={64} value={draft.storageLimitMb} onChange={(e) => set({ storageLimitMb: +e.target.value })} className="w-32" />
              </Field>
              <p className="text-xs text-sub mt-3">Usage and per-table sizes are on the <a className="text-brand" href="/storage">Storage</a> screen.</p>
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><Info size={14} className="text-brand" /> How sampling works</span>}>
              <p className="text-xs text-sub">The decision is <b className="text-ink">per install, not per event</b>, so an install is fully in or fully out of a kind and its data stays coherent over time.</p>
              <LearnMore className="mt-2">
                <ul className="list-disc pl-4 space-y-1.5">
                  <li>The rule is fnv1a-32 of <code className="font-mono">creator_id:kind</code> modulo 10 000 against the percentage.</li>
                  <li>The <b className="text-ink">total cap</b> is applied first: an install outside it sends nothing at all. Each kind is then sampled inside that population.</li>
                  <li>The document rides in every <code className="font-mono">/batch</code> answer and on <code className="font-mono">GET /config</code>; BMM stores it and skips excluded events before they are even queued. The server applies the same rule on ingest, so an old client is trimmed to the same population.</li>
                  <li>Sampling never touches what is already stored, GDPR requests or the session-end beacon (trimmed server-side).</li>
                </ul>
              </LearnMore>
            </Card>
          </div>

          <Card title={<span className="inline-flex items-center gap-2"><Percent size={14} className="text-brand" /> Sampling</span>} right={<Badge tone={draft.sampling.total < 100 ? "warn" : "good"}>{draft.sampling.total}% of installs</Badge>}>
            <div className="space-y-4">
              <PctRow label="Total cap" desc="share of installs that send anything at all" value={draft.sampling.total} onChange={(v) => setPct("total", v)} strong />
              <div className="border-t border-line/60 pt-3 space-y-3">
                {KINDS.map((k) => (
                  <PctRow key={k.key} label={k.label} desc={k.desc} value={draft.sampling[k.key] ?? 100} onChange={(v) => setPct(k.key, v)} eff={effective(k.key)} />
                ))}
              </div>
              <p className="text-[11px] text-sub">Effective share = total cap × kind.</p>
              <LearnMore label="What 0% does">A kind at 0% stops that element for everyone without touching the rest.</LearnMore>
            </div>
          </Card>
        </div>
      )}
      <p className="text-xs text-sub">Also editable from <a className="text-brand" href={bcHome() + "/admin"} target="_blank" rel="noreferrer">BetterCommunity › Admin › Hosting settings</a>.</p>
      <LearnMore label="Where changes are recorded">Every change to these values is written to the audit log with the IP and the browser fingerprint that made it, whichever panel it came from.</LearnMore>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-sub">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function PctRow({ label, desc, value, onChange, eff, strong }: { label: string; desc: string; value: number; onChange: (v: number) => void; eff?: number; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm ${strong ? "font-semibold" : ""}`}>{label}</div>
          <div className="text-xs text-sub truncate">{desc}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {eff != null && eff !== value && <span className="text-[11px] text-sub tabular-nums" title="effective share of all installs">≈ {eff}%</span>}
          <Input type="number" min={0} max={100} value={value} onChange={(e) => onChange(+e.target.value)} className="w-20 py-1 text-right tabular-nums" />
          <span className="text-xs text-sub">%</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(+e.target.value)} className="flex-1 accent-brand" aria-label={label} />
        <div className="w-24"><Bar pct={value} color={value === 0 ? "bg-bad" : value < 100 ? "bg-warn" : "bg-good"} /></div>
      </div>
    </div>
  );
}
