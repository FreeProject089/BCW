// Live issues: the pure half of the Issues screen (merging live events, reading labels,
// the demo data). No React, no fetch: unit-tested in tests/issues.test.ts.

export type Label = { value: string; p?: number | null };
export type AiLabels = {
  category?: Label; severity?: Label; origin?: Label;
  duplicate_candidates?: { fingerprint: string; similarity: number }[];
  duplicate_of?: { fingerprint: string; p?: number | null };
};
export type StaffLabels = { category?: string; severity?: string; origin?: string; duplicate_of?: string };
export type Issue = {
  fingerprint: string; component: string; level: "fatal" | "error" | "warning" | string; message: string;
  frames?: string[]; code?: string | null; crash_report?: string | null; session_id?: string | null;
  status: "open" | "resolved" | "ignored" | string; assignee?: string; notes?: string;
  total_count: number; first_seen: number; last_seen: number; resolved_at?: number | null; regressed?: boolean;
  ai_status?: string; ai_labels?: AiLabels | null; ai_model?: string | null; ai_at?: number | null;
  staff_labels?: StaffLabels | null; staff_by?: string | null; staff_at?: number | null;
  installs?: number; versions?: string[]; spark?: number[]; spike?: boolean; last_24h?: number;
};
export type LiveEvent =
  | { type: "hello" }
  | { type: "issue"; fingerprint: string; new: boolean; regressed: boolean; count: number; total: number; level: string; component: string; message: string; last_seen: number; app_version?: string }
  | { type: "labels"; fingerprint: string; ai_labels: AiLabels; ai_model?: string }
  | { type: "update"; fingerprint: string };

export const LEVEL_TONE: Record<string, string> = { fatal: "bad", error: "warn", warning: "sub" };
export const STATUS_TONE: Record<string, string> = { open: "warn", resolved: "good", ignored: "sub" };

/** What the dashboard shows for a label: the staff correction when there is one, else Laya's. */
export function effective(issue: Pick<Issue, "ai_labels" | "staff_labels">, key: "category" | "severity" | "origin"): { value: string | null; p: number | null; by: "staff" | "laya" | null } {
  const s = issue.staff_labels?.[key];
  if (s) return { value: s, p: null, by: "staff" };
  const a = issue.ai_labels?.[key];
  if (a?.value) return { value: a.value, p: typeof a.p === "number" ? a.p : null, by: "laya" };
  return { value: null, p: null, by: null };
}

export const pct = (p: number | null | undefined) => (typeof p === "number" ? `${Math.round(p * 100)}%` : "");

/**
 * Apply one live event to the list. Returns the new list and whether a refetch is needed
 * (a group the list does not hold yet: its installs / versions / sparkline come from the server).
 */
export function applyLive(list: Issue[], ev: LiveEvent, now = Date.now()): { list: Issue[]; refetch: boolean } {
  if (ev.type === "hello") return { list, refetch: false };
  const i = list.findIndex((x) => x.fingerprint === ev.fingerprint);
  if (ev.type === "update") return { list, refetch: true };
  if (i < 0) return { list, refetch: true };
  const next = list.slice();
  const cur = { ...next[i] };
  if (ev.type === "labels") {
    cur.ai_labels = ev.ai_labels;
    cur.ai_model = ev.ai_model ?? cur.ai_model;
    cur.ai_status = "done";
  } else {
    cur.total_count = ev.total;
    cur.last_seen = Math.max(cur.last_seen, ev.last_seen);
    cur.last_24h = (cur.last_24h || 0) + ev.count;
    if (cur.spark && cur.spark.length) {
      const s = cur.spark.slice();
      s[s.length - 1] += ev.count;
      cur.spark = s;
    }
    if (ev.regressed) { cur.status = "open"; cur.regressed = true; }
    if (ev.app_version && cur.versions && !cur.versions.includes(ev.app_version)) cur.versions = [...cur.versions, ev.app_version];
    void now;
  }
  next[i] = cur;
  return { list: next, refetch: false };
}

/** Deterministic demo list (the /demo route): no network, same figures on every load. */
export function demoIssues(now = Date.now()): Issue[] {
  const h = 3_600_000;
  const mk = (i: number, level: string, component: string, message: string, total: number, cat: string, sev: string, origin: string, p: number, extra: Partial<Issue> = {}): Issue => ({
    fingerprint: (0x5a17c0de + i * 7919).toString(16).padStart(16, "0"),
    component, level, message, frames: ["deployProfile@features/mods/mods.js", "invoke@core/api.js"], code: null,
    status: "open", assignee: "", notes: "", total_count: total, first_seen: now - (i + 2) * 26 * h, last_seen: now - i * 0.7 * h,
    regressed: false, ai_status: "done", ai_model: "laya-multilingual",
    ai_labels: { category: { value: cat, p }, severity: { value: sev, p: p - 0.1 }, origin: { value: origin, p: p - 0.2 } },
    staff_labels: null, installs: Math.max(1, Math.round(total / 7)), versions: ["3.4.0", "3.4.1"].slice(0, 1 + (i % 2)),
    spark: Array.from({ length: 24 }, (_, k) => ((k * 7 + i * 3) % 5) + (k === 23 && i === 0 ? 14 : 0)), spike: i === 0, last_24h: 40 - i * 4,
    ...extra,
  });
  return [
    mk(0, "error", "deploy", "deploy_profile failed: Access is denied. (os error 5) at C:\\Users\\<user>\\Games\\Mods", 184, "permissions", "high", "user_environment", 0.86),
    mk(1, "fatal", "panic", "panicked at src/commands/mod_archive.rs: called `Option::unwrap()` on a `None` value", 23, "crash", "critical", "bmm_bug", 0.91, { crash_report: "crash_2026-09-28_14-02-11.zip" }),
    mk(2, "error", "js", "TypeError: Cannot read properties of undefined (reading 'length')", 71, "ui", "medium", "bmm_bug", 0.74),
    mk(3, "error", "install", "download_mod failed: error sending request: connection timed out", 52, "network", "medium", "user_environment", 0.8, { status: "resolved", regressed: false }),
    mk(4, "warning", "scheduler", "task 'nightly backup' failed: The system cannot find the path specified", 12, "filesystem", "low", "user_environment", 0.69, { ai_status: "pending", ai_labels: null }),
  ];
}
