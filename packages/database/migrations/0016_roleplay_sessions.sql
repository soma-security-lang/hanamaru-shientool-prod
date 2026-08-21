CREATE TABLE roleplay_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  scenario_content_item_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  self_note text NULL CHECK(length(self_note)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,scenario_content_item_id) REFERENCES content_items(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);

CREATE TABLE roleplay_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  sequence_no int NOT NULL CHECK(sequence_no>0),
  staff_text text NOT NULL CHECK(length(staff_text) BETWEEN 1 AND 2000),
  customer_reply text NOT NULL CHECK(length(customer_reply) BETWEEN 1 AND 4000),
  feedback jsonb NOT NULL CHECK(jsonb_typeof(feedback)='array'),
  model_name varchar(100) NOT NULL,
  input_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,session_id) REFERENCES roleplay_sessions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(session_id,sequence_no),
  UNIQUE(organization_id,id),
  CHECK(feedback::text !~* '"(score|rank|rating|human_resources|personnel_evaluation)"[[:space:]]*:')
);

CREATE INDEX roleplay_sessions_member_started_idx ON roleplay_sessions(organization_id,membership_id,started_at DESC);
CREATE INDEX roleplay_turns_session_sequence_idx ON roleplay_turns(organization_id,session_id,sequence_no);

ALTER TABLE roleplay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE roleplay_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roleplay_sessions USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());
CREATE POLICY tenant_isolation ON roleplay_turns USING(organization_id=app_org_id()) WITH CHECK(organization_id=app_org_id());

GRANT SELECT,INSERT,UPDATE ON roleplay_sessions,roleplay_turns TO hanamaru_api;
GRANT SELECT ON roleplay_sessions,roleplay_turns TO hanamaru_readonly_ops;

CREATE TRIGGER roleplay_sessions_touch BEFORE UPDATE ON roleplay_sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE roleplay_sessions IS 'Private learning history. It is not a personnel score or individual ranking source.';
COMMENT ON TABLE roleplay_turns IS 'Source conversation and qualitative coaching only; numeric scoring and ranking fields are prohibited.';
