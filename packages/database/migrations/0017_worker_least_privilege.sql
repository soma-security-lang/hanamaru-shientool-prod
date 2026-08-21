-- The original worker grant covered only review tables. The production Worker
-- also owns PDF extraction, preparation, Drive import, retention and deletion.
-- Grant only the verbs required by those concrete handlers.
GRANT SELECT ON
  visits,form_schema_versions,storage_objects,visit_documents,document_extractions,visit_field_values,
  external_connections,recording_consents,recordings,drive_imports,jobs,job_attempts,
  transcripts,transcript_segments,prompt_versions,review_criteria_versions,reviews,review_findings,review_evidence,
  content_items,content_versions,legal_holds,deletion_requests,deletion_items,visit_preparations
TO hanamaru_worker;

GRANT INSERT ON
  storage_objects,document_extractions,visit_field_values,recordings,transcripts,transcript_segments,
  reviews,review_findings,review_evidence,deletion_items,visit_preparations,audit_events
TO hanamaru_worker;

GRANT UPDATE ON
  visits,storage_objects,visit_documents,recordings,drive_imports,jobs,job_attempts,
  transcripts,reviews,deletion_requests,deletion_items,visit_preparations
TO hanamaru_worker;

GRANT SELECT,UPDATE ON visit_preparations TO hanamaru_api;

CREATE OR REPLACE FUNCTION heartbeat_job(p_job_id uuid,p_attempt_no int)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE jobs
     SET heartbeat_at=now(),lease_expires_at=now()+interval '5 minutes',updated_at=now()
   WHERE id=p_job_id AND status='running' AND attempt_count=p_attempt_no AND cancel_requested_at IS NULL;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION heartbeat_job(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_job(uuid,int) TO hanamaru_worker_system;

COMMENT ON FUNCTION heartbeat_job(uuid,int) IS 'Extends only the active attempt lease. Cancellation prevents further extension.';
