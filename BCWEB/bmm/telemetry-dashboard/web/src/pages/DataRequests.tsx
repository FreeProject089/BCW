import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldAlert, Download, Play, XCircle, RefreshCw, Search, Plus, UserCheck, UserX, Mail, Inbox, Trash2, FileArchive } from "lucide-react";
import { useStore, apiGet, apiPost, apiDownload } from "../lib/store";
import { Card, Kpi, Empty, EmptyState, PageHeader, Button, Input, Badge, Table, TableSkeleton, Segmented, Drawer, SectionTitle } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";

// Data requests: the GDPR queue (export | delete, from BMM, BCWEB or this dashboard) and the
// per-packet deletion queue, on one screen. A request is (creator id, kind); the identity
// behind the id — linked BetterCommunity account or not — is asked to BCWEB when the request
// is filed and again when it is processed, never stored with the telemetry rows.
//
// Exports are processed as soon as they are filed (nothing to review: it is the person's own
// data), deletions once the review delay has passed — or now, from the button below.

type Req = {
  id: number; creator_id: string; kind: "export" | "delete"; source: string; email?: string | null;
  account_id?: string | null; account_email?: string | null; note?: string | null;
  status: "pending" | "done" | "rejected" | "failed"; result: any;
  created_ms: number; decided_ms?: number | null; notified_ms?: number | null; processed_by?: string | null;
};

const STATUS_TONE: Record<string, string> = { pending: "warn", done: "good", rejected: "bad", failed: "bad" };
const STATUS_LABEL: Record<string, string> = { pending: "Pending", done: "Done", rejected: "Rejected", failed: "Failed" };
const SOURCE_LABEL: Record<string, string> = { bmm: "BMM app", bcweb: "BetterCommunity", dashboard: "Dashboard" };

