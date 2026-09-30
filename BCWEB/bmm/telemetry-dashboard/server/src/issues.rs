//! Live issues: what BMM reports the moment something goes wrong (JS errors, Rust panics,
//! failed commands, failed deploys / installs / backups / scheduler tasks).
//!
//! The client groups occurrences by a FINGERPRINT (sha256 of the component, the normalised
//! message and the top frames) and sends one line per group with a count, so a loop that
//! throws the same error a thousand times costs one row here, not a thousand.
//!
//! Three rules this file keeps:
//!   * nothing here identifies a person. An install is `install_id` =
//!     sha256("bmm-issues:v1:" + creator id)[..24]; the message was redacted by BMM and is
//!     scrubbed AGAIN below (an old or modified client must not be able to store a user
//!     folder, an e-mail or an address just by sending one);
//!   * ingest never waits on anything slow: Laya's classification is queued (issues_ai.rs)
//!     and the live push is a broadcast send that drops when nobody listens;
//!   * every bound is a constant, checked on the way in.

use regex::Regex;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::OnceLock;

/// Shared with BMM (`src-tauri/src/commands/live_issues.rs`). Changing it orphans every row.
pub const INSTALL_SALT: &str = "bmm-issues:v1:";
pub const MAX_ISSUES_PER_REQUEST: usize = 50;
pub const MAX_MESSAGE: usize = 1000;
pub const MAX_FRAMES: usize = 8;
pub const MAX_FRAME: usize = 200;
pub const LEVELS: &[&str] = &["fatal", "error", "warning"];
pub const STATUSES: &[&str] = &["open", "resolved", "ignored"];
/// The vocabulary Laya chooses from and staff can correct to. Kept here so the API prompt,
/// the dashboard and the filters agree (the dashboard reads it from /api/issues/ai).
pub const CATEGORIES: &[&str] = &[
    "crash", "ui", "network", "filesystem", "permissions", "mod_conflict", "configuration",
    "performance", "update", "other",
];
pub const SEVERITIES: &[&str] = &["critical", "high", "medium", "low"];
pub const ORIGINS: &[&str] = &["user_environment", "bmm_bug", "unclear"];

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The pseudonymous install id for a creator id — the same derivation BMM uses, so a GDPR
/// request (which names creator ids) reaches the issue rows.
pub fn install_id_for(creator_id: &str) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(format!("{INSTALL_SALT}{creator_id}").as_bytes());
    h.iter().map(|b| format!("{:02x}", b)).collect::<String>()[..24].to_string()
}

// ── Second scrub (defence in depth) ─────────────────────────────────────────────────────────
struct Pats {
    win_user: Regex,
    unix_user: Regex,
    email: Regex,
    ipv4: Regex,
    ipv6: Regex,
    bearer: Regex,
    url_secret: Regex,
    long_token: Regex,
}
fn pats() -> &'static Pats {
    static P: OnceLock<Pats> = OnceLock::new();
    P.get_or_init(|| Pats {
        // C:\Users\alice\… , C:/Users/alice/… , and the JSON-escaped C:\\Users\\alice\\…
        win_user: Regex::new(r"(?i)((?:[a-z]:)?(?:\\\\|\\|/)(?:users|documents and settings)(?:\\\\|\\|/))([^\\/\s:*?<>|]+)").expect("win_user"),
        unix_user: Regex::new(r"(/(?:home|Users)/)([^/\s]+)").expect("unix_user"),
        email: Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").expect("email"),
        ipv4: Regex::new(r"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b").expect("ipv4"),
        ipv6: Regex::new(r"(?i)\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b").expect("ipv6"),
        bearer: Regex::new(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=\-]{8,}").expect("bearer"),
        url_secret: Regex::new(r#"(?i)([?&](?:password|pass|pwd|token|access_token|api_key|apikey|key|k|secret|auth|code)=)[^&#\s"']+"#).expect("url_secret"),
        // bmm_sk_… / bcw_… / ghp_… style keys, and any 32+ char opaque run.
        long_token: Regex::new(r"\b(?:bmm_[sp]k_|bcw_|ghp_|gho_|github_pat_|sk-)[A-Za-z0-9_\-]{8,}|\b[A-Za-z0-9_\-]{40,}\b").expect("long_token"),
    })
}

