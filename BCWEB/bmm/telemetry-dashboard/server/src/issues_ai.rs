//! Laya on the issue groups: category, severity, "user environment or BMM bug", and whether a
//! near-identical earlier group is the same problem.
//!
//! WHY THROUGH THE BCWEB API, NOT STRAIGHT TO THE SIDECAR
//! The Laya sidecar sits on the compose `ai` network behind LAYA_API_KEY, and the API's AI layer
//! (lib/moderation/ai.mjs) already owns everything a caller of it must respect: the kill switch,
//! ONE shared concurrency budget (Laya is a 322M model on a CPU: a second client calling it
//! directly would bypass the queue the moderation engine relies on), the breaker, the cache and
//! the usage analytics (this shows up as feature `telemetry_issues` in Admin → AI usage). The
//! telemetry service already talks to the API server-to-server with BC_LINK_SECRET (bc.rs), so
//! going through it adds no network, no new secret, and "Laya is off" means exactly one thing.
//! The API also refuses unless the provider is Laya itself: issue text is not sent to an
//! external provider an operator may have configured for moderation.
//!
//! NEVER ON THE INGEST PATH. Ingest does a `try_send` on a bounded channel and moves on; a full
//! channel just leaves the group `pending` for the sweep. The worker has its own timeout, its
//! own breaker (on top of the API's) and a small cache, and backs off entirely while the API
//! says the feature is off.

use crate::config::Config;
use crate::state::Shared;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::mpsc;

pub const QUEUE_CAP: usize = 256;
const TIMEOUT: Duration = Duration::from_secs(10);
const BREAKER_FAILURES: u32 = 5;
const BREAKER_OPEN_MS: i64 = 120_000;
const OFF_BACKOFF_MS: i64 = 5 * 60_000;
const BUSY_BACKOFF_MS: i64 = 30_000;
const MAX_ATTEMPTS: i32 = 3;
const CACHE_MAX: usize = 500;
const CACHE_TTL_MS: i64 = 3_600_000;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Default)]
pub struct Counters {
    pub calls: u64,
    pub ok: u64,
    pub failed: u64,
    pub off: u64,
    pub busy: u64,
    pub breaker_skips: u64,
    pub cache_hits: u64,
    pub dropped: u64,
    pub latencies: VecDeque<u64>,
    pub last_error: String,
    pub last_ok_at: i64,
    pub last_reason: String,
}

pub struct AiRuntime {
    pub tx: mpsc::Sender<String>,
    pub rx: Mutex<Option<mpsc::Receiver<String>>>,
    pub counters: Mutex<Counters>,
    fails: Mutex<u32>,
    breaker_until: AtomicI64,
    /// Until when the worker does not call at all (the API said off / busy).
    pub paused_until: AtomicI64,
    cache: Mutex<HashMap<String, (i64, Value, String)>>,
}

impl AiRuntime {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(QUEUE_CAP);
        AiRuntime {
            tx,
            rx: Mutex::new(Some(rx)),
            counters: Mutex::new(Counters::default()),
            fails: Mutex::new(0),
            breaker_until: AtomicI64::new(0),
            paused_until: AtomicI64::new(0),
            cache: Mutex::new(HashMap::new()),
        }
    }
    /// Queue a group for classification. Never blocks, never fails the caller.
    pub fn enqueue(&self, fp: &str) {
        if self.tx.try_send(fp.to_string()).is_err() {
            if let Ok(mut c) = self.counters.lock() { c.dropped += 1; }
        }
    }
    pub fn status(&self) -> Value {
        let c = self.counters.lock().map(|c| {
            let mut l: Vec<u64> = c.latencies.iter().copied().collect();
            l.sort_unstable();
            let pct = |p: f64| if l.is_empty() { Value::Null } else { json!(l[((l.len() as f64 - 1.0) * p).round() as usize]) };
            json!({
                "calls": c.calls, "ok": c.ok, "failed": c.failed, "off": c.off, "busy": c.busy,
                "breaker_skips": c.breaker_skips, "cache_hits": c.cache_hits, "dropped": c.dropped,
                "p50_ms": pct(0.5), "p95_ms": pct(0.95), "last_error": c.last_error, "last_ok_at": c.last_ok_at,
                "last_reason": c.last_reason,
            })
        }).unwrap_or(Value::Null);
        let now = now_ms();
        json!({
            "counters": c,
            "queue_depth": QUEUE_CAP - self.tx.capacity(),
            "breaker_open": self.breaker_until.load(Ordering::Relaxed) > now,
            "paused_until": self.paused_until.load(Ordering::Relaxed),
        })
    }
    fn note_fail(&self, err: &str) {
        let mut f = self.fails.lock().unwrap_or_else(|e| e.into_inner());
        *f += 1;
        if *f >= BREAKER_FAILURES {
            self.breaker_until.store(now_ms() + BREAKER_OPEN_MS, Ordering::Relaxed);
            *f = 0;
        }
        if let Ok(mut c) = self.counters.lock() { c.failed += 1; c.last_error = err.chars().take(200).collect(); }
    }
    fn note_ok(&self, ms: u64) {
        if let Ok(mut f) = self.fails.lock() { *f = 0; }
        if let Ok(mut c) = self.counters.lock() {
            c.ok += 1;
            c.last_ok_at = now_ms();
            c.latencies.push_back(ms);
            if c.latencies.len() > 200 { c.latencies.pop_front(); }
        }
    }
}

