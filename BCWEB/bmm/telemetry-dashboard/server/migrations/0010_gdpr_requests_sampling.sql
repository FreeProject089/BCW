-- GDPR tooling v2 + sampling.
--
-- data_requests grows from "a user asked for a copy, an admin mails it by hand" into a
-- queue the dashboard PROCESSES: a request has a kind (export | delete), a source (who
-- filed it), the linked BetterCommunity account when the creator id is linked, and the
-- outcome (what was exported / erased, whether the confirmation mail went out).
--
-- `email` becomes nullable: a request for a LINKED account carries no typed address —
-- the confirmation goes to the account's own e-mail, resolved at processing time.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS kind          TEXT NOT NULL DEFAULT 'export';   -- export | delete
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'bmm';      -- bmm | bcweb | dashboard
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS account_id    TEXT;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS account_email TEXT;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS note          TEXT;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS result        JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS notified_at   TIMESTAMPTZ;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS processed_by  TEXT;
ALTER TABLE data_requests ALTER COLUMN email DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_data_requests_creator ON data_requests(creator_id);

-- Sampling percentages (per element kind + a total cap) live in `meta` under the key
-- `sampling` as a JSON document, next to the other runtime-tunable settings. No new table:
-- it is one row, read on every /batch response.
INSERT INTO meta(key, value) VALUES ('sampling', '{"total":100,"replay":100,"events":100,"errors":100,"perf":100,"geo":100}')
ON CONFLICT (key) DO NOTHING;
