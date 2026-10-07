-- No production grants/policies are bootstrapped. Configure each branch explicitly.
ALTER TABLE expense_followups ADD CONSTRAINT expense_followups_org_id_unique UNIQUE(organization_id,id);
CREATE TABLE expense_cash_permissions (
 organization_id uuid NOT NULL, branch_id uuid NOT NULL, membership_id uuid NOT NULL,
 authority varchar(16) NOT NULL CHECK(authority IN ('officer','delegate')),
 can_close boolean NOT NULL DEFAULT false, valid_from timestamptz NOT NULL, valid_until timestamptz NULL,
 PRIMARY KEY(organization_id,branch_id,membership_id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id),
 CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE expense_cash_policies (
 organization_id uuid NOT NULL, branch_id uuid NOT NULL,
 reconciliation_mode varchar(32) NOT NULL CHECK(reconciliation_mode IN ('external_reference','vault_ledger_v1')),
 policy_reference varchar(500) NOT NULL, version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(organization_id,branch_id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id)
);
CREATE TABLE expense_branch_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL,
 business_date date NOT NULL, status varchar(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed_balanced','closed_difference')),
 roster_note varchar(1000) NOT NULL,
 expected_cash bigint NULL CHECK(expected_cash>=0), actual_cash bigint NULL CHECK(actual_cash>=0),
 reconciliation_input jsonb NULL, reconciliation_version bigint NULL,
 lock_version bigint NOT NULL DEFAULT 1, closed_at timestamptz NULL,
 review_required boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,branch_id,business_date),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id)
);
CREATE TABLE expense_branch_participants (
 organization_id uuid NOT NULL, branch_day_id uuid NOT NULL, day_id uuid NOT NULL,
 ready_at timestamptz NULL, ready_by uuid NULL,
 PRIMARY KEY(organization_id,branch_day_id,day_id),
 FOREIGN KEY(organization_id,branch_day_id) REFERENCES expense_branch_days(organization_id,id),
 FOREIGN KEY(organization_id,day_id) REFERENCES expense_days(organization_id,id),
 FOREIGN KEY(organization_id,ready_by) REFERENCES memberships(organization_id,id)
);
CREATE TABLE expense_cash_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL, day_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), performed_by uuid NOT NULL, recorded_by uuid NOT NULL,
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 unreplenished_id uuid NULL, reverses_id uuid NULL, reason varchar(1000) NOT NULL,
 UNIQUE(organization_id,id), UNIQUE(organization_id,reverses_id),
 FOREIGN KEY(organization_id,branch_day_id,day_id) REFERENCES expense_branch_participants(organization_id,branch_day_id,day_id),
 FOREIGN KEY(organization_id,performed_by) REFERENCES memberships(organization_id,id),
 FOREIGN KEY(organization_id,recorded_by) REFERENCES memberships(organization_id,id),
 FOREIGN KEY(organization_id,unreplenished_id) REFERENCES expense_followups(organization_id,id),
 FOREIGN KEY(organization_id,reverses_id) REFERENCES expense_cash_transfers(organization_id,id)
);
CREATE TABLE expense_branch_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NULL, day_id uuid NULL,
 action varchar(40) NOT NULL, actor_id uuid NOT NULL, details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(branch_day_id IS NOT NULL OR day_id IS NOT NULL),
 FOREIGN KEY(organization_id,branch_day_id) REFERENCES expense_branch_days(organization_id,id),
 FOREIGN KEY(organization_id,day_id) REFERENCES expense_days(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,id)
);
CREATE TABLE expense_branch_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL,
 expected_cash bigint NOT NULL, actual_cash bigint NOT NULL, difference bigint NOT NULL,
 snapshot jsonb NOT NULL, snapshot_hash varchar(64) NOT NULL,
 closed_by uuid NOT NULL, closed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,branch_day_id),
 FOREIGN KEY(organization_id,branch_day_id) REFERENCES expense_branch_days(organization_id,id),
 FOREIGN KEY(organization_id,closed_by) REFERENCES memberships(organization_id,id)
);
CREATE TABLE expense_branch_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL,
 kind varchar(24) NOT NULL CHECK(kind IN ('cash_difference','post_close_correction')),
 status varchar(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 amount bigint NULL, note varchar(1000) NOT NULL, assignee_id uuid NOT NULL,
 resolution_note varchar(1000) NULL, resolved_by uuid NULL, resolved_at timestamptz NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,branch_day_id) REFERENCES expense_branch_days(organization_id,id),
 FOREIGN KEY(organization_id,assignee_id) REFERENCES memberships(organization_id,id),
 FOREIGN KEY(organization_id,resolved_by) REFERENCES memberships(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['expense_cash_permissions','expense_cash_policies','expense_branch_days','expense_branch_participants','expense_cash_transfers','expense_branch_events','expense_branch_closures','expense_branch_issues'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
 END LOOP;
END $$;
GRANT SELECT ON expense_cash_permissions,expense_cash_policies TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON expense_branch_days,expense_branch_participants,expense_branch_issues TO hanamaru_api;
GRANT DELETE ON expense_branch_participants TO hanamaru_api;
GRANT SELECT,INSERT ON expense_cash_transfers,expense_branch_events,expense_branch_closures TO hanamaru_api;
CREATE INDEX expense_branch_events_day_idx ON expense_branch_events(organization_id,branch_day_id,created_at,id);
CREATE INDEX expense_branch_events_personal_day_idx ON expense_branch_events(organization_id,day_id,created_at,id);
CREATE INDEX expense_branch_issues_open_idx ON expense_branch_issues(organization_id,status,branch_day_id);
CREATE TRIGGER expense_branch_days_touch BEFORE UPDATE ON expense_branch_days FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Capture personal as well as proxy edits. Payloads stay in the officer-only
-- business history; standard audit metadata contains identifiers only.
CREATE FUNCTION capture_expense_branch_edit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid; target_day uuid; branch_day uuid;
BEGIN
 actor := NULLIF(current_setting('app.membership_id',true),'')::uuid;
 IF actor IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='expense_days' THEN target_day:=NEW.id; ELSE target_day:=NEW.day_id; END IF;
 SELECT branch_day_id INTO branch_day FROM expense_branch_participants
 WHERE organization_id=NEW.organization_id AND day_id=target_day;
 IF TG_OP='INSERT' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  INSERT INTO expense_branch_events(organization_id,branch_day_id,day_id,action,actor_id,details)
  VALUES(NEW.organization_id,branch_day,target_day,TG_TABLE_NAME||'.'||lower(TG_OP),actor,
    jsonb_build_object('before',CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,'after',to_jsonb(NEW)));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_item_branch_history AFTER INSERT OR UPDATE ON expense_items FOR EACH ROW EXECUTE FUNCTION capture_expense_branch_edit();
CREATE TRIGGER expense_day_branch_history AFTER UPDATE ON expense_days FOR EACH ROW EXECUTE FUNCTION capture_expense_branch_edit();
