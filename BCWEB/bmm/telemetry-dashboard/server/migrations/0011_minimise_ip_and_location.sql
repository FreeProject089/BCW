-- Data minimisation, applied to what is ALREADY stored.
--
-- From this migration on the server only ever writes a network (`/24` for IPv4, `/48` for
-- IPv6) and a location rounded to one decimal degree (~11 km, a city). This file brings the
-- existing rows to the same state: exact addresses become networks, exact coordinates become
-- rounded ones, and the LAN address a client used to report about itself is removed.
--
-- IDEMPOTENT. Every statement is a rewrite to a fixed point: truncating a network gives the
-- same network, rounding a rounded coordinate gives the same coordinate, and dropping an
-- absent key does nothing. Running it twice — or running it on a database where the new code
-- has already been writing minimised values — changes nothing the second time.
--
-- LOSSY BY DESIGN, and only in that direction: nothing outside the address and the
-- coordinates is touched, and no row is deleted except the `geo` rows that two different
-- addresses collapse onto (merged, newest kept — see below).
--
-- The `events` rewrites touch a large table once. They are ordinary UPDATEs under the
-- migration's transaction; on a big deployment expect the migration step to take a while.

-- ── Helpers ────────────────────────────────────────────────────────────────────────────
-- Anything that is not an address comes back NULL, so a malformed value is dropped rather
-- than stored as it was. Exception-trapped on purpose: `'hello'::inet` raises, and one bad
-- row must not abort the migration.
CREATE OR REPLACE FUNCTION bmm_trunc_ip(txt text) RETURNS text AS $$
DECLARE a inet;
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  BEGIN
    a := btrim(txt)::inet;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  -- A host part already present in the text (`.../24`) is normalised away by network().
  IF family(a) = 4 THEN
    RETURN host(network(set_masklen(a, 24)));
  ELSE
    RETURN host(network(set_masklen(a, 48)));
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- One decimal degree. A JSON number or a numeric string is rounded; anything else — a null,
-- a provider that answered with a word — is returned untouched.
CREATE OR REPLACE FUNCTION bmm_round1(v jsonb) RETURNS jsonb AS $$
DECLARE n numeric;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) NOT IN ('number', 'string') THEN RETURN v; END IF;
  BEGIN
    n := (v #>> '{}')::numeric;
  EXCEPTION WHEN others THEN
    RETURN v;
  END;
  RETURN to_jsonb(round(n, 1));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── The network an install was last seen on ────────────────────────────────────────────
-- `user_ips` is keyed by distinct_id, so truncation can never collide here.
UPDATE user_ips SET ip = bmm_trunc_ip(ip)
 WHERE ip IS NOT NULL AND ip IS DISTINCT FROM bmm_trunc_ip(ip);

-- ── The admin audit trail ──────────────────────────────────────────────────────────────
-- The trail identifies an admin by fingerprint; the address is context, and context is
-- enough at network resolution. An unparsable value becomes the empty string it displays as.
UPDATE audit_log SET admin_ip = COALESCE(bmm_trunc_ip(admin_ip), '')
 WHERE admin_ip IS NOT NULL AND admin_ip <> ''
   AND admin_ip IS DISTINCT FROM COALESCE(bmm_trunc_ip(admin_ip), '');

-- ── The geo cache ──────────────────────────────────────────────────────────────────────
-- `geo.key` is the PRIMARY KEY, and several exact addresses truncate onto the same network,
-- so this is a merge, not an update: write one row per truncated key keeping the NEWEST
-- lookup (`at`), then delete the exact-address rows that fed it. Rows whose key is not an
-- address at all — the cached location of a repository HOST — return NULL from
-- bmm_trunc_ip and are left exactly as they are.
INSERT INTO geo (key, data, at)
SELECT DISTINCT ON (nk) nk, data, at
  FROM (SELECT bmm_trunc_ip(key) AS nk, data, at FROM geo WHERE bmm_trunc_ip(key) IS NOT NULL) t
 ORDER BY nk, at DESC NULLS LAST
ON CONFLICT (key) DO UPDATE
   SET data = EXCLUDED.data,
       at   = GREATEST(COALESCE(geo.at, 0), COALESCE(EXCLUDED.at, 0));

DELETE FROM geo
 WHERE bmm_trunc_ip(key) IS NOT NULL
   AND key IS DISTINCT FROM bmm_trunc_ip(key);

-- Coordinates: city level, in place.
UPDATE geo SET data = data || jsonb_build_object('lat', bmm_round1(data -> 'lat'))
 WHERE data ? 'lat' AND (data -> 'lat') IS DISTINCT FROM bmm_round1(data -> 'lat');
UPDATE geo SET data = data || jsonb_build_object('lon', bmm_round1(data -> 'lon'))
 WHERE data ? 'lon' AND (data -> 'lon') IS DISTINCT FROM bmm_round1(data -> 'lon');

-- ── What clients reported about themselves, inside stored events ───────────────────────
-- The LAN address goes: it locates nobody, it geolocates to nothing, and nothing reads it.
UPDATE events SET props = jsonb_set(props, '{$set}', (props -> '$set') - 'private_ip')
 WHERE jsonb_typeof(props -> '$set') = 'object' AND (props -> '$set') ? 'private_ip';

-- The public address becomes its network…
UPDATE events
   SET props = jsonb_set(props, '{$set,public_ip}',
                         to_jsonb(bmm_trunc_ip(props -> '$set' ->> 'public_ip')))
 WHERE jsonb_typeof(props -> '$set') = 'object'
   AND (props -> '$set') ? 'public_ip'
   AND bmm_trunc_ip(props -> '$set' ->> 'public_ip') IS NOT NULL
   AND (props -> '$set' ->> 'public_ip') IS DISTINCT FROM bmm_trunc_ip(props -> '$set' ->> 'public_ip');

-- …and a value that is not an address is removed rather than kept as written.
UPDATE events SET props = jsonb_set(props, '{$set}', (props -> '$set') - 'public_ip')
 WHERE jsonb_typeof(props -> '$set') = 'object'
   AND (props -> '$set') ? 'public_ip'
   AND bmm_trunc_ip(props -> '$set' ->> 'public_ip') IS NULL;

-- ── The live cards ─────────────────────────────────────────────────────────────────────
-- `live_instances.data` carries a copy of the same profile fields.
UPDATE live_instances SET data = data - 'private_ip'
 WHERE data ? 'private_ip';
UPDATE live_instances
   SET data = jsonb_set(data, '{public_ip}', to_jsonb(bmm_trunc_ip(data ->> 'public_ip')))
 WHERE data ? 'public_ip'
   AND bmm_trunc_ip(data ->> 'public_ip') IS NOT NULL
   AND (data ->> 'public_ip') IS DISTINCT FROM bmm_trunc_ip(data ->> 'public_ip');
UPDATE live_instances SET data = data - 'public_ip'
 WHERE data ? 'public_ip' AND bmm_trunc_ip(data ->> 'public_ip') IS NULL;
