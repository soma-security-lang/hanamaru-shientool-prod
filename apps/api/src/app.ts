import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { randomUUID,timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import { HanamaruRepository,createPool } from "@hanamaru/database";
import { createProviders,type PlatformProviders } from "@hanamaru/platform";
import {authenticate,type IdentityTokenVerifier} from "./auth.js";
import { loadConfig,type ApiConfig } from "./config.js";
import { ApiProblem } from "./errors.js";
import { registerRoutes } from "./routes.js";
import { BackendService } from "./service.js";

export interface AppOptions { config?:ApiConfig; repository?:HanamaruRepository; providers?:PlatformProviders; identityTokenVerifier?:IdentityTokenVerifier; }
export async function buildApp(options:AppOptions={}){
  const config=options.config??loadConfig(); const repository=options.repository??new HanamaruRepository(createPool()); const providers=options.providers??createProviders();
  const app=Fastify({logger:{level:process.env.LOG_LEVEL??"info",redact:{paths:["req.headers.authorization","req.headers.cookie","req.headers['idempotency-key']","req.headers['x-sso-approval-secret']","res.headers['set-cookie']"],censor:"[REDACTED]"}},genReqId:req=>{const supplied=req.headers["x-request-id"];return typeof supplied==="string"&&/^[A-Za-z0-9._:-]{8,64}$/.test(supplied)?supplied:randomUUID();},bodyLimit:2_000_000});
  app.decorateRequest("auth",null as never);
  app.addContentTypeParser(["application/octet-stream","audio/mpeg","audio/mp4","audio/wav","video/mp4","video/webm","application/pdf","image/jpeg","image/png","image/webp"],(_request,payload,done)=>done(null,payload as Readable));
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'none'"]}},xFrameOptions:{action:"deny"}}); await app.register(cors,{origin:(origin,cb)=>{if(!origin||config.corsOrigins.includes(origin))cb(null,true);else cb(new Error("Origin not allowed"),false);},credentials:false,methods:["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]}); await app.register(rateLimit,{max:config.rateLimitMax,timeWindow:"1 minute"});
  await app.register(swagger,{openapi:{info:{title:"買取支援ツール API",version:"1.0.0"},servers:[{url:"/api/v1"}]}});
  app.addHook("onRequest",async request=>{const isPublic=(request.routeOptions.config as {public?:boolean}|undefined)?.public;if(!isPublic)request.auth=await authenticate(request,config,repository,options.identityTokenVerifier);});
  app.addHook("onSend",async(request,reply,payload)=>{reply.header("x-request-id",request.id);reply.header("cache-control",request.url.includes("/health/")?"no-store":"private, no-store");return payload;});
  app.addHook("onResponse",async(request,reply)=>{if(reply.statusCode===401)request.log.warn({authFailure:true},"authentication rejected");});
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ApiProblem)return reply.code(error.statusCode).send({error:{code:error.code,message:error.message,fieldErrors:error.fieldErrors,retryable:error.retryable},requestId:request.id});
    const safe=error instanceof Error?error:new Error("unknown error");
    const diagnostic=error&&typeof error==="object"?error as {code?:unknown;constraint?:unknown}:{};
    const providerTemporary=safe.message.startsWith("PROVIDER_TEMPORARY:");
    const providerPermanent=safe.message.startsWith("PROVIDER_PERMANENT:");
    request.log.error({err:{name:safe.name,message:config.nodeEnv==="production"?"request failed":safe.message,code:typeof diagnostic.code==="string"?diagnostic.code:undefined,constraint:typeof diagnostic.constraint==="string"?diagnostic.constraint:undefined,stack:config.nodeEnv==="production"?undefined:safe.stack}},"request failed");
    if(providerTemporary)return reply.code(503).send({error:{code:"PROVIDER_TEMPORARY",message:"外部サービスが一時的に利用できません。時間をおいて再実行してください。",fieldErrors:[],retryable:true},requestId:request.id});
    if(providerPermanent)return reply.code(422).send({error:{code:"PROVIDER_PERMANENT",message:"外部サービスの処理を完了できませんでした。入力または接続設定を確認してください。",fieldErrors:[],retryable:false},requestId:request.id});
    return reply.code(500).send({error:{code:"INTERNAL_ERROR",message:"処理を完了できませんでした。Request IDを管理者へお伝えください。",fieldErrors:[],retryable:false},requestId:request.id});
  });
  app.post<{Body:{productUserId?:unknown;organizationId?:unknown;purpose?:unknown}}>("/internal/sso/eligibility",{config:{public:true}},async(request,reply)=>{
    const expected=config.ssoApprovalSecret;
    const supplied=request.headers["x-sso-approval-secret"];
    if(!expected||typeof supplied!=="string"||supplied.length!==expected.length||
      !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return reply.code(403).send({error:"Forbidden"});
    const {productUserId,organizationId,purpose}=request.body??{};
    if(typeof productUserId!=="string"||typeof organizationId!=="string"||
      !/^[0-9a-f-]{36}$/i.test(productUserId)||!/^[0-9a-f-]{36}$/i.test(organizationId)||
      (purpose!=="target"&&purpose!=="approver"))return reply.code(400).send({error:"Invalid request"});
    const result=await repository.system<{user_id:string;organization_id:string;approver:boolean}>(
      `SELECT u.id user_id,m.organization_id,EXISTS(
         SELECT 1 FROM role_assignments ra JOIN roles r ON r.id=ra.role_id
         WHERE ra.membership_id=m.id AND r.role_code='manager'
           AND ra.scope_type='organization' AND ra.scope_id=m.organization_id
           AND ra.valid_from<=now() AND (ra.valid_until IS NULL OR ra.valid_until>now())
       ) approver FROM users u JOIN memberships m ON m.user_id=u.id
       WHERE u.id=$1 AND m.organization_id=$2 AND u.status='active' AND m.status='active'`,
      [productUserId,organizationId],
    );
    return reply.header("cache-control","no-store").send({productUserId,organizationId,
      active:result.rowCount===1,approver:result.rowCount===1&&result.rows[0]?.approver===true});
  });
  app.post<{Body:{requestId?:unknown;productUserId?:unknown;organizationId?:unknown}}>("/internal/sso/enrollment",{config:{public:true}},async(request,reply)=>{
    const expected=config.ssoApprovalSecret;
    const supplied=request.headers["x-sso-approval-secret"];
    if(!expected||typeof supplied!=="string"||supplied.length!==expected.length||
      !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return reply.code(403).send({error:"Forbidden"});
    const {requestId,productUserId,organizationId}=request.body??{};
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof requestId!=="string"||!uuid.test(requestId)||typeof productUserId!=="string"||
      !uuid.test(productUserId)||typeof organizationId!=="string"||!uuid.test(organizationId))
      return reply.code(400).send({error:"Invalid request"});
    const prepared=await repository.system<{id:string}>(
      `WITH updated AS (
         UPDATE memberships m SET sso_enrollment_state='pending',sso_enrollment_request_id=$3,updated_at=now()
         WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active'
           AND m.sso_enrollment_state='legacy'
           AND EXISTS(SELECT 1 FROM users u WHERE u.id=m.user_id AND u.status='active')
         RETURNING m.id,m.user_id,m.organization_id
       ) INSERT INTO sso_enrollment_events(organization_id,user_id,request_id,action)
         SELECT organization_id,user_id,$3,'prepared' FROM updated RETURNING id`,
      [productUserId,organizationId,requestId],
    );
    if(prepared.rowCount===1)return reply.header("cache-control","no-store").send({state:"pending"});
    const existing=await repository.system<{sso_enrollment_state:string;sso_enrollment_request_id:string|null}>(
      `SELECT m.sso_enrollment_state,m.sso_enrollment_request_id FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND u.status='active'`,
      [productUserId,organizationId],
    );
    if(existing.rowCount!==1)return reply.code(403).send({error:"Ineligible user"});
    if(existing.rows[0]?.sso_enrollment_state==='pending'&&existing.rows[0]?.sso_enrollment_request_id===requestId)
      return reply.header("cache-control","no-store").send({state:"pending"});
    return reply.code(409).send({error:"Enrollment conflict"});
  });
  await registerRoutes(app,new BackendService(repository,providers));
  app.addHook("onClose",async()=>repository.close());
  return app;
}
