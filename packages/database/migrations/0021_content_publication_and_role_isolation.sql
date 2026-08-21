-- Keep the published content pointer stable while an editor prepares a draft,
-- and enforce the system administrator as an isolated out-of-band role.
ALTER TABLE content_items ADD COLUMN published_version_id uuid NULL;
ALTER TABLE content_items ADD CONSTRAINT published_content_version_fk
  FOREIGN KEY(published_version_id) REFERENCES content_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE content_version_metadata (
  content_version_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_item_id uuid NOT NULL,
  title varchar(300) NOT NULL,
  category varchar(200) NOT NULL DEFAULT '',
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,content_version_id) REFERENCES content_versions(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE CASCADE,
  UNIQUE(organization_id,content_version_id)
);

INSERT INTO content_version_metadata(content_version_id,organization_id,content_item_id,title,category,search_text)
SELECT cv.id,cv.organization_id,cv.content_item_id,c.title,c.category,c.search_text
  FROM content_versions cv JOIN content_items c ON c.id=cv.content_item_id;

UPDATE content_items SET published_version_id=current_version_id WHERE status='published';
-- A populated upgrade queues a deferred constraint-trigger event for every
-- backfilled pointer. PostgreSQL will not CREATE INDEX on content_items while
-- those events are pending, so validate this constraint before the table DDL.
SET CONSTRAINTS published_content_version_fk IMMEDIATE;
CREATE INDEX content_published_version_idx ON content_items(organization_id,published_version_id) WHERE published_version_id IS NOT NULL;
CREATE INDEX content_version_metadata_item_idx ON content_version_metadata(organization_id,content_item_id,created_at DESC);

ALTER TABLE content_version_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_content_version_metadata ON content_version_metadata
  USING (organization_id=current_setting('app.organization_id',true)::uuid)
  WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON content_version_metadata TO hanamaru_api;
GRANT SELECT ON content_version_metadata TO hanamaru_worker;

CREATE OR REPLACE FUNCTION enforce_system_admin_role_isolation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text;
BEGIN
  SELECT role_code INTO v_code FROM roles WHERE id=NEW.role_id;
  IF v_code='system_admin' AND EXISTS(
    SELECT 1 FROM role_assignments ra JOIN roles r ON r.id=ra.role_id
     WHERE ra.organization_id=NEW.organization_id AND ra.membership_id=NEW.membership_id
       AND ra.id IS DISTINCT FROM NEW.id AND r.role_code<>'system_admin'
  ) THEN RAISE EXCEPTION 'system_admin must be the only role'; END IF;
  IF v_code<>'system_admin' AND EXISTS(
    SELECT 1 FROM role_assignments ra JOIN roles r ON r.id=ra.role_id
     WHERE ra.organization_id=NEW.organization_id AND ra.membership_id=NEW.membership_id
       AND ra.id IS DISTINCT FROM NEW.id AND r.role_code='system_admin'
  ) THEN RAISE EXCEPTION 'system_admin must be the only role'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER system_admin_role_isolation BEFORE INSERT OR UPDATE ON role_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_system_admin_role_isolation();

COMMENT ON COLUMN content_items.current_version_id IS 'Latest working version, including drafts.';
COMMENT ON COLUMN content_items.published_version_id IS 'Only the immutable version visible to ordinary users.';
