import {bootstrapProduction,productionBootstrapConfig} from "./bootstrap-production.js";
import {createPool} from "./repository.js";

const args=process.argv.slice(2);
if(args.some(arg=>arg!=="--apply")||args.filter(arg=>arg==="--apply").length>1)throw new Error("Usage: bootstrap:production [--apply]");
const apply=args.includes("--apply");
const config=productionBootstrapConfig(process.env);
const pool=createPool();
try{
  const result=await bootstrapProduction(pool,config,apply);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}finally{await pool.end();}
