-- The PDF extraction worker requires one active visit_info schema per
-- organization. Development seed already provided it; production bootstrap
-- must have the same runtime invariant without relying on sample data.
INSERT INTO form_schema_versions(
  organization_id,
  schema_key,
  version,
  json_schema,
  ui_schema,
  status,
  effective_from
)
SELECT
  o.id,
  'visit_info',
  1,
  '{"type":"object","properties":{"visitDate":{"type":"string","format":"date"},"customerLabel":{"type":"string","maxLength":200}},"additionalProperties":true}'::jsonb,
  '{}'::jsonb,
  'active',
  now()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1
  FROM form_schema_versions fs
  WHERE fs.organization_id=o.id
    AND fs.schema_key='visit_info'
    AND fs.status='active'
);