impl Default for AiRuntime {
    fn default() -> Self { Self::new() }
}

/// Is the feature on here? (dashboard switch in `meta`, env ISSUES_AI, and a BCWEB to ask.)
pub async fn enabled(st: &Shared) -> bool {
    if !st.cfg.issues_ai || st.cfg.bc_api_url.is_empty() || st.cfg.bc_link_secret.is_empty() { return false; }
    crate::db::get_meta_i64(&st.pool, "issues_ai_enabled", 1).await == 1
}

/// The text Laya reads: already redacted twice (BMM, then issues::scrub on ingest).
pub fn prompt_text(component: &str, level: &str, message: &str, code: Option<&str>, frames: &[String], candidate: Option<&str>) -> String {
    let mut s = format!("Application: BetterModsManager (a desktop mod manager for games).\nComponent: {component}\nLevel: {level}\nError: {message}\n");
    if let Some(c) = code { s.push_str(&format!("Operation: {c}\n")); }
    if !frames.is_empty() { s.push_str(&format!("Top frames: {}\n", frames.iter().take(3).cloned().collect::<Vec<_>>().join(" | "))); }
    if let Some(c) = candidate { s.push_str(&format!("\nPossible earlier issue: {c}\n")); }
    s.chars().take(1800).collect()
}

pub fn cache_key(component: &str, message: &str, candidate: Option<&str>) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(format!("{component}\n{message}\n{}", candidate.unwrap_or("")).as_bytes());
    h.iter().take(12).map(|b| format!("{:02x}", b)).collect()
}

/// The API's answer → the labels stored on the group. Unknown values are dropped, and every
/// probability is kept in [0,1]; an answer with nothing usable is None (counted as a failure).
pub fn labels_from_answer(ans: &Value, candidates: &[(String, f64)]) -> Option<Value> {
    let l = ans.get("labels")?;
    let p01 = |v: Option<&Value>| v.and_then(Value::as_f64).filter(|p| (0.0..=1.0).contains(p));
    let choice = |k: &str, allowed: &[&str]| -> Option<Value> {
        let o = l.get(k)?;
        let v = o.get("value").and_then(Value::as_str).filter(|v| allowed.contains(v))?;
        Some(json!({ "value": v, "p": p01(o.get("p")) }))
    };
    let mut out = serde_json::Map::new();
    if let Some(v) = choice("category", crate::issues::CATEGORIES) { out.insert("category".into(), v); }
    if let Some(v) = choice("severity", crate::issues::SEVERITIES) { out.insert("severity".into(), v); }
    if let Some(v) = choice("origin", crate::issues::ORIGINS) { out.insert("origin".into(), v); }
    if out.is_empty() { return None; }
    let dup_p = l.get("duplicate").and_then(|d| p01(d.get("p")));
    out.insert("duplicate_candidates".into(), json!(candidates.iter().map(|(fp, s)| json!({ "fingerprint": fp, "similarity": s })).collect::<Vec<_>>()));
    if let (Some(p), Some((fp, _))) = (dup_p, candidates.first()) {
        out.insert("duplicate_of".into(), json!({ "fingerprint": fp, "p": p }));
    }
    Some(Value::Object(out))
}

enum Outcome {
    Labels(Value, String, u64),
    Off(String),
    Busy(String),
    Fail(String),
}

