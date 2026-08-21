-- Retention is a platform obligation and must not stop when a manager is
-- suspended or leaves the organization. Scheduled jobs use the organization
-- UUID as a non-human system actor marker; the worker records actor_type=service.
CREATE OR REPLACE FUNCTION schedule_retention_scans(p_day date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org organizations%ROWTYPE; job_id uuid; created int := 0;
BEGIN
  FOR org IN SELECT * FROM organizations WHERE status<>'closed' LOOP
    job_id := gen_random_uuid();
    INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id)
      VALUES(job_id,org.id,'retention_scan','organization',org.id,'retention:'||p_day::text,
             encode(digest(org.id::text||':'||p_day::text,'sha256'),'hex'),
             jsonb_build_object('scheduled_day',p_day,'actor_type','system'),org.id)
      ON CONFLICT(organization_id,job_type,idempotency_key) DO NOTHING;
    IF FOUND THEN
      INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key)
        VALUES(org.id,'job.dispatch','job',job_id,jsonb_build_object('job_id',job_id,'job_type','retention_scan'),'job:'||job_id);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

REVOKE ALL ON FUNCTION schedule_retention_scans(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schedule_retention_scans(date) TO hanamaru_worker_system;
