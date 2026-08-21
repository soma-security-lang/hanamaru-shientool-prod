-- Keep limited-operation visibility separate from formal editorial approval.
-- PoC extraction can be read by signed-in pilot users, but it is never a
-- published source until the normal approval workflow completes. AI use is
-- separately controlled by the organization-scoped pilot_content_ai flag.
ALTER TABLE content_items
  ADD COLUMN availability_state varchar(20) NOT NULL DEFAULT 'restricted'
  CHECK(availability_state IN ('restricted','pilot','published'));

ALTER TABLE content_versions
  ADD COLUMN migration_state varchar(40) NOT NULL DEFAULT 'not_applicable'
  CHECK(migration_state IN ('not_applicable','extracted_needs_review','reviewed','blocked'));

-- Repair records created by the earlier PoC importer, which incorrectly set
-- approval/publication fields without an approving membership or timestamp.
UPDATE content_items c
   SET status='draft',published_version_id=NULL,availability_state='pilot'
  FROM content_versions cv
 WHERE cv.id=c.current_version_id
   AND cv.source_type='poc'
   AND cv.approved_by_membership_id IS NULL
   AND cv.approved_at IS NULL;

DROP TRIGGER content_version_immutable ON content_versions;
UPDATE content_versions
   SET review_status='draft',approved_by_membership_id=NULL,approved_at=NULL,
       published_at=NULL,migration_state='extracted_needs_review'
 WHERE source_type='poc'
   AND approved_by_membership_id IS NULL
   AND approved_at IS NULL;
CREATE TRIGGER content_version_immutable BEFORE UPDATE OR DELETE ON content_versions
FOR EACH ROW EXECUTE FUNCTION immutable_published_content();

UPDATE content_items
   SET availability_state='published'
 WHERE status='published' AND published_version_id IS NOT NULL;

CREATE INDEX content_pilot_availability_idx
  ON content_items(organization_id,content_type,availability_state,display_order,id)
  WHERE deleted_at IS NULL AND availability_state IN ('pilot','published');

CREATE OR REPLACE FUNCTION enforce_content_availability_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target content_versions%ROWTYPE;
BEGIN
  IF NEW.availability_state='pilot' THEN
    IF NEW.status<>'draft' OR NEW.current_version_id IS NULL OR NEW.published_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'pilot content must be a draft with only a current version';
    END IF;
  ELSIF NEW.availability_state='published' THEN
    IF NEW.status<>'published' OR NEW.published_version_id IS NULL THEN
      RAISE EXCEPTION 'published availability requires a published version';
    END IF;
    SELECT * INTO target FROM content_versions
     WHERE id=NEW.published_version_id AND organization_id=NEW.organization_id
       AND content_item_id=NEW.id;
    IF NOT FOUND OR target.review_status<>'approved' OR target.published_at IS NULL
       OR target.migration_state IN ('extracted_needs_review','blocked') THEN
      RAISE EXCEPTION 'published content requires an approved and reviewed version';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER content_availability_integrity
BEFORE INSERT OR UPDATE OF status,current_version_id,published_version_id,availability_state
ON content_items FOR EACH ROW EXECUTE FUNCTION enforce_content_availability_integrity();

COMMENT ON COLUMN content_items.availability_state IS
  'restricted=editors only, pilot=signed-in limited-operation reading and separately gated AI use, published=formally approved use including AI grounding.';
COMMENT ON COLUMN content_versions.migration_state IS
  'Editorial verification state of migrated source; extracted_needs_review requires review and is AI-eligible only under the organization pilot_content_ai gate.';
