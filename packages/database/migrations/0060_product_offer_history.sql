-- KS-09: presented terms and customer responses are append-only business records.
CREATE TABLE product_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  price_yen bigint NOT NULL CHECK(price_yen >= 0),
  terms varchar(1000) NOT NULL CHECK(length(trim(terms)) > 0),
  expires_at timestamptz NULL,
  presented_by_membership_id uuid NOT NULL,
  presented_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id,product_id) REFERENCES visit_products(organization_id,visit_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,presented_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,product_id,version)
);
CREATE INDEX product_offers_visit_idx ON product_offers(organization_id,visit_id,product_id,version DESC);
ALTER TABLE product_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_offers USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
GRANT SELECT,INSERT ON product_offers TO hanamaru_api;
GRANT SELECT,UPDATE ON product_offers TO hanamaru_worker;

CREATE TABLE product_offer_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  response varchar(20) NOT NULL CHECK(response IN ('pending','accepted','declined','counteroffer')),
  note varchar(1000) NULL,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,offer_id) REFERENCES product_offers(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recorded_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,offer_id,version)
);
CREATE INDEX product_offer_responses_offer_idx ON product_offer_responses(organization_id,offer_id,recorded_at,id);
ALTER TABLE product_offer_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_offer_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_offer_responses USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
GRANT SELECT,INSERT ON product_offer_responses TO hanamaru_api;
GRANT SELECT,UPDATE ON product_offer_responses TO hanamaru_worker;
