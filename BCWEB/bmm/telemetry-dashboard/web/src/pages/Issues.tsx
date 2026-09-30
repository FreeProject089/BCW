import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bug, Radio, RefreshCw, Sparkles, Search, AlertTriangle, TrendingUp, FileArchive, PlayCircle, Save, RotateCcw } from "lucide-react";
import { useStore, apiGet, apiPost, streamUrl, isDemo } from "../lib/store";
import { Card, Kpi, EmptyState, PageHeader, Button, Input, Badge, Table, TableSkeleton, Segmented, Drawer, SectionTitle, Sparkline, LearnMore } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";
import { applyLive, effective, pct, LEVEL_TONE, STATUS_TONE, type Issue, type LiveEvent } from "../lib/issues";

// Issues: what BMM reports the moment something goes wrong, grouped by fingerprint, live.
//
// Every row arrives redacted twice (by BMM, then on ingest). The install behind a row is a
// pseudonymous hash that joins to nothing else here; the screen shows counts per version and OS,
// never per install. Laya's labels come from the BCWEB API's AI layer (see issues_ai.rs) and
// staff corrections are stored next to them, never over them.

type AiDoc = {
  enabled: boolean; switch: boolean; env_allowed: boolean; bc_configured: boolean;
  runtime: { counters: any; queue_depth: number; breaker_open: boolean; paused_until: number };
  quality: { corrections: number; kept: number; agreement: number | null; classified: number; by_status: { status: string; count: number }[] };
  vocabulary: { category: string[]; severity: string[]; origin: string[] };
  spike: { factor: number; min: number };
};
type ListDoc = { issues: Issue[]; spikes: number; components: string[]; versions: string[]; summary: { open: number; new_24h: number; regressed: number; occurrences: number } };

const human = (s?: string | null) => (s ? s.replace(/_/g, " ") : "");

function LabelChip({ issue, k }: { issue: Issue; k: "category" | "severity" | "origin" }) {
  const e = effective(issue, k);
  if (!e.value) return issue.ai_status === "pending" && k === "category" ? <span className="text-xs text-sub">Laya…</span> : null;
  return (
    <Badge tone={e.by === "staff" ? "good" : "brand"} className="gap-1" >
      {e.by === "laya" && <Sparkles size={10} />}{human(e.value)}{e.p != null && <span className="opacity-70">{pct(e.p)}</span>}
    </Badge>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="bg-panel2 border border-line rounded-lg px-2 py-1.5 text-sm">
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{human(o)}</option>)}
    </select>
  );
}

