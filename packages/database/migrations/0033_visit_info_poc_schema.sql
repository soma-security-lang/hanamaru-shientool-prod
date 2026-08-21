-- Formal visit information schema aligned with the PoC reservation PDF.
-- The assigned staff name is extracted as source-document information only;
-- it never changes the visit's RBAC assignment.
UPDATE form_schema_versions
   SET status='retired',updated_at=now()
 WHERE schema_key='visit_info' AND status='active';

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
  2,
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('visitDate','customerLabel','appraisalItems'),
    'properties',jsonb_build_object(
      'visitDate',jsonb_build_object('type','string','format','date','title','訪問予定日'),
      'visitTime',jsonb_build_object('type','string','pattern','^([01]\d|2[0-3]):[0-5]\d$','title','訪問予定時間'),
      'customerLabel',jsonb_build_object('type','string','maxLength',200,'title','お客様表示名'),
      'appraisalItems',jsonb_build_object('type','string','maxLength',2000,'title','査定品'),
      'visitAddress',jsonb_build_object('type','string','maxLength',1000,'title','住所'),
      'contact',jsonb_build_object('type','string','maxLength',500,'title','連絡先'),
      'parking',jsonb_build_object('type','string','maxLength',500,'title','駐車場'),
      'campaign',jsonb_build_object('type','string','maxLength',500,'title','キャンペーン'),
      'notes',jsonb_build_object('type','string','maxLength',4000,'title','備考'),
      'assignedStaffName',jsonb_build_object('type','string','maxLength',200,'title','担当')
    ),
    'additionalProperties',false
  ),
  '{"order":["visitDate","visitTime","customerLabel","appraisalItems","visitAddress","contact","parking","campaign","notes","assignedStaffName"],"columns":{"desktop":2,"mobile":1}}'::jsonb,
  'active',
  now()
FROM organizations o
ON CONFLICT(organization_id,schema_key,version) DO UPDATE
SET json_schema=excluded.json_schema,
    ui_schema=excluded.ui_schema,
    status='active',
    effective_from=excluded.effective_from,
    updated_at=now();
