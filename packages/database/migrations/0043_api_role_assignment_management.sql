-- Managers replace a membership's role set in one transaction. RLS still
-- scopes deletion to app.organization_id; this adds only the missing verb.
GRANT DELETE ON role_assignments TO hanamaru_api;