/// Mask what must never be stored even if the client forgot to: user-folder names, e-mails,
/// IP addresses, bearer tokens, secrets in URLs, key-shaped strings. Markers BMM already wrote
/// (`<user>`, `[REDACTED: N chars]`) are left as they are.
pub fn scrub(text: &str) -> String {
    let p = pats();
    let s = p.win_user.replace_all(text, |c: &regex::Captures| {
        let name = &c[2];
        if name.starts_with('<') || name.starts_with('[') || name.eq_ignore_ascii_case("public") || name.eq_ignore_ascii_case("default") {
            c[0].to_string()
        } else {
            format!("{}<user>", &c[1])
        }
    });
    let s = p.unix_user.replace_all(&s, |c: &regex::Captures| {
        if c[2].starts_with('<') || c[2].starts_with('[') { c[0].to_string() } else { format!("{}<user>", &c[1]) }
    });
    let s = p.email.replace_all(&s, "<email>");
    let s = p.url_secret.replace_all(&s, "${1}<secret>");
    let s = p.bearer.replace_all(&s, "${1}<secret>");
    let s = p.ipv6.replace_all(&s, "<ip>");
    let s = p.ipv4.replace_all(&s, "<ip>");
    let s = p.long_token.replace_all(&s, "<secret>");
    s.into_owned()
}

fn clean_id(s: &str, max: usize, extra: &[char]) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s.len() > max { return None; }
    if s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(&c)) { Some(s.to_string()) } else { None }
}
fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Envelope {
    pub install_id: String,
    pub app_version: String,
    pub os: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Incoming {
    pub fingerprint: String,
    pub level: String,
    pub component: String,
    pub message: String,
    pub frames: Vec<String>,
    pub code: Option<String>,
    pub count: i64,
    pub first_seen: i64,
    pub last_seen: i64,
    pub crash_report: Option<String>,
    pub session_id: Option<String>,
}

/// Validate and bound one ingest document. Anything malformed is dropped (one bad line does not
/// reject the batch); a document without a usable envelope is refused.
pub fn parse_payload(doc: &Value, now: i64) -> Result<(Envelope, Vec<Incoming>), &'static str> {
    let install_id = doc.get("install_id").and_then(Value::as_str)
        .and_then(|s| clean_id(s, 64, &['-', '_'])).ok_or("install_id required")?;
    let app_version = doc.get("app_version").and_then(Value::as_str)
        .and_then(|s| clean_id(s, 40, &['.', '-', '+', '_'])).unwrap_or_default();
    let os = doc.get("os").and_then(Value::as_str).map(|s| take_chars(&scrub(s.trim()), 60)).unwrap_or_default();
    let arr = doc.get("issues").and_then(Value::as_array).ok_or("issues required")?;
    if arr.len() > MAX_ISSUES_PER_REQUEST { return Err("too many issues"); }
    // A client clock can be wrong; a timestamp from the future or from weeks ago is replaced by
    // the arrival time rather than trusted (it would put the spike detector off).
    let fix_ts = |v: Option<i64>| -> i64 {
        match v { Some(t) if t > now - 7 * 86_400_000 && t < now + 5 * 60_000 => t, _ => now }
    };
    let mut out = Vec::new();
    for it in arr {
        let Some(fp) = it.get("fingerprint").and_then(Value::as_str) else { continue };
        let fp = fp.trim().to_ascii_lowercase();
        if fp.len() < 8 || fp.len() > 64 || !fp.chars().all(|c| c.is_ascii_hexdigit()) { continue; }
        let level = it.get("level").and_then(Value::as_str).filter(|l| LEVELS.contains(l)).unwrap_or("error").to_string();
        let component = it.get("component").and_then(Value::as_str)
            .map(|c| c.trim().to_ascii_lowercase())
            .and_then(|c| clean_id(&c, 40, &['_', '-', ':', '.']))
            .unwrap_or_else(|| "unknown".into());
        let message = take_chars(&scrub(it.get("message").and_then(Value::as_str).unwrap_or("")), MAX_MESSAGE);
        let frames: Vec<String> = it.get("frames").and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).take(MAX_FRAMES).map(|f| take_chars(&scrub(f), MAX_FRAME)).collect())
            .unwrap_or_default();
        let code = it.get("code").and_then(Value::as_str).map(|c| take_chars(&scrub(c.trim()), 80)).filter(|c| !c.is_empty());
        let count = it.get("count").and_then(Value::as_i64).unwrap_or(1).clamp(1, 10_000);
        let last_seen = fix_ts(it.get("last_seen").and_then(Value::as_i64));
        let first_seen = fix_ts(it.get("first_seen").and_then(Value::as_i64)).min(last_seen);
        let crash_report = it.get("crash_report").and_then(Value::as_str).and_then(|s| clean_id(s, 120, &['.', '-', '_']));
        let session_id = it.get("session_id").and_then(Value::as_str).and_then(|s| clean_id(s, 64, &['-', '_']));
        out.push(Incoming { fingerprint: fp, level, component, message, frames, code, count, first_seen, last_seen, crash_report, session_id });
    }
    Ok((Envelope { install_id, app_version, os }, out))
}

