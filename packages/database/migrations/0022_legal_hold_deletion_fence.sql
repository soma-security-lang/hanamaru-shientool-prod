-- A durable fence closes the gap between a database hold check and the
-- external deletion of an immutable object generation.
CREATE TABLE visit_deletion_fences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  operation varchar(20) NOT NULL CHECK(operation IN ('delete','retention')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,visit_id),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE visit_deletion_fences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_visit_deletion_fences ON visit_deletion_fences
  USING (organization_id=current_setting('app.organization_id',true)::uuid)
  WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
GRANT SELECT,DELETE ON visit_deletion_fences TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON visit_deletion_fences TO hanamaru_worker;
CREATE INDEX visit_deletion_fence_job_idx ON visit_deletion_fences(job_id);
