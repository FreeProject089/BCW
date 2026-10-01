//! Laya (BMM's assistant) usage analytics: `GET /api/laya?days=N`.
//!
//! BMM sends four content-free events into `events`: `laya_use`, `laya_feedback`,
//! `laya_ask_click` and `laya_model`. Their props are short codes, counts and
//! booleans, never text, file names or queries. Nothing here trusts them: every
//! string is reduced to `[a-z0-9_:.-]{1,40}` (else `other`), every number is
//! clamped, every boolean accepts only a real `true` (or `"true"` / `1`).
//!
//! `aggregate` is pure (rows in, JSON out) so the whole shape is unit-tested
//! without a database; `fetch` is the only part that talks to Postgres.

use chrono::{TimeZone, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap, HashSet};

pub const DAY_MS: i64 = 86_400_000;
/// Hard cap on rows pulled for one request (the payload says `truncated` when hit).
pub const MAX_ROWS: i64 = 200_000;
/// Latency buckets, in the order the chart shows them.
pub const BUCKETS: [&str; 5] = ["<250", "250-1000", "1-3s", "3-10s", ">10s"];
const MAX_LATENCY_MS: f64 = 600_000.0;

pub struct Row {
    pub distinct_id: String,
    pub event: String,
    pub ts_ms: i64,
    pub props: Value,
}

/// `days` from the query string, clamped to 1..=366 (default 30).
pub fn clamp_days(raw: Option<&str>) -> i64 {
    raw.and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(30).clamp(1, 366)
}

/// First millisecond of the window: midnight UTC, `days - 1` days before today,
/// so the window is exactly `days` calendar days including today.
pub fn window_start(now_ms: i64, days: i64) -> i64 {
    now_ms.div_euclid(DAY_MS) * DAY_MS - (days - 1) * DAY_MS
}

fn day_key(ts_ms: i64) -> String {
    Utc.timestamp_millis_opt(ts_ms)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Lowercase code of `[a-z0-9_:.-]`, 1..=40 chars; anything else is `other`.
pub fn sanitize(s: &str) -> String {
    let l = s.trim().to_lowercase();
    let ok = !l.is_empty()
        && l.chars().count() <= 40
        && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | ':' | '.' | '-'));
    if ok { l } else { "other".into() }
}

fn code(p: &Value, key: &str) -> Option<String> {
    match p.get(key) {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(sanitize(s)),
        Some(_) => Some("other".into()),
    }
}
fn code_or(p: &Value, key: &str, dflt: &str) -> String {
    code(p, key).unwrap_or_else(|| dflt.into())
}
fn truthy(p: &Value, key: &str) -> bool {
    match p.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true",
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        _ => false,
    }
}
fn latency(p: &Value) -> Option<f64> {
    let v = match p.get("latency_ms")? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if v.is_finite() && v >= 0.0 { Some(v.min(MAX_LATENCY_MS)) } else { None }
}
fn bucket_of(p: &Value, lat: Option<f64>) -> Option<usize> {
    if let Some(b) = p.get("latency_bucket").and_then(Value::as_str) {
        if let Some(i) = BUCKETS.iter().position(|x| *x == b) {
            return Some(i);
        }
    }
    let ms = lat?;
    Some(if ms < 250.0 { 0 } else if ms < 1000.0 { 1 } else if ms < 3000.0 { 2 } else if ms < 10_000.0 { 3 } else { 4 })
}
/// Nearest-rank percentile on a sorted slice.
fn pct(sorted: &[f64], p: f64) -> Option<i64> {
    if sorted.is_empty() {
        return None;
    }
    let idx = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1;
    Some(sorted[idx].round() as i64)
}
fn rate(num: i64, den: i64) -> f64 {
    if den <= 0 { 0.0 } else { (num as f64 / den as f64 * 1000.0).round() / 10.0 }
}

#[derive(Default)]
struct Feat<'a> {
    uses: i64,
    ok: i64,
    errors: i64,
    abstained: i64,
    users: HashSet<&'a str>,
    lat: Vec<f64>,
}
#[derive(Default)]
struct Day<'a> {
    uses: i64,
    errors: i64,
    accepted: i64,
    rejected: i64,
    users: HashSet<&'a str>,
}

