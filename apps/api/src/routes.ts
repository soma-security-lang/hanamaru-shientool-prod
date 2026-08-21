import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { BackendService } from "./service.js";
import { denied } from "./errors.js";

const body=(request:FastifyRequest)=>(request.body&&typeof request.body==="object"&&!Buffer.isBuffer(request.body)?request.body:{}) as Record<string,unknown>;
const query=(request:FastifyRequest)=>(request.query??{}) as Record<string,unknown>;
const key=(request:FastifyRequest)=>typeof request.headers["idempotency-key"]==="string"?request.headers["idempotency-key"]:undefined;
async function send(reply:FastifyReply,promise:Promise<{status:number;body:unknown}>){const result=await promise;if(result.status===204)return reply.code(204).send();return reply.code(result.status).send(result.body);}

export async function registerRoutes(app:FastifyInstance,service:BackendService){
  app.get("/health/live",{config:{public:true}},async()=>({status:"ok",revision:process.env.K_REVISION??"local"}));
  app.get("/health/ready",{config:{public:true}},async()=>{await service.repository.system("SELECT 1");return {status:"ready",database:"ok",providers:service.providers.mode,revision:process.env.K_REVISION??"local"};});
  app.get("/api/v1/openapi.json",async(r,reply)=>{if(!r.auth.authorizationScopes?.some(scope=>scope.role==="system_admin"))throw denied();return reply.send(app.swagger());});

  const sessionGone=async(r:FastifyRequest,reply:FastifyReply)=>reply.code(410).send({error:{code:"SESSION_AUTH_REMOVED",message:"Identity Platform ID tokenをAuthorization Bearerで送信してください",fieldErrors:[],retryable:false},requestId:r.id});
  app.post("/api/v1/sessions",{config:{public:true}},sessionGone);
  app.get("/api/v1/sessions/current",{config:{public:true}},sessionGone);
  app.delete("/api/v1/sessions/current",{config:{public:true}},sessionGone);
  app.get("/api/v1/me",async r=>service.me(r.auth));
  app.get("/api/v1/dashboard",async r=>service.dashboard(r.auth));
  app.post("/api/v1/assist/answers",async(r,reply)=>send(reply,service.assist(r.auth,body(r),key(r))));

  app.get("/api/v1/visits",async r=>service.listVisits(r.auth,query(r)));
  app.post("/api/v1/visits",async(r,reply)=>send(reply,service.createVisit(r.auth,key(r),body(r))));
  app.post("/api/v1/visit-imports",async(r,reply)=>send(reply,service.startVisitImport(r.auth,key(r),body(r))));
  app.get<{Params:{id:string}}>("/api/v1/visits/:id",async r=>service.getVisit(r.auth,r.params.id));
  app.get<{Params:{id:string}}>("/api/v1/visits/:id/workspace",async r=>service.getVisitWorkspace(r.auth,r.params.id));
  app.get<{Params:{id:string}}>("/api/v1/visits/:id/retention-bindings",async r=>service.retentionBindings(r.auth,r.params.id));
  app.get<{Params:{id:string}}>("/api/v1/visits/:id/preparation",async r=>service.getPreparation(r.auth,r.params.id));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/preparation",async(r,reply)=>send(reply,service.createPreparation(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/preparation/confirm",async(r,reply)=>send(reply,service.confirmPreparation(r.auth,r.params.id,key(r),body(r))));
  app.patch<{Params:{id:string}}>("/api/v1/visits/:id",async(r,reply)=>send(reply,service.updateVisit(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/deletion-requests",async(r,reply)=>send(reply,service.requestDeletion(r.auth,r.params.id,key(r),body(r))));

  app.post<{Params:{id:string}}>("/api/v1/visits/:id/documents/uploads",async(r,reply)=>send(reply,service.startUpload(r.auth,r.params.id,"document",key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/recordings/uploads",async(r,reply)=>send(reply,service.startUpload(r.auth,r.params.id,"recording",key(r),body(r))));
  app.put<{Params:{"*":string}}>("/api/v1/local-uploads/*",async r=>{if(!(r.body instanceof Readable))throw new Error("UPLOAD_STREAM_INVALID");return service.acceptLocalUpload(r.auth,decodeURIComponent(r.params["*"]),r.body);});
  app.post<{Params:{uploadId:string}}>("/api/v1/document-uploads/:uploadId/complete",async(r,reply)=>send(reply,service.completeUpload(r.auth,r.params.uploadId,key(r),body(r))));
  app.post<{Params:{uploadId:string}}>("/api/v1/recording-uploads/:uploadId/complete",async(r,reply)=>send(reply,service.completeUpload(r.auth,r.params.uploadId,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/documents/:id/extractions",async(r,reply)=>send(reply,service.createJob(r.auth,"pdf_extract","document",r.params.id,key(r),body(r))));
  app.get<{Params:{id:string}}>("/api/v1/documents/:id/file",async(r,reply)=>{const access=await service.getDocumentFile(r.auth,r.params.id);if(access.kind==="redirect")return reply.redirect(access.url);if(access.kind!=="inline")throw new Error("DOCUMENT_STREAM_INVALID");return reply.type(access.mimeType).header("content-disposition","inline").send(access.body);});
  app.get<{Params:{id:string}}>("/api/v1/documents/:id/file-access",async r=>{const access=await service.getDocumentFile(r.auth,r.params.id);return access.kind==="redirect"?{url:access.url,expiresAt:access.expiresAt,requiresBearer:false}:{url:`/api/v1/documents/${r.params.id}/file`,expiresAt:null,requiresBearer:true};});
  app.get<{Params:{id:string}}>("/api/v1/recordings/:id/file",async(r,reply)=>{const access=await service.getRecordingFile(r.auth,r.params.id,typeof r.headers.range==="string"?r.headers.range:undefined);if(access.kind==="redirect")return reply.redirect(access.url);if(access.kind==="range_invalid")return reply.code(416).header("content-range",`bytes */${access.totalSize}`).send();if(access.kind!=="stream")throw new Error("RECORDING_STREAM_INVALID");reply.type(access.mimeType).header("accept-ranges","bytes").header("content-length",String(access.end-access.start+1));if(access.partial)reply.code(206).header("content-range",`bytes ${access.start}-${access.end}/${access.totalSize}`);return reply.send(access.source);});
  app.get<{Params:{id:string}}>("/api/v1/recordings/:id/file-access",async r=>{const access=await service.getRecordingFile(r.auth,r.params.id);return access.kind==="redirect"?{url:access.url,expiresAt:access.expiresAt,requiresBearer:false}:{url:`/api/v1/recordings/${r.params.id}/file`,expiresAt:null,requiresBearer:true};});
  app.get<{Params:{id:string}}>("/api/v1/extractions/:id",async r=>service.getExtraction(r.auth,r.params.id));
  app.patch<{Params:{id:string}}>("/api/v1/extractions/:id",async(r,reply)=>send(reply,service.updateExtraction(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/extractions/:id/confirm",async(r,reply)=>send(reply,service.confirmExtraction(r.auth,r.params.id,key(r),body(r))));

  app.post<{Params:{id:string}}>("/api/v1/visits/:id/recording-consents",async(r,reply)=>send(reply,service.createConsent(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/drive-imports",async(r,reply)=>send(reply,service.createDriveImport(r.auth,r.params.id,key(r),body(r))));
  app.post("/api/v1/drive-connections",async(r,reply)=>send(reply,service.createDriveConnection(r.auth,key(r),body(r))));
  app.get("/api/v1/drive-connections/picker-token",async r=>service.drivePickerToken(r.auth));
  app.post("/api/v1/drive-files/inspect",async r=>service.inspectDriveFile(r.auth,body(r)));
  app.delete("/api/v1/drive-connections",async(r,reply)=>send(reply,service.revokeDriveConnection(r.auth,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/recordings/:id/transcriptions",async(r,reply)=>send(reply,service.createJob(r.auth,"transcribe","recording",r.params.id,key(r),body(r))));
  app.get<{Params:{id:string}}>("/api/v1/jobs/:id",async r=>service.getJob(r.auth,r.params.id));
  app.get<{Params:{id:string}}>("/api/v1/transcripts/:id",async r=>service.getTranscript(r.auth,r.params.id));
  app.patch<{Params:{id:string}}>("/api/v1/transcripts/:id",async(r,reply)=>send(reply,service.updateTranscript(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/transcripts/:id/confirm",async(r,reply)=>send(reply,service.confirmTranscript(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/transcripts/:id/quality-assessment/acknowledgements",async(r,reply)=>send(reply,service.acknowledgeTranscriptQuality(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/transcripts/:id/reviews",async(r,reply)=>send(reply,service.createJob(r.auth,"review","transcript",r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/visits/:id/manual-transcripts",async(r,reply)=>send(reply,service.createManualTranscript(r.auth,r.params.id,key(r),body(r))));
  app.get<{Params:{id:string}}>("/api/v1/reviews/:id",async r=>service.getReview(r.auth,r.params.id));
  app.post<{Params:{id:string}}>("/api/v1/reviews/:id/acknowledgements",async(r,reply)=>send(reply,service.acknowledgeReview(r.auth,r.params.id,key(r),body(r))));
  app.get("/api/v1/history",async r=>service.history(r.auth));

  app.get("/api/v1/contents",async r=>service.listContents(r.auth,query(r)));
  app.get<{Params:{id:string}}>("/api/v1/contents/:id",async r=>service.getContent(r.auth,r.params.id));
  app.post("/api/v1/contents",async(r,reply)=>send(reply,service.createContent(r.auth,key(r),body(r))));
  app.patch<{Params:{id:string}}>("/api/v1/contents/:id",async(r,reply)=>send(reply,service.updateContent(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/contents/:id/publish",async(r,reply)=>send(reply,service.publishContent(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/contents/:id/video-uploads",async(r,reply)=>send(reply,service.startVideoUpload(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{uploadId:string}}>("/api/v1/video-uploads/:uploadId/complete",async(r,reply)=>send(reply,service.completeVideoUpload(r.auth,r.params.uploadId,key(r),body(r))));
  app.get<{Params:{id:string}}>("/api/v1/training/videos/:id/file",async(r,reply)=>{const access=await service.getTrainingVideoFile(r.auth,r.params.id,typeof r.headers.range==="string"?r.headers.range:undefined);if(access.kind==="redirect")return reply.redirect(access.url);if(access.kind==="range_invalid")return reply.code(416).header("content-range",`bytes */${access.totalSize}`).send();if(access.kind!=="stream")throw new Error("VIDEO_STREAM_INVALID");reply.type(access.mimeType).header("accept-ranges","bytes").header("content-length",String(access.end-access.start+1));if(access.partial)reply.code(206).header("content-range",`bytes ${access.start}-${access.end}/${access.totalSize}`);return reply.send(access.source);});
  app.get<{Params:{id:string}}>("/api/v1/training/videos/:id/file-access",async r=>{const access=await service.getTrainingVideoFile(r.auth,r.params.id);return access.kind==="redirect"?{url:access.url,expiresAt:access.expiresAt,requiresBearer:false}:{url:`/api/v1/training/videos/${r.params.id}/file`,expiresAt:null,requiresBearer:true};});
  app.get("/api/v1/training/scenarios",async r=>service.listContents(r.auth,{...query(r),type:"roleplay"}));
  app.post("/api/v1/training/roleplay-turns",async(r,reply)=>send(reply,service.roleplayTurn(r.auth,body(r),key(r))));
  app.get("/api/v1/training/roleplay-sessions",async r=>service.listRoleplaySessions(r.auth));
  app.get<{Params:{id:string}}>("/api/v1/training/roleplay-sessions/:id",async r=>service.getRoleplaySession(r.auth,r.params.id));
  app.post<{Params:{id:string}}>("/api/v1/training/roleplay-sessions/:id/complete",async(r,reply)=>send(reply,service.completeRoleplaySession(r.auth,r.params.id,key(r),body(r))));
  app.put<{Params:{id:string}}>("/api/v1/training/progress/:id",async(r,reply)=>send(reply,service.learningProgress(r.auth,r.params.id,key(r),body(r))));

  app.get("/api/v1/admin/users",async r=>service.listUsers(r.auth));
  app.post("/api/v1/admin/users",async(r,reply)=>send(reply,service.inviteUser(r.auth,key(r),body(r))));
  app.patch<{Params:{id:string}}>("/api/v1/admin/users/:id",async(r,reply)=>send(reply,service.updateUser(r.auth,r.params.id,key(r),body(r))));
  app.put<{Params:{id:string}}>("/api/v1/admin/users/:id/roles",async(r,reply)=>send(reply,service.replaceRoles(r.auth,r.params.id,key(r),body(r))));
  app.get("/api/v1/admin/jobs",async r=>service.listJobs(r.auth,query(r)));
  app.get("/api/v1/admin/operations/health",async r=>service.operationsHealth(r.auth));
  app.post<{Params:{id:string}}>("/api/v1/admin/jobs/:id/retry",async(r,reply)=>send(reply,service.retryJob(r.auth,r.params.id,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/admin/jobs/:id/cancel",async(r,reply)=>send(reply,service.cancelJob(r.auth,r.params.id,key(r),body(r))));
  app.get("/api/v1/admin/retention-policies",async r=>service.retentionPolicies(r.auth));
  app.post("/api/v1/admin/retention-policies",async(r,reply)=>send(reply,service.createRetentionPolicy(r.auth,key(r),body(r))));
  app.get("/api/v1/admin/deletion-requests",async r=>service.deletionRequests(r.auth));
  app.post<{Params:{id:string}}>("/api/v1/admin/legal-holds/:id",async(r,reply)=>send(reply,service.createLegalHold(r.auth,r.params.id,key(r),body(r))));
  app.delete<{Params:{id:string}}>("/api/v1/admin/legal-holds/:id",async(r,reply)=>send(reply,service.releaseLegalHold(r.auth,r.params.id,key(r),body(r))));
  app.get("/api/v1/admin/audit-events",async r=>service.auditEvents(r.auth,query(r)));
  app.get("/api/v1/admin/feature-flags",async r=>service.featureFlags(r.auth));
  app.patch<{Params:{key:string}}>("/api/v1/admin/feature-flags/:key",async(r,reply)=>send(reply,service.updateFeatureFlag(r.auth,r.params.key,key(r),body(r))));
  app.get("/api/v1/admin/content-approvals",async r=>service.approvals(r.auth));
  app.post("/api/v1/admin/content-approvals",async(r,reply)=>send(reply,service.decideApproval(r.auth,key(r),body(r))));
  app.get("/api/v1/admin/content-approval-batches",async r=>service.approvalBatches(r.auth));
  app.post("/api/v1/admin/content-approval-batches",async(r,reply)=>send(reply,service.createApprovalBatch(r.auth,key(r),body(r))));
  app.post<{Params:{id:string}}>("/api/v1/admin/content-approval-batches/:id/decisions",async(r,reply)=>send(reply,service.decideApprovalBatch(r.auth,r.params.id,key(r),body(r))));
  app.get("/api/v1/admin/analytics",async r=>service.analytics(r.auth,query(r)));
}
