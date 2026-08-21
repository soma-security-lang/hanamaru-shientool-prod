CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_type varchar(30) NOT NULL CHECK(content_type IN ('talk','flow','glossary','price','manual','legal','video','roleplay')),
  stable_key varchar(150) NOT NULL, title varchar(300) NOT NULL, category varchar(200) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL CHECK(status IN ('draft','published','retired')), current_version_id uuid NULL,
  display_order int NOT NULL DEFAULT 0, search_text text NOT NULL DEFAULT '', deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,content_type,stable_key), UNIQUE(organization_id,id)
);
CREATE TABLE content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_item_id uuid NOT NULL, version int NOT NULL CHECK(version>0), body_json jsonb NOT NULL CHECK(pg_column_size(body_json)<=524288),
  source_type varchar(30) NOT NULL CHECK(source_type IN ('poc','migration','manual','import')), source_reference varchar(500) NULL,
  source_hash char(64) NOT NULL, review_status varchar(20) NOT NULL CHECK(review_status IN ('draft','in_review','approved','rejected')),
  change_summary text NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL, published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(content_item_id,version), UNIQUE(organization_id,id)
);
ALTER TABLE content_items ADD CONSTRAINT current_content_version_fk FOREIGN KEY(current_version_id) REFERENCES content_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE OR REPLACE FUNCTION immutable_published_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.published_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published content version is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER content_version_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION immutable_published_content();
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL, name_normalized varchar(100) NOT NULL, UNIQUE(organization_id,name_normalized), UNIQUE(organization_id,id)
);
CREATE TABLE content_tags (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, content_item_id uuid NOT NULL,
  tag_id uuid NOT NULL, PRIMARY KEY(content_item_id,tag_id),
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,tag_id) REFERENCES tags(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, content_item_id uuid NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('not_started','in_progress','completed')),
  started_at timestamptz NULL, completed_at timestamptz NULL, self_note text NULL CHECK(length(self_note)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,membership_id,content_item_id)
);