async fn call_api(cfg: &Config, text: &str, with_duplicate: bool) -> Outcome {
    let url = format!("{}/internal/telemetry/classify-issue", cfg.bc_api_url.trim_end_matches('/'));
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().unwrap_or_else(|_| reqwest::Client::new());
    let t0 = std::time::Instant::now();
    let res = client.post(&url)
        .header("x-link-secret", cfg.bc_link_secret.as_str())
        .json(&json!({ "text": text, "duplicate": with_duplicate }))
        .send().await;
    let ms = t0.elapsed().as_millis() as u64;
    let r = match res { Ok(r) => r, Err(e) => return Outcome::Fail(if e.is_timeout() { "timeout".into() } else { "unreachable".into() }) };
    let status = r.status();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    let reason = body.get("reason").and_then(Value::as_str).unwrap_or("").to_string();
    if status.is_success() && body.get("ok").and_then(Value::as_bool) == Some(true) {
        let model = body.get("model").and_then(Value::as_str).unwrap_or("laya").chars().take(80).collect();
        return Outcome::Labels(body, model, ms);
    }
    match reason.as_str() {
        "disabled" | "unconfigured" | "feature_off" | "not_laya" | "killed" => Outcome::Off(reason),
        "busy" | "rate_limited" => Outcome::Busy(reason),
        "" => Outcome::Fail(format!("http_{}", status.as_u16())),
        r => Outcome::Fail(r.to_string()),
    }
}

/// Classify one group (or skip it). Called by the worker only.
async fn classify(st: &Shared, fp: &str) {
    let ai = &st.ai;
    let now = now_ms();
    if !enabled(st).await {
        let _ = sqlx::query("UPDATE issue_groups SET ai_status = 'off' WHERE fingerprint = $1 AND ai_status = 'pending'").bind(fp).execute(&st.pool).await;
        return;
    }
    if ai.paused_until.load(Ordering::Relaxed) > now { return; }
    if ai.breaker_until.load(Ordering::Relaxed) > now {
        if let Ok(mut c) = ai.counters.lock() { c.breaker_skips += 1; }
        return;
    }
    let row: Option<(String, String, String, Option<String>, Value, String, i32)> = sqlx::query_as(
        "SELECT component, level, message, code, frames, ai_status, ai_attempts FROM issue_groups WHERE fingerprint = $1",
    ).bind(fp).fetch_optional(&st.pool).await.ok().flatten();
    let Some((component, level, message, code, frames, status, attempts)) = row else { return };
    if status == "done" || attempts >= MAX_ATTEMPTS { return; }
    let frames: Vec<String> = frames.as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    // Duplicate candidates: lexical, among the 500 most recent OTHER groups.
    let others: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT fingerprint, component, message FROM issue_groups WHERE fingerprint <> $1 ORDER BY last_seen DESC LIMIT 500",
    ).bind(fp).fetch_all(&st.pool).await.unwrap_or_default();
    let cands = crate::issues::duplicate_candidates(&message, &component, &others);
    let cand_msg = cands.first().and_then(|(cfp, _)| others.iter().find(|o| &o.0 == cfp).map(|o| o.2.clone()));
    let key = cache_key(&component, &message, cand_msg.as_deref());
    let cached = ai.cache.lock().ok().and_then(|m| m.get(&key).filter(|(at, _, _)| now - at < CACHE_TTL_MS).cloned());
    let (labels, model) = if let Some((_, v, m)) = cached {
        if let Ok(mut c) = ai.counters.lock() { c.cache_hits += 1; }
        (v, m)
    } else {
        if let Ok(mut c) = ai.counters.lock() { c.calls += 1; }
        let text = prompt_text(&component, &level, &message, code.as_deref(), &frames, cand_msg.as_deref());
        match call_api(&st.cfg, &text, cand_msg.is_some()).await {
            Outcome::Labels(body, model, ms) => match labels_from_answer(&body, &cands) {
                Some(v) => {
                    ai.note_ok(ms);
                    if let Ok(mut m) = ai.cache.lock() {
                        if m.len() >= CACHE_MAX { m.clear(); }
                        m.insert(key, (now, v.clone(), model.clone()));
                    }
                    (v, model)
                }
                None => {
                    ai.note_fail("bad_answer");
                    bump_attempt(st, fp).await;
                    return;
                }
            },
            Outcome::Off(r) => {
                ai.paused_until.store(now + OFF_BACKOFF_MS, Ordering::Relaxed);
                if let Ok(mut c) = ai.counters.lock() { c.off += 1; c.last_reason = r; }
                let _ = sqlx::query("UPDATE issue_groups SET ai_status = 'off' WHERE fingerprint = $1 AND ai_status = 'pending'").bind(fp).execute(&st.pool).await;
                return;
            }
            Outcome::Busy(r) => {
                ai.paused_until.store(now + BUSY_BACKOFF_MS, Ordering::Relaxed);
                if let Ok(mut c) = ai.counters.lock() { c.busy += 1; c.last_reason = r; }
                return;
            }
            Outcome::Fail(e) => {
                ai.note_fail(&e);
                bump_attempt(st, fp).await;
                return;
            }
        }
    };
    let _ = sqlx::query("UPDATE issue_groups SET ai_status = 'done', ai_labels = $2, ai_model = $3, ai_at = $4, ai_attempts = ai_attempts + 1 WHERE fingerprint = $1")
        .bind(fp).bind(&labels).bind(&model).bind(now_ms()).execute(&st.pool).await;
    let _ = st.issues_tx.send(json!({ "type": "labels", "fingerprint": fp, "ai_labels": labels, "ai_model": model }).to_string());
}

