-- The approval workflow is additive: pilot content remains available under
-- pilot_content_ai while this flag enables human review and publication.
UPDATE feature_flags
SET enabled=true,
    rollback_note='承認フローを無効化',
    updated_at=now()
WHERE flag_key='content_approval'
  AND enabled=false;
