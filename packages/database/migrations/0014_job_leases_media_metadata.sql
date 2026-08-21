ALTER TABLE jobs
  ADD COLUMN lease_owner varchar(256) NULL,
  ADD COLUMN lease_expires_at timestamptz NULL,
  ADD COLUMN heartbeat_at timestamptz NULL,
  ADD COLUMN cancel_requested_at timestamptz NULL;

ALTER TABLE recordings
  ADD COLUMN media_metadata jsonb NOT NULL DEFAULT '{}';

CREATE INDEX jobs_reclaimable_idx
  ON jobs(status,lease_expires_at,available_at)
  WHERE status IN ('queued','retry_wait','running');

CREATE OR REPLACE FUNCTION claim_job(p_job_id uuid,p_worker_revision text,p_trace_id text)
RETURNS TABLE(id uuid,organization_id uuid,job_type varchar,entity_type varchar,entity_id uuid,input_redacted jsonb,attempt_count int,max_attempts int,requested_by_membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claimed jobs%ROWTYPE;
BEGIN
  SELECT * INTO claimed
    FROM jobs j
   WHERE j.id=p_job_id
     AND (
       (j.status IN ('queued','retry_wait') AND j.available_at<=now())
       OR (j.status='running' AND j.lease_expires_at<now())
     )
     AND j.cancel_requested_at IS NULL
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  IF claimed.status='running' THEN
    UPDATE job_attempts
       SET finished_at=COALESCE(finished_at,now()),
           result_status=CASE WHEN finished_at IS NULL THEN 'retryable' ELSE result_status END,
           error_code=CASE WHEN finished_at IS NULL THEN 'WORKER_LEASE_EXPIRED' ELSE error_code END,
           error_detail_redacted=CASE WHEN finished_at IS NULL THEN 'Worker lease expired before completion' ELSE error_detail_redacted END
     WHERE job_id=claimed.id AND attempt_no=claimed.attempt_count;
  END IF;

  UPDATE jobs
     SET status='running',
         attempt_count=jobs.attempt_count+1,
         started_at=now(),
         updated_at=now(),
         lease_owner=left(p_worker_revision||':'||p_trace_id,256),
         lease_expires_at=now()+interval '5 minutes',
         heartbeat_at=now(),
         error_code=NULL,
         error_detail_redacted=NULL
   WHERE jobs.id=p_job_id
   RETURNING * INTO claimed;

  INSERT INTO job_attempts(organization_id,job_id,attempt_no,worker_revision,started_at,result_status,trace_id)
  VALUES(claimed.organization_id,claimed.id,claimed.attempt_count,p_worker_revision,now(),'running',p_trace_id);

  RETURN QUERY SELECT claimed.id,claimed.organization_id,claimed.job_type,claimed.entity_type,claimed.entity_id,claimed.input_redacted,claimed.attempt_count,claimed.max_attempts,claimed.requested_by_membership_id;
END $$;

REVOKE ALL ON FUNCTION claim_job(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job(uuid,text,text) TO hanamaru_worker,hanamaru_worker_system;

COMMENT ON COLUMN jobs.lease_expires_at IS 'A crashed worker can be reclaimed only after this timestamp.';
COMMENT ON COLUMN jobs.heartbeat_at IS 'Last worker heartbeat; never exposed as end-user progress.';
COMMENT ON COLUMN recordings.media_metadata IS 'Validated codec, duration, sample rate and channel metadata. It must not contain PII.';
