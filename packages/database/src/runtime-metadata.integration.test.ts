import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {describe,expect,it} from "vitest";
import {createPool} from "./repository.js";

const databaseUrl=process.env.DATABASE_URL;
const organizationId="00000000-0000-4000-8000-000000000001";
const branchId="00000000-0000-4000-8000-000000000002";
const membershipId="00000000-0000-4000-8000-000000000100";
const inputHash="0".repeat(64);

interface JobInput {
  id:string;
  entityId:string;
  jobType?:"transcribe"|"review";
  status?:"queued"|"succeeded"|"failed"|"cancelled";
  input?:Record<string,unknown>;
  maxAttempts?:number;
  finishedAt?:string|null;
  providerOperationId?:string|null;
  providerOperationState?:unknown;
}

async function insertJob(pool:Pool,input:JobInput):Promise<void>{
  await pool.query(
    `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,status,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id,finished_at,provider_operation_id,provider_operation_state)
     VALUES($1,$2,$3,'visit',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [input.id,organizationId,input.jobType??"review",input.entityId,input.status??"queued",`runtime-${input.id}`,inputHash,input.input??{},input.maxAttempts??5,membershipId,input.finishedAt??null,input.providerOperationId??null,JSON.stringify(input.providerOperationState??{})],
  );
}

describe.skipIf(!databaseUrl)("async provider and runtime metadata physical design",()=>{
  it("allows 200 transcribe attempts, rejects 251, and constrains provider operation state",async()=>{
    const pool=createPool(databaseUrl);
    const acceptedId=randomUUID();
    const duplicateId=randomUUID();
    const tooManyId=randomUUID();
    const invalidStateId=randomUUID();
    const operationId=`operations/${randomUUID()}`;
    try{
      await insertJob(pool,{id:acceptedId,entityId:randomUUID(),jobType:"transcribe",maxAttempts:200,providerOperationId:operationId,providerOperationState:{temporaryInputObject:"temporary/object"}});
      expect((await pool.query<{max_attempts:number;provider_operation_id:string;provider_operation_state:unknown}>("SELECT max_attempts,provider_operation_id,provider_operation_state FROM jobs WHERE id=$1",[acceptedId])).rows[0]).toEqual({max_attempts:200,provider_operation_id:operationId,provider_operation_state:{temporaryInputObject:"temporary/object"}});
      await expect(insertJob(pool,{id:tooManyId,entityId:randomUUID(),jobType:"transcribe",maxAttempts:251})).rejects.toMatchObject({code:"23514"});
      await expect(insertJob(pool,{id:duplicateId,entityId:randomUUID(),jobType:"transcribe",providerOperationId:operationId})).rejects.toMatchObject({code:"23505"});
      await expect(insertJob(pool,{id:invalidStateId,entityId:randomUUID(),jobType:"transcribe",providerOperationState:[]})).rejects.toMatchObject({code:"23514"});
    }finally{
      await pool.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])",[[acceptedId,duplicateId,tooManyId,invalidStateId]]);
      await pool.end();
    }
  });

  it("purges only expired idempotency and redacts old terminal job input",async()=>{
    const pool=createPool(databaseUrl);
    const expiredIdempotencyId=randomUUID();
    const futureIdempotencyId=randomUUID();
    const succeededId=randomUUID();
    const cancelledId=randomUUID();
    const failedId=randomUUID();
    const recentSucceededId=randomUUID();
    const jobIds=[succeededId,cancelledId,failedId,recentSucceededId];
    try{
      await pool.query(
        `INSERT INTO idempotency_records(id,organization_id,membership_id,endpoint_key,idempotency_key,request_hash,response_status,response_body_redacted,expires_at)
         VALUES($1,$3,$4,'runtime.test',$5,$6,200,'{"result":"expired"}',now()-interval '1 minute'),
               ($2,$3,$4,'runtime.test',$7,$6,200,'{"result":"future"}',now()+interval '1 day')`,
        [expiredIdempotencyId,futureIdempotencyId,organizationId,membershipId,`expired-${expiredIdempotencyId}`,inputHash,`future-${futureIdempotencyId}`],
      );
      await insertJob(pool,{id:succeededId,entityId:randomUUID(),status:"succeeded",input:{secret:"succeeded"},finishedAt:"2000-01-01T00:00:00Z"});
      await insertJob(pool,{id:cancelledId,entityId:randomUUID(),status:"cancelled",input:{secret:"cancelled"},finishedAt:"2000-01-01T00:00:00Z"});
      await insertJob(pool,{id:failedId,entityId:randomUUID(),status:"failed",input:{secret:"failed"},finishedAt:"2000-01-01T00:00:00Z"});
      await insertJob(pool,{id:recentSucceededId,entityId:randomUUID(),status:"succeeded",input:{secret:"recent"},finishedAt:new Date().toISOString()});
      const purge=await pool.query<{idempotency_deleted:number;job_inputs_redacted:number}>("SELECT * FROM purge_expired_runtime_metadata(100)");
      expect(purge.rows[0]).toEqual({idempotency_deleted:1,job_inputs_redacted:3});
      expect((await pool.query<{id:string}>("SELECT id FROM idempotency_records WHERE id=ANY($1::uuid[]) ORDER BY id",[[expiredIdempotencyId,futureIdempotencyId]])).rows.map(row=>row.id)).toEqual([futureIdempotencyId]);
      const jobs=await pool.query<{id:string;input_redacted:Record<string,unknown>}>("SELECT id,input_redacted FROM jobs WHERE id=ANY($1::uuid[])",[jobIds]);
      const byId=Object.fromEntries(jobs.rows.map(row=>[row.id,row.input_redacted]));
      expect(byId[succeededId]).toEqual({});
      expect(byId[cancelledId]).toEqual({});
      expect(byId[failedId]).toEqual({});
      expect(byId[recentSucceededId]).toEqual({secret:"recent"});
    }finally{
      await pool.query("DELETE FROM idempotency_records WHERE id=ANY($1::uuid[])",[[expiredIdempotencyId,futureIdempotencyId]]);
      await pool.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])",[jobIds]);
      await pool.end();
    }
  });

  it("redacts only idempotency and job input linked to the selected visit",async()=>{
    const pool=createPool(databaseUrl);
    const targetVisitId=randomUUID();
    const otherVisitId=randomUUID();
    const targetJobId=randomUUID();
    const otherJobId=randomUUID();
    const targetVisitIdempotencyId=randomUUID();
    const targetJobIdempotencyId=randomUUID();
    const otherIdempotencyId=randomUUID();
    const idempotencyIds=[targetVisitIdempotencyId,targetJobIdempotencyId,otherIdempotencyId];
    try{
      await pool.query(
        `INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status)
         VALUES($1,$3,$4,$5,$6,'draft'),($2,$3,$4,$5,$7,'draft')`,
        [targetVisitId,otherVisitId,organizationId,branchId,membershipId,`RUNTIME-${targetVisitId}`,`RUNTIME-${otherVisitId}`],
      );
      await insertJob(pool,{id:targetJobId,entityId:targetVisitId,status:"failed",input:{visit:"target"},finishedAt:"2000-01-01T00:00:00Z"});
      await insertJob(pool,{id:otherJobId,entityId:otherVisitId,status:"failed",input:{visit:"other"},finishedAt:"2000-01-01T00:00:00Z"});
      await pool.query(
        `INSERT INTO idempotency_records(id,organization_id,membership_id,endpoint_key,idempotency_key,request_hash,response_status,response_body_redacted,resource_id,expires_at)
         VALUES($1,$4,$5,'runtime.visit',$6,$7,200,'{"scope":"target-visit"}',$2,now()+interval '1 day'),
               ($8,$4,$5,'runtime.visit',$9,$7,200,'{"scope":"target-job"}',$3,now()+interval '1 day'),
               ($10,$4,$5,'runtime.visit',$11,$7,200,'{"scope":"other"}',$12,now()+interval '1 day')`,
        [targetVisitIdempotencyId,targetVisitId,targetJobId,organizationId,membershipId,`target-visit-${targetVisitId}`,inputHash,targetJobIdempotencyId,`target-job-${targetJobId}`,otherIdempotencyId,`other-${otherVisitId}`,otherVisitId],
      );
      const redacted=await pool.query<{idempotency_deleted:number;job_inputs_redacted:number}>("SELECT * FROM redact_visit_runtime_metadata($1,$2)",[organizationId,targetVisitId]);
      expect(redacted.rows[0]).toEqual({idempotency_deleted:2,job_inputs_redacted:1});
      expect((await pool.query<{id:string}>("SELECT id FROM idempotency_records WHERE id=ANY($1::uuid[])",[idempotencyIds])).rows.map(row=>row.id)).toEqual([otherIdempotencyId]);
      const jobs=await pool.query<{id:string;input_redacted:Record<string,unknown>}>("SELECT id,input_redacted FROM jobs WHERE id=ANY($1::uuid[])",[[targetJobId,otherJobId]]);
      const byId=Object.fromEntries(jobs.rows.map(row=>[row.id,row.input_redacted]));
      expect(byId[targetJobId]).toEqual({});
      expect(byId[otherJobId]).toEqual({visit:"other"});
    }finally{
      await pool.query("DELETE FROM idempotency_records WHERE id=ANY($1::uuid[])",[idempotencyIds]);
      await pool.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])",[[targetJobId,otherJobId]]);
      await pool.query("DELETE FROM visits WHERE id=ANY($1::uuid[])",[[targetVisitId,otherVisitId]]);
      await pool.end();
    }
  });
});
