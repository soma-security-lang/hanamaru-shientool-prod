GRANT INSERT ON jobs,outbox_events TO hanamaru_worker;

COMMENT ON TABLE outbox_events IS 'Transactional dispatch outbox. Drive import may enqueue transcription in the same tenant transaction.';
