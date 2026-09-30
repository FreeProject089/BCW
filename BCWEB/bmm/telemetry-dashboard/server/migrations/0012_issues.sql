-- Live issues: errors BMM reports as they happen (JS errors, Rust panics, failed commands,
-- failed deploys / installs / backups / scheduler tasks), grouped by a fingerprint the client
-- computes from the normalised message and the top stack frames.
--
-- What is stored, and what is not:
--   * the message and frames arrive ALREADY redacted by BMM (secrets, user-folder names,
--     e-mails, IPs, tokens) and are scrubbed a second time on ingest (issues.rs);
--   * an install is known here only by `install_id` = sha256("bmm-issues:v1:" + creator id),
--     truncated. It cannot be joined to the `events` table by itself, and a GDPR request
--     reaches it by hashing the requester's creator ids the same way (gdpr.rs);
--   * no IP address, no packet id, no session content.

-- One row per fingerprint: the group a staff member triages.
CREATE TABLE IF NOT EXISTS issue_groups (
  fingerprint   TEXT PRIMARY KEY,
  component     TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL DEFAULT 'error',
  message       TEXT NOT NULL DEFAULT '',
  frames        JSONB NOT NULL DEFAULT '[]'::jsonb,
  code          TEXT,
  crash_report  TEXT,
  session_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'open',     -- open | resolved | ignored
  assignee      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  total_count   BIGINT NOT NULL DEFAULT 0,
  first_seen    BIGINT NOT NULL,
  last_seen     BIGINT NOT NULL,
  resolved_at   BIGINT,
  regressed     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Laya (through the BCWEB API AI layer): the machine's labels, never overwritten by staff.
  ai_status     TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed | off
  ai_labels     JSONB,
  ai_model      TEXT,
  ai_at         BIGINT,
  ai_attempts   INT NOT NULL DEFAULT 0,
  -- Staff corrections, kept apart so the feedback log can compare the two.
  staff_labels  JSONB,
  staff_by      TEXT,
  staff_at      BIGINT
);
CREATE INDEX IF NOT EXISTS issue_groups_last_seen ON issue_groups (last_seen DESC);
CREATE INDEX IF NOT EXISTS issue_groups_status ON issue_groups (status);
CREATE INDEX IF NOT EXISTS issue_groups_ai_status ON issue_groups (ai_status);

-- Per install and version: how many times, first and last time. What "versions affected" and
-- "installs affected" are computed from, and what a GDPR erasure deletes.
CREATE TABLE IF NOT EXISTS issue_occurrences (
  fingerprint  TEXT NOT NULL REFERENCES issue_groups(fingerprint) ON DELETE CASCADE,
  install_id   TEXT NOT NULL,
  app_version  TEXT NOT NULL DEFAULT '',
  os           TEXT NOT NULL DEFAULT '',
  count        BIGINT NOT NULL DEFAULT 0,
  first_seen   BIGINT NOT NULL,
  last_seen    BIGINT NOT NULL,
  PRIMARY KEY (fingerprint, install_id, app_version)
);
CREATE INDEX IF NOT EXISTS issue_occurrences_install ON issue_occurrences (install_id);
CREATE INDEX IF NOT EXISTS issue_occurrences_last_seen ON issue_occurrences (last_seen);

-- Hourly counts per group: the sparkline and the spike detector. No install id here.
CREATE TABLE IF NOT EXISTS issue_hourly (
  fingerprint  TEXT NOT NULL REFERENCES issue_groups(fingerprint) ON DELETE CASCADE,
  hour         BIGINT NOT NULL,                   -- epoch ms of the hour's start
  count        BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (fingerprint, hour)
);
CREATE INDEX IF NOT EXISTS issue_hourly_hour ON issue_hourly (hour);

-- Every time a staff member corrects Laya: what Laya said, what staff said. The accuracy
-- panel and any future re-tuning read this.
CREATE TABLE IF NOT EXISTS issue_ai_feedback (
  id           BIGSERIAL PRIMARY KEY,
  fingerprint  TEXT NOT NULL,
  ai_labels    JSONB,
  staff_labels JSONB NOT NULL,
  by_who       TEXT NOT NULL DEFAULT '',
  ts           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS issue_ai_feedback_ts ON issue_ai_feedback (ts DESC);