const fmtBytes = (b?: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(Math.max(1, b)) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const short = (id: string) => (id && id.length > 16 ? `${id.slice(0, 16)}…` : id || "—");

/** Where the confirmation goes, as a chip. */
function Recipient({ r }: { r: Req }) {
  if (r.account_id) return <Badge tone="brand" className="gap-1"><UserCheck size={11} /> linked account</Badge>;
  if (r.email) return <span className="font-mono text-xs inline-flex items-center gap-1"><Mail size={11} className="text-sub" />{r.email}</span>;
  return <Badge tone="bad" className="gap-1"><UserX size={11} /> no recipient</Badge>;
}

/** One-line summary of what processing did. */
function Outcome({ r }: { r: Req }) {
  const res = r.result || {};
  if (r.status === "pending") return <span className="text-sub text-xs">—</span>;
  const mail = res.mail;
  const mailOk = mail?.ok === true;
  const parts: string[] = [];
  if (r.kind === "export" && res.counts) {
    const n = Object.values(res.counts as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
    parts.push(`${nf(n)} rows · ${fmtBytes(res.bytes)}${res.attached === false ? " (too large to attach)" : ""}`);
  }
  if (r.kind === "delete" && res.erased) {
    const n = Object.entries(res.erased as Record<string, number>).filter(([k]) => !k.endsWith("_anonymised")).reduce((a, [, v]) => a + (Number(v) || 0), 0);
    parts.push(`${nf(n)} rows erased`);
  }
  if (Array.isArray(res.creator_ids) && res.creator_ids.length > 1) parts.push(`${res.creator_ids.length} linked installs`);
  return (
    <div className="text-xs space-y-0.5">
      {parts.length > 0 && <div>{parts.join(" · ")}</div>}
      <div className={mailOk ? "text-good" : "text-warn"}>
        {mailOk ? `Mail sent${r.notified_ms ? ` · ${fmtDateTime(r.notified_ms)}` : ""}` : `Not mailed${mail?.reason ? `: ${String(mail.reason).slice(0, 60)}` : ""}`}
      </div>
    </div>
  );
}

// ── File a request from the dashboard (someone wrote in) ──────────────────────
function NewRequest({ onDone, bcConfigured }: { onDone: () => void; bcConfigured: boolean }) {
  const [creator, setCreator] = useState("");
  const [kind, setKind] = useState<"export" | "delete">("export");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [identity, setIdentity] = useState<any | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const linked = identity?.identity?.linked === true;
  const lookup = async () => {
    if (!creator.trim()) return;
    setLooking(true); setMsg(null);
    try { setIdentity(await apiGet(`/api/admin/gdpr/identity?creator_id=${encodeURIComponent(creator.trim())}`)); }
    catch { setIdentity(null); setMsg({ ok: false, text: "Identity lookup failed." }); }
    finally { setLooking(false); }
  };
  const submit = async () => {
    if (!creator.trim()) return;
    setBusy("file"); setMsg(null);
    try {
      const r = await apiPost("/api/admin/data-request", { creator_id: creator.trim(), kind, email: linked ? undefined : email.trim() || undefined, note: note.trim() || undefined });
      if (r?.error) setMsg({ ok: false, text: r.error });
      else { setMsg({ ok: true, text: r.duplicate ? `A pending ${kind} request already exists (#${r.id}).` : `Request #${r.id} filed${kind === "export" ? " — processed within a minute" : " — erased after the review delay"}.` }); onDone(); }
    } catch { setMsg({ ok: false, text: "Could not file the request." }); }
    finally { setBusy(""); }
  };
  const download = async () => {
    if (!creator.trim()) return;
    setBusy("dl"); setMsg(null);
    const ok = await apiDownload(`/api/admin/gdpr/export?creator_id=${encodeURIComponent(creator.trim())}`, `bmm-telemetry-export-${creator.trim().slice(0, 12)}.zip`);
    setMsg(ok ? { ok: true, text: "Package downloaded (audited)." } : { ok: false, text: "Download failed." });
    setBusy("");
  };

  return (
    <Card title="File a request" right={<span className="text-[11px] text-sub">on behalf of a person who wrote in</span>}>
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={creator} onChange={(e) => { setCreator(e.target.value); setIdentity(null); }} onKeyDown={(e) => e.key === "Enter" && lookup()} placeholder="creator id (hex of the install's public key)" className="flex-1 font-mono text-xs" />
          <Button icon={Search} onClick={lookup} disabled={looking || !creator.trim()}>{looking ? "Looking up…" : "Look up"}</Button>
        </div>
        {identity && (
          <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-2 ${linked ? "border-brand/30 bg-brand/5" : "border-line bg-panel2"}`}>
            {linked ? (
              <>
                <UserCheck size={14} className="text-brand" />
                <span>Linked to BetterCommunity account <span className="font-mono">{identity.identity.userId}</span>{identity.identity.displayName ? ` (${identity.identity.displayName})` : ""}</span>
                {identity.creator_ids?.length > 1 && <Badge tone="brand">{identity.creator_ids.length} installs on this account</Badge>}
                <span className="text-sub">The confirmation goes to the account's own e-mail; nothing to type.</span>
              </>
            ) : (
              <>
                <UserX size={14} className="text-sub" />
                <span>Not linked to an account{identity.identity?.reason ? <span className="text-sub"> ({identity.identity.reason})</span> : null}.</span>
                {!bcConfigured && <span className="text-warn">BC_API_URL is not configured on the service — every id reads as unlinked.</span>}
              </>
            )}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Segmented value={kind} onChange={setKind} options={[{ key: "export", label: "Export" }, { key: "delete", label: "Erase" }]} />
          {!linked && <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail of the person (required when not linked)" className="flex-1" type="email" />}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (ticket, where the request came from…)" className="flex-1" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={kind === "delete" ? "danger" : "primary"} icon={kind === "delete" ? Trash2 : Plus} onClick={submit} disabled={!!busy || !creator.trim() || (!linked && !email.trim())}>
            {busy === "file" ? "Filing…" : kind === "delete" ? "File erasure request" : "File export request"}
          </Button>
          <Button icon={Download} onClick={download} disabled={!!busy || !creator.trim()} title="Build the zip now and download it here (audited as an export)">
            {busy === "dl" ? "Building…" : "Download package now"}
          </Button>
          {msg && <span className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

// ── Packet deletions (the per-upload right-to-erasure queue) ───────────────────
const PACKET_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending review", tone: "warn" }, done: { label: "Erased", tone: "good" }, rejected: { label: "Rejected", tone: "bad" },
};
function PacketDeletions() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    try { const j = await apiGet("/api/admin/deletions"); setRows(j.deletions || []); } catch { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (packet_id: string, action: "approve" | "reject") => { await apiPost("/api/admin/decide", { packet_id, action }); load(); };
  const pending = (rows || []).filter((d) => d.status === "pending").length;
  return (
    <Card title={<span className="inline-flex items-center gap-2">Packet deletions {pending > 0 && <Badge tone="warn">{pending} pending</Badge>}</span>} right={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Refresh</Button>}>
      <p className="text-xs text-sub mb-3">Filed from BMM (Settings › Privacy) for one upload batch at a time. Pending ones auto-erase once the review delay has passed.</p>
      {rows == null ? <TableSkeleton rows={3} cols={5} /> : rows.length === 0 ? <Empty icon={Inbox}>No packet deletion requests.</Empty> : (
        <Table maxHeight={420}>
          <thead><tr><th className="th">Packet</th><th className="th">Requested</th><th className="th">Auto-erase at</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
          <tbody>
            {rows.map((d) => {
              const auto = d.decided_by === "auto_purge";
              const st = auto ? { label: "Auto-purged (storage cap)", tone: "sub" } : (PACKET_STATUS[d.status] || { label: d.status, tone: "sub" });
              return (
                <tr key={d.packet_id} className="hover:bg-panel2/60">
                  <td className="td font-mono text-[11px]">{d.packet_id}</td>
                  <td className="td text-sub text-xs whitespace-nowrap">{fmtDateTime(d.requested_at)}</td>
                  <td className="td text-sub text-xs whitespace-nowrap">{auto ? "—" : fmtDateTime(d.scheduled_at)}</td>
                  <td className="td"><Badge tone={st.tone}>{st.label}</Badge>{d.status === "done" && d.decided_at && !auto ? <span className="text-sub text-xs ml-1">{fmtDateTime(d.decided_at)}</span> : null}</td>
                  <td className="td text-right">
                    {d.status === "pending" ? (
                      <div className="flex gap-1.5 justify-end">
                        <Button size="sm" icon={Play} onClick={() => decide(d.packet_id, "approve")}>Erase now</Button>
                        <Button size="sm" variant="danger" icon={XCircle} onClick={() => decide(d.packet_id, "reject")}>Reject</Button>
                      </div>
                    ) : <span className="text-sub text-xs">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────────
export default function DataRequests() {
  const { stats } = useStore();
  const s = stats!;
  const [data, setData] = useState<{ requests: Req[]; delete_delay_h: number; bc_configured: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "export" | "delete">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<Req | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet("/api/admin/data-requests");
      if (r?.error) { setErr(String(r.error)); return; }
      setErr("");
      setData({ requests: r.requests || [], delete_delay_h: r.delete_delay_h ?? s.privacy.delete_delay_h, bc_configured: !!r.bc_configured });
    } catch { setErr("Could not load the queue."); }
  }, [s.privacy.delete_delay_h]);
  useEffect(() => { load(); }, [load, s.privacy.pending_requests]);

  const rows = useMemo(() => {
    const list = data?.requests || [];
    const ql = q.trim().toLowerCase();
    return list.filter((r) =>
      (filter === "all" || (filter === "pending" ? r.status === "pending" : r.kind === filter)) &&
      (!ql || r.creator_id.toLowerCase().includes(ql) || (r.email || "").toLowerCase().includes(ql) || (r.account_id || "").toLowerCase().includes(ql) || (r.note || "").toLowerCase().includes(ql)));
  }, [data, filter, q]);
  const pending = (data?.requests || []).filter((r) => r.status === "pending").length;

  const process = async (r: Req) => {
    if (r.kind === "delete" && !confirm(`Erase every telemetry row of ${short(r.creator_id)} (and every install linked to the same account) NOW? This cannot be undone.`)) return;
    setBusy(`p${r.id}`);
    try { await apiPost("/api/admin/data-request/process", { id: r.id }); } finally { setBusy(""); load(); }
  };
  const reject = async (r: Req) => {
    if (!confirm(`Reject request #${r.id}? Nothing is exported or erased; the person is told when a recipient is known.`)) return;
    setBusy(`r${r.id}`);
    try { await apiPost("/api/admin/data-request/decide", { id: r.id, status: "rejected" }); } finally { setBusy(""); load(); }
  };
  const download = async (r: Req) => {
    setBusy(`d${r.id}`);
    await apiDownload(`/api/admin/gdpr/export?creator_id=${encodeURIComponent(r.creator_id)}`, `bmm-telemetry-export-${r.creator_id.slice(0, 12)}.zip`);
    setBusy("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldAlert}
        title="Data requests"
        sub={`GDPR access and erasure. Exports run within a minute of being filed; erasures wait ${data?.delete_delay_h ?? s.privacy.delete_delay_h}h for review unless processed here.`}
        right={<>
          <Button variant="ghost" icon={RefreshCw} onClick={load}>Refresh</Button>
          <Button variant="primary" icon={Plus} onClick={() => setShowNew((v) => !v)}>{showNew ? "Close form" : "New request"}</Button>
        </>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Pending requests" value={pending} sub="export + erase" />
        <Kpi label="Pending packet deletions" value={s.privacy.pending_deletions} sub="per upload batch" />
        <Kpi label="Erase delay" value={`${data?.delete_delay_h ?? s.privacy.delete_delay_h}h`} sub="review window" />
        <Kpi label="Account lookup" value={data ? (data.bc_configured ? "on" : "off") : "…"} sub={data?.bc_configured ? "BetterCommunity linked" : "BC_API_URL unset"} />
      </div>

      {showNew && <NewRequest bcConfigured={!!data?.bc_configured} onDone={load} />}

      <SectionTitle right={
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented value={filter} onChange={setFilter} options={[{ key: "all", label: "All" }, { key: "pending", label: "Pending" }, { key: "export", label: "Exports" }, { key: "delete", label: "Erasures" }]} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="creator id, e-mail, account, note…" className="w-56 py-1 text-xs" />
        </div>
      }>GDPR requests · {rows.length}</SectionTitle>

      {err ? (
        <EmptyState icon={ShieldAlert} title="Locked">{err} Enter the admin key (top right) or open the dashboard from BetterCommunity.</EmptyState>
      ) : data == null ? (
        <Card><TableSkeleton rows={5} cols={7} /></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileArchive} title={data.requests.length ? "Nothing matches this filter" : "No data requests yet"} action={!data.requests.length ? <Button variant="primary" icon={Plus} onClick={() => setShowNew(true)}>File one</Button> : undefined}>
          {data.requests.length ? "Clear the search or pick another tab." : "Requests arrive from BMM (Settings › Privacy), from a signed-in BetterCommunity account (Settings), or are filed here on behalf of someone who wrote in."}
        </EmptyState>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <Table maxHeight={620} className="!border-0 !rounded-none">
            <thead>
              <tr>
                <th className="th">Filed</th><th className="th">Kind</th><th className="th">Source</th><th className="th">Creator</th>
                <th className="th">Recipient</th><th className="th">State</th><th className="th">Outcome</th><th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-panel2/60 cursor-pointer" onClick={() => setSel(r)}>
                  <td className="td text-sub text-xs whitespace-nowrap">#{r.id} · {fmtDateTime(r.created_ms)}</td>
                  <td className="td"><Badge tone={r.kind === "delete" ? "bad" : "brand"}>{r.kind === "delete" ? "Erase" : "Export"}</Badge></td>
                  <td className="td text-xs">{SOURCE_LABEL[r.source] || r.source}</td>
                  <td className="td font-mono text-xs" title={r.creator_id}>{short(r.creator_id)}</td>
                  <td className="td"><Recipient r={r} /></td>
                  <td className="td"><Badge tone={STATUS_TONE[r.status] || "sub"}>{STATUS_LABEL[r.status] || r.status}</Badge></td>
                  <td className="td"><Outcome r={r} /></td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5 justify-end">
                      {r.status === "pending" && <Button size="sm" variant={r.kind === "delete" ? "danger" : "primary"} icon={Play} disabled={!!busy} onClick={() => process(r)}>{busy === `p${r.id}` ? "…" : r.kind === "delete" ? "Erase now" : "Process now"}</Button>}
                      {r.status === "pending" && <Button size="sm" icon={XCircle} disabled={!!busy} onClick={() => reject(r)}>Reject</Button>}
                      {r.kind === "export" && !r.creator_id.startsWith("erased:") && <Button size="sm" variant="ghost" icon={Download} disabled={!!busy} onClick={() => download(r)} title="Download the package here">{busy === `d${r.id}` ? "…" : "Zip"}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <PacketDeletions />

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? `Request #${sel.id} · ${sel.kind}` : ""}>
        {sel && (
          <div className="space-y-3 text-sm">
            <div className="card divide-y divide-line/60">
              <KV k="Creator id" v={<span className="font-mono text-xs break-all">{sel.creator_id}</span>} />
              <KV k="Source" v={SOURCE_LABEL[sel.source] || sel.source} />
              <KV k="Recipient" v={<Recipient r={sel} />} />
              {sel.account_id && <KV k="Account" v={<span className="font-mono text-xs">{sel.account_id}</span>} />}
              <KV k="State" v={<Badge tone={STATUS_TONE[sel.status] || "sub"}>{STATUS_LABEL[sel.status] || sel.status}</Badge>} />
              <KV k="Filed" v={fmtDateTime(sel.created_ms)} />
              {sel.decided_ms && <KV k="Processed" v={`${fmtDateTime(sel.decided_ms)}${sel.processed_by ? ` by ${sel.processed_by}` : ""}`} />}
              {sel.notified_ms && <KV k="Mailed" v={fmtDateTime(sel.notified_ms)} />}
              {sel.note && <KV k="Note" v={sel.note} />}
            </div>
            {sel.result && Object.keys(sel.result).length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-sub mb-1">Result</div>
                <pre className="text-[11px] font-mono bg-panel2 border border-line rounded-lg p-3 overflow-auto max-h-80">{JSON.stringify(sel.result, null, 2)}</pre>
              </div>
            )}
            <p className="text-xs text-sub">Every export and erasure is written to the audit log (Storage › Audit). An erased identity leaves only its hashed tag in this queue.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-sub shrink-0">{k}</span>
      <span className="text-right min-w-0">{v}</span>
    </div>
  );
}
