//! Data minimisation at the door: what an address and a location are allowed to be
//! once they are written down.
//!
//! Nothing here is a privacy *policy* — it is the code that makes the policy true. Two
//! rules, both applied before any INSERT:
//!
//! * **Addresses are truncated, never stored whole.** IPv4 keeps its first three octets
//!   (`/24`), IPv6 its first three groups (`/48`). That is enough for "which network,
//!   roughly where", which is the only thing the dashboard ever asks an address, and not
//!   enough to point at a household. An exact address still exists in memory for the
//!   duration of one request — the ingest rate limiter keys on it (see `AppState::allow`)
//!   — and is never written to the database, to a log line or to an export.
//! * **Locations are rounded to city level.** ipwho.is answers with coordinates precise
//!   to a few hundred metres; they are stored rounded to one decimal degree (~11 km),
//!   which is a city, not an address, and is the resolution the map on the dashboard
//!   draws at anyway.
//!
//! Both are lossy on purpose and neither is reversible.

use serde_json::Value;
use std::net::{IpAddr, Ipv6Addr};

/// Strip a port, brackets and whitespace, then parse. `192.0.2.7:51234`, `[2001:db8::1]`
/// and a bare address all arrive here from `X-Forwarded-For`, a socket peer or a client
/// payload, and any of them can also be garbage.
fn parse_ip(raw: &str) -> Option<IpAddr> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // [v6]:port or [v6]
    if let Some(rest) = s.strip_prefix('[') {
        let inner = rest.split(']').next().unwrap_or("");
        return inner.parse::<IpAddr>().ok();
    }
    if let Ok(ip) = s.parse::<IpAddr>() {
        return Some(ip);
    }
    // v4:port — only when there is exactly one colon, so a bare IPv6 is never cut in half.
    if s.matches(':').count() == 1 {
        if let Some(head) = s.split(':').next() {
            if let Ok(ip) = head.parse::<IpAddr>() {
                return Some(ip);
            }
        }
    }
    None
}

/// Truncate an address to the network it belongs to: IPv4 `/24`, IPv6 `/48`.
///
/// An IPv4-mapped IPv6 address (`::ffff:192.0.2.7`, what a dual-stack socket reports for a
/// v4 peer) is treated as the IPv4 address it is — otherwise the same client would be
/// stored two different ways depending on the listening socket, and `/48` of a mapped
/// address keeps the whole v4 address inside it.
///
/// Returns `None` for anything that is not an address, so a malformed value is dropped
/// rather than stored as-is.
pub fn truncate_ip(raw: &str) -> Option<String> {
    let ip = parse_ip(raw)?;
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
        v4 => v4,
    };
    Some(match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            format!("{}.{}.{}.0", o[0], o[1], o[2])
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            Ipv6Addr::new(s[0], s[1], s[2], 0, 0, 0, 0, 0).to_string()
        }
    })
}

/// Round a coordinate to one decimal degree (~11 km) — city level, never a street.
pub fn round_coord(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Round the `lat`/`lon` of a geo record in place. Anything non-numeric (a null from a
/// provider that did not know) is left alone: there is nothing to round and nothing to leak.
pub fn round_geo(data: &mut Value) {
    for k in ["lat", "lon"] {
        let rounded = data.get(k).and_then(Value::as_f64).map(round_coord);
        if let Some(r) = rounded {
            if let Some(obj) = data.as_object_mut() {
                obj.insert(k.to_string(), serde_json::json!(r));
            }
        }
    }
}

/// Minimise the addresses a CLIENT reports about itself inside an `$identify` profile.
///
/// * `public_ip` is truncated like any other address. It is also, unlike the request
///   address, entirely under the client's control — so it is re-truncated here rather
///   than trusted, and a value that does not parse is dropped.
/// * `private_ip` (the LAN address) is removed outright. It cannot locate anyone and it
///   cannot be geolocated; all it ever did was describe the shape of someone's home
///   network. Nothing in the dashboard reads it.
pub fn scrub_profile_ips(set: &mut Value) {
    let Some(obj) = set.as_object_mut() else { return };
    obj.remove("private_ip");
    if let Some(v) = obj.get("public_ip").and_then(Value::as_str).map(str::to_string) {
        match truncate_ip(&v) {
            Some(t) => {
                obj.insert("public_ip".into(), serde_json::json!(t));
            }
            None => {
                obj.remove("public_ip");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ipv4_keeps_the_network_and_loses_the_host() {
        assert_eq!(truncate_ip("192.0.2.77").as_deref(), Some("192.0.2.0"));
        assert_eq!(truncate_ip("  8.8.8.8  ").as_deref(), Some("8.8.8.0"));
        assert_eq!(truncate_ip("192.0.2.77:51234").as_deref(), Some("192.0.2.0"));
        // Already truncated → unchanged (the migration can run twice).
        assert_eq!(truncate_ip("192.0.2.0").as_deref(), Some("192.0.2.0"));
    }

    #[test]
    fn ipv6_keeps_48_bits() {
        assert_eq!(truncate_ip("2001:db8:abcd:1234::1").as_deref(), Some("2001:db8:abcd::"));
        assert_eq!(truncate_ip("[2001:db8:abcd:1234::1]:443").as_deref(), Some("2001:db8:abcd::"));
        assert_eq!(truncate_ip("2001:db8:abcd::").as_deref(), Some("2001:db8:abcd::"));
    }

    #[test]
    fn ipv4_mapped_ipv6_is_treated_as_ipv4() {
        assert_eq!(truncate_ip("::ffff:192.0.2.77").as_deref(), Some("192.0.2.0"));
    }

    #[test]
    fn garbage_is_dropped_not_stored() {
        assert_eq!(truncate_ip(""), None);
        assert_eq!(truncate_ip("   "), None);
        assert_eq!(truncate_ip("not-an-ip"), None);
        assert_eq!(truncate_ip("999.1.1.1"), None);
        assert_eq!(truncate_ip("192.0.2.77/24"), None);
    }

    #[test]
    fn coordinates_round_to_city_level() {
        assert_eq!(round_coord(46.9481), 46.9);
        assert_eq!(round_coord(7.4474), 7.4);
        assert_eq!(round_coord(-33.8688), -33.9);
        // Idempotent: rounding an already-rounded value changes nothing.
        assert_eq!(round_coord(round_coord(46.9481)), 46.9);
    }

    #[test]
    fn geo_rounding_keeps_the_place_and_survives_nulls() {
        let mut g = json!({ "country": "Switzerland", "city": "Bern", "lat": 46.9481, "lon": 7.4474 });
        round_geo(&mut g);
        assert_eq!(g["lat"], json!(46.9));
        assert_eq!(g["lon"], json!(7.4));
        assert_eq!(g["city"], json!("Bern"));

        let mut n = json!({ "city": "Bern", "lat": null });
        round_geo(&mut n);
        assert_eq!(n["lat"], json!(null));
    }

    #[test]
    fn profile_loses_the_lan_address_and_truncates_the_public_one() {
        let mut set = json!({ "cpu": "x", "private_ip": "192.168.1.42", "public_ip": "203.0.113.9" });
        scrub_profile_ips(&mut set);
        assert!(set.get("private_ip").is_none());
        assert_eq!(set["public_ip"], json!("203.0.113.0"));
        assert_eq!(set["cpu"], json!("x"));

        // A client that sends nonsense gets the field dropped, not stored.
        let mut bad = json!({ "public_ip": "hello" });
        scrub_profile_ips(&mut bad);
        assert!(bad.get("public_ip").is_none());
    }
}
