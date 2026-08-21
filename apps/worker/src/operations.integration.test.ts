import {createHash,randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {HanamaruRepository,createPool,developmentIds} from "@hanamaru/database";
import {scanOperations} from "./operations.js";

const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("operations scan with PostgreSQL",()=>{
  let repository:HanamaruRepository;
  beforeAll(()=>{repository=new HanamaruRepository(createPool(databaseUrl));});
  afterAll(async()=>repository.close());
  it("persists a stale STT heartbeat and resolves it after recovery",async()=>{
    const jobId=randomUUID();
    await repository.system(
      `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,status,idempotency_key,input_hash,input_redacted,
        attempt_count,max_attempts,requested_by_membership_id,started_at,heartbeat_at,lease_expires_at)
       VALUES($1,$2,'transcribe','recording',$3,'running',$4,$5,'{}',1,200,$6,now()-interval '5 minutes',now()-interval '4 minutes',now()+interval '1 minute')`,
      [jobId,developmentIds.organizationId,randomUUID(),`operations-${jobId}`,createHash("sha256").update(jobId).digest("hex"),developmentIds.managerMembershipId],
    );
    try{
      expect(await scanOperations(repository)).toEqual(expect.arrayContaining([expect.objectContaining({jobId,failureClass:"STT_HEARTBEAT_STALE",severity:"warning"})]));
      expect((await repository.system<{status:string}>("SELECT status FROM operational_alerts WHERE job_id=$1 AND failure_class='STT_HEARTBEAT_STALE'",[jobId])).rows[0]?.status).toBe("active");
      await repository.system("UPDATE jobs SET status='succeeded',finished_at=now(),heartbeat_at=now(),lease_expires_at=NULL WHERE id=$1",[jobId]);
      await scanOperations(repository);
      expect((await repository.system<{status:string}>("SELECT status FROM operational_alerts WHERE job_id=$1 AND failure_class='STT_HEARTBEAT_STALE'",[jobId])).rows[0]?.status).toBe("resolved");
    }finally{
      await repository.system("DELETE FROM operational_alerts WHERE job_id=$1",[jobId]);
      await repository.system("DELETE FROM jobs WHERE id=$1",[jobId]);
    }
  });
});
