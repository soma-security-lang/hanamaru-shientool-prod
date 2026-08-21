-- PostgreSQL ON CONFLICT requires read access to its conflict arbiter.
-- The worker reads only the tenant-scoped outbox under forced RLS.
GRANT SELECT ON outbox_events TO hanamaru_worker;
