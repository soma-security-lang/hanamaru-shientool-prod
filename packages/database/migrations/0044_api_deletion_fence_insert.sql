-- The API creates the durable fence in the same transaction as a deletion
-- request. Without INSERT the production NOINHERIT API login fails with 42501
-- before the delete worker can be queued.
GRANT INSERT ON visit_deletion_fences TO hanamaru_api;
