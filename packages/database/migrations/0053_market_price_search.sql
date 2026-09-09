ALTER TABLE jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check
  CHECK(job_type IN ('pdf_extract','preparation','drive_import','transcribe','manual_transcript','review','market_price_identification','market_price_search','delete','retention_scan'));

ALTER TABLE prompt_versions DROP CONSTRAINT prompt_versions_purpose_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_purpose_check
  CHECK(purpose IN ('pdf_extract','preparation','review','market_price_search'));

ALTER TABLE operational_alerts DROP CONSTRAINT operational_alerts_failure_class_check;
ALTER TABLE operational_alerts ADD CONSTRAINT operational_alerts_failure_class_check
  CHECK(failure_class IN (
    'STT_HEARTBEAT_STALE','STT_LRO_TIMEOUT','RETRY_WAIT_OVERDUE',
    'MODEL_OUTPUT_INVALID','EVIDENCE_INVALID','RETRY_LIMIT_EXCEEDED',
    'MARKET_PRICE_STALLED','MARKET_PRICE_BLOCKED'
  ));

UPDATE roles
   SET capabilities = CASE
     WHEN role_code='assessor' THEN ARRAY(SELECT DISTINCT unnest(capabilities || ARRAY['market_price:search','market_price:read']))
     WHEN role_code='manager' THEN ARRAY(SELECT DISTINCT unnest(capabilities || ARRAY['market_price:search','market_price:read','market_price:manage']))
     WHEN role_code='system_admin' THEN ARRAY(SELECT DISTINCT unnest(capabilities || ARRAY['market_price:manage']))
     ELSE capabilities
   END
 WHERE role_code IN ('assessor','manager','system_admin');

CREATE TABLE market_price_identifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  job_id uuid NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL CHECK(status IN ('draft','analyzing','suggestion_ready','confirmation_required','confirmed','failed','expired')),
  input_redacted jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(input_redacted)='object' AND pg_column_size(input_redacted)<=32768),
  suggestion_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(suggestion_json)='object' AND pg_column_size(suggestion_json)<=131072),
  confirmed_fields_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(confirmed_fields_json)='object' AND pg_column_size(confirmed_fields_json)<=32768),
  model_name varchar(100) NULL,
  prompt_version int NULL CHECK(prompt_version IS NULL OR prompt_version>0),
  expires_at timestamptz NOT NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);

CREATE TABLE market_price_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  identification_id uuid NULL,
  created_by_membership_id uuid NOT NULL,
  job_id uuid NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL CHECK(status IN ('queued','planning','fetching','normalizing','review_required','ready','partial','blocked','failed','cancelled')),
  query_json jsonb NOT NULL CHECK(jsonb_typeof(query_json)='object' AND pg_column_size(query_json)<=32768),
  condition_filters_json jsonb NOT NULL CHECK(jsonb_typeof(condition_filters_json)='array'),
  outlier_policy_json jsonb NOT NULL CHECK(jsonb_typeof(outlier_policy_json)='object'),
  normalized_query_hash char(64) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  period_days int NOT NULL DEFAULT 90 CHECK(period_days=90),
  sort_key varchar(40) NOT NULL DEFAULT 'ENDED_AT_NEWEST' CHECK(sort_key='ENDED_AT_NEWEST'),
  page_size int NOT NULL DEFAULT 100 CHECK(page_size=100),
  max_pages int NOT NULL DEFAULT 20 CHECK(max_pages=20),
  ai_parameter_plan_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(ai_parameter_plan_json)='object' AND pg_column_size(ai_parameter_plan_json)<=32768),
  closed_search_spec_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(closed_search_spec_json)='object' AND pg_column_size(closed_search_spec_json)<=32768),
  query_plan_hash char(64) NULL,
  parameter_registry_version varchar(50) NULL,
  generator_version varchar(50) NULL,
  planner_model varchar(100) NULL,
  planner_prompt_version int NULL CHECK(planner_prompt_version IS NULL OR planner_prompt_version>0),
  planner_status varchar(40) NULL CHECK(planner_status IS NULL OR planner_status IN ('registry_resolved','ai_applied','deterministic_fallback')),
  generated_url_hash char(64) NULL,
  coverage_status varchar(20) NOT NULL DEFAULT 'pending' CHECK(coverage_status IN ('pending','complete','partial','blocked')),
  coverage_oldest_at timestamptz NULL,
  candidate_count int NOT NULL DEFAULT 0 CHECK(candidate_count>=0),
  included_count int NOT NULL DEFAULT 0 CHECK(included_count>=0),
  minimum_price bigint NULL CHECK(minimum_price IS NULL OR minimum_price>=0),
  median_price_before_outlier_exclusion numeric(14,2) NULL CHECK(median_price_before_outlier_exclusion IS NULL OR median_price_before_outlier_exclusion>=0),
  median_price numeric(14,2) NULL CHECK(median_price IS NULL OR median_price>=0),
  maximum_price bigint NULL CHECK(maximum_price IS NULL OR maximum_price>=0),
  exclusion_counts_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(exclusion_counts_json)='object'),
  parser_version varchar(50) NULL,
  failure_class varchar(100) NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(period_start=period_end-interval '90 days'),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,identification_id) REFERENCES market_price_identifications(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);

