import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";

const apiBase=(process.env.LIVE_E2E_API_BASE_URL??"").replace(/\/$/,"");
const token=process.env.LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN;
const pdfPath=process.env.LIVE_E2E_PDF_PATH;
if(!apiBase||!token||!pdfPath)throw new Error("LIVE_E2E_API_BASE_URL, LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN and LIVE_E2E_PDF_PATH are required");

/** @param {string} path @param {{method?:string,body?:Record<string,unknown>,expected?:number[]}} [options] */
async function request(path,{method="GET",body,expected=[200]}={}){
  const response=await fetch(`${apiBase}${path}`,{method,headers:{authorization:`Bearer ${token}`,...(body?{"content-type":"application/json","idempotency-key":randomUUID()}: {})},body:body?JSON.stringify(body):undefined});
  const payload=await response.json().catch(()=>({}));
  if(!expected.includes(response.status))throw new Error(`${method} ${path} returned ${response.status}: ${payload.code??"unexpected response"}`);
  return{status:response.status,payload};
}
async function pollJob(jobId,timeoutMs=180_000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const {payload}=await request(`/jobs/${jobId}`);
    if(["succeeded","failed","cancelled"].includes(payload.status))return payload;
    await new Promise(resolve=>setTimeout(resolve,2_000));
  }
  throw new Error(`job ${jobId} did not finish before timeout`);
}

const pdf=await readFile(pdfPath);const sha256=createHash("sha256").update(pdf).digest("hex");
const {payload:me}=await request("/me");
if(!me.roles?.includes("manager"))throw new Error("approved manager identity is required");
const {payload:session}=await request("/visit-imports",{method:"POST",body:{mimeType:"application/pdf",sizeBytes:pdf.byteLength,sha256},expected:[201]});
const uploadResponse=await fetch(session.url,{method:session.method,headers:session.headers,body:pdf});
if(!uploadResponse.ok)throw new Error(`signed PDF upload returned ${uploadResponse.status}`);
const {payload:document}=await request(`/document-uploads/${session.uploadId}/complete`,{method:"POST",body:{},expected:[201]});
const {payload:extraction}=await request(`/documents/${document.id}/extractions`,{method:"POST",body:{schemaKey:"visit_info"},expected:[202]});
const deletionStartedAt=new Date().toISOString();
const {payload:deletion}=await request(`/visits/${session.visitId}/deletion-requests`,{method:"POST",body:{requestType:"admin",reasonCode:"live_race_verification"},expected:[202]});
if(!deletion.jobId)throw new Error("deletion job was not created");
const deletionJob=await pollJob(deletion.jobId);
if(deletionJob.status!=="succeeded")throw new Error(`deletion job ended as ${deletionJob.status}`);
const extractionJob=await pollJob(extraction.jobId,30_000).catch(error=>({status:"inaccessible_after_delete",detail:error instanceof Error?error.message:"unknown"}));
const workspace=await request(`/visits/${session.visitId}/workspace`,{expected:[403,404,410]});
const objectPathFragment=`/visits/${session.visitId}/`;
process.stdout.write(`${JSON.stringify({schemaVersion:1,visitId:session.visitId,uploadId:session.uploadId,documentId:document.id,extractionJobId:extraction.jobId,extractionJobStatus:extractionJob.status,deletionRequestId:deletion.id,deletionJobId:deletion.jobId,deletionJobStatus:deletionJob.status,deletionStartedAt,workspaceStatus:workspace.status,bucket:"monocle-503402-hanamaru-pilot-private",objectPathFragment},null,2)}\n`);
