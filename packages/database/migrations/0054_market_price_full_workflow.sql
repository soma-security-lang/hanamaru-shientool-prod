ALTER TABLE prompt_versions DROP CONSTRAINT prompt_versions_purpose_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_purpose_check
  CHECK(purpose IN ('pdf_extract','preparation','review','market_price_search','market_price_identification'));

ALTER TABLE storage_objects DROP CONSTRAINT storage_objects_purpose_check;
ALTER TABLE storage_objects ADD CONSTRAINT storage_objects_purpose_check
  CHECK(purpose IN ('visit_pdf','recording','training_video','market_price_image','transcript_raw','review_artifact','quarantine','export'));

ALTER TABLE market_price_identifications
  ADD COLUMN input_mode varchar(30) NOT NULL DEFAULT 'manual_direct'
    CHECK(input_mode IN ('image_assisted','manual_assisted','manual_direct')),
  ADD COLUMN confirmed_by_membership_id uuid NULL,
  ADD COLUMN confirmed_at timestamptz NULL,
  ADD COLUMN failure_class varchar(100) NULL,
  ADD CONSTRAINT market_price_identification_confirmer_fk
    FOREIGN KEY(organization_id,confirmed_by_membership_id)
    REFERENCES memberships(organization_id,id) ON DELETE RESTRICT;

ALTER TABLE market_price_searches DROP CONSTRAINT market_price_searches_status_check;
ALTER TABLE market_price_searches ADD CONSTRAINT market_price_searches_status_check
  CHECK(status IN ('queued','planning','fetching','normalizing','review_required','ready','partial','blocked','failed','cancelled','confirmed'));
ALTER TABLE market_price_searches
  ADD COLUMN confirmed_by_membership_id uuid NULL,
  ADD COLUMN confirmed_at timestamptz NULL,
  ADD COLUMN cancel_requested_at timestamptz NULL,
  ADD COLUMN result_id uuid NULL,
  ADD CONSTRAINT market_price_search_confirmer_fk
    FOREIGN KEY(organization_id,confirmed_by_membership_id)
    REFERENCES memberships(organization_id,id) ON DELETE RESTRICT;

CREATE TABLE market_price_image_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  identification_id uuid NOT NULL,
  image_id uuid NOT NULL,
  object_name text NOT NULL,
  mime_type varchar(100) NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,identification_id) REFERENCES market_price_identifications(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,image_id)
);

CREATE TABLE market_price_images (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  identification_id uuid NOT NULL,
  storage_object_id uuid NOT NULL UNIQUE,
  status varchar(24) NOT NULL CHECK(status IN ('uploaded','normalizing','ready','failed','deleting','deleted')),
  content_sha256 char(64) NOT NULL,
  width int NULL CHECK(width IS NULL OR width>0),
  height int NULL CHECK(height IS NULL OR height>0),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,identification_id) REFERENCES market_price_identifications(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,storage_object_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(identification_id,content_sha256),
  UNIQUE(organization_id,id)
);

CREATE TABLE market_price_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  search_id uuid NOT NULL,
  snapshot_version int NOT NULL CHECK(snapshot_version>0),
  snapshot_hash char(64) NOT NULL,
  condition_filters_json jsonb NOT NULL CHECK(jsonb_typeof(condition_filters_json)='array'),
  outlier_policy_json jsonb NOT NULL CHECK(jsonb_typeof(outlier_policy_json)='object'),
  coverage_status varchar(20) NOT NULL CHECK(coverage_status IN ('complete','partial')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  candidate_count int NOT NULL CHECK(candidate_count>=0),
  included_count int NOT NULL CHECK(included_count>0),
  minimum_price bigint NOT NULL CHECK(minimum_price>=0),
  median_price_before_outlier_exclusion numeric(14,2) NULL CHECK(median_price_before_outlier_exclusion IS NULL OR median_price_before_outlier_exclusion>=0),
  median_price numeric(14,2) NOT NULL CHECK(median_price>=0),
  maximum_price bigint NOT NULL CHECK(maximum_price>=0),
  exclusion_counts_json jsonb NOT NULL CHECK(jsonb_typeof(exclusion_counts_json)='object'),
  included_candidate_ids jsonb NOT NULL CHECK(jsonb_typeof(included_candidate_ids)='array'),
  confirmed_by_membership_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,search_id) REFERENCES market_price_searches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,confirmed_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(search_id,snapshot_version),
  UNIQUE(organization_id,id)
);

ALTER TABLE market_price_searches
  ADD CONSTRAINT market_price_search_result_fk
  FOREIGN KEY(organization_id,result_id) REFERENCES market_price_results(organization_id,id) ON DELETE RESTRICT;

CREATE INDEX market_price_image_expiry_idx ON market_price_images(organization_id,expires_at,id) WHERE deleted_at IS NULL;
CREATE INDEX market_price_result_history_idx ON market_price_results(organization_id,confirmed_at DESC,id DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['market_price_image_upload_sessions','market_price_images','market_price_results'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;

GRANT SELECT,INSERT,UPDATE ON market_price_image_upload_sessions,market_price_images TO hanamaru_api;
GRANT SELECT,INSERT ON market_price_results TO hanamaru_api;
GRANT SELECT,UPDATE,DELETE ON market_price_image_upload_sessions TO hanamaru_worker;
GRANT SELECT,UPDATE ON market_price_images TO hanamaru_worker;
GRANT SELECT ON market_price_results TO hanamaru_worker;
GRANT SELECT ON market_price_results TO hanamaru_readonly_ops;

CREATE TRIGGER market_price_images_touch BEFORE UPDATE ON market_price_images FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION prevent_market_price_result_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market_price_results are immutable';
END $$;
CREATE TRIGGER market_price_results_immutable BEFORE UPDATE OR DELETE ON market_price_results
FOR EACH ROW EXECUTE FUNCTION prevent_market_price_result_mutation();

COMMENT ON TABLE market_price_results IS 'Immutable confirmed market-price snapshot. Raw Yahoo HTML and AI responses are never stored here.';
COMMENT ON TABLE market_price_images IS 'Private, normalized product images with a hard 24-hour expiry.';
