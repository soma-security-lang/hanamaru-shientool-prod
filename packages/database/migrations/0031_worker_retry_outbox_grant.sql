-- Production databases that predate the Drive-to-STT chain must still allow
-- the worker to schedule durable provider polling through the tenant outbox.
GRANT INSERT ON outbox_events TO hanamaru_worker;
