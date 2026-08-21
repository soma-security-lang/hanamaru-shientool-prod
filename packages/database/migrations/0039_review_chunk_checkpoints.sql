CREATE TABLE review_chunk_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  chunk_index int NOT NULL CHECK(chunk_index>=0),
  first_sequence_no int NOT NULL CHECK(first_sequence_no>=0),
  last_sequence_no int NOT NULL CHECK(last_sequence_no>=first_sequence_no),
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  result_redacted jsonb NOT NULL CHECK(pg_column_size(result_redacted)<=1048576),
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,job_id) REFERENCES jobs(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,transcript_id) REFERENCES transcripts(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(job_id,chunk_index),
  UNIQUE(job_id,input_hash)
);
CREATE INDEX review_chunk_checkpoints_transcript ON review_chunk_checkpoints(organization_id,transcript_id,chunk_index);
ALTER TABLE review_chunk_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_chunk_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON review_chunk_checkpoints USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON review_chunk_checkpoints TO hanamaru_worker;
GRANT SELECT ON review_chunk_checkpoints TO hanamaru_api;
COMMENT ON TABLE review_chunk_checkpoints IS 'Successful transcript-segment-aligned AI review chunks, reused by the same job after temporary failure.';
