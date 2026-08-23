import {randomUUID} from "node:crypto";
import {HanamaruRepository,createPool} from "@hanamaru/database";
import {createLocalProviders} from "@hanamaru/platform";
import {describe,expect,it,vi} from "vitest";
import {cleanupExpiredUploadObjects,WorkerProcessor} from "./processor.js";

const databaseUrl=process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("expired incomplete upload cleanup",()=>{
  it("removes the external object, upload session, and deletion fence",async()=>{
    const organizationId="00000000-0000-4000-8000-000000000001";
    const visitId="00000000-0000-4000-8000-000000001000";
    const membershipId="00000000-0000-4000-8000-000000000100";
    const uploadId=randomUUID();
    const jobId=randomUUID();
    const objectName=`organizations/${organizationId}/visits/${visitId}/documents/${uploadId}`;
    const pool=createPool(databaseUrl);
    const repository=new HanamaruRepository(pool);
    const deleteIncompleteUpload=vi.fn().mockResolvedValue(undefined);
    try{
      await pool.query(
        `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,status,idempotency_key,input_hash,input_redacted,requested_by_membership_id,started_at,lease_expires_at)
         VALUES($1,$2,'retention_scan','organization',$2,'running',$3,$4,'{}',$5,now(),now()+interval '5 minutes')`,
        [jobId,organizationId,`cleanup-${jobId}`,"0".repeat(64),membershipId],
      );
      await pool.query(
        `INSERT INTO upload_sessions(id,organization_id,visit_id,upload_type,object_name,mime_type,size_bytes,sha256,requested_by_membership_id,expires_at)
         VALUES($1,$2,$3,'document',$4,'application/pdf',4,$5,$6,now()-interval '25 hours')`,
        [uploadId,organizationId,visitId,objectName,"a".repeat(64),membershipId],
      );
      const deleted=await cleanupExpiredUploadObjects(
        repository,
        {deleteIncompleteUpload} as never,
        {requestId:`cleanup-${jobId}`,traceId:jobId,organizationId,membershipId,branchId:"00000000-0000-4000-8000-000000000002",roles:[],capabilities:[],authorizationScopes:[]},
        {id:jobId,organization_id:organizationId},
      );
      expect(deleted).toBe(1);
      expect(deleteIncompleteUpload).toHaveBeenCalledWith(objectName);
      expect((await pool.query("SELECT 1 FROM upload_sessions WHERE id=$1",[uploadId])).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM visit_deletion_fences WHERE job_id=$1",[jobId])).rowCount).toBe(0);
    }finally{
      await pool.query("DELETE FROM upload_sessions WHERE id=$1",[uploadId]);
      await pool.query("DELETE FROM visit_deletion_fences WHERE job_id=$1",[jobId]);
      await pool.query("DELETE FROM jobs WHERE id=$1",[jobId]);
      await repository.close();
    }
  });
});

describe.skipIf(!databaseUrl)("durable Chirp 3 operation polling",()=>{
  it("commits one STT operation and durably retries post-STT quality assessment to success",async()=>{
    const organizationId="00000000-0000-4000-8000-000000000001";
    const visitId="00000000-0000-4000-8000-000000001000";
    const membershipId="00000000-0000-4000-8000-000000000100";
    const storageId=randomUUID();
    const consentId=randomUUID();
    const recordingId=randomUUID();
    const jobId=randomUUID();
    const operationId=`operations/${randomUUID()}`;
    const pool=createPool(databaseUrl);
    const repository=new HanamaruRepository(pool);
    const providers=createLocalProviders();
    const startTranscription=vi.fn(async()=>{
      const state=await pool.query<{phase:string;provider_operation_id:string|null}>("SELECT provider_operation_state->>'phase' phase,provider_operation_id FROM jobs WHERE id=$1",[jobId]);
      expect(state.rows[0]).toEqual({phase:"starting",provider_operation_id:null});
      return{providerOperationId:operationId,cleanupToken:"local-validation/stt-input/integration"};
    });
    let pollCount=0;
    const pollTranscription=vi.fn(async(receivedOperationId:string)=>{
      expect(receivedOperationId).toBe(operationId);
      const persisted=await pool.query<{provider_operation_id:string;phase:string}>("SELECT provider_operation_id,provider_operation_state->>'phase' phase FROM jobs WHERE id=$1",[jobId]);
      expect(persisted.rows[0]).toEqual({provider_operation_id:operationId,phase:"polling"});
      pollCount+=1;
      if(pollCount===1)return{status:"pending" as const};
      return{status:"succeeded" as const,result:{provider:"google-cloud-speech-to-text-v2" as const,model:"chirp_3" as const,location:"asia-northeast1",providerOperationId:operationId,fullText:"匿名の文字起こし結果",segments:[{startMs:0,endMs:1000,speakerLabel:"1",speakerRole:"unknown" as const,text:"匿名の文字起こし結果",confidence:.99}]}};
    });
    const cleanupTranscription=vi.fn().mockResolvedValue(undefined);
    providers.speech={...providers.speech,startTranscription,pollTranscription,cleanupTranscription};
    const localAssessTranscriptQuality=providers.ai.assessTranscriptQuality.bind(providers.ai);
    const assessTranscriptQuality=vi.fn()
      .mockRejectedValueOnce(new Error("PROVIDER_PERMANENT: invalid transcript quality model output"))
      .mockImplementation(localAssessTranscriptQuality);
    providers.ai={...providers.ai,assessTranscriptQuality};
    const processor=new WorkerProcessor(repository,{...providers,mode:"gcp"},"durable-lro-test");
    try{
      const policies=await pool.query<{data_type:string;id:string}>("SELECT data_type,id FROM retention_policies WHERE organization_id=$1 AND data_type IN ('audio','transcript') AND status='active'",[organizationId]);
      const policy=Object.fromEntries(policies.rows.map(row=>[row.data_type,row.id]));
      await pool.query(`INSERT INTO recording_consents(id,organization_id,visit_id,status,method,notice_version,notice_hash,explained_by_membership_id,recorded_by_membership_id,occurred_at) VALUES($1,$2,$3,'granted','verbal','integration-v1',repeat('0',64),$4,$4,now())`,[consentId,organizationId,visitId,membershipId]);
      await pool.query(`INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id) VALUES($1,$2,'integration-private',$3,1,'recording','available','audio/mp4',4,$4,now()+interval '90 days',$5)`,[storageId,organizationId,`organizations/${organizationId}/visits/${visitId}/recordings/${recordingId}`,"a".repeat(64),policy.audio]);
      await pool.query(`INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,status,retention_until,retention_policy_id,uploaded_by_membership_id,duration_ms,media_metadata) VALUES($1,$2,$3,$4,$5,'upload','ready',now()+interval '90 days',$6,$7,1000,'{}')`,[recordingId,organizationId,visitId,consentId,storageId,policy.audio,membershipId]);
      await pool.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id) VALUES($1,$2,'transcribe','recording',$3,$4,$5,'{"languageCode":"ja-JP"}',200,$6)`,[jobId,organizationId,recordingId,`durable-${jobId}`,"0".repeat(64),membershipId]);

      await expect(processor.process(jobId,"durable-start")).resolves.toBe("retry_wait");
      const deferred=await pool.query<{status:string;attempt_count:number;max_attempts:number;provider_operation_id:string;provider_operation_state:Record<string,unknown>;available_at:Date}>("SELECT status,attempt_count,max_attempts,provider_operation_id,provider_operation_state,available_at FROM jobs WHERE id=$1",[jobId]);
      expect(deferred.rows[0]).toMatchObject({status:"retry_wait",attempt_count:1,max_attempts:200,provider_operation_id:operationId,provider_operation_state:{phase:"polling",cleanupToken:"local-validation/stt-input/integration"}});
      const outbox=await pool.query<{deduplication_key:string;available_at:Date}>("SELECT deduplication_key,available_at FROM outbox_events WHERE aggregate_id=$1 AND deduplication_key=$2",[jobId,`job:${jobId}:attempt:1`]);
      expect(outbox.rows[0]?.deduplication_key).toBe(`job:${jobId}:attempt:1`);
      expect(outbox.rows[0]?.available_at.toISOString()).toBe(deferred.rows[0]?.available_at.toISOString());
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(pollTranscription).toHaveBeenCalledTimes(1);

      await pool.query("UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",[jobId]);
      await expect(processor.process(jobId,"durable-poll")).resolves.toBe("retry_wait");
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(pollTranscription).toHaveBeenCalledTimes(2);
      expect(pollTranscription).toHaveBeenNthCalledWith(1,operationId);
      expect(pollTranscription).toHaveBeenNthCalledWith(2,operationId);
      expect(cleanupTranscription).not.toHaveBeenCalled();
      const qualityUnavailable=await pool.query<{status:string;model_name:string|null;failure_class:string|null;flags:string[]}>("SELECT status,model_name,failure_class,flags FROM transcript_quality_assessments WHERE transcript_id=(SELECT id FROM transcripts WHERE job_id=$1)",[jobId]);
      expect(qualityUnavailable.rows[0]).toEqual({status:"assessment_unavailable",model_name:null,failure_class:"MODEL_OUTPUT_INVALID",flags:["assessment_unavailable"]});
      await pool.query(
        `INSERT INTO operational_alerts(organization_id,job_id,failure_class,job_type,severity,attempt,max_attempts,oldest_age_seconds)
         VALUES($1,$2,'MODEL_OUTPUT_INVALID','transcribe','critical',2,200,60)`,
        [organizationId,jobId],
      );

      await pool.query("UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",[jobId]);
      await expect(processor.process(jobId,"durable-quality-retry")).resolves.toBe("succeeded");
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(pollTranscription).toHaveBeenCalledTimes(2);
      expect(cleanupTranscription).toHaveBeenCalledWith("local-validation/stt-input/integration");
      const completed=await pool.query<{status:string;attempt_count:number;input_redacted:Record<string,unknown>;provider_operation_state:Record<string,unknown>}>("SELECT status,attempt_count,input_redacted,provider_operation_state FROM jobs WHERE id=$1",[jobId]);
      expect(completed.rows[0]).toEqual({status:"succeeded",attempt_count:3,input_redacted:{},provider_operation_state:{}});
      const transcript=await pool.query<{provider_operation_id:string;full_text:string}>("SELECT provider_operation_id,full_text FROM transcripts WHERE organization_id=$1 AND job_id=$2",[organizationId,jobId]);
      expect(transcript.rows[0]).toEqual({provider_operation_id:operationId,full_text:"匿名の文字起こし結果"});
      expect(assessTranscriptQuality).toHaveBeenCalledTimes(2);
      const quality=await pool.query<{status:string;model_name:string|null;failure_class:string|null;flags:string[]}>("SELECT status,model_name,failure_class,flags FROM transcript_quality_assessments WHERE transcript_id=(SELECT id FROM transcripts WHERE job_id=$1)",[jobId]);
      expect(quality.rows[0]).toEqual({status:"evaluated",model_name:"test-deterministic-v1",failure_class:null,flags:[]});
      expect((await pool.query<{status:string}>("SELECT status FROM operational_alerts WHERE job_id=$1 AND failure_class='MODEL_OUTPUT_INVALID'",[jobId])).rows[0]?.status).toBe("resolved");
    }finally{
      await pool.query("DELETE FROM operational_alerts WHERE job_id=$1",[jobId]);
      await pool.query("DELETE FROM transcript_quality_evidence WHERE transcript_id IN (SELECT id FROM transcripts WHERE job_id=$1)",[jobId]);
      await pool.query("DELETE FROM transcript_quality_assessments WHERE transcript_id IN (SELECT id FROM transcripts WHERE job_id=$1)",[jobId]);
      await pool.query("DELETE FROM transcript_segments WHERE transcript_id IN (SELECT id FROM transcripts WHERE job_id=$1)",[jobId]);
      await pool.query("DELETE FROM transcripts WHERE job_id=$1",[jobId]);
      await pool.query("DELETE FROM outbox_events WHERE aggregate_id=$1",[jobId]);
      await pool.query("DELETE FROM job_attempts WHERE job_id=$1",[jobId]);
      await pool.query("DELETE FROM jobs WHERE id=$1",[jobId]);
      await pool.query("DELETE FROM recordings WHERE id=$1",[recordingId]);
      await pool.query("DELETE FROM recording_consents WHERE id=$1",[consentId]);
      await pool.query("DELETE FROM storage_objects WHERE id=$1",[storageId]);
      await repository.close();
    }
  });
  it("rechecks cancellation before deferring a pending operation and removes its temporary input",async()=>{
    const organizationId="00000000-0000-4000-8000-000000000001";
    const visitId="00000000-0000-4000-8000-000000001000";
    const membershipId="00000000-0000-4000-8000-000000000100";
    const storageId=randomUUID();const consentId=randomUUID();const recordingId=randomUUID();const jobId=randomUUID();
    const operationId=`operations/${randomUUID()}`;const cleanupToken=`local-validation/stt-input/cancel-${randomUUID()}`;
    const pool=createPool(databaseUrl);const repository=new HanamaruRepository(pool);const providers=createLocalProviders();
    const startTranscription=vi.fn().mockResolvedValue({providerOperationId:operationId,cleanupToken});
    const pollTranscription=vi.fn(async()=>{await pool.query("UPDATE jobs SET cancel_requested_at=now() WHERE id=$1",[jobId]);return{status:"pending" as const};});
    const cleanupTranscription=vi.fn().mockResolvedValue(undefined);
    providers.speech={...providers.speech,startTranscription,pollTranscription,cleanupTranscription};
    const processor=new WorkerProcessor(repository,{...providers,mode:"gcp"},"durable-cancel-test");
    try{
      const policies=await pool.query<{data_type:string;id:string}>("SELECT data_type,id FROM retention_policies WHERE organization_id=$1 AND data_type IN ('audio','transcript') AND status='active'",[organizationId]);const policy=Object.fromEntries(policies.rows.map(row=>[row.data_type,row.id]));
      await pool.query(`INSERT INTO recording_consents(id,organization_id,visit_id,status,method,notice_version,notice_hash,explained_by_membership_id,recorded_by_membership_id,occurred_at) VALUES($1,$2,$3,'granted','verbal','integration-v1',repeat('0',64),$4,$4,now())`,[consentId,organizationId,visitId,membershipId]);
      await pool.query(`INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id) VALUES($1,$2,'integration-private',$3,1,'recording','available','audio/mp4',4,$4,now()+interval '90 days',$5)`,[storageId,organizationId,`organizations/${organizationId}/visits/${visitId}/recordings/${recordingId}`,"b".repeat(64),policy.audio]);
      await pool.query(`INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,status,retention_until,retention_policy_id,uploaded_by_membership_id,duration_ms,media_metadata) VALUES($1,$2,$3,$4,$5,'upload','ready',now()+interval '90 days',$6,$7,1000,'{}')`,[recordingId,organizationId,visitId,consentId,storageId,policy.audio,membershipId]);
      await pool.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id) VALUES($1,$2,'transcribe','recording',$3,$4,$5,'{"languageCode":"ja-JP"}',200,$6)`,[jobId,organizationId,recordingId,`durable-cancel-${jobId}`,"1".repeat(64),membershipId]);
      await expect(processor.process(jobId,"durable-cancel")).resolves.toBe("cancelled");
      expect(startTranscription).toHaveBeenCalledTimes(1);expect(pollTranscription).toHaveBeenCalledTimes(1);expect(cleanupTranscription).toHaveBeenCalledWith(cleanupToken);
      const stored=await pool.query<{status:string;provider_operation_id:string|null;provider_operation_state:Record<string,unknown>;input_redacted:Record<string,unknown>}>("SELECT status,provider_operation_id,provider_operation_state,input_redacted FROM jobs WHERE id=$1",[jobId]);expect(stored.rows[0]).toEqual({status:"cancelled",provider_operation_id:null,provider_operation_state:{},input_redacted:{}});
      expect((await pool.query<{status:string}>("SELECT status FROM recordings WHERE id=$1",[recordingId])).rows[0]?.status).toBe("ready");
    }finally{
      await pool.query("DELETE FROM outbox_events WHERE aggregate_id=$1",[jobId]);await pool.query("DELETE FROM job_attempts WHERE job_id=$1",[jobId]);await pool.query("DELETE FROM jobs WHERE id=$1",[jobId]);await pool.query("DELETE FROM recordings WHERE id=$1",[recordingId]);await pool.query("DELETE FROM recording_consents WHERE id=$1",[consentId]);await pool.query("DELETE FROM storage_objects WHERE id=$1",[storageId]);await repository.close();
    }
  });
});
