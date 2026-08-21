import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {HanamaruRepository,createPool} from "@hanamaru/database";
import {createProviders} from "@hanamaru/platform";
import Fastify from "fastify";
import {dispatchOnce,enqueueRetentionScans} from "./dispatcher.js";
import {scanOperations} from "./operations.js";
import {WorkerProcessor} from "./processor.js";

type ProcessResult="succeeded"|"retry_wait"|"failed"|"cancelled"|"not_claimed";

export function taskDeliveryHttpStatus(result:ProcessResult,currentStatus?:string):200|503{
  return result==="not_claimed"&&currentStatus==="running"?503:200;
}

export function buildWorker(){
  const repository=new HanamaruRepository(createPool());
  const providers=createProviders();
  const processor=new WorkerProcessor(repository,providers);
  const app=Fastify({logger:{level:process.env.LOG_LEVEL??"info",redact:["req.headers.authorization","req.headers.x-local-worker-token"]},bodyLimit:64*1024});
  let localTimer:NodeJS.Timeout|undefined;
  let localTickRunning=false;

  app.addHook("onRequest",async request=>{
    if(request.url.startsWith("/health/"))return;
    if(process.env.NODE_ENV==="production"){
      if(!request.headers["x-cloudtasks-taskname"]&&!['/internal/dispatch','/internal/retention-scan','/internal/operations-scan'].includes(request.url))throw Object.assign(new Error("Cloud Tasks request required"),{statusCode:401});
    }else{
      const expected=process.env.LOCAL_WORKER_TOKEN??"local-worker";
      if(request.headers["x-local-worker-token"]!==expected)throw Object.assign(new Error("worker token required"),{statusCode:401});
    }
  });
  app.get("/health/live",async()=>({status:"ok",revision:process.env.K_REVISION??"local"}));
  app.get("/health/ready",async()=>{await repository.system("SELECT 1");return{status:"ready",database:"ok",providers:providers.mode,revision:process.env.K_REVISION??"local"};});
  app.post<{Params:{type:string};Body:{job_id?:string}}>("/internal/tasks/:type",async(request,reply)=>{
    const jobId=request.body?.job_id;
    if(!jobId)return reply.code(422).send({error:"job_id required"});
    const startedAt=Date.now();
    const result=await processor.process(jobId,String(request.headers["x-cloud-trace-context"]??request.id));
    request.log.info({jobId,jobType:request.params.type,jobStatus:result,processingMs:Date.now()-startedAt},"worker job completed");
    let currentStatus:string|undefined;
    if(result==="not_claimed"){
      const current=await repository.system<{status:string}>("SELECT status FROM jobs WHERE id=$1",[jobId]);
      currentStatus=current.rows[0]?.status;
    }
    return reply.code(taskDeliveryHttpStatus(result,currentStatus)).send({status:result,currentStatus});
  });
  app.post("/internal/dispatch",async()=>dispatchOnce(repository,providers.tasks));
  app.post("/internal/retention-scan",async()=>enqueueRetentionScans(repository));
  app.post("/internal/operations-scan",async request=>{
    const alerts=await scanOperations(repository);
    for(const alert of alerts){
      const entry={operationalAlert:true,failureClass:alert.failureClass,jobType:alert.jobType,attempt:alert.attempt,maxAttempts:alert.maxAttempts,oldestAgeSeconds:alert.oldestAgeSeconds};
      if(alert.severity==="critical")request.log.error(entry,"operational alert detected");
      else request.log.warn(entry,"operational alert detected");
    }
    return{status:"scanned",warning:alerts.filter(alert=>alert.severity==="warning").length,critical:alerts.filter(alert=>alert.severity==="critical").length};
  });
  app.addHook("onReady",async()=>{
    if(!["local","local-connected"].includes(providers.mode))return;
    const tick=async()=>{
      if(localTickRunning)return;
      localTickRunning=true;
      try{
        await dispatchOnce(repository,providers.tasks);
        const queued=await repository.system<{id:string}>("SELECT id FROM jobs WHERE status IN ('queued','retry_wait') AND available_at<=now() ORDER BY available_at,id LIMIT 10");
        for(const job of queued.rows)await processor.process(job.id);
      }catch(error){
        app.log.error({error:error instanceof Error?error.message:"unknown"},"local worker tick failed");
      }finally{localTickRunning=false;}
    };
    await tick();
    localTimer=setInterval(()=>void tick(),750);
  });
  app.addHook("onClose",async()=>{if(localTimer)clearInterval(localTimer);await repository.close();});
  return app;
}

const entry=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:null;
if(entry===import.meta.url){
  const app=buildWorker();
  const port=Number(process.env.WORKER_PORT??3300);
  await app.listen({host:process.env.WORKER_HOST??"127.0.0.1",port});
}