// ── Similarity (duplicate candidates) ───────────────────────────────────────────────────────
pub fn tokens(s: &str) -> std::collections::HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|w| w.len() >= 2 && !w.chars().all(|c| c.is_ascii_digit()))
        .map(String::from)
        .collect()
}
pub fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() { return 0.0; }
    let inter = a.intersection(b).count() as f64;
    inter / (a.union(b).count() as f64)
}

/// Up to 3 earlier groups whose message looks like this one (Jaccard over words, same
/// component weighs in). Pure: the caller hands the candidates.
pub fn duplicate_candidates(msg: &str, component: &str, others: &[(String, String, String)]) -> Vec<(String, f64)> {
    let me = tokens(msg);
    let mut v: Vec<(String, f64)> = others.iter().filter_map(|(fp, comp, m)| {
        let mut s = jaccard(&me, &tokens(m));
        if comp == component { s = (s + 0.1).min(1.0); }
        if s >= 0.45 { Some((fp.clone(), (s * 1000.0).round() / 1000.0)) } else { None }
    }).collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    v.truncate(3);
    v
}

/// Spike: the current hour carries at least `min` occurrences AND `factor` times the average
/// of the hours before it (a quiet group that suddenly fires). `hours` oldest → newest.
pub fn is_spike(hours: &[i64], factor: f64, min: i64) -> bool {
    let Some((&last, prev)) = hours.split_last() else { return false };
    if last < min { return false; }
    let base = if prev.is_empty() { 0.0 } else { prev.iter().sum::<i64>() as f64 / prev.len() as f64 };
    last as f64 >= factor * base.max(1.0)
}

// ── Database ────────────────────────────────────────────────────────────────────────────────
pub struct Upserted {
    pub inserted: bool,
    pub regressed: bool,
    pub total: i64,
}

