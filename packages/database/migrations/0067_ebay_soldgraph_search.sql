-- Additive eBay storage. Existing JPY/90-day searches remain untouched.
-- Account settings are operator-managed; no credentials or raw provider bodies.
-- No production duration is guessed. An operator must record an approved policy.
CREATE TABLE ebay_retention_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  content_days integer NOT NULL CHECK(content_days BETWEEN 1 AND 3650),
  approved_at timestamptz NOT NULL,
  approved_by_membership_id uuid NOT NULL,
  FOREIGN KEY(organization_id,approved_by_membership_id) REFERENCES memberships(organization_id,id)
);
REVOKE ALL ON ebay_retention_policies FROM PUBLIC,hanamaru_api,hanamaru_worker,hanamaru_api_system,hanamaru_worker_system;
ALTER TABLE ebay_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_retention_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON ebay_retention_policies USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
CREATE FUNCTION ebay_retention_configured() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.ebay_retention_policies WHERE organization_id=public.app_org_id() AND approved_at<=now())
$$;
REVOKE ALL ON FUNCTION ebay_retention_configured() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ebay_retention_configured() TO hanamaru_api;

CREATE TABLE soldgraph_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key varchar(100) NOT NULL UNIQUE,
  execution_mode varchar(24) NOT NULL DEFAULT 'emergency_stop'
    CHECK(execution_mode IN ('enabled','reconcile_only','emergency_stop')),
  credit_budget integer NOT NULL DEFAULT 0 CHECK(credit_budget>=0),
  pending_limit integer NOT NULL DEFAULT 1 CHECK(pending_limit BETWEEN 1 AND 200),
  calls_per_minute integer NOT NULL DEFAULT 60 CHECK(calls_per_minute BETWEEN 1 AND 60),
  usage_checked_at timestamptz NULL,
  usage_remaining integer NULL CHECK(usage_remaining>=0),
  usage_window_json jsonb NULL CHECK(jsonb_typeof(usage_window_json)='object'),
  usage_accounted_charged bigint NOT NULL DEFAULT 0 CHECK(usage_accounted_charged>=0),
  allow_extra_requests boolean NOT NULL DEFAULT false,
  usage_lease_owner uuid NULL, usage_lease_until timestamptz NULL,
  lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ebay_market_price_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL, created_by_membership_id uuid NOT NULL,
  identification_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES soldgraph_accounts(id),
  acquisition_mode varchar(10) NOT NULL DEFAULT 'latest' CHECK(acquisition_mode IN ('reuse','latest')),
  status varchar(30) NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','planning','fetching','normalizing','review_required','ready','partial','blocked','failed','cancelled','confirmed')),
  plan_json jsonb NOT NULL CHECK(jsonb_typeof(plan_json)='object' AND pg_column_size(plan_json)<=32768),
  plan_hash varchar(64) NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  product_basis_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(product_basis_json)='object' AND pg_column_size(product_basis_json)<=8192),
  exclusion_keywords_json jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(exclusion_keywords_json)='array'),
  outlier_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK(outlier_percent>0 AND outlier_percent<=100),
  period_mode varchar(20) NOT NULL DEFAULT 'source_sample' CHECK(period_mode='source_sample'),
  cancel_requested_at timestamptz NULL, content_purged_at timestamptz NULL,
  failure_class varchar(60) NULL, lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id),
  FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES memberships(organization_id,id),
  FOREIGN KEY(organization_id,identification_id) REFERENCES market_price_identifications(organization_id,id)
);

