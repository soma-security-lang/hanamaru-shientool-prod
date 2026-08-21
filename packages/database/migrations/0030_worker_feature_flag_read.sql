-- Visit preparation must evaluate the organization-scoped pilot content gate.
-- RLS remains enforced; the worker receives read-only access to this table.
GRANT SELECT ON feature_flags TO hanamaru_worker;
