-- Additive, private session storage. Existing business IDs and grants stay intact.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hanamaru_session') THEN
    CREATE ROLE hanamaru_session NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS alignment_sessions (
  key varchar(64) PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE INDEX IF NOT EXISTS alignment_sessions_expiry ON alignment_sessions(expires_at);
CREATE TABLE alignment_rate_limits (
  key varchar(64) PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  hits integer NOT NULL CHECK (hits BETWEEN 1 AND 10001),
  expires_at timestamptz NOT NULL
);
CREATE INDEX alignment_rate_limits_expiry ON alignment_rate_limits(expires_at);
REVOKE ALL ON alignment_sessions,alignment_rate_limits FROM PUBLIC;
REVOKE ALL ON alignment_sessions,alignment_rate_limits FROM hanamaru_api,hanamaru_worker,hanamaru_api_system,hanamaru_worker_system;
GRANT USAGE ON SCHEMA public TO hanamaru_session;
GRANT SELECT,INSERT,UPDATE,DELETE ON alignment_sessions,alignment_rate_limits TO hanamaru_session;
ALTER TABLE alignment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alignment_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE alignment_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE alignment_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY session_service_only ON alignment_sessions FOR ALL TO hanamaru_session USING (true) WITH CHECK (true);
CREATE POLICY session_service_only ON alignment_rate_limits FOR ALL TO hanamaru_session USING (true) WITH CHECK (true);
