CREATE OR REPLACE FUNCTION schedule_retention_scans(p_day date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org organizations%ROWTYPE; requester uuid; job_id uuid; created int := 0;
BEGIN
  FOR org IN SELECT * FROM organizations LOOP
    SELECT m.id INTO requester FROM memberships m
      JOIN role_assignments ra ON ra.membership_id=m.id
      JOIN roles r ON r.id=ra.role_id
      WHERE m.organization_id=org.id AND m.status='active' AND r.role_code='manager'
      ORDER BY m.created_at LIMIT 1;
    IF requester IS NULL THEN CONTINUE; END IF;
    job_id := gen_random_uuid();
    INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id)
      VALUES(job_id,org.id,'retention_scan','organization',org.id,'retention:'||p_day::text,encode(digest(org.id::text||':'||p_day::text,'sha256'),'hex'),jsonb_build_object('scheduled_day',p_day),requester)
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
