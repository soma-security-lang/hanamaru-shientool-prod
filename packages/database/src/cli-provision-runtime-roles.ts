import pg from "pg";

const {Pool}=pg;
const connectionString=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=="production")throw new Error("NODE_ENV must be production");
if(!connectionString)throw new Error("DATABASE_URL is required");

const logins=[
  {name:"hanamaru_api_login",roles:["hanamaru_api","hanamaru_api_system"]},
  {name:"hanamaru_worker_login",roles:["hanamaru_worker","hanamaru_worker_system"]},
] as const;

const pool=new Pool({connectionString,max:1});
const client=await pool.connect();
try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('hanamaru:runtime-role-provisioning',0))");
  for(const login of logins){
    const result=await client.query<{rolname:string;rolsuper:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolreplication:boolean;rolbypassrls:boolean}>("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1",[login.name]);
    if(result.rowCount!==1)throw new Error(`RUNTIME_LOGIN_MISSING: ${login.name}`);
    const existing=result.rows[0]!;
    // Cloud SQL may initially create SQL users with CREATEDB/CREATEROLE. The
    // migrator is allowed to remove those attributes, but must never accept a
    // SUPERUSER, REPLICATION, or BYPASSRLS runtime login.
    if(existing.rolsuper||existing.rolreplication||existing.rolbypassrls)throw new Error(`RUNTIME_LOGIN_UNSAFE_ATTRIBUTES: ${login.name}`);
    await client.query(`ALTER ROLE ${login.name} NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`);
    for(const role of login.roles)await client.query(`GRANT ${role} TO ${login.name}`);
  }
  await client.query("COMMIT");
  console.log("runtime database role memberships are provisioned");
}catch(error){
  await client.query("ROLLBACK");
  throw error;
}finally{
  client.release();
  await pool.end();
}