/// Pure aggregation. `users_active` = distinct installs seen in the window
/// (any event); `now_ms` fixes "today" so tests are deterministic.
pub fn aggregate(rows: &[Row], users_active: i64, days: i64, now_ms: i64) -> Value {
    let days = days.clamp(1, 366);
    let start = window_start(now_ms, days);

    let mut daily: BTreeMap<String, Day> = BTreeMap::new();
    for i in 0..days {
        daily.insert(day_key(start + i * DAY_MS), Day::default());
    }

    let (mut uses, mut errors, mut abstained) = (0i64, 0i64, 0i64);
    let mut laya_users: HashSet<&str> = HashSet::new();
    let mut feats: HashMap<String, Feat> = HashMap::new();
    let mut provs: HashMap<String, (i64, HashSet<&str>)> = HashMap::new();
    let mut fields: HashMap<String, (i64, i64)> = HashMap::new();
    let mut buckets = [0i64; 5];
    let mut err_codes: HashMap<String, i64> = HashMap::new();
    let (mut queries, mut clicks, mut low_conf) = (0i64, 0i64, 0i64);
    let mut click_kinds: HashMap<String, i64> = HashMap::new();
    let (mut m_install, mut m_install_failed, mut m_uninstall, mut m_cancel, mut m_test) = (0i64, 0i64, 0i64, 0i64, 0i64);

    for r in rows {
        if r.ts_ms < start || r.ts_ms > now_ms + DAY_MS {
            continue;
        }
        let p = if r.props.is_object() { &r.props } else { &Value::Null };
        let uid = r.distinct_id.as_str();
        let day = daily.get_mut(&day_key(r.ts_ms));
        match r.event.as_str() {
            "laya_use" => {
                let feature = code_or(p, "feature", "unknown");
                let provider = code_or(p, "provider", "unknown");
                let ok = truthy(p, "ok");
                let abst = truthy(p, "abstained");
                let lat = latency(p);
                uses += 1;
                if !uid.is_empty() {
                    laya_users.insert(uid);
                }
                if !ok {
                    errors += 1;
                    *err_codes.entry(code_or(p, "error", "unknown")).or_default() += 1;
                }
                if abst {
                    abstained += 1;
                }
                if let Some(b) = bucket_of(p, lat) {
                    buckets[b] += 1;
                }
                if feature == "ask" || feature == "smart_search" {
                    queries += 1;
                    if truthy(p, "low_confidence") {
                        low_conf += 1;
                    }
                }
                let f = feats.entry(feature).or_default();
                f.uses += 1;
                if ok { f.ok += 1 } else { f.errors += 1 }
                if abst {
                    f.abstained += 1;
                }
                if let Some(ms) = lat {
                    f.lat.push(ms);
                }
                let pv = provs.entry(provider).or_default();
                pv.0 += 1;
                if !uid.is_empty() {
                    f.users.insert(uid);
                    pv.1.insert(uid);
                }
                if let Some(d) = day {
                    d.uses += 1;
                    if !ok {
                        d.errors += 1;
                    }
                    if !uid.is_empty() {
                        d.users.insert(uid);
                    }
                }
            }
            "laya_feedback" => {
                let accepted = match p.get("outcome").and_then(Value::as_str) {
                    Some("accepted") => true,
                    Some("rejected") => false,
                    _ => continue,
                };
                let e = fields.entry(code_or(p, "field", "unknown")).or_default();
                if accepted { e.0 += 1 } else { e.1 += 1 }
                if let Some(d) = day {
                    if accepted { d.accepted += 1 } else { d.rejected += 1 }
                }
            }
            "laya_ask_click" => {
                clicks += 1;
                *click_kinds.entry(code_or(p, "kind", "unknown")).or_default() += 1;
            }
            "laya_model" => {
                let ok = truthy(p, "ok");
                match p.get("action").and_then(Value::as_str) {
                    Some("install") if ok => m_install += 1,
                    Some("install") => m_install_failed += 1,
                    Some("uninstall") => m_uninstall += 1,
                    Some("cancel") => m_cancel += 1,
                    Some("test") => m_test += 1,
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let mut by_feature: Vec<(String, Feat)> = feats.into_iter().collect();
    by_feature.sort_by(|a, b| b.1.uses.cmp(&a.1.uses).then(a.0.cmp(&b.0)));
    let by_feature: Vec<Value> = by_feature
        .into_iter()
        .map(|(name, mut f)| {
            f.lat.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            json!({
                "feature": name, "uses": f.uses, "users": f.users.len(), "ok": f.ok,
                "errors": f.errors, "abstained": f.abstained,
                "p50_ms": pct(&f.lat, 0.5), "p90_ms": pct(&f.lat, 0.9),
            })
        })
        .collect();

    let mut by_provider: Vec<(String, i64, usize)> = provs.into_iter().map(|(k, (n, u))| (k, n, u.len())).collect();
    by_provider.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let (mut acc_all, mut rej_all) = (0i64, 0i64);
    let mut fields: Vec<(String, i64, i64)> = fields.into_iter().map(|(k, (a, r))| (k, a, r)).collect();
    fields.sort_by(|a, b| (b.1 + b.2).cmp(&(a.1 + a.2)).then(a.0.cmp(&b.0)));
    let fields: Vec<Value> = fields
        .into_iter()
        .map(|(f, a, r)| {
            acc_all += a;
            rej_all += r;
            json!({ "field": f, "accepted": a, "rejected": r, "rate": rate(a, a + r) })
        })
        .collect();

    let mut codes: Vec<(String, i64)> = err_codes.into_iter().collect();
    codes.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    codes.truncate(20);

    let mut kinds: Vec<(String, i64)> = click_kinds.into_iter().collect();
    kinds.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    kinds.truncate(20);

    let users_laya = laya_users.len() as i64;
    let users_active = users_active.max(users_laya);

    json!({
        "days": days,
        "since_ms": start,
        "users_active": users_active,
        "users_laya": users_laya,
        "adoption_pct": rate(users_laya, users_active),
        "uses": uses,
        "errors": errors,
        "error_pct": rate(errors, uses),
        "abstained": abstained,
        "accepted": acc_all,
        "rejected": rej_all,
        "acceptance_pct": rate(acc_all, acc_all + rej_all),
        "by_feature": by_feature,
        "by_provider": by_provider.into_iter().map(|(p, n, u)| json!({ "provider": p, "uses": n, "users": u })).collect::<Vec<_>>(),
        "fields": fields,
        "latency_buckets": BUCKETS.iter().zip(buckets).map(|(b, n)| json!({ "bucket": b, "n": n })).collect::<Vec<_>>(),
        "errors_by_code": codes.into_iter().map(|(c, n)| json!({ "code": c, "n": n })).collect::<Vec<_>>(),
        "ask": {
            "queries": queries,
            "clicked": clicks,
            "click_rate": rate(clicks.min(queries), queries),
            "low_confidence": low_conf,
            "kinds": kinds.into_iter().map(|(k, n)| json!({ "kind": k, "n": n })).collect::<Vec<_>>(),
        },
        "model": { "install": m_install, "install_failed": m_install_failed, "uninstall": m_uninstall, "cancel": m_cancel, "test": m_test },
        "daily": daily.into_iter().map(|(day, d)| json!({
            "day": day, "uses": d.uses, "users": d.users.len(), "errors": d.errors,
            "accepted": d.accepted, "rejected": d.rejected,
        })).collect::<Vec<_>>(),
    })
}

/// Laya rows of the window (capped at `MAX_ROWS`) + distinct active installs.
pub async fn fetch(pool: &PgPool, since_ms: i64) -> (Vec<Row>, i64) {
    let rows: Vec<(Option<String>, Option<String>, Option<i64>, Value)> = sqlx::query_as(
        "SELECT distinct_id, event, ts_ms, props FROM events
         WHERE event LIKE 'laya\\_%' AND ts_ms >= $1
         ORDER BY ts_ms DESC LIMIT $2",
    )
    .bind(since_ms)
    .bind(MAX_ROWS)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let active: (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT distinct_id) FROM events WHERE ts_ms >= $1")
        .bind(since_ms)
        .fetch_one(pool)
        .await
        .unwrap_or((0,));
    let rows = rows
        .into_iter()
        .map(|(d, e, t, p)| Row { distinct_id: d.unwrap_or_default(), event: e.unwrap_or_default(), ts_ms: t.unwrap_or(0), props: p })
        .collect();
    (rows, active.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-09-30T12:00:00Z
    const NOW: i64 = 1_790_769_600_000;

    fn row(id: &str, event: &str, ts_ms: i64, props: Value) -> Row {
        Row { distinct_id: id.into(), event: event.into(), ts_ms, props }
    }

    #[test]
    fn empty_input_has_full_shape() {
        let v = aggregate(&[], 0, 7, NOW);
        assert_eq!(v["uses"], 0);
        assert_eq!(v["adoption_pct"], 0.0);
        assert_eq!(v["acceptance_pct"], 0.0);
        assert_eq!(v["daily"].as_array().unwrap().len(), 7);
        assert_eq!(v["latency_buckets"].as_array().unwrap().len(), 5);
        assert_eq!(v["latency_buckets"][0]["bucket"], "<250");
        assert_eq!(v["latency_buckets"][4]["bucket"], ">10s");
        assert!(v["by_feature"].as_array().unwrap().is_empty());
        assert_eq!(v["ask"]["click_rate"], 0.0);
    }

    #[test]
    fn day_fill_covers_every_day_including_today() {
        let v = aggregate(&[row("a", "laya_use", NOW, json!({"feature":"ask","ok":true}))], 1, 30, NOW);
        let d = v["daily"].as_array().unwrap();
        assert_eq!(d.len(), 30);
        assert_eq!(d[0]["day"], "2026-09-01");
        assert_eq!(d[29]["day"], "2026-09-30");
        assert_eq!(d[29]["uses"], 1);
        assert_eq!(d[28]["uses"], 0);
        // an event before the window is ignored
        let old = aggregate(&[row("a", "laya_use", window_start(NOW, 7) - 1, json!({"ok":true}))], 1, 7, NOW);
        assert_eq!(old["uses"], 0);
    }

    #[test]
    fn acceptance_rate_per_field_and_global() {
        let fb = |f: &str, o: &str| row("a", "laya_feedback", NOW, json!({"feature":"mod_suggest","field":f,"outcome":o}));
        let rows = vec![
            fb("name", "accepted"),
            fb("name", "accepted"),
            fb("name", "accepted"),
            fb("name", "rejected"),
            fb("tags", "rejected"),
            fb("tags", "maybe"), // unknown outcome: ignored
        ];
        let v = aggregate(&rows, 1, 7, NOW);
        let f = v["fields"].as_array().unwrap();
        assert_eq!(f[0]["field"], "name");
        assert_eq!(f[0]["accepted"], 3);
        assert_eq!(f[0]["rate"], 75.0);
        assert_eq!(f[1]["field"], "tags");
        assert_eq!(f[1]["rate"], 0.0);
        assert_eq!(v["accepted"], 3);
        assert_eq!(v["rejected"], 2);
        assert_eq!(v["acceptance_pct"], 60.0);
        assert_eq!(v["daily"][6]["accepted"], 3);
    }

    #[test]
    fn sanitizes_every_string() {
        assert_eq!(sanitize("Embedded:Runtime"), "embedded:runtime");
        assert_eq!(sanitize("my mod.zip"), "other");
        assert_eq!(sanitize("C:\\Users\\bob"), "other");
        assert_eq!(sanitize(&"a".repeat(41)), "other");
        assert_eq!(sanitize(""), "other");
        let rows = vec![
            row("a", "laya_use", NOW, json!({"feature":"<script>","provider":42,"ok":"yes","error":"How do I install X?","latency_ms":-5})),
            row("b", "laya_use", NOW, json!({"feature":"ask","provider":"embedded","ok":true,"latency_ms":1e12,"low_confidence":true})),
        ];
        let v = aggregate(&rows, 5, 7, NOW);
        let feats: Vec<&str> = v["by_feature"].as_array().unwrap().iter().map(|f| f["feature"].as_str().unwrap()).collect();
        assert!(feats.contains(&"other") && feats.contains(&"ask"));
        assert_eq!(v["errors"], 1); // "yes" is not a trusted true
        assert_eq!(v["errors_by_code"][0]["code"], "other");
        assert_eq!(v["latency_buckets"][4]["n"], 1); // clamped huge latency, negative dropped
        assert_eq!(v["users_laya"], 2);
        assert_eq!(v["adoption_pct"], 40.0);
        assert_eq!(v["ask"]["queries"], 1);
        assert_eq!(v["ask"]["low_confidence"], 1);
    }

    #[test]
    fn percentiles_model_and_clicks() {
        let mut rows: Vec<Row> = (1..=10)
            .map(|i| row("a", "laya_use", NOW, json!({"feature":"mod_suggest","provider":"embedded","ok":true,"latency_ms":i*100})))
            .collect();
        rows.push(row("a", "laya_model", NOW, json!({"action":"install","ok":true})));
        rows.push(row("b", "laya_model", NOW, json!({"action":"install","ok":false,"error":"net"})));
        rows.push(row("b", "laya_ask_click", NOW, json!({"feature":"ask","kind":"mod","rank":1})));
        let v = aggregate(&rows, 0, 7, NOW);
        assert_eq!(v["by_feature"][0]["p50_ms"], 500);
        assert_eq!(v["by_feature"][0]["p90_ms"], 900);
        assert_eq!(v["model"]["install"], 1);
        assert_eq!(v["model"]["install_failed"], 1);
        assert_eq!(v["ask"]["clicked"], 1);
        assert_eq!(v["ask"]["click_rate"], 0.0); // no queries: rate stays 0, never > 100
        assert_eq!(v["users_active"], 1); // never below users_laya
        assert_eq!(v["adoption_pct"], 100.0);
    }

    #[test]
    fn days_clamped() {
        assert_eq!(clamp_days(Some("0")), 1);
        assert_eq!(clamp_days(Some("9999")), 366);
        assert_eq!(clamp_days(Some("abc")), 30);
        assert_eq!(clamp_days(None), 30);
        assert_eq!(clamp_days(Some("90")), 90);
    }
}
