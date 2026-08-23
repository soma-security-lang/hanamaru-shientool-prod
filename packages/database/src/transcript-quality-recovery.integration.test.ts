import {randomUUID} from "node:crypto";
import pg from "pg";
import {describe,expect,it} from "vitest";
import {migrate} from "./migrate.js";
import {developmentIds,seedDevelopment} from "./seed.js";

const databaseUrl=process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("transcript quality recovery migration",()=>{
  it("requeues only safe unacknowledged quality failures without restarting STT",async()=>{
    const admin=new pg.Client({connectionString:databaseUrl});
    await admin.connect();
    const database=`quality_recovery_${Date.now()}_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE DATABASE ${database}`);
    const targetUrl=new URL(databaseUrl!);
    targetUrl.pathname=`/${database}`;
    const pool=new pg.Pool({connectionString:targetUrl.toString()});
    try{
      await migrate(pool,{through:"0050_canonical_feature_flag_rollback_note.sql"});
      await seedDevelopment(pool);
      const policy=(await pool.query<{id:string}>(
        "SELECT id FROM retention_policies WHERE organization_id=$1 AND data_type='audio' AND status='active'",
        [developmentIds.organizationId],
      )).rows[0]!.id;

      const insertFailedQuality=async(acknowledged:boolean)=>{
        const storageId=randomUUID();
        const consentId=randomUUID();
        const recordingId=randomUUID();
        const jobId=randomUUID();
        const transcriptId=randomUUID();
        await pool.query(
          `INSERT INTO recording_consents(id,organization_id,visit_id,status,method,notice_version,notice_hash,explained_by_membership_id,recorded_by_membership_id,occurred_at)
           VALUES($1,$2,$3,'granted','verbal','recovery-v1',repeat('0',64),$4,$4,now())`,
          [consentId,developmentIds.organizationId,developmentIds.visitId,developmentIds.membershipId],
        );
        await pool.query(
          `INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id)
           VALUES($1,$2,'recovery-private',$3,1,'recording','available','audio/mpeg',4,$4,now()+interval '90 days',$5)`,
          [storageId,developmentIds.organizationId,`quality-recovery/${recordingId}`,"a".repeat(64),policy],
        );
        await pool.query(
          `INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,status,retention_until,retention_policy_id,uploaded_by_membership_id,duration_ms,media_metadata)
           VALUES($1,$2,$3,$4,$5,'upload','transcribed',now()+interval '90 days',$6,$7,1000,'{}')`,
          [recordingId,developmentIds.organizationId,developmentIds.visitId,consentId,storageId,policy,developmentIds.membershipId],
        );
        await pool.query(
          `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,status,idempotency_key,input_hash,input_redacted,attempt_count,max_attempts,requested_by_membership_id,finished_at)
           VALUES($1,$2,'transcribe','recording',$3,'succeeded',$4,$5,'{}',2,200,$6,now())`,
          [jobId,developmentIds.organizationId,recordingId,`recovery-${jobId}`,"b".repeat(64),developmentIds.membershipId],
        );
        await pool.query(
          `INSERT INTO transcripts(id,organization_id,recording_id,job_id,version,status,provider,model_name,full_text,retention_until,retention_policy_id)
           VALUES($1,$2,$3,$4,1,'generated','google-cloud-speech-to-text-v2','chirp_3','匿名文字起こし',now()+interval '180 days',$5)`,
          [transcriptId,developmentIds.organizationId,recordingId,jobId,policy],
        );
        await pool.query(
          `INSERT INTO transcript_quality_assessments(
             organization_id,transcript_id,status,failure_class,flags,metrics,continuation_decision,acknowledged_by_membership_id,acknowledged_at
           ) VALUES($1,$2,'assessment_unavailable','MODEL_OUTPUT_INVALID',ARRAY['assessment_unavailable']::text[],'{}',$3,$4,$5)`,
          [
            developmentIds.organizationId,
            transcriptId,
            acknowledged?"continue":null,
            acknowledged?developmentIds.membershipId:null,
            acknowledged?new Date():null,
          ],
        );
        return{jobId,transcriptId};
      };

      const recoverable=await insertFailedQuality(false);
      const acknowledged=await insertFailedQuality(true);
      const result=await migrate(pool);
      expect(result.applied).toContain("0051_retry_unavailable_transcript_quality.sql");

      const recoveredJob=await pool.query<{status:string;attempt_count:number;max_attempts:number;finished_at:Date|null;error_code:string|null}>(
        "SELECT status,attempt_count,max_attempts,finished_at,error_code FROM jobs WHERE id=$1",
        [recoverable.jobId],
      );
      expect(recoveredJob.rows[0]).toEqual({status:"retry_wait",attempt_count:2,max_attempts:202,finished_at:null,error_code:"MODEL_OUTPUT_INVALID"});
      expect((await pool.query<{deduplication_key:string}>(
        "SELECT deduplication_key FROM outbox_events WHERE aggregate_id=$1",
        [recoverable.jobId],
      )).rows[0]?.deduplication_key).toBe(`quality-recovery:0051:${recoverable.jobId}`);

      const protectedJob=await pool.query<{status:string;finished_at:Date|null}>(
        "SELECT status,finished_at FROM jobs WHERE id=$1",
        [acknowledged.jobId],
      );
      expect(protectedJob.rows[0]?.status).toBe("succeeded");
      expect(protectedJob.rows[0]?.finished_at).toBeInstanceOf(Date);
      expect((await pool.query("SELECT 1 FROM outbox_events WHERE aggregate_id=$1",[acknowledged.jobId])).rowCount).toBe(0);

      expect((await pool.query("SELECT 1 FROM transcripts WHERE id IN ($1,$2)",[recoverable.transcriptId,acknowledged.transcriptId])).rowCount).toBe(2);
    }finally{
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    }
  },120_000);
});
