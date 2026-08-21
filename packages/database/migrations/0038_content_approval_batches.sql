CREATE TABLE content_approval_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  content_type varchar(30) NOT NULL CHECK(content_type IN ('talk','flow','glossary','price','manual','legal','video','roleplay')),
  category varchar(200) NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('in_review','approved','rejected','invalidated')),
  item_count int NOT NULL CHECK(item_count>0),
  required_approvals int NOT NULL CHECK(required_approvals IN (1,2)),
  snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
  submitted_by_membership_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,submitted_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);

CREATE TABLE content_approval_batch_items (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  version int NOT NULL CHECK(version>0),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(batch_id,content_version_id),
  FOREIGN KEY(organization_id,batch_id) REFERENCES content_approval_batches(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,content_version_id) REFERENCES content_versions(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE content_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  decision varchar(20) NOT NULL CHECK(decision IN ('approved','rejected')),
  decided_by_membership_id uuid NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,batch_id) REFERENCES content_approval_batches(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,decided_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(batch_id,decided_by_membership_id)
);

CREATE UNIQUE INDEX one_open_content_approval_batch
  ON content_approval_batches(organization_id,content_type,category)
  WHERE status='in_review';
CREATE INDEX content_approval_batches_queue
  ON content_approval_batches(organization_id,status,submitted_at,id);
CREATE INDEX content_approval_batch_items_item
  ON content_approval_batch_items(organization_id,content_item_id,content_version_id);

ALTER TABLE content_approval_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approval_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON content_approval_batches
  USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
ALTER TABLE content_approval_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approval_batch_items FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON content_approval_batch_items
  USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
ALTER TABLE content_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approval_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON content_approval_decisions
  USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());

GRANT SELECT,INSERT,UPDATE ON content_approval_batches TO hanamaru_api;
GRANT SELECT,INSERT ON content_approval_batch_items,content_approval_decisions TO hanamaru_api;

COMMENT ON TABLE content_approval_batches IS 'Immutable category/version snapshot for human content approval.';
COMMENT ON COLUMN content_approval_batches.snapshot_hash IS 'SHA-256 of sorted content version IDs, versions, and source hashes.';
