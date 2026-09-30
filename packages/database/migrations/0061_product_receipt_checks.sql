-- KS-10 product-side physical checks. Transfer to MONOCLE is explicitly not sent.
CREATE TABLE product_receipt_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  result varchar(20) NOT NULL CHECK(result IN ('hold','confirmed')),
  observed_quantity integer NOT NULL CHECK(observed_quantity BETWEEN 0 AND 100000),
  identity_matched boolean NOT NULL,
  condition_matched boolean NOT NULL,
  observed_condition varchar(1000) NULL,
  hold_reason varchar(1000) NULL,
  monocle_transfer_status varchar(20) NOT NULL DEFAULT 'not_sent' CHECK(monocle_transfer_status='not_sent'),
  checked_by_membership_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id,product_id) REFERENCES visit_products(organization_id,visit_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,checked_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,product_id,version),
  CHECK(result <> 'confirmed' OR (identity_matched AND condition_matched AND hold_reason IS NULL)),
  CHECK(result <> 'hold' OR (hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0))
);
CREATE INDEX product_receipt_checks_visit_idx ON product_receipt_checks(organization_id,visit_id,product_id,version DESC);
ALTER TABLE product_receipt_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_receipt_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_receipt_checks USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
GRANT SELECT,INSERT ON product_receipt_checks TO hanamaru_api;
GRANT SELECT,UPDATE ON product_receipt_checks TO hanamaru_worker;
