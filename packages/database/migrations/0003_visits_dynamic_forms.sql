CREATE TABLE visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL, assigned_membership_id uuid NOT NULL, case_number varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','visited','reviewed','closed','cancelled','deleting','deleted')),
  scheduled_at timestamptz NULL, visited_at timestamptz NULL, closed_at timestamptz NULL,
  customer_label varchar(200) NULL, notes_redacted text NULL CHECK(length(notes_redacted)<=4000),
  lock_version bigint NOT NULL DEFAULT 1, deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,case_number), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE form_schema_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  schema_key varchar(100) NOT NULL, version int NOT NULL CHECK(version>0), json_schema jsonb NOT NULL,
  ui_schema jsonb NOT NULL DEFAULT '{}', status varchar(20) NOT NULL CHECK(status IN ('draft','active','retired')),
  effective_from timestamptz NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,schema_key,version)
);
CREATE UNIQUE INDEX form_schema_one_active ON form_schema_versions(organization_id,schema_key) WHERE status='active';
CREATE TABLE storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  bucket_name varchar(222) NOT NULL, object_name text NOT NULL CHECK(object_name !~* '@|customer|email|phone'),
  object_generation bigint NOT NULL CHECK(object_generation>0), purpose varchar(30) NOT NULL CHECK(purpose IN ('visit_pdf','recording','transcript_raw','review_artifact','quarantine','export')),
  status varchar(20) NOT NULL CHECK(status IN ('pending','available','quarantined','deleting','deleted','failed')),
  mime_type varchar(255) NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0), sha256 char(64) NOT NULL,
  retention_until timestamptz NULL, deleted_at timestamptz NULL, kms_key_version_hash char(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bucket_name,object_name,object_generation), UNIQUE(organization_id,id)
);
CREATE TABLE visit_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL, storage_object_id uuid NOT NULL UNIQUE, document_type varchar(30) NOT NULL DEFAULT 'visit_info',
  original_name_redacted varchar(255) NULL, page_count int NULL CHECK(page_count>0),
  status varchar(20) NOT NULL CHECK(status IN ('uploading','ready','extracting','extracted','failed','deleted')),
  uploaded_by_membership_id uuid NOT NULL, deleted_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,visit_id) REFERENCES visits(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,storage_object_id) REFERENCES storage_objects(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_document_id uuid NOT NULL REFERENCES visit_documents(id) ON DELETE RESTRICT,
  form_schema_version_id uuid NOT NULL REFERENCES form_schema_versions(id) ON DELETE RESTRICT, job_id uuid NULL,
  version int NOT NULL CHECK(version>0), status varchar(20) NOT NULL CHECK(status IN ('generated','editing','confirmed','superseded','failed')),
  provider varchar(100) NOT NULL, model_name varchar(100) NOT NULL, raw_result_storage_object_id uuid NULL,
  confirmed_by_membership_id uuid NULL, confirmed_at timestamptz NULL, lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(visit_document_id,version)
);
CREATE TABLE visit_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_extraction_id uuid NOT NULL REFERENCES document_extractions(id) ON DELETE RESTRICT,
  field_key varchar(150) NOT NULL, value_type varchar(20) NOT NULL CHECK(value_type IN ('text','number','date','boolean','json')),
  text_value text NULL, number_value numeric(20,6) NULL, date_value date NULL, boolean_value boolean NULL, json_value jsonb NULL,
  source_page int NULL CHECK(source_page>0), source_excerpt text NULL CHECK(length(source_excerpt)<=1000), confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1),
  verification_status varchar(20) NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','confirmed','corrected','rejected')),
  verified_by_membership_id uuid NULL, verified_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_extraction_id,field_key), CHECK(num_nonnulls(text_value,number_value,date_value,boolean_value,json_value)=1)
);