pub async fn upsert(pool: &PgPool, env: &Envelope, it: &Incoming) -> Option<Upserted> {
    let row: Option<(bool, bool, i64)> = sqlx::query_as(
        "INSERT INTO issue_groups (fingerprint, component, level, message, frames, code, crash_report, session_id, total_count, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (fingerprint) DO UPDATE SET
           total_count = issue_groups.total_count + EXCLUDED.total_count,
           last_seen = GREATEST(issue_groups.last_seen, EXCLUDED.last_seen),
           first_seen = LEAST(issue_groups.first_seen, EXCLUDED.first_seen),
           level = CASE WHEN (CASE EXCLUDED.level WHEN 'fatal' THEN 3 WHEN 'error' THEN 2 ELSE 1 END)
                           > (CASE issue_groups.level WHEN 'fatal' THEN 3 WHEN 'error' THEN 2 ELSE 1 END)
                        THEN EXCLUDED.level ELSE issue_groups.level END,
           crash_report = COALESCE(EXCLUDED.crash_report, issue_groups.crash_report),
           session_id = COALESCE(EXCLUDED.session_id, issue_groups.session_id),
           regressed = issue_groups.regressed OR issue_groups.status = 'resolved',
           status = CASE WHEN issue_groups.status = 'resolved' THEN 'open' ELSE issue_groups.status END
         RETURNING (xmax = 0), regressed, total_count",
    )
    .bind(&it.fingerprint).bind(&it.component).bind(&it.level).bind(&it.message)
    .bind(json!(it.frames)).bind(&it.code).bind(&it.crash_report).bind(&it.session_id)
    .bind(it.count).bind(it.first_seen).bind(it.last_seen)
    .fetch_optional(pool).await.map_err(|e| tracing::warn!("issue upsert: {e}")).ok().flatten();
    let (inserted, regressed, total) = row?;
    let _ = sqlx::query(
        "INSERT INTO issue_occurrences (fingerprint, install_id, app_version, os, count, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (fingerprint, install_id, app_version) DO UPDATE SET
           count = issue_occurrences.count + EXCLUDED.count,
           os = EXCLUDED.os,
           first_seen = LEAST(issue_occurrences.first_seen, EXCLUDED.first_seen),
           last_seen = GREATEST(issue_occurrences.last_seen, EXCLUDED.last_seen)",
    )
    .bind(&it.fingerprint).bind(&env.install_id).bind(&env.app_version).bind(&env.os)
    .bind(it.count).bind(it.first_seen).bind(it.last_seen)
    .execute(pool).await;
    let hour = it.last_seen - it.last_seen.rem_euclid(3_600_000);
    let _ = sqlx::query(
        "INSERT INTO issue_hourly (fingerprint, hour, count) VALUES ($1,$2,$3)
         ON CONFLICT (fingerprint, hour) DO UPDATE SET count = issue_hourly.count + EXCLUDED.count",
    )
    .bind(&it.fingerprint).bind(hour).bind(it.count)
    .execute(pool).await;
    Some(Upserted { inserted, regressed, total })
}

pub struct ListFilter {
    pub status: String,
    pub level: String,
    pub component: String,
    pub q: String,
    pub category: String,
    pub version: String,
    pub sort: String,
    pub limit: i64,
}

