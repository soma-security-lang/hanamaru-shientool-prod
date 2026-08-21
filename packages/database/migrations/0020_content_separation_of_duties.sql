ALTER TABLE content_versions
  ADD COLUMN created_by_membership_id uuid NULL;

ALTER TABLE content_versions
  ADD CONSTRAINT content_version_creator_fk
  FOREIGN KEY(organization_id,created_by_membership_id)
  REFERENCES memberships(organization_id,id)
  ON DELETE RESTRICT;

CREATE INDEX content_versions_creator_idx
  ON content_versions(organization_id,created_by_membership_id,created_at DESC)
  WHERE created_by_membership_id IS NOT NULL;

COMMENT ON COLUMN content_versions.created_by_membership_id IS
  'Manual version author. When approval is enabled, this membership cannot approve its own version.';
