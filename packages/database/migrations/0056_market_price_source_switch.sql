ALTER TABLE market_price_searches
  ADD COLUMN source_provider varchar(30) NOT NULL DEFAULT 'yahoo_scrape'
    CHECK(source_provider IN ('yahoo_scrape','aucfan_api')),
  ADD COLUMN source_limitations_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK(jsonb_typeof(source_limitations_json)='array');

ALTER TABLE market_price_searches
  DROP CONSTRAINT market_price_searches_planner_status_check;
ALTER TABLE market_price_searches
  ADD CONSTRAINT market_price_searches_planner_status_check
    CHECK(planner_status IS NULL OR planner_status IN ('registry_resolved','ai_applied','deterministic_fallback','not_required'));

ALTER TABLE market_price_candidates
  ADD COLUMN source_provider varchar(30) NOT NULL DEFAULT 'yahoo_scrape'
    CHECK(source_provider IN ('yahoo_scrape','aucfan_api')),
  ADD COLUMN ended_on date NULL,
  ADD COLUMN ended_at_precision varchar(20) NOT NULL DEFAULT 'timestamp'
    CHECK(ended_at_precision IN ('timestamp','date'));

ALTER TABLE market_price_candidates
  ALTER COLUMN ended_at DROP NOT NULL,
  ALTER COLUMN canonical_url DROP NOT NULL;
ALTER TABLE market_price_candidates
  ADD CONSTRAINT market_price_candidate_source_precision_check CHECK(
    (source_provider='yahoo_scrape' AND ended_at IS NOT NULL AND ended_on IS NULL AND ended_at_precision='timestamp' AND canonical_url IS NOT NULL)
    OR
    (source_provider='aucfan_api' AND ended_at IS NULL AND ended_on IS NOT NULL AND ended_at_precision='date')
  );

ALTER TABLE market_price_results
  ADD COLUMN source_provider varchar(30) NOT NULL DEFAULT 'yahoo_scrape'
    CHECK(source_provider IN ('yahoo_scrape','aucfan_api')),
  ADD COLUMN source_limitations_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK(jsonb_typeof(source_limitations_json)='array');

ALTER TABLE market_price_search_pages
  ADD COLUMN source_window varchar(20) NOT NULL DEFAULT 'yahoo'
    CHECK(source_window IN ('yahoo','aucfan_new','aucfan_3')),
  ADD COLUMN newest_ended_on date NULL,
  ADD COLUMN oldest_ended_on date NULL;

ALTER TABLE market_price_search_pages
  DROP CONSTRAINT IF EXISTS market_price_search_pages_search_id_page_number_key;
ALTER TABLE market_price_search_pages
  ADD CONSTRAINT market_price_search_pages_search_window_page_key
    UNIQUE(search_id,source_window,page_number);

CREATE INDEX market_price_search_source_history_idx
  ON market_price_searches(organization_id,source_provider,created_at DESC,id DESC);
CREATE INDEX market_price_candidate_yahoo_ended_idx
  ON market_price_candidates(organization_id,search_id,ended_at DESC)
  WHERE source_provider='yahoo_scrape';
CREATE INDEX market_price_candidate_aucfan_ended_idx
  ON market_price_candidates(organization_id,search_id,ended_on DESC)
  WHERE source_provider='aucfan_api';

CREATE OR REPLACE FUNCTION enforce_market_price_candidate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_source varchar(30);
BEGIN
  SELECT source_provider INTO parent_source
    FROM market_price_searches
   WHERE organization_id=NEW.organization_id AND id=NEW.search_id;
  IF parent_source IS NULL OR parent_source<>NEW.source_provider THEN
    RAISE EXCEPTION 'market price candidate provider must match its search';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_price_candidate_source_guard
BEFORE INSERT OR UPDATE OF organization_id,search_id,source_provider ON market_price_candidates
FOR EACH ROW EXECUTE FUNCTION enforce_market_price_candidate_source();

INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
SELECT organization_id,'market_price_aucfan',false,owner_membership_id,'オークファン取得だけを停止'
  FROM feature_flags WHERE flag_key='market_price_search'
ON CONFLICT(organization_id,flag_key) DO NOTHING;

INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
SELECT organization_id,'market_price_comparison',false,owner_membership_id,'取得元比較だけを停止'
  FROM feature_flags WHERE flag_key='market_price_search'
ON CONFLICT(organization_id,flag_key) DO NOTHING;

COMMENT ON COLUMN market_price_searches.source_provider IS 'Acquisition provider. Existing and omitted requests remain yahoo_scrape.';
COMMENT ON COLUMN market_price_candidates.ended_at_precision IS 'Aucfan search responses provide a calendar date only; date must not be presented as an exact timestamp.';
COMMENT ON COLUMN market_price_search_pages.source_window IS 'Independent provider window used for resumable paging. Aucfan uses new and 3 separately.';