/// The grouped list, newest activity first by default, each with its installs, versions and a
/// 24-hour sparkline.
pub async fn list(pool: &PgPool, f: &ListFilter, spike_factor: f64, spike_min: i64) -> Value {
    let order = match f.sort.as_str() {
        "count" => "g.total_count DESC",
        "first" => "g.first_seen DESC",
        "installs" => "installs DESC, g.last_seen DESC",
        _ => "g.last_seen DESC",
    };
    let sql = format!(
        "SELECT to_jsonb(t) FROM (
           SELECT g.fingerprint, g.component, g.level, g.message, g.frames, g.code, g.crash_report, g.session_id,
                  g.status, g.assignee, g.notes, g.total_count, g.first_seen, g.last_seen, g.resolved_at, g.regressed,
                  g.ai_status, g.ai_labels, g.ai_model, g.ai_at, g.staff_labels, g.staff_by, g.staff_at,
                  (SELECT COUNT(DISTINCT install_id) FROM issue_occurrences o WHERE o.fingerprint = g.fingerprint) AS installs,
                  (SELECT COALESCE(jsonb_agg(DISTINCT o.app_version), '[]'::jsonb) FROM issue_occurrences o WHERE o.fingerprint = g.fingerprint AND o.app_version <> '') AS versions
           FROM issue_groups g
           WHERE ($1 = '' OR g.status = $1)
             AND ($2 = '' OR g.level = $2)
             AND ($3 = '' OR g.component = $3)
             AND ($4 = '' OR g.message ILIKE '%' || $4 || '%' OR g.fingerprint LIKE $4 || '%' OR COALESCE(g.code, '') ILIKE '%' || $4 || '%')
             AND ($5 = '' OR COALESCE(g.staff_labels->>'category', g.ai_labels->'category'->>'value') = $5)
             AND ($6 = '' OR EXISTS (SELECT 1 FROM issue_occurrences o WHERE o.fingerprint = g.fingerprint AND o.app_version = $6))
           ORDER BY {order}
           LIMIT $7) t"
    );
    let q = f.q.replace('%', "").replace('_', "\\_");
    let rows: Vec<(Value,)> = sqlx::query_as(&sql)
        .bind(&f.status).bind(&f.level).bind(&f.component).bind(&q).bind(&f.category).bind(&f.version)
        .bind(f.limit.clamp(1, 500))
        .fetch_all(pool).await.map_err(|e| tracing::warn!("issue list: {e}")).unwrap_or_default();
    let mut groups: Vec<Value> = rows.into_iter().map(|r| r.0).collect();
    let fps: Vec<String> = groups.iter().filter_map(|g| g["fingerprint"].as_str().map(String::from)).collect();
    let now = now_ms();
    let cur_hour = now - now.rem_euclid(3_600_000);
    let from = cur_hour - 23 * 3_600_000;
    let hourly: Vec<(String, i64, i64)> = if fps.is_empty() { vec![] } else {
        sqlx::query_as("SELECT fingerprint, hour, count FROM issue_hourly WHERE hour >= $1 AND fingerprint = ANY($2)")
            .bind(from).bind(&fps).fetch_all(pool).await.unwrap_or_default()
    };
    let mut spikes = 0;
    for g in groups.iter_mut() {
        let fp = g["fingerprint"].as_str().unwrap_or("").to_string();
        let mut spark = vec![0i64; 24];
        for (f2, h, c) in &hourly {
            if *f2 == fp {
                let i = ((h - from) / 3_600_000) as usize;
                if i < 24 { spark[i] += c; }
            }
        }
        let spike = is_spike(&spark, spike_factor, spike_min);
        if spike { spikes += 1; }
        g["spark"] = json!(spark);
        g["spike"] = json!(spike);
        g["last_24h"] = json!(spark.iter().sum::<i64>());
    }
    let components: Vec<(String,)> = sqlx::query_as("SELECT DISTINCT component FROM issue_groups ORDER BY 1")
        .fetch_all(pool).await.unwrap_or_default();
    let versions: Vec<(String,)> = sqlx::query_as("SELECT DISTINCT app_version FROM issue_occurrences WHERE app_version <> '' ORDER BY 1 DESC LIMIT 50")
        .fetch_all(pool).await.unwrap_or_default();
    json!({
        "issues": groups,
        "spikes": spikes,
        "components": components.into_iter().map(|r| r.0).collect::<Vec<_>>(),
        "versions": versions.into_iter().map(|r| r.0).collect::<Vec<_>>(),
        "summary": summary(pool).await,
    })
}

/// The counters the navigation badge and the Overview read (also merged into /api/stats).
pub async fn summary(pool: &PgPool) -> Value {
    let day = now_ms() - 86_400_000;
    let row: Option<(i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT COUNT(*) FILTER (WHERE status = 'open'),
                COUNT(*) FILTER (WHERE first_seen >= $1),
                COUNT(*) FILTER (WHERE status = 'open' AND regressed),
                COALESCE(SUM(total_count), 0)::BIGINT
         FROM issue_groups",
    ).bind(day).fetch_optional(pool).await.ok().flatten();
    let (open, new_24h, regressed, total) = row.unwrap_or((0, 0, 0, 0));
    json!({ "open": open, "new_24h": new_24h, "regressed": regressed, "occurrences": total })
}

