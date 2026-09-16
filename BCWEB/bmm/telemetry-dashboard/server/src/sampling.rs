//! Sampling: which installs send which element kinds.
//!
//! Percentages live in `meta.sampling` (one JSON document: a `total` cap plus one entry per
//! element kind) and are handed to every BMM client in the `/batch` response and through
//! `GET /config`. The decision is DETERMINISTIC per install and per kind — the same creator
//! id always lands in the same bucket — so an install is either fully in or fully out of a
//! kind, and its data stays coherent over time instead of being a random 30% of its events.
//!
//! The server applies the same decision on ingest, so a client that predates the setting
//! (or ignores it) is trimmed to the same population; the client-side check just saves
//! the upload. Both sides share the bucket function below — keep it in sync with
//! `frontend/telemetry` in BMM (fnv1a-32 over `"{creator_id}:{kind}"`, bucket = hash % 10000).

use serde_json::{json, Value};

/// Element kinds the dashboard can sample, in display order. `total` is not a kind: it is
/// the cap on the population that sends anything at all.
pub const KINDS: &[&str] = &["events", "replay", "errors", "perf", "benchmarks", "logs"];

pub fn default_sampling() -> Value {
    let mut m = serde_json::Map::new();
    m.insert("total".into(), json!(100));
    for k in KINDS { m.insert((*k).to_string(), json!(100)); }
    Value::Object(m)
}

/// Clamp an incoming document to the known keys and 0..=100 integers.
pub fn normalize(v: &Value) -> Value {
    let pct = |k: &str| v.get(k).and_then(Value::as_f64).map(|x| x.round().clamp(0.0, 100.0) as i64).unwrap_or(100);
    let mut m = serde_json::Map::new();
    m.insert("total".into(), json!(pct("total")));
    for k in KINDS { m.insert((*k).to_string(), json!(pct(k))); }
    Value::Object(m)
}

/// FNV-1a 32-bit — tiny, stable, and identical to the JS implementation in BMM.
pub fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// Bucket in 0..10000 for one install and one kind.
pub fn bucket(creator_id: &str, kind: &str) -> u32 {
    fnv1a(&format!("{creator_id}:{kind}")) % 10000
}

/// Is `creator_id` inside the population for `kind` under `sampling`? The `total` cap
/// applies first: an install outside it sends nothing at all.
pub fn allowed(sampling: &Value, creator_id: &str, kind: &str) -> bool {
    let pct = |k: &str| sampling.get(k).and_then(Value::as_f64).unwrap_or(100.0).clamp(0.0, 100.0);
    let inside = |k: &str| (bucket(creator_id, k) as f64) < pct(k) * 100.0;
    if !inside("total") { return false; }
    if kind == "total" || !KINDS.contains(&kind) { return true; }
    inside(kind)
}

/// Map an ingested event name to its sampling kind.
pub fn kind_of(event: &str) -> &'static str {
    match event {
        "$replay" => "replay",
        "$log_js" | "$log_rust" => "logs",
        "perf" | "$web_vitals" | "web_vitals" => "perf",
        "benchmark" => "benchmarks",
        e if e.starts_with("$error") || e == "error" || e == "crash" || e == "js_error" || e == "rust_panic" => "errors",
        _ => "events",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv_matches_reference_vectors() {
        // Reference values of FNV-1a 32 (the JS side asserts the same three).
        assert_eq!(fnv1a(""), 0x811c9dc5);
        assert_eq!(fnv1a("a"), 0xe40c292c);
        assert_eq!(fnv1a("foobar"), 0xbf9cf968);
    }

    #[test]
    fn decision_is_deterministic_and_respects_total_cap() {
        let s = json!({ "total": 100, "events": 100, "replay": 0 });
        assert!(allowed(&s, "abc", "events"));
        assert!(!allowed(&s, "abc", "replay"));
        assert_eq!(allowed(&s, "abc", "events"), allowed(&s, "abc", "events"));
        let zero = json!({ "total": 0 });
        assert!(!allowed(&zero, "abc", "events"));
        assert!(!allowed(&zero, "abc", "total"));
    }

    #[test]
    fn half_the_population_is_roughly_half() {
        let s = json!({ "total": 100, "events": 50 });
        let n = (0..2000).filter(|i| allowed(&s, &format!("install-{i}"), "events")).count();
        assert!((850..1150).contains(&n), "{n} of 2000 inside a 50% sample");
    }

    #[test]
    fn normalize_clamps_and_fills() {
        let v = normalize(&json!({ "total": 250, "replay": -3, "events": 33.6, "junk": 1 }));
        assert_eq!(v["total"], 100);
        assert_eq!(v["replay"], 0);
        assert_eq!(v["events"], 34);
        assert_eq!(v["perf"], 100);
        assert!(v.get("junk").is_none());
    }

    #[test]
    fn event_names_map_to_kinds() {
        assert_eq!(kind_of("$replay"), "replay");
        assert_eq!(kind_of("$log_rust"), "logs");
        assert_eq!(kind_of("perf"), "perf");
        assert_eq!(kind_of("benchmark"), "benchmarks");
        assert_eq!(kind_of("$error_js"), "errors");
        assert_eq!(kind_of("page_enter"), "events");
    }
}
