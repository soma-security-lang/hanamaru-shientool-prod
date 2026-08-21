ALTER TABLE transcripts
  ADD COLUMN provider_operation_id text NULL,
  ADD COLUMN provider_location varchar(32) NULL;

CREATE INDEX transcripts_provider_operation_idx
  ON transcripts(organization_id,provider,provider_operation_id)
  WHERE provider_operation_id IS NOT NULL;

COMMENT ON COLUMN transcripts.provider_operation_id IS 'Google Speech-to-Text V2 operation resource name. UI and ordinary logs must not expose it.';
COMMENT ON COLUMN transcripts.provider_location IS 'Speech-to-Text processing location such as us or eu.';
COMMENT ON COLUMN transcript_segments.speaker_label IS 'Provider speaker label. It is not treated as staff/customer until a user confirms the role.';