pub async fn detail(pool: &PgPool, fp: &str) -> Option<Value> {
    let row: Option<(Value,)> = sqlx::query_as("SELECT to_jsonb(g) FROM issue_groups g WHERE fingerprint = $1")
        .bind(fp).fetch_optional(pool).await.ok().flatten();
    let mut g = row?.0;
    // Per version / OS (never per install: the install id is not shown to anyone).
    let by_version: Vec<(Value,)> = sqlx::query_as(
        "SELECT to_jsonb(t) FROM (SELECT app_version, os, COUNT(DISTINCT install_id) AS installs, SUM(count)::BIGINT AS count,
                MIN(first_seen) AS first_seen, MAX(last_seen) AS last_seen
         FROM issue_occurrences WHERE fingerprint = $1 GROUP BY app_version, os ORDER BY MAX(last_seen) DESC LIMIT 100) t",
    ).bind(fp).fetch_all(pool).await.unwrap_or_default();
    let now = now_ms();
    let cur_hour = now - now.rem_euclid(3_600_000);
    let from = cur_hour - (14 * 24 - 1) * 3_600_000;
    let hourly: Vec<(i64, i64)> = sqlx::query_as("SELECT hour, count FROM issue_hourly WHERE fingerprint = $1 AND hour >= $2 ORDER BY hour")
        .bind(fp).bind(from).fetch_all(pool).await.unwrap_or_default();
    let mut days = vec![0i64; 14];
    for (h, c) in &hourly {
        let i = ((h - from) / 86_400_000) as usize;
        if i < 14 { days[i] += c; }
    }
    let feedback: Vec<(Value,)> = sqlx::query_as(
        "SELECT to_jsonb(f) FROM (SELECT ai_labels, staff_labels, by_who, ts FROM issue_ai_feedback WHERE fingerprint = $1 ORDER BY ts DESC LIMIT 20) f",
    ).bind(fp).fetch_all(pool).await.unwrap_or_default();
    // A session replay exists for the session the first report came from?
    let replay = match g.get("session_id").and_then(Value::as_str) {
        Some(sid) if !sid.is_empty() => sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM replay_chunks WHERE session_id = $1")
            .bind(sid).fetch_one(pool).await.map(|r| r.0 > 0).unwrap_or(false),
        _ => false,
    };
    let installs: (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT install_id) FROM issue_occurrences WHERE fingerprint = $1")
        .bind(fp).fetch_one(pool).await.unwrap_or((0,));
    g["by_version"] = json!(by_version.into_iter().map(|r| r.0).collect::<Vec<_>>());
    g["daily"] = json!(days);
    g["feedback"] = json!(feedback.into_iter().map(|r| r.0).collect::<Vec<_>>());
    g["replay_available"] = json!(replay);
    g["installs"] = json!(installs.0);
    Some(g)
}

/// Staff triage: status / assignee / notes. Returns false when the group does not exist.
pub async fn update(pool: &PgPool, fp: &str, status: Option<&str>, assignee: Option<&str>, notes: Option<&str>) -> bool {
    let status = status.filter(|s| STATUSES.contains(s));
    let r = sqlx::query(
        "UPDATE issue_groups SET
           status = COALESCE($2, status),
           resolved_at = CASE WHEN $2 = 'resolved' THEN $5 WHEN $2 IS NOT NULL THEN NULL ELSE resolved_at END,
           regressed = CASE WHEN $2 IS NOT NULL THEN FALSE ELSE regressed END,
           assignee = COALESCE($3, assignee),
           notes = COALESCE($4, notes)
         WHERE fingerprint = $1",
    )
    .bind(fp).bind(status)
    .bind(assignee.map(|a| take_chars(a.trim(), 80)))
    .bind(notes.map(|n| take_chars(n, 4000)))
    .bind(now_ms())
    .execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0);
    r > 0
}

/// Keep only the known label values (a correction cannot store free text in a label).
pub fn normalize_staff_labels(body: &Value) -> Value {
    let pick = |k: &str, allowed: &[&str]| body.get(k).and_then(Value::as_str).filter(|v| allowed.contains(v)).map(String::from);
    let mut o = serde_json::Map::new();
    if let Some(v) = pick("category", CATEGORIES) { o.insert("category".into(), json!(v)); }
    if let Some(v) = pick("severity", SEVERITIES) { o.insert("severity".into(), json!(v)); }
    if let Some(v) = pick("origin", ORIGINS) { o.insert("origin".into(), json!(v)); }
    if let Some(v) = body.get("duplicate_of").and_then(Value::as_str) {
        let v = v.trim().to_ascii_lowercase();
        if v.is_empty() || (v.len() <= 64 && v.chars().all(|c| c.is_ascii_hexdigit())) { o.insert("duplicate_of".into(), json!(v)); }
    }
    Value::Object(o)
}

