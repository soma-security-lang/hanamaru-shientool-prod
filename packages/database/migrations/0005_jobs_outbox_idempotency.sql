CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_type varchar(40) NOT NULL CHECK(job_type IN ('pdf_extract','drive_import','transcribe','review','delete','retention_scan')),
  entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL, status varchar(20) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retry_wait','succeeded','failed','cancelled')),
  idempotency_key varchar(200) NOT NULL, input_hash char(64) NOT NULL, input_redacted jsonb NOT NULL DEFAULT '{}',
  attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0), max_attempts int NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  cloud_task_name text NULL UNIQUE, available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NULL, finished_at timestamptz NULL,
  error_code varchar(100) NULL, error_detail_redacted text NULL, requested_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,job_type,idempotency_key), UNIQUE(organization_id,id)
);
ALTER TABLE document_extractions ADD CONSTRAINT document_extractions_job_fk FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE RESTRICT;
ALTER TABLE drive_imports ADD CONSTRAINT drive_imports_job_fk FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE RESTRICT;
CREATE TABLE job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, attempt_no int NOT NULL CHECK(attempt_no>0), worker_revision varchar(128) NOT NULL,
  started_at timestamptz NOT NULL, finished_at timestamptz NULL, result_status varchar(20) NOT NULL CHECK(result_status IN ('running','succeeded','retryable','failed','cancelled')),
  provider_operation_id_hash char(64) NULL, error_code varchar(100) NULL, error_detail_redacted text NULL, trace_id varchar(64) NOT NULL,
  UNIQUE(job_id,attempt_no)
);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type varchar(100) NOT NULL, aggregate_type varchar(40) NOT NULL, aggregate_id uuid NOT NULL,
  payload_redacted jsonb NOT NULL CHECK(pg_column_size(payload_redacted)<=32768), deduplication_key varchar(200) NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz NULL, published_at timestamptz NULL, publish_attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,deduplication_key)
);
CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, endpoint_key varchar(100) NOT NULL, idempotency_key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL, response_status int NOT NULL, response_body_redacted jsonb NOT NULL, resource_id uuid NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,membership_id,endpoint_key,idempotency_key)
);
