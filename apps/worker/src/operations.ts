import {randomUUID} from "node:crypto";
import type {OperationalFailureClass,RequestContext} from "@hanamaru/contracts";
import type {HanamaruRepository} from "@hanamaru/database";

export interface OperationalScanAlert{
  organizationId:string;
  jobId:string;
  jobType:string;
  failureClass:OperationalFailureClass;
  severity:"warning"|"critical";
  attempt:number;
  maxAttempts:number;
  oldestAgeSeconds:number;
}

interface CandidateRow{
  organization_id:string;
  membership_id:string;
  job_id:string;
  job_type:string;
  failure_class:OperationalFailureClass;
  severity:"warning"|"critical";
  attempt:number;
  max_attempts:number;
  oldest_age_seconds:number;
}

const candidateSql=`
WITH candidates AS (
  SELECT organization_id,requested_by_membership_id membership_id,id job_id,job_type,
         'STT_HEARTBEAT_STALE'::text failure_class,'warning'::text severity,
         attempt_count attempt,max_attempts,
         GREATEST(0,extract(epoch FROM now()-COALESCE(heartbeat_at,started_at,updated_at))::int) oldest_age_seconds
    FROM jobs WHERE job_type='transcribe' AND status='running'
     AND COALESCE(heartbeat_at,started_at,updated_at)<now()-interval '3 minutes'
  UNION ALL
  SELECT organization_id,requested_by_membership_id,id,job_type,'STT_LRO_TIMEOUT','critical',attempt_count,max_attempts,
         GREATEST(0,extract(epoch FROM now()-provider_operation_started_at)::int)
    FROM jobs WHERE job_type='transcribe' AND provider_operation_id IS NOT NULL
     AND status IN ('running','retry_wait') AND provider_operation_started_at<now()-interval '9 hours'
  UNION ALL
  SELECT organization_id,requested_by_membership_id,id,job_type,'RETRY_WAIT_OVERDUE','warning',attempt_count,max_attempts,
         GREATEST(0,extract(epoch FROM now()-available_at)::int)
    FROM jobs WHERE status='retry_wait' AND available_at<now()-interval '10 minutes'
  UNION ALL
  SELECT j.organization_id,j.requested_by_membership_id,j.id,j.job_type,'MODEL_OUTPUT_INVALID','critical',j.attempt_count,j.max_attempts,
         GREATEST(0,extract(epoch FROM now()-COALESCE(j.finished_at,j.updated_at))::int)
    FROM jobs j WHERE (j.status IN ('failed','retry_wait') AND j.error_code='MODEL_OUTPUT_INVALID')
      OR EXISTS(SELECT 1 FROM transcripts t JOIN transcript_quality_assessments qa ON qa.transcript_id=t.id AND qa.organization_id=t.organization_id
                 WHERE t.organization_id=j.organization_id AND t.job_id=j.id AND qa.failure_class='MODEL_OUTPUT_INVALID')
  UNION ALL
  SELECT j.organization_id,j.requested_by_membership_id,j.id,j.job_type,'EVIDENCE_INVALID','critical',j.attempt_count,j.max_attempts,
         GREATEST(0,extract(epoch FROM now()-COALESCE(j.finished_at,j.updated_at))::int)
    FROM jobs j WHERE (j.status IN ('failed','retry_wait') AND j.error_code='EVIDENCE_INVALID')
      OR EXISTS(SELECT 1 FROM transcripts t JOIN transcript_quality_assessments qa ON qa.transcript_id=t.id AND qa.organization_id=t.organization_id
                 WHERE t.organization_id=j.organization_id AND t.job_id=j.id AND qa.failure_class='EVIDENCE_INVALID')
  UNION ALL
  SELECT organization_id,requested_by_membership_id,id,job_type,'RETRY_LIMIT_EXCEEDED','critical',attempt_count,max_attempts,
         GREATEST(0,extract(epoch FROM now()-COALESCE(finished_at,updated_at))::int)
    FROM jobs WHERE status='failed' AND attempt_count>=max_attempts
)
SELECT * FROM candidates ORDER BY organization_id,job_id,failure_class`;

export async function scanOperations(repository:HanamaruRepository):Promise<OperationalScanAlert[]>{
  const candidates=await repository.system<CandidateRow>(candidateSql);
  const organizations=await repository.system<{organization_id:string;membership_id:string;branch_id:string}>(
    `SELECT o.id organization_id,min(m.id::text)::uuid membership_id,min(m.branch_id::text)::uuid branch_id
       FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.status='active'
      WHERE o.status='active' GROUP BY o.id`,
  );
  const byOrganization=new Map<string,CandidateRow[]>();
  for(const row of candidates.rows){const rows=byOrganization.get(row.organization_id)??[];rows.push(row);byOrganization.set(row.organization_id,rows);}
  for(const organization of organizations.rows){
    const rows=byOrganization.get(organization.organization_id)??[];
    const ctx:RequestContext={
      requestId:`operations-scan-${randomUUID()}`,traceId:randomUUID(),organizationId:organization.organization_id,
      membershipId:organization.membership_id,branchId:organization.branch_id,roles:[],capabilities:[],authorizationScopes:[],
    };
    await repository.withContext(ctx,async tx=>{
      const keys=rows.map(row=>`${row.job_id}:${row.failure_class}`);
      await tx.query(
        `UPDATE operational_alerts SET status='resolved',resolved_at=now(),last_seen_at=now()
          WHERE organization_id=$1 AND status='active'
            AND NOT ((job_id::text||':'||failure_class)=ANY($2::text[]))`,
        [organization.organization_id,keys],
      );
      for(const row of rows)await tx.query(
        `INSERT INTO operational_alerts(organization_id,job_id,failure_class,job_type,severity,attempt,max_attempts,oldest_age_seconds)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(organization_id,job_id,failure_class) WHERE status='active'
         DO UPDATE SET severity=EXCLUDED.severity,attempt=EXCLUDED.attempt,max_attempts=EXCLUDED.max_attempts,
           oldest_age_seconds=EXCLUDED.oldest_age_seconds,last_seen_at=now()`,
        [row.organization_id,row.job_id,row.failure_class,row.job_type,row.severity,row.attempt,row.max_attempts,row.oldest_age_seconds],
      );
      const warning=rows.filter(row=>row.severity==="warning").length;
      const critical=rows.filter(row=>row.severity==="critical").length;
      await tx.query(
        "INSERT INTO operations_scan_runs(organization_id,warning_count,critical_count) VALUES($1,$2,$3)",
        [organization.organization_id,warning,critical],
      );
      await tx.query("DELETE FROM operations_scan_runs WHERE organization_id=$1 AND scanned_at<now()-interval '30 days'",[organization.organization_id]);
    });
  }
  return candidates.rows.map(row=>({
    organizationId:row.organization_id,jobId:row.job_id,jobType:row.job_type,
    failureClass:row.failure_class,severity:row.severity,attempt:row.attempt,
    maxAttempts:row.max_attempts,oldestAgeSeconds:row.oldest_age_seconds,
  }));
}
