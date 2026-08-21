-- A visit deletion must enumerate and remove any incomplete upload sessions for
-- the visit while it owns the durable deletion fence. Keep this narrower than
-- the API upload-session grant: the Worker may only read and delete them.
GRANT SELECT,DELETE ON upload_sessions TO hanamaru_worker;
