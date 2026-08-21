CREATE TABLE transcript_quality_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transcript_id uuid NOT NULL,
  status varchar(32) NOT NULL CHECK(status IN ('evaluated','assessment_unavailable')),
  model_name varchar(100) NULL,
  failure_class varchar(40) NULL CHECK(failure_class IN ('MODEL_OUTPUT_INVALID','EVIDENCE_INVALID')),
  flags text[] NOT NULL DEFAULT '{}',
  confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1),
  metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='object'),
  continuation_decision varchar(20) NULL CHECK(continuation_decision IN ('continue','replace')),
  acknowledged_by_membership_id uuid NULL,
  acknowledged_at timestamptz NULL,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,transcript_id) REFERENCES transcripts(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id),
  UNIQUE(transcript_id),
  CHECK(flags <@ ARRAY['many_speakers','possible_media','long_non_dialogue','assessment_unavailable']::text[]),
  CHECK(
    (status='assessment_unavailable' AND flags @> ARRAY['assessment_unavailable']::text[])
    OR (status='evaluated' AND NOT flags @> ARRAY['assessment_unavailable']::text[])
  ),
  CHECK(status='assessment_unavailable' OR failure_class IS NULL),
  CHECK((continuation_decision IS NULL)=(acknowledged_at IS NULL)),
  CHECK((acknowledged_by_membership_id IS NULL)=(acknowledged_at IS NULL))
);

CREATE UNIQUE INDEX transcript_segments_transcript_id_id_unique
  ON transcript_segments(transcript_id,id);

CREATE TABLE transcript_quality_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assessment_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  transcript_segment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,assessment_id) REFERENCES transcript_quality_assessments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(transcript_id,transcript_segment_id) REFERENCES transcript_segments(transcript_id,id) ON DELETE RESTRICT,
  UNIQUE(assessment_id,transcript_segment_id)
);

CREATE TABLE operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  failure_class varchar(40) NOT NULL CHECK(failure_class IN (
    'STT_HEARTBEAT_STALE','STT_LRO_TIMEOUT','RETRY_WAIT_OVERDUE',
    'MODEL_OUTPUT_INVALID','EVIDENCE_INVALID','RETRY_LIMIT_EXCEEDED'
  )),
  job_type varchar(40) NOT NULL,
  severity varchar(20) NOT NULL CHECK(severity IN ('warning','critical')),
  attempt int NOT NULL CHECK(attempt>=0),
  max_attempts int NOT NULL CHECK(max_attempts>0),
  oldest_age_seconds int NOT NULL CHECK(oldest_age_seconds>=0),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  FOREIGN KEY(organization_id,job_id) REFERENCES jobs(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,id)
);

CREATE UNIQUE INDEX operational_alert_active_unique
  ON operational_alerts(organization_id,job_id,failure_class) WHERE status='active';
CREATE INDEX operational_alert_active_list
  ON operational_alerts(organization_id,severity,detected_at DESC) WHERE status='active';

CREATE TABLE operations_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  warning_count int NOT NULL CHECK(warning_count>=0),
  critical_count int NOT NULL CHECK(critical_count>=0),
  UNIQUE(organization_id,id)
);
CREATE INDEX operations_scan_runs_latest ON operations_scan_runs(organization_id,scanned_at DESC);

ALTER TABLE transcript_quality_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_quality_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY transcript_quality_assessments_org_isolation ON transcript_quality_assessments
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
ALTER TABLE transcript_quality_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_quality_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY transcript_quality_evidence_org_isolation ON transcript_quality_evidence
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
ALTER TABLE operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY operational_alerts_org_isolation ON operational_alerts
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());
ALTER TABLE operations_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_scan_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_scan_runs_org_isolation ON operations_scan_runs
  USING (organization_id=app_org_id()) WITH CHECK (organization_id=app_org_id());

GRANT SELECT,INSERT,UPDATE ON transcript_quality_assessments TO hanamaru_api,hanamaru_worker;
GRANT SELECT,INSERT,DELETE ON transcript_quality_evidence TO hanamaru_api,hanamaru_worker;
GRANT SELECT ON operational_alerts,operations_scan_runs TO hanamaru_api;
GRANT SELECT,INSERT,UPDATE ON operational_alerts TO hanamaru_worker;
GRANT SELECT,INSERT,DELETE ON operations_scan_runs TO hanamaru_worker;
GRANT SELECT ON jobs,organizations,operational_alerts,transcripts,transcript_quality_assessments TO hanamaru_worker_system;

INSERT INTO transcript_quality_assessments(
  organization_id,transcript_id,status,flags,confidence,metrics
)
SELECT t.organization_id,t.id,'assessment_unavailable',ARRAY['assessment_unavailable']::text[],NULL,
       jsonb_build_object(
         'segmentCount',count(s.id)::int,
         'chunkCount',count(DISTINCT split_part(COALESCE(s.speaker_label,'unknown'),':',1)) FILTER(WHERE s.id IS NOT NULL)::int,
         'maxLabelsPerChunk',0,
         'speechOccupancyRatio',0
       )
  FROM transcripts t
  LEFT JOIN transcript_segments s ON s.transcript_id=t.id
 GROUP BY t.organization_id,t.id
ON CONFLICT(transcript_id) DO NOTHING;
