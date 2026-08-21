-- The baseline AI configuration is reviewed as part of this release. Production
-- workers consume approved configuration only; organizations without an active
-- organization-scoped manager remain safely unavailable for AI generation.
WITH approver AS (
  SELECT ra.organization_id,min(ra.membership_id::text)::uuid membership_id
    FROM role_assignments ra
    JOIN memberships m ON m.id=ra.membership_id AND m.organization_id=ra.organization_id AND m.status='active'
    JOIN roles r ON r.id=ra.role_id AND r.role_code='manager'
   WHERE ra.scope_type='organization' AND (ra.valid_until IS NULL OR ra.valid_until>now())
   GROUP BY ra.organization_id
)
UPDATE prompt_versions pv
   SET status='approved',approved_by_membership_id=a.membership_id,approved_at=now(),updated_at=now()
  FROM approver a
 WHERE pv.organization_id=a.organization_id
   AND pv.status='provisional'
   AND pv.version=1
   AND pv.purpose IN ('pdf_extract','preparation','review');

WITH approver AS (
  SELECT ra.organization_id,min(ra.membership_id::text)::uuid membership_id
    FROM role_assignments ra
    JOIN memberships m ON m.id=ra.membership_id AND m.organization_id=ra.organization_id AND m.status='active'
    JOIN roles r ON r.id=ra.role_id AND r.role_code='manager'
   WHERE ra.scope_type='organization' AND (ra.valid_until IS NULL OR ra.valid_until>now())
   GROUP BY ra.organization_id
)
UPDATE review_criteria_versions rc
   SET status='approved',approved_by_membership_id=a.membership_id,approved_at=now(),updated_at=now()
  FROM approver a
 WHERE rc.organization_id=a.organization_id
   AND rc.status='provisional'
   AND rc.version=1;
