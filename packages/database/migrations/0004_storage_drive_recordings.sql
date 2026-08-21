CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, upload_type varchar(20) NOT NULL CHECK(upload_type IN ('document','recording')),
  object_name text NOT NULL, mime_type varchar(255) NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0), sha256 char(64) NOT NULL,
  consent_id uuid NULL, requested_by_membership_id uuid NOT NULL, expires_at timestamptz NOT NULL,
  completed_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE external_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, provider varchar(20) NOT NULL CHECK(provider='google_drive'), provider_account_id_hash char(64) NOT NULL,
  refresh_token_ciphertext bytea NOT NULL, token_key_version varchar(100) NOT NULL, scopes text[] NOT NULL,
  expires_at timestamptz NULL, revoked_at timestamptz NULL, last_verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX external_connection_active ON external_connections(organization_id,membership_id,provider) WHERE revoked_at IS NULL;
CREATE TABLE recording_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('granted','declined','withdrawn')),
  method varchar(20) NOT NULL DEFAULT 'verbal' CHECK(method IN ('verbal','written','other')),
  notice_version varchar(50) NOT NULL, explained_by_membership_id uuid NOT NULL, recorded_by_membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, withdrawn_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  CHECK((status='withdrawn')=(withdrawn_at IS NOT NULL)), UNIQUE(organization_id,id)
);
CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, consent_id uuid NOT NULL, storage_object_id uuid NOT NULL UNIQUE,
  source_type varchar(20) NOT NULL CHECK(source_type IN ('upload','drive','browser')), captured_at timestamptz NULL,
  duration_ms bigint NULL CHECK(duration_ms>=0), status varchar(30) NOT NULL CHECK(status IN ('uploading','ready','transcribing','transcribed','failed','deleting','deleted')),
  retention_until timestamptz NOT NULL, uploaded_by_membership_id uuid NOT NULL, deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,consent_id) REFERENCES recording_consents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,storage_object_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);
CREATE TABLE drive_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, requested_by_membership_id uuid NOT NULL, external_connection_id uuid NOT NULL REFERENCES external_connections(id) ON DELETE RESTRICT,
  drive_file_id_ciphertext bytea NOT NULL, drive_file_version_hash char(64) NOT NULL, drive_file_name_redacted varchar(255) NULL,
  source_modified_at timestamptz NULL, source_size_bytes bigint NULL CHECK(source_size_bytes>=0), destination_storage_object_id uuid NULL,
  status varchar(20) NOT NULL CHECK(status IN ('queued','copying','succeeded','failed','cancelled')), job_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,visit_id,drive_file_version_hash)
);
