-- Additive receipt workflow. No existing expense, identity, branch permission or flag is rewritten.
-- Enabling collection requires an explicitly approved retention policy; there is no default retention.
CREATE TABLE expense_receipt_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  retention_days integer NULL CHECK(retention_days BETWEEN 1 AND 3650),
  approved_by_membership_id uuid NULL,
  approved_at timestamptz NULL,
  FOREIGN KEY(organization_id,approved_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  CHECK(NOT enabled OR (retention_days IS NOT NULL AND approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE expense_receipt_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  day_id uuid NOT NULL,
  owner_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,day_id) REFERENCES expense_days(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,owner_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE expense_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','uploaded','reading','review_required','failed','registered','excluded','deleting','deleted')),
  job_id uuid NULL,
  reading_json jsonb NULL CHECK(reading_json IS NULL OR (jsonb_typeof(reading_json)='object' AND pg_column_size(reading_json)<=16384)),
  review_json jsonb NULL CHECK(review_json IS NULL OR (jsonb_typeof(review_json)='object' AND pg_column_size(review_json)<=8192)),
  failure_class varchar(60) NULL,
  excluded_reason varchar(500) NULL,
  registered_item_id uuid NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,registered_item_id),
  FOREIGN KEY(organization_id,batch_id) REFERENCES expense_receipt_batches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,registered_item_id) REFERENCES expense_items(organization_id,id) ON DELETE RESTRICT,
  CHECK((status='registered' AND registered_item_id IS NOT NULL) OR status<>'registered')
);
CREATE TABLE expense_receipt_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  object_name text NOT NULL,
  declared_mime_type varchar(30) NOT NULL CHECK(declared_mime_type IN ('image/jpeg','image/png','image/webp')),
  declared_size_bytes bigint NOT NULL CHECK(declared_size_bytes BETWEEN 12 AND 10485760),
  content_sha256 char(64) NOT NULL CHECK(content_sha256~'^[a-f0-9]{64}$'),
  original_storage_id uuid NULL,
  normalized_storage_id uuid NULL,
  upload_expires_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,receipt_id) REFERENCES expense_receipts(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,original_storage_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,normalized_storage_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX expense_receipt_batch_day ON expense_receipt_batches(organization_id,day_id,created_at);
CREATE INDEX expense_receipt_batch_items ON expense_receipts(organization_id,batch_id,created_at);
CREATE INDEX expense_receipt_images_receipt ON expense_receipt_images(organization_id,receipt_id,created_at);
CREATE INDEX expense_receipt_images_digest ON expense_receipt_images(organization_id,content_sha256);
CREATE TRIGGER expense_receipts_touch BEFORE UPDATE ON expense_receipts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['expense_receipt_policies','expense_receipt_batches','expense_receipts','expense_receipt_images'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;
GRANT SELECT ON expense_receipt_policies TO hanamaru_api,hanamaru_worker;
GRANT SELECT,INSERT ON expense_receipt_batches TO hanamaru_api;
GRANT SELECT ON expense_receipt_batches TO hanamaru_worker;
GRANT SELECT,INSERT,UPDATE ON expense_receipts,expense_receipt_images TO hanamaru_api,hanamaru_worker;

-- Recheck only the current job requester; do not grant the Worker bulk access to user records.
CREATE FUNCTION expense_receipt_actor_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
    JOIN organizations o ON o.id=m.organization_id
    JOIN role_assignments a ON a.organization_id=m.organization_id AND a.membership_id=m.id
    JOIN roles r ON r.id=a.role_id
    WHERE m.organization_id=app_org_id() AND m.id=nullif(current_setting('app.membership_id',true),'')::uuid
      AND m.status='active' AND u.status='active' AND o.status='active'
      AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
      AND a.scope_type='self' AND a.scope_id=m.id AND 'visit:self'=ANY(r.capabilities)
      AND NOT EXISTS (SELECT 1 FROM role_assignments excluded JOIN roles er ON er.id=excluded.role_id
        WHERE excluded.organization_id=m.organization_id AND excluded.membership_id=m.id AND er.role_code='system_admin'
          AND excluded.valid_from<=now() AND (excluded.valid_until IS NULL OR excluded.valid_until>now()))
  )
$$;
REVOKE ALL ON FUNCTION expense_receipt_actor_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expense_receipt_actor_active() TO hanamaru_worker;

-- Operations may see only current job identifiers, never receipt text, images or amounts.
CREATE FUNCTION expense_receipt_current_jobs() RETURNS TABLE(job_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT r.job_id FROM expense_receipts r WHERE r.job_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION expense_receipt_current_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expense_receipt_current_jobs() TO hanamaru_worker_system;

CREATE FUNCTION guard_expense_receipt_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('deleting','deleted') AND NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
    RAISE EXCEPTION 'receipt deletion is already fenced; hold cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_receipt_hold_fence BEFORE UPDATE ON expense_receipts FOR EACH ROW EXECUTE FUNCTION guard_expense_receipt_hold();

ALTER TABLE storage_objects DROP CONSTRAINT storage_objects_purpose_check;
ALTER TABLE storage_objects ADD CONSTRAINT storage_objects_purpose_check CHECK(purpose IN ('visit_pdf','recording','training_video','market_price_image','expense_receipt_original','expense_receipt_reading','transcript_raw','review_artifact','quarantine','export'));
ALTER TABLE jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check CHECK(job_type IN ('pdf_extract','preparation','drive_import','transcribe','manual_transcript','review','market_price_identification','market_price_search','market_price_ebay_search','expense_receipt_reading','delete','retention_scan'));
ALTER TABLE expense_items DROP CONSTRAINT expense_items_entry_source_check;
ALTER TABLE expense_items ADD CONSTRAINT expense_items_entry_source_check CHECK(entry_source IN ('manual','synthetic_ocr','receipt_ocr'));
ALTER TABLE expense_items DROP CONSTRAINT expense_items_receipt_status_check;
ALTER TABLE expense_items ADD CONSTRAINT expense_items_receipt_status_check CHECK(receipt_status IN ('not_attached','reference_pending','attached_unapproved'));
