// Live issues screen: merging the SSE stream into the list and reading labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLive, effective, demoIssues, pct, type Issue } from "../src/lib/issues.ts";

const base = (): Issue[] => demoIssues(1_700_000_000_000);

test("an occurrence of a known group updates it in place, no refetch", () => {
  const list = base();
  const fp = list[2].fingerprint;
  const before = list[2].spark!.slice();
  const r = applyLive(list, { type: "issue", fingerprint: fp, new: false, regressed: false, count: 3, total: 999, level: "error", component: "js", message: "x", last_seen: 1_700_000_000_500, app_version: "9.9.9" });
  assert.equal(r.refetch, false);
  assert.equal(r.list[2].total_count, 999);
  assert.equal(r.list[2].spark!.at(-1), before.at(-1)! + 3);
  assert.ok(r.list[2].versions!.includes("9.9.9"));
  assert.equal(list[2].total_count, 71, "the input list is not mutated");
});

test("a new group or a staff update asks for a refetch", () => {
  assert.equal(applyLive(base(), { type: "issue", fingerprint: "ffff0000ffff0000", new: true, regressed: false, count: 1, total: 1, level: "error", component: "js", message: "x", last_seen: 1 }).refetch, true);
  assert.equal(applyLive(base(), { type: "update", fingerprint: "x" }).refetch, true);
  assert.equal(applyLive(base(), { type: "hello" }).refetch, false);
});

test("a regression reopens the group", () => {
  const list = base();
  const fp = list[3].fingerprint;
  const r = applyLive(list, { type: "issue", fingerprint: fp, new: false, regressed: true, count: 1, total: 53, level: "error", component: "install", message: "x", last_seen: 1 });
  assert.equal(r.list[3].status, "open");
  assert.equal(r.list[3].regressed, true);
});

test("labels from Laya land on the group; staff corrections win", () => {
  const list = base();
  const fp = list[4].fingerprint;
  const r = applyLive(list, { type: "labels", fingerprint: fp, ai_labels: { category: { value: "filesystem", p: 0.7 } } });
  assert.deepEqual(effective(r.list[4], "category"), { value: "filesystem", p: 0.7, by: "laya" });
  const corrected = { ...r.list[4], staff_labels: { category: "permissions" } };
  assert.deepEqual(effective(corrected, "category"), { value: "permissions", p: null, by: "staff" });
  assert.deepEqual(effective({ ai_labels: null, staff_labels: null }, "origin"), { value: null, p: null, by: null });
  assert.equal(pct(0.856), "86%");
});
