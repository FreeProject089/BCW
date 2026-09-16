// Decoding + normalising an rrweb event stream for the player.
//
// Three shapes reach the dashboard: the `/api/replay` document (`{ events }` reassembled
// from gzip'd chunks server-side), a `.bmmreplay` file (`{ bmmReplay: 1, events, … }`,
// plain JSON — BMM writes it uncompressed; older exports and the BMM Docs pipeline may
// gzip it, so a gzip header is handled too), and a bare event array.
//
// Why the player showed a black frame: rrweb can only paint from a FullSnapshot (type 2).
// A telemetry stream that subscribed to an already-running recorder starts with
// incremental events (type 3) and no snapshot until the next checkout; applying those to
// an empty document renders nothing, silently. `normalizeEvents` drops what precedes the
// first snapshot (keeping the Meta that sizes the viewport), sorts by timestamp (chunks
// arrive out of order), and de-duplicates overlapping chunks — and reports what it did so
// the UI can say "no snapshot" instead of showing black.
//
// Plain TypeScript with erasable syntax only: Node runs it directly for the unit test.

export type RrwebEvent = { type: number; timestamp: number; data?: any };

export type NormalizeReport = {
  events: RrwebEvent[];
  total: number;
  dropped_before_snapshot: number;
  duplicates: number;
  has_snapshot: boolean;
  has_meta: boolean;
  width: number;
  height: number;
};

const META = 4;
const FULL_SNAPSHOT = 2;

/** Extract the event array from any of the accepted document shapes. */
export function eventsOf(doc: unknown): RrwebEvent[] {
  if (Array.isArray(doc)) return doc as RrwebEvent[];
  if (doc && typeof doc === "object") {
    const d = doc as any;
    if (Array.isArray(d.events)) return d.events;
    if (d.data && Array.isArray(d.data.events)) return d.data.events;
  }
  return [];
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Decode raw bytes (a `.bmmreplay` upload, gzip'd or not) into the document. */
export async function decodeReplayBytes(bytes: Uint8Array): Promise<unknown> {
  let raw = bytes;
  if (isGzip(bytes)) {
    const DS = (globalThis as any).DecompressionStream;
    if (typeof DS !== "function") throw new Error("gzip replay: DecompressionStream unavailable");
    const stream = new Blob([bytes as any]).stream().pipeThrough(new DS("gzip"));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Order, trim and de-duplicate a stream so rrweb can play it. Pure. */
export function normalizeEvents(input: RrwebEvent[]): NormalizeReport {
  const valid = (input || []).filter((e) => e && typeof e === "object" && typeof e.type === "number" && Number.isFinite(e.timestamp));
  // Stable sort: equal timestamps keep chunk order (a Meta and its FullSnapshot share one).
  const sorted = valid.slice().sort((a, b) => a.timestamp - b.timestamp || rank(a) - rank(b));
  // De-dup overlapping chunks (a retried upload, a compaction that re-inserted a chunk).
  const seen = new Set<string>();
  const uniq: RrwebEvent[] = [];
  let duplicates = 0;
  for (const e of sorted) {
    const key = `${e.timestamp}|${e.type}|${e.type === FULL_SNAPSHOT ? "S" : shortSig(e.data)}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    uniq.push(e);
  }
  const firstSnap = uniq.findIndex((e) => e.type === FULL_SNAPSHOT);
  const meta = uniq.find((e) => e.type === META);
  let events: RrwebEvent[];
  let dropped = 0;
  if (firstSnap < 0) {
    events = uniq;
  } else {
    const tail = uniq.slice(firstSnap);
    // rrweb wants a Meta before the first snapshot: keep the latest one seen before it
    // (or synthesise it from the snapshot's timestamp when it lands after).
    const metaBefore = uniq.slice(0, firstSnap).filter((e) => e.type === META).pop();
    const head: RrwebEvent[] = metaBefore ? [{ ...metaBefore, timestamp: tail[0].timestamp }] : meta ? [{ ...meta, timestamp: tail[0].timestamp }] : [];
    events = head.concat(tail.filter((e, i) => !(i > 0 && e === head[0])));
    dropped = firstSnap - (metaBefore ? 1 : 0);
  }
  return {
    events,
    total: valid.length,
    dropped_before_snapshot: Math.max(0, dropped),
    duplicates,
    has_snapshot: firstSnap >= 0,
    has_meta: !!meta,
    width: meta?.data?.width || 1280,
    height: meta?.data?.height || 800,
  };
}

// Meta sorts before FullSnapshot at an equal timestamp; everything else keeps its order.
function rank(e: RrwebEvent): number {
  return e.type === META ? 0 : e.type === FULL_SNAPSHOT ? 1 : 2;
}
// A cheap fingerprint of an incremental event's payload, enough to tell two events at the
// same millisecond apart without hashing the whole snapshot.
function shortSig(data: any): string {
  if (!data || typeof data !== "object") return "";
  const s = data.source ?? "";
  const n = Array.isArray(data.adds) ? data.adds.length : Array.isArray(data.positions) ? data.positions.length : data.id ?? "";
  return `${s}:${n}:${data.x ?? ""}:${data.y ?? ""}:${data.type ?? ""}`;
}
