/** Test-only adapter used to run the unchanged API integration assertions through
 * native Request/Response + Prisma. Never loaded by the runtime route. */
import { BackendService, loadConfig } from "@hanamaru/api/alignment";
import { buildApp as legacyApp } from "@hanamaru/api/testing";
import { createLocalProviders } from "@hanamaru/platform";
import { localPrisma, PrismaRepository } from "@hanamaru/alignment";
import { nativeApi } from "./native-api";
export async function buildApp(options: Parameters<typeof legacyApp>[0] = {}) {
  if (process.env.HANAMARU_NATIVE_CONTRACT_TEST !== "true") throw new Error("TEST_ONLY");
  const url=process.env.ALIGNMENT_DATABASE_URL!;
  const repository=new PrismaRepository(localPrisma(url),url,"hanamaru_api","hanamaru_api_system");
  const app=await legacyApp(options), inject=app.inject.bind(app);
  // Preserve the existing deliberately fault-injecting COMMIT repository test.
  // That single case exercises native transport with legacy persistence, not Prisma.
  const selected=options.repository && options.repository.constructor.name!=="HanamaruRepository" ? options.repository : repository;
  const native=await nativeApi(new BackendService(selected,options.providers??createLocalProviders()),options.config??loadConfig(),options.identityTokenVerifier);
  app.addHook("onClose",async()=>repository.close());
  const replacement=async (input: {url?:string;method?:string;headers?:Record<string,string|string[]>;payload?:unknown}) => {
    const headers=new Headers();
    for(const [key,value] of Object.entries(input.headers??{}))headers.set(key,Array.isArray(value)?value.join(","):String(value));
    let body: string | undefined;
    if(input.payload!==undefined) {body=typeof input.payload==="string"?input.payload:JSON.stringify(input.payload);if(!headers.has("content-type"))headers.set("content-type","application/json");}
    const response=await native.handle(new Request(new URL(input.url??"/","http://127.0.0.1:3390"),{method:input.method??"GET",headers,...(body!==undefined?{body}:{})}));
    if(!response)return inject(input as Parameters<typeof inject>[0]);
    const text=await response.text();
    return {statusCode:response.status,body:text,payload:text,rawPayload:Buffer.from(text),headers:Object.fromEntries(response.headers),json:()=>JSON.parse(text)};
  };
  app.inject=replacement as unknown as typeof app.inject;
  return app;
}
