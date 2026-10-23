-- Local test provisioning only. Not in the production migration runner.
CREATE TABLE IF NOT EXISTS alignment_sessions (
  key varchar(64) PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS alignment_sessions_expiry ON alignment_sessions(expires_at);
REVOKE ALL ON alignment_sessions FROM PUBLIC;
