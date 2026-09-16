// node --test (Node >= 22.6 strips types natively). Run: npm test (in web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { normalizeEvents, eventsOf, decodeReplayBytes } from "../src/lib/replay-decode.ts";

const meta = (t: number) => ({ type: 4, timestamp: t, data: { href: "http://tauri.localhost/", width: 1480, height: 960 } });
const snap = (t: number) => ({ type: 2, timestamp: t, data: { node: { type: 0, childNodes: [] }, initialOffset: { top: 0, left: 0 } } });
const inc = (t: number, source = 0, extra: any = {}) => ({ type: 3, timestamp: t, data: { source, ...extra } });

test("eventsOf accepts the three document shapes", () => {
  assert.equal(eventsOf([inc(1)]).length, 1);
  assert.equal(eventsOf({ bmmReplay: 1, events: [inc(1), inc(2)] }).length, 2);
  assert.equal(eventsOf({ session_id: "s", events: [inc(1)] }).length, 1);
  assert.equal(eventsOf({ nothing: true }).length, 0);
  assert.equal(eventsOf(null).length, 0);
});

test("a stream that starts mid-session is trimmed to its first snapshot and keeps a meta", () => {
  // what the telemetry recorder used to send: incremental events, then the checkout
  const r = normalizeEvents([inc(100), inc(150), inc(200), meta(300), snap(300), inc(310)]);
  assert.equal(r.has_snapshot, true);
  assert.equal(r.dropped_before_snapshot, 3);
  assert.deepEqual(r.events.map((e) => e.type), [4, 2, 3]);
  assert.equal(r.width, 1480);
  assert.equal(r.height, 960);
});

test("no snapshot at all is reported, not hidden", () => {
  const r = normalizeEvents([meta(1), inc(2), inc(3)]);
  assert.equal(r.has_snapshot, false);
  assert.equal(r.has_meta, true);
  assert.equal(r.events.length, 3);
});

test("chunks out of order are sorted and duplicates from overlapping chunks are dropped", () => {
  const a = inc(500, 2, { x: 1, y: 2 });
  const r = normalizeEvents([inc(600), a, snap(400), meta(400), { ...a }, inc(450)]);
  assert.deepEqual(r.events.map((e) => e.timestamp), [400, 400, 450, 500, 600]);
  assert.deepEqual(r.events.slice(0, 2).map((e) => e.type), [4, 2], "meta before snapshot at an equal timestamp");
  assert.equal(r.duplicates, 1);
});

test("garbage entries are ignored", () => {
  const r = normalizeEvents([null as any, "x" as any, { type: "3" } as any, meta(1), snap(1)]);
  assert.equal(r.total, 2);
  assert.equal(r.events.length, 2);
});

test("decodeReplayBytes reads plain JSON and gzip'd JSON", async () => {
  const doc = { bmmReplay: 1, events: [meta(1), snap(1)] };
  const plain = new TextEncoder().encode(JSON.stringify(doc));
  assert.deepEqual(eventsOf(await decodeReplayBytes(plain)).length, 2);
  const gz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(doc))));
  assert.equal(gz[0], 0x1f);
  assert.deepEqual(eventsOf(await decodeReplayBytes(gz)).length, 2);
});