-- Operator-approved budgets, separate from provider rolling/one-time allowance.
-- Runtime APIs cannot inspect or change another organization's spending policy.
CREATE TABLE soldgraph_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES soldgraph_accounts(id),
  scope_type varchar(16) NOT NULL CHECK(scope_type IN ('account','organization','membership')),
  organization_id uuid NULL REFERENCES organizations(id), membership_id uuid NULL,
  period_kind varchar(20) NOT NULL CHECK(period_kind IN ('lifetime','rolling_30_days','calendar_month')),
  calendar_timezone varchar(20) NOT NULL DEFAULT 'Asia/Tokyo' CHECK(calendar_timezone IN ('UTC','Asia/Tokyo')),
  credit_limit integer NOT NULL DEFAULT 0 CHECK(credit_limit>=0),
  valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NULL,
  CHECK(valid_until IS NULL OR valid_until>valid_from),
  CHECK((scope_type='account' AND organization_id IS NULL AND membership_id IS NULL)
    OR (scope_type='organization' AND organization_id IS NOT NULL AND membership_id IS NULL)
    OR (scope_type='membership' AND organization_id IS NOT NULL AND membership_id IS NOT NULL)),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id)
);
CREATE UNIQUE INDEX soldgraph_budget_scope ON soldgraph_budgets(account_id,scope_type,
  coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(membership_id,'00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE soldgraph_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE soldgraph_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON soldgraph_budgets USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());

CREATE TABLE ebay_market_price_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, search_id uuid NOT NULL,
  market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')),
  status varchar(24) NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','pending','normalizing','complete','failed','blocked','cancelled')),
  next_page integer NULL CHECK(next_page BETWEEN 2 AND 11),
  failure_class varchar(60) NULL, lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,search_id,market),
  UNIQUE(organization_id,id,search_id,market),
  FOREIGN KEY(organization_id,search_id) REFERENCES ebay_market_price_searches(organization_id,id)
);

CREATE TABLE ebay_market_price_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  search_id uuid NOT NULL, run_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES soldgraph_accounts(id),
  market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')),
  page_number integer NOT NULL CHECK(page_number BETWEEN 1 AND 10),
  attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0),
  operation_key varchar(67) NOT NULL UNIQUE CHECK(operation_key ~ '^sg-[a-f0-9]{64}$'),
  request_json jsonb NOT NULL CHECK(jsonb_typeof(request_json)='object' AND pg_column_size(request_json)<=32768),
  request_id varchar(200) NULL CHECK(request_id ~ '^[A-Za-z0-9_-]+$'),
  cache_from_page_id uuid NULL,
  state varchar(24) NOT NULL DEFAULT 'reserved'
    CHECK(state IN ('reserved','dispatching','pending','complete','failed','unknown','parse_failed','cancelled','blocked','purged')),
  credit_state varchar(16) NOT NULL DEFAULT 'reserved'
    CHECK(credit_state IN ('reserved','pending','charged','released','unknown')),
  credits smallint NULL CHECK(credits IN (0,1)),
  charged_at timestamptz NULL,
  failure_class varchar(60) NULL,
  retry_not_before timestamptz NULL,
  normalized_result_json jsonb NULL CHECK(jsonb_typeof(normalized_result_json)='object' AND pg_column_size(normalized_result_json)<=2097152),
  response_hash varchar(64) NULL CHECK(response_hash ~ '^[a-f0-9]{64}$'),
  parser_version varchar(60) NULL,
  processing_version varchar(60) NULL,
  checkpoint_version bigint NOT NULL DEFAULT 0 CHECK(checkpoint_version>=0),
  lease_owner uuid NULL, lease_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,search_id,market,page_number,attempt),
  UNIQUE(organization_id,id,search_id,market),
  UNIQUE(account_id,request_id),
  FOREIGN KEY(organization_id,search_id) REFERENCES ebay_market_price_searches(organization_id,id),
  FOREIGN KEY(organization_id,run_id,search_id,market) REFERENCES ebay_market_price_runs(organization_id,id,search_id,market),
  FOREIGN KEY(organization_id,cache_from_page_id) REFERENCES ebay_market_price_pages(organization_id,id),
  CHECK((credit_state='charged' AND credits=1) OR (credit_state='released' AND credits=0)
    OR (credit_state IN ('reserved','pending','unknown') AND credits IS NULL)),
  CHECK(state<>'complete' OR normalized_result_json IS NOT NULL),
  CHECK(state NOT IN ('pending','parse_failed','complete','failed') OR request_id IS NOT NULL OR (state='complete' AND cache_from_page_id IS NOT NULL)),
  CHECK(cache_from_page_id IS NULL OR (state='complete' AND credit_state='released' AND credits=0 AND request_id IS NULL AND parser_version IS NOT NULL))
);

