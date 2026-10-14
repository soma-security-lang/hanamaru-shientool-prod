-- Tighten the additive ledger's scope checks without changing earlier migrations.
DROP POLICY result_scope ON purchase_results;
CREATE POLICY result_scope ON purchase_results USING(organization_id=app_org_id() AND (
 assessor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid OR EXISTS(
 SELECT 1 FROM role_assignments a JOIN roles r ON r.id=a.role_id
 WHERE a.organization_id=app_org_id() AND a.membership_id=nullif(current_setting('app.membership_id',true),'')::uuid
 AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
 AND r.role_code='manager' AND ((a.scope_type='organization' AND a.scope_id=purchase_results.organization_id) OR (a.scope_type='branch' AND a.scope_id=purchase_results.branch_id))
 ))) WITH CHECK(organization_id=app_org_id() AND assessor_membership_id=nullif(current_setting('app.membership_id',true),'')::uuid);
CREATE OR REPLACE VIEW purchase_performance_cells WITH (security_barrier=true) AS
 SELECT p.organization_id,p.branch_id,b.name AS branch_name,p.business_date,p.assessor_membership_id,u.display_name AS assessor_name,
 sum(p.purchase_amount)::text AS amount,count(*)::integer AS transaction_count
 FROM purchase_results p JOIN branches b ON b.organization_id=p.organization_id AND b.id=p.branch_id
 JOIN memberships m ON m.organization_id=p.organization_id AND m.id=p.assessor_membership_id JOIN users u ON u.id=m.user_id
 WHERE p.organization_id=app_org_id() AND p.status='confirmed'
 AND string_to_array(current_setting('app.role_codes',true),',') && ARRAY['assessor','manager']
 AND current_setting('app.role_codes',true) NOT LIKE '%system_admin%'
 AND EXISTS(SELECT 1 FROM memberships viewer JOIN role_assignments a ON a.organization_id=viewer.organization_id AND a.membership_id=viewer.id JOIN roles r ON r.id=a.role_id
 WHERE viewer.organization_id=app_org_id() AND viewer.id=nullif(current_setting('app.membership_id',true),'')::uuid AND viewer.status='active'
 AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now()) AND r.role_code IN ('assessor','manager'))
 AND EXISTS(SELECT 1 FROM feature_flags f WHERE f.organization_id=app_org_id() AND f.flag_key='purchase_performance' AND f.enabled AND (f.expires_at IS NULL OR f.expires_at>now()))
 GROUP BY p.organization_id,p.branch_id,b.name,p.business_date,p.assessor_membership_id,u.display_name;
