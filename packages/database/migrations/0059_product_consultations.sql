-- KS-07/08: Consultations remain attached to a visit product, with an explicit human decision.
ALTER TABLE visit_products ADD CONSTRAINT visit_products_visit_identity UNIQUE(organization_id,visit_id,id);
CREATE TABLE product_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  assigned_manager_id uuid NOT NULL,
  proposed_price_yen bigint NOT NULL CHECK(proposed_price_yen >= 0),
  market_price_result_id uuid NULL,
  request_reason varchar(1000) NOT NULL CHECK(length(trim(request_reason))>0),
  due_at timestamptz NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','conditional','returned','cancelled')),
  approved_price_yen bigint NULL CHECK(approved_price_yen IS NULL OR approved_price_yen >= 0),
  response_note varchar(1000) NULL,
  responded_by_membership_id uuid NULL,
  responded_at timestamptz NULL,
  reassigned_by_membership_id uuid NULL,
  reassignment_reason varchar(1000) NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,product_id) REFERENCES visit_products(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,visit_id,product_id) REFERENCES visit_products(organization_id,visit_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_manager_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,market_price_result_id) REFERENCES market_price_results(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,responded_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reassigned_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX product_consultations_one_pending ON product_consultations(organization_id,product_id) WHERE status='pending';
CREATE INDEX product_consultations_visit_idx ON product_consultations(organization_id,visit_id,created_at,id);
ALTER TABLE product_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_consultations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_consultations USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
GRANT SELECT,INSERT,UPDATE ON product_consultations TO hanamaru_api;
GRANT SELECT,UPDATE ON product_consultations TO hanamaru_worker;
CREATE TRIGGER product_consultations_touch BEFORE UPDATE ON product_consultations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE product_consultation_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL,
  previous_manager_id uuid NOT NULL,
  next_manager_id uuid NOT NULL,
  reason varchar(1000) NOT NULL CHECK(length(trim(reason))>0),
  changed_by_membership_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,consultation_id) REFERENCES product_consultations(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,previous_manager_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,next_manager_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,changed_by_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX product_consultation_reassignments_consultation_idx ON product_consultation_reassignments(organization_id,consultation_id,changed_at);
ALTER TABLE product_consultation_reassignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_consultation_reassignments FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_consultation_reassignments USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
GRANT SELECT,INSERT ON product_consultation_reassignments TO hanamaru_api;
GRANT SELECT,UPDATE ON product_consultation_reassignments TO hanamaru_worker;
