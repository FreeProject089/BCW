//! GDPR tooling: everything the collector holds about ONE person, as a single package,
//! and the exact erasure of the same set.
//!
//! An identity is a set of creator ids (the `distinct_id` BMM sends). One install = one
//! creator id; a BetterCommunity account may have linked several installs, and a request
//! filed for one of them covers all of them — the identity lookup (see `bc.rs`) returns the
//! full set, and both the export and the erasure walk that set.
//!
//! Both operations are written against the same table list on purpose: an export that
//! reads a table the erasure does not delete is a promise the erasure breaks.

use serde_json::{json, Map, Value};
use sqlx::PgPool;
use std::io::Write;

/// Every table that can hold a row tied to a creator id, and how it is tied.
/// Kept as data so the export README, the export itself and the erasure agree.
pub const IDENTITY_TABLES: &[(&str, &str)] = &[
    ("events", "distinct_id"),
    ("benchmarks", "distinct_id"),
    ("replay_chunks", "distinct_id"),
    ("user_ips", "distinct_id"),
    ("live_instances", "distinct_id"),
    ("data_requests", "creator_id"),
];

/// Short, stable, non-reversible tag for a creator id — what stays in the audit trail and
/// in the processed request row once the id itself is gone.
pub fn erased_tag(creator_id: &str) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(creator_id.as_bytes());
    format!("erased:{}", hex_prefix(&h, 12))
}
/// Short file-name-safe handle for a creator id (first 12 hex chars of its hash).
pub fn short_id(creator_id: &str) -> String {
    erased_tag(creator_id).trim_start_matches("erased:").to_string()
}
fn hex_prefix(bytes: &[u8], n: usize) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>()[..n].to_string()
}

async fn rows_of(pool: &PgPool, table: &str, col: &str, ids: &[String]) -> Value {
    let sql = format!("SELECT to_jsonb(array_agg(x ORDER BY x)) FROM {table} x WHERE {col} = ANY($1)");
    let row: Option<(Option<Value>,)> = sqlx::query_as(&sql).bind(ids).fetch_optional(pool).await.ok().flatten();
    row.and_then(|r| r.0).unwrap_or_else(|| json!([]))
}

/// Packet ids that carried any of this identity's events (deletion requests are keyed by
/// packet, so they are reached through here).
async fn packet_ids(pool: &PgPool, ids: &[String]) -> Vec<String> {
    let rows: Vec<(Option<String>,)> = sqlx::query_as(
        "SELECT DISTINCT packet_id FROM (
            SELECT packet_id FROM events WHERE distinct_id = ANY($1)
            UNION SELECT packet_id FROM benchmarks WHERE distinct_id = ANY($1)
            UNION SELECT packet_id FROM replay_chunks WHERE distinct_id = ANY($1)) t
         WHERE packet_id IS NOT NULL AND packet_id <> ''",
    ).bind(ids).fetch_all(pool).await.unwrap_or_default();
    rows.into_iter().filter_map(|r| r.0).collect()
}

async fn ips_of(pool: &PgPool, ids: &[String]) -> Vec<String> {
    let rows: Vec<(Option<String>,)> = sqlx::query_as("SELECT ip FROM user_ips WHERE distinct_id = ANY($1)")
        .bind(ids).fetch_all(pool).await.unwrap_or_default();
    rows.into_iter().filter_map(|r| r.0).collect()
}

