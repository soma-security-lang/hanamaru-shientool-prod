CREATE OR REPLACE FUNCTION purge_expired_runtime_metadata(p_limit integer DEFAULT 1000)
RETURNS TABLE(idempotency_deleted integer,job_inputs_redacted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_idempotency integer:=0;
DECLARE v_jobs integer:=0;
BEGIN
  IF p_limit<1 OR p_limit>10000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10000';
  END IF;

  WITH expired AS (
    SELECT id FROM idempotency_records
     WHERE expires_at<now()
     ORDER BY expires_at,id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  DELETE FROM idempotency_records r USING expired e WHERE r.id=e.id;
  GET DIAGNOSTICS v_idempotency=ROW_COUNT;

  WITH terminal AS (
    SELECT id FROM jobs
     WHERE (
         (status IN ('succeeded','cancelled') AND finished_at<now()-interval '24 hours')
         OR (status='failed' AND finished_at<now()-interval '7 days')
       )
       AND input_redacted<>'{}'::jsonb
     ORDER BY finished_at,id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE jobs j SET input_redacted='{}'::jsonb,updated_at=now()
    FROM terminal t WHERE j.id=t.id;
  GET DIAGNOSTICS v_jobs=ROW_COUNT;

  RETURN QUERY SELECT v_idempotency,v_jobs;
END $$;

CREATE OR REPLACE FUNCTION redact_visit_runtime_metadata(p_organization_id uuid,p_visit_id uuid)
RETURNS TABLE(idempotency_deleted integer,job_inputs_redacted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_idempotency integer:=0;
DECLARE v_jobs integer:=0;
BEGIN
  WITH visit_resources AS (
    SELECT p_visit_id id
    UNION SELECT d.id FROM visit_documents d WHERE d.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT e.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT p.id FROM visit_preparations p WHERE p.organization_id=p_organization_id AND p.visit_id=p_visit_id
    UNION SELECT r.id FROM recordings r WHERE r.organization_id=p_organization_id AND r.visit_id=p_visit_id
    UNION SELECT d.id FROM drive_imports d WHERE d.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=p_organization_id AND r.visit_id=p_visit_id
    UNION SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=p_organization_id AND r.visit_id=p_visit_id
  ), related_jobs AS (
    SELECT j.id FROM jobs j WHERE j.organization_id=p_organization_id AND j.entity_id IN (SELECT id FROM visit_resources)
  ), deleted AS (
    DELETE FROM idempotency_records i
     WHERE i.organization_id=p_organization_id
       AND (i.resource_id IN (SELECT id FROM visit_resources) OR i.resource_id IN (SELECT id FROM related_jobs))
     RETURNING 1
  ) SELECT count(*)::integer INTO v_idempotency FROM deleted;

  WITH visit_resources AS (
    SELECT p_visit_id id
    UNION SELECT d.id FROM visit_documents d WHERE d.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT e.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT p.id FROM visit_preparations p WHERE p.organization_id=p_organization_id AND p.visit_id=p_visit_id
    UNION SELECT r.id FROM recordings r WHERE r.organization_id=p_organization_id AND r.visit_id=p_visit_id
    UNION SELECT d.id FROM drive_imports d WHERE d.organization_id=p_organization_id AND d.visit_id=p_visit_id
    UNION SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=p_organization_id AND r.visit_id=p_visit_id
    UNION SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=p_organization_id AND r.visit_id=p_visit_id
  ), redacted AS (
    UPDATE jobs j SET input_redacted='{}'::jsonb,updated_at=now()
     WHERE j.organization_id=p_organization_id AND j.entity_id IN (SELECT id FROM visit_resources)
       AND j.input_redacted<>'{}'::jsonb
     RETURNING 1
  ) SELECT count(*)::integer INTO v_jobs FROM redacted;

  RETURN QUERY SELECT v_idempotency,v_jobs;
END $$;

REVOKE ALL ON FUNCTION purge_expired_runtime_metadata(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION redact_visit_runtime_metadata(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_runtime_metadata(integer) TO hanamaru_worker_system;
GRANT EXECUTE ON FUNCTION redact_visit_runtime_metadata(uuid,uuid) TO hanamaru_worker_system;

COMMENT ON FUNCTION purge_expired_runtime_metadata(integer) IS
  'Physically removes expired API replay bodies and minimizes completed job inputs after 24 hours and permanently failed job inputs after seven days in bounded batches.';
COMMENT ON FUNCTION redact_visit_runtime_metadata(uuid,uuid) IS
  'Removes API replay bodies and job inputs linked to a visit during explicit deletion.';
