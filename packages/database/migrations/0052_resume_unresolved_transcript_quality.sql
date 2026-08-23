-- A 0051 recovery event could be consumed by the previous Worker revision
-- while a rolling release was in progress. Re-open any still-unresolved safe
-- assessment with a new deduplication key. The transcript and segments are
-- reused; Speech-to-Text is never submitted again.
WITH recoverable AS (
  SELECT j.id,j.organization_id,j.attempt_count,j.max_attempts,qa.failure_class
    FROM transcript_quality_assessments qa
    JOIN transcripts t ON t.organization_id=qa.organization_id AND t.id=qa.transcript_id
    JOIN recordings r ON r.organization_id=t.organization_id AND r.id=t.recording_id
    JOIN visits v ON v.organization_id=r.organization_id AND v.id=r.visit_id
    JOIN jobs j ON j.organization_id=t.organization_id AND j.id=t.job_id AND j.job_type='transcribe'
   WHERE qa.status='assessment_unavailable'
     AND qa.failure_class IN ('MODEL_OUTPUT_INVALID','EVIDENCE_INVALID')
     AND qa.continuation_decision IS NULL
     AND t.status IN ('generated','editing','confirmed')
     AND r.status='transcribed'
     AND v.status NOT IN ('deleting','deleted')
     AND j.status='succeeded'
     AND j.cancel_requested_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM reviews rv WHERE rv.organization_id=t.organization_id AND rv.transcript_id=t.id AND rv.status<>'deleted')
     AND NOT EXISTS(SELECT 1 FROM visit_deletion_fences f WHERE f.organization_id=v.organization_id AND f.visit_id=v.id)
), reset AS (
  UPDATE jobs j
     SET status='retry_wait',available_at=now(),finished_at=NULL,
         max_attempts=GREATEST(j.max_attempts,j.attempt_count+200),
         error_code=r.failure_class,
         error_detail_redacted='Transcript quality assessment retry scheduled',
         updated_at=now()
    FROM recoverable r
   WHERE j.id=r.id AND j.organization_id=r.organization_id
  RETURNING j.id,j.organization_id,j.attempt_count
)
INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key,available_at)
SELECT organization_id,'job.dispatch','job',id,
       jsonb_build_object('job_id',id,'job_type','transcribe','reason','quality_recovery'),
       'quality-recovery:0052:'||id,now()
  FROM reset
ON CONFLICT(organization_id,deduplication_key) DO NOTHING;