CREATE FUNCTION preserve_soldgraph_charge_time() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.charged_at IS NOT NULL THEN NEW.charged_at:=OLD.charged_at;
  ELSIF NEW.credit_state='charged' THEN NEW.charged_at:=clock_timestamp();
  ELSE NEW.charged_at:=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER soldgraph_charge_time BEFORE INSERT OR UPDATE ON ebay_market_price_pages
  FOR EACH ROW EXECUTE FUNCTION preserve_soldgraph_charge_time();

CREATE TABLE ebay_market_price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  search_id uuid NOT NULL, page_id uuid NOT NULL,
  market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')),
  observation_key varchar(200) NOT NULL,
  source_item_id varchar(15) NULL CHECK(source_item_id ~ '^[0-9]{9,15}$'),
  observation_json jsonb NOT NULL CHECK(jsonb_typeof(observation_json)='object' AND pg_column_size(observation_json)<=32768),
  manual_decision varchar(16) NOT NULL DEFAULT 'default' CHECK(manual_decision IN ('default','include','exclude')),
  decision_reason varchar(1000) NULL,
  changed_by_membership_id uuid NULL,
  lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,search_id,market,observation_key),
  FOREIGN KEY(organization_id,search_id) REFERENCES ebay_market_price_searches(organization_id,id),
  FOREIGN KEY(organization_id,page_id,search_id,market) REFERENCES ebay_market_price_pages(organization_id,id,search_id,market),
  FOREIGN KEY(organization_id,changed_by_membership_id) REFERENCES memberships(organization_id,id)
);

CREATE TABLE ebay_market_price_item_decisions (
  organization_id uuid NOT NULL, search_id uuid NOT NULL,
  source_item_id varchar(15) NOT NULL CHECK(source_item_id ~ '^[0-9]{9,15}$'),
  excluded boolean NOT NULL, reason varchar(1000) NOT NULL,
  changed_by_membership_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,search_id,source_item_id),
  FOREIGN KEY(organization_id,search_id) REFERENCES ebay_market_price_searches(organization_id,id),
  FOREIGN KEY(organization_id,changed_by_membership_id) REFERENCES memberships(organization_id,id)
);

CREATE TABLE ebay_market_price_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, search_id uuid NOT NULL,
  snapshot_version integer NOT NULL CHECK(snapshot_version>0),
  snapshot_json jsonb NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND pg_column_size(snapshot_json)<=2097152),
  snapshot_hash varchar(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  confirmed_by_membership_id uuid NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,search_id,snapshot_version),
  FOREIGN KEY(organization_id,search_id) REFERENCES ebay_market_price_searches(organization_id,id),
  FOREIGN KEY(organization_id,confirmed_by_membership_id) REFERENCES memberships(organization_id,id)
);

-- Global account call/budget coordination is Worker-system only; no product data.
CREATE TABLE soldgraph_account_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES soldgraph_accounts(id),
  called_at timestamptz NOT NULL DEFAULT now(), operation_key varchar(67) NULL,
  call_type varchar(10) NOT NULL CHECK(call_type IN ('submit','poll','usage'))
);
CREATE INDEX soldgraph_account_calls_window ON soldgraph_account_calls(account_id,called_at DESC);
CREATE INDEX ebay_search_history ON ebay_market_price_searches(organization_id,created_by_membership_id,created_at DESC,id);
CREATE INDEX ebay_page_resume ON ebay_market_price_pages(organization_id,state,updated_at);
CREATE INDEX ebay_page_account_budget ON ebay_market_price_pages(account_id,credit_state);

