ALTER TABLE idempotency_records
  ALTER COLUMN response_status DROP NOT NULL,
  ALTER COLUMN response_body_redacted DROP NOT NULL,
  ADD COLUMN processing_status varchar(20) NOT NULL DEFAULT 'completed'
    CHECK(processing_status IN ('in_progress','completed')),
  ADD COLUMN lease_expires_at timestamptz NULL,
  ADD CONSTRAINT idempotency_completion_shape CHECK(
    (processing_status='in_progress' AND response_status IS NULL AND response_body_redacted IS NULL AND lease_expires_at IS NOT NULL)
    OR
    (processing_status='completed' AND response_status IS NOT NULL AND response_body_redacted IS NOT NULL AND lease_expires_at IS NULL)
  );

CREATE INDEX idempotency_processing_lease_idx
  ON idempotency_records(processing_status,lease_expires_at)
  WHERE processing_status='in_progress';

COMMENT ON COLUMN idempotency_records.processing_status IS 'Short provider-call claim. It prevents duplicate external AI calls without holding a database transaction open.';
