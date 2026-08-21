ALTER TABLE recording_consents ADD COLUMN notice_hash char(64) NULL;

UPDATE recording_consents
   SET notice_hash=encode(digest('legacy:'||notice_version,'sha256'),'hex')
 WHERE notice_hash IS NULL;

ALTER TABLE recording_consents ALTER COLUMN notice_hash SET NOT NULL;
ALTER TABLE recording_consents
  ADD CONSTRAINT recording_consents_notice_hash_check
  CHECK (notice_hash ~ '^[0-9a-f]{64}$');
