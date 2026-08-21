CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  recording_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, version int NOT NULL CHECK(version>0),
  status varchar(20) NOT NULL CHECK(status IN ('generated','editing','confirmed','superseded','deleting','deleted')),
  provider varchar(100) NOT NULL, model_name varchar(100) NOT NULL, language_code varchar(20) NOT NULL DEFAULT 'ja-JP',
  full_text text NOT NULL, raw_result_storage_object_id uuid NULL, confirmed_by_membership_id uuid NULL, confirmed_at timestamptz NULL,
  retention_until timestamptz NOT NULL, lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,recording_id) REFERENCES recordings(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(recording_id,version), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX transcript_one_current ON transcripts(recording_id) WHERE status IN ('generated','editing','confirmed');
CREATE TABLE transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transcript_id uuid NOT NULL, sequence_no int NOT NULL CHECK(sequence_no>=0), start_ms bigint NOT NULL CHECK(start_ms>=0),
  end_ms bigint NOT NULL CHECK(end_ms>=start_ms), speaker_label varchar(50) NULL,
  speaker_role varchar(30) NOT NULL DEFAULT 'unknown' CHECK(speaker_role IN ('staff','customer','unknown')),
  text text NOT NULL, confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1), edited_text text NULL,
  edited_by_membership_id uuid NULL, edited_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,transcript_id) REFERENCES transcripts(organization_id,id) ON DELETE RESTRICT, UNIQUE(transcript_id,sequence_no), UNIQUE(organization_id,id)
);
CREATE TABLE prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  purpose varchar(40) NOT NULL CHECK(purpose IN ('pdf_extract','review')), version int NOT NULL CHECK(version>0),
  system_instruction text NOT NULL, output_json_schema jsonb NOT NULL, model_name varchar(100) NOT NULL, model_parameters jsonb NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL CHECK(status IN ('draft','provisional','approved','retired')), approved_by_membership_id uuid NULL,
  approved_at timestamptz NULL, effective_from timestamptz NULL, source_commit_sha char(40) NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,purpose,version)
);
CREATE TABLE review_criteria_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  criteria_key varchar(100) NOT NULL, version int NOT NULL CHECK(version>0), criteria_json jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('draft','provisional','approved','retired')),
  approved_by_membership_id uuid NULL, approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,criteria_key,version)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transcript_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, version int NOT NULL CHECK(version>0),
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  criteria_version_id uuid NOT NULL REFERENCES review_criteria_versions(id) ON DELETE RESTRICT,
  model_name varchar(100) NOT NULL, input_hash char(64) NOT NULL, summary text NOT NULL, structured_result jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('generated','acknowledged','superseded','withdrawn','deleting','deleted')),
  acknowledged_by_membership_id uuid NULL, acknowledged_at timestamptz NULL, retention_until timestamptz NOT NULL,
  lock_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,transcript_id) REFERENCES transcripts(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(transcript_id,version), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX review_input_unique ON reviews(transcript_id,input_hash,prompt_version_id,criteria_version_id) WHERE status NOT IN ('deleted','withdrawn');
CREATE TABLE review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL, sequence_no int NOT NULL CHECK(sequence_no>=0),
  category varchar(60) NOT NULL CHECK(category IN ('strength','improvement','talk','compliance','next_action','revisit')),
  finding_type varchar(30) NOT NULL CHECK(finding_type IN ('strength','improvement','warning','unknown')),
  severity varchar(20) NOT NULL CHECK(severity IN ('info','low','medium','high')), title varchar(200) NOT NULL,
  description text NOT NULL, recommended_action text NULL, confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_id) REFERENCES reviews(organization_id,id) ON DELETE RESTRICT, UNIQUE(review_id,sequence_no), UNIQUE(organization_id,id)
);
CREATE TABLE review_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  review_finding_id uuid NOT NULL, transcript_segment_id uuid NOT NULL, excerpt text NOT NULL CHECK(length(excerpt)<=1000),
  excerpt_hash char(64) NOT NULL, start_ms bigint NULL, end_ms bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_finding_id) REFERENCES review_findings(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,transcript_segment_id) REFERENCES transcript_segments(organization_id,id) ON DELETE RESTRICT,
  CHECK(start_ms IS NULL OR end_ms>=start_ms), UNIQUE(review_finding_id,transcript_segment_id)
);
CREATE TABLE review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL, author_membership_id uuid NOT NULL, comment_type varchar(20) NOT NULL CHECK(comment_type IN ('note','correction','question')),
  body text NOT NULL CHECK(length(body)<=4000), edited_at timestamptz NULL, deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_id) REFERENCES reviews(organization_id,id) ON DELETE RESTRICT
);
