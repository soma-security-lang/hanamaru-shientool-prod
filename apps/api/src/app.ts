import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
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
  const app=Fastify({logger:{level:process.env.LOG_LEVEL??"info",redact:{paths:["req.headers.authorization","req.headers.cookie","req.headers['idempotency-key']","res.headers['set-cookie']"],censor:"[REDACTED]"}},genReqId:req=>{const supplied=req.headers["x-request-id"];return typeof supplied==="string"&&/^[A-Za-z0-9._:-]{8,64}$/.test(supplied)?supplied:randomUUID();},bodyLimit:2_000_000});
  app.decorateRequest("auth",null as never);
  app.addContentTypeParser(["application/octet-stream","audio/mpeg","audio/mp4","audio/wav","video/mp4","video/webm","application/pdf"],(_request,payload,done)=>done(null,payload as Readable));
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'none'"]}},xFrameOptions:{action:"deny"}}); await app.register(cors,{origin:(origin,cb)=>{if(!origin||config.corsOrigins.includes(origin))cb(null,true);else cb(new Error("Origin not allowed"),false);},credentials:false,methods:["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]}); await app.register(rateLimit,{max:300,timeWindow:"1 minute"});
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
  await registerRoutes(app,new BackendService(repository,providers));
  app.addHook("onClose",async()=>repository.close());
  return app;
}
