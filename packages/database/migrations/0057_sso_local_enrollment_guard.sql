-- Product-local enrollment is consulted before contacting the shared issuer.
-- Keep existing Google users in legacy state until approved-link reconciliation.
ALTER TABLE memberships ADD COLUMN sso_enrollment_state varchar(20) NOT NULL DEFAULT 'legacy'
  CHECK(sso_enrollment_state IN ('legacy','pending','managed'));
ALTER TABLE memberships ADD COLUMN sso_enrollment_request_id uuid;
ALTER TABLE memberships ADD CONSTRAINT memberships_sso_enrollment_request_check
  CHECK(sso_enrollment_state <> 'pending' OR sso_enrollment_request_id IS NOT NULL);

CREATE TABLE sso_enrollment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  action varchar(30) NOT NULL CHECK(action IN ('prepared','reconciled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sso_enrollment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_enrollment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON sso_enrollment_events
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
CREATE FUNCTION reject_sso_enrollment_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SSO enrollment events are append-only'; END $$;
CREATE TRIGGER sso_enrollment_events_append_only BEFORE UPDATE OR DELETE ON sso_enrollment_events
  FOR EACH ROW EXECUTE FUNCTION reject_sso_enrollment_event_mutation();
GRANT SELECT,INSERT ON sso_enrollment_events TO hanamaru_api;
GRANT SELECT,INSERT ON sso_enrollment_events TO hanamaru_api_system;
GRANT USAGE,SELECT ON SEQUENCE sso_enrollment_events_id_seq TO hanamaru_api,hanamaru_api_system;
