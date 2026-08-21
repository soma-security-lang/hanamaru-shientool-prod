ALTER TABLE storage_objects DROP CONSTRAINT storage_objects_purpose_check;
ALTER TABLE storage_objects ADD CONSTRAINT storage_objects_purpose_check
  CHECK(purpose IN ('visit_pdf','recording','training_video','transcript_raw','review_artifact','quarantine','export'));

ALTER TABLE retention_policies DROP CONSTRAINT retention_policies_data_type_check;
ALTER TABLE retention_policies ADD CONSTRAINT retention_policies_data_type_check
  CHECK(data_type IN ('pdf','audio','video','transcript','review','audit'));

CREATE TABLE video_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  object_name text NOT NULL,
  mime_type varchar(255) NOT NULL CHECK(mime_type IN ('video/mp4','video/webm')),
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 2000000000),
  sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  requested_by_membership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,content_version_id) REFERENCES content_versions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE training_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  duration_ms bigint NOT NULL CHECK(duration_ms>0),
  width int NOT NULL CHECK(width>0),
  height int NOT NULL CHECK(height>0),
  media_metadata jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('ready','deleted')),
  retention_until timestamptz NOT NULL,
  retention_policy_id uuid NOT NULL REFERENCES retention_policies(id) ON DELETE RESTRICT,
  uploaded_by_membership_id uuid NOT NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,content_version_id),
  UNIQUE(storage_object_id),
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,content_version_id) REFERENCES content_versions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,storage_object_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,uploaded_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX video_upload_sessions_expiry ON video_upload_sessions(expires_at) WHERE completed_at IS NULL;
CREATE INDEX training_videos_content ON training_videos(organization_id,content_item_id,content_version_id);
CREATE INDEX training_videos_retention ON training_videos(organization_id,retention_until) WHERE status='ready';

ALTER TABLE video_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_upload_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON video_upload_sessions USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
ALTER TABLE training_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_videos FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON training_videos USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
GRANT SELECT,INSERT,UPDATE ON video_upload_sessions,training_videos TO hanamaru_api;
GRANT SELECT,UPDATE ON video_upload_sessions,training_videos TO hanamaru_worker;

COMMENT ON TABLE training_videos IS 'Authenticated, write-once training video media bound to an immutable content version.';

CREATE OR REPLACE FUNCTION apply_retention_policies(p_organization_id uuid,p_shortening_grace boolean)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed int:=0; n int;
BEGIN
  IF current_setting('app.organization_id',true) IS DISTINCT FROM p_organization_id::text THEN RAISE EXCEPTION 'organization context mismatch'; END IF;
  PERFORM set_config('app.audit_retention_operation','on',true);
  WITH current_policy AS (SELECT DISTINCT ON(data_type) id,data_type FROM retention_policies WHERE organization_id=p_organization_id AND effective_from<=now() ORDER BY data_type,effective_from DESC,version DESC)
  UPDATE retention_policies p SET status=CASE WHEN c.current_id IS NOT NULL THEN 'active' ELSE 'retired' END FROM (SELECT p2.id,c.id current_id FROM retention_policies p2 LEFT JOIN current_policy c ON c.data_type=p2.data_type AND c.id=p2.id WHERE p2.organization_id=p_organization_id AND p2.effective_from<=now()) c WHERE p.id=c.id AND p.status IS DISTINCT FROM CASE WHEN c.current_id IS NOT NULL THEN 'active' ELSE 'retired' END;
  WITH policy AS (SELECT DISTINCT ON(data_type) id,data_type,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND effective_from<=now() ORDER BY data_type,effective_from DESC,version DESC)
  UPDATE storage_objects s SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND s.created_at+(p.retention_days||' days')::interval<s.retention_until THEN GREATEST(s.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE s.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE s.organization_id=p_organization_id AND p.data_type=CASE WHEN s.purpose='visit_pdf' THEN 'pdf' WHEN s.purpose='recording' THEN 'audio' WHEN s.purpose='training_video' THEN 'video' END AND s.retention_policy_id IS DISTINCT FROM p.id;
  GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='audio' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1) UPDATE recordings r SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND r.created_at+(p.retention_days||' days')::interval<r.retention_until THEN GREATEST(r.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE r.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE r.organization_id=p_organization_id AND r.retention_policy_id IS DISTINCT FROM p.id; GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='video' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1) UPDATE training_videos v SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND v.created_at+(p.retention_days||' days')::interval<v.retention_until THEN GREATEST(v.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE v.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE v.organization_id=p_organization_id AND v.retention_policy_id IS DISTINCT FROM p.id; GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='transcript' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1) UPDATE transcripts t SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND t.created_at+(p.retention_days||' days')::interval<t.retention_until THEN GREATEST(t.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE t.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE t.organization_id=p_organization_id AND t.retention_policy_id IS DISTINCT FROM p.id; GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='review' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1) UPDATE reviews r SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND r.created_at+(p.retention_days||' days')::interval<r.retention_until THEN GREATEST(r.created_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE r.created_at+(p.retention_days||' days')::interval END FROM policy p WHERE r.organization_id=p_organization_id AND r.retention_policy_id IS DISTINCT FROM p.id; GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  WITH policy AS (SELECT id,retention_days FROM retention_policies WHERE organization_id=p_organization_id AND data_type='audit' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1) UPDATE audit_events a SET retention_policy_id=p.id,retention_until=CASE WHEN p_shortening_grace AND a.retention_until IS NOT NULL AND a.occurred_at+(p.retention_days||' days')::interval<a.retention_until THEN GREATEST(a.occurred_at+(p.retention_days||' days')::interval,now()+interval '7 days') ELSE a.occurred_at+(p.retention_days||' days')::interval END FROM policy p WHERE a.organization_id=p_organization_id AND a.retention_policy_id IS DISTINCT FROM p.id; GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
  RETURN changed;
END $$;
