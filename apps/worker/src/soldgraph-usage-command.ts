import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createPool,HanamaruRepository} from "@hanamaru/database";
import {createConfiguredSoldgraphProvider} from "@hanamaru/platform";
import {refreshSoldgraphUsage} from "./soldgraph-usage.js";

type Environment=Readonly<Record<string,string|undefined>>;
const defaults={
  provider:(environment:Environment)=>createConfiguredSoldgraphProvider(environment,globalThis.fetch),
  repository:(url:string)=>new HanamaruRepository(createPool(url),"hanamaru_worker","hanamaru_worker_system"),
  refresh:refreshSoldgraphUsage,
};

/** Operator-only command. Permission must be explicit; never executes during normal startup. */
export async function runSoldgraphUsageCommand(environment:Environment,dependencies=defaults):Promise<void>{
  if(environment.SOLDGRAPH_USAGE_REFRESH_ENABLED!=="true"||environment.SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS!=="true"
    ||!["gcp","local-connected"].includes(environment.PROVIDER_MODE??"")||!environment.DATABASE_URL
    ||environment.DATABASE_CONTEXT_ROLE!=="hanamaru_worker"||environment.DATABASE_SYSTEM_ROLE!=="hanamaru_worker_system")
    throw new Error("SOLDGRAPH_USAGE_COMMAND_DISABLED");
  const provider=dependencies.provider(environment);
  if(!provider||!environment.SOLDGRAPH_ACCOUNT_ID)throw new Error("SOLDGRAPH_USAGE_COMMAND_CONFIGURATION");
  const repository=dependencies.repository(environment.DATABASE_URL);
  try{await dependencies.refresh(repository,provider,environment.SOLDGRAPH_ACCOUNT_ID);}
  finally{await repository.close();}
}

const entry=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:null;
if(entry===import.meta.url){
  try{await runSoldgraphUsageCommand(process.env);process.stdout.write("Soldgraph usage reconciliation completed.\n");}
  catch{process.stderr.write("Soldgraph usage reconciliation did not complete; check permission, configuration and accounting state.\n");process.exitCode=1;}
}