export default function Issues() {
  const { adminKey } = useStore();
  const [doc, setDoc] = useState<ListDoc | null>(null);
  const [ai, setAi] = useState<AiDoc | null>(null);
  const [status, setStatus] = useState<"open" | "resolved" | "ignored" | "">("open");
  const [level, setLevel] = useState("");
  const [component, setComponent] = useState("");
  const [category, setCategory] = useState("");
  const [version, setVersion] = useState("");
  const [sort, setSort] = useState<"last" | "count" | "first" | "installs">("last");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
  const [feed, setFeed] = useState<Extract<LiveEvent, { type: "issue" }>[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const refetchTimer = useRef<number | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (level) p.set("level", level);
    if (component) p.set("component", component);
    if (category) p.set("category", category);
    if (version) p.set("version", version);
    if (q.trim()) p.set("q", q.trim());
    p.set("sort", sort);
    return p.toString();
  }, [status, level, component, category, version, q, sort]);

  const load = useCallback(async () => {
    try { setDoc(await apiGet<ListDoc>(`/api/issues?${query}`)); } catch { /* keep the last list */ }
  }, [query]);
  const loadAi = useCallback(async () => { try { setAi(await apiGet<AiDoc>("/api/issues/ai")); } catch { /* ignore */ } }, []);

  useEffect(() => { load(); }, [load, adminKey]);
  useEffect(() => { loadAi(); const t = window.setInterval(loadAi, 30000); return () => clearInterval(t); }, [loadAi]);

  // The live stream: occurrences update rows in place; a new group, a staff change elsewhere or a
  // regression refetches (debounced, a burst of errors is one request).
  useEffect(() => {
    const url = streamUrl("/api/issues/stream");
    if (!url) { setLive(true); return; }
    let es: EventSource | null = null;
    let closed = false;
    const connect = () => {
      es = new EventSource(url);
      es.onopen = () => setLive(true);
      es.onmessage = (m) => {
        let ev: LiveEvent;
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "issue") setFeed((f) => [ev as any, ...f].slice(0, 30));
        setDoc((d) => {
          if (!d) return d;
          const r = applyLive(d.issues, ev);
          if (r.refetch && refetchTimer.current == null) {
            refetchTimer.current = window.setTimeout(() => { refetchTimer.current = null; load(); }, 1000);
          }
          return r.list === d.issues ? d : { ...d, issues: r.list };
        });
      };
      es.onerror = () => { setLive(false); es?.close(); if (!closed) window.setTimeout(connect, 5000); };
    };
    connect();
    return () => { closed = true; es?.close(); };
  }, [load]);

  const s = doc?.summary;
  const vocab = ai?.vocabulary;
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Bug}
        title="Issues"
        sub="Errors BMM reports as they happen, grouped, with Laya's first read."
        right={
          <div className="flex items-center gap-2">
            <Badge tone={live ? "good" : "sub"} className="gap-1"><Radio size={11} />{live ? "live" : "reconnecting"}</Badge>
            <Button size="sm" icon={RefreshCw} onClick={() => { load(); loadAi(); }}>Refresh</Button>
          </div>
        }
      />
      <LearnMore label="What is collected">
        Only from installs that accepted telemetry AND left "Send errors live" on. The message and the stack are redacted on the
        user's machine (secrets, user-folder names, e-mails, IPs) and scrubbed again here. An install appears as a hash that
        nothing else on this dashboard can be joined to; a GDPR request still reaches it.
      </LearnMore>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Open" value={nf(s?.open)} />
        <Kpi label="New (24 h)" value={nf(s?.new_24h)} />
        <Kpi label="Regressed" value={nf(s?.regressed)} sub="resolved, then seen again" />
        <Kpi label="Spiking now" value={nf(doc?.spikes)} sub={ai ? `≥ ${ai.spike.min}/h and ×${ai.spike.factor}` : undefined} />
        <Kpi label="Occurrences" value={nf(s?.occurrences)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Live stream" className="lg:col-span-1" right={<Badge tone="sub">{feed.length}</Badge>}>
          {feed.length === 0 ? <p className="text-xs text-sub">Waiting for the next error… new reports appear here within seconds.</p> : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto min-w-0">
              {feed.map((e, i) => (
                <li key={`${e.fingerprint}-${i}`} className="text-xs flex items-start gap-2 min-w-0">
                  <Badge tone={LEVEL_TONE[e.level] || "sub"}>{e.level}</Badge>
                  <button className="text-left min-w-0 flex-1 truncate hover:underline" onClick={() => setOpen(e.fingerprint)} title={e.message}>
                    {e.new && <span className="text-brand font-semibold">NEW </span>}{e.regressed && <span className="text-bad font-semibold">REGRESSION </span>}
                    <span className="text-sub">[{e.component}]</span> {e.message}
                  </button>
                  <span className="text-sub shrink-0">×{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <LayaPanel ai={ai} onChange={setAi} className="lg:col-span-2" />
      </div>

      <Card title="Grouped issues">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Segmented options={[{ key: "open", label: "Open" }, { key: "resolved", label: "Resolved" }, { key: "ignored", label: "Ignored" }, { key: "", label: "All" }]} value={status} onChange={setStatus} />
          <Select label="Level" value={level} onChange={setLevel} options={["fatal", "error", "warning"]} />
          <Select label="Component" value={component} onChange={setComponent} options={doc?.components || []} />
          <Select label="Category" value={category} onChange={setCategory} options={vocab?.category || []} />
          <Select label="Version" value={version} onChange={setVersion} options={doc?.versions || []} />
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as any)} className="bg-panel2 border border-line rounded-lg px-2 py-1.5 text-sm">
            <option value="last">Last seen</option><option value="count">Most occurrences</option><option value="installs">Most installs</option><option value="first">Newest</option>
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2 top-2.5 text-sub" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message, code, fingerprint" className="pl-7 w-full" />
          </div>
        </div>
        {!doc ? <TableSkeleton rows={6} cols={6} /> : doc.issues.length === 0 ? (
          <EmptyState icon={Bug} title="No issue matches">Nothing reported for this filter. Live reports will show up here as they arrive.</EmptyState>
        ) : (
          <Table maxHeight={640}>
            <thead><tr><th>Issue</th><th>Laya / staff</th><th className="text-right">Count</th><th className="text-right">Installs</th><th>Versions</th><th>24 h</th><th>Last seen</th><th>Status</th></tr></thead>
            <tbody>
              {doc.issues.map((it) => (
                <tr key={it.fingerprint} className="cursor-pointer hover:bg-panel2" onClick={() => setOpen(it.fingerprint)}>
                  <td className="max-w-[420px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge tone={LEVEL_TONE[it.level] || "sub"}>{it.level}</Badge>
                      <span className="text-xs text-sub font-mono">{it.component}</span>
                      {it.spike && <Badge tone="bad" className="gap-1"><TrendingUp size={10} />spike</Badge>}
                      {it.regressed && <Badge tone="bad">regressed</Badge>}
                    </div>
                    <div className="text-sm truncate" title={it.message}>{it.message || "(no message)"}</div>
                  </td>
                  <td><div className="flex gap-1 flex-wrap"><LabelChip issue={it} k="category" /><LabelChip issue={it} k="severity" /></div></td>
                  <td className="text-right tabular-nums">{nf(it.total_count)}</td>
                  <td className="text-right tabular-nums">{nf(it.installs)}</td>
                  <td className="text-xs">{(it.versions || []).slice(0, 3).join(", ")}{(it.versions || []).length > 3 ? " …" : ""}</td>
                  <td className="w-28"><Sparkline data={it.spark || []} height={22} color={it.spike ? "#ef4444" : "#5b8cff"} /></td>
                  <td className="text-xs whitespace-nowrap">{fmtDateTime(it.last_seen)}</td>
                  <td><Badge tone={STATUS_TONE[it.status] || "sub"}>{it.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <IssueDrawer fp={open} onClose={() => setOpen(null)} vocab={vocab} list={doc?.issues || []} onSaved={() => { load(); loadAi(); }} />
    </div>
  );
}

function LayaPanel({ ai, onChange, className = "" }: { ai: AiDoc | null; onChange: (a: AiDoc) => void; className?: string }) {
  const [factor, setFactor] = useState("");
  const [min, setMin] = useState("");
  useEffect(() => { if (ai) { setFactor(String(ai.spike.factor)); setMin(String(ai.spike.min)); } }, [ai?.spike.factor, ai?.spike.min]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (body: any) => { const r = await apiPost<AiDoc & { error?: string }>("/api/issues/settings", body); if (!r?.error) onChange(r); };
  const c = ai?.runtime.counters || {};
  const state = !ai ? "…" : !ai.bc_configured ? "not connected to BCWEB" : !ai.env_allowed ? "off (ISSUES_AI=0)" : !ai.switch ? "off (switch)" : ai.runtime.breaker_open ? "paused (breaker)" : ai.runtime.paused_until > Date.now() ? `paused (${c.last_reason || "Laya off"})` : "on";
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-brand" />Laya</span>} className={className}
      right={ai && <Button size="sm" variant={ai.switch ? "default" : "primary"} onClick={() => save({ ai_enabled: !ai.switch })}>{ai.switch ? "Turn off" : "Turn on"}</Button>}>
      <p className="text-xs text-sub mb-3">
        Each new issue group is sent (redacted) to Laya through the BCWEB API: category, severity, "user environment or BMM bug",
        and whether a similar earlier group is the same problem. Asynchronous, queued, never on the ingest path. State: <b className="text-ink">{state}</b>.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <Kpi label="Classified" value={nf(ai?.quality.classified)} />
        <Kpi label="Calls ok / failed" value={`${nf(c.ok)} / ${nf(c.failed)}`} sub={`${nf(c.cache_hits)} from cache`} />
        <Kpi label="Latency p50 / p95" value={c.p50_ms != null ? `${c.p50_ms} / ${c.p95_ms} ms` : "—"} />
        <Kpi label="Staff kept Laya's category" value={ai?.quality.agreement != null ? pct(ai.quality.agreement) : "—"} sub={`${nf(ai?.quality.corrections)} correction(s)`} />
      </div>
      {c.last_error && <p className="text-xs text-warn mt-2">Last error: {c.last_error}</p>}
      <SectionTitle>Spike alert</SectionTitle>
      <div className="flex items-end gap-2 text-sm flex-wrap">
        <label className="text-xs text-sub">× the hourly average<Input value={factor} onChange={(e) => setFactor(e.target.value)} className="w-20 block" /></label>
        <label className="text-xs text-sub">and at least /hour<Input value={min} onChange={(e) => setMin(e.target.value)} className="w-24 block" /></label>
        <Button size="sm" icon={Save} onClick={() => save({ spike_factor: Number(factor) || 5, spike_min: Number(min) || 10 })}>Save</Button>
      </div>
    </Card>
  );
}

function IssueDrawer({ fp, onClose, vocab, list, onSaved }: { fp: string | null; onClose: () => void; vocab?: AiDoc["vocabulary"]; list: Issue[]; onSaved: () => void }) {
  const [d, setD] = useState<any>(null);
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState("");
  const [fix, setFix] = useState<{ category: string; severity: string; origin: string; duplicate_of: string }>({ category: "", severity: "", origin: "", duplicate_of: "" });
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    if (!fp) return;
    const local = list.find((x) => x.fingerprint === fp) || null;
    const r = isDemo() ? local : await apiGet<any>(`/api/issues/${fp}`).catch(() => local);
    setD(r && !r.error ? r : local);
  }, [fp, list]);
  useEffect(() => { setD(null); setMsg(""); load(); }, [fp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d) return;
    setAssignee(d.assignee || ""); setNotes(d.notes || "");
    setFix({ category: d.staff_labels?.category || "", severity: d.staff_labels?.severity || "", origin: d.staff_labels?.origin || "", duplicate_of: d.staff_labels?.duplicate_of || "" });
  }, [d?.fingerprint, d?.staff_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (url: string, body: any, ok: string) => {
    const r = await apiPost<any>(url, body);
    setMsg(r?.error ? `Error: ${r.error}` : ok);
    if (!r?.error) { load(); onSaved(); }
  };
  const cands: { fingerprint: string; similarity: number }[] = d?.ai_labels?.duplicate_candidates || [];
  return (
    <Drawer open={!!fp} onClose={onClose} title={d ? <span className="font-mono text-xs">{d.fingerprint}</span> : "Issue"} width={640}>
      {!d ? <TableSkeleton rows={4} cols={2} /> : (
        <div className="space-y-4 text-sm">
          <div className="flex gap-1.5 flex-wrap">
            <Badge tone={LEVEL_TONE[d.level] || "sub"}>{d.level}</Badge><Badge tone="sub">{d.component}</Badge>
            <Badge tone={STATUS_TONE[d.status] || "sub"}>{d.status}</Badge>{d.regressed && <Badge tone="bad">regressed</Badge>}
            {d.code && <Badge tone="sub" className="font-mono">{d.code}</Badge>}
          </div>
          <pre className="whitespace-pre-wrap break-words bg-panel2 border border-line rounded-lg p-3 text-xs">{d.message}</pre>
          {Array.isArray(d.frames) && d.frames.length > 0 && (
            <div><SectionTitle>Top frames</SectionTitle><ol className="text-xs font-mono space-y-0.5 list-decimal pl-5">{d.frames.map((f: string, i: number) => <li key={i} className="break-all">{f}</li>)}</ol></div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-sub">First seen</span><div>{fmtDateTime(d.first_seen)}</div></div>
            <div><span className="text-sub">Last seen</span><div>{fmtDateTime(d.last_seen)}</div></div>
            <div><span className="text-sub">Occurrences</span><div>{nf(d.total_count)}</div></div>
            <div><span className="text-sub">Installs</span><div>{nf(d.installs)}</div></div>
          </div>
          {Array.isArray(d.daily) && <div><SectionTitle>Last 14 days</SectionTitle><Sparkline data={d.daily} height={40} /></div>}
          {(d.crash_report || d.session_id) && (
            <div className="space-y-1 text-xs">
              {d.crash_report && <div className="flex items-center gap-1.5"><FileArchive size={13} className="text-sub" />Crash report on the user's machine: <span className="font-mono">{d.crash_report}</span> <span className="text-sub">(attached only if they send it with a bug report)</span></div>}
              {d.session_id && <div className="flex items-center gap-1.5"><PlayCircle size={13} className="text-sub" />{d.replay_available ? <a className="text-brand hover:underline" href={`/sessions?session=${encodeURIComponent(d.session_id)}`}>Session replay available</a> : <span className="text-sub">No replay stored for the session</span>}</div>}
            </div>
          )}
          {Array.isArray(d.by_version) && d.by_version.length > 0 && (
            <div><SectionTitle>Versions affected</SectionTitle>
              <Table><thead><tr><th>Version</th><th>OS</th><th className="text-right">Installs</th><th className="text-right">Count</th><th>Last</th></tr></thead>
                <tbody>{d.by_version.map((v: any, i: number) => <tr key={i}><td>{v.app_version || "?"}</td><td className="text-xs">{v.os}</td><td className="text-right">{nf(v.installs)}</td><td className="text-right">{nf(v.count)}</td><td className="text-xs">{fmtDateTime(v.last_seen)}</td></tr>)}</tbody></Table>
            </div>
          )}

          <div>
            <SectionTitle right={<Button size="sm" icon={RotateCcw} onClick={() => act(`/api/issues/${d.fingerprint}/reclassify`, {}, "Queued for Laya")}>Ask Laya again</Button>}>Laya</SectionTitle>
            {d.ai_status !== "done" ? <p className="text-xs text-sub">Status: {d.ai_status || "pending"}{d.ai_status === "off" ? " (Laya is off or not connected)" : ""}</p> : (
              <div className="flex gap-1.5 flex-wrap text-xs">
                {(["category", "severity", "origin"] as const).map((k) => d.ai_labels?.[k] && <Badge key={k} tone="brand" className="gap-1"><Sparkles size={10} />{k}: {human(d.ai_labels[k].value)} {pct(d.ai_labels[k].p)}</Badge>)}
                {d.ai_labels?.duplicate_of && <Badge tone="warn">duplicate of {d.ai_labels.duplicate_of.fingerprint.slice(0, 10)}… {pct(d.ai_labels.duplicate_of.p)}</Badge>}
                <span className="text-sub">{d.ai_model}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["category", "severity", "origin"] as const).map((k) => (
                <label key={k} className="text-xs text-sub">Correct {k}
                  <select value={fix[k]} onChange={(e) => setFix({ ...fix, [k]: e.target.value })} className="block w-full bg-panel2 border border-line rounded-lg px-2 py-1 text-sm text-ink">
                    <option value="">(keep)</option>{(vocab?.[k] || []).map((o) => <option key={o} value={o}>{human(o)}</option>)}
                  </select>
                </label>
              ))}
              <label className="text-xs text-sub">Duplicate of
                <select value={fix.duplicate_of} onChange={(e) => setFix({ ...fix, duplicate_of: e.target.value })} className="block w-full bg-panel2 border border-line rounded-lg px-2 py-1 text-sm text-ink">
                  <option value="">(none)</option>{cands.map((c) => <option key={c.fingerprint} value={c.fingerprint}>{c.fingerprint.slice(0, 12)}… ({pct(c.similarity)} similar)</option>)}
                </select>
              </label>
            </div>
            <Button size="sm" className="mt-2" icon={Save} onClick={() => {
              const body: any = {};
              for (const [k, v] of Object.entries(fix)) if (v) body[k] = v;
              if (!Object.keys(body).length) { setMsg("Nothing to correct"); return; }
              act(`/api/issues/${d.fingerprint}/labels`, body, "Correction saved (Laya's answer is kept for comparison)");
            }}>Save correction</Button>
          </div>

          <div>
            <SectionTitle>Triage</SectionTitle>
            <div className="flex gap-2 flex-wrap mb-2">
              {(["open", "resolved", "ignored"] as const).map((st) => (
                <Button key={st} size="sm" variant={d.status === st ? "primary" : "default"} onClick={() => act(`/api/issues/${d.fingerprint}`, { status: st }, `Marked ${st}`)}>{st}</Button>
              ))}
            </div>
            <label className="text-xs text-sub block">Assigned to<Input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full" /></label>
            <label className="text-xs text-sub block mt-2">Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full bg-panel2 border border-line rounded-lg px-2 py-1.5 text-sm text-ink" />
            </label>
            <Button size="sm" className="mt-2" icon={Save} onClick={() => act(`/api/issues/${d.fingerprint}`, { assignee, notes }, "Saved")}>Save</Button>
          </div>
          {msg && <p className="text-xs flex items-center gap-1"><AlertTriangle size={12} className="text-sub" />{msg}</p>}
          {Array.isArray(d.feedback) && d.feedback.length > 0 && (
            <div><SectionTitle>Corrections</SectionTitle>
              <ul className="text-xs space-y-1">{d.feedback.map((f: any, i: number) => <li key={i}>{fmtDateTime(f.ts)} · {f.by_who || "staff"}: {Object.entries(f.staff_labels || {}).map(([k, v]) => `${k}=${human(String(v))}`).join(", ")} <span className="text-sub">(Laya: {human(f.ai_labels?.category?.value) || "—"})</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
