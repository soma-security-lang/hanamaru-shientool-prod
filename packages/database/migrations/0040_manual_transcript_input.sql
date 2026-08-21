ALTER TABLE recordings ALTER COLUMN consent_id DROP NOT NULL;
ALTER TABLE recordings ALTER COLUMN storage_object_id DROP NOT NULL;
ALTER TABLE recordings DROP CONSTRAINT recordings_source_type_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_source_type_check CHECK(source_type IN ('upload','drive','browser','manual'));
ALTER TABLE recordings ADD CONSTRAINT recordings_source_integrity CHECK(
  (source_type='manual' AND consent_id IS NULL AND storage_object_id IS NULL)
  OR (source_type<>'manual' AND consent_id IS NOT NULL AND storage_object_id IS NOT NULL)
);

ALTER TABLE jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check
  CHECK(job_type IN ('pdf_extract','preparation','drive_import','transcribe','manual_transcript','review','delete','retention_scan'));

COMMENT ON COLUMN recordings.source_type IS 'manual is a no-audio transcript input and must never reference consent or storage.';