/// Store a correction and log it next to what Laya said (the feedback the accuracy panel reads).
pub async fn set_staff_labels(pool: &PgPool, fp: &str, labels: &Value, by: &str) -> bool {
    let prev: Option<(Option<Value>,)> = sqlx::query_as("SELECT ai_labels FROM issue_groups WHERE fingerprint = $1")
        .bind(fp).fetch_optional(pool).await.ok().flatten();
    let Some((ai,)) = prev else { return false };
    let now = now_ms();
    let _ = sqlx::query("UPDATE issue_groups SET staff_labels = COALESCE(staff_labels, '{}'::jsonb) || $2, staff_by = $3, staff_at = $4 WHERE fingerprint = $1")
        .bind(fp).bind(labels).bind(by).bind(now).execute(pool).await;
    let _ = sqlx::query("INSERT INTO issue_ai_feedback (fingerprint, ai_labels, staff_labels, by_who, ts) VALUES ($1,$2,$3,$4,$5)")
        .bind(fp).bind(ai).bind(labels).bind(by).bind(now).execute(pool).await;
    true
}

/// How often staff kept Laya's category (feedback rows where a category was given).
pub async fn ai_agreement(pool: &PgPool) -> Value {
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT COUNT(*) FILTER (WHERE staff_labels ? 'category'),
                COUNT(*) FILTER (WHERE staff_labels ? 'category' AND staff_labels->>'category' = ai_labels->'category'->>'value')
         FROM issue_ai_feedback",
    ).fetch_optional(pool).await.ok().flatten();
    let (n, agree) = row.unwrap_or((0, 0));
    let done: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM issue_groups WHERE ai_status = 'done'").fetch_one(pool).await.unwrap_or((0,));
    let by_status: Vec<(String, i64)> = sqlx::query_as("SELECT ai_status, COUNT(*) FROM issue_groups GROUP BY 1").fetch_all(pool).await.unwrap_or_default();
    json!({
        "corrections": n,
        "kept": agree,
        "agreement": if n > 0 { json!((agree as f64 / n as f64 * 1000.0).round() / 1000.0) } else { Value::Null },
        "classified": done.0,
        "by_status": by_status.into_iter().map(|(s, c)| json!({ "status": s, "count": c })).collect::<Vec<_>>(),
    })
}

