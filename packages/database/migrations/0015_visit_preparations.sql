ALTER TABLE jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check
  CHECK(job_type IN ('pdf_extract','preparation','drive_import','transcribe','review','delete','retention_scan'));

ALTER TABLE prompt_versions DROP CONSTRAINT prompt_versions_purpose_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_purpose_check
  CHECK(purpose IN ('pdf_extract','preparation','review'));

CREATE TABLE visit_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  document_extraction_id uuid NOT NULL REFERENCES document_extractions(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  version int NOT NULL CHECK(version>0),
  model_name varchar(100) NOT NULL,
  input_hash char(64) NOT NULL,
  structured_result jsonb NOT NULL CHECK(jsonb_typeof(structured_result)='object'),
  status varchar(20) NOT NULL CHECK(status IN ('generated','confirmed','superseded','failed')),
  confirmed_by_membership_id uuid NULL,
  confirmed_at timestamptz NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id),
  UNIQUE(visit_id,version)
);

CREATE UNIQUE INDEX visit_preparations_one_current
  ON visit_preparations(visit_id)
  WHERE status IN ('generated','confirmed');

CREATE INDEX visit_preparations_visit_created_idx
  ON visit_preparations(organization_id,visit_id,created_at DESC);

ALTER TABLE visit_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visit_preparations
  USING(organization_id=app_org_id())
  WITH CHECK(organization_id=app_org_id());

GRANT SELECT ON visit_preparations TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON visit_preparations TO hanamaru_worker;
GRANT SELECT ON visit_preparations TO hanamaru_readonly_ops;

CREATE TRIGGER visit_preparations_touch
  BEFORE UPDATE ON visit_preparations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE visit_preparations IS 'Versioned, source-grounded visit preparation generated from a confirmed PDF extraction and published knowledge.';
COMMENT ON COLUMN visit_preparations.structured_result IS 'Customer facts, anticipated psychology, exactly four legal checks, suggested talks and anticipated Q&A with source IDs.';
