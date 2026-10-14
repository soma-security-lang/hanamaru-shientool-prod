-- New functionality remains OFF unless configured explicitly. No historical
-- manual day totals are converted, overwritten or treated as transactions.
CREATE TABLE purchase_result_policies (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 self_confirm_enabled boolean NOT NULL DEFAULT false,
 changes_enabled boolean NOT NULL DEFAULT false,
 reference varchar(500) NOT NULL
);
CREATE TABLE purchase_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 branch_id uuid NOT NULL, assessor_membership_id uuid NOT NULL,
 business_date date NOT NULL, purchase_amount bigint NOT NULL CHECK(purchase_amount>0 AND purchase_amount<=1000000000),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','cancelled')),
 lock_version integer NOT NULL DEFAULT 1 CHECK(lock_version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id),
 FOREIGN KEY(organization_id,assessor_membership_id) REFERENCES memberships(organization_id,id)
);
CREATE TABLE purchase_result_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 result_id uuid NOT NULL, version integer NOT NULL, action varchar(24) NOT NULL,
 before_json jsonb NULL, after_json jsonb NOT NULL, reason varchar(1000) NULL,
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,result_id,version),
 FOREIGN KEY(organization_id,result_id) REFERENCES purchase_results(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,id)
);
CREATE INDEX purchase_result_period ON purchase_results(organization_id,business_date,branch_id,assessor_membership_id) WHERE status='confirmed';
ALTER TABLE purchase_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_results FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_result_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_result_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_result_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_result_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY result_scope ON purchase_results USING(organization_id=app_org_id() AND (
 assessor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid OR EXISTS(
 SELECT 1 FROM role_assignments a JOIN roles r ON r.id=a.role_id
 WHERE a.organization_id=app_org_id() AND a.membership_id=nullif(current_setting('app.membership_id',true),'')::uuid
 AND r.role_code='manager' AND ((a.scope_type='organization' AND a.scope_id=purchase_results.organization_id) OR (a.scope_type='branch' AND a.scope_id=purchase_results.branch_id))
 ))) WITH CHECK(organization_id=app_org_id() AND assessor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid);
CREATE POLICY revision_scope ON purchase_result_revisions USING(organization_id=app_org_id() AND EXISTS(SELECT 1 FROM purchase_results p WHERE p.organization_id=purchase_result_revisions.organization_id AND p.id=result_id)) WITH CHECK(organization_id=app_org_id() AND actor_id=nullif(current_setting('app.membership_id',true),'')::uuid);
CREATE POLICY org_isolation ON purchase_result_policies USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
REVOKE ALL ON purchase_results,purchase_result_revisions,purchase_result_policies FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON purchase_results TO hanamaru_api;
GRANT SELECT,INSERT ON purchase_result_revisions TO hanamaru_api;
GRANT SELECT ON purchase_result_policies TO hanamaru_api;
-- A fixed-column aggregate view is the ONLY organization-wide read path.
-- Owner execution is deliberate; it exposes no transaction IDs, notes or history.
CREATE VIEW purchase_performance_cells WITH (security_barrier=true) AS
 SELECT p.organization_id,p.branch_id,b.name AS branch_name,p.business_date,p.assessor_membership_id,u.display_name AS assessor_name,
 sum(p.purchase_amount)::text AS amount,count(*)::integer AS transaction_count
 FROM purchase_results p JOIN branches b ON b.organization_id=p.organization_id AND b.id=p.branch_id
 JOIN memberships m ON m.organization_id=p.organization_id AND m.id=p.assessor_membership_id JOIN users u ON u.id=m.user_id
 WHERE p.organization_id=app_org_id() AND p.status='confirmed'
 AND current_setting('app.role_codes',true) NOT LIKE '%system_admin%'
 AND EXISTS(SELECT 1 FROM memberships viewer JOIN role_assignments a ON a.organization_id=viewer.organization_id AND a.membership_id=viewer.id JOIN roles r ON r.id=a.role_id
 WHERE viewer.organization_id=app_org_id() AND viewer.id=nullif(current_setting('app.membership_id',true),'')::uuid AND viewer.status='active' AND r.role_code IN ('assessor','manager'))
 AND EXISTS(SELECT 1 FROM feature_flags f WHERE f.organization_id=app_org_id() AND f.flag_key='purchase_performance' AND f.enabled AND (f.expires_at IS NULL OR f.expires_at>now()))
 GROUP BY p.organization_id,p.branch_id,b.name,p.business_date,p.assessor_membership_id,u.display_name;
GRANT SELECT ON purchase_performance_cells TO hanamaru_api;
-- Policy/configuration writes and destructive transaction deletes are not
-- granted to runtime API/Worker roles. Revisions cannot be overwritten.