/// Retention: occurrences and hourly counts older than the cut-off, then the groups nothing
/// points at any more. Same retention setting as every other table.
pub async fn purge(pool: &PgPool, cut: i64) -> u64 {
    let mut n = 0u64;
    for sql in [
        "DELETE FROM issue_occurrences WHERE last_seen < $1",
        "DELETE FROM issue_hourly WHERE hour < $1",
        "DELETE FROM issue_ai_feedback WHERE ts < $1",
        "DELETE FROM issue_groups g WHERE g.last_seen < $1 AND NOT EXISTS (SELECT 1 FROM issue_occurrences o WHERE o.fingerprint = g.fingerprint)",
    ] {
        n += sqlx::query(sql).bind(cut).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0);
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_id_matches_the_bmm_vector() {
        // Same vector as src-tauri/src/commands/live_issues.rs (install_id_vector test).
        assert_eq!(install_id_for("abc"), "d5ccccff742ced2da04e03ea");
        assert_eq!(install_id_for("abc").len(), 24);
        assert_ne!(install_id_for("abc"), install_id_for("abd"));
    }

    #[test]
    fn scrub_masks_personal_data_a_client_forgot() {
        let s = scrub("open C:\\Users\\alice\\AppData\\x.json failed for bob@example.com from 192.168.1.20 \
                       /home/carol/.config and C:\\\\Users\\\\dave\\\\x ?token=abcdef123 Bearer abcdefghijklmnop bmm_sk_0123456789abcdef");
        for bad in ["alice", "bob@example.com", "192.168.1.20", "carol", "dave", "abcdef123", "abcdefghijklmnop", "bmm_sk_0123456789abcdef"] {
            assert!(!s.contains(bad), "{bad} survived: {s}");
        }
        assert!(s.contains("C:\\Users\\<user>\\AppData"), "{s}");
        // markers the client wrote are left alone, versions are not IPs
        let t = scrub("C:\\Users\\<user>\\x [REDACTED: 12 chars] v1.2.3");
        assert_eq!(t, "C:\\Users\\<user>\\x [REDACTED: 12 chars] v1.2.3");
    }

    #[test]
    fn parse_bounds_and_drops_malformed_lines() {
        let now = 1_700_000_000_000i64;
        let doc = json!({
            "install_id": "0123456789abcdef01234567", "app_version": "3.2.1", "os": "windows 10.0.26200",
            "issues": [
                { "fingerprint": "ABCDEF0123456789", "level": "fatal", "component": "Panic", "message": "ab ".repeat(2000),
                  "frames": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], "count": 99999, "first_seen": now - 1000, "last_seen": now + 99_999_999 },
                { "fingerprint": "not-hex!", "message": "dropped" },
                { "fingerprint": "0011223344556677", "level": "weird", "component": "a b", "count": -5 }
            ]
        });
        let (env, v) = parse_payload(&doc, now).unwrap();
        assert_eq!(env.app_version, "3.2.1");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].fingerprint, "abcdef0123456789");
        assert_eq!(v[0].message.chars().count(), MAX_MESSAGE);
        assert_eq!(v[0].frames.len(), MAX_FRAMES);
        assert_eq!(v[0].count, 10_000);
        assert_eq!(v[0].last_seen, now, "a timestamp from the future is replaced");
        assert_eq!(v[0].component, "panic");
        assert_eq!(v[1].level, "error");
        assert_eq!(v[1].component, "unknown");
        assert_eq!(v[1].count, 1);
        assert!(parse_payload(&json!({ "issues": [] }), now).is_err(), "no install id → refused");
        let many: Vec<Value> = (0..51).map(|_| json!({ "fingerprint": "00112233" })).collect();
        assert!(parse_payload(&json!({ "install_id": "abcdefgh", "issues": many }), now).is_err());
    }

    #[test]
    fn spike_needs_both_volume_and_a_jump() {
        let mut h = vec![1i64; 23];
        h.push(12);
        assert!(is_spike(&h, 5.0, 10));
        let mut steady = vec![10i64; 23];
        steady.push(12);
        assert!(!is_spike(&steady, 5.0, 10), "a steady rate is not a spike");
        let mut small = vec![0i64; 23];
        small.push(4);
        assert!(!is_spike(&small, 5.0, 10), "under the minimum");
    }

    #[test]
    fn duplicate_candidates_find_the_same_error_worded_alike() {
        let others = vec![
            ("aa".to_string(), "ipc".to_string(), "deploy_profile failed: access denied on mods folder".to_string()),
            ("bb".to_string(), "js".to_string(), "Cannot read properties of undefined reading length".to_string()),
        ];
        let c = duplicate_candidates("deploy_profile failed: access denied on backup folder", "ipc", &others);
        assert_eq!(c.first().map(|x| x.0.as_str()), Some("aa"));
        assert!(c.iter().all(|x| x.0 != "bb"));
    }

    #[test]
    fn staff_labels_keep_only_the_vocabulary() {
        let v = normalize_staff_labels(&json!({ "category": "network", "severity": "urgent!!", "origin": "bmm_bug", "duplicate_of": "ABCDEF12", "extra": "x" }));
        assert_eq!(v, json!({ "category": "network", "origin": "bmm_bug", "duplicate_of": "abcdef12" }));
    }
}
