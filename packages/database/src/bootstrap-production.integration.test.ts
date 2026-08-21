import {createHash,randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {bootstrapProduction,type ProductionBootstrapConfig} from "./bootstrap-production.js";
import {createPool} from "./repository.js";

const databaseUrl=process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("production database bootstrap",()=>{
  it("is dry-run by default, idempotent on apply, hash-only for email, and fail-closed on drift",async()=>{
    const suffix=randomUUID().replaceAll("-","").slice(0,12);
    const email=`bootstrap-${suffix}@example.invalid`;
    const config:ProductionBootstrapConfig={
      ids:{organization:randomUUID(),branch:randomUUID(),managerUser:randomUUID(),managerMembership:randomUUID()},
      organizationKey:`bootstrap-${suffix}`,
      organizationName:"Bootstrap Test Organization",
      branchKey:"initial",
      branchName:"Initial Branch",
      managerEmail:email,
      managerDisplayName:"Initial Manager",
      vertexModel:"gemini-2.5-flash",
      pilotContentAiEnabled:false,
      retentionDays:{pdf:180,audio:90,video:365,transcript:180,review:180,audit:365},
    };
    const pool=createPool(databaseUrl);
    let organizationId:string|undefined;
    let userId:string|undefined;
    try{
      const dryRun=await bootstrapProduction(pool,config);
      expect(dryRun.mode).toBe("dry-run");
      expect(dryRun.created).toHaveLength(22);
      expect((await pool.query("SELECT 1 FROM organizations WHERE organization_key=$1",[config.organizationKey])).rowCount).toBe(0);

      const applied=await bootstrapProduction(pool,config,true);
      expect(applied.mode).toBe("apply");
      expect(applied.created).toHaveLength(22);
      expect(JSON.stringify(applied)).not.toContain(email);
      const repeated=await bootstrapProduction(pool,config,true);
      expect(repeated.created).toEqual([]);
      expect(repeated.existing).toHaveLength(22);

      const organization=await pool.query<{id:string}>("SELECT id FROM organizations WHERE organization_key=$1",[config.organizationKey]);
      organizationId=organization.rows[0]?.id;
      expect(organizationId).toBeTruthy();
      const user=await pool.query<{id:string;email_hash:string;email_masked:string;status:string}>("SELECT u.id,u.email_hash,u.email_masked,u.status FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=$1",[organizationId]);
      userId=user.rows[0]?.id;
      expect(user.rows[0]).toMatchObject({email_hash:createHash("sha256").update(email).digest("hex"),email_masked:"i***@redacted.invalid",status:"invited"});
      expect(JSON.stringify(user.rows[0])).not.toContain(email);
      const roles=await pool.query<{role_code:string;scope_type:string}>("SELECT r.role_code,ra.scope_type FROM role_assignments ra JOIN roles r ON r.id=ra.role_id WHERE ra.organization_id=$1 ORDER BY r.role_code",[organizationId]);
      expect(roles.rows).toEqual([{role_code:"content_approver",scope_type:"organization"},{role_code:"educator",scope_type:"organization"},{role_code:"manager",scope_type:"organization"}]);
      await expect(bootstrapProduction(pool,{...config,organizationName:"Drifted Organization"},true)).rejects.toThrow("BOOTSTRAP_DRIFT: organization.name");
    }finally{
      if(organizationId){
        await pool.query("DELETE FROM feature_flags WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM review_criteria_versions WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM prompt_versions WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM retention_policies WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM role_assignments WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM memberships WHERE organization_id=$1",[organizationId]);
        if(userId)await pool.query("DELETE FROM users WHERE id=$1",[userId]);
        await pool.query("DELETE FROM branches WHERE organization_id=$1",[organizationId]);
        await pool.query("DELETE FROM organizations WHERE id=$1",[organizationId]);
      }
      await pool.end();
    }
  });
});
