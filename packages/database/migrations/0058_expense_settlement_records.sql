-- Records only, after SSO migration 0057. Cash movement, reconciliation, close and correction application
-- require a separately approved authority and balance contract.
CREATE TABLE expense_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  owner_membership_id uuid NOT NULL,
  business_date date NOT NULL,
  opening_wallet_cash bigint NULL CHECK(opening_wallet_cash IS NULL OR opening_wallet_cash>=0),
  purchase_total bigint NULL CHECK(purchase_total IS NULL OR purchase_total>=0),
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK(status='draft'),
  lock_version bigint NOT NULL DEFAULT 1,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,owner_membership_id,business_date),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,owner_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  day_id uuid NOT NULL,
  spent_by_membership_id uuid NOT NULL,
  entered_by_membership_id uuid NOT NULL,
  business_date date NOT NULL,
  merchant varchar(200) NOT NULL,
  category varchar(40) NOT NULL,
  amount bigint NOT NULL CHECK(amount>0),
  payment_source varchar(20) NOT NULL CHECK(payment_source IN ('company_wallet','personal')),
  status varchar(20) NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed')),
  entry_source varchar(20) NOT NULL DEFAULT 'manual' CHECK(entry_source IN ('manual','synthetic_ocr')),
  receipt_status varchar(30) NOT NULL DEFAULT 'not_attached' CHECK(receipt_status IN ('not_attached','reference_pending')),
  note varchar(1000) NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  confirmed_by_membership_id uuid NULL,
  confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,day_id) REFERENCES expense_days(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,spent_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,entered_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id),
  CHECK((status='confirmed')=(confirmed_at IS NOT NULL))
);

CREATE TABLE expense_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  day_id uuid NOT NULL,
  kind varchar(30) NOT NULL CHECK(kind IN ('funding_request','unreplenished','vault_discrepancy','report','correction_proposal')),
  status varchar(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  amount bigint NULL CHECK(amount IS NULL OR amount>=0),
  reason varchar(1000) NOT NULL,
  target_item_id uuid NULL,
  proposed_before jsonb NULL,
  proposed_after jsonb NULL,
  recorded_by_membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,day_id) REFERENCES expense_days(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,target_item_id) REFERENCES expense_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recorded_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  CHECK(status='open' OR kind='unreplenished'),
  CHECK((status='resolved')=(resolved_at IS NOT NULL))
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['expense_days','expense_items','expense_followups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id())',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON expense_days,expense_items TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON expense_followups TO hanamaru_api;
CREATE INDEX expense_days_scope_idx ON expense_days(organization_id,branch_id,business_date DESC);
CREATE INDEX expense_items_day_idx ON expense_items(organization_id,day_id,created_at);
CREATE INDEX expense_followups_day_idx ON expense_followups(organization_id,day_id,occurred_at);
CREATE TRIGGER expense_days_touch BEFORE UPDATE ON expense_days FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER expense_items_touch BEFORE UPDATE ON expense_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- An absent flag is OFF in the existing API and Web feature checks.
INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
SELECT o.id,'expense_settlement',false,m.id,'経費精算の業務権限と残高式が確定するまで無効'
FROM organizations o JOIN LATERAL (SELECT id FROM memberships WHERE organization_id=o.id ORDER BY created_at,id LIMIT 1) m ON true
ON CONFLICT(organization_id,flag_key) DO NOTHING;
