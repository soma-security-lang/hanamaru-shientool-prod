-- Localhost production-build runtime principals. These logins are intentionally
-- NOINHERIT/NOBYPASSRLS: application requests must SET ROLE to the scoped role,
-- while system queries must explicitly SET ROLE to the narrow system role.

\getenv api_password HANAMARU_LOCAL_API_DB_PASSWORD
\getenv worker_password HANAMARU_LOCAL_WORKER_DB_PASSWORD
\if :{?api_password}
\else
  \echo 'HANAMARU_LOCAL_API_DB_PASSWORD is required'
  \quit 3
\endif
\if :{?worker_password}
\else
  \echo 'HANAMARU_LOCAL_WORKER_DB_PASSWORD is required'
  \quit 3
\endif

DO $$ BEGIN
  CREATE ROLE hanamaru_local_api LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE hanamaru_local_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE hanamaru_local_api NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE hanamaru_local_worker NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE hanamaru_local_api PASSWORD :'api_password';
ALTER ROLE hanamaru_local_worker PASSWORD :'worker_password';

GRANT hanamaru_api, hanamaru_api_system TO hanamaru_local_api;
GRANT hanamaru_worker, hanamaru_worker_system TO hanamaru_local_worker;

-- The localhost worker owns both job execution and outbox dispatch. The
-- repository still enters this privilege through DATABASE_SYSTEM_ROLE only.
GRANT hanamaru_dispatcher TO hanamaru_worker_system;
