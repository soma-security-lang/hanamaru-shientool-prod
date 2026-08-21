CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.organization_id',true),'')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','memberships','role_assignments','sessions','visits','form_schema_versions','storage_objects','visit_documents','document_extractions','visit_field_values','upload_sessions','external_connections','recording_consents','recordings','drive_imports','jobs','job_attempts','outbox_events','idempotency_records','transcripts','transcript_segments','prompt_versions','review_criteria_versions','reviews','review_findings','review_evidence','review_comments','content_items','content_versions','tags','content_tags','learning_progress','retention_policies','legal_holds','deletion_requests','deletion_items','audit_events','system_settings','feature_flags'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO hanamaru_api,hanamaru_worker,hanamaru_dispatcher,hanamaru_readonly_ops;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO hanamaru_api;
REVOKE UPDATE,DELETE ON audit_events FROM hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON jobs,job_attempts,transcripts,transcript_segments,reviews,review_findings,review_evidence,storage_objects,deletion_requests,deletion_items,audit_events TO hanamaru_worker;
GRANT SELECT,UPDATE ON outbox_events,jobs TO hanamaru_dispatcher;
GRANT SELECT ON organizations,branches,memberships,jobs,job_attempts,retention_policies,deletion_requests,audit_events TO hanamaru_readonly_ops;
REVOKE ALL ON transcripts,transcript_segments,reviews,review_findings,review_evidence,storage_objects FROM hanamaru_readonly_ops;

CREATE OR REPLACE FUNCTION claim_job(p_job_id uuid,p_worker_revision text,p_trace_id text)
RETURNS TABLE(id uuid,organization_id uuid,job_type varchar,entity_type varchar,entity_id uuid,input_redacted jsonb,attempt_count int,max_attempts int,requested_by_membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claimed jobs%ROWTYPE;
BEGIN
  SELECT * INTO claimed FROM jobs j WHERE j.id=p_job_id AND j.status IN ('queued','retry_wait') AND j.available_at<=now() FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE jobs SET status='running',attempt_count=jobs.attempt_count+1,started_at=now(),updated_at=now() WHERE jobs.id=p_job_id RETURNING * INTO claimed;
  INSERT INTO job_attempts(organization_id,job_id,attempt_no,worker_revision,started_at,result_status,trace_id)
  VALUES(claimed.organization_id,claimed.id,claimed.attempt_count,p_worker_revision,now(),'running',p_trace_id);
  RETURN QUERY SELECT claimed.id,claimed.organization_id,claimed.job_type,claimed.entity_type,claimed.entity_id,claimed.input_redacted,claimed.attempt_count,claimed.max_attempts,claimed.requested_by_membership_id;
END $$;
REVOKE ALL ON FUNCTION claim_job(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job(uuid,text,text) TO hanamaru_worker;

CREATE OR REPLACE FUNCTION claim_outbox(p_limit int,p_lease_seconds int)
RETURNS TABLE(id uuid,organization_id uuid,event_type varchar,aggregate_id uuid,payload_redacted jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE outbox_events o SET leased_until=now()+(p_lease_seconds||' seconds')::interval,publish_attempts=o.publish_attempts+1
  WHERE o.id IN (SELECT i.id FROM outbox_events i WHERE i.published_at IS NULL AND i.available_at<=now() AND (i.leased_until IS NULL OR i.leased_until<now()) ORDER BY i.created_at FOR UPDATE SKIP LOCKED LIMIT p_limit)
  RETURNING o.id,o.organization_id,o.event_type,o.aggregate_id,o.payload_redacted
$$;
CREATE OR REPLACE FUNCTION mark_outbox_published(p_id uuid,p_task_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN UPDATE outbox_events SET published_at=now(),leased_until=NULL WHERE id=p_id; UPDATE jobs SET cloud_task_name=p_task_name WHERE id=(SELECT aggregate_id FROM outbox_events WHERE id=p_id); END $$;
REVOKE ALL ON FUNCTION claim_outbox(int,int),mark_outbox_published(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox(int,int),mark_outbox_published(uuid,text) TO hanamaru_dispatcher;