/// The whole record, as JSON: one array per table (raw rows, including `props`), the geo
/// rows resolved from the person's IPs, the deletion requests of their packets, and every
/// replay session reassembled into an rrweb event array (the `.bmmreplay` shape).
pub async fn export_identity(pool: &PgPool, ids: &[String]) -> Value {
    let mut tables = Map::new();
    for (t, col) in IDENTITY_TABLES {
        // replay chunks are exported decoded (below), not as opaque gzip blobs
        if *t == "replay_chunks" { continue; }
        tables.insert((*t).to_string(), rows_of(pool, t, col, ids).await);
    }
    let pids = packet_ids(pool, ids).await;
    tables.insert("deletions".into(), if pids.is_empty() { json!([]) } else { rows_of(pool, "deletions", "packet_id", &pids).await });
    let ips = ips_of(pool, ids).await;
    tables.insert("geo".into(), if ips.is_empty() { json!([]) } else { rows_of(pool, "geo", "key", &ips).await });

    // replays: one decoded event stream per session
    let sessions: Vec<(Option<String>,)> = sqlx::query_as(
        "SELECT DISTINCT session_id FROM replay_chunks WHERE distinct_id = ANY($1)",
    ).bind(ids).fetch_all(pool).await.unwrap_or_default();
    let mut replays = Vec::new();
    for (sid,) in sessions {
        let Some(sid) = sid else { continue };
        let doc = crate::db::replay_events(pool, &sid).await;
        replays.push(json!({ "session_id": sid, "events": doc["events"] }));
    }

    let mut counts = Map::new();
    for (k, v) in &tables { counts.insert(k.clone(), json!(v.as_array().map(|a| a.len()).unwrap_or(0))); }
    counts.insert("replays".into(), json!(replays.len()));
    json!({
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "creator_ids": ids,
        "packet_ids": pids,
        "counts": counts,
        "tables": Value::Object(tables),
        "replays": replays,
    })
}

/// Erase every row of the identity. Returns rows removed per table. Geo rows are removed
/// only when no OTHER user shares the IP; data_requests rows are anonymised (the fact that
/// a request was filed and fulfilled is the record the erasure itself needs) rather than
/// deleted.
pub async fn erase_identity(pool: &PgPool, ids: &[String]) -> Value {
    let mut out = Map::new();
    let pids = packet_ids(pool, ids).await;
    let ips = ips_of(pool, ids).await;
    for (t, col) in IDENTITY_TABLES {
        if *t == "data_requests" { continue; }
        let sql = format!("DELETE FROM {t} WHERE {col} = ANY($1)");
        let n = sqlx::query(&sql).bind(ids).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0);
        out.insert((*t).to_string(), json!(n));
    }
    let n = if pids.is_empty() { 0 } else {
        sqlx::query("DELETE FROM deletions WHERE packet_id = ANY($1)").bind(&pids).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0)
    };
    out.insert("deletions".into(), json!(n));
    let n = if ips.is_empty() { 0 } else {
        sqlx::query("DELETE FROM geo WHERE key = ANY($1) AND NOT EXISTS (SELECT 1 FROM user_ips u WHERE u.ip = geo.key)")
            .bind(&ips).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0)
    };
    out.insert("geo".into(), json!(n));
    // anonymise the request rows: the id becomes a hash, the addresses go
    let mut anonymised = 0u64;
    for id in ids {
        anonymised += sqlx::query(
            "UPDATE data_requests SET creator_id=$2, email=NULL, account_email=NULL WHERE creator_id=$1",
        ).bind(id).bind(erased_tag(id)).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0);
    }
    out.insert("data_requests_anonymised".into(), json!(anonymised));
    Value::Object(out)
}

