//! BetterCommunity (BCWEB) server-to-server calls, all behind the shared `BC_LINK_SECRET`.
//!
//! The telemetry payload carries NO account id — an install is only ever its creator id
//! (the hex of its ed25519 public key). Whether that id is linked to a BetterCommunity
//! account is BCWEB's knowledge, so the two GDPR questions "who is this?" and "where do I
//! write?" are answered here, by BCWEB, at request time — never stored alongside the
//! telemetry rows.
//!
//! Every call is best-effort: BC unconfigured or unreachable means "not linked" and
//! "not notified", both of which the caller records and shows rather than hides.

use crate::config::Config;
use serde_json::{json, Value};
use std::time::Duration;

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(12)).build().unwrap_or_else(|_| reqwest::Client::new())
}
fn base(cfg: &Config) -> Option<String> {
    if cfg.bc_api_url.is_empty() || cfg.bc_link_secret.is_empty() { return None; }
    Some(cfg.bc_api_url.trim_end_matches('/').to_string())
}

/// `GET /internal/telemetry/identity?creatorId=` → `{ linked, userId, email, creatorIds }`.
/// `creatorIds` is every creator id linked to the same account (one account may have paired
/// several installs); a request filed for one install covers all of them.
pub async fn lookup_identity(cfg: &Config, creator_id: &str) -> Value {
    let Some(b) = base(cfg) else { return json!({ "linked": false, "reason": "bc_unconfigured" }) };
    let url = format!("{b}/internal/telemetry/identity");
    let res = client().get(&url)
        .header("x-link-secret", cfg.bc_link_secret.as_str())
        .query(&[("creatorId", creator_id)])
        .send().await;
    match res {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.unwrap_or_else(|_| json!({ "linked": false, "reason": "bad_json" })),
        Ok(r) => json!({ "linked": false, "reason": format!("http_{}", r.status().as_u16()) }),
        Err(e) => json!({ "linked": false, "reason": format!("unreachable: {e}") }),
    }
}

/// The set of creator ids a request covers: the one filed plus every id BCWEB says is
/// linked to the same account. Deduplicated, the filed id first.
pub fn identity_ids(creator_id: &str, identity: &Value) -> Vec<String> {
    let mut ids = vec![creator_id.to_string()];
    if let Some(arr) = identity.get("creatorIds").and_then(Value::as_array) {
        for v in arr.iter().filter_map(Value::as_str) {
            if !ids.iter().any(|x| x == v) { ids.push(v.to_string()); }
        }
    }
    ids
}

/// `POST /internal/telemetry/notify` — BCWEB sends the e-mail (its own SMTP, its own
/// templates, the account's language). `to` is either `{ userId }` for a linked account
/// (BCWEB resolves the address; we never see it) or `{ email }` for an unlinked install.
/// `attachment` is an optional `{ filename, base64 }` — the export package when it fits.
pub async fn notify(cfg: &Config, payload: Value) -> Value {
    let Some(b) = base(cfg) else { return json!({ "ok": false, "reason": "bc_unconfigured" }) };
    let url = format!("{b}/internal/telemetry/notify");
    let res = client().post(&url)
        .header("x-link-secret", cfg.bc_link_secret.as_str())
        .json(&payload)
        .send().await;
    match res {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.unwrap_or_else(|_| json!({ "ok": true })),
        Ok(r) => json!({ "ok": false, "reason": format!("http_{}", r.status().as_u16()) }),
        Err(e) => json!({ "ok": false, "reason": format!("unreachable: {e}") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_ids_merges_and_dedupes() {
        let id = json!({ "linked": true, "creatorIds": ["b", "a", "c", "b"] });
        assert_eq!(identity_ids("a", &id), vec!["a", "b", "c"]);
        assert_eq!(identity_ids("a", &json!({ "linked": false })), vec!["a"]);
    }
}