async fn bump_attempt(st: &Shared, fp: &str) {
    let _ = sqlx::query(
        "UPDATE issue_groups SET ai_attempts = ai_attempts + 1,
           ai_status = CASE WHEN ai_attempts + 1 >= $2 THEN 'failed' ELSE ai_status END WHERE fingerprint = $1",
    ).bind(fp).bind(MAX_ATTEMPTS).execute(&st.pool).await;
}

/// The worker: the channel first, and every minute a sweep for groups the channel missed (full
/// channel, a restart, Laya switched back on). One at a time — the API allows one Laya call in
/// flight anyway.
pub fn spawn(st: Shared) {
    let Some(mut rx) = st.ai.rx.lock().ok().and_then(|mut g| g.take()) else { return };
    tokio::spawn(async move {
        let mut sweep = tokio::time::interval(Duration::from_secs(60));
        loop {
            tokio::select! {
                Some(fp) = rx.recv() => classify(&st, &fp).await,
                _ = sweep.tick() => {
                    if !enabled(&st).await || st.ai.paused_until.load(Ordering::Relaxed) > now_ms() { continue; }
                    let due: Vec<(String,)> = sqlx::query_as(
                        "SELECT fingerprint FROM issue_groups WHERE ai_status IN ('pending','off') AND ai_attempts < $1 ORDER BY last_seen DESC LIMIT 10",
                    ).bind(MAX_ATTEMPTS).fetch_all(&st.pool).await.unwrap_or_default();
                    for (fp,) in due {
                        let _ = sqlx::query("UPDATE issue_groups SET ai_status = 'pending' WHERE fingerprint = $1 AND ai_status = 'off'").bind(&fp).execute(&st.pool).await;
                        classify(&st, &fp).await;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answer_is_filtered_to_the_vocabulary() {
        let ans = json!({ "ok": true, "labels": {
            "category": { "value": "filesystem", "p": 0.81 },
            "severity": { "value": "apocalyptic", "p": 0.9 },
            "origin": { "value": "user_environment", "p": 7.0 },
            "duplicate": { "p": 0.66 },
        }});
        let v = labels_from_answer(&ans, &[("abcd1234".into(), 0.7)]).unwrap();
        assert_eq!(v["category"], json!({ "value": "filesystem", "p": 0.81 }));
        assert!(v.get("severity").is_none(), "unknown severity dropped");
        assert_eq!(v["origin"]["p"], Value::Null, "an out-of-range probability is not kept");
        assert_eq!(v["duplicate_of"]["fingerprint"], "abcd1234");
        assert!(labels_from_answer(&json!({ "labels": { "category": { "value": "nope" } } }), &[]).is_none());
    }

    #[test]
    fn prompt_is_bounded_and_carries_the_candidate() {
        let t = prompt_text("ipc", "error", &"x".repeat(5000), Some("deploy_profile"), &["a".into()], Some("earlier"));
        assert!(t.chars().count() <= 1800);
        let t = prompt_text("ipc", "error", "boom", None, &[], Some("earlier one"));
        assert!(t.contains("Possible earlier issue: earlier one"));
    }

    #[test]
    fn breaker_opens_after_consecutive_failures() {
        let ai = AiRuntime::new();
        for _ in 0..BREAKER_FAILURES { ai.note_fail("x"); }
        assert!(ai.breaker_until.load(Ordering::Relaxed) > now_ms());
        ai.note_ok(10);
        assert_eq!(*ai.fails.lock().unwrap(), 0);
    }

    #[test]
    fn enqueue_never_blocks_when_full() {
        let ai = AiRuntime::new();
        for i in 0..(QUEUE_CAP + 10) { ai.enqueue(&format!("{i:08x}")); }
        assert_eq!(ai.counters.lock().unwrap().dropped, 10);
    }
}
