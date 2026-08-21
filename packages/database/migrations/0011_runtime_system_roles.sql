DO $$ BEGIN CREATE ROLE hanamaru_api_system NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE hanamaru_worker_system NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO hanamaru_api_system,hanamaru_worker_system;

GRANT SELECT ON organizations,branches,users,memberships,roles,role_assignments,sessions TO hanamaru_api_system;
GRANT UPDATE ON users,memberships,sessions TO hanamaru_api_system;

GRANT SELECT ON memberships,jobs TO hanamaru_worker_system;
GRANT EXECUTE ON FUNCTION claim_job(uuid,text,text),claim_outbox(int,int),mark_outbox_published(uuid,text) TO hanamaru_worker_system;

-- Runtime login principals are provisioned outside migrations and receive exactly
-- one system role plus one tenant-scoped role:
--   GRANT hanamaru_api_system,hanamaru_api TO <api_login>;
--   GRANT hanamaru_worker_system,hanamaru_worker TO <worker_login>;