-- Serializes reservations across organizations without granting API global ledger access.
-- The budget is a conservative operator-approved lifetime ceiling until usage windows
-- are reconciled explicitly; it is never reset from a guessed billing date.
CREATE FUNCTION assert_soldgraph_reservation(p_search uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.soldgraph_accounts%ROWTYPE; s public.ebay_market_price_searches%ROWTYPE; held bigint;
  b public.soldgraph_budgets%ROWTYPE; boundary timestamptz; checked integer:=0;
BEGIN
  SELECT * INTO s FROM public.ebay_market_price_searches
    WHERE id=p_search AND organization_id=public.app_org_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLDGRAPH_RESERVATION_SCOPE_DENIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships m
    JOIN public.role_assignments ra ON ra.organization_id=m.organization_id AND ra.membership_id=m.id
    JOIN public.roles r ON r.id=ra.role_id
    WHERE m.organization_id=s.organization_id AND m.id=nullif(current_setting('app.membership_id',true),'')::uuid
      AND m.status='active' AND ra.valid_from<=now() AND (ra.valid_until IS NULL OR ra.valid_until>now())
      AND 'market_price:search'=ANY(r.capabilities)
      AND ((ra.scope_type='organization' AND ra.scope_id=s.organization_id)
        OR (ra.scope_type='branch' AND ra.scope_id=s.branch_id)
        OR (ra.scope_type='self' AND ra.scope_id=m.id AND s.created_by_membership_id=m.id)))
    OR EXISTS(SELECT 1 FROM public.role_assignments ra JOIN public.roles r ON r.id=ra.role_id
      WHERE ra.organization_id=s.organization_id AND ra.membership_id=nullif(current_setting('app.membership_id',true),'')::uuid
        AND r.role_code='system_admin' AND ra.valid_from<=now() AND (ra.valid_until IS NULL OR ra.valid_until>now()))
    THEN RAISE EXCEPTION 'SOLDGRAPH_RESERVATION_SCOPE_DENIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE organization_id=s.organization_id
    AND flag_key='market_price_ebay' AND enabled AND (expires_at IS NULL OR expires_at>now()))
    THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
  IF s.content_purged_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.ebay_retention_policies
    WHERE organization_id=s.organization_id AND approved_at<=now())
    THEN RAISE EXCEPTION 'SOLDGRAPH_RETENTION_UNCONFIGURED'; END IF;
  SELECT * INTO a FROM public.soldgraph_accounts WHERE id=s.account_id FOR NO KEY UPDATE;
  IF NOT FOUND OR a.execution_mode<>'enabled' THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
  IF a.usage_lease_until>now() THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_UNKNOWN'; END IF;
  IF a.usage_checked_at IS NULL OR a.usage_checked_at<now()-interval '15 minutes'
    OR a.usage_checked_at>now() OR a.usage_remaining IS NULL OR a.usage_window_json IS NULL
    THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_UNKNOWN'; END IF;
  SELECT COALESCE(sum(CASE WHEN credit_state='released' THEN 0
    WHEN credit_state='charged' THEN credits ELSE 1 END),0) INTO held
    FROM public.ebay_market_price_pages WHERE account_id=a.id;
  IF held>a.credit_budget OR greatest(0,held-a.usage_accounted_charged)>a.usage_remaining THEN RAISE EXCEPTION 'SOLDGRAPH_BUDGET_EXCEEDED'; END IF;
  FOR b IN SELECT * FROM public.soldgraph_budgets WHERE account_id=a.id AND valid_from<=now()
    AND (valid_until IS NULL OR valid_until>now())
    AND (scope_type='account' OR (organization_id=s.organization_id AND
      (scope_type='organization' OR membership_id=s.created_by_membership_id))) FOR SHARE LOOP
    checked:=checked+1;
    boundary:=CASE b.period_kind WHEN 'rolling_30_days' THEN now()-interval '30 days'
      WHEN 'calendar_month' THEN date_trunc('month',now() AT TIME ZONE b.calendar_timezone) AT TIME ZONE b.calendar_timezone ELSE '-infinity'::timestamptz END;
    SELECT coalesce(sum(CASE WHEN p.credit_state='charged' THEN p.credits ELSE 1 END),0) INTO held
      FROM public.ebay_market_price_pages p JOIN public.ebay_market_price_searches owner ON owner.id=p.search_id
      WHERE p.account_id=a.id AND p.credit_state<>'released'
        AND (p.credit_state<>'charged' OR p.charged_at IS NULL OR p.charged_at>=boundary)
        AND (b.scope_type='account' OR (p.organization_id=b.organization_id AND
          (b.scope_type='organization' OR owner.created_by_membership_id=b.membership_id)));
    IF held>b.credit_limit THEN RAISE EXCEPTION 'SOLDGRAPH_BUDGET_EXCEEDED'; END IF;
  END LOOP;
  IF checked<>3 THEN RAISE EXCEPTION 'SOLDGRAPH_BUDGET_EXCEEDED'; END IF;
