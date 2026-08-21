CREATE INDEX visits_self_idx ON visits(organization_id,assigned_membership_id,scheduled_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX visits_branch_idx ON visits(organization_id,branch_id,status,scheduled_at DESC,id DESC);
CREATE INDEX jobs_ready_idx ON jobs(organization_id,status,available_at,id) WHERE status IN ('queued','retry_wait');
CREATE INDEX jobs_entity_idx ON jobs(organization_id,entity_type,entity_id,created_at DESC);
CREATE INDEX storage_retention_idx ON storage_objects(organization_id,retention_until,id) WHERE deleted_at IS NULL;
CREATE INDEX recordings_visit_idx ON recordings(organization_id,visit_id,captured_at DESC);
CREATE INDEX transcript_version_idx ON transcripts(organization_id,recording_id,version DESC);
CREATE INDEX review_version_idx ON reviews(organization_id,transcript_id,version DESC);
CREATE INDEX audit_time_idx ON audit_events(organization_id,occurred_at DESC,id DESC);
CREATE INDEX content_list_idx ON content_items(organization_id,content_type,status,display_order,id);
CREATE INDEX content_search_fts_idx ON content_items USING gin(to_tsvector('simple',search_text));
CREATE INDEX content_title_trgm_idx ON content_items USING gin(title gin_trgm_ops);
CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);
CREATE INDEX session_expiry_idx ON sessions(organization_id,membership_id,absolute_expires_at) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','branches','users','memberships','visits','form_schema_versions','storage_objects','visit_documents','document_extractions','visit_field_values','external_connections','recordings','drive_imports','jobs','transcripts','transcript_segments','prompt_versions','review_criteria_versions','reviews','review_comments','content_items','learning_progress','retention_policies','legal_holds','deletion_requests','deletion_items','feature_flags'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',t,t);
  END LOOP;
END $$;
