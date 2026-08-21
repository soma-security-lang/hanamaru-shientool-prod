-- Bind every retained record to the policy that calculated its deadline.
ALTER TABLE storage_objects ADD COLUMN retention_policy_id uuid NULL REFERENCES retention_policies(id) ON DELETE RESTRICT;
ALTER TABLE recordings ADD COLUMN retention_policy_id uuid NULL REFERENCES retention_policies(id) ON DELETE RESTRICT;
ALTER TABLE transcripts ADD COLUMN retention_policy_id uuid NULL REFERENCES retention_policies(id) ON DELETE RESTRICT;
ALTER TABLE reviews ADD COLUMN retention_policy_id uuid NULL REFERENCES retention_policies(id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD COLUMN retention_until timestamptz NULL;
ALTER TABLE audit_events ADD COLUMN retention_policy_id uuid NULL REFERENCES retention_policies(id) ON DELETE RESTRICT;

UPDATE storage_objects s SET retention_policy_id=(SELECT id FROM retention_policies p WHERE p.organization_id=s.organization_id AND p.data_type=CASE WHEN s.purpose='visit_pdf' THEN 'pdf' ELSE 'audio' END AND p.effective_from<=s.created_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1) WHERE s.purpose IN ('visit_pdf','recording');
UPDATE recordings r SET retention_policy_id=(SELECT id FROM retention_policies p WHERE p.organization_id=r.organization_id AND p.data_type='audio' AND p.effective_from<=r.created_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1);
UPDATE transcripts t SET retention_policy_id=(SELECT id FROM retention_policies p WHERE p.organization_id=t.organization_id AND p.data_type='transcript' AND p.effective_from<=t.created_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1);
UPDATE reviews r SET retention_policy_id=(SELECT id FROM retention_policies p WHERE p.organization_id=r.organization_id AND p.data_type='review' AND p.effective_from<=r.created_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1);
ALTER TABLE audit_events DISABLE TRIGGER audit_append_only;
UPDATE audit_events a SET retention_policy_id=(SELECT id FROM retention_policies p WHERE p.organization_id=a.organization_id AND p.data_type='audit' AND p.effective_from<=a.occurred_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1),retention_until=a.occurred_at+((SELECT retention_days FROM retention_policies p WHERE p.organization_id=a.organization_id AND p.data_type='audit' AND p.effective_from<=a.occurred_at ORDER BY p.effective_from DESC,p.version DESC LIMIT 1)||' days')::interval;
ALTER TABLE audit_events ENABLE TRIGGER audit_append_only;

CREATE INDEX storage_retention_policy_idx ON storage_objects(organization_id,retention_policy_id,retention_until) WHERE status IN ('available','deleting');
CREATE INDEX recording_retention_policy_idx ON recordings(organization_id,retention_policy_id,retention_until) WHERE status<>'deleted';
CREATE INDEX transcript_retention_policy_idx ON transcripts(organization_id,retention_policy_id,retention_until) WHERE status<>'deleted';
CREATE INDEX review_retention_policy_idx ON reviews(organization_id,retention_policy_id,retention_until) WHERE status<>'deleted';
CREATE INDEX audit_retention_idx ON audit_events(organization_id,retention_until,id) WHERE retention_until IS NOT NULL;

CREATE TABLE audit_retention_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  cutoff_at timestamptz NOT NULL,
  last_event_hash char(64) NOT NULL,
  purged_count int NOT NULL CHECK(purged_count>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_retention_anchor_latest ON audit_retention_anchors(organization_id,created_at DESC,id DESC);
ALTER TABLE audit_retention_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit_retention_anchors ON audit_retention_anchors USING (organization_id=current_setting('app.organization_id',true)::uuid);
GRANT SELECT ON audit_retention_anchors TO hanamaru_api,hanamaru_worker;

CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.audit_retention_operation',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_events are append-only';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION apply_retention_policies(p_organization_id uuid,p_shortening_grace boolean)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed int:=0; n int;
BEGIN
  IF current_setting('app.organization_id',true) IS DISTINCT FROM p_organization_id::text THEN RAISE EXCEPTION 'organization context mismatch'; END IF;
  PERFORM set_config('app.audit_retention_operation','on',true);
  WITH current_policy AS (SELECT DISTINCT ON(data_type) id,data_type FROM retention_policies WHERE organization_id=p_organization_id AND effective_from<=now() ORDER BY data_type,effective_from DESC,version DESC)
  UPDATE retention_policies p SET status=CASE WHEN c.current_id IS NOT NULL THEN 'active' ELSE 'retired' END FROM (SELECT p2.id,c.id current_id FROM retention_policies p2 LEFT JOIN current_policy c ON c.data_type=p2.data_type AND c.id=p2.id WHERE p2.organization_id=p_organization_id AND p2.effective_from<=now()) c WHERE p.id=c.id AND p.status IS DISTINCT FROM CASE WHEN c.current_id IS NOT NULL THEN 'active' ELSE 'retired' END;
  WITH policy AS (SELECT DISTINCT ON(data_type) id,data_type,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND effective_from<=now() ORDER BY data_type,effective_from DESC,version DESC)
  UPDATE storage_objects s SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND s.created_at+(p.retention_days||' days')::interval<s.retention_until THEN GREATEST(s.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE s.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE s.organization_id=p_organization_id AND p.data_type=CASE WHEN s.purpose='visit_pdf' THEN 'pdf' WHEN s.purpose='recording' THEN 'audio' END AND s.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='audio' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1)
  UPDATE recordings r SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND r.created_at+(p.retention_days||' days')::interval<r.retention_until THEN GREATEST(r.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE r.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE r.organization_id=p_organization_id AND r.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='transcript' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1)
  UPDATE transcripts t SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND t.created_at+(p.retention_days||' days')::interval<t.retention_until THEN GREATEST(t.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE t.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE t.organization_id=p_organization_id AND t.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='review' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1)
  UPDATE reviews r SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND r.created_at+(p.retention_days||' days')::interval<r.retention_until THEN GREATEST(r.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE r.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE r.organization_id=p_organization_id AND r.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='audit' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1)
  UPDATE audit_events a SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND a.retention_until IS NOT NULL AND a.occurred_at+(p.retention_days||' days')::interval<a.retention_until THEN GREATEST(a.occurred_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE a.occurred_at+(p.retention_days||' days')::interval END FROM policy p WHERE a.organization_id=p_organization_id AND a.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION purge_expired_audit_events(p_organization_id uuid,p_limit int DEFAULT 500)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n int;last_hash char(64);cutoff timestamptz;ids uuid[];
BEGIN
  IF p_limit<1 OR p_limit>5000 THEN RAISE EXCEPTION 'invalid purge limit'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:'||p_organization_id::text,0));
  SELECT array_agg(id ORDER BY occurred_at,id) INTO ids FROM (SELECT id,occurred_at FROM audit_events WHERE organization_id=p_organization_id AND retention_until<now() ORDER BY occurred_at,id LIMIT p_limit) candidates;
  IF COALESCE(cardinality(ids),0)=0 THEN RETURN 0; END IF;
  SELECT event_hash,occurred_at INTO last_hash,cutoff FROM audit_events WHERE id=ids[array_length(ids,1)];
  PERFORM set_config('app.audit_retention_operation','on',true);
  DELETE FROM audit_events WHERE organization_id=p_organization_id AND id=ANY(ids);
  GET DIAGNOSTICS n=ROW_COUNT;
  INSERT INTO audit_retention_anchors(organization_id,cutoff_at,last_event_hash,purged_count) VALUES(p_organization_id,cutoff,last_hash,n);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION apply_retention_policies(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_retention_policies(uuid,boolean) TO hanamaru_api,hanamaru_worker;
REVOKE ALL ON FUNCTION purge_expired_audit_events(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_audit_events(uuid,int) TO hanamaru_worker_system;
GRANT SELECT,INSERT ON audit_retention_anchors TO hanamaru_worker_system;
GRANT UPDATE ON transcript_segments,review_findings,review_evidence,review_comments TO hanamaru_worker;
GRANT DELETE ON review_findings,review_evidence,review_comments TO hanamaru_worker;
GRANT UPDATE ON document_extractions TO hanamaru_worker;
GRANT DELETE ON visit_field_values TO hanamaru_worker;
GRANT SELECT ON retention_policies TO hanamaru_worker;
REVOKE UPDATE,DELETE ON audit_events FROM hanamaru_worker;
