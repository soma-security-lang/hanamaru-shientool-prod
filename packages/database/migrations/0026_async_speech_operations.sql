ALTER TABLE jobs
  ADD COLUMN provider_operation_id text NULL,
  ADD COLUMN provider_operation_state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(provider_operation_state)='object'),
  ADD COLUMN provider_operation_started_at timestamptz NULL;

ALTER TABLE jobs DROP CONSTRAINT jobs_max_attempts_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_max_attempts_check CHECK(max_attempts BETWEEN 1 AND 250);

UPDATE jobs
   SET max_attempts=200
 WHERE job_type='transcribe'
   AND max_attempts<200
   AND status IN ('queued','running','retry_wait','failed');

CREATE UNIQUE INDEX jobs_provider_operation_idx
  ON jobs(organization_id,job_type,provider_operation_id)
  WHERE provider_operation_id IS NOT NULL;

COMMENT ON COLUMN jobs.provider_operation_id IS
  'Durable Google Speech BatchRecognize LRO name. Internal only; never return it from ordinary or system-admin APIs.';
COMMENT ON COLUMN jobs.provider_operation_state IS
  'Minimal provider continuation state such as a temporary input cleanup token. It must not contain transcript or customer content.';
COMMENT ON COLUMN jobs.provider_operation_started_at IS
  'When the durable provider operation was first accepted; retries poll the same operation instead of starting another one.';