END $$;
REVOKE ALL ON FUNCTION assert_soldgraph_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_soldgraph_reservation(uuid) TO hanamaru_api;

-- This gate only authorizes rechecking an existing request. It never enables an
-- account or reserves credits; product-level scope is enforced by the API first.
CREATE FUNCTION assert_soldgraph_resume(p_search uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.ebay_market_price_searches%ROWTYPE; mode text;
BEGIN
  SELECT * INTO s FROM public.ebay_market_price_searches WHERE id=p_search AND organization_id=public.app_org_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLDGRAPH_RESUME_SCOPE_DENIED'; END IF;
  IF (SELECT count(*) FROM public.feature_flags WHERE organization_id=s.organization_id
    AND flag_key IN ('market_price_search','market_price_ebay') AND enabled
    AND (expires_at IS NULL OR expires_at>now()))<>2 THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
  SELECT execution_mode INTO mode FROM public.soldgraph_accounts WHERE id=s.account_id FOR SHARE;
  IF NOT FOUND OR mode<>'enabled' THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
END $$;
REVOKE ALL ON FUNCTION assert_soldgraph_resume(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_soldgraph_resume(uuid) TO hanamaru_api;

CREATE FUNCTION admit_soldgraph_call(p_operation text,p_owner uuid,p_kind text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ebay_market_price_pages%ROWTYPE; a public.soldgraph_accounts%ROWTYPE; mode text; count_calls integer;
BEGIN
  IF p_kind NOT IN ('submit','poll') THEN RAISE EXCEPTION 'SOLDGRAPH_CALL_INVALID'; END IF;
  SELECT * INTO p FROM public.ebay_market_price_pages WHERE operation_key=p_operation
    AND lease_owner=p_owner AND lease_until>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLDGRAPH_CHECKPOINT_LEASE_REQUIRED'; END IF;
  SELECT * INTO a FROM public.soldgraph_accounts WHERE id=p.account_id FOR NO KEY UPDATE;
  IF a.usage_lease_until>now() THEN RAISE EXCEPTION 'SOLDGRAPH_RATE_LIMIT'; END IF;
  mode:=a.execution_mode;
  IF EXISTS(SELECT 1 FROM public.ebay_market_price_searches WHERE id=p.search_id
    AND organization_id=p.organization_id AND cancel_requested_at IS NOT NULL)
    AND mode='enabled' THEN mode:='reconcile_only'; END IF;
  IF (SELECT count(*) FROM public.feature_flags WHERE organization_id=p.organization_id
    AND flag_key IN ('market_price_search','market_price_ebay') AND enabled AND (expires_at IS NULL OR expires_at>now()))<>2
    AND mode='enabled' THEN mode:='reconcile_only'; END IF;
  -- Recheck at dispatch, not only reservation: an operator can withdraw the
  -- approved content policy while a job is queued or between market pages.
  IF (NOT EXISTS(SELECT 1 FROM public.ebay_retention_policies WHERE organization_id=p.organization_id AND approved_at<=now())
    OR EXISTS(SELECT 1 FROM public.ebay_market_price_searches WHERE id=p.search_id AND content_purged_at IS NOT NULL))
    AND mode='enabled' THEN mode:='reconcile_only'; END IF;
  IF mode='emergency_stop' OR (mode='reconcile_only' AND (p_kind='submit' OR p.request_id IS NULL)) THEN RETURN 'emergency_stop'; END IF;
  IF (p_kind='submit' AND p.request_id IS NOT NULL) OR (p_kind='poll' AND p.request_id IS NULL) THEN RAISE EXCEPTION 'SOLDGRAPH_CALL_INVALID'; END IF;
  SELECT count(*) INTO count_calls FROM public.soldgraph_account_calls WHERE account_id=a.id AND called_at>now()-interval '1 minute';
  IF count_calls>=a.calls_per_minute THEN RAISE EXCEPTION 'SOLDGRAPH_RATE_LIMIT'; END IF;
  IF p_kind='submit' AND p.state='reserved' AND (SELECT count(*) FROM public.ebay_market_price_pages
    WHERE account_id=a.id AND state IN ('dispatching','pending','unknown') AND credits IS NULL AND operation_key<>p_operation)>=a.pending_limit
    THEN RAISE EXCEPTION 'SOLDGRAPH_PENDING_LIMIT'; END IF;
  INSERT INTO public.soldgraph_account_calls(account_id,operation_key,call_type) VALUES(a.id,p_operation,p_kind);
  RETURN mode;
END $$;
REVOKE ALL ON FUNCTION admit_soldgraph_call(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admit_soldgraph_call(text,uuid,text) TO hanamaru_worker_system;

-- Final publication is serialized with operator account/flag updates. This function
-- exposes only permission, not the shared account or another tenant's ledger.
CREATE FUNCTION soldgraph_publication_allowed(p_operation text,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ebay_market_price_pages%ROWTYPE; mode text; permitted integer; retained integer;
BEGIN
  SELECT * INTO p FROM public.ebay_market_price_pages WHERE operation_key=p_operation
    AND organization_id=public.app_org_id() AND lease_owner=p_owner AND lease_until>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLDGRAPH_CHECKPOINT_LEASE_REQUIRED'; END IF;
  SELECT execution_mode INTO mode FROM public.soldgraph_accounts WHERE id=p.account_id FOR SHARE;
  IF NOT FOUND OR mode<>'enabled' THEN RETURN false; END IF;
  SELECT 1 INTO retained FROM public.ebay_retention_policies
    WHERE organization_id=p.organization_id AND approved_at<=now() FOR SHARE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.ebay_market_price_searches WHERE id=p.search_id AND content_purged_at IS NOT NULL) THEN RETURN false; END IF;
  SELECT count(*) INTO permitted FROM (SELECT flag_key FROM public.feature_flags
    WHERE organization_id=p.organization_id AND flag_key IN ('market_price_search','market_price_ebay')
      AND enabled AND (expires_at IS NULL OR expires_at>now()) FOR SHARE) flags;
  RETURN permitted=2;
END $$;
REVOKE ALL ON FUNCTION soldgraph_publication_allowed(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soldgraph_publication_allowed(text,uuid) TO hanamaru_worker;

-- A bounded lease closes new admissions during usage I/O, outside DB transactions.
-- Unsettled accepted/unknown requests must be reconciled first: their inclusion in
-- provider remaining cannot be guessed and deducted again from the same snapshot.
CREATE FUNCTION begin_soldgraph_usage(p_account uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.soldgraph_accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.soldgraph_accounts WHERE id=p_account FOR NO KEY UPDATE;
  IF NOT FOUND OR a.execution_mode='emergency_stop' THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
  IF a.usage_lease_until>now() THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_REFRESHING'; END IF;
  IF EXISTS(SELECT 1 FROM public.ebay_market_price_pages WHERE account_id=a.id
    AND ((credits IS NULL AND (request_id IS NOT NULL OR state<>'reserved'))
      OR (lease_owner IS NOT NULL AND lease_until>now()))) THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_UNSETTLED'; END IF;
  IF (SELECT count(*) FROM public.soldgraph_account_calls WHERE account_id=a.id AND called_at>now()-interval '1 minute')>=a.calls_per_minute
    THEN RAISE EXCEPTION 'SOLDGRAPH_RATE_LIMIT'; END IF;
  UPDATE public.soldgraph_accounts SET usage_lease_owner=p_owner,usage_lease_until=now()+interval '60 seconds' WHERE id=a.id;
  INSERT INTO public.soldgraph_account_calls(account_id,operation_key,call_type) VALUES(a.id,'usage:'||p_owner::text,'usage');
  RETURN a.allow_extra_requests;
END $$;
REVOKE ALL ON FUNCTION begin_soldgraph_usage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION begin_soldgraph_usage(uuid,uuid) TO hanamaru_worker_system;

CREATE FUNCTION finish_soldgraph_usage(p_account uuid,p_owner uuid,p_usage jsonb,p_available integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.soldgraph_accounts%ROWTYPE; charged bigint;
BEGIN
  SELECT * INTO a FROM public.soldgraph_accounts WHERE id=p_account FOR NO KEY UPDATE;
  IF NOT FOUND OR a.usage_lease_owner IS DISTINCT FROM p_owner OR a.usage_lease_until<=now()
    THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_LEASE_REQUIRED'; END IF;
  IF a.execution_mode='emergency_stop' THEN RAISE EXCEPTION 'SOLDGRAPH_DISABLED'; END IF;
  IF p_available IS NULL OR p_available<0 OR jsonb_typeof(p_usage)<>'object'
    OR p_usage->>'window' NOT IN ('one_time','rolling_30_days')
    OR (p_usage->>'remaining')::integer IS NULL
    OR p_available<>((p_usage->>'remaining')::integer+(CASE WHEN a.allow_extra_requests THEN (p_usage->>'extraRequests')::integer ELSE 0 END))
    THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.ebay_market_price_pages WHERE account_id=a.id
    AND ((credits IS NULL AND (request_id IS NOT NULL OR state<>'reserved'))
      OR (lease_owner IS NOT NULL AND lease_until>now()))) THEN RAISE EXCEPTION 'SOLDGRAPH_USAGE_UNSETTLED'; END IF;
  SELECT coalesce(sum(credits),0) INTO charged FROM public.ebay_market_price_pages WHERE account_id=a.id AND credit_state='charged';
  UPDATE public.soldgraph_accounts SET usage_remaining=p_available,usage_window_json=p_usage,
    usage_accounted_charged=charged,usage_checked_at=now(),usage_lease_owner=NULL,usage_lease_until=NULL,
    calls_per_minute=least(calls_per_minute,(p_usage->>'rateLimitPerMinute')::integer),lock_version=lock_version+1,updated_at=now() WHERE id=a.id;
END $$;
REVOKE ALL ON FUNCTION finish_soldgraph_usage(uuid,uuid,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_soldgraph_usage(uuid,uuid,jsonb,integer) TO hanamaru_worker_system;

CREATE FUNCTION fail_soldgraph_usage(p_account uuid,p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.soldgraph_accounts SET usage_checked_at=NULL,usage_remaining=NULL,usage_lease_owner=NULL,usage_lease_until=NULL,
    execution_mode=CASE WHEN execution_mode='enabled' THEN 'reconcile_only' ELSE execution_mode END,
    lock_version=lock_version+1,updated_at=now() WHERE id=p_account AND usage_lease_owner=p_owner;
END $$;
REVOKE ALL ON FUNCTION fail_soldgraph_usage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_soldgraph_usage(uuid,uuid) TO hanamaru_worker_system;

ALTER TABLE jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check CHECK(job_type IN (
  'pdf_extract','preparation','drive_import','transcribe','manual_transcript','review',
  'market_price_identification','market_price_search','market_price_ebay_search','delete','retention_scan'));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ebay_market_price_searches','ebay_market_price_runs','ebay_market_price_pages',
    'ebay_market_price_observations','ebay_market_price_item_decisions','ebay_market_price_results'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON ebay_market_price_searches,ebay_market_price_runs,ebay_market_price_pages,
  ebay_market_price_observations,ebay_market_price_item_decisions TO hanamaru_api,hanamaru_worker;
GRANT SELECT,INSERT ON ebay_market_price_results TO hanamaru_api;
GRANT SELECT ON ebay_market_price_results TO hanamaru_worker;
GRANT SELECT,UPDATE ON soldgraph_accounts TO hanamaru_worker_system;
GRANT SELECT,INSERT,DELETE ON soldgraph_account_calls TO hanamaru_worker_system;
-- No feature flag is enabled here; absent flags fail closed in API/Worker.

-- Operations receives sanitized job metadata, not search terms, observations or prices.
CREATE FUNCTION soldgraph_operational_candidates() RETURNS TABLE(
  organization_id uuid,membership_id uuid,job_id uuid,job_type text,failure_class text,
  severity text,attempt integer,max_attempts integer,oldest_age_seconds integer)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT DISTINCT ON(s.id) j.organization_id,j.requested_by_membership_id,j.id,j.job_type::text,
    'MARKET_PRICE_BLOCKED'::text,'critical'::text,j.attempt_count,j.max_attempts,
    greatest(0,extract(epoch FROM now()-s.updated_at)::int)
  FROM public.ebay_market_price_searches s JOIN public.jobs j
    ON j.organization_id=s.organization_id AND j.entity_id=s.id AND j.job_type='market_price_ebay_search'
  WHERE s.status='blocked' OR EXISTS(
    SELECT 1 FROM public.ebay_market_price_pages p WHERE p.search_id=s.id AND p.organization_id=s.organization_id
      AND p.state IN ('unknown','parse_failed','blocked')
      AND NOT EXISTS(SELECT 1 FROM public.ebay_market_price_pages newer WHERE newer.search_id=p.search_id
        AND newer.market=p.market AND newer.page_number=p.page_number AND newer.attempt>p.attempt))
  ORDER BY s.id,j.created_at DESC,j.id DESC
$$;
REVOKE ALL ON FUNCTION soldgraph_operational_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soldgraph_operational_candidates() TO hanamaru_worker_system;

-- Content expires independently of the minimal charge ledger. Pages/search
-- identity anchors remain so lifetime budgets and unresolved charges cannot reset.
-- Runtime roles have no unrestricted snapshot DELETE or policy modification grant.
CREATE FUNCTION purge_expired_ebay_content(p_org uuid,p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE days integer; s record; purged integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SOLDGRAPH_RETENTION_LIMIT_INVALID'; END IF;
  SELECT content_days INTO days FROM public.ebay_retention_policies WHERE organization_id=p_org AND approved_at<=now();
  IF days IS NULL THEN RETURN 0; END IF;
  FOR s IN SELECT id FROM public.ebay_market_price_searches e
    WHERE organization_id=p_org AND content_purged_at IS NULL AND created_at<=now()-days*interval '1 day'
      AND status IN ('ready','partial','blocked','failed','cancelled','confirmed','review_required')
      AND NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.organization_id=p_org AND j.entity_id=e.id
        AND j.status IN ('queued','running','retry_wait'))
      AND NOT EXISTS(SELECT 1 FROM public.ebay_market_price_pages p WHERE p.organization_id=p_org AND p.search_id=e.id
        AND p.lease_until>now())
    ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    -- Keep the minimal replay tombstone until its existing expiry: deleting the
    -- key would allow the same saved operation to accidentally buy another search.
    UPDATE public.idempotency_records i SET response_body_redacted='{}' WHERE organization_id=p_org AND
      (resource_id=s.id OR resource_id IN(SELECT id FROM public.ebay_market_price_results WHERE organization_id=p_org AND search_id=s.id)
        OR resource_id IN(SELECT id FROM public.ebay_market_price_pages WHERE organization_id=p_org AND search_id=s.id));
    DELETE FROM public.ebay_market_price_results WHERE organization_id=p_org AND search_id=s.id;
    DELETE FROM public.ebay_market_price_item_decisions WHERE organization_id=p_org AND search_id=s.id;
    DELETE FROM public.ebay_market_price_observations WHERE organization_id=p_org AND search_id=s.id;
    UPDATE public.ebay_market_price_pages SET request_json='{}',normalized_result_json=NULL,
      state=CASE WHEN credit_state IN ('charged','released') THEN 'purged' ELSE state END,
      cache_from_page_id=NULL,updated_at=now() WHERE organization_id=p_org AND search_id=s.id;
    UPDATE public.ebay_market_price_searches SET plan_json='{}',product_basis_json='{}',exclusion_keywords_json='[]',
      content_purged_at=now(),lock_version=lock_version+1,updated_at=now() WHERE organization_id=p_org AND id=s.id;
    UPDATE public.jobs SET input_redacted='{}',updated_at=now() WHERE organization_id=p_org AND entity_id=s.id;
    purged:=purged+1;
  END LOOP;
  RETURN purged;
END $$;
REVOKE ALL ON FUNCTION purge_expired_ebay_content(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_ebay_content(uuid,integer) TO hanamaru_worker_system;
