CREATE TABLE retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  data_type varchar(30) NOT NULL CHECK(data_type IN ('pdf','audio','transcript','review','audit')), version int NOT NULL CHECK(version>0),
  retention_days int NOT NULL CHECK(retention_days BETWEEN 1 AND 3650), legal_hold_supported boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL CHECK(status IN ('draft','active','retired')), effective_from timestamptz NOT NULL,
  approved_by_membership_id uuid NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,data_type,version), UNIQUE(organization_id,id)
);
CREATE TABLE legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, reason_code varchar(50) NOT NULL, reason_detail_redacted text NULL,
  placed_by_membership_id uuid NOT NULL, placed_at timestamptz NOT NULL, released_by_membership_id uuid NULL, released_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX legal_hold_active ON legal_holds(organization_id,visit_id) WHERE released_at IS NULL;
CREATE TABLE deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, retention_policy_id uuid NULL, request_type varchar(20) NOT NULL CHECK(request_type IN ('retention','early','withdrawal','admin')),
  requested_by_membership_id uuid NOT NULL, reason_code varchar(50) NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('requested','approved','running','partial','succeeded','failed','cancelled','held')),
  requested_at timestamptz NOT NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL, completed_at timestamptz NULL,
  failure_summary_redacted text NULL, job_id uuid NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE deletion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  deletion_request_id uuid NOT NULL, target_type varchar(40) NOT NULL, target_id uuid NULL, storage_object_id uuid NULL,
  sequence_no int NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('pending','blocked','deleting','deleted','failed','skipped')),
  attempt_count int NOT NULL DEFAULT 0, deleted_at timestamptz NULL, error_code varchar(100) NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,deletion_request_id) REFERENCES deletion_requests(organization_id,id) ON DELETE RESTRICT,
  CHECK(num_nonnulls(target_id,storage_object_id)=1), UNIQUE(deletion_request_id,sequence_no)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(), actor_type varchar(20) NOT NULL CHECK(actor_type IN ('user','service','system')),
  actor_id varchar(128) NOT NULL, action varchar(100) NOT NULL, resource_type varchar(50) NOT NULL, resource_id uuid NULL,
  result varchar(20) NOT NULL CHECK(result IN ('allowed','denied','failed')), request_id varchar(64) NOT NULL, trace_id varchar(64) NOT NULL,
  ip_hash char(64) NULL, user_agent_hash char(64) NULL, metadata_redacted jsonb NOT NULL DEFAULT '{}',
  prev_event_hash char(64) NOT NULL, event_hash char(64) NOT NULL
);
CREATE TABLE system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  setting_key varchar(150) NOT NULL, value_type varchar(20) NOT NULL, value_json jsonb NOT NULL,
  schema_version int NOT NULL, effective_from timestamptz NOT NULL, expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,setting_key,effective_from)
);
CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  flag_key varchar(150) NOT NULL, enabled boolean NOT NULL DEFAULT false, target_rule jsonb NOT NULL DEFAULT '{}',
  owner_membership_id uuid NOT NULL, expires_at timestamptz NULL, rollback_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,flag_key)
);
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_events are append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