CREATE TABLE market_price_search_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  search_id uuid NOT NULL,
  page_number int NOT NULL CHECK(page_number BETWEEN 1 AND 20),
  result_offset int NOT NULL CHECK(result_offset=1+((page_number-1)*100)),
  url_hash char(64) NOT NULL,
  http_status int NOT NULL CHECK(http_status BETWEEN 100 AND 599),
  source_count int NOT NULL CHECK(source_count BETWEEN 0 AND 100),
  parsed_count int NOT NULL CHECK(parsed_count BETWEEN 0 AND 100),
  parse_failure_count int NOT NULL DEFAULT 0 CHECK(parse_failure_count BETWEEN 0 AND source_count),
  newest_ended_at timestamptz NULL,
  oldest_ended_at timestamptz NULL,
  response_hash char(64) NULL,
  fetch_duration_ms int NOT NULL CHECK(fetch_duration_ms>=0),
  status varchar(20) NOT NULL CHECK(status IN ('succeeded','blocked','failed')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,search_id) REFERENCES market_price_searches(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(search_id,page_number),
  UNIQUE(organization_id,id)
);

CREATE TABLE market_price_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  search_id uuid NOT NULL,
  source_page_number int NOT NULL CHECK(source_page_number BETWEEN 1 AND 20),
  source_item_id varchar(100) NOT NULL,
  source_type varchar(20) NOT NULL CHECK(source_type IN ('auction','fleamarket')),
  canonical_url text NOT NULL CHECK(length(canonical_url)<=1000),
  title text NOT NULL CHECK(length(title)<=1000),
  closing_price bigint NOT NULL CHECK(closing_price>0),
  ended_at timestamptz NOT NULL,
  condition_label varchar(50) NULL,
  normalized_condition varchar(30) NOT NULL CHECK(normalized_condition IN ('unused','near_unused','good','fair','poor','very_poor','unspecified')),
  condition_matched boolean NOT NULL DEFAULT false,
  tax_display varchar(20) NOT NULL CHECK(tax_display IN ('included','not_included','unknown')),
  match_score numeric(5,4) NOT NULL DEFAULT 0 CHECK(match_score BETWEEN 0 AND 1),
  match_reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(match_reasons)='array'),
  exclusion_reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(exclusion_reasons)='array'),
  condition_group_count int NOT NULL DEFAULT 0 CHECK(condition_group_count>=0),
  condition_median_price numeric(14,2) NULL,
  price_deviation_rate numeric(10,6) NULL,
  iqr_lower_bound numeric(14,2) NULL,
  iqr_upper_bound numeric(14,2) NULL,
  auto_outlier boolean NOT NULL DEFAULT false,
  inclusion_override varchar(10) NULL CHECK(inclusion_override IS NULL OR inclusion_override IN ('include','exclude')),
  included boolean NOT NULL DEFAULT false,
  decision_source varchar(20) NOT NULL DEFAULT 'automatic' CHECK(decision_source IN ('automatic','manual')),
  content_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,search_id) REFERENCES market_price_searches(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(search_id,source_item_id),
  UNIQUE(organization_id,id)
);

CREATE TABLE market_price_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  dimension varchar(20) NOT NULL CHECK(dimension IN ('category','brand')),
  registry_key varchar(150) NOT NULL,
  source_id varchar(32) NOT NULL CHECK(source_id ~ '^[1-9][0-9]{0,18}$'),
  canonical_name varchar(300) NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(aliases)='array'),
  status varchar(20) NOT NULL CHECK(status IN ('CONFIRMED','COMPATIBLE','DEPRECATED')),
  registry_version varchar(50) NOT NULL,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,dimension,registry_key),
  UNIQUE(organization_id,dimension,source_id),
  UNIQUE(organization_id,id)
);

CREATE INDEX market_price_search_history_idx ON market_price_searches(organization_id,created_by_membership_id,created_at DESC,id DESC);
CREATE INDEX market_price_search_cache_idx ON market_price_searches(organization_id,normalized_query_hash,completed_at DESC) WHERE status IN ('ready','partial');
CREATE INDEX market_price_candidate_search_idx ON market_price_candidates(organization_id,search_id,included,ended_at DESC);
CREATE INDEX market_price_mapping_lookup_idx ON market_price_source_mappings(organization_id,dimension,status,canonical_name);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['market_price_identifications','market_price_searches','market_price_search_pages','market_price_candidates','market_price_source_mappings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;

GRANT SELECT,INSERT,UPDATE ON market_price_identifications,market_price_searches,market_price_candidates TO hanamaru_api;
GRANT SELECT ON market_price_search_pages TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON market_price_source_mappings TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON market_price_identifications,market_price_searches,market_price_search_pages,market_price_candidates TO hanamaru_worker;
GRANT SELECT ON market_price_source_mappings,feature_flags,prompt_versions TO hanamaru_worker;
GRANT SELECT ON market_price_searches,market_price_search_pages TO hanamaru_readonly_ops;
GRANT SELECT ON market_price_searches TO hanamaru_worker_system;

CREATE TRIGGER market_price_identifications_touch BEFORE UPDATE ON market_price_identifications FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER market_price_searches_touch BEFORE UPDATE ON market_price_searches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER market_price_candidates_touch BEFORE UPDATE ON market_price_candidates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER market_price_source_mappings_touch BEFORE UPDATE ON market_price_source_mappings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE market_price_search_pages IS 'Resumable, content-free checkpoints for newest-first Yahoo closed-search pages.';
COMMENT ON COLUMN market_price_searches.closed_search_spec_json IS 'Validated semantic query specification. Arbitrary raw Yahoo parameters are prohibited.';
COMMENT ON COLUMN market_price_searches.generated_url_hash IS 'SHA-256 only; complete Yahoo search URLs are not retained as operational metadata.';
