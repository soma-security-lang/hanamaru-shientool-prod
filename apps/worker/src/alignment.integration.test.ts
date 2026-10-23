import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import {createPool,developmentIds as d} from "@hanamaru/database";
import {localPrisma,PrismaRepository} from "@hanamaru/alignment";
import {createLocalProviders} from "@hanamaru/platform";
import {WorkerProcessor} from "./processor.js";
import {dispatchOnce} from "./dispatcher.js";
const url=process.env.ALIGNMENT_DATABASE_URL;
describe.skipIf(!url)("Prisma Worker with unchanged jobs and SQL ownership",()=>{
 it("claims an identification once and persists the same result and audit trail",async()=>{
  const pool=createPool(url),repo=new PrismaRepository(localPrisma(url!),url!,"hanamaru_worker","hanamaru_worker_system"),providers=createLocalProviders(),id=randomUUID(),product=randomUUID();
  try{
   await pool.query("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_search'",[d.organizationId]);
   await pool.query(`INSERT INTO market_price_identifications(id,organization_id,branch_id,created_by_membership_id,status,input_mode,expires_at,input_redacted) VALUES($1,$2,$3,$4,'analyzing','manual_assisted',now()+interval '1 day','{"productName":"Synthetic camera","conditions":["good"]}')`,[product,d.organizationId,d.branchId,d.membershipId]);
   await pool.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1::uuid,$2,'market_price_identification','market_price_identification',$3,$1::text,repeat('0',64),'{}',$4)`,[id,d.organizationId,product,d.membershipId]);
   const worker=new WorkerProcessor(repo,providers,"synthetic-prisma-worker");
   const result=await worker.process(id);
   expect(result).toBe("succeeded");
   expect(await worker.process(id)).toBe("not_claimed");
   expect((await pool.query("SELECT status,attempt_count FROM jobs WHERE id=$1",[id])).rows[0]).toMatchObject({status:"succeeded",attempt_count:1});
   expect((await pool.query("SELECT status FROM market_price_identifications WHERE id=$1",[product])).rows[0].status).toBe("suggestion_ready");
   expect((await pool.query("SELECT id FROM audit_events WHERE resource_id=$1",[id])).rowCount).toBeGreaterThan(0);
  }finally{await repo.close();await pool.end();}
 });
 it("dispatches an outbox record without deserializing a SQL void result",async()=>{
  const pool=createPool(url),repo=new PrismaRepository(localPrisma(url!),url!,"hanamaru_worker","hanamaru_worker_system"),id=randomUUID(),event=randomUUID();
  try{
   await pool.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1::uuid,$2,'preparation','visit',$3,$1::text,repeat('0',64),'{}',$4)`,[id,d.organizationId,d.visitId,d.membershipId]);
   await pool.query(`INSERT INTO outbox_events(id,organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1::uuid,$2,'job.dispatch','job',$3,'{"job_type":"preparation"}',$1::text)`,[event,d.organizationId,id]);
   expect((await dispatchOnce(repo,createLocalProviders().tasks,100)).published).toBeGreaterThan(0);
   expect((await pool.query("SELECT published_at FROM outbox_events WHERE id=$1",[event])).rows[0].published_at).not.toBeNull();
  }finally{await repo.close();await pool.end();}
 });
});
