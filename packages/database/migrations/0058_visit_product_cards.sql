-- KS-04: A product belongs to a visit. Historical visit/PDF/market-price records are untouched.
CREATE TABLE visit_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_name varchar(300) NOT NULL CHECK(length(trim(product_name))>0),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  condition_note varchar(1000) NULL,
  accessories_note varchar(1000) NULL,
  status varchar(30) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','research_pending','ready','cancelled')),
  lock_version bigint NOT NULL DEFAULT 1,
  created_by_membership_id uuid NOT NULL,
  updated_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);
CREATE INDEX visit_products_visit_idx ON visit_products(organization_id,visit_id,created_at,id);
ALTER TABLE visit_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_products FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON visit_products
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
GRANT SELECT,INSERT,UPDATE ON visit_products TO hanamaru_api;
GRANT SELECT,UPDATE ON visit_products TO hanamaru_worker;
CREATE TRIGGER visit_products_touch BEFORE UPDATE ON visit_products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