fn readme(doc: &Value, account: Option<&Value>) -> String {
    let ids = doc["creator_ids"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    let counts = doc["counts"].as_object().map(|m| m.iter().map(|(k, v)| format!("  - {k}: {v} row(s)")).collect::<Vec<_>>().join("\n")).unwrap_or_default();
    let acct = match account {
        Some(a) if a.get("linked").and_then(Value::as_bool).unwrap_or(false) =>
            format!("BetterCommunity account: {} ({})\n", a["userId"].as_str().unwrap_or("?"), a["email"].as_str().unwrap_or("no e-mail on file")),
        _ => "BetterCommunity account: not linked (the creator id was never paired with an account).\n".to_string(),
    };
    format!(
"BMM telemetry — your data
==========================

Exported: {}
Creator id(s): {}
{}
What this is
------------
Better Mods Manager sends opt-in, pseudonymous usage telemetry keyed by a creator id
(a hash of the install's public key). This package is every row the collector holds
under that identity, straight from the database, plus each recorded session replay.

Files
-----
  tables/<name>.json   raw rows of each table (events, benchmarks, user_ips, live_instances,
                       geo, deletions, data_requests)
  replays/<id>.bmmreplay   one rrweb event stream per recorded session (open with BMM's
                       replay player or any rrweb player)
  export.json          the whole package as a single document

Row counts
----------
{}

Notes
-----
- Geo rows are approximate (country / region / rounded coordinates resolved from the
  IP the install connected from); no precise location is ever stored.
- Replays are DOM recordings of the BMM window. Unless full-fidelity capture was enabled
  in BMM, typed values and mod / profile / path names appear masked.
- Deletion requests are listed per packet (one packet = one upload batch).
- To have all of this erased, file a deletion request from BMM (Settings > Privacy) or
  from your BetterCommunity account; the erasure is logged and confirmed by e-mail.
",
        doc["exported_at"].as_str().unwrap_or(""), ids, acct, counts)
}

/// The package: a zip with README, one JSON per table, one .bmmreplay per session and the
/// whole document. Deflate; the JSON compresses ~10x.
pub fn build_zip(doc: &Value, account: Option<&Value>) -> Vec<u8> {
    use zip::write::SimpleFileOptions;
    let buf = std::io::Cursor::new(Vec::new());
    let mut z = zip::ZipWriter::new(buf);
    let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let put = |z: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>, name: &str, bytes: &[u8]| {
        if z.start_file(name, opt).is_ok() { let _ = z.write_all(bytes); }
    };
    put(&mut z, "README.txt", readme(doc, account).as_bytes());
    if let Some(tables) = doc["tables"].as_object() {
        for (name, rows) in tables {
            put(&mut z, &format!("tables/{name}.json"), &serde_json::to_vec_pretty(rows).unwrap_or_default());
        }
    }
    if let Some(reps) = doc["replays"].as_array() {
        for r in reps {
            let sid = r["session_id"].as_str().unwrap_or("session");
            let safe: String = sid.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            let file = json!({ "bmmReplay": 1, "app": "BetterModsManager", "createdAt": doc["exported_at"], "sessionId": sid, "events": r["events"] });
            put(&mut z, &format!("replays/{safe}.bmmreplay"), &serde_json::to_vec(&file).unwrap_or_default());
        }
    }
    put(&mut z, "export.json", &serde_json::to_vec(doc).unwrap_or_default());
    z.finish().map(|c| c.into_inner()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erased_tag_is_stable_and_short() {
        assert_eq!(erased_tag("abc"), erased_tag("abc"));
        assert_ne!(erased_tag("abc"), erased_tag("abd"));
        assert!(erased_tag("abc").starts_with("erased:"));
        assert_eq!(erased_tag("abc").len(), "erased:".len() + 12);
    }

    #[test]
    fn zip_holds_readme_tables_and_replays() {
        let doc = json!({
            "exported_at": "2026-09-15T00:00:00Z", "creator_ids": ["c1"], "packet_ids": [],
            "counts": { "events": 1, "replays": 1 },
            "tables": { "events": [{ "event": "page_enter" }] },
            "replays": [{ "session_id": "s/1", "events": [{ "type": 4, "data": { "width": 1, "height": 1 }, "timestamp": 1 }] }],
        });
        let bytes = build_zip(&doc, None);
        let mut ar = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("valid zip");
        let names: Vec<String> = (0..ar.len()).map(|i| ar.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&"README.txt".to_string()));
        assert!(names.contains(&"tables/events.json".to_string()));
        assert!(names.contains(&"replays/s1.bmmreplay".to_string()), "session id sanitised: {names:?}");
        assert!(names.contains(&"export.json".to_string()));
        let mut s = String::new();
        std::io::Read::read_to_string(&mut ar.by_name("replays/s1.bmmreplay").unwrap(), &mut s).unwrap();
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["bmmReplay"], 1);
        assert_eq!(v["events"].as_array().unwrap().len(), 1);
        let mut r = String::new();
        std::io::Read::read_to_string(&mut ar.by_name("README.txt").unwrap(), &mut r).unwrap();
        assert!(r.contains("not linked"));
    }
}
